// ─── Integration test · sales reps ─────────────────────────────────────────
//
// Run:  cd packages/api && npm run test:sales-reps
//
// A rep is a User with a SalesRep row, authenticating with the ORDINARY
// customer JWT. That design only pays off if two things hold, and both are
// easy to get wrong:
//
//   · The role is what grants access, not the token. The same user, with the
//     same valid token, must be refused before the grant and after a revoke.
//   · Revoking never destroys history. The orders and accounts a rep created
//     still point at them, and the figures still read.
//
// Goes through the real routes over HTTP. Creates its own fixtures and
// removes them in a finally.

import http from 'http';
import app from '../../server';
import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { generateAdminAccessToken, generateAccessToken } from '../../lib/jwt';
import { generateOrderNumber } from '../../lib/pagination';
import bcrypt from 'bcryptjs';
import { mailerDelivers } from '../../lib/mailer';

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
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  let addressId: string | null = null;

  try {
    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });
    /**
     * An ops admin, for the permission checks below.
     *
     * requireRole reads the role off the JWT, so the same admin row signed as
     * `ops` is exactly what an ops admin's session looks like. No second admin
     * row to create and clean up.
     */
    const opsToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: 'ops' });

    const call = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
      const res = await fetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      return { status: res.status, body: await res.json() as { success: boolean; error?: string; data?: unknown } };
    };

    // ─── Fixtures: a person, and a client they will sell to ──
    const rep = await prisma.user.create({
      data: { name: `QA Rep ${stamp}`, email: `qa.rep.${stamp}@cesto.test` },
    });
    userIds.push(rep.id);
    const client = await prisma.user.create({
      data: {
        name: `QA Client ${stamp}`, email: `qa.repclient.${stamp}@cesto.test`,
        created_by_sales_rep_id: rep.id,
      },
    });
    userIds.push(client.id);
    const address = await prisma.address.create({
      data: {
        user_id: client.id, contact_name: 'QA', contact_phone: '600000000',
        street_line_1: 'C/ Test 1', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
    });
    addressId = address.id;

    // Their own token — the ordinary customer one, nothing rep-specific.
    const repToken = generateAccessToken({ userId: rep.id, email: rep.email ?? undefined });

    // ─── 1. The token alone is not enough ────────────────────
    const before = await call('/api/sales/me', { token: repToken });
    check('a valid user token is REFUSED before the grant', before.status === 403,
      { status: before.status, error: before.body.error });
    check('...and says why, rather than "unauthorised"',
      (before.body.error ?? '').toLowerCase().includes('sales rep'), before.body.error);

    // ─── 2. Granting the role ────────────────────────────────
    const granted = await call('/api/admin/sales-reps', {
      method: 'POST', token: adminToken,
      body: { user_id: rep.id, code: `QA-${stamp}`, notes: 'created by the test' },
    });
    check('admin can grant the role', granted.status === 201,
      { status: granted.status, error: granted.body.error });
    const row = granted.body.data as { name?: string; code?: string; is_active?: boolean; clients_opened?: number };
    check('...the row names the person, not just an id', row?.name === `QA Rep ${stamp}`, row?.name);
    check('...and counts the client they had already opened', row?.clients_opened === 1, row?.clients_opened);

    const twice = await call('/api/admin/sales-reps', {
      method: 'POST', token: adminToken, body: { user_id: rep.id },
    });
    check('granting it twice is refused', twice.status === 409, twice.status);

    // ─── 3. The same token now works ─────────────────────────
    const after = await call('/api/sales/me', { token: repToken });
    check('the SAME token now reaches /api/sales/me', after.status === 200,
      { status: after.status, error: after.body.error });
    const me = after.body.data as { user?: { id: string }; rep?: { code: string }; stats?: { clients_opened: number } };
    check('...and it is them', me?.user?.id === rep.id);
    check('...carrying their staff number', me?.rep?.code === `QA-${stamp}`, me?.rep?.code);
    check('...and their client count', me?.stats?.clients_opened === 1, me?.stats?.clients_opened);

    // ─── 4. Orders they build are counted, cancelled ones are not revenue ──
    const mk = async (status: 'pending' | 'cancelled', total: string) => {
      const o = await prisma.order.create({
        data: {
          order_number: generateOrderNumber(),
          user_id: client.id, address_id: address.id, address_snapshot: {},
          payment_method: 'cod', status,
          subtotal: new Prisma.Decimal(total),
          delivery_fee: new Prisma.Decimal(0),
          total: new Prisma.Decimal(total),
          created_by_sales_rep_id: rep.id,
        },
      });
      orderIds.push(o.id);
    };
    await mk('pending', '100.00');
    await mk('pending', '50.00');
    await mk('cancelled', '999.00');

    const profile = await call(`/api/admin/sales-reps/${rep.id}`, { token: adminToken });
    const st = (profile.body.data as { stats?: { orders: number; revenue: string; cancelled: number } })?.stats;
    check('the profile counts every order they built', st?.orders === 3, st?.orders);
    check('...revenue EXCLUDES the cancelled one', st?.revenue === '150.00', st?.revenue);
    check('...but the cancellation is still reported', st?.cancelled === 1, st?.cancelled);

    // A deleted order was taken back; crediting it would pay for undone work.
    await prisma.order.update({
      where: { id: orderIds[0] }, data: { deleted_at: new Date() },
    });
    const afterDelete = await call(`/api/admin/sales-reps/${rep.id}`, { token: adminToken });
    const st2 = (afterDelete.body.data as { stats?: { orders: number; revenue: string } })?.stats;
    check('a deleted order drops out of the figures', st2?.orders === 2, st2?.orders);
    check('...and out of revenue with it', st2?.revenue === '50.00', st2?.revenue);

    // ─── 5. Revoking ─────────────────────────────────────────
    const revoked = await call(`/api/admin/sales-reps/${rep.id}`, {
      method: 'PUT', token: adminToken, body: { is_active: false },
    });
    check('admin can revoke', revoked.status === 200, revoked.status);

    const blocked = await call('/api/sales/me', { token: repToken });
    check('the same token stops working immediately', blocked.status === 403, blocked.status);

    const stillThere = await prisma.salesRep.findUnique({ where: { user_id: rep.id } });
    check('...but the row survives, so their history still resolves',
      stillThere !== null && stillThere.is_active === false);
    const ordersStillLinked = await prisma.order.count({ where: { created_by_sales_rep_id: rep.id } });
    check('...and the orders they built still point at them', ordersStillLinked === 3, ordersStillLinked);

    const reinstated = await call(`/api/admin/sales-reps/${rep.id}`, {
      method: 'PUT', token: adminToken, body: { is_active: true },
    });
    check('reinstating works, and keeps the same row', reinstated.status === 200);
    const back = await call('/api/sales/me', { token: repToken });
    check('...and they can work again', back.status === 200, back.status);

    // ─── 6. The books count their work as OURS, not the customer's ──
    //
    // This is the whole point of the creator columns, and the easy thing to get
    // wrong: a book that asks only about `created_by_admin_id` files a rep's
    // order under "the customer placed it", which is the opposite of true.
    // `paged()` returns { items, total, ... } — not { data }.
    const listed = async (path: string) => {
      const r = await call(path, { token: adminToken });
      return ((r.body.data as { items?: { id: string; order_number?: string }[] })?.items) ?? [];
    };

    const mine = await prisma.order.findMany({
      where: { created_by_sales_rep_id: rep.id, deleted_at: null },
      select: { order_number: true },
    });

    // Both list shapes: the flat one and the grouped one the admin page calls.
    // They build their WHERE separately — one in Prisma, one in raw SQL — so a
    // fix to one proves nothing about the other.
    for (const [label, path] of [
      ['flat', '/api/admin/orders?source=rashan&limit=100'],
      ['grouped', '/api/admin/orders?grouped=true&source=rashan&limit=100'],
    ] as const) {
      const found = new Set((await listed(path)).map((o) => o.order_number));
      check(`every live rep-built order is in the rashan book (${label})`,
        mine.length > 0 && mine.every((o) => found.has(o.order_number)),
        { built: mine.map((o) => o.order_number), found: [...found].slice(0, 5) });

      const customerPath = path.replace('source=rashan', 'source=customer');
      const inCustomer = new Set((await listed(customerPath)).map((o) => o.order_number));
      check(`...and none of them is in the customer book (${label})`,
        inCustomer.size > 0 && mine.every((o) => !inCustomer.has(o.order_number)),
        { customerBookSize: inCustomer.size });
    }

    // Same question, asked of the account they opened.
    const repSide = await listed('/api/admin/users?segment=rashan&limit=200');
    check('the client a rep opened is on the rashan side',
      repSide.some((u) => u.id === client.id), repSide.length);

    const selfSide = await listed('/api/admin/users?segment=customers&limit=200');
    check('...and is NOT counted as a self-signup',
      selfSide.length > 0 && !selfSide.some((u) => u.id === client.id),
      { selfSignupCount: selfSide.length });

    // ─── 7. A blocked account cannot be made a rep ───────────
    const blockedUser = await prisma.user.create({
      data: { name: `QA Blocked ${stamp}`, email: `qa.blocked.${stamp}@cesto.test`, status: 'blocked' },
    });
    userIds.push(blockedUser.id);
    const refused = await call('/api/admin/sales-reps', {
      method: 'POST', token: adminToken, body: { user_id: blockedUser.id },
    });
    check('a blocked account cannot be granted the role', refused.status === 422,
      { status: refused.status, error: refused.body.error });

    // ─── 8. Hiring: the account does not have to exist first ──
    //
    // The reason this endpoint takes two shapes. An admin typing a name and an
    // email has no way to know whether that person is already in the database,
    // so the endpoint has to cope with either and say which happened.
    const hireEmail = `qa.hire.${stamp}@cesto.test`;
    const hired = await call('/api/admin/sales-reps', {
      method: 'POST', token: adminToken,
      body: {
        name: `QA Hire ${stamp}`,
        email: hireEmail,
        code: `QA-HIRE-${stamp}`,
        // No mail out of a test run; the flag is exercised on its own below.
        send_credentials: false,
      },
    });
    check('a rep can be hired from a name and an email alone', hired.status === 201,
      { status: hired.status, error: hired.body.error });
    const hiredRow = hired.body.data as {
      user_id?: string; account_created?: boolean; name?: string; credentials_sent?: boolean;
    };
    if (hiredRow?.user_id) userIds.push(hiredRow.user_id);
    check('...and the response says the account was made', hiredRow?.account_created === true,
      hiredRow?.account_created);

    // Nothing was asked for, so nothing was claimed. The real case — asking
    // for the mail on a box that cannot send it — is its own hire below.
    check('...and claims no email, because none was asked for',
      hiredRow?.credentials_sent === false, hiredRow?.credentials_sent);

    const hiredUser = await prisma.user.findUnique({
      where: { email: hireEmail },
      select: { id: true, name: true, password_hash: true, password_is_temp: true },
    });
    check('...the account exists, with a password they must rotate',
      !!hiredUser?.password_hash && hiredUser?.password_is_temp === true,
      { hasHash: !!hiredUser?.password_hash, temp: hiredUser?.password_is_temp });
    const hiredRep = await prisma.salesRep.findUnique({
      where: { user_id: hiredUser!.id },
      select: { is_active: true, code: true },
    });
    check('...and they are a rep in the same call',
      hiredRep?.is_active === true && hiredRep?.code === `QA-HIRE-${stamp}`, hiredRep);

    // Their own token works straight away — the point of the whole flow.
    const hiredToken = generateAccessToken({ userId: hiredUser!.id, email: hireEmail });
    const hiredMe = await call('/api/sales/me', { token: hiredToken });
    check('...and they can reach the rep surface immediately', hiredMe.status === 200,
      hiredMe.status);

    // ─── 9. An email that already has an account ─────────────
    //
    // Must NOT make a second one, and must NOT reset the password of an
    // account somebody is already using — that would lock a live customer out
    // because an admin gave them a job.
    const established = await prisma.user.create({
      data: {
        name: `QA Established ${stamp}`,
        email: `qa.established.${stamp}@cesto.test`,
        password_hash: 'not-a-real-hash-but-a-present-one',
      },
    });
    userIds.push(established.id);

    const reused = await call('/api/admin/sales-reps', {
      method: 'POST', token: adminToken,
      body: { name: 'Someone Else Entirely', email: `qa.established.${stamp}@cesto.test` },
    });
    check('an email that already has an account still succeeds', reused.status === 201,
      { status: reused.status, error: reused.body.error });
    const reusedRow = reused.body.data as { user_id?: string; account_created?: boolean };
    check('...and reports that nothing was created', reusedRow?.account_created === false,
      reusedRow?.account_created);
    check('...resolving to the account that was already there',
      reusedRow?.user_id === established.id);

    const dupes = await prisma.user.count({
      where: { email: `qa.established.${stamp}@cesto.test` },
    });
    check('...with no second account made', dupes === 1, dupes);

    const untouched = await prisma.user.findUnique({
      where: { id: established.id },
      select: { name: true, password_hash: true },
    });
    check('...and their existing password left alone',
      untouched?.password_hash === 'not-a-real-hash-but-a-present-one');
    // The name in the request was wrong; theirs is the one that counts.
    check('...and their own name not overwritten by what the admin typed',
      untouched?.name === `QA Established ${stamp}`, untouched?.name);

    // ─── 10. What the form will not let through ──────────────
    const noDetails = await call('/api/admin/sales-reps', {
      method: 'POST', token: adminToken, body: { code: 'NOBODY' },
    });
    check('neither an account nor a name and email is refused', noDetails.status === 422,
      { status: noDetails.status, error: noDetails.body.error });
    check('...naming both missing fields rather than one',
      (noDetails.body.error ?? '').includes('name') && (noDetails.body.error ?? '').includes('email'),
      noDetails.body.error);

    const badEmail = await call('/api/admin/sales-reps', {
      method: 'POST', token: adminToken,
      body: { name: 'QA Bad Email', email: 'not-an-email' },
    });
    check('a malformed email is refused', badEmail.status === 422, badEmail.status);

    /**
     * ─── Resending a login ──────────────────────────────────
     *
     * Not a re-send of the first mail: that password is a hash and gone, so
     * this issues a NEW one. Which means it is destructive — their current
     * password dies and every session with it — and the response has to say
     * so separately from whether the mail arrived, because the two fail
     * independently. A screen told only "failed" would leave an admin
     * thinking the old password still worked.
     */
    const resendOk = await call(`/api/admin/sales-reps/${rep.id}/resend-credentials`, {
      method: 'POST', token: adminToken,
    });
    const resendBody = resendOk.body.data as {
      rotated?: boolean; email_sent?: boolean; reason?: string | null;
      login_email?: string; temp_password?: string;
    } | undefined;
    check('resending a login answers 200 even when the mail cannot go',
      resendOk.status === 200, { status: resendOk.status, error: resendOk.body.error });
    check('...and says the password WAS rotated', resendBody?.rotated === true, resendBody);
    check('...and does not claim a send this environment cannot make',
      resendBody?.email_sent === false, resendBody);
    check('...giving the reason', !!resendBody?.reason, resendBody?.reason);

    // The rotation is real: it must have invalidated the password AND the
    // sessions, or "their old one no longer works" is a lie on the screen.
    const afterResend = await prisma.user.findUnique({
      where: { id: rep.id },
      select: { password_is_temp: true, refresh_tokens: { select: { id: true } } },
    });
    check('...the password is marked temporary again',
      afterResend?.password_is_temp === true, afterResend?.password_is_temp);
    check('...and every refresh token is gone',
      (afterResend?.refresh_tokens.length ?? 0) === 0, afterResend?.refresh_tokens.length);

    /**
     * THE PASSWORD COMES BACK, which is what makes the feature usable at all:
     * the rotation already happened, so an admin who cannot see the new
     * password is holding an account they have just locked. /api/admin/staff
     * has answered this way since it existed.
     */
    check('...and hands back the credentials, because the old ones are gone',
      !!resendBody?.temp_password && resendBody?.login_email === 'qa.rep.' + stamp + '@cesto.test',
      { login_email: resendBody?.login_email, password_len: resendBody?.temp_password?.length });

    // And it is a WORKING password, not a decorative string — the whole point
    // is that an admin can read it out and the rep can sign in with it.
    const rotated = await prisma.user.findUnique({
      where: { id: rep.id }, select: { password_hash: true },
    });
    check('...which actually signs them in',
      !!rotated?.password_hash
      && await bcrypt.compare(resendBody!.temp_password!, rotated!.password_hash!));

    /**
     * `send_email: false` is the hand-it-over path. It must still rotate and
     * still return the password — the only difference is that nothing is
     * mailed, and `reason` says so rather than leaving it looking like a
     * failure.
     */
    const noMail = await call(`/api/admin/sales-reps/${rep.id}/resend-credentials`, {
      method: 'POST', token: adminToken, body: { send_email: false },
    });
    const noMailBody = noMail.body.data as {
      rotated?: boolean; email_sent?: boolean; reason?: string | null; temp_password?: string;
    } | undefined;
    check('issuing WITHOUT sending still rotates and returns the password',
      noMail.status === 200 && noMailBody?.rotated === true && !!noMailBody?.temp_password,
      { status: noMail.status, rotated: noMailBody?.rotated });
    check('...reports no email, by choice rather than by failure',
      noMailBody?.email_sent === false && /handed over/i.test(noMailBody?.reason ?? ''),
      { email_sent: noMailBody?.email_sent, reason: noMailBody?.reason });
    check('...and the second rotation replaced the first password',
      noMailBody?.temp_password !== resendBody?.temp_password);

    const opsResend = await call(`/api/admin/sales-reps/${rep.id}/resend-credentials`, {
      method: 'POST', token: opsToken,
    });
    check('an ops admin cannot resend a login', opsResend.status === 403,
      { status: opsResend.status, error: opsResend.body.error });

    // ─── Hiring is super-admin only ──────────────────────────
    //
    // Granting the role mints a login, emails a password, and hands somebody
    // the client book and the ability to issue numbered albaranes — the same
    // kind of act as creating an admin account, which /api/admin/staff has
    // always gated this way. This route did not, and any admin could do it.
    const opsHire = await call('/api/admin/sales-reps', {
      method: 'POST', token: opsToken,
      body: { name: 'QA Ops Hire', email: `qa.opshire.${stamp}@cesto.test` },
    });
    check('an ops admin cannot hire a rep', opsHire.status === 403,
      { status: opsHire.status, error: opsHire.body.error });

    // Revoking is the other half of the same power: it cuts a working rep off
    // mid-round.
    const opsRevoke = await call(`/api/admin/sales-reps/${rep.id}`, {
      method: 'PUT', token: opsToken, body: { is_active: false },
    });
    check('...nor revoke one', opsRevoke.status === 403,
      { status: opsRevoke.status, error: opsRevoke.body.error });

    // Reading is deliberately NOT gated: "which of our reps sold what" is ops
    // work, and locking it would take the Sales reps tab from the people who
    // use it.
    const opsList = await call('/api/admin/sales-reps', { token: opsToken });
    check('...but can still read the rep list', opsList.status === 200,
      { status: opsList.status, error: opsList.body.error });
    const opsOne = await call(`/api/admin/sales-reps/${rep.id}`, { token: opsToken });
    check('...and one rep’s own page', opsOne.status === 200,
      { status: opsOne.status, error: opsOne.body.error });

    /**
     * ASKING FOR THE MAIL, on a box that cannot send one.
     *
     * `credentials_sent` means DELIVERED. It used to answer `true` here,
     * because the console mailer's every method is a console.log that resolves
     * and the route could not tell that from a send. Staging has no provider
     * either, so an admin hiring a rep there was told the login was "on its
     * way by email" and then waited for a message sitting in a server log —
     * the screens have always had the right words for a failed send, they were
     * simply never reached.
     *
     * Asserted as an IMPLICATION, not an equality, and the difference is the
     * whole lesson. Equality said "true exactly when a provider exists",
     * which ignored the second way a send fails: the provider refusing it.
     * This very call proves it — the recipient is on `.test`, Resend rejects
     * a domain that cannot exist, and the route correctly answers false while
     * `mailerDelivers` is true. The equality version failed here and would
     * have taught whoever hit it to delete the check.
     *
     * What must hold everywhere is one direction: a claimed send requires a
     * provider that can deliver. Both ways of not sending — no provider, or a
     * provider that said no — leave it false.
     *
     * Nothing covered this path at all before: the only `send_credentials` in
     * the file was `false`, under a comment promising the flag was "exercised
     * on its own below".
     */
    const wantMail = await call('/api/admin/sales-reps', {
      method: 'POST', token: adminToken,
      body: {
        name: `QA Mail ${stamp}`,
        email: `qa.mail.${stamp}@cesto.test`,
        send_credentials: true,
      },
    });
    const mailRow = wantMail.body.data as { user_id?: string; account_created?: boolean; credentials_sent?: boolean };
    if (mailRow?.user_id) userIds.push(mailRow.user_id);
    check('a hire that ASKS for the credentials email still creates the account',
      wantMail.status === 201 && mailRow?.account_created === true,
      { status: wantMail.status, created: mailRow?.account_created });
    check('...and never claims a send that could not have happened',
      mailRow?.credentials_sent === false || mailerDelivers,
      { credentials_sent: mailRow?.credentials_sent, mailerDelivers });

    // Hiring onto a blocked account is the same refusal as assigning to one.
    const blockedHire = await call('/api/admin/sales-reps', {
      method: 'POST', token: adminToken,
      body: { name: 'QA Blocked Hire', email: `qa.blocked.${stamp}@cesto.test` },
    });
    check('hiring onto a blocked account is refused like assigning to one',
      blockedHire.status === 422, blockedHire.status);

  } finally {
    if (orderIds.length) {
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
    if (addressId) await prisma.address.deleteMany({ where: { id: addressId } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
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
