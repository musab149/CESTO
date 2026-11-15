/**
 * When a delivery fee is still to come, as a table.
 *
 *   npm run test:delivery-fee --workspace=packages/shared
 *
 * Six screens read this one function — the web and mobile checkouts, both
 * order views in each app, and the admin order page — and they all render the
 * same zero three different ways depending on what it means:
 *
 *   "Free"                        nobody is being charged
 *   "Added by us shortly"         wholesale, not priced yet
 *   "Charged on the whole purchase"   a part of a split, charged once
 *
 * Getting it wrong is not a crash, it is a promise. Telling a b2b customer
 * "Free" and then adding a charge is the failure this exists to prevent, and
 * telling them a fee is pending on three parts AND the purchase is the one
 * that replaced it before parts were excluded.
 */
import assert from 'assert';
import { deliveryFeeIsPending } from '../src/deliveryFee';

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

test('an order with no fee yet is pending', () => {
  assert.equal(deliveryFeeIsPending({ delivery_fee: 0 }), true);
  // Decimal columns arrive as strings over the wire often enough to matter.
  assert.equal(deliveryFeeIsPending({ delivery_fee: '0' }), true);
  assert.equal(deliveryFeeIsPending({ delivery_fee: '0.00' }), true);
});

test('...and stops being pending the moment somebody prices it', () => {
  assert.equal(deliveryFeeIsPending({ delivery_fee: 18.5 }), false);
  assert.equal(deliveryFeeIsPending({ delivery_fee: '18.50' }), false);
});

test('A RETAIL ORDER IS PENDING TOO — we never say delivery is free', () => {
  /**
   * This used to ask whether the buyer was a business, so a retail zero fell
   * through to "Free". It is the same promise either way: the office can
   * still put a fee on that order, and the customer read "Free".
   */
  assert.equal(deliveryFeeIsPending({ delivery_fee: 0, parent_order_id: null }), true);
});

test('A PART OF A SPLIT PURCHASE IS NEVER PENDING', () => {
  /**
   * Its zero is structural. One delivery is charged once, on the purchase,
   * and every part carries nothing by design — so a part has no fee to be
   * waiting for, and the admin page offers no way to set one.
   *
   * Without this, a wholesale basket split across three shops claimed the
   * same single fee was outstanding in four places at once.
   */
  assert.equal(deliveryFeeIsPending({ delivery_fee: 0, parent_order_id: 'p1' }), false);
});

test('...while the purchase it belongs to still is', () => {
  // The parent carries the fee, so the parent is where "not yet" is true.
  assert.equal(deliveryFeeIsPending({ delivery_fee: 0, parent_order_id: null }), true);
});

test('an absent parent_order_id means a plain order, not a part', () => {
  // Older payloads omit the field entirely; omission must not read as "part",
  // or every wholesale order stops reporting a pending fee.
  assert.equal(deliveryFeeIsPending({ delivery_fee: 0 }), true);
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
