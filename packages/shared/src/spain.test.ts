// ─── Unit test · Spanish address + email helpers ───────────────
//
// Run:  cd packages/shared && npx ts-node src/spain.test.ts
//
// Imports the module DIRECTLY, never the package barrel: src/index.ts
// re-exports originArt.tsx and ts-node here has no --jsx, so a barrel import
// fails to compile. Same reason packages/api cannot import the barrel.
//
// Pure functions, no database, no fixtures.

import { provinceForPostcode, suggestEmailCorrection, SPANISH_PROVINCES, PROVINCE_NAMES } from './spain';

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

// ─── provinceForPostcode ───────────────────────────────────────
check('28001 -> Madrid', provinceForPostcode('28001') === 'Madrid', provinceForPostcode('28001'));
check('08001 -> Barcelona', provinceForPostcode('08001') === 'Barcelona');
check('46001 -> Valencia', provinceForPostcode('46001') === 'Valencia');
check('01001 -> Araba/Álava (lowest code)', provinceForPostcode('01001') === 'Araba/Álava');
check('52001 -> Melilla (highest code)', provinceForPostcode('52001') === 'Melilla');
check('38001 -> Santa Cruz de Tenerife', provinceForPostcode('38001') === 'Santa Cruz de Tenerife');

// The leading zero is the whole reason this is keyed by string. '08001'
// parsed as a number is 8001, and '08' is not 8.
check('leading zero survives', provinceForPostcode('08015') === 'Barcelona');

check('surrounding space tolerated', provinceForPostcode('  28001  ') === 'Madrid');
check('53xxx -> null (no province 53)', provinceForPostcode('53001') === null);
check('99999 -> null', provinceForPostcode('99999') === null);
check('00xxx -> null (no province 00)', provinceForPostcode('00123') === null);
check('too short -> null', provinceForPostcode('2800') === null);
check('too long -> null', provinceForPostcode('280011') === null);
check('non-numeric -> null', provinceForPostcode('28A01') === null);
check('empty -> null', provinceForPostcode('') === null);

// ─── the table itself ──────────────────────────────────────────
check('52 provinces', Object.keys(SPANISH_PROVINCES).length === 52, Object.keys(SPANISH_PROVINCES).length);
check('every key is two digits', Object.keys(SPANISH_PROVINCES).every((k) => /^\d{2}$/.test(k)));
check('codes run 01..52 with no gaps',
  Object.keys(SPANISH_PROVINCES).sort().join(',') ===
  Array.from({ length: 52 }, (_, i) => String(i + 1).padStart(2, '0')).join(','));
check('no duplicate names', new Set(Object.values(SPANISH_PROVINCES)).size === 52);
check('PROVINCE_NAMES is sorted for Spanish', PROVINCE_NAMES[0] === 'A Coruña', PROVINCE_NAMES[0]);
check('PROVINCE_NAMES has all 52', PROVINCE_NAMES.length === 52);

// ─── suggestEmailCorrection ────────────────────────────────────
check('gmial.com -> gmail.com', suggestEmailCorrection('ana@gmial.com') === 'ana@gmail.com');
check('hotmial.com -> hotmail.com', suggestEmailCorrection('jose@hotmial.com') === 'jose@hotmail.com');
check('outlook.con -> outlook.com', suggestEmailCorrection('x@outlook.con') === 'x@outlook.com');
check('case-insensitive on the domain', suggestEmailCorrection('Ana@GMIAL.COM') === 'Ana@gmail.com');
check('local part preserved verbatim',
  suggestEmailCorrection('first.last+tag@gmial.com') === 'first.last+tag@gmail.com');

// The important negative: a correct address must never be "corrected".
check('gmail.com -> no suggestion', suggestEmailCorrection('ana@gmail.com') === null);
check('a real company domain -> no suggestion', suggestEmailCorrection('ana@cestoshop.com') === null);
check('no @ -> null', suggestEmailCorrection('not-an-email') === null);
check('@ at position 0 -> null', suggestEmailCorrection('@gmail.com') === null);
check('empty -> null', suggestEmailCorrection('') === null);

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
