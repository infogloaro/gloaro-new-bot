import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FLOW_NODES } from '../bot/flow-definition';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_SETTINGS } from '../settings/settings.service';
import { DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG } from './tenant.constants';

@Injectable()
export class TenantService implements OnModuleInit {
  private readonly logger = new Logger(TenantService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** A fresh database must still have somewhere to put the seeded admin. */
  async onModuleInit(): Promise<void> {
    await this.prisma.tenant.upsert({
      where: { id: DEFAULT_TENANT_ID },
      update: {},
      create: { id: DEFAULT_TENANT_ID, slug: DEFAULT_TENANT_SLUG, name: 'GloAro' },
    });
  }

  findAll() {
    return this.prisma.tenant.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { customers: true, leads: true, providerConfigs: true, users: true } },
      },
    });
  }

  async findById(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  /** Throws unless the tenant exists and is switched on. Used by the webhook path. */
  async assertActive(id: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { isActive: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (!tenant.isActive) throw new NotFoundException('Tenant is not active');
  }

  /**
   * Onboards a client. A tenant is useless without its own copy of the bot flow
   * and the default settings, so provisioning happens here rather than being
   * left as a manual step that would leave the first customer message with
   * nowhere to go.
   */
  async create(data: { slug: string; name: string }) {
    const tenant = await this.prisma.tenant.create({
      data: { slug: data.slug.toLowerCase().trim(), name: data.name.trim() },
    });
    await this.provision(tenant.id);
    this.logger.log(`Provisioned tenant ${tenant.slug}`);
    return tenant;
  }

  /**
   * Gives a tenant the default settings and a full copy of the bot flow.
   * Idempotent, so it is safe to re-run against an existing tenant.
   */
  async provision(tenantId: string): Promise<void> {
    for (const s of DEFAULT_SETTINGS) {
      await this.prisma.setting.upsert({
        where: { tenantId_key: { tenantId, key: s.key } },
        update: {},
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

    for (const node of FLOW_NODES) {
      await this.prisma.botFlow.upsert({
        where: { tenantId_key: { tenantId, key: node.key } },
        // Never overwrite copy a client has edited.
        update: {},
        create: {
          tenantId,
          key: node.key,
          name: node.name,
          nodeType: node.nodeType,
          body: node.body,
          imageUrl: node.imageUrl ?? null,
          linkUrl: node.linkUrl ?? null,
          options: (node.options ?? Prisma.DbNull) as unknown as Prisma.InputJsonValue,
          menuButton: node.menuButton ?? null,
          fieldName: node.fieldName ?? null,
          fieldType: node.fieldType ?? null,
          isRequired: node.isRequired ?? true,
          nextKey: node.nextKey ?? null,
          action: node.action ?? null,
          mainCategory: node.mainCategory ?? null,
          subCategory: node.subCategory ?? null,
          sortOrder: node.sortOrder ?? 0,
        },
      });
    }
  }

  update(id: string, data: { name?: string; isActive?: boolean }) {
    return this.prisma.tenant.update({ where: { id }, data });
  }
}
