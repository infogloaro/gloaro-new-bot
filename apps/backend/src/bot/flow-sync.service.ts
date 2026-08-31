import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FLOW_NODES } from './flow-definition';

/**
 * Guarantees every tenant has a flow node for every key the code references.
 *
 * Flow content only ever reached the database through `prisma/seed.ts`, run by
 * hand. `migrate deploy` on boot creates the tables but never the rows, so a
 * deployment could ship a flow-definition.ts that referenced nodes the live
 * database had never heard of. The failure is silent from the outside: the
 * engine logs "Flow references missing node X" and returns no messages, so the
 * bot answers the menu and then goes dead on the option the customer taps.
 *
 * This closes that gap at boot, where it cannot be forgotten. It only ever
 * CREATES missing nodes - it deliberately does not update existing ones, since
 * menus are editable from the admin panel and rewriting them on every restart
 * would silently revert an admin's work. Structural changes to a node that
 * already exists are still the seed's job.
 */
@Injectable()
export class FlowSyncService implements OnModuleInit {
  private readonly logger = new Logger(FlowSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.sync();
    } catch (err) {
      // Never block startup: a bot with a stale flow is far better than a
      // backend that will not boot and takes the admin panel down with it.
      this.logger.error(
        `Flow sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async sync(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });

    for (const { id: tenantId } of tenants) {
      const existing = await this.prisma.botFlow.findMany({
        where: { tenantId },
        select: { key: true },
      });
      const have = new Set(existing.map((f) => f.key));
      const missing = FLOW_NODES.filter((n) => !have.has(n.key));

      if (!missing.length) continue;

      for (const node of missing) {
        await this.prisma.botFlow.create({
          data: {
            tenantId,
            key: node.key,
            name: node.name,
            body: node.body,
            nodeType: node.nodeType,
            options: (node.options ?? Prisma.DbNull) as unknown as Prisma.InputJsonValue,
            menuButton: node.menuButton ?? null,
            imageUrl: node.imageUrl ?? null,
            linkUrl: node.linkUrl ?? null,
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

      this.logger.warn(
        `Tenant ${tenantId} was missing ${missing.length} flow node(s) - created: ` +
          missing.map((n) => n.key).join(', '),
      );
    }
  }
}
