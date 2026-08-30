import { Injectable, NotFoundException } from '@nestjs/common';
import { ConversationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: {
    page?: number;
    limit?: number;
    status?: ConversationStatus;
    search?: string;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    // tenantId first and unconditionally: no query parameter can widen it.
    const where: Prisma.ConversationWhereInput = {
      tenantId,
      ...(query.status && { status: query.status }),
      ...(query.search && {
        customer: {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { profileName: { contains: query.search, mode: 'insensitive' as const } },
            { whatsappNumber: { contains: query.search.replace(/[^\d]/g, '') } },
          ],
        },
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        include: {
          customer: {
            select: { id: true, whatsappNumber: true, name: true, profileName: true, city: true },
          },
          agent: { select: { id: true, name: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(tenantId: string, id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      include: {
        customer: true,
        agent: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'asc' } },
        leads: { select: { id: true, leadRef: true, status: true, subCategory: true } },
      },
    });
    if (!conversation) throw new NotFoundException(`Conversation ${id} not found`);
    return conversation;
  }

  /** Takes the conversation away from the bot so an agent can reply by hand. */
  async takeOver(tenantId: string, id: string, agentId: string) {
    await this.findOne(tenantId, id);
    return this.prisma.conversation.update({
      where: { id },
      data: { isHandedOver: true, agentId, status: ConversationStatus.ACTIVE },
    });
  }

  /** Returns control to the bot. */
  async release(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.conversation.update({
      where: { id },
      data: { isHandedOver: false, agentId: null },
    });
  }

  async close(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.conversation.update({
      where: { id },
      data: { status: ConversationStatus.CLOSED, closedAt: new Date() },
    });
  }

  async stats(tenantId: string) {
    const [active, idle, closed, handedOver] = await this.prisma.$transaction([
      this.prisma.conversation.count({ where: { tenantId, status: ConversationStatus.ACTIVE } }),
      this.prisma.conversation.count({ where: { tenantId, status: ConversationStatus.IDLE } }),
      this.prisma.conversation.count({ where: { tenantId, status: ConversationStatus.CLOSED } }),
      this.prisma.conversation.count({ where: { tenantId, isHandedOver: true } }),
    ]);
    return { active, idle, closed, handedOver };
  }
}
