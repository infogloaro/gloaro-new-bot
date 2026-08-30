import {
  ConnectionTestResult,
  EMPTY_WEBHOOK,
  OutboundMessage,
  ParsedWebhook,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderError,
  SendResult,
  WebhookVerificationContext,
  WhatsAppProviderId,
} from '../provider.types';
import { buildCloudApiBody, parseCloudApiWebhook } from './cloud-api.helpers';
import { WhatsAppProvider } from './provider.base';

/**
 * 360dialog (https://docs.360dialog.com).
 *
 * A Meta Business Solution Provider that fronts the Cloud API almost verbatim:
 * `POST https://waba-v2.360dialog.io/messages` with a `D360-API-KEY` header and
 * a Meta-shaped body. The webhook is likewise Meta-shaped, so both directions
 * reuse the shared Cloud API helpers.
 *
 * 360dialog does not sign its callbacks, so the URL carries a per-account
 * secret in `?token=`.
 */

const DEFAULT_BASE_URL = 'https://waba-v2.360dialog.io';
const SANDBOX_BASE_URL = 'https://waba-sandbox.360dialog.io';

interface Dialog360SendResponse {
  messages?: Array<{ id?: string }>;
  contacts?: Array<{ wa_id?: string; input?: string }>;
  error?: { message?: string; code?: number; details?: string };
  errors?: Array<{ title?: string; details?: string; code?: number }>;
  /** The Sandbox reports refusals here, e.g. "can only send to your verified number". */
  detail?: string;
}

export class Dialog360Provider extends WhatsAppProvider {
  readonly id: WhatsAppProviderId = 'DIALOG360';

  readonly capabilities: ProviderCapabilities = {
    send: ['text', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'template', 'buttons', 'list'],
    deliveryStatus: true,
    // Cloud API delivers inbound media as an id that must be downloaded with the
    // API key, not as a public URL, so nothing usable is stored on the message.
    inboundMedia: false,
    signedWebhooks: false,
    connectionStatus: true,
  };

  static descriptor(): ProviderDescriptor {
    return {
      id: 'DIALOG360',
      label: '360dialog',
      slug: '360dialog',
      docsUrl: 'https://docs.360dialog.com/docs/guides/send-and-receive-messages',
      summary: 'Meta Business Solution Provider. Cloud API compatible, full template and interactive support.',
      fields: [
        {
          name: 'apiKey',
          label: 'D360 API Key',
          type: 'secret',
          required: true,
          help:
            'From the 360dialog Client Hub → your channel → API key. Sent as the D360-API-KEY ' +
            'header. Stored encrypted; never shown again.',
        },
        {
          name: 'channelId',
          label: 'Channel ID',
          type: 'text',
          required: false,
          help: 'Optional. Recorded so inbound webhooks can be routed if the URL loses its account id.',
        },
        {
          name: 'environment',
          label: 'Environment',
          type: 'select',
          required: true,
          options: [
            { value: 'production', label: 'Production (waba-v2.360dialog.io)' },
            { value: 'sandbox', label: 'Sandbox (waba-sandbox.360dialog.io)' },
          ],
          help:
            'Sandbox is the free trial channel (On-Premise v1 API). It can only deliver to the ' +
            'one phone number that activated the key by sending START to 360dialog, and is ' +
            'capped at 200 messages. Production is the Cloud-API-compatible waba-v2 service.',
        },
      ],
      capabilities: {
        send: [
          'text',
          'image',
          'document',
          'audio',
          'video',
          'sticker',
          'location',
          'template',
          'buttons',
          'list',
        ],
        deliveryStatus: true,
        inboundMedia: false,
        signedWebhooks: false,
        connectionStatus: true,
      },
      webhookInstructions:
        'Nothing to paste anywhere: "Test connection" registers the URL below with 360dialog ' +
        'for you via POST /v1/configs/webhook. Re-run it whenever the public URL changes.',
    };
  }

  descriptor(): ProviderDescriptor {
    return Dialog360Provider.descriptor();
  }

  private get apiKey(): string {
    return this.requireCredential('apiKey', 'D360 API Key');
  }

  /**
   * The two environments are not the same API.
   *
   * Only the path differs. Production is the Cloud-API-compatible `waba-v2`
   * service at `POST /messages`; the Sandbox serves the same Meta-shaped body
   * at `POST /v1/messages`. Posting the production path to the Sandbox returns
   * a bare 404, which is exactly the kind of failure that looks like a
   * credential problem and is not.
   */
  private get isSandbox(): boolean {
    return this.credential('environment') === 'sandbox';
  }

