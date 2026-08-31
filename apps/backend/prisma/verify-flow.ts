/**
 * Pre-handover check: does the *live* database hold a complete, walkable flow?
 *
 * The failure this exists to catch is silent from the outside. A menu option
 * whose destination row is absent makes the engine log and return no messages,
 * so the bot renders a menu and then ignores whatever the customer taps - it
 * looks like the webhook is down, not like missing data.
 *
 * Reads only. Point DATABASE_URL at any environment and run:
 *
 *   npx ts-node prisma/verify-flow.ts
 *
 * Exits non-zero if anything is unreachable, so CI can gate on it.
 */
import { PrismaClient } from '@prisma/client';
import { FLOW_NODES } from '../src/bot/flow-definition';

const prisma = new PrismaClient();

interface Option {
  key: string;
  label: string;
  next: string;
}

function optionsOf(raw: unknown): Option[] {
  return Array.isArray(raw) ? (raw as Option[]) : [];
}

async function main(): Promise<void> {
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  if (!tenants.length) {
    console.log('No tenants found - nothing to check.');
    return;
  }

  let problems = 0;

  for (const tenant of tenants) {
    const rows = await prisma.botFlow.findMany({
      where: { tenantId: tenant.id },
      select: { key: true, name: true, nodeType: true, options: true, nextKey: true },
    });
    const live = new Map(rows.map((r) => [r.key, r]));

    console.log(`\n=== ${tenant.slug} (${rows.length} nodes in database) ===`);

    // 1. Nodes the code knows about that the database has never heard of.
    const absent = FLOW_NODES.filter((n) => !live.has(n.key));
    if (absent.length) {
      problems += absent.length;
      console.log(`\n  MISSING FROM DATABASE (${absent.length}):`);
      for (const n of absent) console.log(`    - ${n.key}  [${n.nodeType}]`);
    }

    // 2. Dead ends: a row that exists but points somewhere the database does
    //    not have. This is the case a create-only boot sync cannot repair,
    //    because the node itself is present - only its target is gone.
    const dead: string[] = [];
    for (const row of rows) {
      for (const o of optionsOf(row.options)) {
        if (!live.has(o.next)) dead.push(`${row.key} option "${o.label}" -> ${o.next}`);
      }
      if (row.nextKey && !live.has(row.nextKey)) {
        dead.push(`${row.key} nextKey -> ${row.nextKey}`);
      }
    }
    if (dead.length) {
      problems += dead.length;
      console.log(`\n  DEAD ENDS (${dead.length}) - these tap and get no reply:`);
      for (const d of dead) console.log(`    - ${d}`);
    }

    // 3. Nodes no menu or nextKey leads to. Not fatal - WELCOME is one by
    //    definition - but an unreachable branch is usually a mistake.
    const referenced = new Set<string>(['WELCOME']);
    for (const row of rows) {
      for (const o of optionsOf(row.options)) referenced.add(o.next);
      if (row.nextKey) referenced.add(row.nextKey);
    }
    const orphans = rows.filter((r) => !referenced.has(r.key));
    if (orphans.length) {
      console.log(`\n  UNREACHABLE (${orphans.length}) - no menu leads here:`);
      for (const o of orphans) console.log(`    - ${o.key}`);
    }

    if (!absent.length && !dead.length) {
      const menus = rows.filter((r) => r.nodeType === 'MENU');
      console.log(`  OK - every option and nextKey resolves (${menus.length} menus).`);
    }
  }

  console.log(
    problems
      ? `\nFAILED: ${problems} problem(s). Run "npx prisma db seed" against this database.`
      : '\nPASSED: the flow is complete and every path is walkable.',
  );
  if (problems) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
