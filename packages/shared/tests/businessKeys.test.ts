/**
 * Every key the business panel asks for exists, in BOTH languages.
 *
 * The rep surface's check (tests/salesKeys.test.ts), for /business/*. Same
 * failure, same blindness: `businessT` returns the key itself when the
 * dictionary has nothing, so a typo puts `biz.cart.title` on the page where a
 * heading should be, and no typechecker can see it because a key is a string.
 *
 * The panel's screens also borrow rep components that take a rep `t` — the
 * filter drawer, the status labels — through `salesT = useSalesT()`. Those
 * keys live in the rep dictionary, so they are checked against that one.
 *
 *   npm run test:business-keys --workspace=packages/shared
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const BIZ_DICT = path.join(__dirname, '..', 'src', 'i18n', 'business.ts');
const SALES_DICT = path.join(__dirname, '..', 'src', 'i18n', 'sales.ts');
const WEB_SRC = path.join(__dirname, '..', '..', '..', 'apps', 'web', 'src');

/** `t('some.key'` — not `salesT(`, not `params.get(` (see salesKeys). */
const CALL = /(?<![\w.])t\(\s*'([\w.]+)'/g;
/** `salesT('sales.key'` — the rep dictionary, borrowed. */
const SALES_CALL = /(?<![\w.])salesT\(\s*'([\w.]+)'/g;
/**
 * A plural picked at the call site: `t(n === 1 ? 'a_one' : 'a_other', …)`.
 * businessT has no plural rules, so each branch is a key of its own.
 */
const PLURAL = /(?<![\w.])t\([^'()]*\?\s*'([\w.]+)'\s*:\s*'([\w.]+)'/g;

/** The two object literals in a dictionary file, in file order: Spanish, English. */
function dictionaries(file: string): Array<Set<string>> {
  const src = fs.readFileSync(file, 'utf8');
  const blocks = src.match(/=\s*\{[\s\S]*?\n\};/g) ?? [];
  return blocks.map((b) => new Set([...b.matchAll(/'([a-z][\w.]*)':/g)].map((m) => m[1])));
}

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Found by what a file uses, not where it lives (salesKeys learned that). */
function businessFacing(): string[] {
  return sources(WEB_SRC).filter((p) => {
    const src = fs.readFileSync(p, 'utf8');
    return /useBizT\(\)/.test(src) && !/export function useBizT/.test(src);
  });
}

type Ask = { file: string; key: string };

function collect(files: string[], re: RegExp): Ask[] {
  return files.flatMap((file) => {
    const src = fs.readFileSync(file, 'utf8');
    return [...src.matchAll(re)].flatMap((m) => m.slice(1).filter(Boolean).map((key) => ({ file: path.basename(file), key })));
  });
}

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

const [es, en] = dictionaries(BIZ_DICT);
const [salesEs, salesEn] = dictionaries(SALES_DICT);
const files = businessFacing();
const asks = [...collect(files, CALL), ...collect(files, PLURAL)];
const borrowed = collect(files, SALES_CALL);
const missing = (from: Ask[], dict: Set<string>) =>
  [...new Set(from.filter((a) => !dict.has(a.key)).map((a) => `${a.file}: ${a.key}`))];

test('the dictionaries and the screens are actually being read', () => {
  assert.ok(es.size > 300, `only parsed ${es.size} Spanish keys`);
  assert.ok(en.size > 300, `only parsed ${en.size} English keys`);
  assert.ok(files.length > 10, `only found ${files.length} business-facing files`);
  assert.ok(asks.length > 250, `only found ${asks.length} t() calls on the business surface`);
  assert.ok(asks.some((a) => a.key.endsWith('_other')), 'the plural matcher found nothing');
});

test('every key a business screen asks for exists in Spanish', () => {
  assert.deepEqual(missing(asks, es), []);
});

test('every key a business screen asks for exists in English', () => {
  assert.deepEqual(missing(asks, en), []);
});

test('every rep key a business screen borrows exists in both rep dictionaries', () => {
  assert.deepEqual(missing(borrowed, salesEs), [], 'Spanish');
  assert.deepEqual(missing(borrowed, salesEn), [], 'English');
});

test('the two dictionaries carry the same keys', () => {
  assert.deepEqual([...es].filter((k) => !en.has(k)), [], 'Spanish-only keys');
  assert.deepEqual([...en].filter((k) => !es.has(k)), [], 'English-only keys');
});

test('a placeholder in one language is in the other', () => {
  // `{{count}}` dropped from one side renders the literal text unchanged and
  // looks fine to whoever reads the other language.
  const src = fs.readFileSync(BIZ_DICT, 'utf8');
  const [esBlock = '', enBlock = ''] = src.match(/=\s*\{[\s\S]*?\n\};/g) ?? [];
  const vars = (block: string) => new Map([...block.matchAll(/^\s*'([\w.]+)':\s*'((?:[^'\\]|\\.)*)'/gm)]
    .map((m) => [m[1], [...m[2].matchAll(/\{\{(\w+)\}\}/g)].map((v) => v[1]).sort().join(',')]));
  const a = vars(esBlock);
  const b = vars(enBlock);
  assert.ok(a.size > 300, `only parsed ${a.size} Spanish values`);
  assert.deepEqual([...a].filter(([k, v]) => b.has(k) && b.get(k) !== v).map(([k]) => k), []);
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
