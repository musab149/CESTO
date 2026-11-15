import assert from 'node:assert/strict';
import { diversifyByRecency, DEFAULT_CAPS, type DiversityCandidate } from './newArrivals';

// Zero-dep test file, same shape as parentOrder.test.ts. Run with:
//
//   cd packages/api && npx ts-node src/lib/newArrivals.test.ts
//
// Only the pure diversity pass is exercised here — selectNewArrivals talks to
// Prisma and belongs to a different kind of test.

type Case = { name: string; run: () => void };
const cases: Case[] = [];
function test(name: string, run: () => void): void { cases.push({ name, run }); }

/** Terse candidate builder: p('id', 'category', 'brand'). */
const p = (id: string, category_id: string | null, brand: string | null = null): DiversityCandidate =>
  ({ id, category_id, brand });

const ids = (rows: DiversityCandidate[]) => rows.map((r) => r.id);

// ─── the case this exists for ──────────────────────────────

test('one bulk import cannot take the whole rail', () => {
  // Twelve products, one category, one minute — measured shape of a real
  // import on this catalogue. Older items from elsewhere should get in.
  const importRows = Array.from({ length: 12 }, (_, i) => p(`imp${i}`, 'cat-spices', 'Shan'));
  const rest = [p('a', 'cat-rice', 'Falak'), p('b', 'cat-oil', 'Dalda'), p('c', 'cat-tea', 'Tapal')];

  const out = diversifyByRecency([...importRows, ...rest], 6, { perCategory: 2, perBrand: 2 });

  assert.equal(out.length, 6, 'the rail is still full');
  // Every other category got in — that is the point of the exercise.
  assert.ok(['a', 'b', 'c'].every((id) => ids(out).includes(id)));

  // The import takes 3 of 6: two under the cap, and one more only because
  // the catalogue had nothing else left to offer. Without the cap it would
  // have taken all six, which is the bug this exists to prevent.
  const fromImport = out.filter((r) => r.id.startsWith('imp'));
  assert.equal(fromImport.length, 3);
  // The ones it gets are the NEWEST, because the walk is recency-ordered.
  assert.deepEqual(ids(fromImport), ['imp0', 'imp1', 'imp2']);
});

test('the top-up spreads across groups instead of refilling the biggest', () => {
  // Two crowded categories. Once both hit the cap the rail is short, so the
  // fill has to choose — and it should alternate rather than empty the first
  // queue, which is what a plain recency-ordered fill would do.
  const rows = [
    p('a1', 'cat-a'), p('a2', 'cat-a'), p('a3', 'cat-a'), p('a4', 'cat-a'),
    p('b1', 'cat-b'), p('b2', 'cat-b'), p('b3', 'cat-b'), p('b4', 'cat-b'),
  ];
  const out = diversifyByRecency(rows, 6, { perCategory: 2, perBrand: 99 });

  assert.equal(out.length, 6);
  assert.deepEqual(ids(out), ['a1', 'a2', 'b1', 'b2', 'a3', 'b3']);
  assert.equal(out.filter((r) => r.category_id === 'cat-a').length, 3);
  assert.equal(out.filter((r) => r.category_id === 'cat-b').length, 3);
});

// ─── caps ──────────────────────────────────────────────────

test('per-category cap is honoured while candidates remain', () => {
  const rows = [
    p('1', 'cat-a'), p('2', 'cat-a'), p('3', 'cat-a'),
    p('4', 'cat-b'), p('5', 'cat-c'), p('6', 'cat-d'),
  ];
  const out = diversifyByRecency(rows, 4, { perCategory: 2, perBrand: 99 });
  assert.deepEqual(ids(out), ['1', '2', '4', '5']);
});

test('per-brand cap is honoured across different categories', () => {
  const rows = [
    p('1', 'cat-a', 'Shan'), p('2', 'cat-b', 'Shan'), p('3', 'cat-c', 'Shan'),
    p('4', 'cat-d', 'Laziza'),
  ];
  const out = diversifyByRecency(rows, 3, { perCategory: 99, perBrand: 2 });
  assert.deepEqual(ids(out), ['1', '2', '4']);
});

test('brand caps are case-insensitive, as they are everywhere else', () => {
  const rows = [
    p('1', 'cat-a', 'Shan'), p('2', 'cat-b', 'SHAN'), p('3', 'cat-c', '  shan  '),
    p('4', 'cat-d', 'Tapal'),
  ];
  const out = diversifyByRecency(rows, 3, { perCategory: 99, perBrand: 2 });
  assert.deepEqual(ids(out), ['1', '2', '4'], 'SHAN and shan are one brand');
});

test('null brand is never capped — an imported catalogue is full of them', () => {
  const rows = [p('1', 'cat-a'), p('2', 'cat-b'), p('3', 'cat-c'), p('4', 'cat-d')];
  const out = diversifyByRecency(rows, 4, { perCategory: 99, perBrand: 1 });
  assert.deepEqual(ids(out), ['1', '2', '3', '4']);
});

test('null category is capped as its own bucket', () => {
  const rows = [p('1', null), p('2', null), p('3', null), p('4', 'cat-a')];
  const out = diversifyByRecency(rows, 3, { perCategory: 2, perBrand: 99 });
  assert.deepEqual(ids(out), ['1', '2', '4']);
});

// ─── never leave the rail short ────────────────────────────

test('caps relax rather than return a half-empty rail', () => {
  // A catalogue too narrow to diversify: one category, one brand.
  const rows = Array.from({ length: 6 }, (_, i) => p(`x${i}`, 'cat-only', 'OnlyBrand'));
  const out = diversifyByRecency(rows, 4, { perCategory: 2, perBrand: 2 });
  assert.equal(out.length, 4, 'fills to the limit');
  // The capped-in ones still lead, and the filler keeps recency order.
  assert.deepEqual(ids(out), ['x0', 'x1', 'x2', 'x3']);
});

test('returns everything it has when there are fewer candidates than the limit', () => {
  const rows = [p('1', 'cat-a'), p('2', 'cat-b')];
  assert.deepEqual(ids(diversifyByRecency(rows, 12)), ['1', '2']);
});

test('empty in, empty out', () => {
  assert.deepEqual(diversifyByRecency([], 12), []);
});

test('a zero or negative limit selects nothing', () => {
  const rows = [p('1', 'cat-a'), p('2', 'cat-b')];
  assert.deepEqual(diversifyByRecency(rows, 0), []);
  assert.deepEqual(diversifyByRecency(rows, -3), []);
});

// ─── ordering guarantees ───────────────────────────────────

test('recency order is preserved among the picked items', () => {
  const rows = [
    p('newest', 'cat-a'), p('mid', 'cat-b'), p('oldest', 'cat-c'),
  ];
  assert.deepEqual(ids(diversifyByRecency(rows, 3)), ['newest', 'mid', 'oldest']);
});

test('the same input always gives the same output', () => {
  const rows = Array.from({ length: 40 }, (_, i) => p(`p${i}`, `cat-${i % 5}`, `brand-${i % 7}`));
  const a = ids(diversifyByRecency(rows, 12, DEFAULT_CAPS));
  const b = ids(diversifyByRecency(rows, 12, DEFAULT_CAPS));
  assert.deepEqual(a, b, 'no randomness — the rail must not reshuffle per request');
  assert.equal(new Set(a).size, a.length, 'no duplicates');
});

// ─── run ───────────────────────────────────────────────────

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
