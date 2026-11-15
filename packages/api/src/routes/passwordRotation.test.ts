// ─── Integration test · replacing a temporary password ─────────────────────
//
// Run:  cd packages/api && npm run test:password-rotation
//
// Partners, reps and approved B2B clients are emailed a temporary password and
// held on a "set a new password" screen until they replace it. Two ways out of
// that screen were broken, and a partner who signed in with Google met both:
//
//   · A wrong current password answered 401. The web client reads any 401 as
//     an expired session — it refreshes, retries, and on a second 401 signs
//     the person out. So instead of "that's not your current password" they
//     were sent to the login page, signed in again, and landed back on the
//     same screen. A loop with no message.
//
//   · Signing in with Google never touched the temporary password, so the
//     screen still demanded it — from someone who had just proved who they
//     were and may never have opened the email it came in.
//
// Goes through the real routes over HTTP. Google's userinfo endpoint is the
// one thing stubbed. Creates its own accounts and removes them in a finally.
import http from 'http';
import bcrypt from 'bcryptjs';
import app from '../server';
import prisma from '../lib/prisma';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++; console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

const stamp = String(Date.now()).slice(-6);
const TEMP = 'TempPass123';
const OWN = 'OwnPass456';

// Google answers for whichever account the test is currently signing in as.
let googleProfile: { sub: string; email: string } | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
    return new Response(JSON.stringify({ ...googleProfile, email_verified: true, name: 'QA Google' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  return realFetch(input, init);
}) as typeof fetch;

async function main() {
  process.env.GOOGLE_CLIENT_ID ||= 'test-client-id';

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];

  const call = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
    const res = await realFetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: await res.json() as { success: boolean; error?: string; data?: any } };
  };

  const makeUser = async (tag: string, data: { password?: string; temp?: boolean; googleId?: string }) => {
    const email = `qa.rotate.${tag}.${stamp}@cesto.test`;
    const user = await prisma.user.create({
      data: {
        name: `QA Rotate ${tag} ${stamp}`,
        email,
        password_hash: data.password ? await bcrypt.hash(data.password, 12) : null,
        password_is_temp: data.temp ?? false,
        google_id: data.googleId ?? null,
      },
      select: { id: true },
    });
    userIds.push(user.id);
    return { id: user.id, email };
  };
  const flags = (id: string) => prisma.user.findUniqueOrThrow({
    where: { id }, select: { password_hash: true, password_is_temp: true, google_id: true },
  });

  try {
    // ── 1. A wrong current password is a wrong password, not a lost session.
    console.log('\nWrong current password on the rotation screen');
    const a = await makeUser('wrong', { password: TEMP, temp: true });
    const signedIn = await call('/api/auth/login-email', { method: 'POST', body: { email: a.email, password: TEMP } });
    const token = signedIn.body.data?.accessToken as string;
    check('signs in with the temporary password and is told to change it',
      signedIn.status === 200 && signedIn.body.data?.must_change_password === true, signedIn);

    const wrong = await call('/api/auth/change-password', {
      method: 'POST', token, body: { currentPassword: 'NotIt999', newPassword: 'BrandNew789' },
    });
    check('a wrong current password answers 400, not 401', wrong.status === 400, wrong);
    check('and says which mistake it was', wrong.body.data?.code === 'wrong_current_password'
      && wrong.body.error === 'Current password is incorrect.', wrong.body);
    const me = await call('/api/users/me', { token });
    check('the session survives it', me.status === 200, me.status);
    check('and the temporary password is still to be replaced', (await flags(a.id)).password_is_temp === true);

    const right = await call('/api/auth/change-password', {
      method: 'POST', token, body: { currentPassword: TEMP, newPassword: 'BrandNew789' },
    });
    check('the right current password still changes it', right.status === 200, right);
    check('and clears the flag', (await flags(a.id)).password_is_temp === false);

    // ── 2. Google sign-in retires a temporary password.
    console.log('\nGoogle sign-in on an account still holding a temporary password');
    const gid = `qa-google-${stamp}`;
    const b = await makeUser('google', { password: TEMP, temp: true, googleId: gid });
    googleProfile = { sub: gid, email: b.email };
    const g = await call('/api/auth/google', { method: 'POST', body: { accessToken: 'x'.repeat(40) } });
    check('signs in', g.status === 200 && !!g.body.data?.accessToken, g);
    const bAfter = await flags(b.id);
    check('the flag is cleared, so no rotation screen', bAfter.password_is_temp === false, bAfter);
    check('and the emailed password no longer works', bAfter.password_hash === null);
    const oldTemp = await call('/api/auth/login-email', { method: 'POST', body: { email: b.email, password: TEMP } });
    check('signing in with it is refused', oldTemp.status === 401, oldTemp.status);
    const bMe = await call('/api/users/me', { token: g.body.data.accessToken });
    check('/users/me reports no temporary password', bMe.body.data?.password_is_temp === false, bMe.body.data?.password_is_temp);

    // Linked by email on this very sign-in — the case of an admin-made
    // account whose owner reaches for the Google button first.
    console.log('\nGoogle sign-in that links an admin-made account by email');
    const c = await makeUser('link', { password: TEMP, temp: true });
    googleProfile = { sub: `qa-google-link-${stamp}`, email: c.email.toUpperCase() };
    const gl = await call('/api/auth/google', { method: 'POST', body: { accessToken: 'y'.repeat(40) } });
    const cAfter = await flags(c.id);
    check('links Google to the same account', gl.status === 200 && cAfter.google_id === googleProfile.sub, { status: gl.status, cAfter });
    check('and retires the temporary password the same way',
      cAfter.password_is_temp === false && cAfter.password_hash === null, cAfter);

    // ── 3. A password the person chose is theirs — Google leaves it alone.
    console.log('\nGoogle sign-in on an account with a password of its own');
    const d = await makeUser('own', { password: OWN, temp: false, googleId: `qa-google-own-${stamp}` });
    googleProfile = { sub: `qa-google-own-${stamp}`, email: d.email };
    const go = await call('/api/auth/google', { method: 'POST', body: { accessToken: 'z'.repeat(40) } });
    check('signs in', go.status === 200, go.status);
    const own = await call('/api/auth/login-email', { method: 'POST', body: { email: d.email, password: OWN } });
    check('their own password still works afterwards', own.status === 200, own.status);
  } finally {
    await prisma.userRefreshToken.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    server.close();
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
