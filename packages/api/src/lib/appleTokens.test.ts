// ─── Contract test · Sign in with Apple token exchange and revocation ───────
//
// Run:  cd packages/api && npm run test:apple-tokens
//
// The revocation App Review requires (guideline 5.1.1(v)) depends on three
// things nothing else exercises until a real customer deletes a real account:
// the client secret Apple will accept, the refresh token kept at sign-in, and
// the revoke call itself. Signed with a locally generated P-256 key, against a
// stubbed fetch — the test never talks to Apple.
import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import jwt from 'jsonwebtoken';
import {
  appleClientSecret, appleSigningConfig, exchangeAppleAuthorizationCode, revokeAppleToken,
  type AppleSigningConfig,
} from './appleTokens';

const CLIENT_ID = 'com.cestoshop.app';
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const CFG: AppleSigningConfig = { teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: PEM };

interface Call { url: string; form: URLSearchParams }

function stubFetch(status: number, body: unknown): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, form: new URLSearchParams(String(init.body)) });
    return {
      status,
      json: async () => {
        if (body === undefined) throw new SyntaxError('Unexpected end of JSON input');
        return body;
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

const cases: Array<{ name: string; run: () => Promise<void> | void }> = [];
const test = (name: string, fn: () => Promise<void> | void) => cases.push({ name, run: fn });

// ─── Configuration ───────────────────────────────────────

test('unconfigured without all three of team, key id and key', () => {
  assert.equal(appleSigningConfig({}), null);
  assert.equal(appleSigningConfig({ APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K' }), null);
  assert.equal(appleSigningConfig({ APPLE_TEAM_ID: 'T', APPLE_PRIVATE_KEY: PEM }), null);
});

test('the key can come inline with \\n escapes, as a dashboard stores it', () => {
  const cfg = appleSigningConfig({ APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY: PEM.replace(/\n/g, '\\n') });
  assert.ok(cfg);
  assert.equal(cfg.privateKey, PEM.trim());
});

test('the key can come from a file path, as in local development', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apple-')), 'AuthKey_TEST.p8');
  fs.writeFileSync(file, PEM);
  const cfg = appleSigningConfig({ APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY_PATH: file });
  assert.equal(cfg?.privateKey, PEM.trim());
});

test('an unreadable key path is unconfigured, not a crash', () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(appleSigningConfig({ APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY_PATH: '/nonexistent/AuthKey.p8' }), null);
  } finally {
    console.error = quiet;
  }
});

// ─── Client secret ───────────────────────────────────────

test('the client secret is what Apple checks: ES256, our key id, team, bundle id, 5 minutes', () => {
  const now = Date.UTC(2026, 9, 15, 12, 0, 0);
  const secret = appleClientSecret(CLIENT_ID, CFG, now);
  const decoded = jwt.decode(secret, { complete: true });
  assert.ok(decoded && typeof decoded === 'object');
  assert.equal(decoded.header.alg, 'ES256');
  assert.equal(decoded.header.kid, CFG.keyId);
  const claims = jwt.verify(secret, publicKey, { algorithms: ['ES256'], clockTimestamp: now / 1000 }) as jwt.JwtPayload;
  assert.equal(claims.iss, CFG.teamId);
  assert.equal(claims.sub, CLIENT_ID);
  assert.equal(claims.aud, 'https://appleid.apple.com');
  assert.equal(claims.exp! - claims.iat!, 300);
});

// ─── Exchange at sign-in ─────────────────────────────────

test('a code is traded for the refresh token', async () => {
  const { fetch, calls } = stubFetch(200, { access_token: 'a', refresh_token: 'r-123', id_token: 'i' });
  assert.equal(await exchangeAppleAuthorizationCode('code-abcdef', CLIENT_ID, { config: CFG, fetch }), 'r-123');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://appleid.apple.com/auth/token');
  assert.equal(calls[0].form.get('grant_type'), 'authorization_code');
  assert.equal(calls[0].form.get('code'), 'code-abcdef');
  assert.equal(calls[0].form.get('client_id'), CLIENT_ID);
  assert.ok(jwt.verify(calls[0].form.get('client_secret')!, publicKey, { algorithms: ['ES256'] }));
});

test('a refused code throws with Apple\'s reason', async () => {
  const { fetch } = stubFetch(400, { error: 'invalid_grant' });
  await assert.rejects(
    exchangeAppleAuthorizationCode('expired-code', CLIENT_ID, { config: CFG, fetch }),
    /invalid_grant/,
  );
});

test('unconfigured: no exchange, no request', async () => {
  const { fetch, calls } = stubFetch(200, {});
  assert.equal(await exchangeAppleAuthorizationCode('code-abcdef', CLIENT_ID, { config: null, fetch }), null);
  assert.equal(calls.length, 0);
});

// ─── Revocation at account deletion ──────────────────────

test('revoking sends the refresh token and succeeds on Apple\'s empty 200', async () => {
  const { fetch, calls } = stubFetch(200, undefined);
  assert.equal(await revokeAppleToken('r-123', CLIENT_ID, { config: CFG, fetch }), true);
  assert.equal(calls[0].url, 'https://appleid.apple.com/auth/revoke');
  assert.equal(calls[0].form.get('token'), 'r-123');
  assert.equal(calls[0].form.get('token_type_hint'), 'refresh_token');
  assert.equal(calls[0].form.get('client_id'), CLIENT_ID);
});

test('a refused revocation throws, so erasure can log it', async () => {
  const { fetch } = stubFetch(400, { error: 'invalid_client' });
  await assert.rejects(revokeAppleToken('r-123', CLIENT_ID, { config: CFG, fetch }), /invalid_client/);
});

test('unconfigured: nothing revoked, and it says so', async () => {
  const { fetch, calls } = stubFetch(200, undefined);
  assert.equal(await revokeAppleToken('r-123', CLIENT_ID, { config: null, fetch }), false);
  assert.equal(calls.length, 0);
});

(async () => {
  let failures = 0;
  for (const { name, run: fn } of cases) {
    try {
      await fn();
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
