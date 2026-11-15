/**
 * The basket kept in the browser while an order is built (rep panel and admin
 * panel, 2026-11-04). What must hold: it comes back as it was, only for the
 * same panel, person and client, only for a day, never in a broken shape —
 * and storage that is missing or throws never breaks the screen.
 *
 *   npm run test:saved-basket --workspace=packages/shared
 */
import assert from 'assert';
import {
  basketKey, editBasketKey, baselineOf, editBaselineOf, nextNewKey, clearBasket, mergeSavedLines, readBasket, sweepBaskets, writeBasket,
  SAVED_BASKET_TTL_MS,
} from '../src/savedBasket';

/** Just enough of the Web Storage API. */
class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const g = globalThis as unknown as { localStorage?: unknown };

type Line = { key: string; variantId: string; quantity: number; unitCost?: string };
const line = (v: string, q: number, extra: Partial<Line> = {}): Line => ({ key: v, variantId: v, quantity: q, ...extra });
const basket = (lines: Line[]) => ({
  lines, addressId: 'addr1', feeInput: '3.5', notes: 'Timbre 2B',
  hgSlot: { scheduled_for: '2026-11-05', delivery_window: 'morning' }, attemptKey: 'k1', baseline: null as string | null,
});

let failed = 0;
const test = (name: string, run: () => void) => {
  g.localStorage = new MemoryStorage();
  try { run(); console.log(`  PASS  ${name}`); } catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${(e as Error).message}`); }
};

const NOW = 1_800_000_000_000;
const KEY = basketKey('sales', 'rep1', 'client1');

test('it comes back exactly as it was saved', () => {
  writeBasket<Line>(KEY, basket([line('v1', 3, { unitCost: '1.20' }), line('v2', 1)]), NOW);
  const b = readBasket<Line>(KEY, NOW + 1000);
  assert.ok(b);
  assert.deepEqual(b!.lines, [line('v1', 3, { unitCost: '1.20' }), line('v2', 1)]);
  assert.equal(b!.addressId, 'addr1');
  assert.equal(b!.feeInput, '3.5');
  assert.equal(b!.notes, 'Timbre 2B');
  assert.deepEqual(b!.hgSlot, { scheduled_for: '2026-11-05', delivery_window: 'morning' });
  assert.equal(b!.attemptKey, 'k1');
});

test('keys keep panels, people and clients apart', () => {
  const keys = new Set([
    basketKey('sales', 'u1', 'c1'), basketKey('admin', 'u1', 'c1'),
    basketKey('sales', 'u2', 'c1'), basketKey('sales', 'u1', 'c2'),
  ]);
  assert.equal(keys.size, 4);
  writeBasket<Line>(basketKey('sales', 'u1', 'c1'), basket([line('v1', 1)]), NOW);
  assert.equal(readBasket(basketKey('admin', 'u1', 'c1'), NOW), null);
  assert.equal(readBasket(basketKey('sales', 'u2', 'c1'), NOW), null);
});

test('a day later it is gone, and removed', () => {
  writeBasket<Line>(KEY, basket([line('v1', 1)]), NOW);
  assert.ok(readBasket(KEY, NOW + SAVED_BASKET_TTL_MS));
  assert.equal(readBasket(KEY, NOW + SAVED_BASKET_TTL_MS + 1), null);
  assert.equal((g.localStorage as MemoryStorage).getItem(KEY), null);
});

test('an empty basket, a broken line or broken JSON reads as nothing, and is removed', () => {
  const ls = g.localStorage as MemoryStorage;
  writeBasket<Line>(KEY, basket([]), NOW);
  assert.equal(readBasket(KEY, NOW), null);
  ls.setItem(KEY, JSON.stringify({ ...basket([line('v1', 0)]), savedAt: NOW }));
  assert.equal(readBasket(KEY, NOW), null);
  ls.setItem(KEY, JSON.stringify({ ...basket([{ key: 'x', quantity: 2 } as unknown as Line]), savedAt: NOW }));
  assert.equal(readBasket(KEY, NOW), null);
  ls.setItem(KEY, '{not json');
  assert.equal(readBasket(KEY, NOW), null);
  assert.equal(ls.getItem(KEY), null);
});

test('missing fields fall back instead of breaking', () => {
  (g.localStorage as MemoryStorage).setItem(KEY, JSON.stringify({ savedAt: NOW, lines: [line('v1', 2)] }));
  const b = readBasket<Line>(KEY, NOW);
  assert.ok(b);
  assert.equal(b!.addressId, '');
  assert.equal(b!.feeInput, null);
  assert.equal(b!.hgSlot, null);
  assert.equal(b!.attemptKey, null);
});

test('clearing it leaves nothing', () => {
  writeBasket<Line>(KEY, basket([line('v1', 1)]), NOW);
  clearBasket(KEY);
  assert.equal(readBasket(KEY, NOW), null);
});

test('the sweep drops only this panel\'s expired baskets', () => {
  const ls = g.localStorage as MemoryStorage;
  const old = basketKey('sales', 'rep1', 'old');
  const fresh = basketKey('sales', 'rep1', 'fresh');
  const adminOld = basketKey('admin', 'a1', 'old');
  writeBasket<Line>(old, basket([line('v1', 1)]), NOW - SAVED_BASKET_TTL_MS - 5);
  writeBasket<Line>(fresh, basket([line('v1', 1)]), NOW);
  writeBasket<Line>(adminOld, basket([line('v1', 1)]), NOW - SAVED_BASKET_TTL_MS - 5);
  ls.setItem('cesto-access-token', 'keep me');
  sweepBaskets('sales', NOW);
  assert.equal(ls.getItem(old), null);
  assert.ok(ls.getItem(fresh));
  assert.ok(ls.getItem(adminOld));
  assert.equal(ls.getItem('cesto-access-token'), 'keep me');
});

test('no storage at all (the app, a locked-down browser): nothing saved, nothing thrown', () => {
  g.localStorage = undefined;
  writeBasket<Line>(KEY, basket([line('v1', 1)]), NOW);
  assert.equal(readBasket(KEY, NOW), null);
  clearBasket(KEY);
  sweepBaskets('admin', NOW);
});

test('storage that throws (full, blocked): nothing thrown', () => {
  g.localStorage = {
    get length() { throw new Error('blocked'); },
    key() { throw new Error('blocked'); },
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('blocked'); },
  };
  writeBasket<Line>(KEY, basket([line('v1', 1)]), NOW);
  assert.equal(readBasket(KEY, NOW), null);
  clearBasket(KEY);
  sweepBaskets('sales', NOW);
});

test('putting it back next to a size added meanwhile: the same size means one more', () => {
  const saved = [line('v1', 3), line('v2', 1)];
  assert.deepEqual(mergeSavedLines(saved, []), saved);
  assert.deepEqual(mergeSavedLines(saved, [line('v1', 1), line('v3', 2)]), [line('v1', 4), line('v2', 1), line('v3', 2)]);
});

test('unsaved edits are kept per order, apart from new baskets, with their fingerprint', () => {
  const edit = editBasketKey('admin', 'a1', 'order-9');
  assert.notEqual(edit, basketKey('admin', 'a1', 'order-9'));
  assert.notEqual(edit, editBasketKey('sales', 'a1', 'order-9'));
  writeBasket<Line>(edit, { ...basket([line('item-1', 2)]), baseline: 'fp-1' }, NOW);
  assert.equal(readBasket<Line>(edit, NOW)!.baseline, 'fp-1');
  writeBasket<Line>(KEY, basket([line('v1', 1)]), NOW);
  assert.equal(readBasket<Line>(KEY, NOW)!.baseline, null);
});

test('the fingerprint is the same for the same order, different for any change', () => {
  const order = { lines: [{ key: 'i1', quantity: 2, discount: '0.50' }, { key: 'i2', quantity: 1 }], fee: 3.5, notes: 'Timbre' };
  const same = JSON.parse(JSON.stringify(order));
  assert.equal(baselineOf(order), baselineOf(same));
  assert.notEqual(baselineOf(order), baselineOf({ ...order, fee: 4 }));
  assert.notEqual(baselineOf(order), baselineOf({ ...order, notes: 'Timbre 2' }));
  assert.notEqual(baselineOf(order), baselineOf({ ...order, lines: [{ ...order.lines[0], quantity: 3 }, order.lines[1]] }));
  assert.notEqual(baselineOf(order), baselineOf({ ...order, lines: [order.lines[0]] }));
  assert.equal(baselineOf(null), baselineOf(null));
});

test("an order edit fingerprint ignores names and photos, not quantities, prices or the note", () => {
  const es = [{ orderItemId: 'i1', variantId: 'v1', quantity: 2, unitPrice: 2, discount: '0.50', name: 'Arroz', imageUrl: 'a.jpg' }];
  const en = [{ ...es[0], name: 'Rice', imageUrl: 'b.jpg' }];
  assert.equal(editBaselineOf(es, { notes: 'x' }), editBaselineOf(en, { notes: 'x' }));
  assert.notEqual(editBaselineOf(es), editBaselineOf([{ ...es[0], quantity: 3 }]));
  assert.notEqual(editBaselineOf(es), editBaselineOf([{ ...es[0], unitPrice: 2.2 }]));
  assert.notEqual(editBaselineOf(es), editBaselineOf([{ ...es[0], discount: '' }]));
  assert.notEqual(editBaselineOf(es, { notes: 'x' }), editBaselineOf(es, { notes: 'y' }));
  assert.notEqual(editBaselineOf(es, { fee: 3.5 }), editBaselineOf(es, { fee: 4 }));
});

test('rows added after a restore get numbers no restored row has', () => {
  assert.equal(nextNewKey([{ key: 'item-1' }, { key: 'new:0' }, { key: 'new:4' }], 0), 5);
  assert.equal(nextNewKey([{ key: 'item-1' }], 2), 2);
  assert.equal(nextNewKey([{ key: 'new:1' }], 7), 7);
});

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
