// ─── Dev/staging utility · differentiate delivery zones for MV Slice 5 testing ───
//
// WHY THIS EXISTS
//
// Migration `20260728140000_backfill_store_zones` gave every zoneless live
// store the SAME zone — the union of the platform zones' postcodes. That is
// deliberately conservative: it preserves the status quo rather than inventing
// service areas on partners' behalf.
//
// The side effect is that location filtering becomes unobservable. Every store
// covers every platform postcode, so picking an area inside Madrid looks
// identical to Global, and picking one outside hides all partners at once.
// There is no middle ground to test against.
//
// This script carves the seeded stores into distinct areas so the filter has
// something to actually discriminate on:
//
//   · one store north-only          → appears for 28001-28005
//   · one store south-only          → appears for 28016-28020
//   · one store straddling both     → proves overlap resolves correctly
//   · one store with NO zones       → proves "no zones = serves everywhere",
//                                     the rule most likely to be misread as a bug
//
// Every other store keeps its default zone as a control group.
//
// SAFETY
//
//   · Touches ONLY the `delivery_zones` table. No products, orders, or users.
//   · Never touches PLATFORM zones (store_id IS NULL) — those define Cesto's
//     own delivery area and drive real fees.
//   · Matches stores BY NAME, so it works across databases with different ids.
//     A store that isn't present is skipped with a notice, not an error.
//   · Idempotent: re-running produces the same end state.
//   · REFUSES TO RUN against a URL containing 'prod'. This is test data.
//
// USAGE
//
//   cd packages/api
//   DATABASE_URL="<staging connection string>" node scripts/differentiate-test-zones.mjs
//
//   Add --dry to preview without writing.

import { PrismaClient } from '@prisma/client';

const DRY = process.argv.includes('--dry');

// Postcodes are deliberately drawn from the platform zones' range so the
// resulting areas stay inside territory the platform genuinely serves.
const PLAN = [
  { name: 'Em Partner',          zone: 'Madrid Centro Norte',    postcodes: ['28001', '28002', '28003', '28004', '28005'] },
  { name: 'Shaikh Cash & Carry', zone: 'Madrid Sur',             postcodes: ['28016', '28017', '28018', '28019', '28020'] },
  { name: 'Mundi Cash & Carry',  zone: 'Centro + Sur (parcial)', postcodes: ['28005', '28016'] },
  // null = remove all zones, making the store unrestricted (serves everywhere).
  { name: 'AliBaba Cash & Carry', zone: null,                    postcodes: null },
];

const url = process.env.DATABASE_URL ?? '';
if (!url) {
  console.error('DATABASE_URL is not set. Refusing to guess.');
  process.exit(1);
}
if (/prod/i.test(url)) {
  console.error('DATABASE_URL looks like production. This script seeds TEST data — refusing.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  console.log(DRY ? '· DRY RUN — no writes ·\n' : '· applying ·\n');

  // store_id -> the zones it will hold AFTER the plan is applied. A dry run
  // writes nothing, so reporting straight from the database would describe the
  // CURRENT state while appearing to describe the outcome — which is how the
  // first staging dry run read as "this plan achieves nothing". Projecting from
  // this map makes --dry and a real run print the same table.
  const plannedZones = new Map();

  for (const step of PLAN) {
    const store = await prisma.store.findFirst({
      where: { name: step.name, deleted_at: null },
      select: { id: true, name: true, status: true },
    });

    if (!store) {
      console.log(`skip  ${step.name.padEnd(24)} not found in this database`);
      continue;
    }

    if (step.postcodes === null) {
      const existing = await prisma.deliveryZone.count({ where: { store_id: store.id } });
      if (existing === 0) {
        plannedZones.set(store.id, []);
        console.log(`ok    ${store.name.padEnd(24)} already unrestricted (no zones)`);
        continue;
      }
      if (!DRY) await prisma.deliveryZone.deleteMany({ where: { store_id: store.id } });
      plannedZones.set(store.id, []);
      console.log(`WRITE ${store.name.padEnd(24)} removed ${existing} zone(s) → serves everywhere`);
      continue;
    }

    const zones = await prisma.deliveryZone.findMany({
      where: { store_id: store.id, is_active: true },
      select: { id: true, postcodes: true },
    });

    if (zones.length === 0) {
      // The store was already unrestricted, or its zones are inactive. Create
      // one rather than silently doing nothing, so the plan is honoured either way.
      if (!DRY) {
        await prisma.deliveryZone.create({
          data: { name: step.zone, postcodes: step.postcodes, store_id: store.id, is_active: true },
        });
      }
      plannedZones.set(store.id, [step.postcodes]);
      console.log(`WRITE ${store.name.padEnd(24)} created "${step.zone}" (${step.postcodes.length} pc)`);
      continue;
    }

    const same =
      zones.length === 1 &&
      zones[0].postcodes.length === step.postcodes.length &&
      step.postcodes.every((pc) => zones[0].postcodes.includes(pc));

    if (same) {
      plannedZones.set(store.id, [step.postcodes]);
      console.log(`ok    ${store.name.padEnd(24)} already "${step.zone}"`);
      continue;
    }

    if (!DRY) {
      await prisma.deliveryZone.updateMany({
        where: { store_id: store.id, is_active: true },
        data: { name: step.zone, postcodes: step.postcodes },
      });
    }
    plannedZones.set(store.id, [step.postcodes]);
    console.log(`WRITE ${store.name.padEnd(24)} → "${step.zone}" (${step.postcodes.join(', ')})`);
  }

  await report(plannedZones);
}

/**
 * Predict what each postcode will show, applying the same rule as
 * lib/location-scope.ts: a store is serviceable if a zone of its own covers
 * the postcode, OR if it never drew a zone at all.
 */
async function report(plannedZones) {
  const names = Object.fromEntries(
    (await prisma.store.findMany({ select: { id: true, name: true } })).map((s) => [s.id, s.name]),
  );
  const live = (
    await prisma.store.findMany({
      where: { status: 'live', deleted_at: null, deletion_scheduled_at: null },
      select: { id: true },
    })
  ).map((s) => s.id);

  // Empty-postcode zones are ignored here for the same reason lib/location-scope.ts
  // ignores them: a zone reaching nobody cannot restrict a store, it can only
  // erase it. Counting one as a restriction is how staging's backfilled stores
  // came to be invisible at every postcode.
  const dbZones = (
    await prisma.deliveryZone.findMany({
      where: { is_active: true, store_id: { not: null }, postcodes: { isEmpty: false } },
      select: { store_id: true, postcodes: true },
    })
  ).filter((z) => !plannedZones.has(z.store_id));

  const zonesFor = (id) =>
    plannedZones.get(id) ?? dbZones.filter((z) => z.store_id === id).map((z) => z.postcodes);

  const restricted = live.filter((id) => zonesFor(id).some((pcs) => pcs.length > 0));

  console.log('\n--- expected results (MV_STOREFRONT=true) ---');
  for (const pc of ['28001', '28005', '28012', '28018', '28080']) {
    const visible = live.filter(
      (id) => zonesFor(id).some((pcs) => pcs.includes(pc)) || !restricted.includes(id),
    );
    const products = await prisma.product.count({
      where: { is_active: true, OR: [{ store_id: null }, { store_id: { in: visible } }] },
    });
    console.log(
      `${pc}  ${String(visible.length).padStart(2)} stores  ${String(products).padStart(5)} products   ${visible
        .map((i) => names[i])
        .join(', ')}`,
    );
  }
  console.log('\n"All areas" should show every live store and the full catalogue.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
