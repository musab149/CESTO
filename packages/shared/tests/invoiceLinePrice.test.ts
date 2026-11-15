/**
 * A factura line's price as its IVA changes (2026-11-04). What must hold:
 * the price shown is WITH IVA, as customers see it; a new rate re-adds IVA to
 * the same base, so the price follows the rate; going back to the charged
 * rate gives back the charged price exactly; and the base read out of a
 * charged price is the one it was charged from.
 *
 *   npm run test:invoice-line-price --workspace=packages/shared
 */
import assert from 'assert';
import { baseOfPriceCents, priceAtRate } from '../src/invoiceLinePrice';
import { addVatCents } from '../src/tax';

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  PASS  ${name}`);
};

check('a 0 % line at 2.00 set to 10 % costs 2.20; set back to 0 %, 2.00', () => {
  const charged = { priceCents: 200, baseCents: baseOfPriceCents(200, 0), ratePct: 0 };
  assert.equal(priceAtRate(charged.baseCents, 10, charged), 220);
  assert.equal(priceAtRate(charged.baseCents, 0, charged), 200);
});

check('a 10 % rice charged at 11.00 has base 10.00; at 21 % it costs 12.10', () => {
  const base = baseOfPriceCents(1100, 10);
  assert.equal(base, 1000);
  assert.equal(priceAtRate(base, 21, { priceCents: 1100, baseCents: base, ratePct: 10 }), 1210);
  assert.equal(priceAtRate(base, 4, { priceCents: 1100, baseCents: base, ratePct: 10 }), 1040);
});

check('a 4.00 fee at 21 % goes to 10 % and back to exactly 4.00 (3.31 + 21 % alone would be 4.01)', () => {
  const charged = { priceCents: 400, baseCents: baseOfPriceCents(400, 21), ratePct: 21 };
  assert.equal(charged.baseCents, 331);
  assert.equal(addVatCents(331, 21), 401);
  assert.equal(priceAtRate(charged.baseCents, 10, charged), 364);
  assert.equal(priceAtRate(charged.baseCents, 21, charged), 400);
});

check('with no charged price to return to, the rate is simply added to the base', () => {
  assert.equal(priceAtRate(500, 10), 550);
  assert.equal(priceAtRate(500, 0, null), 500);
});

check('every base to 100.00 is read back out of its price at 0/4/10/21 %', () => {
  for (const rate of [0, 4, 10, 21]) {
    for (let base = 0; base <= 10000; base += 1) {
      assert.equal(baseOfPriceCents(addVatCents(base, rate), rate), base, `${base}c at ${rate}%`);
    }
  }
});

console.log(`\n${passed}/${passed} passed`);
