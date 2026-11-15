/**
 * Every service path starts with `/api/`.
 *
 * Trivial-looking, and it caught a dead feature. `configureApi({ baseUrl })`
 * is given an ORIGIN — `https://api.cestoshop.com`, or '' in dev behind the
 * Vite proxy — so the `/api` segment belongs to the path. The sales-rep
 * service was written with `'/sales/clients'` instead of `'/api/sales/clients'`
 * and every one of its sixteen calls 404'd: the whole surface was inert in the
 * browser while its server-side tests passed, because those drive the Express
 * app directly and never touch this layer.
 *
 * That is the gap this closes. A path is a string, so nothing typechecks it,
 * and a missing prefix is invisible until somebody opens the screen — the
 * GETs fail silently and only a POST puts an error on the page.
 *
 * Checked by reading the source rather than by calling anything: the point is
 * to cover the paths no test exercises, so a runtime check would miss exactly
 * the ones that matter.
 *
 *   npm run test:service-paths --workspace=packages/shared
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const SERVICES = path.join(__dirname, '..', 'src', 'api', 'services');

/**
 * `api.get<T>('path'` and its siblings, in all their forms.
 *
 * The type argument is matched as `[^()]*` rather than `[^>]*`. Nested
 * generics are everywhere here — `api.get<Paged<SalesProduct>>(` — and
 * stopping at the first `>` silently skipped every one of them. Which is how
 * the first run of this check reported a clean sweep over a service whose
 * every call was 404ing: the broken ones were exactly the ones it could not
 * see.
 */
const CALL = /\bapi\.(get|post|put|patch|delete)\s*(?:<[^()]*>)?\s*\(\s*(['`])([^'`]+)\2/g;

type Call = { file: string; method: string; path: string };

function collect(): Call[] {
  const out: Call[] = [];
  for (const file of fs.readdirSync(SERVICES)) {
    if (!file.endsWith('.ts')) continue;
    const src = fs.readFileSync(path.join(SERVICES, file), 'utf8');
    for (const m of src.matchAll(CALL)) {
      out.push({ file, method: m[1].toUpperCase(), path: m[3] });
    }
  }
  return out;
}

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

const calls = collect();

test('the service layer is actually being read', () => {
  // Guards the regex, not the code: a change to how calls are written would
  // otherwise turn this whole file into a test that passes by finding nothing.
  assert.ok(
    calls.length > 200,
    `only found ${calls.length} api.* calls — the matcher has probably stopped matching`,
  );
});

test('every path starts with /api/', () => {
  const bad = calls.filter((c) => !c.path.startsWith('/api/'));
  assert.deepEqual(
    bad.map((c) => `${c.file}: ${c.method} ${c.path}`),
    [],
    'baseUrl is an origin, so the /api segment belongs to the path',
  );
});

test('no path doubles the prefix', () => {
  // The other direction, and the likely slip when fixing the first: a base URL
  // that already ended in /api would have been the other way to "fix" this.
  const bad = calls.filter((c) => c.path.startsWith('/api/api/'));
  assert.deepEqual(bad.map((c) => `${c.file}: ${c.path}`), []);
});

test('the sales surface is covered, not just the old services', () => {
  // Named explicitly because this is the surface that was broken, and a
  // rename could quietly drop it out of the sweep above.
  const sales = calls.filter((c) => c.path.startsWith('/api/sales/'));
  assert.ok(sales.length >= 15, `expected the sales service's calls, found ${sales.length}`);
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
