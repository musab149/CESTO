// ─── Read-only · dump the delivery-zone / store / product picture ───
//
// Companion to differentiate-test-zones.mjs. Answers "what would location
// filtering actually do against this database?" before deciding whether to
// change anything.
//
// Writes NOTHING. Safe against any database, including production.
//
//   cd packages/api
//   DATABASE_URL="<url>" node scripts/inspect-zones.mjs

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const stores = await prisma.store.findMany({
    where: { deleted_at: null },
    select: { id: true, name: true, status: true, _count: { select: { products: true } } },
    orderBy: { name: 'asc' },
  });

  const zones = await prisma.deliveryZone.findMany({
    where: { is_active: true },
    select: { name: true, store_id: true, postcodes: true },
  });

  const cesto = await prisma.product.count({ where: { is_active: true, store_id: null } });

  console.log(`--- STORES (${stores.length}) ---`);
  const byStore = new Map();
  for (const z of zones) if (z.store_id) byStore.set(z.store_id, [...(byStore.get(z.store_id) ?? []), z]);
  for (const s of stores) {
    const zs = byStore.get(s.id) ?? [];
    const desc = zs.length === 0
      ? 'NO ZONES → serves everywhere'
      : zs.map((z) => `${z.name} [${z.postcodes.length}pc]`).join(' + ');
    console.log(`${s.name.padEnd(26)} ${s.status.padEnd(10)} ${String(s._count.products).padStart(5)} products   ${desc}`);
  }

  const platform = zones.filter((z) => !z.store_id);
  console.log(`\n--- PLATFORM ZONES (${platform.length}) — Cesto's own area, never modified by the seeding script ---`);
  for (const z of platform) console.log(`${String(z.name).padEnd(26)} ${z.postcodes.length}pc  ${JSON.stringify(z.postcodes)}`);

  console.log(`\nCesto's own catalogue (store_id = NULL): ${cesto} active products — always serviceable everywhere.`);

  // What the filter does today, per postcode.
  const live = stores.filter((s) => s.status === 'live').map((s) => s.id);
  const restricted = [...new Set(zones.filter((z) => z.store_id).map((z) => z.store_id))];
  const candidates = [...new Set(zones.flatMap((z) => z.postcodes))].sort().slice(0, 4);

  console.log('\n--- WHAT LOCATION FILTERING DOES TODAY ---');
  for (const pc of [...candidates, '28080']) {
    const covering = zones.filter((z) => z.store_id && z.postcodes.includes(pc)).map((z) => z.store_id);
    const visible = live.filter((id) => covering.includes(id) || !restricted.includes(id));
    const names = stores.filter((s) => visible.includes(s.id)).map((s) => s.name);
    const products = visible.reduce((n, id) => n + (stores.find((s) => s.id === id)?._count.products ?? 0), cesto);
    console.log(`${pc}  ${String(visible.length).padStart(2)} stores  ${String(products).padStart(5)} products   ${names.join(', ') || '(none — Cesto only)'}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
