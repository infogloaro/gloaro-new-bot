import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';

/**
 * Background housekeeping. The reconcile job is the safety net that makes the
 * "no lead is ever lost" guarantee hold even if Redis was down when the lead
 * was created.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
  ) {}

  /** Re-queues leads whose Sheets append or admin notification never completed. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcilePendingSyncs(): Promise<void> {
    const stale = new Date(Date.now() - 10 * 60_000);

    const pending = await this.prisma.lead.findMany({
      where: {
        createdAt: { lt: stale },
        OR: [
          { sheetSyncStatus: { in: ['PENDING', 'FAILED'] } },
          { notifySyncStatus: { in: ['PENDING', 'FAILED'] } },
        ],
      },
      select: { id: true, leadRef: true },
      take: 50,
    });

    if (!pending.length) return;

    this.logger.warn(`Re-queueing ${pending.length} lead(s) with incomplete syncs`);
    for (const lead of pending) {
      await this.leads.enqueueSideEffects(lead.id);
    }
  }

  /** Marks conversations with no recent activity as idle, then closed. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async ageConversations(): Promise<void> {
    const idleAfter = new Date(Date.now() - 60 * 60_000);
    const closeAfter = new Date(Date.now() - 24 * 60 * 60_000);

    const { count: idled } = await this.prisma.conversation.updateMany({
      where: { status: 'ACTIVE', lastMessageAt: { lt: idleAfter }, isHandedOver: false },
      data: { status: 'IDLE' },
    });

    const { count: closed } = await this.prisma.conversation.updateMany({
      where: { status: 'IDLE', lastMessageAt: { lt: closeAfter } },
      data: { status: 'CLOSED', closedAt: new Date() },
    });

    if (idled || closed) {
      this.logger.log(`Conversation ageing: ${idled} -> idle, ${closed} -> closed`);
    }
  }

  /** Keeps the webhook log from growing without bound. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneWebhookEvents(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const { count } = await this.prisma.webhookEvent.deleteMany({
      where: { createdAt: { lt: cutoff }, status: { in: ['PROCESSED', 'DUPLICATE'] } },
    });
    if (count) this.logger.log(`Pruned ${count} webhook events older than 30 days`);
  }
}
