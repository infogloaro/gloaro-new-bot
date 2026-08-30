import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Settings that must always exist, with the defaults used until a client supplies real values. */
export const DEFAULT_SETTINGS: Array<{
  key: string;
  value: string;
  group: string;
  label: string;
  type?: string;
  isSecret?: boolean;
}> = [
  { key: 'company.name', value: 'GloAro', group: 'company', label: 'Company Name' },
  {
    key: 'company.description',
    value:
      'GloAro is your one-stop platform for Business Networking, B2B & B2C Commerce, ' +
      'Technology Solutions, and Business Growth.',
    group: 'company',
    label: 'Company Description',
  },
  { key: 'company.email', value: 'info@gloaro.com', group: 'company', label: 'Official Email' },
  { key: 'company.website', value: 'https://www.gloaro.com', group: 'company', label: 'Website' },
  { key: 'company.supportPhone', value: '+91 00000 00000', group: 'company', label: 'Support Phone' },
  { key: 'company.logoUrl', value: '', group: 'company', label: 'Logo URL' },

  { key: 'contact.sales', value: '', group: 'company', label: 'Sales Contact' },
  { key: 'contact.membership', value: '', group: 'company', label: 'Membership Contact' },
  { key: 'contact.franchise', value: '', group: 'company', label: 'Franchise Contact' },

  {
    key: 'notification.adminNumbers',
    value: '',
    group: 'notification',
    label: 'Admin Notification WhatsApp Numbers (comma separated)',
  },
  {
    key: 'notification.enabled',
    value: 'true',
    group: 'notification',
    label: 'Send Admin Lead Notifications',
    type: 'boolean',
  },

  { key: 'sheets.sheetId', value: '', group: 'sheets', label: 'Google Sheet ID' },
  { key: 'sheets.tab', value: 'Leads', group: 'sheets', label: 'Google Sheet Tab Name' },
  {
    key: 'sheets.enabled',
    value: 'false',
    group: 'sheets',
    label: 'Sync Leads to Google Sheets',
    type: 'boolean',
  },

  {
    key: 'bot.sessionTimeoutMinutes',
    value: '30',
    group: 'bot',
    label: 'Session Timeout (minutes)',
    type: 'number',
  },
  {
    key: 'bot.menuStyle',
    value: 'interactive',
    group: 'bot',
    label: 'Menu Style (interactive = tappable list, numbered = reply with a number)',
  },
  {
    key: 'bot.orderApiUrl',
    value: '',
    group: 'bot',
    label: 'Order Tracking API URL (blank = raise support request)',
  },
];

/**
 * Per-tenant key/value configuration.
 *
 * Read on every bot message, so each tenant's values are cached in memory and
 * the cache is filled lazily the first time that tenant is touched. Writes go
 * through this service, which keeps the cache honest without a pub/sub layer.
 * A second backend instance would need cache invalidation across processes;
 * today the admin API and the bot run in the same process.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, Map<string, string>>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Warm the cache for tenants that already exist; new ones fill in on demand.
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) {
      await this.ensureDefaults(tenant.id);
      await this.refreshCache(tenant.id);
    }
    this.logger.log(`Settings ready for ${tenants.length} tenant(s)`);
  }

  /** Inserts any setting that does not exist yet. Never overwrites a configured value. */
  async ensureDefaults(tenantId: string): Promise<void> {
    for (const s of DEFAULT_SETTINGS) {
      await this.prisma.setting.upsert({
        where: { tenantId_key: { tenantId, key: s.key } },
        update: { label: s.label, group: s.group },
        create: {
          tenantId,
          key: s.key,
          value: s.value,
          group: s.group,
          label: s.label,
          type: s.type ?? 'string',
          isSecret: s.isSecret ?? false,
        },
      });
    }
  }

  async refreshCache(tenantId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.setting.findMany({ where: { tenantId } });
    const map = new Map(rows.map((s) => [s.key, s.value]));
    this.cache.set(tenantId, map);
    return map;
  }

  /**
   * Loads a tenant's settings into the cache if they are not there yet. Every
   * read path awaits this once, so a tenant created after boot works without a
   * restart.
   */
  async load(tenantId: string): Promise<void> {
    if (this.cache.has(tenantId)) return;
    await this.ensureDefaults(tenantId);
    await this.refreshCache(tenantId);
  }

  private mapFor(tenantId: string): Map<string, string> {
    return this.cache.get(tenantId) ?? new Map();
  }

  get(tenantId: string, key: string, fallback = ''): string {
    return this.mapFor(tenantId).get(key) ?? fallback;
  }

  getBool(tenantId: string, key: string, fallback = false): boolean {
    const v = this.mapFor(tenantId).get(key);
    if (v === undefined || v === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
  }

  getNumber(tenantId: string, key: string, fallback: number): number {
    const n = parseInt(this.mapFor(tenantId).get(key) ?? '', 10);
    return Number.isFinite(n) ? n : fallback;
  }

  /** Admin numbers for lead notifications, digits only. */
  getAdminNumbers(tenantId: string): string[] {
    return this.get(tenantId, 'notification.adminNumbers')
      .split(',')
      .map((n) => n.replace(/[^\d]/g, ''))
      .filter((n) => n.length >= 10);
  }

  async findAll(tenantId: string, group?: string) {
    const rows = await this.prisma.setting.findMany({
      where: { tenantId, ...(group ? { group } : {}) },
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });
    // Never return secret values to the admin panel.
    return rows.map((r) => (r.isSecret ? { ...r, value: r.value ? '********' : '' } : r));
  }

  async update(tenantId: string, key: string, value: string) {
    const updated = await this.prisma.setting.update({
      where: { tenantId_key: { tenantId, key } },
      data: { value },
    });
    (await this.cachedMap(tenantId)).set(key, value);
    return updated;
  }

  async updateMany(tenantId: string, entries: Record<string, string>) {
    const map = await this.cachedMap(tenantId);
    for (const [key, value] of Object.entries(entries)) {
      await this.prisma.setting.upsert({
        where: { tenantId_key: { tenantId, key } },
        update: { value },
        create: { tenantId, key, value, group: 'company', label: key },
      });
      map.set(key, value);
    }
    return this.findAll(tenantId);
  }

  private async cachedMap(tenantId: string): Promise<Map<string, string>> {
    return this.cache.get(tenantId) ?? (await this.refreshCache(tenantId));
  }

  /** Placeholder values available to every bot message body, e.g. {{websiteUrl}}. */
  templateVars(tenantId: string): Record<string, string> {
    return {
      companyName: this.get(tenantId, 'company.name', 'GloAro'),
      companyDescription: this.get(tenantId, 'company.description'),
      supportEmail: this.get(tenantId, 'company.email'),
      supportPhone: this.get(tenantId, 'company.supportPhone'),
      websiteUrl: this.get(tenantId, 'company.website'),
      salesContact: this.get(tenantId, 'contact.sales'),
      membershipContact: this.get(tenantId, 'contact.membership'),
      franchiseContact: this.get(tenantId, 'contact.franchise'),
    };
  }
}
