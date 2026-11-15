// ─── Unit test · the API's copy of the IVA rules ───────────────
//
// Run:  cd packages/api && npm run test:tax
//
// lib/tax.ts is a deliberate duplicate of packages/shared/src/tax.ts (see its
// header for why the API cannot import shared). Since 2026-11-01 this copy
// decides what a customer is CHARGED — lib/pricing adds IVA with it — while
// the shared one decides what the screens preview, so a drift between them is
// a price on screen that differs from the price at the till.
//
// Two guards: the same explicit values shared's tax.test.ts asserts, and the
// two files compared with their comments stripped, so even a change no value
// here happens to exercise fails until both copies carry it.

import fs from 'fs';
import path from 'path';
import {
  computeTaxBreakdown, eurosToCents, centsToEuros, rateForCategory, VAT_RATES,
  effectiveVatCategory, addVatCents, removeVatCents, recargoCents, recargoBasisPoints,
} from './tax';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++; console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

// ─── The two copies say the same thing ─────────────────────────
const codeOf = (file: string) => fs.readFileSync(file, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
  .replace(/\s+/g, ' ')
  .trim();
const apiCopy = codeOf(path.join(__dirname, 'tax.ts'));
const sharedCopy = codeOf(path.join(__dirname, '../../../shared/src/tax.ts'));
check('the API copy and the shared copy are the same code', apiCopy === sharedCopy,
  apiCopy === sharedCopy ? undefined : 'diff the two files with comments removed');

// ─── Same values as shared's suite ─────────────────────────────
check('rates are 0 / 4 / 10 / 21',
  VAT_RATES.zero === 0 && VAT_RATES.super_reduced === 4 && VAT_RATES.reduced === 10 && VAT_RATES.general === 21);
check('unknown category falls back to the 0 % default',
  rateForCategory(null) === 0 && rateForCategory(undefined) === 0);
check('a band somebody chose is the band',
  effectiveVatCategory({ vat_category: 'general', vat_category_reviewed: true }) === 'general');
check('a band nobody chose is 0 %, whatever the placeholder says',
  effectiveVatCategory({ vat_category: 'reduced', vat_category_reviewed: false }) === 'zero');

const add = (net: number, rate: number, want: number) =>
  check(`${net}c + ${rate}% -> ${want}c`, addVatCents(net, rate) === want, addVatCents(net, rate));
add(1000, 10, 1100);
add(1000, 0, 1000);
add(2500, 21, 3025);
add(199, 10, 219);
add(99, 21, 120);
add(15, 10, 17);
add(13, 4, 14);

check('"12.34" -> 1234 and back', centsToEuros(eurosToCents('12.34')) === '12.34');
const mixed = computeTaxBreakdown([
  { grossCents: 1100, rate_pct: 10 }, { grossCents: 1210, rate_pct: 21 }, { grossCents: 500, rate_pct: 0 },
]);
check('a mixed basket backs each rate out exactly',
  mixed.groups.map((g) => [g.rate_pct, g.base_cents, g.vat_cents].join(':')).join(' ') === '0:500:0 10:1000:100 21:1000:210',
  mixed.groups);

// ─── Back from a price to its base (factura editor, 2026-11-04) ─
// The editor keeps a line's base and re-adds IVA when the rate changes, so
// the base it recovers from what was charged must be the base that was
// charged — for every price checkout can produce, at every rate.
for (const rate of [0, 4, 10, 21]) {
  let bad: number | null = null;
  for (let net = 0; net <= 20000 && bad === null; net += 1) {
    if (removeVatCents(addVatCents(net, rate), rate) !== net) bad = net;
  }
  check(`every base 0.00–200.00 survives + ${rate}% IVA and back`, bad === null, { rate, firstBad: bad });
}
check('11.00 at 10 % is 10.00 without it', removeVatCents(1100, 10) === 1000);

// ─── Recargo de equivalencia (2026-11-04) ──────────────────
// The user's own example: €100 base at 21 % → €21 IVA + €5.20 recargo.
check('recargo on €100 base: 21 % → 5,20; 10 % → 1,40; 4 % → 0,50; 0 % → 0',
  recargoCents(10000, 21) === 520 && recargoCents(10000, 10) === 140
    && recargoCents(10000, 4) === 50 && recargoCents(10000, 0) === 0);
check('...on the base, never on the IVA: €100 + 21 € IVA + 5,20 € recargo = 126,20 €',
  10000 + 2100 + recargoCents(10000, 21) === 12620);
check('...half up to the cent (€0,10 base at 5,2 % is 0,52 c → 1 c; €0,09 → 0,468 c → 0 c)',
  recargoCents(10, 21) === 1 && recargoCents(9, 21) === 0);
check('a rate with no surcharge listed (e.g. 5 %) carries none', recargoBasisPoints(5) === 0);

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
