/**
 * Zero-dep test, same shape as the others here: node:assert, a `test()`
 * collector, run with ts-node.
 *
 * Run: npm run test:business-home --workspace=packages/api
 */
import assert from 'node:assert/strict';
import { DEFAULT_BUSINESS_HOME, type BusinessHomeContent, type BusinessAnnouncement, type BusinessPromotion } from './businessHomeDefaults';
import { mergeBusinessHome, publishedBusinessHome } from './businessHome';
import { businessHomeSchema } from '../validators/businessHome';

const cases: { name: string; run: () => void }[] = [];
function test(name: string, run: () => void): void { cases.push({ name, run }); }

const copy = (): BusinessHomeContent => JSON.parse(JSON.stringify(DEFAULT_BUSINESS_HOME)) as BusinessHomeContent;
const promo = (id: string, is_active: boolean): BusinessPromotion => ({
  id, title_es: `Oferta ${id}`, title_en: `Offer ${id}`, body_es: '', body_en: '', badge_es: '', badge_en: '',
  image_url: null, tone: 'blue', link: '/business/catalogue', is_active,
});
const note = (id: string, date: string | null, is_active = true): BusinessAnnouncement => ({
  id, date, tag: 'news', title_es: `Aviso ${id}`, title_en: `Notice ${id}`, body_es: '', body_en: '', is_active,
});

// The editor loads the defaults, and saving an untouched form sends them back.
test('the shipped defaults satisfy the validator', () => {
  const r = businessHomeSchema.safeParse(DEFAULT_BUSINESS_HOME);
  assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3)));
});

test('a row saved before a section existed still has every section', () => {
  const merged = mergeBusinessHome({ intro: DEFAULT_BUSINESS_HOME.intro });
  assert.deepEqual(merged.logistics, DEFAULT_BUSINESS_HOME.logistics);
  assert.deepEqual(merged.announcements, []);
  assert.deepEqual(mergeBusinessHome(null), DEFAULT_BUSINESS_HOME);
});

test('a business is sent only the promotions that are on, in the team\'s order', () => {
  const c = copy();
  c.promotions = [promo('a', true), promo('b', false), promo('c', true)];
  assert.deepEqual(publishedBusinessHome(c, '2026-11-01').promotions.map((p) => p.id), ['a', 'c']);
});

test('announcements: off ones and past days left out, dated soonest first, then undated', () => {
  const c = copy();
  c.announcements = [
    note('undated-1', null), note('later', '2026-12-24'), note('gone', '2026-10-31'),
    note('today', '2026-11-01'), note('off', '2026-11-05', false), note('undated-2', null),
  ];
  const out = publishedBusinessHome(c, '2026-11-01').announcements.map((a) => a.id);
  assert.deepEqual(out, ['today', 'later', 'undated-1', 'undated-2']);
});

test('publishing leaves the stored copy as it was', () => {
  const c = copy();
  c.promotions = [promo('a', false)];
  publishedBusinessHome(c, '2026-11-01');
  assert.equal(c.promotions.length, 1);
});

test('a banner is only its image: none, refused; one that is off is not sent; old words never go out', () => {
  const banner = { id: 'b1', is_active: true, link: '', image_url: '', image_mobile_url: null };
  const c = copy();
  c.banners = [banner];
  assert.equal(businessHomeSchema.safeParse(c).success, false);
  c.banners = [{ ...banner, image_url: 'https://cdn.example/b1.webp' }, { ...banner, id: 'b2', image_url: '/uploads/b2.webp', is_active: false }];
  const parsed = businessHomeSchema.safeParse({ ...c, banners: c.banners.map((b) => ({ ...b, title_es: 'Old words' })) });
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && 'title_es' in parsed.data.banners[0], false);
  // a row saved while banners could carry words: published without them
  c.banners = [{ ...c.banners[0], title_es: 'Old words', cta_es: 'Comprar' } as typeof banner];
  assert.deepEqual(publishedBusinessHome(c, '2026-11-01').banners, [{ id: 'b1', is_active: true, link: '', image_url: 'https://cdn.example/b1.webp', image_mobile_url: null }]);
  c.banners = [{ ...banner, image_url: 'https://cdn.example/b1.webp' }, { ...banner, id: 'b2', image_url: '/uploads/b2.webp', is_active: false }];
  assert.deepEqual(publishedBusinessHome(c, '2026-11-01').banners.map((x) => x.id), ['b1']);
});

test('links go inside the site or to https://, images are never data: blobs', () => {
  const c = copy();
  c.intro.link = 'javascript:alert(1)';
  assert.equal(businessHomeSchema.safeParse(c).success, false);
  const d = copy();
  d.intro.image_url = 'data:image/png;base64,AAAA';
  assert.equal(businessHomeSchema.safeParse(d).success, false);
});

test('validator rejects an icon the panel cannot draw, and a promotion too long for its card', () => {
  const c = copy();
  (c.logistics.points[0] as { icon: string }).icon = 'rocket';
  assert.equal(businessHomeSchema.safeParse(c).success, false);
  const d = copy();
  d.promotions = [{ ...promo('a', true), title_es: 'x'.repeat(61) }];
  assert.equal(businessHomeSchema.safeParse(d).success, false);
});

let passed = 0, failed = 0;
for (const c of cases) {
  try { c.run(); passed++; console.log(`  ok  ${c.name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${c.name}`); console.log(`        ${(e as Error).message}`); }
}
console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exitCode = 1;
process.exit();
