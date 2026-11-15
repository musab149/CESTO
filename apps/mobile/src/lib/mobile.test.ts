// ─── Unit tests · mobile P1–P6 logic ────────────────────────
//
// Run:  cd apps/mobile && npm run test:unit
// or:   npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node","jsx":"react"}' src/lib/mobile.test.ts
//
// Zero-dep, same shape as packages/api's test files: node:assert, a `test()`
// collector, and a runner at the bottom that exits non-zero on failure. The
// mobile app has no jest/vitest and adding one before the SDK 54 upgrade means
// one more dependency to reconcile, so this covers the pure logic only.
//
// SCOPE — what is and is not here:
//   Covered: the decisions that broke, or could silently break, the purchase
//   path and the catalogue. All pure functions, no React, no native modules.
//   Not covered: screen rendering, navigation and anything touching
//   AsyncStorage or expo-* native modules. Those need a device or a harness
//   that does not exist yet; the plan's P7 device pass is where they get
//   exercised.

import assert from 'node:assert/strict';
import { resolveCheckoutLanding } from './checkoutResponse';
import { reconcileCartPrices, type PriceableLine } from './cartPricing';
import { dedupeById, dedupeProductIdentity } from './dedupe';
import { shopForProduct } from './shopForProduct';
import {
  foldText, initialOf, monogram, filterAndSortBrands, isBrandFilterActive,
  groupByInitial, nextRecentBrands, parseRecentBrands, RECENT_BRANDS_MAX,
} from './brandFilter';
import { filterAndSortOrigins, isOriginFilterActive } from './originFilter';
import {
  orderStatusMeta,
  showsTracker,
  isActiveOrderStatus,
  CANCELLABLE_STATUSES,
  orderStatusConfig,
} from '../constants/orderStatus';

type Case = { name: string; run: () => void };
const cases: Case[] = [];
function test(name: string, run: () => void): void { cases.push({ name, run }); }

// ─── P1 · checkout landing ──────────────────────────────────
// The bug this replaces: `resp.id` on the union returned undefined for a split
// checkout, so the customer landed on /order/undefined with a cleared cart and
// a real order they could not see.

test('single Order response → its own id', () => {
  assert.equal(resolveCheckoutLanding({ id: 'order-1', order_number: 'ORD-1' }), 'order-1');
});

test('split response → the parent id, not the first sub', () => {
  const resp = {
    parent_order: { id: 'parent-1', order_number: 'ORD-1-P' },
    orders: [{ id: 'sub-1' }, { id: 'sub-2' }],
  };
  assert.equal(resolveCheckoutLanding(resp), 'parent-1');
});

test('a sub-order carrying parent_order is NOT treated as split', () => {
  // Order itself has an optional parent_order, so keying on that alone would
  // misread a sub-order and navigate to the parent instead of the order just
  // placed. The array is the discriminator.
  const subOrder = { id: 'sub-9', parent_order: { id: 'parent-9' } };
  assert.equal(resolveCheckoutLanding(subOrder), 'sub-9');
});

test('single-store cart split by a draft line still resolves', () => {
  // MV_DRAFT_ORDERS defaults on: one under-stocked line produces a second
  // group, so a cart with no partner store at all comes back split.
  const resp = {
    parent_order: { id: 'parent-draft' },
    orders: [{ id: 'deliverable' }, { id: 'draft-sub' }],
  };
  assert.equal(resolveCheckoutLanding(resp), 'parent-draft');
});

test('split with an unusable parent id falls back to the first sub', () => {
  assert.equal(
    resolveCheckoutLanding({ parent_order: {}, orders: [{ id: 'sub-a' }, { id: 'sub-b' }] }),
    'sub-a',
  );
});

test('malformed responses return null rather than "undefined"', () => {
  // Every one of these used to produce the string "/order/undefined".
  assert.equal(resolveCheckoutLanding(null), null);
  assert.equal(resolveCheckoutLanding(undefined), null);
  assert.equal(resolveCheckoutLanding({}), null);
  assert.equal(resolveCheckoutLanding({ id: '' }), null);
  assert.equal(resolveCheckoutLanding({ id: 123 }), null);
  assert.equal(resolveCheckoutLanding('nope'), null);
  assert.equal(resolveCheckoutLanding({ orders: [], parent_order: {} }), null);
});

