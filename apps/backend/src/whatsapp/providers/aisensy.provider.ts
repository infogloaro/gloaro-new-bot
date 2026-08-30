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
 * AiSensy (https://wiki.aisensy.com).
 *
 * AiSensy exposes two documented surfaces and they are not interchangeable:
 *
 *   - **Project API** - `POST https://apis.aisensy.com/project-apis/v1/project/
 *     {projectId}/messages`, authenticated with `X-AiSensy-Project-API-Pwd`,
 *     taking Cloud-API-shaped bodies. This is the one that can send free-form
 *     session replies, which is what a conversational bot needs.
 *   - **Campaign API** - `POST https://backend.aisensy.com/campaign/t1/api/v2`,
 *     authenticated with an `apiKey` in the body. It can only fire a pre-built
 *     *live campaign* built on an approved template.
 *
 * Which one an account has depends on its AiSensy plan, so the mode is a
 * configuration field and the capability set changes with it. Choosing campaign
 * mode genuinely means the bot cannot send free text, and the adapter says so
 * rather than pretending otherwise.
 */

const PROJECT_BASE = 'https://apis.aisensy.com/project-apis/v1/project';
const CAMPAIGN_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

type AiSensyMode = 'project' | 'campaign';

interface ProjectSendResponse {
  messages?: Array<{ id?: string }>;
  message?: string;
  error?: unknown;
}

interface CampaignSendResponse {
  success?: boolean;
  message?: string;
  errorMessage?: string;
}

export class AiSensyProvider extends WhatsAppProvider {
  readonly id: WhatsAppProviderId = 'AISENSY';

  get capabilities(): ProviderCapabilities {
    const campaignOnly = this.mode === 'campaign';
    return {
      send: campaignOnly
        ? ['template']
        : ['text', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'template', 'buttons', 'list'],
      deliveryStatus: true,
      inboundMedia: true,
      signedWebhooks: true,
      connectionStatus: false,
    };
  }

  static descriptor(): ProviderDescriptor {
    return {
      id: 'AISENSY',
      label: 'AiSensy',
      slug: 'aisensy',
      docsUrl: 'https://wiki.aisensy.com/en/articles/11501889-api-reference-docs',
      summary: 'Meta Business Solution Provider. Project API for live chat, Campaign API for templates.',
      fields: [
        {
          name: 'mode',
          label: 'API',
          type: 'select',
          required: true,
          options: [
            { value: 'project', label: 'Project API (recommended - supports live replies)' },
            { value: 'campaign', label: 'Campaign API (template campaigns only)' },
          ],
          help:
            'The Campaign API can only fire pre-approved template campaigns, so the bot cannot ' +
            'send free-form replies on it. Use the Project API unless your plan lacks it.',
        },
        {
          name: 'projectId',
          label: 'Project ID',
          type: 'text',
          required: false,
          help: 'Project API only. Found in your AiSensy project URL.',
        },
        {
          name: 'projectApiPassword',
          label: 'Project API Password',
          type: 'secret',
          required: false,
          help: 'Project API only. Sent as the X-AiSensy-Project-API-Pwd header.',
        },
        {
          name: 'apiKey',
          label: 'Campaign API Key',
          type: 'secret',
          required: false,
          help: 'Campaign API only. Generated from Manage → API Key in the AiSensy dashboard.',
        },
        {
          name: 'campaignName',
          label: 'Default Campaign Name',
          type: 'text',
          required: false,
          help: 'Campaign API only. The live campaign used when the bot sends a template.',
        },
        {
          name: 'webhookSigningSecret',
          label: 'Webhook Signing Secret',
          type: 'secret',
          required: false,
          help:
            'The shared secret you configured on the AiSensy webhook. Used to verify the ' +
            'X-AiSensy-Signature header. Leave blank to fall back to the URL token.',
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
        inboundMedia: true,
        signedWebhooks: true,
        connectionStatus: false,
      },
      webhookInstructions:
        'In AiSensy open Manage → Webhooks, paste the URL below (keep the ?token= part) and ' +
        'subscribe to incoming messages and message status. If you set a signing secret there, ' +
        'enter the same value above so signatures can be verified.',
    };
  }

  descriptor(): ProviderDescriptor {
    return AiSensyProvider.descriptor();
  }

  private get mode(): AiSensyMode {
    return this.credential('mode') === 'campaign' ? 'campaign' : 'project';
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  async send(message: OutboundMessage): Promise<SendResult> {
    const to = WhatsAppProvider.msisdn(message.to);
    return this.mode === 'campaign' ? this.sendViaCampaign(message, to) : this.sendViaProject(message, to);
  }

  /** Cloud-API-shaped body; the full message range is available. */
  private async sendViaProject(message: OutboundMessage, to: string): Promise<SendResult> {
    const projectId = this.requireCredential('projectId', 'Project ID');
    const password = this.requireCredential('projectApiPassword', 'Project API Password');

    const { status, data } = await this.request<ProjectSendResponse>({
      method: 'POST',
      url: `${PROJECT_BASE}/${encodeURIComponent(projectId)}/messages`,
      headers: {
        'X-AiSensy-Project-API-Pwd': password,
        'Content-Type': 'application/json',
      },
      data: buildCloudApiBody(message, to),
    });

    if (status >= 400) {
      throw new ProviderError(
        status >= 500 ? 'PROVIDER_ERROR' : 'INVALID_REQUEST',
        `AiSensy rejected the message: ${this.summarise(data) || `HTTP ${status}`}`,
      );
    }

    return { success: true, messageId: data?.messages?.[0]?.id };
  }

  /**
   * Campaign mode can only fire an approved template campaign, so anything else
   * is refused with the standard capability error rather than silently dropped.
   */
  private async sendViaCampaign(message: OutboundMessage, to: string): Promise<SendResult> {
    if (message.type !== 'template') {
      throw new ProviderError(
        'UNSUPPORTED',
        'AiSensy in Campaign API mode can only send approved template campaigns. ' +
          'Switch the account to the Project API to send free-form replies.',
      );
    }

    const apiKey = this.requireCredential('apiKey', 'Campaign API Key');
    const campaignName = message.templateName || this.requireCredential('campaignName', 'Campaign Name');

    const { status, data } = await this.request<CampaignSendResponse>({
      method: 'POST',
      url: CAMPAIGN_URL,
      headers: { 'Content-Type': 'application/json' },
      data: {
        apiKey,
        campaignName,
        destination: to,
        userName: 'GloAro',
        source: 'gloaro-bot',
        templateParams: message.bodyParameters ?? [],
        ...(message.headerParameter?.mediaUrl
          ? { media: { url: message.headerParameter.mediaUrl, filename: 'attachment' } }
          : {}),
      },
    });

    if (status >= 400 || data?.success === false) {
      throw new ProviderError(
        status >= 500 ? 'PROVIDER_ERROR' : 'INVALID_REQUEST',
        `AiSensy rejected the campaign: ${this.summarise(data) || `HTTP ${status}`}`,
      );
    }

    // The Campaign API acknowledges without returning a message id, so there is
    // nothing to correlate later status webhooks against.
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  /**
   * AiSensy publishes no credential-check endpoint, so the test is a real send
   * to the tenant's own business number.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    if (this.mode === 'campaign') {
      // A campaign send would fire a real template at the business's own
      // number and burn a conversation charge, so only the fields are checked.
      const missing = ['apiKey', 'campaignName'].filter((f) => !this.credential(f).trim());
      if (missing.length) {
        return { state: 'ERROR', message: `Campaign mode needs: ${missing.join(', ')}` };
      }
      return {
        state: 'PENDING',
        message:
          'Campaign mode is configured. AiSensy offers no credential-check endpoint and a live ' +
          'test would send a billable template, so the channel is confirmed on the first real send.',
      };
    }

    try {
      const result = await this.send({
        type: 'text',
        to: this.phoneNumber,
        text: 'GloAro connection test - your WhatsApp channel is configured correctly.',
        previewUrl: false,
      });
      return {
        state: 'CONNECTED',
        message: 'AiSensy accepted a test message sent to your own number.',
        details: { messageId: result.messageId ?? '-' },
      };
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'AUTH') {
        return { state: 'ERROR', message: 'AiSensy rejected the Project API password.' };
      }
      return {
        state: 'ERROR',
        message: err instanceof Error ? err.message : 'AiSensy connection test failed',
      };
    }
  }

  // -------------------------------------------------------------------------
  // Webhook
  // -------------------------------------------------------------------------

  /**
   * AiSensy signs each callback with `X-AiSensy-Signature`, an HMAC-SHA256 of
   * the raw body under the secret configured on the webhook. When no signing
   * secret has been entered the per-account URL token is the fallback, so an
   * account is never left with no check at all.
   */
  verifyWebhook(ctx: WebhookVerificationContext): boolean {
    const signingSecret = this.credential('webhookSigningSecret').trim();

    if (signingSecret) {
      const header = ctx.headers['x-aisensy-signature'];
      const signature = (Array.isArray(header) ? header[0] : header) ?? '';
      // Some senders prefix the algorithm; accept both forms.
      const value = signature.includes('=') ? signature.split('=').pop()! : signature;
      return WhatsAppProvider.verifyHmac(ctx.rawBody, signingSecret, value);
    }

    const token = typeof ctx.query?.token === 'string' ? ctx.query.token : '';
    return WhatsAppProvider.safeEqual(this.config.webhookSecret, token);
  }

  parseWebhook(ctx: WebhookVerificationContext): ParsedWebhook {
    if (!ctx.body || typeof ctx.body !== 'object') return EMPTY_WEBHOOK;
    return parseCloudApiWebhook(ctx.body, this.id, this.phoneNumber);
  }
}
