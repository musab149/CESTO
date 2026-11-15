/**
 * "Is it their internet, or us?" — and the batched product lookup a big
 * basket needs. Both came out of a 600-line order on production (2026-10-16).
 *
 *   npm run test:connection --workspace=packages/shared
 *
 * The diagnosis is only worth anything if it never blames the shopper's
 * connection for our failure, nor ours for theirs. So each verdict is driven
 * through the real API client and a stubbed network: the API fetch and the
 * CDN probe are stubbed separately, because telling those two apart is the
 * whole idea.
 */
import assert from 'assert';
import { configureApi, ApiError, api } from '../src/api/client';
import { setTokenStorage } from '../src/api/storage';
import { configureConnectionProbe, diagnoseFailure, isUncertainOutcome } from '../src/api/connection';
import { catalogService } from '../src/api/services/catalog';
import { adminOrders } from '../src/api/services/admin';
import { salesOrders } from '../src/api/services/sales';

setTokenStorage({
  getAccessToken: async () => 'test-access-token',
  getRefreshToken: async () => null,
  setTokens: async () => {},
  clear: async () => {},
});

const cases: Array<{ name: string; run: () => Promise<void> }> = [];
const test = (name: string, run: () => Promise<void>) => cases.push({ name, run });

const PROBE_URL = 'https://shop.test/favicon.svg';

/** The CDN probe goes through the global fetch, not the API client's. */
type ProbeOutcome = 'fast' | 'slow' | 'hang' | 'fail';
let probeCalls = 0;
function stubProbe(outcome: ProbeOutcome) {
  probeCalls = 0;
  globalThis.fetch = (async (_url: unknown, init?: { signal?: AbortSignal }) => {
    probeCalls++;
    if (outcome === 'fail') throw new TypeError('Failed to fetch');
    if (outcome === 'hang') {
      // Never answers; the probe's own budget has to end it.
      await new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
        });
      });
    }
    if (outcome === 'slow') await new Promise((r) => setTimeout(r, 1_700));
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(536) } as unknown as Response;
  }) as typeof fetch;
}

function setOnline(onLine: boolean | undefined) {
  Object.defineProperty(globalThis, 'navigator', {
    value: onLine === undefined ? {} : { onLine },
    configurable: true,
    writable: true,
  });
}

/** An API whose every request ends the given way, through the real client. */
function stubApi(outcome: 'timeout' | 'network' | number) {
  configureApi({
    baseUrl: 'http://api.test',
    fetch: (async () => {
      if (outcome === 'network') throw new TypeError('Failed to fetch');
      if (outcome === 'timeout') {
        const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e;
      }
      return {
        ok: false,
        status: outcome,
        json: async () => ({ success: false, data: null, error: `failed (${outcome})` }),
      } as unknown as Response;
    }) as typeof fetch,
  });
}

async function failureOf(outcome: 'timeout' | 'network' | number): Promise<unknown> {
  stubApi(outcome);
  try { await api.post('/api/orders', {}); } catch (e) { return e; }
  throw new Error('the stubbed request was supposed to fail');
}

function reset() {
  setOnline(true);
  configureConnectionProbe(PROBE_URL);
}

// ─── An answer from the server already says whose side it is ─────────────

test('a 503 ("That took too long to process") is us being busy — no probe', async () => {
  reset(); stubProbe('fast');
  assert.equal(await diagnoseFailure(await failureOf(503)), 'server_busy');
  assert.equal(probeCalls, 0, 'a server answer needs no connection check');
});

test('502 and 504 from the gateway are busy too, not broken', async () => {
  reset(); stubProbe('fast');
  assert.equal(await diagnoseFailure(await failureOf(502)), 'server_busy');
  assert.equal(await diagnoseFailure(await failureOf(504)), 'server_busy');
});

test('a 500 is a fault on our side', async () => {
  reset(); stubProbe('fast');
  assert.equal(await diagnoseFailure(await failureOf(500)), 'server_error');
});

test('a 4xx is the server saying no, and its message is the answer', async () => {
  reset(); stubProbe('fast');
  const err = await failureOf(422);
  assert.equal(await diagnoseFailure(err), 'rejected');
  assert.ok(err instanceof ApiError && err.message === 'failed (422)');
});

// ─── No answer at all: the probe decides ─────────────────────────────────

test('timed out, but the CDN answers at once → the slowness is OURS', async () => {
  reset(); stubProbe('fast');
  const err = await failureOf('timeout');
  assert.ok(err instanceof ApiError && err.status === 408, 'the client reports its own timeout as 408');
  assert.equal(await diagnoseFailure(err), 'server_busy');
  assert.equal(probeCalls, 1);
});

test('timed out, and the CDN is slow too → it is THEIR connection', async () => {
  reset(); stubProbe('slow');
  assert.equal(await diagnoseFailure(await failureOf('timeout')), 'slow_connection');
});

