// ─── Pre-flight inspection for the staging→master promotion ───
//
// READ-ONLY. Safe against production.
//
// Why this exists separately from inspect-zones.mjs: that script goes through
// the Prisma client, which is generated from the STAGING schema and expects
// columns production does not have yet (stores.status, delivery_zones.store_id,
// stores.created_via …). Pointed at production it dies with P2022 before
// printing anything useful.
//
// This one uses raw SQL and checks information_schema first, so it adapts to
// whichever migrations the target database has actually applied. That means it
// can be run against production BEFORE the promotion and again AFTER, and the
// output is comparable.
//
//   cd packages/api
//   DATABASE_URL="<prod>" node scripts/preflight-prod.mjs

import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const url = process.env.DATABASE_URL ?? '';
if (!url) {
  console.error('DATABASE_URL is not set. Refusing to guess.');
  process.exit(1);
}

const prisma = new PrismaClient();
const q = (sql, ...args) => prisma.$queryRawUnsafe(sql, ...args);

/** Does a column exist? Lets one script serve both schema generations. */
async function hasColumn(table, column) {
  const rows = await q(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    table, column,
  );
  return rows.length > 0;
}

async function hasTable(table) {
  const rows = await q(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`,
    table,
  );
  return rows.length > 0;
}

const n = (v) => Number(v ?? 0);

async function main() {
  // ── which generation of the schema is this? ────────────
  const zoneHasStore   = await hasColumn('delivery_zones', 'store_id');
  const storeHasStatus = await hasColumn('stores', 'status');
  const storeHasOrigin = await hasColumn('stores', 'created_via');
  const hasRoles       = await hasTable('partner_store_roles');

  console.log('─── Schema generation ───');
  console.log(`  delivery_zones.store_id   ${zoneHasStore   ? 'present  (mv Slice 0 applied)' : 'ABSENT   (pre-mv)'}`);
  console.log(`  stores.status             ${storeHasStatus ? 'present  (mv Slice 0 applied)' : 'ABSENT   (pre-mv)'}`);
  console.log(`  stores.created_via        ${storeHasOrigin ? 'present  (store-linking applied)' : 'ABSENT   (not yet promoted)'}`);
  console.log(`  partner_store_roles       ${hasRoles       ? 'present' : 'ABSENT   (pre-mv)'}`);

  // ── P2: the number that decides backfill_store_zones ───
  const zoneRows = await q(
    zoneHasStore
      ? `SELECT name, postcodes, is_active FROM delivery_zones WHERE store_id IS NULL ORDER BY name`
      : `SELECT name, postcodes, is_active FROM delivery_zones ORDER BY name`,
  );
  const active = zoneRows.filter((z) => z.is_active !== false);
  const union = [...new Set(active.flatMap((z) => z.postcodes ?? []))].sort();

  console.log(`\n─── PLATFORM zones (${zoneRows.length}) ───`);
  if (!zoneHasStore) {
    console.log('  (no store_id column, so every zone here is platform-wide)');
  }
  for (const z of zoneRows) {
    console.log(`  ${String(z.name).padEnd(22)} ${(z.postcodes ?? []).length} pc  active=${z.is_active}`);
  }
  console.log(`\n  Union of ACTIVE platform postcodes: ${union.length}`);
  if (union.length) console.log(`  ${JSON.stringify(union.slice(0, 24))}${union.length > 24 ? ' …' : ''}`);

  console.log('\n  → backfill_store_zones will seed each zoneless live store with');
  console.log(`    these ${union.length} postcode(s).`);
  if (union.length === 0) {
    console.log('    ⚠ EMPTY. It will create zones covering nothing, exactly as on');
    console.log('      staging. 20260728180000_drop_empty_backfilled_zones deletes');
    console.log('      them immediately after, and location-scope.ts ignores empty');
    console.log('      zones regardless — so the end state is correct either way.');
  }

  // ── P3/P4: who owns what ───────────────────────────────
  if (hasRoles) {
    const [{ count }] = await q(`SELECT count(*)::int AS count FROM partner_store_roles`);
    console.log(`\n─── Partner roles: ${count}`);
    if (n(count) > 0) console.log('  ⚠ Expected 0 on production — mv has never been promoted. Investigate.');
  } else {
    console.log('\n─── Partner roles: table does not exist (expected pre-mv)');
  }

  // ── baseline for post-deploy verification ──────────────
  const storeCols = ['id', 'name', 'is_active'];
  if (storeHasStatus) storeCols.push('status');
  const stores = await q(
    `SELECT ${storeCols.join(', ')} FROM stores ORDER BY name`,
  );
  const prodCounts = await q(
    `SELECT store_id, count(*)::int AS c FROM products WHERE is_active = true GROUP BY store_id`,
  );
  const byStore = new Map(prodCounts.map((r) => [r.store_id, r.c]));
  const cesto = byStore.get(null) ?? 0;

  console.log(`\n─── Stores (${stores.length}) — baseline for V1/V2 ───`);
  for (const s of stores) {
    console.log(`  ${String(s.name).padEnd(28)} ${String(s.status ?? (s.is_active ? 'active' : 'inactive')).padEnd(9)} ${String(byStore.get(s.id) ?? 0).padStart(5)} products`);
  }
  console.log(`  ${'Cesto (store_id NULL)'.padEnd(28)} ${''.padEnd(9)} ${String(cesto).padStart(5)} products`);

  const [{ total }] = await q(`SELECT count(*)::int AS total FROM products WHERE is_active = true`);
  const [{ orders }] = await q(`SELECT count(*)::int AS orders FROM orders`);
  console.log(`\n  Active products total: ${total}`);
  console.log(`  Orders total:          ${orders}`);

  // ── P5: order-number format in the wild ────────────────
  const recent = await q(`SELECT order_number FROM orders ORDER BY created_at DESC LIMIT 5`);
  console.log('\n─── Most recent order numbers (P5) ───');
  for (const r of recent) console.log(`  ${r.order_number}`);
  console.log('  New orders will now use an 8-character suffix (Wave A).');

  // ── leads, which one migration rewrites ────────────────
  if (await hasTable('b2b_leads')) {
    const types = await q(`SELECT type, count(*)::int AS c FROM b2b_leads GROUP BY type ORDER BY type`);
    console.log('\n─── b2b_leads.type before the remap ───');
    for (const t of types) console.log(`  ${String(t.type).padEnd(16)} ${t.c}`);
    console.log('  Remap: supplier → partner_store, partner → business.');

    // The remap rewrites real rows, so make them eyeballable before it runs.
    // Pass --leads to print what each one actually says: the source form and
    // the company name are usually enough to tell a wholesale BUYER from a
    // seller wanting to trade on Cesto.
    if (process.argv.includes('--leads')) {
      const rows = await q(
        `SELECT type, source, name, company, email, created_at,
                intent, business_type, message, shops
           FROM b2b_leads ORDER BY type, created_at DESC`,
      );
      console.log('\n─── Every lead, so the remap can be sanity-checked ───');
      console.log('  A "partner" row came from /b2b-deals — the BUYER pitch — and');
      console.log('  becomes `business`. A "supplier" row came from /partner-deals');
      console.log('  — the SELLER pitch — and becomes `partner_store`.\n');
      let last = null;
      for (const r of rows) {
        if (r.type !== last) {
          const dest = r.type === 'partner' ? '→ business'
                     : r.type === 'supplier' ? '→ partner_store'
                     : '(unchanged)';
          console.log(`  ── ${r.type} ${dest}`);
          last = r.type;
        }
        const when = new Date(r.created_at).toISOString().slice(0, 10);
        console.log(`     ${when}  ${String(r.company || r.name).slice(0, 32).padEnd(34)} ${r.email}`);
        // `shops` is the decisive signal. It is the multi-shop payload from
        // the application form — addresses and coordinates of the premises
        // they trade from. A wholesale BUYER has no reason to list those; a
        // seller onboarding their branches does.
        const shops = Array.isArray(r.shops) ? r.shops : [];
        const bits = [];
        bits.push(`intent=${r.intent ?? '—'}`);
        if (r.business_type) bits.push(`type=${String(r.business_type).slice(0, 24)}`);
        bits.push(`shops=${shops.length}${shops.length ? ' ← SELLER SIGNAL' : ''}`);
        console.log(`        ${bits.join('  ')}`);
        if (r.message) {
          const m = String(r.message).replace(/\s+/g, ' ').trim().slice(0, 110);
          if (m) console.log(`        "${m}${String(r.message).length > 110 ? '…' : ''}"`);
        }
      }

      // Roll it up, because 25 rows of detail is hard to judge in aggregate.
      const partners = rows.filter((r) => r.type === 'partner');
      const withShops = partners.filter((r) => Array.isArray(r.shops) && r.shops.length > 0).length;
      const sellerIntent = partners.filter((r) => r.intent === 'supplier' || r.intent === 'partner').length;
      console.log('\n  ── Verdict on the rows about to become `business`');
      console.log(`     listed premises (shops[]): ${withShops} of ${partners.length}`);
      console.log(`     intent says seller:        ${sellerIntent} of ${partners.length}`);
      if (withShops > partners.length / 2) {
        console.log('     ⚠ Most of them listed premises. That is a seller application.');
        console.log('       Remapping them to `business` files them in the wrong tab,');
        console.log('       and there is no UI to move a lead once filed.');
      }
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
