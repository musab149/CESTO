// ─── Integration test · password hashes stay in the server ────────
//
// Run:  cd packages/api && npm run test:password-hash
//
// GET /api/admin/users/:id returned the whole User row, so a customer's bcrypt
// hash went to the admin's browser (found 2026-11-06). lib/prisma.ts now leaves
// password_hash out of every read that does not ask for it by name.
//
// That cuts both ways, and the compiler cannot see either side: Prisma's types
// only narrow a global omit that names a single model. So a read that forgets to
// ask still compiles and gets undefined, and if that read is the one checking a
// password, nobody can sign in. This test holds both sides:
//
//   · every way of checking a password still works, and still refuses;
//   · no response that carries a user or admin row carries a hash.
//
// Real routes over HTTP. Creates its own rows and removes them in a finally.
import http from 'http';
import bcrypt from 'bcryptjs';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAccessToken, generateAdminAccessToken } from '../lib/jwt';
import { createOrderForCustomer } from '../lib/createOrder';

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
const OWN = 'OwnPass456A';
const TEMP = 'TempPass123A';
const NEWER = 'NewerPass789A';

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;

  const call = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, body };
  };
  /** A bcrypt hash, or the column's name, anywhere in what was sent. */
  const carriesHash = (text: string) => /password_hash|\$2[aby]\$\d\d\$/.test(text);
  const clean = (name: string, r: { status: number; text: string }) => {
    check(`${name}: answers`, r.status === 200, { status: r.status, body: r.text.slice(0, 160) });
    check(`${name}: carries no hash`, !carriesHash(r.text));
  };

  const made = { users: [] as string[], admins: [] as string[], orders: [] as string[], product: '', category: '', store: '' };
  const mkUser = async (tag: string, data: { password?: string; temp?: boolean; googleId?: string }) => {
    const email = `qa.hash.${tag}.${stamp}@cesto.test`;
    const u = await prisma.user.create({
      data: {
        name: `QA Hash ${tag}`, email,
        password_hash: data.password ? await bcrypt.hash(data.password, 10) : null,
        password_is_temp: data.temp ?? false,
        google_id: data.googleId ?? null,
      },
      select: { id: true },
    });
    made.users.push(u.id);
    return { id: u.id, email };
  };

  try {
    const own = await mkUser('own', { password: OWN });
    const temp = await mkUser('temp', { password: TEMP, temp: true });
    const google = await mkUser('google', { googleId: `qa-hash-${stamp}` });
    const partner = await mkUser('partner', { password: OWN });
    const noWay = await mkUser('noway', {});

    const adminEmail = `qa.hash.admin.${stamp}@cesto.test`;
    const admin = await prisma.admin.create({
      data: { name: 'QA Hash Admin', email: adminEmail, password_hash: await bcrypt.hash(OWN, 10), role: 'super_admin' },
      select: { id: true, email: true, role: true },
    });
    made.admins.push(admin.id);
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    // ── 1. The list itself ────────────────────────────────────────────
    console.log('\nThe client leaves it out unless asked');
    const plainUser = await prisma.user.findUnique({ where: { id: own.id } });
    check('a read that does not ask: no user hash', !!plainUser && !('password_hash' in plainUser));
    const plainAdmin = await prisma.admin.findUnique({ where: { id: admin.id } });
    check('a read that does not ask: no admin hash', !!plainAdmin && !('password_hash' in plainAdmin));
    const asked = await prisma.user.findUnique({ where: { id: own.id }, select: { password_hash: true } });
    check('a read that asks by name still gets it', !!asked?.password_hash && await bcrypt.compare(OWN, asked.password_hash));
    const askedOmit = await prisma.user.findUnique({ where: { id: own.id }, omit: { password_hash: false } });
    check('so does omit: { password_hash: false }', !!askedOmit?.password_hash);

    // ── 2. Everything that checks a password still does ───────────────
    console.log('\nSigning in');
    const signIn = (email: string, password: string) => call('/api/auth/login-email', { method: 'POST', body: { email, password } });
    const ok = await signIn(own.email, OWN);
    check('the right password signs in', ok.status === 200 && !!ok.body?.data?.accessToken, ok.status);
    check('the sign-in answer carries no hash', !carriesHash(ok.text));
    check('not told to change a password of their own', ok.body?.data?.must_change_password === false);
    check('the wrong password is refused', (await signIn(own.email, 'WrongPass000A')).status === 401);
    check('the email in another case still signs in', (await signIn(own.email.toUpperCase(), OWN)).status === 200);
    check('an unknown email is refused the same way', (await signIn(`nobody.${stamp}@cesto.test`, OWN)).status === 401);
    check('an account with no password is refused', (await signIn(google.email, OWN)).status === 401);
    const tempIn = await signIn(temp.email, TEMP);
    check('a temporary password signs in and must be changed', tempIn.status === 200 && tempIn.body?.data?.must_change_password === true, tempIn.body?.data);

    console.log('\nChanging a password');
    const ownToken = ok.body.data.accessToken as string;
    const change = (token: string, currentPassword: string, newPassword: string) =>
      call('/api/auth/change-password', { method: 'POST', token, body: { currentPassword, newPassword } });
    const wrong = await change(ownToken, 'WrongPass000A', NEWER);
    check('a wrong current password is refused, as wrong', wrong.status === 400 && wrong.body?.data?.code === 'wrong_current_password', wrong.body);
    const noneToken = generateAccessToken({ userId: google.id, email: google.email });
    const none = await change(noneToken, OWN, NEWER);
    check('an account with no password is told so', none.status === 400 && /No password is set/.test(none.body?.error ?? ''), none.body);
    const changed = await change(ownToken, OWN, NEWER);
    check('the right current password changes it', changed.status === 200, changed.body);
    check('the new password signs in', (await signIn(own.email, NEWER)).status === 200);
    check('the old one no longer does', (await signIn(own.email, OWN)).status === 401);

    console.log('\nThe office signing in');
    const adminIn = (password: string) => call('/api/admin/auth/login', { method: 'POST', body: { email: adminEmail, password } });
    const adminOk = await adminIn(OWN);
    check('the right password signs an admin in', adminOk.status === 200 && !!adminOk.body?.data?.accessToken, adminOk.status);
    check('the admin sign-in answer carries no hash', !carriesHash(adminOk.text));
    check('the wrong password is refused', (await adminIn('WrongPass000A')).status === 401);

    // ── 3. What reads the hash to answer something else ───────────────
    console.log('\nOwn / temporary / none still works out');
    const lookup = (email: string) => call(`/api/admin/users/lookup?email=${encodeURIComponent(email)}`, { token: adminToken });
    const lOwn = await lookup(own.email);
    check('their own password reads as own', lOwn.body?.data?.email?.access === 'own', lOwn.text.slice(0, 240));
    const lTemp = await lookup(temp.email);
    check('a temporary password reads as temporary', lTemp.body?.data?.email?.access === 'temporary', lTemp.text.slice(0, 240));
    // accessOf: a Google login is a way in of their own, with or without a password.
    const lGoogle = await lookup(google.email);
    check('google only reads as own', lGoogle.body?.data?.email?.access === 'own', lGoogle.text.slice(0, 240));
    const lNone = await lookup(noWay.email);
    check('no password and no google reads as none', lNone.body?.data?.email?.access === 'none', lNone.text.slice(0, 240));
    check('the lookup carries no hash', !carriesHash(lOwn.text) && !carriesHash(lTemp.text));

    // ── 4. Responses that carry whole rows ────────────────────────────
    console.log('\nNo response carries a hash');
    made.category = (await prisma.category.create({ data: { name_es: `QA Hash ${stamp}`, name_en: `QA Hash ${stamp}`, sort_order: 9999 }, select: { id: true } })).id;
    made.store = (await prisma.store.create({ data: { slug: `qa-hash-${stamp}`, name: `QA Hash Tienda ${stamp}` }, select: { id: true } })).id;
    await prisma.partnerStoreRole.create({ data: { user_id: partner.id, store_id: made.store, role: 'owner' } });
    const product = await prisma.product.create({
      data: {
        name_es: `QA Hash ${stamp}`, name_en: `QA Hash ${stamp}`, category_id: made.category, store_id: made.store, is_active: true,
        variants: { create: [{ name_es: '1 ud', name_en: '1 unit', is_default: true, is_active: true, stock_quantity: 50, price: 2 }] },
      },
      include: { variants: true },
    });
    made.product = product.id;
    const address = await prisma.address.create({
      data: { user_id: own.id, contact_name: 'QA', contact_phone: '600000044', street_line_1: 'C/ Hash 1', postcode: '28013', city: 'Madrid', province: 'Madrid', is_default: true },
      select: { id: true },
    });
    const placed = await createOrderForCustomer(
      { user_id: own.id, address_id: address.id, payment_method: 'cod', items: [{ variant_id: product.variants[0].id, quantity: 1 }] },
      { adminId: admin.id },
    );
    made.orders.push(placed.order.id);
    await prisma.order.update({ where: { id: placed.order.id }, data: { store_id: made.store } });

    clean('admin: one customer (where this was found)', await call(`/api/admin/users/${own.id}`, { token: adminToken }));
    clean('admin: the customer list', await call('/api/admin/users?limit=20', { token: adminToken }));
    clean('admin: one order', await call(`/api/admin/orders/${placed.order.id}`, { token: adminToken }));
    clean('admin: the order list', await call('/api/admin/orders?limit=20', { token: adminToken }));
    clean('admin: the store with its partner', await call(`/api/admin/stores/${made.store}`, { token: adminToken }));
    clean('admin: the staff list', await call('/api/admin/staff', { token: adminToken }));
    clean('admin: the sales reps', await call('/api/admin/sales-reps', { token: adminToken }));
    const newest = await call('/api/auth/login-email', { method: 'POST', body: { email: own.email, password: NEWER } });
    clean('customer: their own account', await call('/api/users/me', { token: newest.body.data.accessToken }));
    clean('customer: their order', await call(`/api/orders/${placed.order.id}`, { token: newest.body.data.accessToken }));
    const partnerToken = generateAccessToken({ userId: partner.id, email: partner.email });
    clean('partner: their account', await call('/api/users/me', { token: partnerToken }));
    clean('partner: the order', await call(`/api/partner/orders/${placed.order.id}`, { token: partnerToken }));
  } finally {
    if (made.orders.length) {
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: made.orders } } }).catch(() => {});
      await prisma.orderItem.deleteMany({ where: { order_id: { in: made.orders } } });
      await prisma.order.deleteMany({ where: { id: { in: made.orders } } });
    }
    if (made.product) {
      await prisma.cartItem.deleteMany({ where: { variant: { product_id: made.product } } }).catch(() => {});
      await prisma.productVariant.deleteMany({ where: { product_id: made.product } });
      await prisma.product.delete({ where: { id: made.product } });
    }
    if (made.users.length) {
      await prisma.notification.deleteMany({ where: { user_id: { in: made.users } } }).catch(() => {});
      await prisma.userRefreshToken.deleteMany({ where: { user_id: { in: made.users } } }).catch(() => {});
      await prisma.partnerStoreRole.deleteMany({ where: { user_id: { in: made.users } } }).catch(() => {});
      await prisma.address.deleteMany({ where: { user_id: { in: made.users } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    }
    if (made.store) await prisma.store.delete({ where: { id: made.store } }).catch(() => {});
    if (made.category) await prisma.category.delete({ where: { id: made.category } }).catch(() => {});
    if (made.admins.length) {
      await prisma.adminRefreshToken.deleteMany({ where: { admin_id: { in: made.admins } } }).catch(() => {});
      await prisma.admin.deleteMany({ where: { id: { in: made.admins } } }).catch(() => {});
    }
    server.close();
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