test('timed out, and the CDN never answers → their connection is unusable', async () => {
  reset(); stubProbe('hang');
  assert.equal(await diagnoseFailure(await failureOf('timeout')), 'slow_connection');
});

test('fetch failed outright and so does the CDN → offline', async () => {
  reset(); stubProbe('fail');
  assert.equal(await diagnoseFailure(await failureOf('network')), 'offline');
});

test('fetch failed outright but the CDN is fine → our API is unreachable, not them', async () => {
  // The shape of a gateway error page sent without CORS headers, which the
  // browser reports exactly like a dropped connection.
  reset(); stubProbe('fast');
  assert.equal(await diagnoseFailure(await failureOf('network')), 'server_busy');
});

test('a TypeError from our OWN code is not mistaken for the network', async () => {
  // What the harness hit: crypto.randomUUID missing on an insecure origin threw
  // a TypeError before any request went out, and was blamed on the connection.
  reset(); stubProbe('slow');
  assert.equal(await diagnoseFailure(new TypeError('crypto.randomUUID is not a function')), 'server_error');
  assert.equal(probeCalls, 0);
});

test('the browser says offline → offline, without spending a probe', async () => {
  reset(); stubProbe('fast'); setOnline(false);
  assert.equal(await diagnoseFailure(await failureOf('timeout')), 'offline');
  assert.equal(probeCalls, 0);
});

test('no probe and no hint → "no answer", never a guess at whose fault', async () => {
  reset(); stubProbe('fast'); setOnline(undefined);
  configureConnectionProbe(null);
  assert.equal(await diagnoseFailure(await failureOf('timeout')), 'no_answer');
  assert.equal(probeCalls, 0);
});

// ─── A basket of any size resolves in full ───────────────────────────────

test('250 ids go out as 100 + 100 + 50 and come back in the caller\'s order', async () => {
  reset();
  const seen: string[][] = [];
  configureApi({
    baseUrl: 'http://api.test',
    fetch: (async (url: string) => {
      const ids = decodeURIComponent(new URL(url).searchParams.get('ids') ?? '').split(',');
      seen.push(ids);
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: ids.map((id) => ({ id })), error: null }),
      } as unknown as Response;
    }) as unknown as typeof fetch,
  });
  const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
  const products = await catalogService.productsByIds(ids);
  assert.deepEqual(seen.map((b) => b.length), [100, 100, 50]);
  assert.deepEqual(products.map((p) => p.id), ids);
});

test('100 ids or fewer is still one request', async () => {
  reset();
  let calls = 0;
  configureApi({
    baseUrl: 'http://api.test',
    fetch: (async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({ success: true, data: [], error: null }) } as unknown as Response;
    }) as unknown as typeof fetch,
  });
  await catalogService.productsByIds(Array.from({ length: 100 }, (_, i) => `id-${i}`));
  assert.equal(calls, 1);
});

// ─── Orders built for a customer: "may have happened" and the key ────────

test('a write that got no answer, or a 5xx, MAY have happened', async () => {
  reset();
  assert.equal(isUncertainOutcome(await failureOf('timeout')), true, 'our own timeout');
  assert.equal(isUncertainOutcome(await failureOf('network')), true, 'no response at all');
  assert.equal(isUncertainOutcome(await failureOf(503)), true, 'busy');
  assert.equal(isUncertainOutcome(await failureOf(500)), true, 'a fault');
});

test('a refusal did NOT happen, and neither did a bug of ours', async () => {
  reset();
  assert.equal(isUncertainOutcome(await failureOf(400)), false, 'not enough stock');
  assert.equal(isUncertainOutcome(await failureOf(422)), false);
  assert.equal(isUncertainOutcome(new TypeError('x is not a function')), false);
});

test('admin and the rep send their attempt key, and wait 30s', async () => {
  reset();
  const sent: Array<{ key: string | null; aborted: boolean }> = [];
  configureApi({
    baseUrl: 'http://api.test',
    fetch: (async (_url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => {
      // Still waiting at 11s, past the old 10s default, means the timer is longer.
      await new Promise((r) => setTimeout(r, 11_000));
      sent.push({ key: init.headers['Idempotency-Key'] ?? null, aborted: init.signal.aborted });
      return { ok: true, status: 201, json: async () => ({ success: true, data: { order: { id: 'o1' } }, error: null }) } as unknown as Response;
    }) as unknown as typeof fetch,
  });
  await Promise.all([
    adminOrders.create({ user_id: 'u', address_id: 'a', items: [] } as never, 'key-admin'),
    salesOrders.create({ user_id: 'u', address_id: 'a', items: [] } as never, 'key-rep'),
  ]);
  assert.deepEqual(sent.map((s) => s.key).sort(), ['key-admin', 'key-rep']);
  assert.ok(sent.every((s) => !s.aborted), 'neither gave up at 10s');
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
