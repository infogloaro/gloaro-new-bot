import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppendLeadJob,
  JOB_APPEND_LEAD,
  JOB_UPDATE_LEAD_STATUS,
  QUEUE_SHEETS,
  UpdateLeadStatusJob,
} from '../queue/queue.constants';
import { SettingsService } from '../settings/settings.service';
import { SheetsService } from './sheets.service';

@Processor(QUEUE_SHEETS, { concurrency: 1 })
export class SheetsProcessor extends WorkerHost {
  private readonly logger = new Logger(SheetsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheets: SheetsService,
    private readonly settings: SettingsService,
  ) {
    super();
  }

  async process(job: Job<AppendLeadJob | UpdateLeadStatusJob>): Promise<void> {
    switch (job.name) {
      case JOB_APPEND_LEAD:
        return this.appendLead(job as Job<AppendLeadJob>);
      case JOB_UPDATE_LEAD_STATUS:
        return this.updateStatus(job as Job<UpdateLeadStatusJob>);
      default:
        this.logger.warn(`Unknown sheets job: ${job.name}`);
    }
  }

  private async appendLead(job: Job<AppendLeadJob>): Promise<void> {
    const lead = await this.prisma.lead.findUnique({ where: { id: job.data.leadId } });
    if (!lead) {
      this.logger.warn(`Lead ${job.data.leadId} no longer exists - skipping append`);
      return;
    }

    // Sheets config is per tenant, and the worker runs outside any request.
    await this.settings.load(lead.tenantId);

    if (!this.sheets.isEnabled(lead.tenantId)) {
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: { sheetSyncStatus: 'SKIPPED', sheetSyncError: 'Google Sheets sync is disabled' },
      });
      return;
    }

    // Already appended by an earlier attempt - do not add a second row.
    if (lead.sheetSyncStatus === 'SYNCED' && lead.sheetRowNumber) return;

    try {
      const row = await this.sheets.appendLead(lead);
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          sheetSyncStatus: 'SYNCED',
          sheetSyncedAt: new Date(),
          sheetRowNumber: row,
          sheetSyncError: null,
        },
      });
      this.logger.log(`Lead ${lead.leadRef} appended to sheet row ${row ?? '?'}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isFinalAttempt = (job.attemptsMade ?? 0) + 1 >= (job.opts.attempts ?? 1);

      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          sheetSyncStatus: isFinalAttempt ? 'FAILED' : 'PENDING',
          sheetSyncError: message,
        },
      });

      this.logger.error(`Sheet append failed for ${lead.leadRef}: ${message}`);
      // Rethrow so BullMQ applies the backoff and retries.
      throw err;
    }
  }

  private async updateStatus(job: Job<UpdateLeadStatusJob>): Promise<void> {
    const lead = await this.prisma.lead.findUnique({ where: { id: job.data.leadId } });
    if (!lead || !lead.sheetRowNumber) return;
    await this.settings.load(lead.tenantId);
    if (!this.sheets.isEnabled(lead.tenantId)) return;

    await this.sheets.updateLeadStatus(lead);
    this.logger.log(`Sheet status updated for ${lead.leadRef} -> ${lead.status}`);
  }
}
