export type LeadStatus = 'NEW' | 'FOLLOW_UP' | 'CLOSED';
export type MainCategory = 'GLOARO_MART' | 'DIGITAL_NETWORK';
export type SyncStatus = 'PENDING' | 'SYNCED' | 'FAILED' | 'SKIPPED';
export type ConversationStatus = 'ACTIVE' | 'IDLE' | 'CLOSED';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'AGENT';
  lastLoginAt: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface Lead {
  id: string;
  leadRef: string;
  whatsappNumber: string;
  name: string | null;
  email: string | null;
  businessName: string | null;
  mainCategory: MainCategory;
  subCategory: string;
  productCategory: string | null;
  city: string | null;
  requirement: string | null;
  status: LeadStatus;
  sheetSyncStatus: SyncStatus;
  notifySyncStatus: SyncStatus;
  sheetSyncError: string | null;
  notifyError: string | null;
  rawAnswers: Record<string, string> | null;
  createdAt: string;
  assignee?: { id: string; name: string; email: string } | null;
  customer?: { id: string; whatsappNumber: string; profileName: string | null };
  notes?: LeadNote[];
  _count?: { notes: number };
}

export interface LeadNote {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; name: string };
}

export interface Customer {
  id: string;
  whatsappNumber: string;
  profileName: string | null;
  name: string | null;
  email: string | null;
  businessName: string | null;
  businessCategory: string | null;
  city: string | null;
  isBlocked: boolean;
  lastInteractionAt: string;
  createdAt: string;
  leads?: Lead[];
  session?: { currentNode: string; lastMessageAt: string } | null;
  _count?: { leads: number; conversations: number; messages: number };
}

export interface Message {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  body: string | null;
  status: string;
  botNode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  customerId: string;
  status: ConversationStatus;
  isHandedOver: boolean;
  messageCount: number;
  startedAt: string;
  lastMessageAt: string;
  customer: Pick<Customer, 'id' | 'whatsappNumber' | 'name' | 'profileName' | 'city'>;
  agent?: { id: string; name: string } | null;
  messages?: Message[];
  leads?: { id: string; leadRef: string; status: LeadStatus; subCategory: string }[];
}

export interface BotFlow {
  id: string;
  key: string;
  name: string;
  nodeType: 'MENU' | 'MESSAGE' | 'QUESTION' | 'ACTION';
  body: string;
  imageUrl: string | null;
  linkUrl: string | null;
  menuButton: string | null;
  options:
    | {
        key: string;
        label: string;
        next: string;
        emoji?: string;
        description?: string;
        menuTitle?: string;
      }[]
    | null;
  fieldName: string | null;
  fieldType: string | null;
  nextKey: string | null;
  action: string | null;
  mainCategory: MainCategory | null;
  subCategory: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface Setting {
  id: string;
  key: string;
  value: string;
  group: string;
  label: string;
  type: string;
  isSecret: boolean;
}

// ---------------------------------------------------------------------------
// WhatsApp channels
// ---------------------------------------------------------------------------

export type WhatsAppProviderId = 'ULTRAMSG' | 'GUPSHUP' | 'AISENSY' | 'DIALOG360';

export type ProviderConnectionStatus = 'PENDING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

/** One field of a provider's configuration form, as the server describes it. */
export interface ProviderConfigField {
  name: string;
  label: string;
  type: 'text' | 'secret' | 'url' | 'number' | 'select';
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface ProviderCapabilities {
  send: string[];
  deliveryStatus: boolean;
  inboundMedia: boolean;
  signedWebhooks: boolean;
  connectionStatus: boolean;
}

/**
 * The server is the single source of truth for which providers exist and what
 * each one needs, so the form is generated rather than hard-coded here. Adding
 * a provider on the backend makes it appear in this UI with no frontend change.
 */
export interface ProviderDescriptor {
  id: WhatsAppProviderId;
  label: string;
  slug: string;
  docsUrl: string;
  summary: string;
  fields: ProviderConfigField[];
  capabilities: ProviderCapabilities;
  webhookInstructions: string;
}

export interface WhatsAppAccount {
  id: string;
  tenantId: string;
  provider: WhatsAppProviderId;
  providerLabel: string;
  phoneNumber: string;
  label: string;
  externalId: string | null;
  /** Secrets arrive masked (••••••••1234) and must never be sent back as-is. */
  credentials: Record<string, string>;
  webhookUrl: string;
  status: ProviderConnectionStatus;
  statusMessage: string | null;
  lastCheckedAt: string | null;
  lastInboundAt: string | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionTestResult {
  state: ProviderConnectionStatus;
  message: string;
  details?: Record<string, string>;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
}

export interface DashboardSummary {
  totalLeads: number;
  newLeads: number;
  followUp: number;
  closed: number;
  todayLeads: number;
  customers: number;
  activeConversations: number;
  health: { pendingSheetSync: number; failedNotifications: number };
  recentLeads: Array<
    Pick<
      Lead,
      | 'id'
      | 'leadRef'
      | 'name'
      | 'whatsappNumber'
      | 'mainCategory'
      | 'subCategory'
      | 'city'
      | 'status'
      | 'createdAt'
    >
  >;
}
