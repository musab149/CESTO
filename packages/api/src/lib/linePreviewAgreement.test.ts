// ─── Contract test · the preview and the order must cost the same ─────────
//
// Run:  cd packages/api && npm run test:line-preview
//
// A discount is typed into the order builder (admin's screen and the rep's),
// which shows a line total, a subtotal, an IVA split and a total BEFORE any
// order exists. Those four figures come from packages/shared's
// previewLineTotal, in plain numbers. The order itself is written by
// createOrder and editOrder from lib/orderTotals' lineTotal, in Decimal.
//
// Two implementations of one rule, which is tolerable — the preview cannot
// have Decimal and the ledger cannot have floats — but only while they agree.
// Disagreement here is not a crash: the rep reads a price to the customer at
// the counter, and a different one is what the customer is charged.
//
// The shared functions are REQUIRED, not imported, and that is the whole
// trick. This package cannot import `@grocery-app/shared` - its barrel
// re-exports a .tsx and ts-node-dev falls over on it at runtime - and a
// relative `import` of the file reaches outside `rootDir`, which fails the
// build that Render runs. A `require` is invisible to tsc and resolved by
// ts-node, which compiles the .ts for us: the build stays clean, the test
// still runs the REAL shared code rather than a copy of it, and nothing here
// is ever loaded by the server.
//
// The shape below is hand-written, so a renamed export fails loudly here at
// runtime rather than quietly passing. Behaviour is what this test is for.
import assert from 'assert';
import { Prisma } from '@prisma/client';
import { lineTotal, computeOrderTotals, lineDiscountFromUnit } from './orderTotals';

interface TypedLine { unitPrice: number; quantity: number; discount?: string; unitDiscount?: string }
const {
  previewLineTotal, previewSubtotal, discountEuros,
// eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('../../../shared/src/orderLinePreview') as {
  previewLineTotal: (line: TypedLine) => number;
  previewSubtotal: (lines: TypedLine[]) => number;
  discountEuros: (raw: string | null | undefined) => number;
};

for (const [name, fn] of Object.entries({ previewLineTotal, previewSubtotal, discountEuros })) {
  if (typeof fn !== 'function') {
    throw new Error(`shared/src/orderLinePreview no longer exports ${name}`);
  }
}

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

/** What the server would store, in cents, for a line typed on the screen. */
function serverCents(unitPrice: number, quantity: number, typed?: string): number {
  const off = discountEuros(typed);
  return Math.round(Number(lineTotal({
    unit_price: new Prisma.Decimal(unitPrice.toFixed(2)),
    quantity,
    // Zero is no discount, which is how both builders send it: the field is
    // omitted on create and `set_discount: 0` clears it on edit.
    discount_amount: off > 0 ? new Prisma.Decimal(off.toFixed(2)) : null,
  })) * 100);
}

function previewCents(unitPrice: number, quantity: number, typed?: string): number {
  return Math.round(previewLineTotal({ unitPrice, quantity, discount: typed }) * 100);
}

/**
 * The table both sides answer. Every row is something a rep can actually type
 * at a counter, including the ones that are half-typed.
 */
const rows: Array<{ what: string; price: number; qty: number; typed?: string; cents: number }> = [
  { what: 'no discount at all', price: 12, qty: 1, typed: undefined, cents: 1200 },
  { what: 'an empty field', price: 12, qty: 1, typed: '', cents: 1200 },
  { what: 'a typed zero', price: 12, qty: 1, typed: '0', cents: 1200 },
  { what: 'a lone separator', price: 12, qty: 1, typed: ',', cents: 1200 },
  { what: 'a half-written figure', price: 12, qty: 1, typed: '1.', cents: 1100 },
  { what: 'a comma, as a Spanish keyboard gives it', price: 12, qty: 1, typed: '1,50', cents: 1050 },
  { what: 'euros off a single line', price: 12, qty: 1, typed: '5', cents: 700 },
  { what: 'FLAT off the LINE, not per unit', price: 2.5, qty: 3, typed: '1', cents: 650 },
  { what: 'cents, where floats go wrong if nobody rounds', price: 1.99, qty: 3, typed: '0.99', cents: 498 },
  { what: 'the whole line given away', price: 12, qty: 1, typed: '12', cents: 0 },
  { what: 'MORE than the line — clamped, not negative', price: 12, qty: 1, typed: '20', cents: 0 },
  { what: 'more than the line after a quantity drop', price: 5, qty: 1, typed: '5.50', cents: 0 },
];

