import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Lead } from '@prisma/client';
import { google, sheets_v4 } from 'googleapis';
import * as fs from 'fs';
import { formatPhone } from '../bot/input-validator';
import { SheetsConfig } from '../config/configuration';
import { SettingsService } from '../settings/settings.service';

/** Column order of the GloAro leads sheet, exactly as specified. */
export const SHEET_HEADERS = [
  'Date & Time',
  'WhatsApp Number',
  'Name',
  'Email',
  'Business Name',
  'Main Category',
  'Subcategory',
  'Product Category',
  'City',
  'Requirement',
  'Status',
  'Lead Ref',
] as const;

const MAIN_CATEGORY_LABEL: Record<string, string> = {
  GLOARO_MART: 'GloAro Mart',
  DIGITAL_NETWORK: 'GloAro Digital Network',
};

const STATUS_LABEL: Record<string, string> = {
  NEW: 'New',
  FOLLOW_UP: 'Follow-up',
  CLOSED: 'Closed',
};

@Injectable()
export class SheetsService {
  private readonly logger = new Logger(SheetsService.name);
  private client: sheets_v4.Sheets | null = null;
  /** Sheet ids whose header row has already been checked, keyed per sheet so
   *  two tenants pointing at different spreadsheets do not mask each other. */
  private readonly headerEnsured = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  /** Enabled only when both the env flag and a sheet id are present. */
  isEnabled(tenantId: string): boolean {
    const cfg = this.config.get<SheetsConfig>('sheets')!;
    return (cfg.enabled || this.settings.getBool(tenantId, 'sheets.enabled')) && !!this.sheetId(tenantId);
  }

  /** Each tenant syncs to its own spreadsheet. */
  private sheetId(tenantId: string): string {
    return (
      this.settings.get(tenantId, 'sheets.sheetId') ||
      this.config.get<SheetsConfig>('sheets')!.sheetId
    );
  }

  private tabName(tenantId: string): string {
    return (
      this.settings.get(tenantId, 'sheets.tab') ||
      this.config.get<SheetsConfig>('sheets')!.tab ||
      'Leads'
    );
  }

  private async getClient(): Promise<sheets_v4.Sheets> {
    if (this.client) return this.client;

    const cfg = this.config.get<SheetsConfig>('sheets')!;
    let credentials: Record<string, unknown>;

    if (cfg.inlineJson) {
      // Used in AWS, where the key comes from Secrets Manager as a string.
      credentials = JSON.parse(cfg.inlineJson);
    } else if (cfg.keyFile && fs.existsSync(cfg.keyFile)) {
      credentials = JSON.parse(fs.readFileSync(cfg.keyFile, 'utf8'));
    } else {
      throw new Error(
        'No Google service account credentials found. Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE ' +
          'or GOOGLE_SERVICE_ACCOUNT_JSON.',
      );
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.client = google.sheets({ version: 'v4', auth: await auth.getClient() as never });
    return this.client;
  }

  /** Writes the header row once, if the sheet is empty. */
  private async ensureHeaderRow(tenantId: string): Promise<void> {
    const spreadsheetId = this.sheetId(tenantId);
    if (this.headerEnsured.has(spreadsheetId)) return;

    const sheets = await this.getClient();
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${this.tabName(tenantId)}!A1:L1`,
    });

    if (!data.values?.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${this.tabName(tenantId)}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [[...SHEET_HEADERS]] },
      });
      this.logger.log('Wrote header row to the leads sheet');
    }
    this.headerEnsured.add(spreadsheetId);
  }

  private toRow(lead: Lead): string[] {
    return [
      this.formatDateTime(lead.createdAt),
      // Spaced form ("+91 98765 43210") rather than "+919876543210": Sheets
      // treats a bare leading "+" as the start of a formula and strips it.
      formatPhone(lead.whatsappNumber),
      lead.name ?? '',
      lead.email ?? '',
      lead.businessName ?? '',
      MAIN_CATEGORY_LABEL[lead.mainCategory] ?? lead.mainCategory,
      this.humanise(lead.subCategory),
      lead.productCategory ?? '',
      lead.city ?? '',
      lead.requirement ?? '',
      STATUS_LABEL[lead.status] ?? lead.status,
      lead.leadRef,
    ];
  }

  /**
   * Appends a lead and returns the 1-based row it landed on, so a later status
   * change can update that row in place.
   */
  async appendLead(lead: Lead): Promise<number | null> {
    await this.ensureHeaderRow(lead.tenantId);
    const sheets = await this.getClient();

    const { data } = await sheets.spreadsheets.values.append({
      spreadsheetId: this.sheetId(lead.tenantId),
      range: `${this.tabName(lead.tenantId)}!A:L`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [this.toRow(lead)] },
    });

    // updatedRange looks like "Leads!A42:L42" - pull the row number out of it.
    const match = data.updates?.updatedRange?.match(/![A-Z]+(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /** Updates just the Status cell (column K) for a lead already in the sheet. */
  async updateLeadStatus(lead: Lead): Promise<void> {
    if (!lead.sheetRowNumber) {
      this.logger.debug(`Lead ${lead.leadRef} has no sheet row - skipping status update`);
      return;
    }
    const sheets = await this.getClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId: this.sheetId(lead.tenantId),
      range: `${this.tabName(lead.tenantId)}!K${lead.sheetRowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[STATUS_LABEL[lead.status] ?? lead.status]] },
    });
  }

  /** Settings screen "Test connection" button. */
  async testConnection(tenantId: string): Promise<{ ok: boolean; title?: string; error?: string }> {
    try {
      const sheets = await this.getClient();
      const { data } = await sheets.spreadsheets.get({ spreadsheetId: this.sheetId(tenantId) });
      return { ok: true, title: data.properties?.title ?? undefined };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private humanise(value: string): string {
    return value
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private formatDateTime(date: Date): string {
    // Rendered in IST so the sheet matches what the GloAro team sees locally.
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(date);
  }
}
