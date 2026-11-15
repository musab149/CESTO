/**
 * URL parsing for the Cloudinary → Bunny migration.
 *
 * These two functions decide which bytes get downloaded and where they land.
 * Both failure modes are quiet and expensive: `masterUrlOf` getting it wrong
 * migrates a 300px derivative in place of the original, which is unrecoverable
 * once Cloudinary is gone, and `objectPathFor` getting it wrong either scatters
 * objects across the zone root or — worse — maps two different assets onto one
 * path so the second silently overwrites the first.
 *
 *   npm run test:migrate-urls --workspace=packages/api
 */
import assert from 'assert';
import { masterUrlOf, objectPathFor } from './migrate-cloudinary-to-bunny';

const C = 'https://res.cloudinary.com/demo/image/upload';

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

// ─── masterUrlOf ─────────────────────────────────────────

test('master: a plain versioned URL is left alone', () => {
  assert.equal(masterUrlOf(`${C}/v1788796487/products/abc.png`), `${C}/v1788796487/products/abc.png`);
});

test('master: an inline transformation is stripped', () => {
  assert.equal(
    masterUrlOf(`${C}/f_auto,q_auto,c_limit,w_300/v1/products/abc.png`),
    `${C}/v1/products/abc.png`,
  );
});

test('master: a named transformation (t_…) is stripped', () => {
  assert.equal(masterUrlOf(`${C}/t_cesto_card/v1/products/abc.png`), `${C}/v1/products/abc.png`);
});

test('master: a URL with no version segment still resolves', () => {
  assert.equal(masterUrlOf(`${C}/products/abc.png`), `${C}/products/abc.png`);
});

// ─── objectPathFor ───────────────────────────────────────

test('path: a known folder is preserved and the extension swapped', () => {
  assert.equal(objectPathFor(`${C}/v1788796487/products/abc.png`, '.webp'), 'products/abc.webp');
});

test('path: the version segment is dropped', () => {
  assert.equal(objectPathFor(`${C}/v1/banners/hero.jpg`, '.webp'), 'banners/hero.webp');
});

test('path: transformations are stripped before the id is derived', () => {
  assert.equal(
    objectPathFor(`${C}/f_auto,q_auto,c_limit,w_300/v1/categories/rice.png`, '.webp'),
    'categories/rice.webp',
  );
});

test('path: nested folders under a known root survive', () => {
  assert.equal(objectPathFor(`${C}/v1/products/2026/q1/abc.png`, '.webp'), 'products/2026/q1/abc.webp');
});

test('path: an unknown folder is quarantined under migrated/', () => {
  assert.equal(objectPathFor(`${C}/v1/some/legacy/thing.png`, '.webp'), 'migrated/some/legacy/thing.webp');
});

test('path: a bare public_id goes under migrated/ rather than the zone root', () => {
  assert.equal(objectPathFor(`${C}/v1/loose.png`, '.webp'), 'migrated/loose.webp');
});

test('path: unsafe characters are sanitised but separators are kept', () => {
  assert.equal(objectPathFor(`${C}/v1/products/a b&c.png`, '.webp'), 'products/a_b_c.webp');
});

test('path: the same asset always maps to one object, however the URL was written', () => {
  // Re-runs must be idempotent, and a transformed and untransformed reference
  // to one image must not become two objects.
  assert.equal(
    objectPathFor(`${C}/v1788796487/products/abc.png`, '.webp'),
    objectPathFor(`${C}/f_auto,q_auto/v1788796487/products/abc.png`, '.webp'),
  );
});

test('path: distinct assets never collide on one object path', () => {
  const a = objectPathFor(`${C}/v1/products/abc.png`, '.webp');
  const b = objectPathFor(`${C}/v1/products/abd.png`, '.webp');
  assert.notEqual(a, b);
});

// ─── Runner ──────────────────────────────────────────────

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
