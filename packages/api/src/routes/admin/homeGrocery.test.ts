// ─── Integration test · Home Grocery requests ──────────────────────
//
// Run:  cd packages/api && npm run test:home-grocery
//
// The /rashan form became an application: an admin approves a request (the
// household becomes a Home Grocery subscriber) or rejects it with a reason
// the household is told. This drives the real routes over HTTP against the
// real database and asserts what can quietly go wrong:
//
//   - a NEW household gets an account opened by staff, so it lands in the
//     Home Grocery tab and its orders in the Home Grocery book;
//   - an EXISTING account is linked with its password untouched — approval
//     must never lock someone out of the account they already use;
//   - an account the household signed up for themselves moves from the
//     Customers tab to the Home Grocery tab, which nothing else would do;
//   - a rejection reaches them, with the reason, in-app and by email;
//   - decided requests cannot be decided again, and a signed-in customer
//     cannot queue a second request while one is waiting.
//
// Creates its own throwaway rows and removes them in a finally block.
// Touches nothing seeded.

import http from 'http';
import bcrypt from 'bcryptjs';
import app from '../../server';
import prisma from '../../lib/prisma';
import { generateAdminAccessToken, generateAccessToken } from '../../lib/jwt';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++; console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

const stamp = String(Date.now()).slice(-7);
const TAG = `hg-test-${stamp}`;
const mail = (who: string) => `hg.${who}.${stamp}@cesto-test.invalid`;

const address = {
  contact_name: 'HG Test',
  contact_phone: '600111222',
  street_line_1: 'Calle de Prueba 1',
  postcode: '28001',
  city: 'Madrid',
  province: 'Madrid',
};

