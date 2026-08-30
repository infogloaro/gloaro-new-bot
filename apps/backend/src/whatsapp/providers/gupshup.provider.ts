import {
  ConnectionTestResult,
  EMPTY_WEBHOOK,
  InboundMessageType,
  NormalizedStatusEvent,
  OutboundMessage,
  ParsedInboundMessage,
  ParsedWebhook,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderError,
  SendResult,
  WebhookVerificationContext,
  WhatsAppProviderId,
} from '../provider.types';
import { WhatsAppProvider } from './provider.base';

/**
 * Gupshup WhatsApp Business API (https://docs.gupshup.io).
 *
 * Form-encoded rather than JSON: `message` is a JSON *string* inside an
 * `application/x-www-form-urlencoded` body, authenticated with an `apikey`
 * header. Session messages go to `/wa/api/v1/msg`; approved templates go to
 * `/wa/api/v1/template/msg`.
 *
 * Gupshup does not sign its callbacks, so the URL carries a per-account secret
 * in `?token=` and that is what authenticates the request.
 */

const SEND_URL = 'https://api.gupshup.io/wa/api/v1/msg';
const TEMPLATE_URL = 'https://api.gupshup.io/wa/api/v1/template/msg';

interface GupshupSendResponse {
  status?: string;
  messageId?: string;
  message?: string;
}

interface GupshupInboundBody {
  app?: string;
  timestamp?: number;
  version?: number;
  type?: string;
  payload?: {
    id?: string;
    gsId?: string;
    source?: string;
    type?: string;
    destination?: string;
    sender?: { phone?: string; name?: string };
    payload?: Record<string, unknown>;
  };
}

/** Gupshup `payload.type` -> our inbound taxonomy. */
const INBOUND_TYPE_MAP: Record<string, InboundMessageType> = {
  text: 'text',
  image: 'image',
  file: 'document',
  audio: 'audio',
  voice: 'audio',
  video: 'video',
  sticker: 'sticker',
  location: 'location',
  contact: 'contacts',
  button_reply: 'interactive',
  list_reply: 'interactive',
  quick_reply: 'interactive',
};

const STATUS_MAP: Record<string, NormalizedStatusEvent['status']> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

export class GupshupProvider extends WhatsAppProvider {
  readonly id: WhatsAppProviderId = 'GUPSHUP';

  readonly capabilities: ProviderCapabilities = {
    send: ['text', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'template', 'buttons', 'list'],
    deliveryStatus: true,
    inboundMedia: true,
    signedWebhooks: false,
    connectionStatus: false,
  };