  private get baseUrl(): string {
    return this.isSandbox ? SANDBOX_BASE_URL : DEFAULT_BASE_URL;
  }

  private get sendPath(): string {
    return this.isSandbox ? '/v1/messages' : '/messages';
  }

  /**
   * The Sandbox answers 403 when the recipient is not the phone that activated
   * the key. That is a property of the message, not of the credentials, so it
   * must not be reported as an authentication failure - doing so would mark an
   * otherwise healthy channel as broken in the admin panel.
   */
  protected classifyStatus(
    status: number,
    data: unknown,
    headers: Record<string, unknown>,
  ): ProviderError | null {
    if (status === 403 && /verified number/i.test(this.summarise(data))) {
      return new ProviderError(
        'INVALID_RECIPIENT',
        'The 360dialog Sandbox can only deliver to the phone number that activated the API key. ' +
          'Send START on WhatsApp to +55 11 4673 3492 from the number you want to test with, or ' +
          'switch this channel to Production.',
      );
    }
    return super.classifyStatus(status, data, headers);
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  async send(message: OutboundMessage): Promise<SendResult> {
    const to = WhatsAppProvider.msisdn(message.to);

    // Both environments take the same Meta-shaped body, `messaging_product`
    // included - only the path differs. The Sandbox validates the schema after
    // its recipient check, so a body problem stays hidden behind a 403 until
    // the recipient is verified.
    const body = buildCloudApiBody(message, to);

    const { status, data } = await this.request<Dialog360SendResponse>({
      method: 'POST',
      url: `${this.baseUrl}${this.sendPath}`,
      headers: { 'D360-API-KEY': this.apiKey, 'Content-Type': 'application/json' },
      data: body,
    });

    if (status >= 400) {
      const detail =
        data?.error?.message ??
        data?.detail ??
        data?.errors?.[0]?.details ??
        data?.errors?.[0]?.title ??
        this.summarise(data);
      throw new ProviderError(
        status >= 500 ? 'PROVIDER_ERROR' : 'INVALID_REQUEST',
        `360dialog rejected the message: ${detail || `HTTP ${status}`}`,
      );
    }

    const messageId = data?.messages?.[0]?.id;
    if (!messageId) {
      throw new ProviderError('PROVIDER_ERROR', '360dialog accepted the request but returned no message id');
    }

    return { success: true, messageId };
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  /**
   * Registers our callback URL. This is the documented `POST /v1/configs/webhook`
   * call, so it doubles as a credential check and as the one setup step the
   * client would otherwise have to perform by hand.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    const { status, data } = await this.request<Record<string, unknown>>({
      method: 'POST',
      url: `${this.baseUrl}/v1/configs/webhook`,
      headers: { 'D360-API-KEY': this.apiKey, 'Content-Type': 'application/json' },
      data: { url: this.webhookUrlWithToken() },
    });

    if (status === 401 || status === 403) {
      return { state: 'ERROR', message: '360dialog rejected the API key.' };
    }
    if (status >= 400) {
      return {
        state: 'ERROR',
        message: this.summarise(data) || `360dialog returned HTTP ${status}`,
      };
    }

    return {
      state: 'CONNECTED',
      message: 'API key accepted and the webhook URL is registered with 360dialog.',
      details: { environment: this.credential('environment') || 'production' },
    };
  }

  /** The callback URL 360dialog should post to, secret included. */
  private webhookUrlWithToken(): string {
    if (!this.config.webhookUrl) {
      throw new ProviderError('NOT_CONFIGURED', 'The public webhook URL is not known yet');
    }
    return this.config.webhookUrl;
  }

  // -------------------------------------------------------------------------
  // Webhook
  // -------------------------------------------------------------------------

  verifyWebhook(ctx: WebhookVerificationContext): boolean {
    const token = typeof ctx.query?.token === 'string' ? ctx.query.token : '';
    return WhatsAppProvider.safeEqual(this.config.webhookSecret, token);
  }

  parseWebhook(ctx: WebhookVerificationContext): ParsedWebhook {
    if (!ctx.body || typeof ctx.body !== 'object') return EMPTY_WEBHOOK;
    return parseCloudApiWebhook(ctx.body, this.id, this.phoneNumber);
  }
}
