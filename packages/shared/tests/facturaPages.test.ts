/**
 * Where a factura breaks across pages.
 *
 *   npm run test:factura-pages --workspace=packages/shared
 *
 * FA-2026-000002 was a hundred lines rendered as ONE page: the document
 * emitted a single `.invoice-page`, html2canvas returned a sheet three times
 * A4's height, and facturaPdf drew it onto one A4 — so the whole factura was
 * squashed vertically until the type was unreadable. A customer cannot read
 * their own invoice and an inspector cannot read it either.
 *
 * The page breaks are decided before rendering, because html2canvas
 * rasterises whatever it is handed and nothing downstream can split a table
 * row without cutting through the middle of it.
 *
 * What a reader must be able to rely on, and what this pins down:
 *
 *   · every line appears EXACTLY ONCE, in the order it was issued in — a
 *     fiscal document that drops or repeats a line is wrong, not untidy;
 *   · the IVA breakdown and the total appear exactly once, at the end;
 *   · no page is given more rows than fit, because overrunning is the bug.
 */
import assert from 'assert';
import { paginateFacturaLines, FACTURA_PAGE_ROWS, facturaRowWeight } from '../src/invoice/FacturaDocument';
import type { Invoice } from '../src/api/services/admin';

type Line = Invoice['lines'][number];

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

/** A line, named so a sequence can be checked by eye in a failure. */
function line(n: number, discount?: string): Line {
  return {
    description: `Producto ${n}`,
    quantity: 1,
    unit_price: '10.00',
    gross: discount ? '5.00' : '10.00',
    rate_pct: 10,
    vat_source: 'product',
    product_id: null,
    ...(discount ? { discount } : {}),
  } as unknown as Line;
}

const make = (n: number, discounted = false) =>
  Array.from({ length: n }, (_, i) => line(i + 1, discounted ? '5.00' : undefined));

/** Every line, in the order the pages present them. */
const flatten = (pages: ReturnType<typeof paginateFacturaLines>) =>
  pages.flatMap((p) => p.lines.map((l) => l.description));

// ─── The ordinary document ────────────────────────────────

test('a short factura is one page, with its totals on it', () => {
  const pages = paginateFacturaLines(make(6));
  assert.equal(pages.length, 1);
  assert.equal(pages[0].isFirst, true);
  assert.equal(pages[0].showTotals, true);
  assert.equal(pages[0].lines.length, 6);
});

test('one line is still a document', () => {
  const pages = paginateFacturaLines(make(1));
  assert.equal(pages.length, 1);
  assert.equal(pages[0].showTotals, true);
});

test('a factura with no lines at all does not crash', () => {
  const pages = paginateFacturaLines([]);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].showTotals, true);
});

// ─── THE REPORTED DOCUMENT ────────────────────────────────

test('A HUNDRED LINES BECOME SEVERAL PAGES, not one squashed sheet', () => {
  // Three in the 2026-11-04 layout, which fits about 42 lines a sheet: the
  // point is that it is never ONE.
  const pages = paginateFacturaLines(make(100));
  assert.ok(pages.length >= 3, `100 lines fitted into ${pages.length} page(s)`);
});

test('...and every line appears exactly once, in order', () => {
  const lines = make(100);
  const seen = flatten(paginateFacturaLines(lines));
  assert.deepEqual(seen, lines.map((l) => l.description));
});

