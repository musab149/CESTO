/**
 * Every key the rep screens ask for exists, in BOTH languages.
 *
 * A missing key is the quietest bug on this surface. `useSalesT` returns the
 * key itself when the dictionary has nothing, so a typo renders
 * `sales.changePassword.title` on the page in place of a heading — no warning,
 * no throw, and nothing a typechecker can see, because a key is a string.
 * The ported screens are worse: `usePortT` honours admin's inline English
 * default, so a key missing only from the Spanish side shows admin's English
 * to a Spanish rep and looks completely fine in English.
 *
 * Which is why both dictionaries are checked separately rather than compared
 * for equal size. Parity is necessary and not sufficient: two dictionaries can
 * agree with each other and both be missing what a screen asks for.
 *
 * Reads the screens rather than rendering them: the point is to cover the
 * strings no test exercises, and apps/web has no React test harness, so a
 * runtime check would cover nothing at all.
 *
 *   npm run test:sales-keys --workspace=packages/shared
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const DICT = path.join(__dirname, '..', 'src', 'i18n', 'sales.ts');
const WEB_SRC = path.join(__dirname, '..', '..', '..', 'apps', 'web', 'src');

/**
 * `t('some.key'` — and nothing else.
 *
 * `(?<![\w.])` is the whole trick. Without it the matcher reads the `t(` at
 * the end of every other call: `params.get('q')`, `params.set('page')`,
 * `select('client')` all matched, and the first run of this check reported
 * nine missing keys that were query-string parameters.
 */
const CALL = /(?<![\w.])t\(\s*'([\w.]+)'/g;

/** The two object literals in i18n/sales.ts, in file order: Spanish, English. */
function dictionaries(): Array<Set<string>> {
  const src = fs.readFileSync(DICT, 'utf8');
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

/**
 * Found by WHAT A FILE USES, not by where it lives.
 *
 * Scanning apps/web/src/sales missed the first rep-facing component to be
 * written outside that folder: the shop-as-customer banner renders in the
 * customer layout, so it sits in src/components, and its three keys went
 * unchecked by the test whose entire job is to check them.
 *
 * apps/web has a SECOND `t` — `const { t } = useLanguageStore()`, the
 * customer dictionary — so the file list cannot simply be everything. A file
 * holding both would have its customer keys read as missing rep keys, which
 * is why that case is reported rather than guessed at: a test that quietly
 * skips files is the thing this is trying not to be.
 */
const SALES_T = /useSalesT|usePortT/;
const CUSTOMER_T = /\{\s*t\s*[,}][^=]*=\s*useLanguageStore/;
/**
 * The business panel borrows rep components that want a rep `t` (the filter
 * drawer, the status labels), so its screens hold `salesT = useSalesT()`
 * beside their own `t = useBizT()`. Their `t(` is the business dictionary's:
 * tests/businessKeys.test.ts reads those files, and checks their `salesT(`
 * keys against this dictionary.
 */
const BUSINESS_T = /useBizT\(\)/;

function repFacing(): { files: string[]; ambiguous: string[] } {
  const files: string[] = [];
  const ambiguous: string[] = [];
  for (const p of sources(WEB_SRC)) {
    const src = fs.readFileSync(p, 'utf8');
    if (!SALES_T.test(src)) continue;
    if (BUSINESS_T.test(src)) continue;
    // The helpers' own definitions mention themselves and translate nothing.
    if (/export function (useSalesT|usePortT)/.test(src)) continue;
    if (CUSTOMER_T.test(src)) ambiguous.push(path.relative(WEB_SRC, p));
    else files.push(p);
  }
  return { files, ambiguous };
}

type Ask = { file: string; key: string };

function collect(): Ask[] {
  const out: Ask[] = [];
  for (const file of rep.files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(CALL)) {
      const raw = m[1];
      // Two namespaces on one surface: native rep screens call their own
      // `sales.*` keys, while screens ported from admin keep admin's call
      // sites verbatim and resolve through the `sales.port.` prefix that
      // usePortT adds. Both end up in the same dictionary.
      out.push({ file: path.basename(file), key: raw.startsWith('sales.') ? raw : `sales.port.${raw}` });
    }
  }
  return out;
}

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

const [es, en] = dictionaries();
const rep = repFacing();
const asks = collect();

test('the dictionaries and the screens are actually being read', () => {
  // Guards the two regexes, not the code. Both of these have a failure mode
  // where they stop matching and the file becomes a test that passes by
  // looking at nothing.
  assert.ok(es.size > 400, `only parsed ${es.size} Spanish keys`);
  assert.ok(en.size > 400, `only parsed ${en.size} English keys`);
  assert.ok(rep.files.length > 10, `only found ${rep.files.length} rep-facing files`);
  assert.ok(asks.length > 300, `only found ${asks.length} t() calls on the rep surface`);
});

test('no file mixes the two dictionaries', () => {
  // If one ever does, this check cannot tell its keys apart and the file above
  // is excluded — so it has to be loud rather than silently uncovered. Split
  // the file, or teach the matcher which `t` is which.
  assert.deepEqual(rep.ambiguous, []);
});

test('every key a rep screen asks for exists in Spanish', () => {
  const missing = asks.filter((a) => !es.has(a.key));
  assert.deepEqual([...new Set(missing.map((a) => `${a.file}: ${a.key}`))], []);
});

test('every key a rep screen asks for exists in English', () => {
  const missing = asks.filter((a) => !en.has(a.key));
  assert.deepEqual([...new Set(missing.map((a) => `${a.file}: ${a.key}`))], []);
});

test('the two dictionaries carry the same keys', () => {
  // Not implied by the two checks above — a key can be present in both and
  // asked for by nobody, or dropped from one side after its screen was
  // deleted. Keeps the pair honest for the rep tablet app, which will render
  // the same dictionary without these screens.
  assert.deepEqual([...es].filter((k) => !en.has(k)), [], 'Spanish-only keys');
  assert.deepEqual([...en].filter((k) => !es.has(k)), [], 'English-only keys');
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
