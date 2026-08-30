import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LeadStatus, MainCategory, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_JOB_OPTIONS,
  JOB_APPEND_LEAD,
  JOB_NOTIFY_NEW_LEAD,
  JOB_UPDATE_LEAD_STATUS,
  QUEUE_NOTIFY,
  QUEUE_SHEETS,
} from '../queue/queue.constants';

export interface CreateLeadFromBotInput {
  tenantId: string;
  customerId: string;
  conversationId: string;
  whatsappNumber: string;
  mainCategory: MainCategory;
  subCategory: string;
  /** Everything the bot collected, keyed by field name. */
  answers: Record<string, string>;
}

export interface FindLeadsQuery {
  page?: number;
  limit?: number;
  status?: LeadStatus;
  mainCategory?: MainCategory;
  subCategory?: string;
  search?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_SHEETS) private readonly sheetsQueue: Queue,
    @InjectQueue(QUEUE_NOTIFY) private readonly notifyQueue: Queue,
  ) {}

  /**
   * Allocates the next human-readable reference (GL-2026-000001).
   * Runs inside the caller's transaction so two simultaneous leads cannot
   * receive the same number.
   */
  private async nextLeadRef(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    // Per tenant, so each client''s references start at 000001 and no client can
    // infer another client''s lead volume from a gap in the sequence.
    const counter = await tx.leadCounter.upsert({
      where: { tenantId_year: { tenantId, year } },
      update: { value: { increment: 1 } },
      create: { tenantId, year, value: 1 },
    });
    return `GL-${year}-${String(counter.value).padStart(6, '0')}`;
  }

  /**
   * Creates a lead from bot-collected answers, mirrors the useful fields onto
   * the customer record, then queues the Sheets append and the admin
   * notification.
   */
  async createFromBot(input: CreateLeadFromBotInput) {
    const { answers } = input;

    const lead = await this.prisma.$transaction(async (tx) => {
      const leadRef = await this.nextLeadRef(tx, input.tenantId);

      const created = await tx.lead.create({
        data: {
          tenantId: input.tenantId,
          leadRef,
          customerId: input.customerId,
          conversationId: input.conversationId,
          whatsappNumber: input.whatsappNumber,
          name: answers.name ?? null,
          email: answers.email ?? null,
          businessName: answers.businessName ?? null,
          mainCategory: input.mainCategory,
          subCategory: input.subCategory,
          productCategory: answers.productCategory ?? answers.businessCategory ?? null,
          city: answers.city ?? null,
          requirement: this.buildRequirement(input.subCategory, answers),
          rawAnswers: answers as Prisma.InputJsonValue,
          status: LeadStatus.NEW,
        },
      });

      // Keep the customer profile current with the latest details given.
      await tx.customer.update({
        where: { id: input.customerId },
        data: {
          name: answers.name ?? undefined,
          email: answers.email ?? undefined,
          businessName: answers.businessName ?? undefined,
          businessCategory: answers.businessCategory ?? answers.productCategory ?? undefined,
          city: answers.city ?? undefined,
          lastInteractionAt: new Date(),
        },
      });

      return created;
    });

    this.logger.log(`Lead ${lead.leadRef} created (${lead.mainCategory}/${lead.subCategory})`);

    // Side effects are fire-and-forget; failures are retried by the workers and
    // recorded on the lead's *_sync_status columns.
    await this.enqueueSideEffects(lead.id);

    return lead;
  }

  /** Queues the Sheets append and admin notification for a lead. */
  async enqueueSideEffects(leadId: string): Promise<void> {
    try {
      await Promise.all([
        this.sheetsQueue.add(JOB_APPEND_LEAD, { leadId }, DEFAULT_JOB_OPTIONS),
        this.notifyQueue.add(JOB_NOTIFY_NEW_LEAD, { leadId }, DEFAULT_JOB_OPTIONS),
      ]);
    } catch (err) {
      // Redis being down must not lose the lead - it is already in Postgres and
      // the reconcile job will pick up anything left PENDING.
      this.logger.error(
        `Could not queue side effects for lead ${leadId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * The Requirement column in the Sheet and the admin notification should read
   * usefully for every flow, including ones that never ask a free-text question.
   */
  private buildRequirement(subCategory: string, answers: Record<string, string>): string {
    if (answers.requirement) return answers.requirement;

    switch (subCategory) {
      case 'BECOME_SELLER':
        return `Wants to sell on GloAro Mart — ${answers.productCategory ?? 'category not specified'}`;
      case 'TRACK_ORDER':
        return `Order tracking request for Order ID ${answers.orderId ?? '(not provided)'}`;
      case 'MEMBERSHIP':
        return 'Membership enquiry';
      case 'JOIN_GLOARO':
        return 'Wants to join the GloAro Digital Network';
      case 'FRANCHISE':
        return `Franchise enquiry for ${answers.city ?? 'city not specified'}`;
      case 'CHAPTERS':
        return `Chapter details requested for ${answers.city ?? 'location not specified'}`;
      case 'EVENT_REGISTRATION':
        return 'Event registration request';
      default:
        return 'Enquiry via WhatsApp bot';
    }
  }

  // -------------------------------------------------------------------------
  // Admin panel queries
  // -------------------------------------------------------------------------

  async findAll(tenantId: string, query: FindLeadsQuery) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    // tenantId first and unconditionally: no query parameter can widen it.
    const where: Prisma.LeadWhereInput = {
      tenantId,
      ...(query.status && { status: query.status }),
      ...(query.mainCategory && { mainCategory: query.mainCategory }),
      ...(query.subCategory && { subCategory: query.subCategory }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lte: new Date(`${query.to}T23:59:59.999Z`) }),
        },
      }),
      ...(query.search && {
        OR: [
          { leadRef: { contains: query.search, mode: 'insensitive' as const } },
          { name: { contains: query.search, mode: 'insensitive' as const } },
          { email: { contains: query.search, mode: 'insensitive' as const } },
          { businessName: { contains: query.search, mode: 'insensitive' as const } },
          { whatsappNumber: { contains: query.search.replace(/[^\d]/g, '') } },
          { requirement: { contains: query.search, mode: 'insensitive' as const } },
          { city: { contains: query.search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        include: {
          assignee: { select: { id: true, name: true, email: true } },
          customer: { select: { id: true, whatsappNumber: true, profileName: true } },
          _count: { select: { notes: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(tenantId: string, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, tenantId },
      include: {
        customer: true,
        assignee: { select: { id: true, name: true, email: true } },
        notes: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
        conversation: { select: { id: true, startedAt: true, messageCount: true } },
      },
    });
    if (!lead) throw new NotFoundException(`Lead ${id} not found`);
    return lead;
  }

  async updateStatus(tenantId: string, id: string, status: LeadStatus) {
    await this.findOne(tenantId, id);
    const lead = await this.prisma.lead.update({ where: { id }, data: { status } });

    // Reflect the new status in the Google Sheet's Status column.
    try {
      await this.sheetsQueue.add(JOB_UPDATE_LEAD_STATUS, { leadId: id }, DEFAULT_JOB_OPTIONS);
    } catch (err) {
      this.logger.warn(`Could not queue sheet status update for ${id}: ${err}`);
    }
    return lead;
  }

  async assign(tenantId: string, id: string, userId: string | null) {
    await this.findOne(tenantId, id);
    return this.prisma.lead.update({ where: { id }, data: { assignedTo: userId } });
  }

  async addNote(tenantId: string, leadId: string, userId: string, body: string) {
    await this.findOne(tenantId, leadId);
    return this.prisma.leadNote.create({
      data: { leadId, userId, body },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  /** Manual "retry sync" button in the admin panel. */
  async retrySync(tenantId: string, id: string) {
    const lead = await this.findOne(tenantId, id);
    await this.enqueueSideEffects(lead.id);
    return { queued: true, leadRef: lead.leadRef };
  }

  async stats(tenantId: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [total, newLeads, followUp, closed, today, mart, network] =
      await this.prisma.$transaction([
        this.prisma.lead.count({ where: { tenantId } }),
        this.prisma.lead.count({ where: { tenantId, status: LeadStatus.NEW } }),
        this.prisma.lead.count({ where: { tenantId, status: LeadStatus.FOLLOW_UP } }),
        this.prisma.lead.count({ where: { tenantId, status: LeadStatus.CLOSED } }),
        this.prisma.lead.count({ where: { tenantId, createdAt: { gte: startOfToday } } }),
        this.prisma.lead.count({ where: { tenantId, mainCategory: MainCategory.GLOARO_MART } }),
        this.prisma.lead.count({ where: { tenantId, mainCategory: MainCategory.DIGITAL_NETWORK } }),
      ]);

    return {
      total,
      new: newLeads,
      followUp,
      closed,
      today,
      byCategory: { GLOARO_MART: mart, DIGITAL_NETWORK: network },
    };
  }
}
