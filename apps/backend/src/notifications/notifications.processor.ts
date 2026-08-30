import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Lead } from '@prisma/client';
import { Job } from 'bullmq';
import { formatPhone } from '../bot/input-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JOB_NOTIFY_NEW_LEAD, NotifyNewLeadJob, QUEUE_NOTIFY } from '../queue/queue.constants';
import { SettingsService } from '../settings/settings.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

const MAIN_CATEGORY_LABEL: Record<string, string> = {
  GLOARO_MART: 'GloAro Mart',
  DIGITAL_NETWORK: 'GloAro Digital Network',
};

@Processor(QUEUE_NOTIFY, { concurrency: 2 })
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly settings: SettingsService,
  ) {
    super();
  }

  async process(job: Job<NotifyNewLeadJob>): Promise<void> {
    if (job.name !== JOB_NOTIFY_NEW_LEAD) return;

    const lead = await this.prisma.lead.findUnique({ where: { id: job.data.leadId } });
    if (!lead) {
      this.logger.warn(`Lead ${job.data.leadId} no longer exists - skipping notification`);
      return;
    }

    const { tenantId } = lead;
    // The worker runs outside any request, so the tenant's settings may not be
    // in the cache yet.
    await this.settings.load(tenantId);

    if (!this.settings.getBool(tenantId, 'notification.enabled', true)) {
      await this.markSkipped(lead.id, 'Admin notifications are disabled');
      return;
    }

    const recipients = this.settings.getAdminNumbers(tenantId);

    if (!recipients.length) {
      await this.markSkipped(lead.id, 'No admin notification number configured');
      this.logger.warn(`No admin number set - lead ${lead.leadRef} notification skipped`);
      return;
    }

    const body = this.buildMessage(lead);
    const failures: string[] = [];

    for (const to of recipients) {
      const result = await this.whatsapp.sendText(tenantId, to, body, 'ADMIN_LEAD_ALERT');
      if (!result.success) failures.push(`${to}: ${result.error}`);
    }

    if (failures.length === recipients.length) {
      const message = failures.join('; ');
      const isFinalAttempt = (job.attemptsMade ?? 0) + 1 >= (job.opts.attempts ?? 1);
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          notifySyncStatus: isFinalAttempt ? 'FAILED' : 'PENDING',
          notifyError: message,
        },
      });
      throw new Error(`Admin notification failed for ${lead.leadRef}: ${message}`);
    }

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        notifySyncStatus: 'SYNCED',
        notifiedAt: new Date(),
        notifyError: failures.length ? `Partial failure: ${failures.join('; ')}` : null,
      },
    });
    this.logger.log(`Admin notified about lead ${lead.leadRef}`);
  }

  /** The exact notification format from the requirement document. */
  private buildMessage(lead: Lead): string {
    return [
      '🚨 *New WhatsApp Bot Lead*',
      '',
      `Name: ${lead.name ?? '-'}`,
      `Phone: ${formatPhone(lead.whatsappNumber)}`,
      `Category: ${MAIN_CATEGORY_LABEL[lead.mainCategory] ?? lead.mainCategory}`,
      `Subcategory: ${this.humanise(lead.subCategory)}`,
      `Requirement: ${lead.requirement ?? '-'}`,
      `Time: ${this.formatDateTime(lead.createdAt)}`,
      'Status: New',
      '',
      `Ref: ${lead.leadRef}`,
    ].join('\n');
  }

  private async markSkipped(leadId: string, reason: string): Promise<void> {
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { notifySyncStatus: 'SKIPPED', notifyError: reason },
    });
  }

  private humanise(value: string): string {
    return value
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private formatDateTime(date: Date): string {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }
}
