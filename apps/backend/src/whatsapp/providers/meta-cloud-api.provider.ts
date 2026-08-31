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
} from "../provider.types";
import { WhatsAppProvider } from "./provider.base";
import * as crypto from "crypto";

/**
 * Meta's Official WhatsApp Cloud API
 * (https://developers.facebook.com/docs/whatsapp/cloud-api)
 *
 * Connects to Meta's WhatsApp Business Platform using credentials from a
 * Business Account (WABA). Supports templates, interactive messages, and
 * comprehensive delivery status tracking.
 */

const API_BASE_URL = "https://graph.facebook.com/v20.0";

interface MetaMediaObject {
  id?: string;
  type: string;
  media?: {
    image?: { link: string };
    document?: { link: string; filename?: string };
    audio?: { link: string };
    video?: { link: string };
  };
  image?: { link: string };
  document?: { link: string; filename?: string };
  audio?: { link: string };
  video?: { link: string };
}

interface MetaTextMessage {
  messaging_product: "whatsapp";
  to: string;
  type: "text";
  text: {
    /** Meta names this `body`; a `text` key here is rejected outright. */
    body: string;
    preview_url?: boolean;
  };
}

interface MetaImageMessage {
  messaging_product: "whatsapp";
  to: string;
  type: "image";
  image: {
    link: string;
    caption?: string;
  };
}

interface MetaDocumentMessage {
  messaging_product: "whatsapp";
  to: string;
  type: "document";
  document: {
    link: string;
    caption?: string;
    filename?: string;
  };
}

interface MetaAudioMessage {
  messaging_product: "whatsapp";
  to: string;
  type: "audio";
  audio: {
    link: string;
  };
}

interface MetaVideoMessage {
  messaging_product: "whatsapp";
  to: string;
  type: "video";
  video: {
    link: string;
    caption?: string;
  };
}

interface MetaStickerMessage {
  messaging_product: "whatsapp";
  to: string;
  type: "sticker";
  sticker: {
    link: string;
  };
}

interface MetaLocationMessage {
  messaging_product: "whatsapp";
  to: string;
  type: "location";
  location: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
}

interface MetaTemplateParameter {
  type: "text" | "currency" | "date_time" | "image" | "document" | "video";
  text?: string;
  image?: { link: string };
  document?: { link: string };
  video?: { link: string };
  currency?: { fallback_value: string; code: string; amount_1000: number };
  date_time?: { fallback_value: string };
}

interface MetaTemplateMessage {
  messaging_product: "whatsapp";
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components?: Array<{
      type: string;
      parameters?: MetaTemplateParameter[];
    }>;
  };
}

interface MetaButton {
  type: "reply";
  reply: {
    id: string;
    title: string;
  };
}

interface MetaButtonsMessage {
  messaging_product: "whatsapp";
  to: string;
  type: "interactive";
  interactive: {
    type: "button";
    body: { text: string };
    header?: { type: string; text?: string; image?: { link: string } };
    footer?: { text: string };
    action: {
      buttons: MetaButton[];
    };
  };
}

interface MetaListRow {
  id: string;
  title: string;
  description?: string;
}

interface MetaListSection {
  title: string;
  rows: MetaListRow[];
}

interface MetaListMessage {
  messaging_product: "whatsapp";
  to: string;
  type: "interactive";
  interactive: {
    type: "list";
    body: { text: string };
    header?: { type: string; text?: string };
    footer?: { text: string };
    action: {
      button: string;
      sections: MetaListSection[];
    };
  };
}

export type MetaSendRequest =
  | MetaTextMessage
  | MetaImageMessage
  | MetaDocumentMessage
  | MetaAudioMessage
  | MetaVideoMessage
  | MetaStickerMessage
  | MetaLocationMessage
  | MetaTemplateMessage
  | MetaButtonsMessage
  | MetaListMessage;

interface MetaSendResponse {
  messages?: Array<{ id: string }>;
  contacts?: Array<{ input: string; wa_id: string }>;
  error?: {
    message: string;
    type: string;
    code: number;
    error_data?: {
      messaging_product: string;
      details: string;
    };
  };
}

