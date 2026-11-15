// ─── Session renewal is not rate-limited like a password guess ───────────
//
// Run:  cd packages/api && npm run test:refresh-limiter
//
// Renewal used to share the login limiter: twenty sign-ins OR renewals per
// address per fifteen minutes, counted together. An office on one wifi, or a
// mobile network putting many phones behind one address, ran it out — and a
// refused renewal signs the person out. Found while testing 1,000-line
// orders on staging (2026-10-19).
//
// Holds now:
//   · renewals (customer and admin) have their own, roomy counter;
//   · password sign-in still stops at twenty;
//   · running the sign-in counter out does not touch renewal.
//
// Uses nonsense tokens and an unknown email, so it changes nothing in the
// database; it does need one to answer.

import http from 'http';
import assert from 'assert';
import app from '../server';
import prisma from '../lib/prisma';

let base = '';
let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e instanceof Error ? e.message : String(e)}`); }
}

async function post(path: string, body: unknown): Promise<number> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await res.text();
  return res.status;
}

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  await check('25 customer renewals from one address are answered, not rate-limited', async () => {
    for (let i = 0; i < 25; i++) {
      const status = await post('/api/auth/refresh-token', { refreshToken: `not-a-token-${i}` });
      assert.notStrictEqual(status, 429, `renewal ${i + 1} was rate-limited`);
    }
  });

  await check('25 admin renewals from the same address are answered too', async () => {
    for (let i = 0; i < 25; i++) {
      const status = await post('/api/admin/auth/refresh-token', { refreshToken: `not-a-token-${i}` });
      assert.notStrictEqual(status, 429, `admin renewal ${i + 1} was rate-limited`);
    }
  });

  await check('password sign-in still stops at twenty', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push(await post('/api/admin/auth/login', { email: 'nobody.refresh-limiter@cesto.test', password: 'wrong' }));
    }
    assert.ok(statuses.slice(0, 20).every((s) => s !== 429), `limited early: ${statuses.join(',')}`);
    assert.strictEqual(statuses[20], 429, `21st sign-in was ${statuses[20]}`);
  });

  await check('with sign-in run out, renewal still answers', async () => {
    assert.notStrictEqual(await post('/api/auth/refresh-token', { refreshToken: 'still-not-a-token' }), 429);
    assert.notStrictEqual(await post('/api/admin/auth/refresh-token', { refreshToken: 'still-not-a-token' }), 429);
  });

  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
