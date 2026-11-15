// ─── Integration test · issuing a customer new credentials ─────────────────
//
// Run:  cd packages/api && npm run test:client-credentials
//
// This route mints a working password for somebody else's account, and the
// admin dialog in front of it now promises three things in writing:
//
//   · the password they have stops working immediately,
//   · they are signed out everywhere, on every device,
//   · the new one is shown once and is single-use.
//
// A promise made in a dialog is only as good as the route under it, so each
// is asserted here against a real account rather than read off the code.
//
// The shape matters too. It used to answer 502 when the mail failed, which
// reads as "nothing happened" and invites a retry that rotates a SECOND time
// — leaving the customer with yet another password nobody has told them. It
// now reports the rotation as the thing that committed and says separately
// whether the mail went.
//
// Goes through the real routes over HTTP. Creates its own fixtures and
// removes them in a finally.
import http from 'http';
import bcrypt from 'bcryptjs';
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
const OLD_PASSWORD = 'OldPass123';

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];

  const call = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
    const res = await fetch(`${base}${path}`, {
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

  try {
    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    const email = `qa.creds.${stamp}@cesto.test`;
    const user = await prisma.user.create({
      data: {
        name: `QA Creds ${stamp}`,
        email,
        password_hash: await bcrypt.hash(OLD_PASSWORD, 12),
      },
      select: { id: true },
    });
    userIds.push(user.id);

    // Sign in first, so there is a real session for the rotation to end.
    const signedIn = await call('/api/auth/login-email', {
      method: 'POST', body: { email, password: OLD_PASSWORD },
    });
    check('the customer can sign in beforehand', signedIn.status === 200,
      { status: signedIn.status, error: signedIn.body.error });
    const oldRefresh: string = signedIn.body.data?.refreshToken ?? '';
    check('...and holds a refresh token', oldRefresh.length > 0);

    // ─── 1. Issue WITHOUT sending an email ───────────────────
    //
    // The case the dialog's second button exists for: an admin reading the
    // password out, or pasting it into a message.
    const issued = await call(`/api/admin/users/${user.id}/resend-credentials`, {
      method: 'POST', token: adminToken, body: { send_email: false },
    });
    check('issuing without an email answers 200', issued.status === 200,
      { status: issued.status, error: issued.body.error });
    const tempPassword: string = issued.body.data?.temp_password ?? '';
    check('...and HANDS BACK the password', tempPassword.length >= 8,
      { got: issued.body.data?.temp_password });
    check('...saying plainly that nothing was mailed',
      issued.body.data?.email_sent === false && !!issued.body.data?.reason,
      { email_sent: issued.body.data?.email_sent, reason: issued.body.data?.reason });
    check('...and that the rotation itself committed',
      issued.body.data?.rotated === true, { rotated: issued.body.data?.rotated });
    check('...naming the login, which is their email',
      issued.body.data?.login_email === email, { got: issued.body.data?.login_email });

    // ─── 2. The three promises the dialog makes ──────────────
    const withOld = await call('/api/auth/login-email', {
      method: 'POST', body: { email, password: OLD_PASSWORD },
    });
    check('PROMISE 1: their old password no longer works', withOld.status === 401,
      { status: withOld.status });

    const withNew = await call('/api/auth/login-email', {
      method: 'POST', body: { email, password: tempPassword },
    });
    check('...while the issued one does', withNew.status === 200,
      { status: withNew.status, error: withNew.body.error });
    check('PROMISE 3: and lands them on the change-password screen',
      withNew.body.data?.must_change_password === true,
      { must_change_password: withNew.body.data?.must_change_password });

    const refreshed = await call('/api/auth/refresh-token', {
      method: 'POST', body: { refreshToken: oldRefresh },
    });
    check('PROMISE 2: the session they were in is dead', refreshed.status >= 400,
      { status: refreshed.status });

    const live = await prisma.userRefreshToken.count({ where: { user_id: user.id } });
    check('...and only the new sign-in holds a token', live === 1, { tokens: live });

    // ─── 3. The refusals ─────────────────────────────────────
    const blocked = await prisma.user.create({
      data: {
        name: `QA Creds Blocked ${stamp}`,
        email: `qa.creds.blocked.${stamp}@cesto.test`,
        status: 'blocked',
      },
      select: { id: true },
    });
    userIds.push(blocked.id);
    const onBlocked = await call(`/api/admin/users/${blocked.id}/resend-credentials`, {
      method: 'POST', token: adminToken, body: { send_email: false },
    });
    check('a blocked account is refused', onBlocked.status === 422,
      { status: onBlocked.status, error: onBlocked.body.error });

    const noEmail = await prisma.user.create({
      data: { name: `QA Creds NoEmail ${stamp}`, phone: `+34699${stamp}` },
      select: { id: true },
    });
    userIds.push(noEmail.id);
    const onNoEmail = await call(`/api/admin/users/${noEmail.id}/resend-credentials`, {
      method: 'POST', token: adminToken, body: { send_email: false },
    });
    check('an account with no email is refused — the email IS the username',
      onNoEmail.status === 422, { status: onNoEmail.status, error: onNoEmail.body.error });

    const missing = await call('/api/admin/users/00000000-0000-4000-8000-000000000000/resend-credentials', {
      method: 'POST', token: adminToken, body: { send_email: false },
    });
    check('an account that does not exist is a 404', missing.status === 404,
      { status: missing.status });

  } finally {
    if (userIds.length) {
      await prisma.userRefreshToken.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
