/**
 * Provider-independent WhatsApp contract.
 *
 * Nothing in this file may import Prisma, Nest or any provider SDK. The bot
 * engine and the conversation layer only ever speak these types; each adapter
 * translates them to and from one vendor's wire format.
 */

// ---------------------------------------------------------------------------
// Provider identity
// ---------------------------------------------------------------------------

/** Kept in sync with the `WhatsAppProviderType` Prisma enum. */
export const PROVIDER_IDS = ['ULTRAMSG', 'GUPSHUP', 'AISENSY', 'DIALOG360'] as const;

export type WhatsAppProviderId = (typeof PROVIDER_IDS)[number];

export const isProviderId = (value: unknown): value is WhatsAppProviderId =>
  typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);

/** URL slug used in `/webhooks/whatsapp/:slug`, mapped to the provider id. */
export const PROVIDER_SLUGS: Record<string, WhatsAppProviderId> = {
  ultramsg: 'ULTRAMSG',
  gupshup: 'GUPSHUP',
  aisensy: 'AISENSY',
  '360dialog': 'DIALOG360',
};

// ---------------------------------------------------------------------------
// Outbound messages - what the bot engine produces
// ---------------------------------------------------------------------------

export type OutboundMessageType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'sticker'
  | 'location'
  | 'template'
  | 'buttons'
  | 'list';

interface OutboundBase {
  /** Recipient MSISDN, digits only, international format. e.g. 919876543210 */
  to: string;
  /** Bot flow node this message came from. Carried through for tracing only. */
  node?: string;
}

export interface OutboundTextMessage extends OutboundBase {
  type: 'text';
  text: string;
  /** Render a link preview for the first URL in the body, where supported. */
  previewUrl?: boolean;
}

export interface OutboundMediaMessage extends OutboundBase {
  type: 'image' | 'document' | 'audio' | 'video' | 'sticker';
  /** Publicly reachable URL. Providers fetch the bytes themselves. */
  mediaUrl: string;
  caption?: string;
  /** Documents only - the name the recipient sees. */
  filename?: string;
}

export interface OutboundLocationMessage extends OutboundBase {
  type: 'location';
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface TemplateComponentParameter {
  type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video';
  /** For `text`; the other kinds carry `mediaUrl`. */
  text?: string;
  mediaUrl?: string;
}

export interface OutboundTemplateMessage extends OutboundBase {
  type: 'template';
  templateName: string;
  /** BCP-47-ish code the provider expects, e.g. en, en_US. */
  languageCode: string;
  /** Ordered body substitutions ({{1}}, {{2}}, ...). */
  bodyParameters?: string[];
  /** Optional header media for a media-header template. */
  headerParameter?: TemplateComponentParameter;
  /** Ordered quick-reply / URL button substitutions. */
  buttonParameters?: string[];
}

export interface InteractiveButton {
  /** Payload echoed back in the webhook when the recipient taps it. */
  id: string;
  title: string;
}

export interface OutboundButtonsMessage extends OutboundBase {
  type: 'buttons';
  text: string;
  header?: string;
  footer?: string;
  /** WhatsApp caps reply buttons at 3. */
  buttons: InteractiveButton[];
}

export interface InteractiveListRow {
  id: string;
  title: string;
  description?: string;
}

export interface InteractiveListSection {
  title: string;
  rows: InteractiveListRow[];
}

export interface OutboundListMessage extends OutboundBase {
  type: 'list';
  text: string;
  header?: string;
  footer?: string;
  /** Label on the button that opens the list. */
  buttonText: string;
  sections: InteractiveListSection[];
}

export type OutboundMessage =
  | OutboundTextMessage
  | OutboundMediaMessage
  | OutboundLocationMessage
  | OutboundTemplateMessage
  | OutboundButtonsMessage
  | OutboundListMessage;

// ---------------------------------------------------------------------------
// Send results
// ---------------------------------------------------------------------------

/** Why a send failed, in terms the caller can act on without knowing the vendor. */
export type ProviderErrorCode =
  | 'AUTH'
  | 'INVALID_RECIPIENT'
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'PROVIDER_ERROR'
  | 'NOT_CONFIGURED'
  | 'DISABLED';

export interface SendResult {
  success: boolean;
  /** The provider's own message id, stored so status webhooks can be matched. */
  messageId?: string;
  errorCode?: ProviderErrorCode;
  /** Human-readable, safe to store and show. Never contains credentials. */
  error?: string;
  /** Recommended wait before retrying, seconds. Only set for RATE_LIMITED. */
  retryAfterSeconds?: number;
}

/** Thrown inside adapters; `WhatsAppService` converts it to a `SendResult`. */
export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface ProviderCapabilities {
  /** Outbound message kinds this provider can actually deliver. */
  send: readonly OutboundMessageType[];
  /** Provider posts delivery/read receipts to the webhook. */
  deliveryStatus: boolean;
  /** Inbound media arrives with a URL we can store. */
  inboundMedia: boolean;
  /** Provider signs its webhooks in a way we can verify. */
  signedWebhooks: boolean;
  /** Provider exposes an endpoint that reports the channel's live state. */
  connectionStatus: boolean;
}

// ---------------------------------------------------------------------------
// Inbound - normalised webhook payloads
// ---------------------------------------------------------------------------

export type InboundMessageType =
  | 'text'
  | 'interactive'
  | 'button'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'unsupported';

/**
 * The single internal shape every provider webhook collapses to. `tenantId` is
 * filled in by the webhook controller once it has resolved the account.
 */
export interface NormalizedInboundMessage {
  tenantId: string;
  /** NULL only for the admin simulator, which never touches a gateway. */
  provider: WhatsAppProviderId | null;
  /**
   * The `WhatsAppProviderConfig` row this arrived on. Recorded on the message
   * so a reply can go back out on the same number. Absent for the simulator.
   */
  providerConfigId?: string;
  /** The GloAro business number that received the message, digits only. */
  phoneNumber: string;
  /** The customer who sent it, digits only. */
  customerNumber: string;
  /** Provider message id. Unique per provider, not globally. */
  messageId: string;
  messageType: InboundMessageType;
  /** Body text, button title or list-row title - whatever the engine matches on. */
  messageText: string;
  timestamp: Date;

