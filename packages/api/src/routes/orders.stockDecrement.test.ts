/**
 * decrementStock() — the batched stock write in the checkout transaction.
 *
 *   npm run test:stock-decrement --workspace=packages/api
 *
 * Runs against a real database because the whole point of this function is a
 * hand-written SQL statement: a CTE that takes row locks in id order, an
 * `unnest` join carrying per-variant quantities, and a RETURNING clause the
 * low-stock ping depends on. None of that is exercised by typechecking, and
 * getting it wrong corrupts stock on every checkout.
 *
 * Every case runs inside a transaction that is deliberately rolled back, so
 * the catalogue is left exactly as it was found.
 */
import assert from 'assert';
import prisma from '../lib/prisma';
import { decrementStock } from './orders';

/** Rollback sentinel — thrown to abort the tx once assertions have run. */
class Rollback extends Error {}

/** Run `fn` inside a transaction that always rolls back. */
async function inRolledBackTx(fn: (tx: any) => Promise<void>): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

function stub(id: string) {
  return {
    variantId: id,
    quantity: 0,
    variant: {
      product_id: 'p', name_es: 'v', name_en: 'v',
      product: { name_es: 'p', name_en: 'p' },
    },
  };
}

const cases: Array<{ name: string; run: () => Promise<void> }> = [];
const test = (name: string, run: () => Promise<void>) => cases.push({ name, run });

test('decrements several variants in one statement and returns new levels', async () => {
  const variants = await prisma.productVariant.findMany({
    take: 5,
    orderBy: { id: 'asc' },
    select: { id: true, stock_quantity: true, low_stock_threshold: true },
  });
  assert.ok(variants.length >= 2, 'need at least 2 variants seeded to test this');

  await inRolledBackTx(async (tx) => {
    const decs = variants.map((v, i) => ({ ...stub(v.id), quantity: i + 1 }));
    const rows = await decrementStock(tx, decs);

    assert.equal(rows.size, variants.length, 'every variant should come back');

    for (const [i, v] of variants.entries()) {
      const row = rows.get(v.id);
      assert.ok(row, `missing row for ${v.id}`);
      assert.equal(
        row!.stock_quantity,
        v.stock_quantity - (i + 1),
        'RETURNING must report the post-decrement level',
      );
      assert.equal(row!.low_stock_threshold, v.low_stock_threshold);
    }

    // And the rows are genuinely written, not just reported.
    const reread = await tx.productVariant.findUnique({
      where: { id: variants[0].id },
      select: { stock_quantity: true },
    });
    assert.equal(reread!.stock_quantity, variants[0].stock_quantity - 1);
  });
});

test('two lines on the same variant are summed, not applied once', async () => {
  // UPDATE … FROM applies a single matching source row when there are
  // duplicates, so an un-aggregated implementation silently loses a decrement.
  const v = await prisma.productVariant.findFirst({
    orderBy: { id: 'asc' },
    select: { id: true, stock_quantity: true },
  });
  assert.ok(v, 'need a variant');

  await inRolledBackTx(async (tx) => {
    const rows = await decrementStock(tx, [
      { ...stub(v!.id), quantity: 2 },
      { ...stub(v!.id), quantity: 3 },
    ]);
    assert.equal(rows.size, 1);
    assert.equal(
      rows.get(v!.id)!.stock_quantity,
      v!.stock_quantity - 5,
      'both lines must be taken',
    );
  });
});

test('an unknown variant id is simply absent from the result', async () => {
  // The caller treats a missing row as "no longer available" and aborts the
  // transaction, matching what P2025 from the old per-row update did.
  await inRolledBackTx(async (tx) => {
    const rows = await decrementStock(tx, [
      { ...stub('00000000-0000-0000-0000-000000000000'), quantity: 1 },
    ]);
    assert.equal(rows.size, 0);
  });
});

test('an empty list is a no-op and issues no query', async () => {
  await inRolledBackTx(async (tx) => {
    const rows = await decrementStock(tx, []);
    assert.equal(rows.size, 0);
  });
});

test('one statement regardless of cart size — 40 lines still one round trip', async () => {
  const variants = await prisma.productVariant.findMany({
    take: 40,
    orderBy: { id: 'asc' },
    select: { id: true, stock_quantity: true },
  });
  assert.ok(variants.length >= 10, 'need a reasonable catalogue to test scale');

  await inRolledBackTx(async (tx) => {
    const started = Date.now();
    const rows = await decrementStock(
      tx,
      variants.map((v) => ({ ...stub(v.id), quantity: 1 })),
    );
    const ms = Date.now() - started;

    assert.equal(rows.size, variants.length);
    for (const v of variants) {
      assert.equal(rows.get(v.id)!.stock_quantity, v.stock_quantity - 1);
    }
    console.log(`         ${variants.length} variants decremented in ${ms}ms`);
  });
});

test('rollback really does restore stock', async () => {
  // Guards the harness itself: if the rollback leaked, every case above would
  // be quietly corrupting the catalogue it measured against.
  const before = await prisma.productVariant.findFirst({
    orderBy: { id: 'asc' },
    select: { id: true, stock_quantity: true },
  });

  await inRolledBackTx(async (tx) => {
    await decrementStock(tx, [{ ...stub(before!.id), quantity: 7 }]);
  });

  const after = await prisma.productVariant.findUnique({
    where: { id: before!.id },
    select: { stock_quantity: true },
  });
  assert.equal(after!.stock_quantity, before!.stock_quantity, 'stock must be unchanged');
});

// ─── Runner ──────────────────────────────────────────────

(async () => {
  let failures = 0;
  for (const { name, run } of cases) {
    try {
      await run();
      console.log(`  ok  ${name}`);
    } catch (e) {
      failures++;
      const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
      console.error(`  FAIL ${name}\n      ${msg.replace(/\n/g, '\n      ')}`);
    }
  }
  console.log(`\n${cases.length - failures}/${cases.length} passed`);
  await prisma.$disconnect();
  if (failures > 0) process.exit(1);
})();
