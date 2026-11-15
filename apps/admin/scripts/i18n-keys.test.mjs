// ─── Contract test · every t() key exists in BOTH locales ──────────────────
//
// Run:  cd apps/admin && npm run test:i18n
//
// A missing locale key does not throw, warn, or render an error. i18next
// falls back to the inline English default, and the admin panel is English by
// default — so to whoever is looking it is indistinguishable from working.
// The only person who finds out is an admin running in Spanish, and what they
// see is one English sentence in the middle of their screen.
//
// That is how 110 keys accumulated unnoticed, found while renaming six of
// them for the shared credentials dialog on 2026-10-10. 19 were in live
// surfaces and were translated then; the rest are the multi-vendor store
// admin, listed below.
//
// Plain Node, deliberately: this reads source text and JSON, so it needs no
// TypeScript and no ts-node, and apps/admin has neither.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
const LOCALES = path.join(SRC, 'i18n', 'locales');

/**
 * Keys that are KNOWN to be missing, so a new one fails this while the
 * existing backlog does not.
 *
 * All of it is the multi-vendor store admin — the `stores` and
 * `storeProducts` screens, which are behind the MV flags. Translating them is
 * a block of domain copy somebody who has seen those screens should write,
 * not something to guess at. Delete entries from here as they are done; the
 * check below fails if a listed key turns out to EXIST, so this list cannot
 * quietly rot either.
 */
const KNOWN_MISSING = new Set(
  fs.readFileSync(path.join(HERE, 'i18n-known-missing.txt'), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')),
);

const locales = Object.fromEntries(
  ['en', 'es'].map((l) => [l, JSON.parse(fs.readFileSync(path.join(LOCALES, `${l}.json`), 'utf8'))]),
);

function lookup(dict, dotted) {
  let cur = dict;
  for (const part of dotted.split('.')) {
    if (typeof cur !== 'object' || cur === null || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * i18next resolves `thing.count` through `thing.count_one` / `_other` when the
 * call passes a `count`. The base key legitimately does not exist, so a plain
 * lookup would report a false miss.
 */
function has(dict, key) {
  if (lookup(dict, key) !== undefined) return true;
  return ['_one', '_other', '_many'].some((s) => lookup(dict, key + s) !== undefined);
}

/** t('a.b') and the multi-line t(\n 'a.b', …) form both. */
const CALL = /\bt\(\s*'([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)'/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const used = new Map();
for (const file of walk(SRC)) {
  const code = fs.readFileSync(file, 'utf8');
  for (const m of code.matchAll(CALL)) {
    if (!used.has(m[1])) used.set(m[1], path.relative(SRC, file));
  }
}

const cases = [];
const test = (name, run) => cases.push({ name, run });

test('the scan is actually finding keys', () => {
  // Guards the regex: a change to how t() is called would otherwise turn this
  // into a check that passes by finding nothing.
  if (used.size < 300) throw new Error(`only found ${used.size} keys — has the call shape changed?`);
});

test('every key used in the code exists in en AND es', () => {
  const missing = [];
  for (const [key, where] of used) {
    if (KNOWN_MISSING.has(key)) continue;
    const gone = ['en', 'es'].filter((l) => !has(locales[l], key));
    if (gone.length) missing.push(`${key} [${gone.join(',')}] — ${where}`);
  }
  if (missing.length) {
    throw new Error(
      `${missing.length} key(s) would silently render their English default:\n      `
      + missing.join('\n      '),
    );
  }
});

test('the known-missing list has no entries that now exist', () => {
  // Otherwise the list grows stale and starts hiding real gaps.
  const fixed = [...KNOWN_MISSING].filter(
    (key) => ['en', 'es'].every((l) => has(locales[l], key)),
  );
  if (fixed.length) {
    throw new Error(
      `${fixed.length} key(s) are translated now — remove them from `
      + `scripts/i18n-known-missing.txt:\n      ` + fixed.join('\n      '),
    );
  }
});

test('the known-missing list has no entries nothing uses', () => {
  const unused = [...KNOWN_MISSING].filter((key) => !used.has(key));
  if (unused.length) {
    throw new Error(
      `${unused.length} listed key(s) are no longer used anywhere — remove them:\n      `
      + unused.join('\n      '),
    );
  }
});

let failures = 0;
for (const { name, run } of cases) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL ${name}\n      ${e.message}`);
  }
}
console.log(`\n${cases.length - failures}/${cases.length} passed`);
if (failures > 0) process.exit(1);