interface MetaWebhookValue {
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: Array<{
    profile: { name: string };
    wa_id: string;
  }>;
  messages?: Array<{
    from: string;
    id: string;
    timestamp?: string;
    type: string;
    text?: { body: string };
    image?: {
      caption?: string;
      mime_type?: string;
      sha256?: string;
      id?: string;
    };
    document?: {
      caption?: string;
      filename?: string;
      mime_type?: string;
      sha256?: string;
      id?: string;
    };
    audio?: { mime_type?: string; sha256?: string; id?: string };
    video?: {
      caption?: string;
      mime_type?: string;
      sha256?: string;
      id?: string;
    };
    sticker?: { mime_type?: string; sha256?: string; id?: string };
    location?: {
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    };
    contacts?: Array<{
      phones?: Array<{ phone?: string }>;
      formatted_name?: string;
    }>;
    button?: { payload: string; text?: string };
    interactive?: {
      type: string;
      button_reply?: { id: string; title: string };
      list_reply?: { id: string; title: string; description?: string };
    };
  }>;
  statuses?: Array<{
    id: string;
    recipient_id: string;
    status: string;
    timestamp?: string;
    errors?: Array<{
      code: number;
      title: string;
      message?: string;
      error_data?: unknown;
    }>;
  }>;
}

interface MetaWebhookEntry {
  id: string;
  changes: Array<{ value: MetaWebhookValue; field: string }>;
}

interface MetaWebhookPayload {
  object: string;
  entry: MetaWebhookEntry[];
}

const INBOUND_TYPE_MAP: Record<string, InboundMessageType> = {
  text: "text",
  // A tapped menu row or button arrives as `interactive` (or `button` for the
  // template quick-reply form), never as text. Leaving these out drops every
  // menu selection on the floor: the bot sends its menu and then appears dead.
  interactive: "interactive",
  button: "button",
  image: "image",
  document: "document",
  audio: "audio",
  video: "video",
  sticker: "sticker",
  location: "location",
  contacts: "contacts",
};

const STATUS_MAP: Record<string, NormalizedStatusEvent["status"]> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

export class MetaCloudApiProvider extends WhatsAppProvider {
  readonly id: WhatsAppProviderId = "META";

  readonly capabilities: ProviderCapabilities = {
    send: [
      "text",
      "image",
      "document",
      "audio",
      "video",
      "sticker",
      "location",
      "template",
      "buttons",
      "list",
    ],
    deliveryStatus: true,
    inboundMedia: true,
    signedWebhooks: true,
    connectionStatus: true,
  };

  static descriptor(): ProviderDescriptor {
    return {
      id: "META",
      label: "Meta WhatsApp Cloud API",
      slug: "meta",
      docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api",
      summary:
        "Official Meta WhatsApp Business Platform. Full feature set including templates, interactive buttons, and comprehensive delivery tracking.",
      fields: [
        {
          name: "phoneNumberId",
          label: "Phone Number ID",
          type: "text",
          required: true,
          placeholder: "1234567890123456",
          help: "The unique identifier for your WhatsApp Business Phone Number. Found in the Meta Business Manager.",
        },
        {
          name: "businessAccountId",
          label: "Business Account ID (WABA)",
          type: "text",
          required: true,
          placeholder: "1234567890123456",
          help: "Your WhatsApp Business Account ID from Meta.",
        },
        {
          name: "accessToken",
          label: "Access Token",
          type: "secret",
          required: true,
          help: "A system user or app access token with whatsapp_business_messaging and business_management permissions. Stored encrypted; never shown again.",
        },
        {
          name: "webhookToken",
          label: "Webhook Verify Token",
          type: "secret",
          required: true,
          help: "A token you generate to verify webhook requests from Meta. This should be a random secure string you create.",
        },
        {
          name: "appSecret",
          label: "App Secret",
          type: "secret",
          required: false,
          help: "Meta App Dashboard > App Settings > Basic > App Secret. Used to verify the X-Hub-Signature-256 on every inbound webhook.",
        },
      ],
      capabilities: {
        send: [
          "text",
          "image",
          "document",
          "audio",
          "video",
          "sticker",
          "location",
          "template",
          "buttons",
          "list",
        ],
        deliveryStatus: true,
        inboundMedia: true,
        signedWebhooks: true,
        connectionStatus: true,
      },
      webhookInstructions:
        "In the Meta App Dashboard, go to App Roles → System Users and create a system user with " +
        "whatsapp_business_messaging and business_management permissions. " +
        "Then configure the webhook URL below and verify token in your app settings. " +
        "Subscribe to messages and message_status webhook fields.",
    };
  }

