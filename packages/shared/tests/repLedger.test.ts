/**
 * Where each line of a rep's earnings history stands — paid, outstanding,
 * taken back — as a table (src/repLedger.ts). The screens paint these states
 * as row tints, so a wrong one tells a rep they were paid when they were not.
 *
 *   npm run test:rep-ledger --workspace=packages/shared
 */
import assert from 'assert';
import { ledgerStates, type RepLedgerLineState } from '../src/repLedger';
import type { RepLedgerEntry, RepLedgerKind } from '../src/types';

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

type Row = [id: string, kind: RepLedgerKind, amount: string, order?: string, voided?: boolean];
/** Rows written oldest first, as one reads a statement; the API lists them newest first. */
const states = (...rows: Row[]) => ledgerStates(rows.map(([id, kind, amount, order, voided]): RepLedgerEntry => ({
  id, kind, amount, order: order ? { id: order, order_number: order } : null, voided: !!voided,
  reference_amount: null, balance: '0.00', occurred_on: '2026-10-01', created_at: '2026-10-01T00:00:00Z', note: null, voids_entry_id: null,
})).reverse());
const tones = (s: Record<string, RepLedgerLineState>) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.tone]));

test('nothing paid yet: every earning outstanding, in full', () => {
  const s = states(['a', 'order_earning', '10.00', 'A'], ['b', 'order_earning', '5.50', 'B']);
  assert.deepEqual(s.a, { tone: 'outstanding', left: '10.00', partial: false });
  assert.deepEqual(s.b, { tone: 'outstanding', left: '5.50', partial: false });
});

test('a payment covers the oldest earnings first; the rest stays outstanding', () => {
  const s = states(
    ['a', 'order_earning', '10.00', 'A'],
    ['b', 'order_earning', '5.00', 'B'],
    ['p', 'payout', '-12.00'],
    ['c', 'order_earning', '7.00', 'C'],
  );
  assert.deepEqual(s.a, { tone: 'settled' });
  assert.deepEqual(s.b, { tone: 'outstanding', left: '3.00', partial: true });
  assert.deepEqual(s.p, { tone: 'paid' });
  assert.deepEqual(s.c, { tone: 'outstanding', left: '7.00', partial: false });
});

test('the earlier statements: the paid one settled, the open one outstanding (local data)', () => {
  const s = states(
    ['ne', 'order_not_earned', '0.00', 'X'],
    ['sep', 'legacy_statement', '13.25'],
    ['pay', 'payout', '-13.25'],
    ['oct', 'legacy_statement', '8.75'],
  );
  assert.deepEqual(tones(s), { ne: 'none', sep: 'settled', pay: 'paid', oct: 'outstanding' });
  assert.equal(s.oct.left, '8.75');
});

test('a payment made ahead covers earnings that come after it', () => {
  const s = states(['p', 'payout', '-20.00'], ['a', 'order_earning', '8.00', 'A'], ['b', 'order_earning', '15.00', 'B']);
  assert.deepEqual(tones(s), { p: 'paid', a: 'settled', b: 'outstanding' });
  assert.equal(s.b.left, '3.00');
});

test('an order taken back: its earning is taken back, not paid — and pays nothing else', () => {
  const s = states(
    ['a', 'order_earning', '10.00', 'A'],
    ['b', 'order_earning', '6.00', 'B'],
    ['r', 'order_reversal', '-10.00', 'A'],
  );
  assert.deepEqual(tones(s), { a: 'taken_back', r: 'reversed', b: 'outstanding' });
  assert.equal(s.b.left, '6.00');
});

test('paid, then taken back: the payment counts against what comes next', () => {
  const s = states(
    ['a', 'order_earning', '10.00', 'A'],
    ['p', 'payout', '-10.00'],
    ['r', 'order_reversal', '-10.00', 'A'],
    ['b', 'order_earning', '4.00', 'B'],
  );
  assert.deepEqual(tones(s), { a: 'taken_back', p: 'paid', r: 'reversed', b: 'settled' });
});

test('an order approved again: higher adds a line of its own; lower trims the earning', () => {
  const up = states(['a', 'order_earning', '10.00', 'A'], ['u', 'order_adjustment', '2.00', 'A'], ['p', 'payout', '-10.00']);
  assert.deepEqual(tones(up), { a: 'settled', u: 'outstanding', p: 'paid' });
  const down = states(['a', 'order_earning', '10.00', 'A'], ['d', 'order_adjustment', '-2.00', 'A']);
  assert.deepEqual(down.a, { tone: 'outstanding', left: '8.00', partial: false });
  assert.deepEqual(down.d, { tone: 'none' });
});

test('approved, raised, then taken back: every line of the order is taken back', () => {
  const s = states(['a', 'order_earning', '10.00', 'A'], ['u', 'order_adjustment', '2.00', 'A'], ['r', 'order_reversal', '-12.00', 'A']);
  assert.deepEqual(tones(s), { a: 'taken_back', u: 'taken_back', r: 'reversed' });
});

test('a payment undone pays nothing: it and its undoing are voided', () => {
  const s = states(['a', 'order_earning', '10.00', 'A'], ['p', 'payout', '-10.00', undefined, true], ['v', 'payout_void', '10.00']);
  assert.deepEqual(tones(s), { a: 'outstanding', p: 'voided', v: 'voided' });
  assert.equal(s.a.left, '10.00');
});

test('a bonus is earned like an order; a deduction comes off the oldest', () => {
  const s = states(['a', 'order_earning', '10.00', 'A'], ['bonus', 'adjustment', '5.00'], ['ded', 'adjustment', '-4.00']);
  assert.deepEqual(tones(s), { a: 'outstanding', bonus: 'outstanding', ded: 'deduction' });
  assert.equal(s.a.left, '6.00');
  assert.equal(s.bonus.left, '5.00');
});

test('an order at a loss earns 0: moves nothing', () => {
  assert.deepEqual(tones(states(['z', 'order_earning', '0.00', 'Z'])), { z: 'none' });
});

test('cents, not floats: 0.1 + 0.2 pays 0.30 exactly', () => {
  const s = states(['a', 'order_earning', '0.10', 'A'], ['b', 'order_earning', '0.20', 'B'], ['p', 'payout', '-0.30']);
  assert.deepEqual(tones(s), { a: 'settled', b: 'settled', p: 'paid' });
});

test('every line gets a state', () => {
  const kinds: RepLedgerKind[] = ['order_earning', 'order_adjustment', 'order_reversal', 'order_not_earned', 'adjustment', 'payout', 'payout_void', 'legacy_statement'];
  const s = states(...kinds.map((k, i): Row => [`l${i}`, k, i % 2 ? '-1.00' : '1.00', k.startsWith('order') ? 'O' : undefined]));
  assert.equal(Object.keys(s).length, kinds.length);
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
