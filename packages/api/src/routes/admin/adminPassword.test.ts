// ─── Integration test · staff change their own password ────────────────────
//
// Run:  cd packages/api && npm run test:admin-password
//
// A password somebody else chose (a new account, a reset under Staff, a seeded
// row) is changed before anything else, and the API is what holds that, not the
// screen. Changing it ends every other session, including the one the person who
// handed it out could have opened. Any staff member can change theirs at any time.
//
// Goes through the real routes over HTTP. Makes its own accounts, removes them.

import http from 'http';
import app from '../../server';
import prisma from '../../lib/prisma';
import { generateAdminAccessToken } from '../../lib/jwt';

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

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const emails: string[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return { status: res.status, body: await res.json() };
  };
  const login = (email: string, password: string | undefined) => call('/api/admin/auth/login', { method: 'POST', body: { email, password } });

  try {
    const owner = await prisma.admin.findFirst({ where: { role: 'super_admin', is_active: true }, select: { id: true, email: true } });
    if (!owner) { console.log('  SKIP  no super admin to create staff with'); return; }
    const superToken = generateAdminAccessToken({ adminId: owner.id, email: owner.email, role: 'super_admin' });

    // ─── 1. A new account must choose its own ────────────────
    const email = `qa.pw.${stamp}@cesto.test`;
    emails.push(email);
    const made = await call('/api/admin/staff', { method: 'POST', token: superToken, body: { name: `QA Password ${stamp}`, email, role: 'ops' } });
    const temp: string | undefined = made.body.data?.temp_password;
    check('Staff makes an account with a temporary password', made.status === 201 && !!temp, made.status);

    const first = await login(email, temp!);
    check('it signs in', first.status === 200, first.status);
    check('...and is told to choose its own', first.body.data?.admin?.must_change_password === true, first.body.data?.admin);
    const tempToken: string = first.body.data.accessToken;
    const tempRefresh: string = first.body.data.refreshToken;
    const me = await call('/api/admin/auth/me', { token: tempToken });
    check('/me says so too', me.status === 200 && me.body.data.must_change_password === true, me.body.data);
    check('...without the date behind it', me.body.data.password_changed_at === undefined);
    for (const path of ['/api/admin/orders', '/api/admin/documents?kind=invoice', '/api/admin/users', '/api/admin/staff']) {
      const r = await call(path, { token: tempToken });
      check(`until then ${path.split('?')[0]} is refused`, r.status === 403 && r.body.data?.code === 'password_change_required', r.status);
    }
    const renewed = await call('/api/admin/auth/refresh-token', { method: 'POST', body: { refreshToken: tempRefresh } });
    const renewedToken: string = renewed.body.data?.accessToken;
    check('renewing the session does not get round it', renewed.status === 200
      && (await call('/api/admin/orders', { token: renewedToken })).status === 403, renewed.status);

    // ─── 2. Changing it ──────────────────────────────────────
    const wrong = await call('/api/admin/auth/change-password', { method: 'POST', token: renewedToken, body: { currentPassword: 'not-it', newPassword: 'Nueva2026Clave' } });
    check('a wrong current password is a 400, not a sign-out', wrong.status === 400 && wrong.body.data?.code === 'wrong_current_password', wrong.status);
    const weak = await call('/api/admin/auth/change-password', { method: 'POST', token: renewedToken, body: { currentPassword: temp, newPassword: 'short' } });
    check('a weak new password is refused', weak.status === 422, weak.status);
    const noUpper = await call('/api/admin/auth/change-password', { method: 'POST', token: renewedToken, body: { currentPassword: temp, newPassword: 'alllowercase1' } });
    check('...so is one without an uppercase letter', noUpper.status === 422, noUpper.status);
    const same = await call('/api/admin/auth/change-password', { method: 'POST', token: renewedToken, body: { currentPassword: temp, newPassword: temp } });
    check('...and the same one again', same.status === 400, same.status);

    // A second session, the kind whoever handed the password out could have opened.
    const other = await login(email, temp!);
    const otherRefresh: string = other.body.data.refreshToken;

    const NEW = `Propia${stamp}Ok`;
    const changed = await call('/api/admin/auth/change-password', { method: 'POST', token: renewedToken, body: { currentPassword: temp, newPassword: NEW } });
    check('the right one changes it', changed.status === 200, changed.body);
    check('...and hands this session fresh tokens', !!changed.body.data?.accessToken && !!changed.body.data?.refreshToken
      && changed.body.data?.admin?.must_change_password === false, changed.body.data?.admin);
    const freshToken: string = changed.body.data.accessToken;
    check('everything opens with them', (await call('/api/admin/orders', { token: freshToken })).status === 200);
    const otherRenew = await call('/api/admin/auth/refresh-token', { method: 'POST', body: { refreshToken: otherRefresh } });
    check('every other session has ended', otherRenew.status === 401 || otherRenew.status === 403, otherRenew.status);
    check('the temporary password is dead', (await login(email, temp!)).status === 401);
    const own = await login(email, NEW);
    check('their own works, and asks for nothing more', own.status === 200 && own.body.data.admin.must_change_password === false, own.body.data?.admin);
    const row = await prisma.admin.findUnique({ where: { email }, select: { password_changed_at: true } });
    check('...recorded as changed', !!row?.password_changed_at);

    // ─── 3. Whenever they like ───────────────────────────────
    const AGAIN = `Otra${stamp}Vez`;
    const voluntary = await call('/api/admin/auth/change-password', { method: 'POST', token: own.body.data.accessToken, body: { currentPassword: NEW, newPassword: AGAIN } });
    check('anyone can change theirs again', voluntary.status === 200, voluntary.status);
    check('...and the previous one stops working', (await login(email, NEW)).status === 401);

    // ─── 4. A reset under Staff starts it over ───────────────
    const id = (await prisma.admin.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    const reset = await call(`/api/admin/staff/${id}/reset-password`, { method: 'POST', token: superToken });
    const temp2: string | undefined = reset.body.data?.temp_password;
    check('Staff resets it', reset.status === 200 && !!temp2, reset.status);
    const afterReset = await login(email, temp2!);
    check('...and they must choose again', afterReset.body.data?.admin?.must_change_password === true, afterReset.body.data?.admin);

    // ─── 5. A lawyer is held the same way ────────────────────
    const lawyerEmail = `qa.pw.lawyer.${stamp}@cesto.test`;
    emails.push(lawyerEmail);
    const lawyer = await call('/api/admin/staff', { method: 'POST', token: superToken, body: { name: `QA Lawyer ${stamp}`, email: lawyerEmail, role: 'lawyer' } });
    const lawyerIn = await login(lawyerEmail, lawyer.body.data.temp_password);
    check('a new lawyer cannot read the archive before choosing a password',
      (await call('/api/admin/documents?kind=invoice', { token: lawyerIn.body.data.accessToken })).status === 403);
    const lawyerChanged = await call('/api/admin/auth/change-password', { method: 'POST', token: lawyerIn.body.data.accessToken, body: { currentPassword: lawyer.body.data.temp_password, newPassword: `Abogado${stamp}A` } });
    check('...and can afterwards', (await call('/api/admin/documents?kind=invoice', { token: lawyerChanged.body.data.accessToken })).status === 200);
    check('...still nothing else', (await call('/api/admin/orders', { token: lawyerChanged.body.data.accessToken })).status === 403);

    check('no token, no change', (await call('/api/admin/auth/change-password', { method: 'POST', body: { currentPassword: 'x', newPassword: 'Abcdefg1' } })).status === 401);
  } finally {
    await prisma.admin.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
