// ─── Contract test · which Sign in with Apple tokens are accepted ───────────
//
// Run:  cd packages/api && npm run test:apple-auth
//
// /api/auth/apple trusts verifyAppleIdentityToken completely: whatever `sub`
// it returns is the account that gets logged in. A check that is too lenient
// here is an account takeover, so every way a token can be wrong gets a case.
// Tokens are signed with a locally generated key served through an injected
// key fetcher — the test never talks to Apple.
import assert from 'assert';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { hashNonce, verifyAppleIdentityToken, type AppleKeyFetcher } from './appleAuth';

const AUD = 'com.cestoshop.app';
const ISS = 'https://appleid.apple.com';
const KID = 'test-key-1';
const NONCE = 'raw-nonce-0123456789';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

let fetches = 0;
const fetchKeys: AppleKeyFetcher = async () => { fetches++; return [jwk]; };

function token(
  claims: Record<string, unknown> = {},
  { key = privateKey, kid = KID, iss = ISS, aud = AUD, expiresIn = 600 as number | string } = {},
) {
  return jwt.sign(
    { sub: '001234.abcdef.1234', nonce: hashNonce(NONCE), email: 'x8k2@privaterelay.appleid.com', email_verified: 'true', is_private_email: 'true', ...claims },
    key,
    { algorithm: 'RS256', keyid: kid, issuer: iss, audience: aud, expiresIn: expiresIn as jwt.SignOptions['expiresIn'] },
  );
}

const verify = (t: string, nonce = NONCE, audiences = [AUD]) => verifyAppleIdentityToken(t, nonce, { fetchKeys, audiences });

async function rejects(p: Promise<unknown>, status: number) {
  await assert.rejects(p, (err: unknown) => (err as { status?: number }).status === status);
}

const cases: Array<{ name: string; run: () => Promise<void> }> = [];
const test = (name: string, fn: () => Promise<void>) => cases.push({ name, run: fn });

test('a valid token yields the Apple account', async () => {
  const profile = await verify(token());
  assert.deepEqual(profile, {
    appleId: '001234.abcdef.1234',
    email: 'x8k2@privaterelay.appleid.com',
    emailVerified: true,
    isPrivateEmail: true,
    clientId: AUD,
  });
});

test('boolean claims are read the same as Apple\'s string claims', async () => {
  const profile = await verify(token({ email_verified: true, is_private_email: false }));
  assert.equal(profile.emailVerified, true);
  assert.equal(profile.isPrivateEmail, false);
});

test('a token for another app (audience) is refused', async () => {
  await rejects(verify(token({}, { aud: 'com.someone.else' })), 401);
});

test('a token not issued by Apple is refused', async () => {
  await rejects(verify(token({}, { iss: 'https://evil.example' })), 401);
});

test('an expired token is refused', async () => {
  await rejects(verify(token({}, { expiresIn: -10 })), 401);
});

test('a token minted for a different nonce is refused (replay)', async () => {
  await rejects(verify(token(), 'some-other-raw-nonce'), 401);
});

test('a token without a nonce is refused', async () => {
  await rejects(verify(token({ nonce: undefined })), 401);
});

test('a token signed by another key under Apple\'s kid is refused', async () => {
  await rejects(verify(token({}, { key: other.privateKey })), 401);
});

test('a token whose kid Apple never published is refused', async () => {
  await rejects(verify(token({}, { kid: 'not-a-real-kid' })), 401);
});

test('HS256 signed with the public key (algorithm confusion) is refused', async () => {
  const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const forged = jwt.sign({ sub: 'attacker', nonce: hashNonce(NONCE) }, pem, {
    algorithm: 'HS256', keyid: KID, issuer: ISS, audience: AUD,
  });
  await rejects(verify(forged), 401);
});

test('garbage is refused, not thrown as a 500', async () => {
  await rejects(verify('not.a.jwt'), 401);
});

test('no configured bundle id answers 503, not a silent pass', async () => {
  await rejects(verify(token(), NONCE, []), 503);
});

test('Apple\'s keys are cached between sign-ins', async () => {
  const before = fetches;
  await verify(token());
  await verify(token());
  assert.equal(fetches, before, 'keys were refetched although cached');
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
