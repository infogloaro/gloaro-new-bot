import { PrismaClient, Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { FLOW_NODES } from '../src/bot/flow-definition';
import { DEFAULT_SETTINGS } from '../src/settings/settings.service';
import { DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG } from '../src/tenant/tenant.constants';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

/** The tenant a fresh install starts with. Everything else hangs off it. */
async function seedTenant(): Promise<string> {
  const tenant = await prisma.tenant.upsert({
    where: { id: DEFAULT_TENANT_ID },
    update: {},
    create: { id: DEFAULT_TENANT_ID, slug: DEFAULT_TENANT_SLUG, name: 'GloAro' },
  });
  console.log(`  tenant ${tenant.slug} ready`);
  return tenant.id;
}

/**
 * The first user is a SUPER_ADMIN, which is deliberately *not* pinned to a
 * tenant: it is the platform operator who onboards clients.
 */
async function seedAdminUser(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? 'admin@gloaro.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe@123';
  const name = process.env.ADMIN_NAME ?? 'GloAro Admin';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`  admin user ${email} already exists - left unchanged`);
    return;
  }

  await prisma.user.create({
    data: { email, name, passwordHash: await bcrypt.hash(password, 12), role: UserRole.SUPER_ADMIN },
  });
  console.log(`  created admin user ${email}`);
}

async function seedSettings(tenantId: string): Promise<void> {
  for (const s of DEFAULT_SETTINGS) {
    await prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: s.key } },
      update: { label: s.label, group: s.group },
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
  console.log(`  ensured ${DEFAULT_SETTINGS.length} settings`);
}

/**
 * Upserts every flow node. Re-running the seed refreshes structure (options,
 * next node, action) but leaves `body` alone once it exists, so copy edited
 * from the admin panel is not overwritten by a redeploy.
 */
async function seedFlows(tenantId: string): Promise<void> {
  let created = 0;
  let updated = 0;
  let migratedBodies = 0;

  for (const node of FLOW_NODES) {
    const where = { tenantId_key: { tenantId, key: node.key } };
    const existing = await prisma.botFlow.findUnique({ where });

    const structure = {
      name: node.name,
      nodeType: node.nodeType,
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
    };

    if (existing) {
      /**
       * Menus used to spell their options out in the body and end with
       * "Reply with the option number." Those options now live only in
       * `options`, so a body still carrying that trailer would show every
       * choice twice. Refresh exactly those, and nothing else - a body that has
       * been edited in the admin panel no longer matches the marker and is left
       * untouched, which is the whole point of preserving copy here.
       */
      const isLegacyMenuBody =
        node.nodeType === 'MENU' &&
        /Reply with the option number\.|Reply \*1\* to REGISTER/i.test(existing.body);

      await prisma.botFlow.update({
        where,
        data: isLegacyMenuBody ? { ...structure, body: node.body } : structure,
      });
      if (isLegacyMenuBody) migratedBodies++;
      updated++;
    } else {
      await prisma.botFlow.create({
        data: {
          tenantId,
          key: node.key,
          body: node.body,
          imageUrl: node.imageUrl ?? null,
          linkUrl: node.linkUrl ?? null,
          ...structure,
        },
      });
      created++;
    }
  }

  console.log(`  bot flows: ${created} created, ${updated} updated, ${migratedBodies} menu bodies migrated to tappable menus (edited copy preserved)`);
}

async function main(): Promise<void> {
  console.log('Seeding GloAro database...');
  const tenantId = await seedTenant();
  await seedAdminUser();
  await seedSettings(tenantId);
  await seedFlows(tenantId);
  console.log('Seed complete.');
  console.log('Next: log in and add a WhatsApp channel under Settings → WhatsApp.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
