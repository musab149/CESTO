// ─── Unit test · IVA added to base prices, backed out of charges ─
//
// Run:  cd packages/shared && npm run test:tax
//
// Imports the module directly, never the barrel: index.ts re-exports
// originArt.tsx and ts-node here has no --jsx.
//
// The assertion that matters throughout is base + vat === gross, exactly,
// per rate group and overall. An invoice that needs a plug line to balance
// is an invoice an accountant will send back.

import {
  computeTaxBreakdown, eurosToCents, centsToEuros, rateForCategory, VAT_RATES,
  effectiveVatCategory, addVatCents,
} from './tax';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

// ─── cents conversion ──────────────────────────────────────────
check('"12.34" -> 1234', eurosToCents('12.34') === 1234);
check('"0.10" -> 10', eurosToCents('0.10') === 10);
check('"1" -> 100 (no decimals)', eurosToCents('1') === 100);
check('"1.5" -> 150 (one decimal)', eurosToCents('1.5') === 150);
check('comma decimal accepted', eurosToCents('3,50') === 350);
check('number input', eurosToCents(10) === 1000);
// 0.1 + 0.2 territory: the reason this is not a float multiply.
check('19.99 survives the round trip', centsToEuros(eurosToCents('19.99')) === '19.99');
check('cents back to euros pads', centsToEuros(5) === '0.05');

// ─── single rate ───────────────────────────────────────────────
// 10 EUR gross at 10%: vat = 1000*10/110 = 90.909… -> 91, base = 909.
const single = computeTaxBreakdown([{ grossCents: 1000, rate_pct: 10 }]);
check('one group for one rate', single.groups.length === 1);
check('vat backed out, not added', single.vat_total_cents === 91, single.vat_total_cents);
check('base is the remainder', single.taxable_base_cents === 909);
check('base + vat === gross', single.taxable_base_cents + single.vat_total_cents === 1000);
// The direction check: adding 10% on top would have produced 100, not 91.
check('...and is NOT 10% added on top', single.vat_total_cents !== 100);

// ─── mixed rates ───────────────────────────────────────────────
const mixed = computeTaxBreakdown([
  { grossCents: 1000, rate_pct: 4 },
  { grossCents: 2500, rate_pct: 10 },
  { grossCents: 999, rate_pct: 21 },
  { grossCents: 1, rate_pct: 21 },
]);
check('one group per distinct rate', mixed.groups.length === 3, mixed.groups.length);
check('groups sorted by rate', mixed.groups.map((g) => g.rate_pct).join(',') === '4,10,21');
check('same-rate lines are summed', mixed.groups[2].gross_cents === 1000);
check('gross total is the sum of lines', mixed.gross_total_cents === 4500);
check('MIXED: base + vat === gross exactly',
  mixed.taxable_base_cents + mixed.vat_total_cents === mixed.gross_total_cents,
  { base: mixed.taxable_base_cents, vat: mixed.vat_total_cents, gross: mixed.gross_total_cents });
for (const gr of mixed.groups) {
  check(`  group ${gr.rate_pct}%: base + vat === gross`,
    gr.base_cents + gr.vat_cents === gr.gross_cents, gr);
}

// ─── the residue hunt ──────────────────────────────────────────
// Rounding the base independently drifts by a cent on a good fraction of
// values. Sweep a range and assert it never happens.
let residues = 0;
for (let gross = 1; gross <= 5000; gross += 1) {
  for (const rate of [4, 10, 21]) {
    const b = computeTaxBreakdown([{ grossCents: gross, rate_pct: rate }]);
    if (b.taxable_base_cents + b.vat_total_cents !== gross) residues += 1;
  }
}
check('15,000 single-line cases reconcile with no residue', residues === 0, residues);

let mixedResidues = 0;
for (let a = 1; a <= 400; a += 1) {
  const b = computeTaxBreakdown([
    { grossCents: a, rate_pct: 4 },
    { grossCents: a * 3 + 7, rate_pct: 10 },
    { grossCents: a * 7 + 13, rate_pct: 21 },
  ]);
  if (b.taxable_base_cents + b.vat_total_cents !== b.gross_total_cents) mixedResidues += 1;
}
check('400 mixed-rate baskets reconcile with no residue', mixedResidues === 0, mixedResidues);

// ─── edges ─────────────────────────────────────────────────────
const empty = computeTaxBreakdown([]);
check('empty basket is all zeroes',
  empty.groups.length === 0 && empty.vat_total_cents === 0 && empty.gross_total_cents === 0);
const oneCent = computeTaxBreakdown([{ grossCents: 1, rate_pct: 21 }]);
check('a 1-cent line still reconciles',
  oneCent.taxable_base_cents + oneCent.vat_total_cents === 1, oneCent);
const zeroRate = computeTaxBreakdown([{ grossCents: 500, rate_pct: 0 }]);
check('0% means no vat and base === gross',
  zeroRate.vat_total_cents === 0 && zeroRate.taxable_base_cents === 500);

// ─── rate table ────────────────────────────────────────────────
check('rates are 0 / 4 / 10 / 21',
  VAT_RATES.zero === 0 && VAT_RATES.super_reduced === 4 && VAT_RATES.reduced === 10 && VAT_RATES.general === 21);
check('unknown category falls back to the 0 % default',
  rateForCategory(null) === 0 && rateForCategory(undefined) === 0);
check('a known category maps straight through', rateForCategory('general') === 21);

// ─── the band a product's prices carry ─────────────────────────
check('a band somebody chose is the band',
  effectiveVatCategory({ vat_category: 'general', vat_category_reviewed: true }) === 'general');
check('a band nobody chose is 0 %, whatever the placeholder says',
  effectiveVatCategory({ vat_category: 'reduced', vat_category_reviewed: false }) === 'zero');
check('a payload without the flag is taken at its category',
  effectiveVatCategory({ vat_category: 'super_reduced' }) === 'super_reduced');
check('no product, or no category, is 0 %',
  effectiveVatCategory(null) === 'zero' && effectiveVatCategory({}) === 'zero');

// ─── IVA added to a base price ─────────────────────────────────
const add = (net: number, rate: number, want: number) =>
  check(`${net}c + ${rate}% -> ${want}c`, addVatCents(net, rate) === want, addVatCents(net, rate));
add(1000, 10, 1100);
add(1000, 0, 1000);
add(2500, 21, 3025);
add(100, 4, 104);
add(199, 10, 219);  // 218.9
add(99, 21, 120);   // 119.79
add(15, 10, 17);    // 16.5 exactly: half up
add(1, 4, 1);       // 1.04
add(13, 4, 14);     // 13.52
add(0, 21, 0);
// Backing the IVA out of what was added gives the base back.
const back = computeTaxBreakdown([{ grossCents: addVatCents(1000, 10), rate_pct: 10 }]);
check('IVA added then backed out returns the base', back.taxable_base_cents === 1000 && back.vat_total_cents === 100, back);

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) throw new Error(`${failed} failing`);
