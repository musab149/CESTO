/**
 * Zero-dep test, same shape as the others here: node:assert, a `test()`
 * collector, run with ts-node.
 *
 * Run: npm run test:app-content --workspace=packages/api
 */
import assert from 'node:assert/strict';
import { DEFAULT_APP_CONTENT, type AppContent } from './appContentDefaults';
import { mergeAppContent } from './appContent';
import { appContentSchema } from '../validators/appContent';

const cases: { name: string; run: () => void }[] = [];
function test(name: string, run: () => void): void { cases.push({ name, run }); }

// The editor loads the defaults, and saving an untouched form sends them
// straight back. If they cannot pass their own validator, the first thing an
// admin does — open the page and press Save — fails.
test('the shipped defaults satisfy the validator', () => {
  const r = appContentSchema.safeParse(DEFAULT_APP_CONTENT);
  assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3)));
});

test('every default string is present in both languages', () => {
  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      assert.notEqual(node.trim(), '', `empty string at ${path}`);
      return;
    }
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        walk(v, `${path}.${k}`);
        if (k.endsWith('_es')) {
          const twin: unknown = (node as Record<string, unknown>)[`${k.slice(0, -3)}_en`];
          assert.equal(typeof twin, 'string', `missing English twin for ${path}.${k}`);
        }
      }
    }
  };
  walk(DEFAULT_APP_CONTENT, 'content');
});

// A row saved before a section existed is missing that key. On a phone the
// result is a blank screen in a build nobody can hotfix, so the read fills it.
test('a stored value missing a section falls back to the default', () => {
  const partial = { onboarding: { slides: [] } } as unknown as Partial<AppContent>;
  const merged = mergeAppContent(partial);
  assert.deepEqual(merged.about, DEFAULT_APP_CONTENT.about);
  assert.deepEqual(merged.rashan, DEFAULT_APP_CONTENT.rashan);
  assert.deepEqual(merged.ribbon, DEFAULT_APP_CONTENT.ribbon);
  assert.deepEqual(merged.onboarding, { slides: [] });
});

test('no stored value at all returns the defaults', () => {
  assert.deepEqual(mergeAppContent(null), DEFAULT_APP_CONTENT);
  assert.deepEqual(mergeAppContent(undefined), DEFAULT_APP_CONTENT);
});

test('validator rejects copy too long for the layout it renders into', () => {
  const tooLong = JSON.parse(JSON.stringify(DEFAULT_APP_CONTENT)) as AppContent;
  tooLong.ribbon.items[0].label_es = 'x'.repeat(31);
  assert.equal(appContentSchema.safeParse(tooLong).success, false);
});

test('validator rejects an icon the apps cannot draw', () => {
  const bad = JSON.parse(JSON.stringify(DEFAULT_APP_CONTENT)) as AppContent;
  (bad.ribbon.items[0] as { icon: string }).icon = 'rocket';
  assert.equal(appContentSchema.safeParse(bad).success, false);
});

let passed = 0, failed = 0;
for (const c of cases) {
  try { c.run(); passed++; console.log(`  ok  ${c.name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${c.name}`); console.log(`        ${(e as Error).message}`); }
}
console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exitCode = 1;
