/**
 * The basket's product cache, as a contract.
 *
 *   npm run test:product-cache --workspace=packages/shared
 *
 * Found on staging 2026-10-18: every "+" re-downloaded every product already
 * in the basket — 6–10 requests of 100 products per press at 600–1,000 lines
 * — because the query keys on the whole id list and each new list started
 * from nothing. Pressing quickly piled the requests up until other pages
 * timed out.
 *
 * What has to hold:
 *   · adding one product fetches that one product;
 *   · the answer is in the basket's order, whoever was fetched when;
 *   · a product seen more than a minute ago is fetched again;
 *   · retail and wholesale never answer for each other;
 *   · a product the server no longer returns is left out, and asked again.
 */
import assert from 'assert';
import { productsByIdsCached, clearProductCache, PRODUCT_CACHE_TTL_MS } from '../src/api/productCache';
import type { Product } from '../src/types';

const cases: Array<{ name: string; run: () => Promise<void> }> = [];
const test = (name: string, run: () => Promise<void>) => cases.push({ name, run });

const product = (id: string, price = 1) => ({ id, name_es: id, variants: [{ id: `v-${id}`, price }] }) as unknown as Product;
const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `p${i + from}`);

/** A fetcher that records what it was asked for; `gone` are never returned. */
function server(gone: string[] = [], price = 1) {
  const asked: string[][] = [];
  const fetch = async (missing: string[]) => {
    asked.push(missing);
    return missing.filter((id) => !gone.includes(id)).map((id) => product(id, price));
  };
  return { asked, fetch };
}

test('adding one product to a 600-line basket fetches that one product', async () => {
  clearProductCache();
  const s = server();
  await productsByIdsCached(ids(600), s.fetch, 'retail');
  assert.strictEqual(s.asked.length, 1);
  assert.strictEqual(s.asked[0].length, 600);
  const after = await productsByIdsCached([...ids(600), 'p600'], s.fetch, 'retail');
  assert.deepStrictEqual(s.asked[1], ['p600']);
  assert.strictEqual(after.length, 601);
});

test('changing a quantity or removing a line fetches nothing', async () => {
  clearProductCache();
  const s = server();
  await productsByIdsCached(ids(50), s.fetch, 'retail');
  const fewer = await productsByIdsCached(ids(49), s.fetch, 'retail');
  assert.strictEqual(s.asked.length, 1);
  assert.strictEqual(fewer.length, 49);
});

test('the answer is in the order asked for', async () => {
  clearProductCache();
  const s = server();
  await productsByIdsCached(['b', 'd'], s.fetch, 'retail');
  const out = await productsByIdsCached(['d', 'a', 'b', 'c'], s.fetch, 'retail');
  assert.deepStrictEqual(out.map((p) => p.id), ['d', 'a', 'b', 'c']);
  assert.deepStrictEqual(s.asked[1], ['a', 'c']);
});

test('a product seen more than a minute ago is fetched again', async () => {
  clearProductCache();
  const s = server();
  let now = 1_000_000;
  await productsByIdsCached(['a', 'b'], s.fetch, 'retail', () => now);
  now += PRODUCT_CACHE_TTL_MS - 1;
  await productsByIdsCached(['a', 'b'], s.fetch, 'retail', () => now);
  assert.strictEqual(s.asked.length, 1, 'refetched inside the minute');
  now += 2;
  await productsByIdsCached(['a', 'b'], s.fetch, 'retail', () => now);
  assert.deepStrictEqual(s.asked[1], ['a', 'b']);
});

test('wholesale prices never answer for retail', async () => {
  clearProductCache();
  const retail = server([], 2);
  const wholesale = server([], 1);
  await productsByIdsCached(['a'], retail.fetch, 'retail');
  const w = await productsByIdsCached(['a'], wholesale.fetch, 'wholesale');
  assert.strictEqual(wholesale.asked.length, 1, 'wholesale was served the retail copy');
  assert.strictEqual((w[0] as unknown as { variants: Array<{ price: number }> }).variants[0].price, 1);
});

test('a product the server no longer returns is left out — and asked for again', async () => {
  clearProductCache();
  const s = server(['gone']);
  const first = await productsByIdsCached(['a', 'gone', 'b'], s.fetch, 'retail');
  assert.deepStrictEqual(first.map((p) => p.id), ['a', 'b']);
  await productsByIdsCached(['a', 'gone', 'b'], s.fetch, 'retail');
  assert.deepStrictEqual(s.asked[1], ['gone']);
});

test('the same id twice is fetched once', async () => {
  clearProductCache();
  const s = server();
  await productsByIdsCached(['a', 'a', 'b'], s.fetch, 'retail');
  assert.deepStrictEqual(s.asked[0], ['a', 'b']);
});

(async () => {
  let failures = 0;
  for (const { name, run } of cases) {
    try {
      await run();
      console.log(`  ok  ${name}`);
    } catch (e) {
      failures++;
      const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
      console.error(`  FAIL ${name}\n      ${msg.replace(/\n/g, '\n      ')}`);
    }
  }
  console.log(`\n${cases.length - failures}/${cases.length} passed`);
  if (failures > 0) process.exit(1);
})();
