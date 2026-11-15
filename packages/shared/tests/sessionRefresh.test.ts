/**
 * Renewing an expired session, as a contract.
 *
 *   npm run test:session-refresh --workspace=packages/shared
 *
 * Found on staging 2026-10-19: the admin panel renewed its session at the
 * CUSTOMER route, where admin refresh tokens do not exist, so every admin was
 * signed out an hour after signing in — losing any order they were building.
 * And any failed renewal (offline, rate limited, server restarting) signed
 * anyone out, though none of those says anything about the session.
 *
 * What has to hold:
 *   · the renewal goes to the route the app configured;
 *   · only the server REFUSING the refresh token ends the session;
 *   · anything else keeps the tokens, and the request fails the way the
 *     underlying problem would (network, 429, 5xx) — never as a sign-out;
 *   · a renewed token is stored and the request is sent again with it;
 *   · endsSession() / isNotFound() tell an answer from a failure.
 *
 * Driven through a stubbed fetch: the real client, no server.
 */
import assert from 'assert';
import { configureApi, api, ApiError, endsSession, isNotFound, isNetworkFailure } from '../src/api/client';
import { setTokenStorage } from '../src/api/storage';

const cases: Array<{ name: string; run: () => Promise<void> }> = [];
const test = (name: string, run: () => Promise<void>) => cases.push({ name, run });

type Outcome = number | 'network' | { status: number; data: unknown };
interface Call { url: string; auth: string | null }

/** Tokens in memory, plus what happened to them. */
function tokens() {
  const t = { access: 'old-access' as string | null, refresh: 'the-refresh' as string | null, cleared: false };
  setTokenStorage({
    getAccessToken: async () => t.access,
    getRefreshToken: async () => t.refresh,
    setTokens: async (a, r) => { t.access = a; t.refresh = r; },
    clear: async () => { t.access = null; t.refresh = null; t.cleared = true; },
  });
  return t;
}

/**
 * A fetch that answers the API request with `apiOutcomes` in order and the
 * renewal with `refreshOutcome`.
 */
function stub(apiOutcomes: Outcome[], refreshOutcome: Outcome, refreshPath?: string) {
  const calls: Call[] = [];
  let signedOut = 0;
  let apiI = 0;
  const reply = (o: Outcome) => {
    if (o === 'network') throw new TypeError('Failed to fetch');
    const status = typeof o === 'number' ? o : o.status;
    const data = typeof o === 'number' ? (status === 200 ? { ok: true } : null) : o.data;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => (status >= 200 && status < 300
        ? { success: true, data, error: null }
        : { success: false, data: null, error: `failed (${status})` }),
    } as unknown as Response;
  };
  configureApi({
    baseUrl: 'http://test.invalid',
    refreshPath,
    onUnauthorized: () => { signedOut++; },
    fetch: (async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
      calls.push({ url: String(url).replace('http://test.invalid', ''), auth });
      if (/refresh-token/.test(String(url))) return reply(refreshOutcome);
      return reply(apiOutcomes[Math.min(apiI++, apiOutcomes.length - 1)]);
    }) as unknown as typeof fetch,
  });
  return { calls, signedOut: () => signedOut };
}

const RENEWED = { status: 200, data: { accessToken: 'new-access', refreshToken: 'new-refresh' } };

test('the admin renews at its own route, not the customer one', async () => {
  tokens();
  const s = stub([401, 200], RENEWED, '/api/admin/auth/refresh-token');
  await api.get('/api/admin/orders');
  const renewal = s.calls.find((c) => /refresh-token/.test(c.url));
  assert.strictEqual(renewal?.url, '/api/admin/auth/refresh-token');
});

test('with no route configured, it is the customer one', async () => {
  tokens();
  const s = stub([401, 200], RENEWED);
  await api.get('/api/orders');
  assert.ok(s.calls.some((c) => c.url === '/api/auth/refresh-token'));
});

test('a renewed token is stored and the request goes again with it', async () => {
  const t = tokens();
  const s = stub([401, 200], RENEWED);
  const data = await api.get<{ ok: boolean }>('/api/orders');
  assert.deepStrictEqual(data, { ok: true });
  assert.strictEqual(t.access, 'new-access');
  assert.strictEqual(t.refresh, 'new-refresh');
  assert.strictEqual(s.calls[s.calls.length - 1].auth, 'Bearer new-access');
  assert.strictEqual(s.signedOut(), 0);
});

test('the server refusing the refresh token ends the session', async () => {
  const t = tokens();
  const s = stub([401], 401);
  await assert.rejects(() => api.get('/api/orders'), (e: unknown) => e instanceof ApiError && e.status === 401);
  assert.ok(t.cleared, 'tokens kept after a refusal');
  assert.strictEqual(s.signedOut(), 1);
});

for (const [label, outcome, check] of [
  ['a server fault (503)', 503, (e: unknown) => e instanceof ApiError && e.status === 503],
  ['a rate limit (429)', 429, (e: unknown) => e instanceof ApiError && e.status === 429],
  ['no connection', 'network', (e: unknown) => isNetworkFailure(e)],
] as Array<[string, Outcome, (e: unknown) => boolean]>) {
  test(`${label} during renewal keeps the session and fails the request as that`, async () => {
    const t = tokens();
    const s = stub([401], outcome);
    await assert.rejects(() => api.get('/api/orders'), check);
    assert.ok(!t.cleared, 'tokens were cleared');
    assert.strictEqual(t.refresh, 'the-refresh');
    assert.strictEqual(s.signedOut(), 0, 'signed out');
  });
}

test('a 401 without a token is not a session ending — no renewal is tried', async () => {
  const t = tokens();
  t.access = null;
  const s = stub([401], RENEWED);
  await assert.rejects(() => api.get('/api/users/me'));
  assert.ok(!s.calls.some((c) => /refresh-token/.test(c.url)));
  assert.strictEqual(s.signedOut(), 0);
});

test('endsSession: only an answer about the session', async () => {
  for (const status of [401, 403, 404]) assert.ok(endsSession(new ApiError(status, 'x')), `${status}`);
  for (const status of [408, 429, 500, 502, 503]) assert.ok(!endsSession(new ApiError(status, 'x')), `${status}`);
  assert.ok(!endsSession(new TypeError('Failed to fetch')));
});

test('isNotFound: only the server saying so, or nothing asked', async () => {
  assert.ok(isNotFound(null));
  assert.ok(isNotFound(undefined));
  assert.ok(isNotFound(new ApiError(404, 'x')));
  assert.ok(isNotFound(new ApiError(403, 'x')));
  for (const status of [400, 401, 408, 429, 500, 503]) assert.ok(!isNotFound(new ApiError(status, 'x')), `${status}`);
  assert.ok(!isNotFound(new TypeError('Failed to fetch')));
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