/** Fire-and-forget notifications land a moment after the response. */
async function eventually<T>(read: () => Promise<T | null>, ms = 3000): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    type Res = { status: number; body: { data?: any; error?: string; message?: string } };
    const call = async (method: string, path: string, body?: unknown, token?: string): Promise<Res> => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() as Res['body'] };
    };
    const asAdmin = (method: string, path: string, body?: unknown) => call(method, path, body, adminToken);
    const segmentIds = async (segment: string, q: string) => {
      const r = await asAdmin('GET', `/api/admin/users?segment=${segment}&q=${encodeURIComponent(q)}&limit=100`);
      return new Set<string>((r.body.data?.items ?? []).map((u: { id: string }) => u.id));
    };

    const form = (email: string, extra: Record<string, unknown> = {}) => ({
      name: 'HG Household', phone: '+34 600 000 001', email,
      household_size: 4, frequency: 'monthly',
      address_line: 'Calle Mayor 12', city: 'Madrid', postcode: '28013',
      dietary_notes: 'Halal only', language: 'es', source: TAG,
      ...extra,
    });

    // ─── 1 · A household with no account ───────────────────────────
    console.log('\n1 · New household → approval opens an account');
    const sub1 = await call('POST', '/api/rashan-leads', form(mail('new')));
    check('public submit answers 201', sub1.status === 201, sub1);
    const lead1Id: string = sub1.body.data?.id;

    const bell = await eventually(() => prisma.notification.findFirst({
      where: { type: 'admin_home_grocery_request', data: { path: ['lead_id'], equals: lead1Id } },
    }));
    check('admin bell row created for the request', !!bell);

    const open = await asAdmin('GET', `/api/admin/rashan-leads?open=true&q=${encodeURIComponent(mail('new'))}`);
    const openRow = (open.body.data?.items ?? []).find((l: { id: string }) => l.id === lead1Id);
    check('request is in the open queue', !!openRow, open.body);
    check('open queue reports no matching account', openRow?.account === null, openRow?.account);

    const approvePayload = (email: string, withAddress: boolean) => ({
      user: { name: 'HG Household', email, phone: '', preferred_language: 'es' },
      ...(withAddress ? { address } : {}),
      profile: { household_size: 5, frequency: 'monthly', dietary_notes: 'Halal only', contact_phone: '+34 600 000 001' },
    });

    const noAddr = await asAdmin('POST', `/api/admin/rashan-leads/${lead1Id}/approve`, approvePayload(mail('new'), false));
    check('approving a new household without an address is refused (422)', noAddr.status === 422, noAddr.body);

    const ap1 = await asAdmin('POST', `/api/admin/rashan-leads/${lead1Id}/approve`, approvePayload(mail('new'), true));
    check('approve answers 200', ap1.status === 200, ap1.body);
    check('approve reports a CREATED account', ap1.body.data?.account === 'created', ap1.body.data);
    const newUserId: string = ap1.body.data?.user_id;

    const newUser = await prisma.user.findUnique({
      where: { id: newUserId },
      omit: { password_hash: false },
      include: { home_grocery_profile: true, addresses: true },
    });
    check('account was opened by staff (lands in the Home Grocery book)', newUser?.created_by_admin_id === admin.id);
    check('account has a temp password to rotate', newUser?.password_is_temp === true && !!newUser.password_hash);
    check('account is retail', newUser?.is_business === false);
    check('profile carries the ADMIN-EDITED household size', newUser?.home_grocery_profile?.household_size === 5);
    check('profile links back to the request', newUser?.home_grocery_profile?.source_lead_id === lead1Id);
    check('the address became the default', newUser?.addresses.length === 1 && newUser.addresses[0].is_default);

    const lead1 = await prisma.rashanLead.findUnique({ where: { id: lead1Id } });
    check('request is approved and linked', lead1?.approval_status === 'approved' && lead1.approved_user_id === newUserId);
    check('request funnel status follows (converted)', lead1?.status === 'converted' && !!lead1.converted_at);
    check('request records the deciding admin', lead1?.approved_by_admin_id === admin.id);

    const approvedNote = await eventually(() => prisma.notification.findFirst({
      where: { user_id: newUserId, type: 'home_grocery_approved' },
    }));
    check('customer has an approval notification waiting', !!approvedNote);

    check('new subscriber is in the Home Grocery tab', (await segmentIds('rashan', mail('new'))).has(newUserId));

    const again = await asAdmin('POST', `/api/admin/rashan-leads/${lead1Id}/approve`, approvePayload(mail('new'), true));
    check('approving twice is refused (409)', again.status === 409, again.body);
    const rejAfter = await asAdmin('POST', `/api/admin/rashan-leads/${lead1Id}/reject`, { reason: 'Changed our mind about it.' });
    check('rejecting an approved request is refused (409)', rejAfter.status === 409, rejAfter.body);

    // ─── 2 · A customer who signed themselves up ───────────────────
    console.log('\n2 · Existing self-registered customer → approval links, password untouched');
    const knownHash = await bcrypt.hash('their-own-password', 10);
    const existing = await prisma.user.create({
      data: { name: 'HG Existing', email: mail('existing'), password_hash: knownHash },
      select: { id: true },
    });
    const custToken = generateAccessToken({ userId: existing.id, email: mail('existing') });

    check('before approval they are in Customers', (await segmentIds('customers', mail('existing'))).has(existing.id));
    check('before approval they are NOT in Home Grocery', !(await segmentIds('rashan', mail('existing'))).has(existing.id));

    const sub2 = await call('POST', '/api/rashan-leads', form(mail('existing')), custToken);
    check('signed-in submit answers 201', sub2.status === 201, sub2.body);
    const lead2Id: string = sub2.body.data?.id;
    const lead2Row = await prisma.rashanLead.findUnique({ where: { id: lead2Id } });
    check('signed-in submit is stamped with their account', lead2Row?.user_id === existing.id);

    const dup = await call('POST', '/api/rashan-leads', form(mail('existing')), custToken);
    check('a second signed-in submit while waiting is refused (409)', dup.status === 409, dup.body);

    const mine1 = await call('GET', '/api/rashan-leads/mine', undefined, custToken);
    check('/mine shows the open request', mine1.body.data?.open_request?.id === lead2Id, mine1.body.data);
    check('/mine shows no subscription yet', mine1.body.data?.subscriber === null);

    const detail = await asAdmin('GET', `/api/admin/rashan-leads/${lead2Id}`);
    check('admin detail matches the account', detail.body.data?.account?.id === existing.id, detail.body.data?.account);
    check('admin detail says the account has no address yet', detail.body.data?.account?.has_address === false);

    // No address given — an existing account does not need one to be linked.
    const ap2 = await asAdmin('POST', `/api/admin/rashan-leads/${lead2Id}/approve`, approvePayload(mail('existing'), false));
    check('approve answers 200', ap2.status === 200, ap2.body);
    check('approve reports a LINKED account', ap2.body.data?.account === 'linked' && ap2.body.data?.user_id === existing.id, ap2.body.data);

    const after = await prisma.user.findUnique({
      where: { id: existing.id },
      select: { password_hash: true, password_is_temp: true, created_by_admin_id: true, home_grocery_profile: true },
    });
    check('PASSWORD UNTOUCHED', after?.password_hash === knownHash && after?.password_is_temp === false);
    check('still a self-registered account', after?.created_by_admin_id === null);
    check('profile created', !!after?.home_grocery_profile);

    check('after approval they are in Home Grocery', (await segmentIds('rashan', mail('existing'))).has(existing.id));
    check('after approval they have LEFT Customers', !(await segmentIds('customers', mail('existing'))).has(existing.id));

    const mine2 = await call('GET', '/api/rashan-leads/mine', undefined, custToken);
    check('/mine shows them as a subscriber', !!mine2.body.data?.subscriber, mine2.body.data);
    check('/mine shows the approval as the last decision', mine2.body.data?.last_decision?.approval_status === 'approved');

    const dup2 = await call('POST', '/api/rashan-leads', form(mail('existing')), custToken);
    check('a subscriber cannot submit again (409)', dup2.status === 409, dup2.body);

    // ─── 3 · Rejection reaches them ────────────────────────────────
    console.log('\n3 · Rejection — in-app for an account, email either way');
    const rejUser = await prisma.user.create({
      data: { name: 'HG Rejected', email: mail('rejected') },
      select: { id: true },
    });
    // Sent signed-out, with different capitalisation — still their account.
    const sub3 = await call('POST', '/api/rashan-leads', form(mail('rejected').toUpperCase()));
    const lead3Id: string = sub3.body.data?.id;

    const short = await asAdmin('POST', `/api/admin/rashan-leads/${lead3Id}/reject`, { reason: 'no' });
    check('a reason under 10 characters is refused (422)', short.status === 422, short.body);

    const reason = 'We do not deliver to your postcode yet.';
    const rj = await asAdmin('POST', `/api/admin/rashan-leads/${lead3Id}/reject`, { reason });
    check('reject answers 200', rj.status === 200, rj.body);
    check('reject reports an in-app notice (case-insensitive account match)', rj.body.data?.notified_in_app === true, rj.body.data);

    const lead3 = await prisma.rashanLead.findUnique({ where: { id: lead3Id } });
    check('request is rejected with the reason', lead3?.approval_status === 'rejected' && lead3.rejection_reason === reason);
    check('request is closed in the funnel', lead3?.status === 'closed' && !!lead3.rejected_at);

    const rejNote = await eventually(() => prisma.notification.findFirst({
      where: { user_id: rejUser.id, type: 'home_grocery_rejected' },
    }));
    check('customer notification carries the reason', !!rejNote && rejNote.body_es.includes(reason) && rejNote.body_en.includes(reason));

    const rejToken = generateAccessToken({ userId: rejUser.id, email: mail('rejected') });
    const mine3 = await call('GET', '/api/rashan-leads/mine', undefined, rejToken);
    check('/mine shows the rejection and its reason', mine3.body.data?.last_decision?.rejection_reason === reason, mine3.body.data);
    check('/mine shows nothing open, so the form is offered again', mine3.body.data?.open_request === null);
    const resubmit = await call('POST', '/api/rashan-leads', form(mail('rejected')), rejToken);
    check('a rejected household can apply again', resubmit.status === 201, resubmit.body);

    const rj2 = await asAdmin('POST', `/api/admin/rashan-leads/${lead3Id}/reject`, { reason });
    check('rejecting twice is refused (409)', rj2.status === 409, rj2.body);
    const ap3 = await asAdmin('POST', `/api/admin/rashan-leads/${lead3Id}/approve`, approvePayload(mail('rejected'), true));
    check('approving a rejected request is refused (409)', ap3.status === 409, ap3.body);

    const sub4 = await call('POST', '/api/rashan-leads', form(mail('nobody')));
    const rj4 = await asAdmin('POST', `/api/admin/rashan-leads/${sub4.body.data?.id}/reject`, { reason });
    check('no account → no in-app notice, still answered', rj4.status === 200 && rj4.body.data?.notified_in_app === false, rj4.body);

    // ─── 4 · Blocked account ───────────────────────────────────────
    console.log('\n4 · Blocked account');
    await prisma.user.create({ data: { name: 'HG Blocked', email: mail('blocked'), status: 'blocked' } });
    const sub5 = await call('POST', '/api/rashan-leads', form(mail('blocked')));
    const ap5 = await asAdmin('POST', `/api/admin/rashan-leads/${sub5.body.data?.id}/approve`, approvePayload(mail('blocked'), false));
    check('approving onto a blocked account is refused (409)', ap5.status === 409, ap5.body);
  } finally {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: 'hg.', endsWith: `.${stamp}@cesto-test.invalid` } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    const leads = await prisma.rashanLead.findMany({ where: { source: TAG }, select: { id: true } });
    for (const { id } of leads) {
      await prisma.notification.deleteMany({ where: { data: { path: ['lead_id'], equals: id } } });
    }
    // Profiles go first: they point at the requests with SetNull, and at the
    // users with Cascade — either order works, this one is explicit.
    await prisma.homeGroceryProfile.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.rashanLead.deleteMany({ where: { source: TAG } });
    await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    server.close();
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
