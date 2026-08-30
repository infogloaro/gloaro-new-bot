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
 * UltraMsg (https://docs.ultramsg.com).
 *
 * A device-linked gateway rather than a Meta Business Solution Provider: there
 * is no WABA, no template approval and no interactive-message support, but also
 * no 24-hour session window. Every call is
 * `POST https://api.ultramsg.com/{instance}/messages/{kind}` with the token in
 * the body.
 *
 * UltraMsg does not sign its webhooks, so the callback URL carries a
 * per-account secret in `?token=` and that is what authenticates the request.
 */

const BASE_URL = 'https://api.ultramsg.com';

interface UltraMsgSendResponse {
  sent?: string | boolean;
  message?: string;
  id?: string | number;
  error?: unknown;
}

interface UltraMsgWebhookBody {
  event_type?: string;
  instanceId?: string | number;
  referenceId?: string;
  data?: {
    id?: string;
    from?: string;
    to?: string;
    author?: string;
    pushname?: string;
    ack?: string;
    type?: string;
    body?: string;
    media?: string;
    mimetype?: string;
    caption?: string;
    fromMe?: boolean;
    time?: number;
  };
}

/** UltraMsg `data.type` -> our inbound taxonomy. */
const INBOUND_TYPE_MAP: Record<string, InboundMessageType> = {
  chat: 'text',
  image: 'image',
  document: 'document',
  audio: 'audio',
  ptt: 'audio',
  video: 'video',
  sticker: 'sticker',
  location: 'location',
  vcard: 'contacts',
};

/** `message_ack` reports the WhatsApp ack word. */
const ACK_MAP: Record<string, NormalizedStatusEvent['status']> = {
  server: 'SENT',
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  played: 'READ',
  error: 'FAILED',
  failed: 'FAILED',
};

export class UltraMsgProvider extends WhatsAppProvider {
  readonly id: WhatsAppProviderId = 'ULTRAMSG';

  readonly capabilities: ProviderCapabilities = {
    // No templates and no interactive messages: UltraMsg drives a linked
    // device, and WhatsApp does not expose those to that channel.
    send: ['text', 'image', 'document', 'audio', 'video', 'sticker', 'location'],
    deliveryStatus: true,
    inboundMedia: true,
    signedWebhooks: false,
    connectionStatus: true,
  };

  static descriptor(): ProviderDescriptor {
    return {
      id: 'ULTRAMSG',
      label: 'UltraMsg',
      slug: 'ultramsg',
      docsUrl: 'https://docs.ultramsg.com',
      summary: 'Device-linked gateway. Fast to set up, no template approval, no interactive buttons.',
      fields: [
        {
          name: 'instanceId',
          label: 'Instance ID',
          type: 'text',
          required: true,
          placeholder: 'instance12345',
          help: 'Shown on the Instances page of your UltraMsg dashboard.',
        },
        {
          name: 'token',
          label: 'Token',
          type: 'secret',
          required: true,
          help: 'The instance token from the same page. Stored encrypted; never shown again.',
        },
      ],
      capabilities: {
        send: ['text', 'image', 'document', 'audio', 'video', 'sticker', 'location'],
        deliveryStatus: true,
        inboundMedia: true,
        signedWebhooks: false,
        connectionStatus: true,
      },
      webhookInstructions:
        'In the UltraMsg dashboard open Instance → Settings, paste the webhook URL below ' +
        '(the ?token= part is required), and enable "Message Received" and "Message Ack".',
    };
  }

  descriptor(): ProviderDescriptor {
    return UltraMsgProvider.descriptor();
  }

  private get instanceId(): string {
    return this.requireCredential('instanceId', 'Instance ID');
  }

  private get token(): string {
    return this.requireCredential('token', 'Token');
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  async send(message: OutboundMessage): Promise<SendResult> {
    const to = WhatsAppProvider.msisdn(message.to);
    const { endpoint, body } = this.buildRequest(message, to);

    const { status, data } = await this.request<UltraMsgSendResponse>({
      method: 'POST',
      url: `${BASE_URL}/${this.instanceId}/messages/${endpoint}`,
      headers: { 'Content-Type': 'application/json' },
      data: { token: this.token, to, ...body },
    });

    // UltraMsg answers 200 with `sent: "false"` for business-level rejections,
    // so the status code alone is not enough to call it a success.
    const sent = data?.sent === true || data?.sent === 'true';
    if (status >= 400 || !sent) {
      const reason = this.summarise(data?.error ?? data?.message ?? data) || `HTTP ${status}`;
      throw new ProviderError(
        status >= 500 ? 'PROVIDER_ERROR' : 'INVALID_REQUEST',
        `UltraMsg rejected the message: ${reason}`,
      );
    }

    return { success: true, messageId: data?.id != null ? String(data.id) : undefined };
  }

  /** Maps one provider-independent message onto UltraMsg's per-kind endpoints. */
  private buildRequest(
    message: OutboundMessage,
    to: string,
  ): { endpoint: string; body: Record<string, unknown> } {
    switch (message.type) {
      case 'text':
        return { endpoint: 'chat', body: { body: message.text, priority: 1 } };

      case 'image':
        return {
          endpoint: 'image',
          body: { image: message.mediaUrl, caption: message.caption ?? '' },
        };

      case 'document':
        return {
          endpoint: 'document',
          body: {
            document: message.mediaUrl,
            filename: message.filename ?? 'document',
            caption: message.caption ?? '',
          },
        };

      case 'audio':
        return { endpoint: 'audio', body: { audio: message.mediaUrl } };

      case 'video':
        return {
          endpoint: 'video',
          body: { video: message.mediaUrl, caption: message.caption ?? '' },
        };

      case 'sticker':
        return { endpoint: 'sticker', body: { sticker: message.mediaUrl } };

      case 'location':
        return {
          endpoint: 'location',
          body: {
            address: message.address ?? message.name ?? '',
            lat: message.latitude,
            lng: message.longitude,
          },
        };

      default:
        return this.unsupported(message);
    }
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async testConnection(): Promise<ConnectionTestResult> {
    const { status, data } = await this.request<{
      status?: { accountStatus?: { status?: string; substatus?: string } };
      error?: unknown;
    }>({
      method: 'GET',
      url: `${BASE_URL}/${this.instanceId}/instance/status`,
      params: { token: this.token },
    });

    if (status >= 400) {
      return {
        state: 'ERROR',
        message: this.summarise(data) || `UltraMsg returned HTTP ${status}`,
      };
    }

    const accountStatus = data?.status?.accountStatus?.status ?? 'unknown';
    const substatus = data?.status?.accountStatus?.substatus ?? '';

    if (accountStatus === 'authenticated') {
      return {
        state: 'CONNECTED',
        message: 'Instance is authenticated and ready to send.',
        details: { accountStatus, substatus },
      };
    }

    return {
      state: accountStatus === 'got qr code' ? 'PENDING' : 'DISCONNECTED',
      message:
        accountStatus === 'got qr code'
          ? 'Instance is waiting for the QR code to be scanned in the UltraMsg dashboard.'
          : `Instance is not authenticated (status: ${accountStatus}).`,
      details: { accountStatus, substatus },
    };
  }

  // -------------------------------------------------------------------------
  // Webhook
  // -------------------------------------------------------------------------

  /**
   * UltraMsg sends no signature, so the only proof the request is genuine is
   * the per-account secret embedded in the callback URL.
   */
  verifyWebhook(ctx: WebhookVerificationContext): boolean {
    const token = typeof ctx.query?.token === 'string' ? ctx.query.token : '';
    return WhatsAppProvider.safeEqual(this.config.webhookSecret, token);
  }

  parseWebhook(ctx: WebhookVerificationContext): ParsedWebhook {
    const body = ctx.body as UltraMsgWebhookBody | undefined;
    const data = body?.data;
    if (!data?.id) return EMPTY_WEBHOOK;

    // Our own outbound messages come back as `message_create` with fromMe:true.
    // Feeding those to the engine would make the bot answer itself.
    if (data.fromMe) return EMPTY_WEBHOOK;

    if (body?.event_type === 'message_ack') {
      const mapped = ACK_MAP[String(data.ack ?? '').toLowerCase()];
      if (!mapped) return EMPTY_WEBHOOK;
      return {
        messages: [],
        statuses: [
          {
            provider: this.id,
            messageId: data.id,
            status: mapped,
            recipientNumber: UltraMsgProvider.chatIdToNumber(data.to),
            timestamp: UltraMsgProvider.toDate(data.time),
            raw: body,
          },
        ],
      };
    }

    if (body?.event_type !== 'message_received') return EMPTY_WEBHOOK;

    const customerNumber = UltraMsgProvider.chatIdToNumber(data.from);
    if (!customerNumber) return EMPTY_WEBHOOK;

    const messageType = INBOUND_TYPE_MAP[data.type ?? 'chat'] ?? 'unsupported';
    const isMedia = ['image', 'document', 'audio', 'video', 'sticker'].includes(messageType);

    const parsed: ParsedInboundMessage = {
      provider: this.id,
      phoneNumber: UltraMsgProvider.chatIdToNumber(data.to) || this.phoneNumber,
      customerNumber,
      messageId: data.id,
      messageType,
      // For media UltraMsg puts the URL in `body` and the text in `caption`.
      messageText: isMedia ? (data.caption ?? '') : (data.body ?? ''),
      timestamp: UltraMsgProvider.toDate(data.time),
      profileName: data.pushname || undefined,
      mediaUrl: isMedia ? (data.media || data.body || undefined) : undefined,
      mediaMimeType: data.mimetype || undefined,
      caption: data.caption || undefined,
      raw: body,
    };

    return { messages: [parsed], statuses: [] };
  }

  /** UltraMsg addresses chats as `919876543210@c.us` (or `@g.us` for groups). */
  private static chatIdToNumber(chatId: string | undefined): string {
    if (!chatId) return '';
    // Group messages are out of scope - the bot only handles 1:1 chats.
    if (chatId.endsWith('@g.us')) return '';
    return chatId.split('@')[0].replace(/\D/g, '');
  }

  private static toDate(seconds: number | undefined): Date {
    return Number.isFinite(seconds) && (seconds as number) > 0
      ? new Date((seconds as number) * 1000)
      : new Date();
  }
}