  descriptor(): ProviderDescriptor {
    return MetaCloudApiProvider.descriptor();
  }

  private get phoneNumberId(): string {
    return this.requireCredential("phoneNumberId", "Phone Number ID");
  }

  private get businessAccountId(): string {
    return this.requireCredential("businessAccountId", "Business Account ID");
  }

  private get accessToken(): string {
    return this.requireCredential("accessToken", "Access Token");
  }

  private get webhookToken(): string {
    return this.requireCredential("webhookToken", "Webhook Verify Token");
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  async send(message: OutboundMessage): Promise<SendResult> {
    const to = WhatsAppProvider.msisdn(message.to);
    const request = this.buildSendRequest(message, to);

    const { status, data } = await this.request<MetaSendResponse>({
      method: "POST",
      url: `${API_BASE_URL}/${this.phoneNumberId}/messages`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      data: request,
    });

    // Meta returns 200 on success with { messages: [{ id }], contacts: [...] }
    if (status >= 400) {
      const reason = data?.error?.message || `HTTP ${status}`;
      throw new ProviderError(
        status >= 500
          ? "PROVIDER_ERROR"
          : status === 429
            ? "RATE_LIMITED"
            : "INVALID_REQUEST",
        `Meta rejected the message: ${reason}`,
      );
    }

    const messageId = data?.messages?.[0]?.id;
    if (!messageId) {
      throw new ProviderError(
        "PROVIDER_ERROR",
        "Meta did not return a message ID",
      );
    }

    return { success: true, messageId };
  }

  private buildSendRequest(
    message: OutboundMessage,
    to: string,
  ): MetaSendRequest {
    switch (message.type) {
      case "text":
        return {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: {
            body: message.text,
            preview_url: message.previewUrl,
          },
        };

      case "image":
        return {
          messaging_product: "whatsapp",
          to,
          type: "image",
          image: {
            link: message.mediaUrl,
            caption: message.caption,
          },
        };

      case "document":
        return {
          messaging_product: "whatsapp",
          to,
          type: "document",
          document: {
            link: message.mediaUrl,
            caption: message.caption,
            filename: message.filename,
          },
        };

      case "audio":
        return {
          messaging_product: "whatsapp",
          to,
          type: "audio",
          audio: {
            link: message.mediaUrl,
          },
        };

      case "video":
        return {
          messaging_product: "whatsapp",
          to,
          type: "video",
          video: {
            link: message.mediaUrl,
            caption: message.caption,
          },
        };

      case "sticker":
        return {
          messaging_product: "whatsapp",
          to,
          type: "sticker",
          sticker: {
            link: message.mediaUrl,
          },
        };

      case "location":
        return {
          messaging_product: "whatsapp",
          to,
          type: "location",
          location: {
            latitude: message.latitude,
            longitude: message.longitude,
            name: message.name,
            address: message.address,
          },
        };

      case "template":
        return {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: message.templateName,
            language: { code: message.languageCode },
            components: this.buildTemplateComponents(message),
          },
        };

      case "buttons":
        return {
          messaging_product: "whatsapp",
          to,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: message.text },
            header: message.header
              ? { type: "text", text: message.header }
              : undefined,
            footer: message.footer ? { text: message.footer } : undefined,
            action: {
              buttons: message.buttons.map((btn) => ({
                type: "reply",
                reply: {
                  id: btn.id,
                  title: btn.title,
                },
              })),
            },
          },
        };

      case "list":
        return {
          messaging_product: "whatsapp",
          to,
          type: "interactive",
          interactive: {
            type: "list",
            body: { text: message.text },
            header: message.header
              ? { type: "text", text: message.header }
              : undefined,
            footer: message.footer ? { text: message.footer } : undefined,
            action: {
              button: message.buttonText,
              sections: message.sections,
            },
          },
        };

