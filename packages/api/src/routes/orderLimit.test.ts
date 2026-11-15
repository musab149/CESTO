// ─── Contract test · the order-line cap is written twice and must agree ───
//
// Run:  cd packages/api && npm run test:order-limit
//
// `MAX_ORDER_LINES` exists in two files: lib/orderLimits.ts in the API, where
// it is the zod cap that actually refuses an oversized basket — on the cart,
// on create-order from the admin and rep screens, and on every edit — and in
// packages/shared/src/cartLimits.ts, which the web app checks BEFORE syncing
// so the customer gets a sentence instead of a 422.
//
// It is duplicated on purpose. This package imports nothing from
// @grocery-app/shared — its barrel re-exports a .tsx component and ts-node-dev
// falls over on it at runtime (see lib/geocode.ts, which says the same about
// the same barrel). So the number is mirrored, and this is what stops the two
// copies drifting.
//
// Drift is quiet and one-sided, which is why it is worth a test. Raise only
// the API and the web app keeps refusing baskets the server would have taken.
// Raise only the web app and the customer is told their basket is fine, right
// up until the sync 422s and the order does not happen — which is the exact
// failure this whole change was about.
//
// Read as SOURCE rather than imported, because importing the shared copy is
// the thing this package cannot do.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { MAX_ORDER_LINES, MAX_LINE_QUANTITY } from '../lib/orderLimits';

const SHARED = path.join(__dirname, '../../../shared/src/cartLimits.ts');

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

const src = fs.readFileSync(SHARED, 'utf8');
const match = /export const MAX_ORDER_LINES\s*=\s*(\d+)/.exec(src);

test('the shared copy is still where this expects it', () => {
  assert.ok(match, `no MAX_ORDER_LINES found in ${SHARED} — was it renamed or moved?`);
});

test('both copies agree', () => {
  assert.equal(Number(match![1]), MAX_ORDER_LINES,
    'the API and the web app disagree about how big a basket may be');
});

test('and it is big enough to be worth having', () => {
  // A monthly household shop is several hundred lines. A cap under that is
  // the bug this replaced, so it is worth refusing to go back.
  assert.ok(MAX_ORDER_LINES >= 500, `${MAX_ORDER_LINES} is below a real monthly shop`);
  // The API accepts a 256KB body and a line is ~115 bytes of JSON, so the
  // payload gives out around 2,200. Staying well under means the cap refuses
  // the basket with a readable message rather than express refusing the body.
  assert.ok(MAX_ORDER_LINES <= 2000, `${MAX_ORDER_LINES} risks hitting the 256kb body limit first`);
});

// The per-line quantity ceiling is mirrored the same way.
const qtyMatch = /export const MAX_LINE_QUANTITY\s*=\s*([\d_]+)/.exec(src);

test('the shared copy of MAX_LINE_QUANTITY is where this expects it', () => {
  assert.ok(qtyMatch, `no MAX_LINE_QUANTITY found in ${SHARED}`);
});

test('both copies of MAX_LINE_QUANTITY agree', () => {
  assert.equal(Number(qtyMatch![1].replace(/_/g, '')), MAX_LINE_QUANTITY,
    'the API and the apps disagree about how many of one product a line may hold');
});

test('and a big wholesale line fits under it', () => {
  // 5,000 units of one product is a real order; 99 and 999 were the old,
  // scattered caps this replaced.
  assert.ok(MAX_LINE_QUANTITY >= 5000, `${MAX_LINE_QUANTITY} cannot hold a 5,000-unit line`);
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