// ─── P1 · order status metadata ─────────────────────────────

test('every OrderStatus the API can send has a config entry', () => {
  // The two that were missing are exactly why the status pill rendered
  // undefined after MV Slice 4.
  const all = [
    'pending', 'confirmed', 'preparing', 'on_the_way',
    'delivered', 'cancelled', 'draft', 'partially_completed',
  ] as const;
  for (const s of all) {
    const meta = orderStatusConfig[s];
    assert.ok(meta, `missing config for ${s}`);
    assert.ok(meta.label_en && meta.label_es, `${s} missing a label`);
    assert.ok(meta.desc_en && meta.desc_es, `${s} missing a description`);
    assert.ok(meta.bg && meta.text && meta.accent, `${s} missing a colour`);
  }
});

test('unknown status degrades instead of crashing', () => {
  // A store binary cannot be force-updated, so it WILL outlive the API's enum.
  // The old code indexed the map directly and blew up on config.bg.
  const meta = orderStatusMeta('some_future_status');
  assert.equal(meta.label_en, 'Some future status');
  assert.ok(meta.bg, 'fallback must still carry a background colour');
  assert.ok(meta.text, 'fallback must still carry a text colour');
});

test('null / undefined / empty status still render something', () => {
  for (const input of [null, undefined, '']) {
    const meta = orderStatusMeta(input);
    assert.ok(meta.label_en.length > 0, `no label for ${String(input)}`);
    assert.ok(meta.bg.length > 0, `no colour for ${String(input)}`);
  }
});

test('the tracker rail is hidden for statuses it cannot describe', () => {
  // cancelled stops short of the rail, draft has not entered it, and
  // partially_completed is several rails at once.
  assert.equal(showsTracker('cancelled'), false);
  assert.equal(showsTracker('draft'), false);
  assert.equal(showsTracker('partially_completed'), false);
  assert.equal(showsTracker('preparing'), true);
  assert.equal(showsTracker('delivered'), true);
});

test('active statuses drive the Track affordance', () => {
  for (const s of ['pending', 'confirmed', 'preparing', 'on_the_way']) {
    assert.equal(isActiveOrderStatus(s), true, `${s} should be active`);
  }
  for (const s of ['delivered', 'cancelled', 'draft', 'partially_completed']) {
    assert.equal(isActiveOrderStatus(s), false, `${s} should not be active`);
  }
});

test('cancellable set matches what the API accepts', () => {
  // packages/api/src/routes/orders.ts guards on exactly these three. Web only
  // offers the first two; mobile follows the server, because a draft is
  // precisely the order a customer stuck waiting on stock wants to drop.
  assert.deepEqual([...CANCELLABLE_STATUSES].sort(), ['confirmed', 'draft', 'pending']);
});

// ─── P2 · cart price reconciliation ─────────────────────────

const line = (over: Partial<PriceableLine> = {}): PriceableLine => ({
  variantId: 'v1', price: 2.5, compare_at_price: null, maxStock: 10, quantity: 2, ...over,
});

test('no live data for a line leaves it untouched', () => {
  const items = [line()];
  assert.equal(reconcileCartPrices(items, {}), null);
});

test('identical figures are a no-op, so the effect cannot loop', () => {
  const items = [line({ price: 3, maxStock: 5, quantity: 1 })];
  const fresh = { v1: { price: 3, compare_at_price: null, maxStock: 5 } };
  assert.equal(reconcileCartPrices(items, fresh), null);
});

test('a changed price is applied', () => {
  const items = [line({ price: 2.5 })];
  const fresh = { v1: { price: 3.1, compare_at_price: 4, maxStock: 10 } };
  const next = reconcileCartPrices(items, fresh);
  assert.ok(next);
  assert.equal(next![0].price, 3.1);
  assert.equal(next![0].compare_at_price, 4);
});

