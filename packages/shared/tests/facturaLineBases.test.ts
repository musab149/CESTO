/**
 * A factura's line amounts WITHOUT IVA (2026-11-04 layout).
 *
 *   npm run test:factura-line-bases --workspace=packages/shared
 *
 * Customers pay prices WITH IVA, rounded per unit; the factura prints each
 * line without IVA and the base per rate at its foot. What must hold:
 *
 *   · rate by rate, the line amounts add up EXACTLY to the base the
 *     document's totals state — a reader adding the column gets the foot;
 *   · no line moves more than a cent from its exact value;
 *   · base + IVA per rate is still exactly what was paid (the totals are
 *     untouched — only how the lines print).
 */
import assert from 'assert';
import { facturaLineBases } from '../src/invoice/FacturaDocument';
import { addVatCents, computeTaxBreakdown, centsToEuros } from '../src/tax';

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  PASS  ${name}`);
};

/** A small deterministic generator, so a failure can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A basket priced as checkout prices it: base + IVA per unit, × quantity, less a € discount. */
function basket(seed: number, n: number) {
  const r = rng(seed);
  const rates = [0, 4, 10, 21];
  return Array.from({ length: n }, () => {
    const base = 1 + Math.floor(r() * 5000);
    const rate = rates[Math.floor(r() * rates.length)];
    const qty = 1 + Math.floor(r() * 24);
    const unit = addVatCents(base, rate);
    const off = r() < 0.25 ? Math.min(unit, 10 + Math.floor(r() * 90)) * qty : 0;
    return { gross: centsToEuros(Math.max(0, unit * qty - off)), rate_pct: rate };
  });
}

/** The document's totals, as the API writes them (lib/invoicing invoiceTotals). */
function byRateOf(lines: Array<{ gross: string; rate_pct: number }>) {
  const b = computeTaxBreakdown(lines.map((l) => ({ grossCents: Math.round(Number(l.gross) * 100), rate_pct: l.rate_pct })));
  return b.groups.map((g) => ({ rate_pct: g.rate_pct, base: centsToEuros(g.base_cents), base_cents: g.base_cents }));
}

check('ten units at 0,40 (IVA 21 %) print as 3,31 — the base backed out of 4,00', () => {
  const lines = [{ gross: '4.00', rate_pct: 21 }];
  assert.deepEqual(facturaLineBases(lines, byRateOf(lines)), [331]);
});

check('a rate with one line: that line IS the base', () => {
  const lines = [{ gross: '11.00', rate_pct: 10 }, { gross: '5.00', rate_pct: 0 }, { gross: '3.50', rate_pct: 21 }];
  assert.deepEqual(facturaLineBases(lines, byRateOf(lines)), [1000, 500, 289]);
});

check('rate by rate the lines add up EXACTLY to the stated base, every line within a cent — 400 baskets', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const lines = basket(seed, 1 + (seed % 60));
    const groups = byRateOf(lines);
    const bases = facturaLineBases(lines, groups);
    for (const g of groups) {
      const sum = lines.reduce((s, l, i) => s + (l.rate_pct === g.rate_pct ? bases[i] : 0), 0);
      assert.equal(sum, g.base_cents, `seed ${seed}, ${g.rate_pct}%: lines ${sum} ≠ base ${g.base_cents}`);
    }
    lines.forEach((l, i) => {
      const exact = (Math.round(Number(l.gross) * 100) * 100) / (100 + l.rate_pct);
      assert.ok(Math.abs(bases[i] - exact) < 1 + 1e-9, `seed ${seed} line ${i}: ${bases[i]} vs exact ${exact}`);
    });
  }
});

check('a rate the totals do not list (an older document) just rounds each line', () => {
  const lines = [{ gross: '4.00', rate_pct: 21 }, { gross: '2.20', rate_pct: 10 }];
  assert.deepEqual(facturaLineBases(lines, []), [331, 200]);
});

console.log(`\n${passed}/${passed} passed`);