  static descriptor(): ProviderDescriptor {
    return {
      id: 'GUPSHUP',
      label: 'Gupshup',
      slug: 'gupshup',
      docsUrl: 'https://docs.gupshup.io/docs/send-message',
      summary: 'Meta Business Solution Provider. Full template, list and button support.',
      fields: [
        {
          name: 'apiKey',
          label: 'API Key',
          type: 'secret',
          required: true,
          help: 'Gupshup dashboard → Profile → API key. Stored encrypted; never shown again.',
        },
        {
          name: 'appName',
          label: 'App Name',
          type: 'text',
          required: true,
          placeholder: 'MyGloaroApp',
          help: 'The Gupshup app name, sent as src.name. Also used to route inbound webhooks.',
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
        signedWebhooks: false,
        connectionStatus: false,
      },
      webhookInstructions:
        'In the Gupshup dashboard open your app → Webhook / Callback URL, paste the URL below ' +
        '(keep the ?token= part) and subscribe to both inbound messages and message events. ' +
        'Gupshup has no connection-status endpoint, so "Test connection" sends a short WhatsApp ' +
        'message to your own business number to prove the credentials work end to end.',
    };
  }

  descriptor(): ProviderDescriptor {
    return GupshupProvider.descriptor();
  }

  private get apiKey(): string {
    return this.requireCredential('apiKey', 'API Key');
  }

  private get appName(): string {
    return this.requireCredential('appName', 'App Name');
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  async send(message: OutboundMessage): Promise<SendResult> {
    const to = WhatsAppProvider.msisdn(message.to);

    const form = new URLSearchParams({
      channel: 'whatsapp',
      source: this.phoneNumber,
      destination: to,
      'src.name': this.appName,
    });

    let url = SEND_URL;
    if (message.type === 'template') {
      url = TEMPLATE_URL;
      form.set(
        'template',
        JSON.stringify({
          id: message.templateName,
          params: message.bodyParameters ?? [],
        }),
      );
      if (message.headerParameter?.mediaUrl) {
        form.set(
          'message',
          JSON.stringify({
            type: message.headerParameter.type === 'document' ? 'document' : 'image',
            [message.headerParameter.type === 'document' ? 'url' : 'originalUrl']:
              message.headerParameter.mediaUrl,
            ...(message.headerParameter.type === 'image'
              ? { previewUrl: message.headerParameter.mediaUrl }
              : {}),
          }),
        );
      }
    } else {
      form.set('message', JSON.stringify(this.buildMessagePayload(message)));
    }

    const { status, data } = await this.request<GupshupSendResponse>({
      method: 'POST',
      url,
      headers: {
        apikey: this.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: form.toString(),
    });

    if (status >= 400 || (data?.status && data.status !== 'submitted')) {
      throw new ProviderError(
        status >= 500 ? 'PROVIDER_ERROR' : 'INVALID_REQUEST',
        `Gupshup rejected the message: ${this.summarise(data) || `HTTP ${status}`}`,
      );
    }

    return { success: true, messageId: data?.messageId };
  }

  /** Builds the object that goes into the `message` form field. */
  private buildMessagePayload(message: OutboundMessage): Record<string, unknown> {
    switch (message.type) {
      case 'text':
        return { type: 'text', text: message.text, previewUrl: message.previewUrl ?? true };

      case 'image':
        return {
          type: 'image',
          originalUrl: message.mediaUrl,
          previewUrl: message.mediaUrl,
          ...(message.caption ? { caption: message.caption } : {}),
        };

      case 'document':
        return {
          type: 'file',
          url: message.mediaUrl,
          filename: message.filename ?? 'document',
        };

      case 'audio':
        return { type: 'audio', url: message.mediaUrl };

      case 'video':
        return {
          type: 'video',
          url: message.mediaUrl,
          ...(message.caption ? { caption: message.caption } : {}),
        };

      case 'sticker':
        return { type: 'sticker', url: message.mediaUrl };

      case 'location':
        return {
          type: 'location',
          longitude: message.longitude,
          latitude: message.latitude,
          name: message.name ?? '',
          address: message.address ?? '',
        };

      case 'buttons':
        if (!message.buttons.length) {
          throw new ProviderError('INVALID_REQUEST', 'A buttons message needs at least one button');
        }
        return {
          type: 'quick_reply',
          msgid: `qr_${Date.now()}`,
          content: {
            type: 'text',
            ...(message.header ? { header: message.header } : {}),
            text: message.text,
            ...(message.footer ? { caption: message.footer } : {}),
          },
          // WhatsApp allows at most 3 quick replies.
          options: message.buttons.slice(0, 3).map((b) => ({ type: 'text', title: b.title })),
        };

      case 'list':
        if (!message.sections.length) {
          throw new ProviderError('INVALID_REQUEST', 'A list message needs at least one section');
        }
        return {
          type: 'list',
          title: message.header ?? '',
          body: message.text,
          footer: message.footer ?? '',
          msgid: `list_${Date.now()}`,
          globalButtons: [{ type: 'text', title: message.buttonText }],
          items: message.sections.slice(0, 10).map((section) => ({
            title: section.title,
            subtitle: section.title,
            options: section.rows.slice(0, 10).map((row) => ({
              type: 'text',
              title: row.title,
              description: row.description ?? '',
              postbackText: row.id,
            })),
          })),
        };

      default:
        return this.unsupported(message);
    }
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  /**
   * Gupshup publishes no credential-check endpoint, so the connection test is
   * a real send to the tenant's own business number. It proves the api key, the
   * app name and the source number all line up - which is exactly what a
   * misconfigured account gets wrong.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const result = await this.send({
        type: 'text',
        to: this.phoneNumber,
        text: 'GloAro connection test - your WhatsApp channel is configured correctly.',
        previewUrl: false,
      });
      return {
        state: 'CONNECTED',
        message: 'Gupshup accepted a test message sent to your own number.',
        details: { app: this.appName, messageId: result.messageId ?? '-' },
      };
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'AUTH') {
        return { state: 'ERROR', message: 'Gupshup rejected the API key.' };
      }
      return {
        state: 'ERROR',
        message: err instanceof Error ? err.message : 'Gupshup connection test failed',
      };
    }
  }

  // -------------------------------------------------------------------------
  // Webhook
  // -------------------------------------------------------------------------

  verifyWebhook(ctx: WebhookVerificationContext): boolean {
    const token = typeof ctx.query?.token === 'string' ? ctx.query.token : '';
    return WhatsAppProvider.safeEqual(this.config.webhookSecret, token);
  }

  parseWebhook(ctx: WebhookVerificationContext): ParsedWebhook {
    const body = ctx.body as GupshupInboundBody | undefined;
    const payload = body?.payload;
    if (!payload?.id) return EMPTY_WEBHOOK;

    if (body?.type === 'message-event') {
      const mapped = STATUS_MAP[String(payload.type ?? '').toLowerCase()];
      // `enqueued` is not a delivery state we track.
      if (!mapped) return EMPTY_WEBHOOK;
      const detail = payload.payload as { code?: number; reason?: string } | undefined;
      return {
        messages: [],
        statuses: [
          {
            provider: this.id,
            messageId: payload.id,
            status: mapped,
            recipientNumber: (payload.destination ?? '').replace(/\D/g, '') || undefined,
            error:
              mapped === 'FAILED'
                ? `[${detail?.code ?? '-'}] ${detail?.reason ?? 'failed'}`
                : undefined,
            timestamp: GupshupProvider.toDate(body.timestamp),
            raw: body,
          },
        ],
      };
    }

    if (body?.type !== 'message') return EMPTY_WEBHOOK;

    const customerNumber = (payload.sender?.phone ?? payload.source ?? '').replace(/\D/g, '');
    if (!customerNumber) return EMPTY_WEBHOOK;

    const inner = (payload.payload ?? {}) as Record<string, unknown>;
    const messageType = INBOUND_TYPE_MAP[payload.type ?? 'text'] ?? 'unsupported';

    const parsed: ParsedInboundMessage = {
      provider: this.id,
      phoneNumber: (payload.destination ?? '').replace(/\D/g, '') || this.phoneNumber,
      customerNumber,
      messageId: payload.id,
      messageType,
      messageText: GupshupProvider.textOf(payload.type ?? 'text', inner),
      timestamp: GupshupProvider.toDate(body.timestamp),
      profileName: payload.sender?.name || undefined,
      replyId:
        (inner.selectedButtonId as string) ?? (inner.selectedListId as string) ?? undefined,
      mediaUrl: typeof inner.url === 'string' ? inner.url : undefined,
      mediaMimeType: typeof inner.contentType === 'string' ? inner.contentType : undefined,
      caption: typeof inner.caption === 'string' ? inner.caption : undefined,
      raw: body,
    };

    return { messages: [parsed], statuses: [] };
  }

  /** Whatever the engine should match this message against. */
  private static textOf(type: string, inner: Record<string, unknown>): string {
    switch (type) {
      case 'text':
        return (inner.text as string) ?? '';
      case 'button_reply':
      case 'quick_reply':
        return (inner.selectedButtonText as string) ?? (inner.selectedButtonId as string) ?? '';
      case 'list_reply':
        return (inner.selectedListItemText as string) ?? (inner.selectedListId as string) ?? '';
      case 'location':
        return (inner.name as string) ?? (inner.address as string) ?? '';
      default:
        return (inner.caption as string) ?? '';
    }
  }

  private static toDate(ms: number | undefined): Date {
    return Number.isFinite(ms) && (ms as number) > 0 ? new Date(ms as number) : new Date();
  }
}