test('quantity clamps down when stock falls below the basket', () => {
  const items = [line({ quantity: 8, maxStock: 10 })];
  const fresh = { v1: { price: 2.5, compare_at_price: null, maxStock: 3 } };
  const next = reconcileCartPrices(items, fresh);
  assert.ok(next);
  assert.equal(next![0].quantity, 3);
  assert.equal(next![0].maxStock, 3);
});

test('zero stock never silently empties the line', () => {
  // Clamping to 0 would delete a line the customer deliberately chose. The
  // checkout quote flags it as unavailable instead, which is a message rather
  // than a disappearance.
  const items = [line({ quantity: 4 })];
  const fresh = { v1: { price: 2.5, compare_at_price: null, maxStock: 0 } };
  const next = reconcileCartPrices(items, fresh);
  assert.ok(next);
  assert.equal(next![0].quantity, 4);
  assert.equal(next![0].maxStock, 0);
});

test('quantity below available stock is left alone', () => {
  const items = [line({ quantity: 2, maxStock: 10 })];
  const fresh = { v1: { price: 2.5, compare_at_price: null, maxStock: 50 } };
  const next = reconcileCartPrices(items, fresh);
  assert.ok(next);
  assert.equal(next![0].quantity, 2);
});

test('a missing line does not block reconciliation of its neighbours', () => {
  const items = [line({ variantId: 'gone' }), line({ variantId: 'here', price: 1 })];
  const fresh = { here: { price: 9, compare_at_price: null, maxStock: 10 } };
  const next = reconcileCartPrices(items, fresh);
  assert.ok(next);
  assert.equal(next![0].price, 2.5, 'delisted line keeps its snapshot');
  assert.equal(next![1].price, 9);
});

test('compare_at_price clearing is treated as a change', () => {
  // A discount ending is exactly the kind of drift this exists to catch, and
  // null === null must not read as "unchanged" when the old value was a number.
  const items = [line({ compare_at_price: 5 })];
  const fresh = { v1: { price: 2.5, compare_at_price: null, maxStock: 10 } };
  const next = reconcileCartPrices(items, fresh);
  assert.ok(next, 'clearing a discount must register as a change');
  assert.equal(next![0].compare_at_price, null);
});

// ─── Infinite-list dedup ────────────────────────────────────

test('repeated ids collapse to first occurrence, order preserved', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'c' }, { id: 'b' }];
  assert.deepEqual(dedupeById(rows).map((r) => r.id), ['a', 'b', 'c']);
});

test('distinct ids pass through untouched', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(dedupeById(rows).map((r) => r.id), ['a', 'b', 'c']);
});

test('keeps the FIRST copy, not the last', () => {
  // The pages arrive in order, so the earlier copy is the one already on
  // screen. Replacing it would make a visible row jump.
  const rows = [{ id: 'a', page: 1 }, { id: 'a', page: 2 }];
  assert.equal(dedupeById(rows)[0].page, 1);
});

test('two products that merely look alike are both kept', () => {
  // This catalogue has ~949 duplicate name_es values (see the API's
  // stable-order.ts). Same name, same price, different id — genuinely two
  // rows, and dedup must not hide one of them.
  const rows = [
    { id: 'p1', name: '1/2 Pollo Tray 125Pcx 4' },
    { id: 'p2', name: '1/2 Pollo Tray 125Pcx 4' },
  ];
  assert.equal(dedupeById(rows).length, 2);
});

test('empty input is empty output', () => {
  assert.deepEqual(dedupeById([]), []);
});

test('the same product from two shops collapses to one card', () => {
  // The screenshot case: Em Partner and Shaikh Cash & Carry both list this.
  const rows = [
    { id: 'a', name_es: '1/2 POLLO BANDEJA 125PCX 4', name_en: '1/2 Chicken Tray', brand: null },
    { id: 'b', name_es: '1/2 POLLO BANDEJA 125PCX 4', name_en: '1/2 Chicken Tray', brand: null },
  ];
  assert.deepEqual(dedupeProductIdentity(rows).map((r) => r.id), ['a']);
});

test('identity ignores case, spacing and accents', () => {
  const rows = [
    { id: 'a', name_es: 'Agua de Rosas', name_en: 'Rose Water', brand: 'ALI BABA' },
    { id: 'b', name_es: '  AGUA  DE ROSÁS ', name_en: 'rose water', brand: 'ali baba' },
  ];
  assert.equal(dedupeProductIdentity(rows).length, 1);
});

