/**
 * Shared translation for the providers that speak the WhatsApp Cloud API
 * dialect on the wire - 360dialog's `waba-v2` endpoint and AiSensy's Project
 * API. Both accept Meta-shaped request bodies and forward Meta-shaped webhooks,
 * so the mapping lives here once instead of in each adapter.
 *
 * This is a payload-shape convenience only. Neither adapter talks to Meta, and
 * adding a real MetaCloudAPIProvider later would reuse these same helpers.
 */
import {
  InboundMessageType,
  NormalizedStatusEvent,
  OutboundMessage,
  ParsedInboundMessage,
  ParsedWebhook,
  ProviderError,
  WhatsAppProviderId,
} from '../provider.types';

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

/** Interactive bodies are capped by WhatsApp itself; trim rather than get a 400. */
const LIMITS = {
  buttonTitle: 20,
  rowTitle: 24,
  rowDescription: 72,
  listButton: 20,
  header: 60,
  footer: 60,
  body: 1024,
};

const clip = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;

/** Builds the JSON body for `POST /messages`. */
export function buildCloudApiBody(message: OutboundMessage, to: string): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };

  switch (message.type) {
    case 'text':
      return {
        ...base,
        type: 'text',
        text: { preview_url: message.previewUrl ?? true, body: message.text },
      };

    case 'image':
    case 'audio':
    case 'video':
    case 'sticker':
      return {
        ...base,
        type: message.type,
        [message.type]: {
          link: message.mediaUrl,
          // Stickers and audio reject a caption.
          ...(message.caption && message.type !== 'sticker' && message.type !== 'audio'
            ? { caption: message.caption }
            : {}),
        },
      };

    case 'document':
      return {
        ...base,
        type: 'document',
        document: {
          link: message.mediaUrl,
          ...(message.filename ? { filename: message.filename } : {}),
          ...(message.caption ? { caption: message.caption } : {}),
        },
      };

    case 'location':
      return {
        ...base,
        type: 'location',
        location: {
          latitude: message.latitude,
          longitude: message.longitude,
          ...(message.name ? { name: message.name } : {}),
          ...(message.address ? { address: message.address } : {}),
        },
      };

    case 'template': {
      const components: Array<Record<string, unknown>> = [];

      if (message.headerParameter) {
        const p = message.headerParameter;
        components.push({
          type: 'header',
          parameters: [
            p.type === 'text'
              ? { type: 'text', text: p.text ?? '' }
              : { type: p.type, [p.type]: { link: p.mediaUrl } },
          ],
        });
      }
      if (message.bodyParameters?.length) {
        components.push({
          type: 'body',
          parameters: message.bodyParameters.map((text) => ({ type: 'text', text })),
        });
      }
      message.buttonParameters?.forEach((text, index) => {
        components.push({
          type: 'button',
          sub_type: 'quick_reply',
          index: String(index),
          parameters: [{ type: 'payload', payload: text }],
        });
      });

      return {
        ...base,
        type: 'template',
        template: {
          name: message.templateName,
          language: { code: message.languageCode },
          ...(components.length ? { components } : {}),
        },
      };
    }

    case 'buttons': {
      if (!message.buttons.length) {
        throw new ProviderError('INVALID_REQUEST', 'A buttons message needs at least one button');
      }
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          ...(message.header ? { header: { type: 'text', text: clip(message.header, LIMITS.header) } } : {}),
          body: { text: clip(message.text, LIMITS.body) },
          ...(message.footer ? { footer: { text: clip(message.footer, LIMITS.footer) } } : {}),
          action: {
            // WhatsApp allows at most 3 reply buttons.
            buttons: message.buttons.slice(0, 3).map((b) => ({
              type: 'reply',
              reply: { id: b.id, title: clip(b.title, LIMITS.buttonTitle) },
            })),
          },
        },
      };
    }

    case 'list': {
      if (!message.sections.length) {
        throw new ProviderError('INVALID_REQUEST', 'A list message needs at least one section');
      }
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'list',
          ...(message.header ? { header: { type: 'text', text: clip(message.header, LIMITS.header) } } : {}),
          body: { text: clip(message.text, LIMITS.body) },
          ...(message.footer ? { footer: { text: clip(message.footer, LIMITS.footer) } } : {}),
          action: {
            button: clip(message.buttonText, LIMITS.listButton),
            sections: message.sections.slice(0, 10).map((section) => ({
              title: clip(section.title, LIMITS.rowTitle),
              rows: section.rows.slice(0, 10).map((row) => ({
                id: row.id,
                title: clip(row.title, LIMITS.rowTitle),
                ...(row.description
                  ? { description: clip(row.description, LIMITS.rowDescription) }
                  : {}),
              })),
            })),
          },
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

interface CloudMessage {
  id?: string;
  from?: string;
  timestamp?: string | number;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  image?: CloudMedia;
  document?: CloudMedia;
  audio?: CloudMedia;
  video?: CloudMedia;
  sticker?: CloudMedia;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
}

interface CloudMedia {
  id?: string;
  link?: string;
  url?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
}

interface CloudStatus {
  id?: string;
  status?: string;
  recipient_id?: string;
  timestamp?: string | number;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

interface CloudValue {
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: CloudMessage[];
  statuses?: CloudStatus[];
}

const MEDIA_KINDS = ['image', 'document', 'audio', 'video', 'sticker'] as const;

const INBOUND_TYPES = new Set<InboundMessageType>([
  'text',
  'interactive',
  'button',
  'image',
  'document',
  'audio',
  'video',
  'sticker',
  'location',
  'contacts',
]);

const toDate = (value: string | number | undefined): Date => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
};

const digits = (value: string | undefined): string => (value ?? '').replace(/\D/g, '');

/**
 * Accepts both envelopes 360dialog and AiSensy are known to send: the full
 * Meta `{ object, entry[].changes[].value }` wrapper used by the v2/Cloud
 * endpoints, and the flat `{ contacts, messages, statuses }` shape the older
 * On-Premise style webhook uses.
 */
function extractValues(body: unknown): CloudValue[] {
  if (!body || typeof body !== 'object') return [];
  const root = body as Record<string, unknown>;

  if (Array.isArray(root.entry)) {
    const values: CloudValue[] = [];
    for (const entry of root.entry as Array<Record<string, unknown>>) {
      for (const change of (entry?.changes ?? []) as Array<Record<string, unknown>>) {
        if (change?.value) values.push(change.value as CloudValue);
      }
    }
    return values;
  }

  if (root.messages || root.statuses || root.contacts) return [root as CloudValue];
  return [];
}

export function parseCloudApiWebhook(
  body: unknown,
  provider: WhatsAppProviderId,
  businessNumber: string,
): ParsedWebhook {
  const messages: ParsedInboundMessage[] = [];
  const statuses: NormalizedStatusEvent[] = [];

  for (const value of extractValues(body)) {
    const phoneNumber = digits(value.metadata?.display_phone_number) || businessNumber;

    const profileNames = new Map(
      (value.contacts ?? [])
        .filter((c) => c.wa_id)
        .map((c) => [digits(c.wa_id), c.profile?.name ?? '']),
    );

    for (const message of value.messages ?? []) {
      if (!message.id || !message.from) continue;
      const customerNumber = digits(message.from);
      const parsed = normaliseCloudMessage(message, provider, phoneNumber, customerNumber);
      parsed.profileName = profileNames.get(customerNumber) || undefined;
      messages.push(parsed);
    }

    for (const status of value.statuses ?? []) {
      const mapped = mapStatus(status.status);
      if (!status.id || !mapped) continue;
      const err = status.errors?.[0];
      statuses.push({
        provider,
        messageId: status.id,
        status: mapped,
        recipientNumber: digits(status.recipient_id) || undefined,
        error: err ? `[${err.code ?? '-'}] ${err.title ?? err.message ?? 'failed'}` : undefined,
        timestamp: toDate(status.timestamp),
        raw: status,
      });
    }
  }

  return { messages, statuses };
}

function mapStatus(value: string | undefined): NormalizedStatusEvent['status'] | null {
  switch (value) {
    case 'sent':
      return 'SENT';
    case 'delivered':
      return 'DELIVERED';
    case 'read':
      return 'READ';
    case 'failed':
      return 'FAILED';
    default:
      return null;
  }
}

function normaliseCloudMessage(
  message: CloudMessage,
  provider: WhatsAppProviderId,
  phoneNumber: string,
  customerNumber: string,
): ParsedInboundMessage {
  const rawType = (message.type ?? 'text') as InboundMessageType;
  const messageType: InboundMessageType = INBOUND_TYPES.has(rawType) ? rawType : 'unsupported';

  const base: ParsedInboundMessage = {
    provider,
    phoneNumber,
    customerNumber,
    messageId: message.id!,
    messageType,
    messageText: '',
    timestamp: toDate(message.timestamp),
    raw: message,
  };

  switch (messageType) {
    case 'text':
      base.messageText = message.text?.body ?? '';
      break;

    case 'button':
      base.messageText = message.button?.text ?? message.button?.payload ?? '';
      base.replyId = message.button?.payload ?? undefined;
      break;

    case 'interactive': {
      const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
      base.messageText = reply?.title ?? reply?.id ?? '';
      base.replyId = reply?.id ?? undefined;
      break;
    }

    case 'location': {
      const loc = message.location;
      base.messageText = loc?.name ?? loc?.address ?? `${loc?.latitude ?? ''},${loc?.longitude ?? ''}`;
      break;
    }

    default: {
      const kind = MEDIA_KINDS.find((k) => k === messageType);
      if (kind) {
        const media = message[kind];
        base.mediaUrl = media?.link ?? media?.url ?? undefined;
        base.mediaMimeType = media?.mime_type ?? undefined;
        base.caption = media?.caption ?? undefined;
        base.messageText = media?.caption ?? '';
      }
    }
  }

  return base;
}
