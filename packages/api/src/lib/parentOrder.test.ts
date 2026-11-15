import assert from 'node:assert/strict';
import type { OrderStatus } from '@prisma/client';
import { deriveParentOrderStatus, generateParentOrderNumber } from './parentOrder';

// Zero-dep test file. The API package has no jest/vitest — this file runs
// straight through ts-node and reports pass/fail on stdout. Run with:
//
//   cd packages/api && npx ts-node src/lib/parentOrder.test.ts
//
// Exit code is non-zero if any assertion fails so CI can gate on it.
// Keep this narrow — one file per pure helper. If we grow real coverage
// needs beyond hand-rolled scripts, revisit with vitest.

type Case = { name: string; run: () => void };
const cases: Case[] = [];
function test(name: string, run: () => void): void { cases.push({ name, run }); }

const S = (s: OrderStatus) => s; // keeps the type checker honest below

// ─── deriveParentOrderStatus ───────────────────────────────

test('every sub delivered → delivered', () => {
  assert.equal(deriveParentOrderStatus([S('delivered'), S('delivered')]), 'delivered');
});

test('every sub cancelled → cancelled', () => {
  assert.equal(deriveParentOrderStatus([S('cancelled'), S('cancelled'), S('cancelled')]), 'cancelled');
});

test('mixed terminal (delivered + cancelled) → partially_completed', () => {
  assert.equal(
    deriveParentOrderStatus([S('delivered'), S('cancelled')]),
    'partially_completed',
  );
  assert.equal(
    deriveParentOrderStatus([S('delivered'), S('delivered'), S('cancelled')]),
    'partially_completed',
  );
});

test('all pending → pending', () => {
  assert.equal(deriveParentOrderStatus([S('pending'), S('pending')]), 'pending');
});

test('mixed active → least-progressed status', () => {
  assert.equal(
    deriveParentOrderStatus([S('pending'), S('preparing')]),
    'pending',
  );
  assert.equal(
    deriveParentOrderStatus([S('confirmed'), S('preparing'), S('on_the_way')]),
    'confirmed',
  );
  assert.equal(
    deriveParentOrderStatus([S('preparing'), S('on_the_way')]),
    'preparing',
  );
});

test('cancelled sub does not downgrade an active parent', () => {
  // The cancelled sub is excluded from the min — parent stays on the
  // remaining active sub's state, not silently regressed to "pending".
  assert.equal(
    deriveParentOrderStatus([S('cancelled'), S('on_the_way')]),
    'on_the_way',
  );
  assert.equal(
    deriveParentOrderStatus([S('cancelled'), S('preparing'), S('on_the_way')]),
    'preparing',
  );
});

test('delivered + still-active sub → least-progressed active', () => {
  // One sub arrived, another is still en route. Customer view stays on
  // the trailing sub — the whole order isn't done until every sub is.
  assert.equal(
    deriveParentOrderStatus([S('delivered'), S('on_the_way')]),
    'on_the_way',
  );
  assert.equal(
    deriveParentOrderStatus([S('delivered'), S('pending')]),
    'pending',
  );
});

test('empty list → pending (defensive; checkout always creates ≥1 sub)', () => {
  assert.equal(deriveParentOrderStatus([]), 'pending');
});

test('single sub echoes its own state', () => {
  const states: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'on_the_way', 'delivered', 'cancelled', 'draft'];
  for (const s of states) {
    assert.equal(deriveParentOrderStatus([s]), s, `single [${s}] should echo`);
  }
});

test('any sub draft → parent draft, regardless of siblings', () => {
  // Draft dominates every other rule, including terminal states — it's
  // the thing that needs attention, so it should never be hidden behind
  // a sibling that happens to be further along (or even finished).
  assert.equal(deriveParentOrderStatus([S('draft'), S('pending')]), 'draft');
  assert.equal(deriveParentOrderStatus([S('draft'), S('on_the_way')]), 'draft');
  assert.equal(deriveParentOrderStatus([S('draft'), S('delivered')]), 'draft');
  assert.equal(deriveParentOrderStatus([S('draft'), S('cancelled')]), 'draft');
  assert.equal(deriveParentOrderStatus([S('draft'), S('draft')]), 'draft');
});

// ─── generateParentOrderNumber ─────────────────────────────

test('parent order number matches ORD-DDMM-XXXX-P shape', () => {
  const n = generateParentOrderNumber();
  assert.match(n, /^ORD-\d{4}-[A-Z0-9]{8}-P$/, `unexpected shape: ${n}`);
});

test('parent order numbers are effectively unique across a batch', () => {
  // order_number is UNIQUE, so a collision is a failed checkout rather than a
  // cosmetic clash. This used to draw 1,000 samples from a 4-character space
  // (~1.7M values), where the birthday bound gives a ~26% chance of at least
  // one collision — so the test failed roughly one run in four, and the
  // underlying generator would have failed real checkouts at that volume.
  //
  // With 8 characters (~2.8e12) the expected collisions here are ~4e-7.
  const N = 50_000;
  const seen = new Set<string>();
  for (let i = 0; i < N; i++) seen.add(generateParentOrderNumber());
  assert.equal(seen.size, N, `expected ${N} unique parent order numbers`);
});

// ─── Runner ────────────────────────────────────────────────

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