test('same name, different brand stays two products', () => {
  // Arroz Basmati and Arroz Basmati Tilda are not the same thing.
  const rows = [
    { id: 'a', name_es: 'Arroz Basmati', name_en: 'Basmati Rice', brand: 'Tilda' },
    { id: 'b', name_es: 'Arroz Basmati', name_en: 'Basmati Rice', brand: 'Laila' },
  ];
  assert.equal(dedupeProductIdentity(rows).length, 2);
});

test('genuinely different products are untouched', () => {
  const rows = [
    { id: 'a', name_es: 'Arroz', name_en: 'Rice', brand: null },
    { id: 'b', name_es: 'Aceite', name_en: 'Oil', brand: null },
  ];
  assert.equal(dedupeProductIdentity(rows).length, 2);
});

// ─── Shop attribution ───────────────────────────────────────

type BlobShop = {
  id: string; name: string; logo_url: string | null; logo_bg: string;
  cover_url: string | null; rating: number; rating_count: number; product_count: number;
};
const blobShop = (over: Partial<BlobShop> = {}): BlobShop => ({
  id: 'cesto', name: 'Cesto Shop', logo_url: null, logo_bg: '#FFF',
  cover_url: null, rating: 4.8, rating_count: 12, product_count: 82,
  ...over,
});

test('the real store relation wins over the curated blob', () => {
  // The bug: two shops selling the same tray both read "Sold by Cesto Shop",
  // because resolveShop returns CESTO_SHOP for any shop_id not pinned to the
  // Top Shops home section — which is most partner stores.
  const shop = shopForProduct(
    { store: { slug: 'em-partner', name: 'Em Partner', logo_url: null, logo_bg: null }, shop_id: 'em-partner' },
    blobShop(),
  );
  assert.equal(shop.name, 'Em Partner');
  assert.equal(shop.id, 'em-partner');
});

test('two stores listing the same product resolve to different names', () => {
  const a = shopForProduct({ store: { slug: 'em-partner', name: 'Em Partner' }, shop_id: 'em-partner' }, blobShop());
  const b = shopForProduct({ store: { slug: 'shop-2', name: 'Shaikh Cash & Carry' }, shop_id: 'shop-2' }, blobShop());
  assert.notEqual(a.name, b.name);
});

test('presentation extras survive the override', () => {
  // Only identity comes from the store row; the card still needs the blob's
  // cover and counts to render.
  const shop = shopForProduct(
    { store: { slug: 'em-partner', name: 'Em Partner' }, shop_id: 'em-partner' },
    blobShop({ id: 'em-partner', name: 'stale name', product_count: 888 }),
  );
  assert.equal(shop.name, 'Em Partner');
  assert.equal(shop.product_count, 888);
});

test('no store relation falls back to the blob lookup', () => {
  // An API deploy still emitting shop_id only must keep working.
  const shop = shopForProduct({ shop_id: 'shop-9' }, blobShop({ id: 'shop-9', name: 'Blob Shop' }));
  assert.equal(shop.name, 'Blob Shop');
});

test('unknown shop with no store relation still yields Cesto', () => {
  const shop = shopForProduct({ shop_id: 'nope' }, blobShop());
  assert.ok(shop.name.length > 0);
});

// ─── Brands screen · search, A–Z, sort, recents ─────────────
// apps/mobile/app/brands.tsx used to be a plain grid; it now carries web's
// discovery controls. These lock the parts that fail silently: accent folding
// (a Spanish catalogue where "espana" finds nothing reads as broken), the '#'
// bucket, and the recents cap.

const brandList = (names: string[]) => names.map((name) => ({ name }));

test('foldText strips Spanish diacritics and case', () => {
  assert.equal(foldText('España'), 'espana');
  assert.equal(foldText('  Café  '), 'cafe');
});

test('search matches across accents in both directions', () => {
  const list = brandList(['España', 'Nestlé', 'Tilda']);
  assert.deepEqual(
    filterAndSortBrands(list, { q: 'espana' }).map((b) => b.name),
    ['España'],
  );
  assert.deepEqual(
    filterAndSortBrands(list, { q: 'nestlé' }).map((b) => b.name),
    ['Nestlé'],
  );
});

