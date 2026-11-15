/**
 * resolveImageUrl / imageSrcSet — delivery URL construction.
 *
 * Worth a test at all because this is a two-line function guarding ~200 call
 * sites across web, admin and mobile, and every failure mode is silent: a
 * wrong Bunny param name does not throw, it just serves a full-size original
 * and shows up as a bandwidth bill. The Cloudinary cases are here to pin the
 * legacy branch in place while old rows still reference it.
 *
 *   npm run test:image-url --workspace=packages/shared
 */
import assert from 'assert';
import { configureApi } from '../src/api/client';
import { resolveImageUrl, imageSrcSet, configureImageCdn } from '../src/api/imageUrl';

configureApi({ baseUrl: 'https://api.example.com' });

const BUNNY = 'https://cesto.b-cdn.net/products/abc123.webp';
const BUNNY_BASE = 'https://cesto.b-cdn.net/products/abc123';
const CLOUDINARY = 'https://res.cloudinary.com/demo/image/upload/v1788796487/products/abc.png';

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

// ─── Bunny ───────────────────────────────────────────────

test('bunny: preset resolves to the stored variant file', () => {
  assert.equal(resolveImageUrl(BUNNY, 'card'), `${BUNNY_BASE}_w300.webp`);
  assert.equal(resolveImageUrl(BUNNY, 'thumb'), `${BUNNY_BASE}_w200.webp`);
  assert.equal(resolveImageUrl(BUNNY, 'tile'), `${BUNNY_BASE}_w400.webp`);
  assert.equal(resolveImageUrl(BUNNY, 'logo'), `${BUNNY_BASE}_w200.webp`);
  assert.equal(resolveImageUrl(BUNNY, 'hero'), `${BUNNY_BASE}_w800.webp`);
});

test('bunny: banner resolves to the master — 1600 IS the master cap', () => {
  assert.equal(resolveImageUrl(BUNNY, 'banner'), BUNNY);
});

test('bunny: raw and un-presetted calls serve the master', () => {
  assert.equal(resolveImageUrl(BUNNY, 'raw'), BUNNY);
  assert.equal(resolveImageUrl(BUNNY), BUNNY);
});

test('bunny: never emits a query param — Optimizer is off and would ignore it', () => {
  for (const p of ['thumb', 'card', 'tile', 'logo', 'hero', 'banner'] as const) {
    assert.ok(!resolveImageUrl(BUNNY, p).includes('?'), `${p} emitted a query string`);
  }
});

test('bunny: a non-webp master is never rewritten (animated GIFs keep their frames)', () => {
  const gif = 'https://cesto.b-cdn.net/products/abc123.gif';
  assert.equal(resolveImageUrl(gif, 'card'), gif);
  const jpg = 'https://cesto.b-cdn.net/products/abc123.jpg';
  assert.equal(resolveImageUrl(jpg, 'card'), jpg);
});

test('bunny: custom pull-zone domain is only recognised once configured', () => {
  const custom = 'https://images.cesto.es/products/abc123.webp';
  assert.equal(resolveImageUrl(custom, 'card'), custom, 'untransformed before configure');

  configureImageCdn('https://images.cesto.es');
  assert.equal(
    resolveImageUrl(custom, 'card'),
    'https://images.cesto.es/products/abc123_w300.webp',
  );

  configureImageCdn(null);
  assert.equal(resolveImageUrl(custom, 'card'), custom, 'untransformed after reset');
});

// ─── Cloudinary (legacy rows) ────────────────────────────

test('cloudinary: transform is injected ahead of the version segment', () => {
  assert.equal(
    resolveImageUrl(CLOUDINARY, 'card'),
    'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_300/v1788796487/products/abc.png',
  );
});

test('cloudinary: no preset changes format/quality but not dimensions', () => {
  const out = resolveImageUrl(CLOUDINARY);
  assert.ok(out.includes('/f_auto,q_auto/'));
  assert.ok(!out.includes('w_'));
});

test('cloudinary: an already-transformed URL is never double-stacked', () => {
  const pre = 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_300/v1/x/y.webp';
  assert.equal(resolveImageUrl(pre, 'hero'), pre);
});

// ─── Everything else ─────────────────────────────────────

test('relative /uploads path is prefixed with the API base', () => {
  assert.equal(
    resolveImageUrl('/uploads/products/abc.webp'),
    'https://api.example.com/uploads/products/abc.webp',
  );
});

test('third-party, data: and blob: URLs pass straight through', () => {
  const flickr = 'https://loremflickr.com/400/400/rice?lock=1';
  assert.equal(resolveImageUrl(flickr, 'card'), flickr);
  assert.equal(resolveImageUrl('data:image/png;base64,AAAA', 'card'), 'data:image/png;base64,AAAA');
  assert.equal(resolveImageUrl('blob:http://x/y', 'card'), 'blob:http://x/y');
});

test('empty input yields empty string', () => {
  assert.equal(resolveImageUrl(null), '');
  assert.equal(resolveImageUrl(undefined), '');
  assert.equal(resolveImageUrl(''), '');
});

// ─── srcSet ──────────────────────────────────────────────

test('srcSet: bunny emits one stored variant per width', () => {
  assert.equal(
    imageSrcSet(BUNNY, [200, 400]),
    `${BUNNY_BASE}_w200.webp 200w, ${BUNNY_BASE}_w400.webp 400w`,
  );
});

test('srcSet: the default widths are all in the generated ladder', () => {
  // [200, 300, 600] is the default. If any of these stopped being generated
  // the browser could pick a 404 and render a blank image.
  const out = imageSrcSet(BUNNY);
  assert.ok(out.includes('_w200.webp 200w'));
  assert.ok(out.includes('_w300.webp 300w'));
  assert.ok(out.includes('_w600.webp 600w'));
});

test('srcSet: a width with no stored variant is dropped, not emitted', () => {
  // 999 is not in the ladder, so offering it would be offering a 404.
  assert.equal(imageSrcSet(BUNNY, [300, 999]), `${BUNNY_BASE}_w300.webp 300w`);
  assert.equal(imageSrcSet(BUNNY, [999]), '');
});

test('srcSet: cloudinary still builds candidates for legacy rows', () => {
  const out = imageSrcSet(CLOUDINARY, [200]);
  assert.ok(out.includes('c_limit,w_200'));
  assert.ok(out.endsWith(' 200w'));
});

test('srcSet: returns empty for anything untransformable (inert in <img>)', () => {
  assert.equal(imageSrcSet('https://loremflickr.com/400/400/rice'), '');
  assert.equal(imageSrcSet('/uploads/products/abc.webp'), '');
  assert.equal(imageSrcSet('https://cesto.b-cdn.net/products/abc.gif'), '');
  assert.equal(imageSrcSet(null), '');
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