test('...with the totals on the LAST page and nowhere else', () => {
  const pages = paginateFacturaLines(make(100));
  const withTotals = pages.map((p, i) => (p.showTotals ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(withTotals, [pages.length - 1]);
});

test('...and the header-and-parties page is the FIRST and only the first', () => {
  const pages = paginateFacturaLines(make(100));
  const firsts = pages.map((p, i) => (p.isFirst ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(firsts, [0]);
});

// ─── No page may overrun ──────────────────────────────────
//
// The budgets are row units: an ordinary line is 1, a line printing a
// discount above its total is 1.5. These ceilings are what keeps a rendered
// page inside A4; exceeding one is what produced the unreadable PDF.
// Read from the module: a long description wraps onto a second row (2026-11-04
// layout — the discount has its own column now, so it no longer adds one).
const weight = (l: Line) => facturaRowWeight(l);
const load = (ls: Line[]) => ls.reduce((s, l) => s + weight(l), 0);

test('no page is given more rows than it has room for', () => {
  for (const n of [16, 25, 31, 60, 100, 301]) {
    const pages = paginateFacturaLines(make(n));
    pages.forEach((p, i) => {
      const isLast = i === pages.length - 1;
      // Read from the module rather than repeated here: a budget raised in
      // one place and not the other is how a page starts overrunning again.
      const budget = p.isFirst
        ? (pages.length === 1 ? FACTURA_PAGE_ROWS.single : FACTURA_PAGE_ROWS.first)
        : (isLast ? FACTURA_PAGE_ROWS.last : FACTURA_PAGE_ROWS.continuation);
      assert.ok(
        load(p.lines) <= budget,
        `${n}-line factura: page ${i + 1} carries ${load(p.lines)} rows, budget ${budget}`,
      );
    });
  }
});

test('A LONG DESCRIPTION TAKES MORE ROOM, because it wraps onto a second row', () => {
  // The same count of lines paginates sooner when every description wraps.
  const long = (n: number) => make(n).map((l) => ({ ...l, description: `${l.description} ${'x'.repeat(40)}` }));
  const plain = paginateFacturaLines(make(30));
  const wrapped = paginateFacturaLines(long(30));
  assert.equal(plain.length, 1, 'thirty short lines are one sheet');
  assert.ok(
    wrapped.length > plain.length,
    `plain ${plain.length} pages, wrapped ${wrapped.length}`,
  );
  const mixed = paginateFacturaLines([...make(15), ...long(15)]);
  assert.equal(flatten(mixed).length, 30);
});

test('a discount no longer takes a second row — it has its own column', () => {
  assert.equal(facturaRowWeight(line(1, '5.00')), 1);
  assert.equal(paginateFacturaLines(make(FACTURA_PAGE_ROWS.single, true)).length, 1);
});

// ─── The boundaries ───────────────────────────────────────

test('nothing is lost or repeated at any size', () => {
  for (let n = 1; n <= 80; n += 1) {
    const lines = make(n);
    const seen = flatten(paginateFacturaLines(lines));
    assert.equal(seen.length, n, `${n} lines produced ${seen.length}`);
    assert.deepEqual(seen, lines.map((l) => l.description), `order changed at ${n}`);
  }
});

test('the totals always land somewhere, at every size', () => {
  for (let n = 0; n <= 80; n += 1) {
    const pages = paginateFacturaLines(make(n));
    const count = pages.filter((p) => p.showTotals).length;
    assert.equal(count, 1, `${n} lines produced ${count} totals blocks`);
    assert.equal(pages[pages.length - 1].showTotals, true, `${n} lines: totals are not last`);
  }
});

test('NO PAGE COMES OUT EMPTY, except a document with nothing on it', () => {
  // The first version filled every page it could and left the totals alone on
  // a sheet of their own — 21, 25, 28, 26, then a page with no lines at all,
  // which reads as a printing fault rather than a document.
  for (let n = 1; n <= 120; n += 1) {
    const pages = paginateFacturaLines(make(n));
    const empty = pages.map((p, i) => (p.lines.length === 0 ? i + 1 : 0)).filter(Boolean);
    assert.deepEqual(empty, [], `${n} lines produced empty page(s) ${empty.join(', ')}`);
  }
});

test('...and the last two pages are balanced rather than lopsided', () => {
  // 100 lines, six of them discounted: the document that was reported.
  const lines = [
    ...make(21), ...make(6, true), ...make(73),
  ];
  const pages = paginateFacturaLines(lines);
  const [a, b] = pages.slice(-2).map((p) => p.lines.length);
  assert.ok(
    Math.abs(a - b) <= Math.max(a, b) / 2,
    `last two pages carry ${a} and ${b} lines`,
  );
});

test('a line too big for any page still gets one rather than looping', () => {
  // Defensive: takeRows must always take at least one line, or a single
  // oversized row would spin forever and the tab would hang on download.
  const heavy = Array.from({ length: 3 }, (_, i) => line(i + 1, '5.00'));
  const pages = paginateFacturaLines(heavy);
  assert.equal(flatten(pages).length, 3);
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