test('initialOf buckets non-alphabetic names under #', () => {
  assert.equal(initialOf('Tilda'), 'T');
  assert.equal(initialOf('Ñandú'), 'N');       // folded before bucketing
  assert.equal(initialOf('7Up'), '#');
  assert.equal(initialOf('¡Olé!'), '#');
});

test('letter filter keeps only that initial', () => {
  const list = brandList(['Tilda', 'Taj', 'MDH', '24 Mantra']);
  assert.deepEqual(filterAndSortBrands(list, { letter: 'T' }).map((b) => b.name), ['Tilda', 'Taj']);
  assert.deepEqual(filterAndSortBrands(list, { letter: '#' }).map((b) => b.name), ['24 Mantra']);
});

test('hideEmpty drops brands with no products', () => {
  const list = brandList(['Tilda', 'Ghost']);
  const countOf = (b: { name: string }) => (b.name === 'Tilda' ? 12 : 0);
  assert.deepEqual(
    filterAndSortBrands(list, { hideEmpty: true, countOf }).map((b) => b.name),
    ['Tilda'],
  );
  // Without the toggle the empty brand still shows — the count pill is what
  // communicates it, not removal.
  assert.equal(filterAndSortBrands(list, { countOf }).length, 2);
});

test('featured sort preserves the admin order, the others re-sort', () => {
  const list = brandList(['Zafarani', 'Aashirvaad', 'MDH']);
  const countOf = (b: { name: string }) =>
    ({ Zafarani: 3, Aashirvaad: 50, MDH: 20 } as Record<string, number>)[b.name] ?? 0;

  assert.deepEqual(
    filterAndSortBrands(list, { sort: 'featured' }).map((b) => b.name),
    ['Zafarani', 'Aashirvaad', 'MDH'],
  );
  assert.deepEqual(
    filterAndSortBrands(list, { sort: 'name_asc' }).map((b) => b.name),
    ['Aashirvaad', 'MDH', 'Zafarani'],
  );
  assert.deepEqual(
    filterAndSortBrands(list, { sort: 'count_desc', countOf }).map((b) => b.name),
    ['Aashirvaad', 'MDH', 'Zafarani'],
  );
});

test('sorting does not mutate the source list', () => {
  const list = brandList(['Zafarani', 'Aashirvaad']);
  filterAndSortBrands(list, { sort: 'name_asc' });
  assert.deepEqual(list.map((b) => b.name), ['Zafarani', 'Aashirvaad']);
});

test('isBrandFilterActive is false only on the default view', () => {
  assert.equal(isBrandFilterActive({ sort: 'featured' }), false);
  assert.equal(isBrandFilterActive({}), false);
  assert.equal(isBrandFilterActive({ q: 'ti' }), true);
  assert.equal(isBrandFilterActive({ letter: 'T' }), true);
  assert.equal(isBrandFilterActive({ hideEmpty: true }), true);
  assert.equal(isBrandFilterActive({ sort: 'count_desc' }), true);
});

test('groupByInitial buckets an A–Z list into ordered headings', () => {
  const sorted = filterAndSortBrands(
    brandList(['Aashirvaad', 'Amul', 'MDH', '24 Mantra']),
    { sort: 'name_asc' },
  );
  const groups = groupByInitial(sorted).map((g) => [g.letter, g.brands.map((b) => b.name)]);
  assert.deepEqual(groups, [
    ['#', ['24 Mantra']],
    ['A', ['Aashirvaad', 'Amul']],
    ['M', ['MDH']],
  ]);
});

test('monogram gives two letters for one word and for two', () => {
  assert.equal(monogram('Tilda'), 'TI');
  assert.equal(monogram('24 Mantra'), '2M');
  assert.equal(monogram(''), '?');
});

