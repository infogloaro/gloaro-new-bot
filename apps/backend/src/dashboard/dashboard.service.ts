import { Injectable } from '@nestjs/common';
import { ConversationStatus, LeadStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every tile on the Dashboard screen, in one round trip. */
  async summary(tenantId: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      totalLeads,
      newLeads,
      followUp,
      closed,
      todayLeads,
      customers,
      activeConversations,
      pendingSheetSync,
      failedNotifications,
      recentLeads,
    ] = await this.prisma.$transaction([
      this.prisma.lead.count({ where: { tenantId } }),
      this.prisma.lead.count({ where: { tenantId, status: LeadStatus.NEW } }),
      this.prisma.lead.count({ where: { tenantId, status: LeadStatus.FOLLOW_UP } }),
      this.prisma.lead.count({ where: { tenantId, status: LeadStatus.CLOSED } }),
      this.prisma.lead.count({ where: { tenantId, createdAt: { gte: startOfToday } } }),
      this.prisma.customer.count({ where: { tenantId } }),
      this.prisma.conversation.count({ where: { tenantId, status: ConversationStatus.ACTIVE } }),
      this.prisma.lead.count({ where: { tenantId, sheetSyncStatus: { in: ['PENDING', 'FAILED'] } } }),
      this.prisma.lead.count({ where: { tenantId, notifySyncStatus: 'FAILED' } }),
      this.prisma.lead.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          leadRef: true,
          name: true,
          whatsappNumber: true,
          mainCategory: true,
          subCategory: true,
          city: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      totalLeads,
      newLeads,
      followUp,
      closed,
      todayLeads,
      customers,
      activeConversations,
      // Surfaces silent integration failures instead of leaving them in the logs.
      health: { pendingSheetSync, failedNotifications },
      recentLeads,
    };
  }

  /** Daily lead counts for the last `days` days, zero-filled. */
  async leadsTrend(tenantId: string, days: number) {
    const window = Math.min(90, Math.max(1, Number.isFinite(days) ? days : 14));
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (window - 1));

    const leads = await this.prisma.lead.findMany({
      where: { tenantId, createdAt: { gte: since } },
      select: { createdAt: true },
    });

    const counts = new Map<string, number>();
    for (let i = 0; i < window; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      counts.set(d.toISOString().slice(0, 10), 0);
    }
    for (const lead of leads) {
      const key = lead.createdAt.toISOString().slice(0, 10);
      if (counts.has(key)) counts.set(key, counts.get(key)! + 1);
    }

    return [...counts.entries()].map(([date, count]) => ({ date, count }));
  }
}
