#!/usr/bin/env node
/**
 * Counts the SQL statements a catalogue listing issues.
 *
 * Run after any Prisma version bump, and any time someone widens the product
 * `select`. Read-only — safe against any database, including production.
 *
 *   node packages/api/scripts/bench-catalogue.mjs
 *
 * Why it matters here: the API (Render, virginia) and the database (Neon) are
 * far enough apart that one round trip measured ~300ms in production, against
 * 3-12ms for the same SQL locally. Statement COUNT, not statement cost, is
 * what makes the storefront slow — so this is the number to watch.
 *
 * Expected with `relationJoins` enabled (see the generator block in
 * schema.prisma): 1 statement for the rows, plus 1 for the total on a cold
 * count cache. If this starts printing 5 or 6, the join strategy has stopped
 * applying and the home page just got ~1.5s slower.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });

let statements = [];
prisma.$on('query', (e) => {
  const table = (e.query.split(' FROM ')[1] || '').split(' ')[0].replace(/"/g, '');
  statements.push({ table, ms: e.duration });
});

/** Prisma emits query events asynchronously; without this the count is short. */
const flush = () => new Promise((r) => setTimeout(r, 400));

// Mirrors what GET /api/products builds for an anonymous visitor browsing ES.
const visible = {
  OR: [
    { store_id: null },
    { store: { deletion_scheduled_at: null, deleted_at: null, status: 'live', is_test: false } },
  ],
};
const country = { OR: [{ store_id: null }, { store: { country: 'ES' } }] };
const where = { is_active: true, AND: [visible, country] };

const productSelect = {
  id: true, name_es: true, name_en: true, brand: true, origin: true,
  brand_ref: { select: { id: true, name: true, slug: true } },
  origin_ref: { select: { id: true, key: true } },
  store_id: true,
  store: { select: { id: true, slug: true, name: true } },
  category: { select: { id: true, name_es: true } },
  subcategory: { select: { id: true, name_es: true } },
  variants: { where: { is_active: true }, select: { id: true, price: true } },
  images: { select: { id: true, url: true } },
};

async function measure(label, fn) {
  statements = [];
  const t0 = Date.now();
  const out = await fn();
  await flush();
  const wall = Date.now() - t0;
  const sql = statements.reduce((a, s) => a + s.ms, 0);
  console.log(
    `  ${label.padEnd(34)} statements=${String(statements.length).padStart(2)}  sql=${String(sql).padStart(4)}ms  wall=${String(wall).padStart(4)}ms`,
  );
  if (statements.length > 1) {
    console.log(`      ${statements.map((s) => s.table).join(', ')}`);
  }
  return out;
}

const run = async () => {
  const total = await prisma.product.count();
  console.log(`\ncatalogue: ${total} products\n`);

  await prisma.product.findFirst();      // warm the pool + plan cache
  await flush();

  await measure('listing, join strategy', () =>
    prisma.product.findMany({
      where, select: productSelect, orderBy: { created_at: 'desc' }, take: 24,
      relationLoadStrategy: 'join',
    }));

  await measure('listing, per-relation strategy', () =>
    prisma.product.findMany({
      where, select: productSelect, orderBy: { created_at: 'desc' }, take: 24,
      relationLoadStrategy: 'query',
    }));

  await measure('listing, default strategy', () =>
    prisma.product.findMany({
      where, select: productSelect, orderBy: { created_at: 'desc' }, take: 24,
    }));

  await measure('count(where)  [memoised in the API]', () =>
    prisma.product.count({ where }));

  console.log(
    '\nExpected: join == default == 1 statement. If "default" matches the\n' +
    'per-relation number instead, relationJoins is no longer applying.\n',
  );
  await prisma.$disconnect();
};

run().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