test('recents are newest-first, de-duplicated and capped', () => {
  let r: string[] = [];
  r = nextRecentBrands(r, 'Tilda');
  r = nextRecentBrands(r, 'MDH');
  r = nextRecentBrands(r, 'Tilda');            // re-open moves it to the front
  assert.deepEqual(r, ['Tilda', 'MDH']);

  let long: string[] = [];
  for (let i = 0; i < 12; i++) long = nextRecentBrands(long, `B${i}`);
  assert.equal(long.length, RECENT_BRANDS_MAX);
  assert.equal(long[0], 'B11');
});

test('parseRecentBrands survives junk in storage', () => {
  assert.deepEqual(parseRecentBrands(null), []);
  assert.deepEqual(parseRecentBrands('not json'), []);
  assert.deepEqual(parseRecentBrands('{"a":1}'), []);
  assert.deepEqual(parseRecentBrands('["Tilda", 7, null, "MDH"]'), ['Tilda', 'MDH']);
});

// ─── Origins screen · bilingual search and sort ─────────────
// The origins screen carries a smaller control set than brands — web gives
// it no A–Z rail and no recents. What it does have that brands does not is a
// search that reads both language labels, and an A–Z that follows whichever
// label is on screen.

const originList = () => [
  { key: 'espana', label_es: 'España',   label_en: 'Spain' },
  { key: 'india',  label_es: 'India',    label_en: 'India' },
  { key: 'asia',   label_es: 'Asia',     label_en: 'Asia' },
  { key: 'uk',     label_es: 'Reino Unido', label_en: 'United Kingdom' },
];

test('origin search reads both language labels', () => {
  const list = originList();
  // English query, Spanish label.
  assert.deepEqual(filterAndSortOrigins(list, { q: 'spain' }).map((o) => o.key), ['espana']);
  // Spanish query, and unaccented at that.
  assert.deepEqual(filterAndSortOrigins(list, { q: 'espana' }).map((o) => o.key), ['espana']);
  assert.deepEqual(filterAndSortOrigins(list, { q: 'España' }).map((o) => o.key), ['espana']);
  // A query that only matches the English label of a Spanish-named origin.
  assert.deepEqual(filterAndSortOrigins(list, { q: 'kingdom' }).map((o) => o.key), ['uk']);
});

test('origin A–Z follows the displayed language', () => {
  const list = originList();
  assert.deepEqual(
    filterAndSortOrigins(list, { sort: 'name_asc', lang: 'es' }).map((o) => o.label_es),
    ['Asia', 'España', 'India', 'Reino Unido'],
  );
  // In English, Spain sorts after India and United Kingdom goes last.
  assert.deepEqual(
    filterAndSortOrigins(list, { sort: 'name_asc', lang: 'en' }).map((o) => o.label_en),
    ['Asia', 'India', 'Spain', 'United Kingdom'],
  );
});

test('origin featured order is the API order, untouched', () => {
  const list = originList();
  assert.deepEqual(
    filterAndSortOrigins(list, { sort: 'featured' }).map((o) => o.key),
    ['espana', 'india', 'asia', 'uk'],
  );
  filterAndSortOrigins(list, { sort: 'name_asc' });
  assert.deepEqual(list.map((o) => o.key), ['espana', 'india', 'asia', 'uk'], 'source not mutated');
});

test('origin stock filter and count sort use the count map', () => {
  const list = originList();
  const counts: Record<string, number> = { espana: 40, india: 120, asia: 0, uk: 0 };
  const countOf = (o: { key: string }) => counts[o.key] ?? 0;
  assert.deepEqual(
    filterAndSortOrigins(list, { hideEmpty: true, countOf }).map((o) => o.key),
    ['espana', 'india'],
  );
  assert.deepEqual(
    filterAndSortOrigins(list, { sort: 'count_desc', countOf }).map((o) => o.key),
    ['india', 'espana', 'asia', 'uk'],
  );
});

test('isOriginFilterActive is false only on the default view', () => {
  assert.equal(isOriginFilterActive({ sort: 'featured' }), false);
  assert.equal(isOriginFilterActive({}), false);
  assert.equal(isOriginFilterActive({ q: 'in' }), true);
  assert.equal(isOriginFilterActive({ hideEmpty: true }), true);
  assert.equal(isOriginFilterActive({ sort: 'count_desc' }), true);
});
// ─── Runner ─────────────────────────────────────────────────

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
