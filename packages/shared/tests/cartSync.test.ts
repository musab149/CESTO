/**
 * The pre-checkout cart sync, as a contract.
 *
 *   npm run test:cart-sync --workspace=packages/shared
 *
 * This one call decides whether a checkout can work at all. The order is
 * placed from the SERVER cart, so if the sync does not land, checkout asks
 * for an order against whatever was there before — usually nothing. The
 * customer is then told "Your cart is empty" while looking at a full basket,
 * which is exactly what happened with a 74-line basket on 2026-10-10.
 *
 * Three things have to hold, and none of them is visible at the call site:
 *
 *   · it waits as long as the checkout that depends on it (it used to give up
 *     at the 10s default while checkout asked for 30s — the step that must
 *     succeed FIRST gave up soonest);
 *   · a transient failure is tried again, because the first request to a
 *     sleeping API is the one that dies and the second is fast — a sleeping
 *     Render service took 92 seconds to answer its first request that day;
 *   · a 4xx is NOT tried again. It is the server's considered answer, and a
 *     basket over the line limit does not get better by being resent.
 *
 * Driven through a stubbed fetch, so it exercises the real client and the
 * real service without a server.
 */
import assert from 'assert';
import { configureApi, ApiError } from '../src/api/client';
import { setTokenStorage } from '../src/api/storage';
import { cartService } from '../src/api/services/cart';

// The client reads a token before every request and throws without one. A
// signed-out shopper never reaches the pre-checkout sync, so "signed in" is
// the only state worth exercising here.
setTokenStorage({
  getAccessToken: async () => 'test-access-token',
  getRefreshToken: async () => null,
  setTokens: async () => {},
  clear: async () => {},
});

const cases: Array<{ name: string; run: () => Promise<void> }> = [];
const test = (name: string, run: () => Promise<void>) => cases.push({ name, run });

const ITEMS = [{ productId: 'p1', variantId: 'v1', quantity: 2 }];

interface Attempt { timeoutSignalled: boolean }

/**
 * Install a fetch that plays the given outcomes in order, one per attempt.
 * 'ok' resolves with an empty cart; a number is an HTTP status; 'network'
 * throws the way a dropped connection does; 'timeout' aborts like the
 * client's own AbortController would.
 */
function stubFetch(outcomes: Array<'ok' | 'network' | 'timeout' | number>) {
  const attempts: Attempt[] = [];
  configureApi({
    baseUrl: 'http://test.invalid',
    fetch: (async () => {
      const i = attempts.length;
      attempts.push({ timeoutSignalled: false });
      const outcome = outcomes[Math.min(i, outcomes.length - 1)];
      if (outcome === 'network') throw new TypeError('Failed to fetch');
      if (outcome === 'timeout') {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        throw e;
      }
      const status = outcome === 'ok' ? 200 : outcome;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => (status >= 200 && status < 300
          ? { success: true, data: { items: [] }, error: null }
          : { success: false, data: null, error: `failed (${status})` }),
      } as unknown as Response;
    }) as unknown as ApiClientFetch,
  });
  return attempts;
}

// The client types `fetch` loosely; this keeps the cast above honest.
type ApiClientFetch = typeof globalThis.fetch;

test('a sync that works is sent once', async () => {
  const attempts = stubFetch(['ok']);
  await cartService.replace(ITEMS);
  assert.equal(attempts.length, 1);
});

test('a TIMEOUT is tried again, and the second attempt stands', async () => {
  // The shape of a cold API: the first request dies, the next is fast.
  const attempts = stubFetch(['timeout', 'ok']);
  await cartService.replace(ITEMS);
  assert.equal(attempts.length, 2, 'should have tried a second time');
});

test('a NETWORK failure is tried again too', async () => {
  const attempts = stubFetch(['network', 'ok']);
  await cartService.replace(ITEMS);
  assert.equal(attempts.length, 2);
});

test('a 5xx is tried again', async () => {
  const attempts = stubFetch([503, 'ok']);
  await cartService.replace(ITEMS);
  assert.equal(attempts.length, 2);
});

test('but it gives up after the second, rather than hanging on', async () => {
  // Two failures mean the API is down, not slow. The customer is better told
  // than kept waiting — and placeOrder turns this into a visible message.
  const attempts = stubFetch(['timeout', 'timeout']);
  await assert.rejects(() => cartService.replace(ITEMS));
  assert.equal(attempts.length, 2, 'one retry, not a loop');
});

test('A 4xx IS NOT RETRIED — the rule that keeps this honest', async () => {
  // 422 is what an oversized basket gets. Sending it again just fails again,
  // and doubles the wait before the customer is told anything useful.
  const attempts = stubFetch([422, 'ok']);
  await assert.rejects(
    () => cartService.replace(ITEMS),
    (err: unknown) => err instanceof ApiError && err.status === 422,
  );
  assert.equal(attempts.length, 1, 'a considered refusal must not be resent');
});

test('nor a 401 — that is a session to refresh, not a fetch to repeat', async () => {
  const attempts = stubFetch([401]);
  await assert.rejects(() => cartService.replace(ITEMS));
  // The client's own one-shot refresh may add an attempt; what matters is
  // that replace() does not add its own retry on top.
  assert.ok(attempts.length <= 2, `${attempts.length} attempts for a 401`);
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