      default:
        return this.unsupported(message);
    }
  }

  private buildTemplateComponents(
    message: any,
  ): Array<{ type: string; parameters?: MetaTemplateParameter[] }> | undefined {
    if (
      !message.bodyParameters?.length &&
      !message.headerParameter &&
      !message.buttonParameters?.length
    ) {
      return undefined;
    }

    const components: Array<{
      type: string;
      parameters?: MetaTemplateParameter[];
    }> = [];

    if (message.headerParameter) {
      components.push({
        type: "header",
        parameters: [
          {
            type: message.headerParameter.type,
            ...(message.headerParameter.type === "text" && {
              text: message.headerParameter.text,
            }),
            ...(["image", "document", "video"].includes(
              message.headerParameter.type,
            ) && {
              [message.headerParameter.type]: {
                link: message.headerParameter.mediaUrl,
              },
            }),
          },
        ],
      });
    }

    if (message.bodyParameters?.length) {
      components.push({
        type: "body",
        parameters: message.bodyParameters.map((text: string) => ({
          type: "text",
          text,
        })),
      });
    }

    if (message.buttonParameters?.length) {
      components.push({
        type: "button",
        parameters: message.buttonParameters.map((text: string) => ({
          type: "text",
          text,
        })),
      });
    }

    return components.length > 0 ? components : undefined;
  }

  // -------------------------------------------------------------------------
  // Connection Testing
  // -------------------------------------------------------------------------

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const { status, data } = await this.request<any>({
        method: "GET",
        url: `${API_BASE_URL}/${this.phoneNumberId}`,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (status >= 400) {
        return {
          state: "DISCONNECTED",
          message: `Failed to connect to Meta: ${data?.error?.message || `HTTP ${status}`}`,
          details: { error: data?.error?.message },
        };
      }

      return {
        state: "CONNECTED",
        message: "Successfully connected to Meta WhatsApp Cloud API.",
        details: {
          phoneNumberId: this.phoneNumberId,
          displayPhoneNumber: data.display_phone_number,
        },
      };
    } catch (error) {
      return {
        state: "DISCONNECTED",
        message: `Connection test failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        details: {},
      };
    }
  }

  // -------------------------------------------------------------------------
  // Webhook
  // -------------------------------------------------------------------------

  verifyWebhook(ctx: WebhookVerificationContext): boolean {
    // Meta's GET handshake carries the verify token we gave it in the app
    // dashboard; the POST callbacks carry no token at all, only a signature.
    const verifyToken =
      typeof ctx.query?.["hub.verify_token"] === "string"
        ? ctx.query["hub.verify_token"]
        : "";
    if (verifyToken && WhatsAppProvider.safeEqual(verifyToken, this.webhookToken)) {
      return true;
    }

    // Meta signs the exact bytes it sent with the *app secret*, not with the
    // per-account webhook secret. Only checkable when the app secret is set.
    const signature =
      typeof ctx.headers["x-hub-signature-256"] === "string"
        ? ctx.headers["x-hub-signature-256"]
        : "";
    const appSecret = this.config.credentials.appSecret;
    if (signature && appSecret) {
      const expected = `sha256=${crypto
        .createHmac("sha256", appSecret)
        .update(ctx.rawBody)
        .digest("hex")}`;
      if (WhatsAppProvider.safeEqual(signature, expected)) return true;
    }

    // Fallback shared by every adapter: the `?token=` the callback URL carries.
    const token = typeof ctx.query?.token === "string" ? ctx.query.token : "";
    return WhatsAppProvider.safeEqual(this.config.webhookSecret, token);
  }

  parseWebhook(ctx: WebhookVerificationContext): ParsedWebhook {
    const payload = ctx.body as MetaWebhookPayload | undefined;
    if (!payload?.entry) return EMPTY_WEBHOOK;

    const messages: ParsedInboundMessage[] = [];
    const statuses: NormalizedStatusEvent[] = [];

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const { value } = change;

        // Inbound messages
        if (value.messages) {
          for (const msg of value.messages) {
            const inboundType = INBOUND_TYPE_MAP[msg.type];
            if (!inboundType) continue;

            const parsed = this.parseInboundMessage(msg, inboundType, value);
            if (parsed) {
              messages.push(parsed);
            }
          }
        }

        // Status updates
        if (value.statuses) {
          for (const status of value.statuses) {
            const mappedStatus = STATUS_MAP[status.status?.toLowerCase() ?? ""];
            if (!mappedStatus) continue;

            statuses.push({
              provider: this.id,
              messageId: status.id,
              recipientNumber: status.recipient_id,
              status: mappedStatus,
              timestamp: status.timestamp
                ? new Date(parseInt(status.timestamp) * 1000)
                : new Date(),
              error: status.errors?.[0]?.message,
              raw: status,
            });
          }
        }
      }
    }

    return { messages, statuses };
  }

  private parseInboundMessage(
    msg: any,
    inboundType: InboundMessageType,
    value: MetaWebhookValue,
  ): ParsedInboundMessage | null {
    const customerNumber = msg.from;
    const messageId = msg.id;
    const timestamp = msg.timestamp
      ? new Date(parseInt(msg.timestamp) * 1000)
      : new Date();
    const profileName = value.contacts?.[0]?.profile?.name;

    switch (inboundType) {
      case "text":
        return {
          messageId,
          customerNumber,
          timestamp,
          messageType: "text",
          messageText: msg.text?.body ?? "",
          profileName,
          phoneNumber: this.phoneNumber,
          provider: this.id,
          raw: msg,
        };

      // The engine matches on `replyId` first and falls back to the visible
      // title, so both must be carried through for a menu to work.
      case "interactive": {
        const reply =
          msg.interactive?.button_reply ?? msg.interactive?.list_reply;
        return {
          messageId,
          customerNumber,
          timestamp,
          messageType: "interactive",
          messageText: reply?.title ?? reply?.id ?? "",
          replyId: reply?.id,
          profileName,
          phoneNumber: this.phoneNumber,
          provider: this.id,
          raw: msg,
        };
      }

      case "button":
        return {
          messageId,
          customerNumber,
          timestamp,
          messageType: "button",
          messageText: msg.button?.text ?? msg.button?.payload ?? "",
          replyId: msg.button?.payload,
          profileName,
          phoneNumber: this.phoneNumber,
          provider: this.id,
          raw: msg,
        };

      case "image":
        return {
          messageId,
          customerNumber,
          timestamp,
          messageType: "image",
          messageText: msg.image?.caption ?? "[Image]",
          mediaUrl: `${API_BASE_URL}/${msg.image?.id}`,
          caption: msg.image?.caption,
          profileName,
          phoneNumber: this.phoneNumber,
          provider: this.id,
          raw: msg,
        };

      case "document":
        return {
          messageId,
          customerNumber,
          timestamp,
          messageType: "document",
          messageText: msg.document?.filename ?? "[Document]",
          mediaUrl: `${API_BASE_URL}/${msg.document?.id}`,
          caption: msg.document?.caption,
          profileName,
          phoneNumber: this.phoneNumber,
          provider: this.id,
          raw: msg,
        };

      case "audio":
        return {
          messageId,
          customerNumber,
          timestamp,
          messageType: "audio",
          messageText: "[Audio message]",
          mediaUrl: `${API_BASE_URL}/${msg.audio?.id}`,
          profileName,
          phoneNumber: this.phoneNumber,
          provider: this.id,
          raw: msg,
        };

      case "video":
        return {
          messageId,
          customerNumber,
          timestamp,
          messageType: "video",
          messageText: msg.video?.caption ?? "[Video]",
          mediaUrl: `${API_BASE_URL}/${msg.video?.id}`,
          caption: msg.video?.caption,
          profileName,
          phoneNumber: this.phoneNumber,
          provider: this.id,
          raw: msg,
        };

      case "sticker":
        return {
          messageId,
          customerNumber,
          timestamp,
          messageType: "sticker",
          messageText: "[Sticker]",
          mediaUrl: `${API_BASE_URL}/${msg.sticker?.id}`,
          profileName,
          phoneNumber: this.phoneNumber,
          provider: this.id,
          raw: msg,
        };

      case "location":
        return {
          messageId,
          customerNumber,
          timestamp,
          messageType: "location",
          messageText:
            msg.location?.name ??
            `${msg.location?.latitude}, ${msg.location?.longitude}`,
          profileName,
          phoneNumber: this.phoneNumber,
          provider: this.id,
          raw: msg,
        };

      case "contacts":
        const contactName = msg.contacts?.[0]?.formatted_name ?? "[Contact]";
        return {
          messageId,
          customerNumber,
          timestamp,
          messageType: "contacts",
          messageText: contactName,
          profileName,
          phoneNumber: this.phoneNumber,
          provider: this.id,
          raw: msg,
        };

      default:
        return null;
    }
  }
}