  profileName?: string;
  /** Payload id of the tapped button / selected list row, when present. */
  replyId?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  caption?: string;
  /** The untouched provider payload, kept for debugging. Never logged wholesale. */
  raw: unknown;
}

/** Same shape minus the fields only the controller can supply. */
export type ParsedInboundMessage = Omit<NormalizedInboundMessage, 'tenantId'>;

export type DeliveryStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface NormalizedStatusEvent {
  provider: WhatsAppProviderId;
  /** Id returned by the original send. */
  messageId: string;
  status: DeliveryStatus;
  recipientNumber?: string;
  error?: string;
  timestamp: Date;
  raw: unknown;
}

/** What `parseWebhook` returns: any payload yields zero or more of each. */
export interface ParsedWebhook {
  messages: ParsedInboundMessage[];
  statuses: NormalizedStatusEvent[];
}

export const EMPTY_WEBHOOK: ParsedWebhook = { messages: [], statuses: [] };

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export type ConnectionState = 'CONNECTED' | 'DISCONNECTED' | 'PENDING' | 'ERROR';

export interface ConnectionTestResult {
  state: ConnectionState;
  /** One line suitable for the admin UI. Never contains credentials. */
  message: string;
  /** Provider-reported detail, e.g. the live phone number or account name. */
  details?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Configuration descriptors - drive the dynamic admin form
// ---------------------------------------------------------------------------

export interface ProviderConfigField {
  /** Key inside the credentials object. */
  name: string;
  label: string;
  /** `secret` fields are encrypted at rest and never returned to the browser. */
  type: 'text' | 'secret' | 'url' | 'number' | 'select';
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface ProviderDescriptor {
  id: WhatsAppProviderId;
  label: string;
  /** URL slug for the webhook endpoint. */
  slug: string;
  docsUrl: string;
  /** Shown under the provider name in the admin dropdown. */
  summary: string;
  fields: readonly ProviderConfigField[];
  capabilities: ProviderCapabilities;
  /** Rendered as a checklist in the admin UI after saving. */
  webhookInstructions: string;
}

/** Resolved, decrypted credentials handed to an adapter instance. */
export interface ResolvedProviderConfig {
  tenantId: string;
  provider: WhatsAppProviderId;
  /** The business WhatsApp number, digits only. */
  phoneNumber: string;
  credentials: Record<string, string>;
  /** Shared secret used to authenticate inbound webhooks for this account. */
  webhookSecret: string;
  /**
   * The full public callback URL for this account, secret included. Providers
   * that register the URL themselves (360dialog) send exactly this string.
   */
  webhookUrl: string;
}

/** Context a provider needs to decide whether a webhook request is genuine. */
export interface WebhookVerificationContext {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  /** Exact bytes received, for HMAC comparison. */
  rawBody: Buffer;
  body: unknown;
}