for (const r of rows) {
  test(`${r.what}: the screen says ${(r.cents / 100).toFixed(2)}`, () => {
    assert.equal(previewCents(r.price, r.qty, r.typed), r.cents);
  });
  test(`${r.what}: ...and so does the order`, () => {
    assert.equal(serverCents(r.price, r.qty, r.typed), r.cents,
      'the preview and the written order disagree about this line');
  });
}

test('A WHOLE BASKET agrees, which is the figure that gets read out loud', () => {
  const basket = rows.map((r) => ({ unitPrice: r.price, quantity: r.qty, discount: r.typed }));
  const preview = Math.round(previewSubtotal(basket) * 100);

  const written = computeOrderTotals(
    basket.map((l) => {
      const off = discountEuros(l.discount);
      return {
        unit_price: new Prisma.Decimal(l.unitPrice.toFixed(2)),
        quantity: l.quantity,
        discount_amount: off > 0 ? new Prisma.Decimal(off.toFixed(2)) : null,
      };
    }),
    new Prisma.Decimal(0),
  );

  assert.equal(preview, Math.round(Number(written.subtotal) * 100));
  assert.equal(preview, rows.reduce((s, r) => s + r.cents, 0));
});

test('a discount never turns a basket negative', () => {
  // The clamp is per line, so one wildly over-discounted line cannot eat into
  // what the rest of the basket costs.
  const subtotal = previewSubtotal([
    { unitPrice: 2, quantity: 1, discount: '999' },
    { unitPrice: 10, quantity: 1 },
  ]);
  assert.equal(Math.round(subtotal * 100), 1000);
});

// ─── Per unit (2026-10-25) ──────────────────────────────
// A discount is now euros off ONE unit: a €4 product with €2 off costs €2
// each. The server writes the line's flat figure as unit × quantity
// (lineDiscountFromUnit); the screen previews the same, in cents.
function serverUnitCents(unitPrice: number, quantity: number, typedUnit: string): number {
  const off = discountEuros(typedUnit);
  return Math.round(Number(lineTotal({
    unit_price: new Prisma.Decimal(unitPrice.toFixed(2)),
    quantity,
    discount_amount: lineDiscountFromUnit(off > 0 ? new Prisma.Decimal(off.toFixed(2)) : null, quantity),
  })) * 100);
}
const unitRows: Array<{ what: string; price: number; qty: number; unit: string; cents: number }> = [
  { what: "the user's example: €4 with €2 off", price: 4, qty: 1, unit: '2', cents: 200 },
  { what: '...ten of them', price: 4, qty: 10, unit: '2', cents: 2000 },
  { what: 'per unit, where floats go wrong (0.10 × 3)', price: 1.99, qty: 3, unit: '0.1', cents: 567 },
  { what: 'a comma off each', price: 2.5, qty: 4, unit: '0,25', cents: 900 },
  { what: 'an empty field is no discount', price: 4, qty: 2, unit: '', cents: 800 },
  { what: 'more off each than it costs — clamped', price: 4, qty: 3, unit: '5', cents: 0 },
];
for (const r of unitRows) {
  test(`per unit — ${r.what}: the screen says ${(r.cents / 100).toFixed(2)}`, () => {
    assert.equal(Math.round(previewLineTotal({ unitPrice: r.price, quantity: r.qty, unitDiscount: r.unit }) * 100), r.cents);
  });
  test(`per unit — ${r.what}: ...and so does the order`, () => {
    assert.equal(serverUnitCents(r.price, r.qty, r.unit), r.cents, 'the preview and the written order disagree about this line');
  });
}
test('a per-unit figure decides the line even when a flat one is also there', () => {
  assert.equal(Math.round(previewLineTotal({ unitPrice: 4, quantity: 2, discount: '7', unitDiscount: '1' }) * 100), 600);
});

test('discountEuros refuses anything that is not money', () => {
  for (const junk of [undefined, null, '', ' ', '-', '-5', 'abc', 'NaN', '0,00']) {
    assert.equal(discountEuros(junk), 0, `"${junk}" read as a discount`);
  }
  assert.equal(discountEuros('0.01'), 0.01);
  assert.equal(discountEuros('1,5'), 1.5);
});

let failures = 0;
for (const { name, run } of cases) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    console.error(`  FAIL ${name}\n      ${msg.replace(/\n/g, '\n      ')}`);
  }
}
console.log(`\n${cases.length - failures}/${cases.length} passed`);
if (failures > 0) process.exit(1);
