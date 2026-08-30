import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: { page?: number; limit?: number; search?: string }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    // tenantId first and unconditionally: no query parameter can widen it.
    const where: Prisma.CustomerWhereInput = query.search
      ? {
          tenantId,
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { profileName: { contains: query.search, mode: 'insensitive' } },
            { businessName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { city: { contains: query.search, mode: 'insensitive' } },
            { whatsappNumber: { contains: query.search.replace(/[^\d]/g, '') } },
          ],
        }
      : { tenantId };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: { _count: { select: { leads: true, conversations: true, messages: true } } },
        orderBy: { lastInteractionAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      include: {
        leads: { orderBy: { createdAt: 'desc' } },
        conversations: { orderBy: { lastMessageAt: 'desc' }, take: 20 },
        session: true,
        _count: { select: { leads: true, messages: true } },
      },
    });
    if (!customer) throw new NotFoundException(`Customer ${id} not found`);
    return customer;
  }

  /** Full conversation history for the Customers screen. */
  async messages(tenantId: string, id: string, query: { page?: number; limit?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));

    // Confirms the customer belongs to this tenant before returning any of
    // their messages - an id alone must never be enough.
    await this.findOne(tenantId, id);

    const where = { tenantId, customerId: id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.message.count({ where }),
    ]);

    // Return oldest-first so the UI can render it as a chat thread.
    return { items: items.reverse(), total, page, limit };
  }

  async setBlocked(tenantId: string, id: string, isBlocked: boolean) {
    await this.findOne(tenantId, id);
    return this.prisma.customer.update({ where: { id }, data: { isBlocked } });
  }

  async stats(tenantId: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [total, today] = await this.prisma.$transaction([
      this.prisma.customer.count({ where: { tenantId } }),
      this.prisma.customer.count({ where: { tenantId, createdAt: { gte: startOfToday } } }),
    ]);
    return { total, newToday: today };
  }
}
