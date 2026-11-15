// ─── Integration tests · partners the office makes ───────────────────────
//
// POST /api/admin/partners gives somebody a store (an existing one, or a new
// one made for them); POST /api/admin/partners/:userId/credentials gives them
// their login again. What matters is invisible to a typecheck:
//
//   · whoever it is ends up able to use the partner area for that store
//   · a password the person chose stands; anybody else gets a temporary one
//   · a store with ANY partner, a deleted one, or one about to be, is refused
//   · two admins giving the same store at once: one wins, one is told
//   · the credentials route rotates, signs out, and only for a partner
//   · no password hash leaves in the store detail or the email lookup
//
// Runs against the LOCAL database with its own fixtures, removed at the end.
// Mail goes to the console (a test run never reaches a real provider).
//
// Run:  cd packages/api && npm run test:partner-access
import http from 'http';
import bcrypt from 'bcryptjs';
import app from '../../server';
import prisma from '../../lib/prisma';
import { generateAdminAccessToken, generateAccessToken } from '../../lib/jwt';

const TOKEN = generateAdminAccessToken({
  adminId: '00000000-0000-4000-8000-00000000ad31',
  email: 'partner-access-test@cesto.local',
  role: 'ops',
});

let base = '';
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

async function req(method: string, path: string, body?: unknown, bearer = TOKEN) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const stamp = Date.now();
  const storeIds: string[] = [];
  const userIds: string[] = [];
  const mail = (s: string) => `pa-${s}-${stamp}@cesto.local`;

  const mkStore = async (label: string, over: Record<string, unknown> = {}) => {
    const st = await prisma.store.create({
      // Draft + test data: never on the local storefront while this runs.
      data: { name: `PA ${label} ${stamp}`, slug: `pa-${label.toLowerCase()}-${stamp}`, status: 'draft', is_active: true, is_test: true, ...over },
      select: { id: true },
    });
    storeIds.push(st.id);
    return st.id;
  };
  const mkUser = async (label: string, over: Record<string, unknown> = {}) => {
    const u = await prisma.user.create({
      data: { name: `PA ${label}`, email: mail(label), ...over },
      select: { id: true },
    });
    userIds.push(u.id);
    return u.id;
  };
  const link = (body: unknown) => req('POST', '/api/admin/partners', body);
  const partnerMe = (userId: string) => req('GET', '/api/partner/me', undefined, generateAccessToken({ userId }));

  try {
    // ── a new person, a new store ───────────────────────
    console.log('\nA new person and a store made for them');
    {
      const r = await link({ user: { name: 'Nadia Nueva', email: mail('new').toUpperCase() }, store: { name: `PA Made ${stamp}`, contact_phone: '+34600000001' } });
      const d = r.body?.data;
      if (d?.store_id) storeIds.push(d.store_id);
      if (d?.user_id) userIds.push(d.user_id);
      check('answers 201', r.status === 201, r.body);
      check('a new account and a new store', d?.user_created === true && d?.store_created === true);
      check('the email is stored lowercase', d?.login_email === mail('new'), d?.login_email);
      check('a temporary password is issued and handed back', d?.password === 'issued' && typeof d?.temp_password === 'string' && d.temp_password.length === 12);
      check('mail is not sent in a test run, and says why', d?.email_sent === false && /provider/i.test(d?.reason ?? ''), d?.reason);
      const store = d && await prisma.store.findUnique({ where: { id: d.store_id }, select: { status: true, created_via: true, contact_phone: true } });
      check('the store is a draft, made for a partner', store?.status === 'draft' && store?.created_via === 'partner_approval', store);
      const role = d && await prisma.partnerStoreRole.findUnique({ where: { user_id_store_id: { user_id: d.user_id, store_id: d.store_id } } });
      check('they own it', role?.role === 'owner' && role?.is_active === true);
      const profile = d && await prisma.partnerProfile.findUnique({ where: { user_id: d.user_id } });
      check('a partner profile records it', profile?.linked_store_id === d?.store_id && profile?.linked_existing === false && profile?.company === `PA Made ${stamp}`);
      const login = await req('POST', '/api/auth/login-email', { email: mail('new'), password: d?.temp_password });
      check('the temporary password signs in, and asks for a new one', login.status === 200 && login.body?.data?.must_change_password === true, login.status);
      const me = d && await partnerMe(d.user_id);
      check('the partner area opens on their store', me?.status === 200 && JSON.stringify(me.body).includes(d.store_id), me?.status);
    }

    // ── somebody who already shops here ─────────────────
    console.log('\nAn existing customer with a password of their own, onto an existing store');
    const ownHash = await bcrypt.hash('TheirOwn!2026', 10);
    const shopper = await mkUser('shopper', { password_hash: ownHash, password_is_temp: false });
    const freeStore = await mkStore('Free', { created_via: 'admin' });
    {
      const r = await link({ user: { name: '', email: mail('shopper') }, store_id: freeStore, send_email: false });
      const d = r.body?.data;
      check('answers 201', r.status === 201, r.body);
      check('the same account, the same store', d?.user_id === shopper && d?.store_id === freeStore && d?.user_created === false && d?.store_created === false);
      check('their password is kept, and none is handed back', d?.password === 'kept' && d?.temp_password === null);
      const u = await prisma.user.findUnique({ where: { id: shopper }, select: { password_hash: true, password_is_temp: true } });
      check('the stored password did not change', u?.password_hash === ownHash && u?.password_is_temp === false);
      const login = await req('POST', '/api/auth/login-email', { email: mail('shopper'), password: 'TheirOwn!2026' });
      check('they still sign in with it', login.status === 200 && login.body?.data?.must_change_password === false, login.status);
      const profile = await prisma.partnerProfile.findUnique({ where: { user_id: shopper } });
      check('the profile says the store was an existing one', profile?.linked_existing === true && profile?.linked_store_id === freeStore);
      const me = await partnerMe(shopper);
      check('they are now a partner of it', me.status === 200, me.status);
    }

    console.log('\nAn account with no password (made by the office) gets one');
    const noPw = await mkUser('nopw', { password_hash: null });
    {
      const r = await link({ user: { name: 'ignored', email: mail('nopw') }, store_id: await mkStore('ForNoPw') });
      check('a temporary password is issued', r.status === 201 && r.body?.data?.password === 'issued', r.body);
      const u = await prisma.user.findUnique({ where: { id: noPw }, select: { name: true, password_is_temp: true } });
      check('their name is not overwritten', u?.name === 'PA nopw', u?.name);
      check('it is marked temporary', u?.password_is_temp === true);
    }

    console.log('\nAn older mixed-case address is the same person');
    {
      const mixed = await prisma.user.create({ data: { name: 'PA Mixed', email: `PA-Mixed-${stamp}@Cesto.Local` }, select: { id: true } });
      userIds.push(mixed.id);
      const r = await link({ user: { name: 'x', email: `pa-mixed-${stamp}@cesto.local` }, store_id: await mkStore('ForMixed') });
      check('linked to that account, not a new one', r.status === 201 && r.body?.data?.user_id === mixed.id && r.body?.data?.user_created === false, r.body);
      check('told the address on file', r.body?.data?.login_email === `PA-Mixed-${stamp}@Cesto.Local`, r.body?.data?.login_email);
    }

    // ── refusals ────────────────────────────────────────
    console.log('\nWhat is refused');
    {
      const r = await link({ user: { name: 'Second', email: mail('second') }, store_id: freeStore });
      check('a store that has a partner: 409', r.status === 409 && /already has a partner/.test(r.body?.error ?? ''), r.body);
      const off = await mkStore('OffRole');
      const other = await mkUser('offrole');
      await prisma.partnerStoreRole.create({ data: { user_id: other, store_id: off, role: 'owner', is_active: false } });
      const r2 = await link({ user: { name: 'Third', email: mail('third') }, store_id: off });
      check('a store whose only partner is switched off: still 409', r2.status === 409, r2.body);
      const r3 = await link({ user: { name: 'T', email: mail('t3') }, store_id: await mkStore('Gone', { deleted_at: new Date() }) });
      check('a deleted store: 409', r3.status === 409 && /deleted/.test(r3.body?.error ?? ''), r3.body);
      const r4 = await link({ user: { name: 'T', email: mail('t4') }, store_id: await mkStore('Going', { deletion_scheduled_at: new Date(Date.now() + 5 * 864e5) }) });
      check('a store about to be deleted: 409', r4.status === 409 && /scheduled/.test(r4.body?.error ?? ''), r4.body);
      const r5 = await link({ user: { name: 'T', email: mail('t5') }, store_id: '00000000-0000-4000-8000-0000000000ff' });
      check('a store that does not exist: 404', r5.status === 404, r5.body);
      await mkUser('blocked', { status: 'blocked' });
      const r6 = await link({ user: { name: 'B', email: mail('blocked') }, store_id: await mkStore('ForBlocked') });
      check('a blocked account: 422', r6.status === 422 && /blocked/.test(r6.body?.error ?? ''), r6.body);
      const r7 = await link({ user: { name: '', email: mail('noname') }, store: { name: 'X' } });
      check('a new account with no name: 422, and nothing made', r7.status === 422 && !(await prisma.store.findFirst({ where: { name: 'X', created_at: { gte: new Date(stamp) } } })), r7.body);
      const r8 = await link({ user: { name: 'B', email: mail('both') }, store_id: freeStore, store: { name: 'Both' } });
      check('both a store and a new store: 422', r8.status === 422, r8.status);
      const r9 = await link({ user: { name: 'N', email: mail('neither') } });
      check('neither: 422', r9.status === 422, r9.status);
      const leftovers = await prisma.user.count({ where: { email: { in: [mail('second'), mail('third'), mail('t3'), mail('t4'), mail('t5'), mail('noname'), mail('both'), mail('neither')] } } });
      check('no account was left behind by a refusal', leftovers === 0, leftovers);
    }

    console.log('\nTwo admins giving the same store at once');
    {
      const contested = await mkStore('Contested');
      const [a, b] = await Promise.all([
        link({ user: { name: 'Racer A', email: mail('racea') }, store_id: contested }),
        link({ user: { name: 'Racer B', email: mail('raceb') }, store_id: contested }),
      ]);
      for (const r of [a, b]) if (r.body?.data?.user_id) userIds.push(r.body.data.user_id);
      const statuses = [a.status, b.status].sort();
      check('one wins, one is told the store has a partner', statuses[0] === 201 && statuses[1] === 409, statuses);
      const roles = await prisma.partnerStoreRole.count({ where: { store_id: contested } });
      check('the store has exactly one partner', roles === 1, roles);
      const loser = await prisma.user.count({ where: { email: { in: [mail('racea'), mail('raceb')] } } });
      check("the loser's new account was rolled back with it", loser === 1, loser);
    }

    // ── what the admin sees ─────────────────────────────
    console.log('\nThe store page and the email lookup');
    {
      const r = await req('GET', `/api/admin/stores/${freeStore}`);
      const p = r.body?.data?.partners ?? [];
      check('the store lists its partner, with how they sign in', r.status === 200 && p.length === 1 && p[0].user_id === shopper && p[0].access === 'own' && p[0].role === 'owner', p);
      check('no password hash in the store detail', !JSON.stringify(r.body).includes('password_hash') && !JSON.stringify(r.body).includes(ownHash));
      const l = await req('GET', `/api/admin/users/lookup?email=${encodeURIComponent(mail('shopper'))}`);
      const e = l.body?.data?.email;
      check('the lookup says their password stands and what they manage', e?.access === 'own' && e?.partner_stores?.some((s: any) => s.id === freeStore), e);
      check('no password hash in the lookup', !JSON.stringify(l.body).includes('password_hash') && !JSON.stringify(l.body).includes(ownHash));
    }

    // ── their login again ───────────────────────────────
    console.log('\nResending a partner their login');
    {
      await prisma.userRefreshToken.create({ data: { user_id: shopper, token_hash: `pa-token-${stamp}`, expires_at: new Date(Date.now() + 864e5) } });
      const r = await req('POST', `/api/admin/partners/${shopper}/credentials`, { send_email: false });
      const d = r.body?.data;
      check('answers 200 with the shape the credentials dialog reads', r.status === 200 && d?.rotated === true && d?.login_email === mail('shopper') && typeof d?.temp_password === 'string', r.body);
      check('nothing mailed, and it says so', d?.email_sent === false && !!d?.reason);
      const u = await prisma.user.findUnique({ where: { id: shopper }, select: { password_hash: true, password_is_temp: true } });
      check('the password changed and is temporary', u?.password_hash !== ownHash && u?.password_is_temp === true);
      const tokens = await prisma.userRefreshToken.count({ where: { user_id: shopper } });
      check('they are signed out everywhere', tokens === 0, tokens);
      const old = await req('POST', '/api/auth/login-email', { email: mail('shopper'), password: 'TheirOwn!2026' });
      check('the old password no longer works', old.status === 401, old.status);
      const fresh = await req('POST', '/api/auth/login-email', { email: mail('shopper'), password: d?.temp_password });
      check('the new one does', fresh.status === 200, fresh.status);
      const notPartner = await mkUser('notpartner', { password_hash: ownHash });
      const r2 = await req('POST', `/api/admin/partners/${notPartner}/credentials`, { send_email: false });
      check('somebody who manages no store: 422', r2.status === 422, r2.body);
      const r3 = await req('POST', '/api/admin/partners/00000000-0000-4000-8000-0000000000fe/credentials', { send_email: false });
      check('an account that does not exist: 404', r3.status === 404, r3.status);
      const r4 = await req('POST', '/api/admin/partners/not-a-uuid/credentials', { send_email: false });
      check('a malformed id: 404, not a 500', r4.status === 404, r4.status);
    }

    console.log('\nUnlinked, then given the store again');
    {
      const SUPER = generateAdminAccessToken({ adminId: '00000000-0000-4000-8000-00000000ad32', email: 'pa-super@cesto.local', role: 'super_admin' });
      const u = await req('POST', `/api/admin/stores/${freeStore}/unlink-partner`, {}, SUPER);
      check('unlinked', u.status === 200, u.body);
      const me = await partnerMe(shopper);
      check('the partner area is closed to them', me.status === 403, me.status);
      const again = await link({ user: { name: '', email: mail('shopper') }, store_id: freeStore, send_email: false });
      check('the store can be given back', again.status === 201, again.body);
    }

    console.log('\nAnybody signed out or not an admin');
    {
      const r = await req('POST', '/api/admin/partners', { user: { name: 'x', email: mail('anon') }, store: { name: 'x' } }, 'nope');
      check('refused without an admin token', r.status === 401, r.status);
    }
  } finally {
    const made = await prisma.user.findMany({ where: { email: { contains: `-${stamp}@` } }, select: { id: true } });
    const uids = [...new Set([...userIds, ...made.map((u) => u.id)])];
    const roleStores = await prisma.partnerStoreRole.findMany({ where: { user_id: { in: uids } }, select: { store_id: true } });
    const sids = [...new Set([...storeIds, ...roleStores.map((r) => r.store_id)])];
    await prisma.partnerProfile.deleteMany({ where: { user_id: { in: uids } } });
    await prisma.partnerStoreRole.deleteMany({ where: { OR: [{ user_id: { in: uids } }, { store_id: { in: sids } }] } });
    await prisma.userRefreshToken.deleteMany({ where: { user_id: { in: uids } } });
    await prisma.user.deleteMany({ where: { id: { in: uids } } });
    await prisma.store.deleteMany({ where: { id: { in: sids } } });
    await new Promise<void>((r) => server.close(() => r()));
    await prisma.$disconnect();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
