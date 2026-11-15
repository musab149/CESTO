/**
 * Integration test for lib/eraseUser against the local database.
 *
 * Builds real rows — orders, addresses, a review, a rashan subscription, a
 * business profile, a lead — erases the account, and checks each promise the
 * privacy policy and the /delete-account page make. Every fixture is created
 * here and removed in `finally`; nothing pre-existing is read or touched.
 *
 * Run: npm run test:erase-user --workspace=packages/api
 */
// Loaded before anything touches Prisma, the way server.ts does. Not via
// `import '../server'` like editOrder.test.ts: that would also start listening.
import dotenv from 'dotenv';
dotenv.config();
import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { eraseUser, UserErasureError } from './eraseUser';
import { recomputeProductRating } from '../routes/reviews';
import { generateOrderNumber } from './pagination';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

const stamp = Date.now();
const userIds: string[] = [];
const leadIds: string[] = [];
let phoneSeq = 0; // User.phone is unique

async function makeUser(tag: string, extra: Partial<Prisma.UserCreateInput> = {}) {
  const user = await prisma.user.create({
    data: {
      name: `Erase Test ${tag}`,
      email: `erase-${tag}-${stamp}@example.test`,
      phone: `6${String(stamp).slice(-6)}${phoneSeq++}`,
      preferred_language: 'es',
      ...extra,
    },
  });
  userIds.push(user.id);
  return user;
}

function makeAddress(userId: string, street: string) {
  return prisma.address.create({
    data: {
      user_id: userId,
      contact_name: 'Real Name',
      contact_phone: '611111111',
      street_line_1: street,
      postcode: '28001',
      city: 'Madrid',
      province: 'Madrid',
      delivery_notes: 'Ring twice',
      latitude: 40.4,
      longitude: -3.7,
    },
  });
}

function makeOrder(userId: string, addressId: string, status: 'delivered' | 'pending') {
  return prisma.order.create({
    data: {
      order_number: generateOrderNumber(),
      user_id: userId,
      address_id: addressId,
      status,
      address_snapshot: {
        contact_name: 'Real Name',
        contact_phone: '611111111',
        street_line_1: 'Calle Real 1',
        street_line_2: '2B',
        postcode: '28001',
        city: 'Madrid',
        province: 'Madrid',
        delivery_notes: 'Ring twice',
      },
      customer_notes: 'Leave with the concierge, Juan',
      payment_method: 'cod',
      subtotal: new Prisma.Decimal('10.00'),
      delivery_fee: new Prisma.Decimal('0.00'),
      total: new Prisma.Decimal('10.00'),
    },
  });
}

async function expectBlocked(name: string, userId: string, wantMessage: RegExp) {
  try {
    await eraseUser(userId, 'self');
    check(`${name}: refused`, false, 'eraseUser resolved');
  } catch (err) {
    const ok = err instanceof UserErasureError && err.status === 409 && wantMessage.test(err.message);
    check(`${name}: refused with 409 and a customer-facing message`, ok, err instanceof Error ? err.message : err);
  }
}

async function main() {
  const category = await prisma.category.create({
    data: { name_es: `Erase Test ${stamp}`, name_en: `Erase Test ${stamp}` },
  });
  const store = await prisma.store.create({
    data: { slug: `erase-test-${stamp}`, name: 'Erase Test Store', followers_count: 1 },
  });
  const product = await prisma.product.create({
    data: {
      name_es: 'Erase Test Product', name_en: 'Erase Test Product',
      category_id: category.id,
      variants: { create: [{ name_es: 'Default', name_en: 'Default', price: new Prisma.Decimal('10.00'), stock_quantity: 10, is_default: true }] },
    },
    include: { variants: true },
  });

  try {
    // ─── 1. The original bug, reproduced ─────────────────────
    // What the old DELETE /me did first for a customer with orders.
    const bugUser = await makeUser('bug');
    const bugAddress = await makeAddress(bugUser.id, 'Calle Bug 1');
    await makeOrder(bugUser.id, bugAddress.id, 'delivered');
    try {
      await prisma.address.deleteMany({ where: { user_id: bugUser.id } });
      check('old path: deleting an ordered-to address fails', false, 'deleteMany succeeded');
    } catch (err) {
      const code = err instanceof Prisma.PrismaClientKnownRequestError ? err.code : String(err);
      check('old path: deleting an ordered-to address fails (the reported bug)', code === 'P2003', code);
    }

    // ─── 2. Customer with history: keep the records, strip the person ──
    const user = await makeUser('soft', { google_id: `g-${stamp}`, phone_country_code: '+34' });
    const usedAddress = await makeAddress(user.id, 'Calle Real 1');
    const spareAddress = await makeAddress(user.id, 'Calle Spare 9');
    const order = await makeOrder(user.id, usedAddress.id, 'delivered');

    await prisma.productReview.create({
      data: { product_id: product.id, user_id: user.id, rating: 5, body: 'Lovely rice, my name is Juan' },
    });
    await prisma.$transaction((tx) => recomputeProductRating(tx, product.id));

    await prisma.cartItem.create({ data: { user_id: user.id, product_id: product.id, variant_id: product.variants[0].id, quantity: 1 } });
    await prisma.storeFollow.create({ data: { user_id: user.id, store_id: store.id } });
    await prisma.webPushSubscription.create({ data: { user_id: user.id, endpoint: `https://push.example/${stamp}`, p256dh: 'k', auth: 'a' } });
    await prisma.userRefreshToken.create({ data: { user_id: user.id, token_hash: `h-${stamp}`, expires_at: new Date(Date.now() + 86_400_000) } });
    await prisma.businessProfile.create({ data: { user_id: user.id, company: 'Juan Trading SL' } });
    const sub = await prisma.rashanSubscription.create({ data: { user_id: user.id, address_id: usedAddress.id } });
    const delivery = await prisma.subscriptionDelivery.create({
      data: { subscription_id: sub.id, scheduled_date: new Date(Date.now() + 7 * 86_400_000) },
    });
    const lead = await prisma.b2bLead.create({
      data: { type: 'business', source: 'test', name: 'Juan Real', company: 'Juan Trading SL', email: user.email!.toUpperCase(), phone: '622222222', message: 'Call me on 622222222' },
    });
    leadIds.push(lead.id);

    const soft = await eraseUser(user.id, 'self');
    check('soft: reported as soft with the order count', soft.mode === 'soft' && soft.preservedOrders === 1, soft);

    const u = await prisma.user.findUnique({ where: { id: user.id }, omit: { password_hash: false } });
    check('soft: user row kept, because orders join to it', !!u);
    check('soft: name, email, phone, country code cleared',
      u?.name === 'Deleted user' && u.email === null && u.phone === null && u.phone_country_code === null, u);
    check('soft: password and google_id cleared, account blocked',
      u?.password_hash === null && u.google_id === null && u.status === 'blocked', u);

    check('soft: an address nothing uses is deleted',
      (await prisma.address.findUnique({ where: { id: spareAddress.id } })) === null);
    const a = await prisma.address.findUnique({ where: { id: usedAddress.id } });
    check('soft: an ordered-to address is stripped, not deleted',
      a?.contact_name === 'Deleted user' && a.contact_phone === '' && a.street_line_1 === 'Deleted address'
        && a.delivery_notes === null && a.latitude === null && a.longitude === null, a);
    check('soft: the address keeps postcode and city', a?.postcode === '28001' && a.city === 'Madrid', a);

    const o = await prisma.order.findUnique({ where: { id: order.id } });
    const snap = o?.address_snapshot as Prisma.JsonObject;
    check('soft: order kept', !!o);
    check("soft: the order's address snapshot is stripped",
      snap?.contact_name === 'Deleted user' && snap.contact_phone === '' && snap.street_line_1 === 'Deleted address'
        && snap.street_line_2 === null && snap.delivery_notes === null, snap);
    check("soft: the order's snapshot keeps postcode, city, province",
      snap?.postcode === '28001' && snap.city === 'Madrid' && snap.province === 'Madrid', snap);
    check('soft: free-text order notes cleared', o?.customer_notes === null, o?.customer_notes);

    check('soft: review deleted', (await prisma.productReview.count({ where: { user_id: user.id } })) === 0);
    const p = await prisma.product.findUnique({ where: { id: product.id }, select: { rating: true, rating_count: true } });
    check('soft: product rating recomputed without the review', p?.rating === null && p.rating_count === 0, p);

    check('soft: cart emptied', (await prisma.cartItem.count({ where: { user_id: user.id } })) === 0);
    check('soft: store follow removed', (await prisma.storeFollow.count({ where: { user_id: user.id } })) === 0);
    const s = await prisma.store.findUnique({ where: { id: store.id }, select: { followers_count: true } });
    check("soft: the store's follower count comes down with it", s?.followers_count === 0, s);
    check('soft: web push subscription removed', (await prisma.webPushSubscription.count({ where: { user_id: user.id } })) === 0);
    check('soft: refresh tokens removed (signed out everywhere)', (await prisma.userRefreshToken.count({ where: { user_id: user.id } })) === 0);
    check('soft: business profile removed', (await prisma.businessProfile.count({ where: { user_id: user.id } })) === 0);

    const sAfter = await prisma.rashanSubscription.findUnique({ where: { id: sub.id } });
    check('soft: rashan subscription cancelled', sAfter?.status === 'cancelled' && sAfter.next_delivery_date === null, sAfter);
    const dAfter = await prisma.subscriptionDelivery.findUnique({ where: { id: delivery.id } });
    check('soft: its upcoming delivery skipped', dAfter?.status === 'skipped', dAfter);

    const l = await prisma.b2bLead.findUnique({ where: { id: lead.id } });
    check('soft: a lead sent from the same email (any case) is stripped',
      l?.name === 'Deleted user' && l.email === '' && l.phone === '' && l.message === null, l);
    check('soft: the lead keeps the company, which is not personal data', l?.company === 'Juan Trading SL', l);

    // ─── 3. An order still on its way blocks deletion ─────────
    const busy = await makeUser('busy');
    const busyAddress = await makeAddress(busy.id, 'Calle Busy 3');
    await makeOrder(busy.id, busyAddress.id, 'pending');
    await expectBlocked('in progress', busy.id, /pedido en curso/);
    const busyAfter = await prisma.user.findUnique({ where: { id: busy.id } });
    check('in progress: nothing was changed', busyAfter?.name === 'Erase Test busy' && busyAfter.email !== null, busyAfter);

    // ─── 4. No orders, but a subscription pinning the address ──
    // The old hard path deleted addresses first, which a subscription's
    // RESTRICT key would also have refused.
    const fresh = await makeUser('hard');
    const freshAddress = await makeAddress(fresh.id, 'Calle Fresh 4');
    const freshSub = await prisma.rashanSubscription.create({ data: { user_id: fresh.id, address_id: freshAddress.id } });
    const hard = await eraseUser(fresh.id, 'self');
    check('hard: reported as hard', hard.mode === 'hard', hard);
    check('hard: user row deleted', (await prisma.user.findUnique({ where: { id: fresh.id } })) === null);
    check('hard: address deleted', (await prisma.address.findUnique({ where: { id: freshAddress.id } })) === null);
    check('hard: subscription deleted', (await prisma.rashanSubscription.findUnique({ where: { id: freshSub.id } })) === null);

    // ─── 5. A partner's login is not erasable this way ─────────
    const partner = await makeUser('partner');
    await prisma.partnerStoreRole.create({ data: { user_id: partner.id, store_id: store.id } });
    await expectBlocked('partner', partner.id, /tienda colaboradora/);

    // ─── 5b. A live rep's login is not erasable either ─────────
    //
    // Not about privacy, about the order book: the FK on
    // orders.created_by_sales_rep_id is ON DELETE SET NULL, so erasing the
    // login would null the attribution on every order the rep ever built and
    // move the lot into the customer book without a word.
    const rep = await makeUser('rep');
    await prisma.salesRep.create({ data: { user_id: rep.id, code: `QA-ERASE-${Date.now() % 100000}` } });
    await expectBlocked('sales rep', rep.id, /comercial de Cesto/);

    // Revoked is history, and history holds nothing back — the ordinary
    // customer path has to work again the moment the role is taken away.
    await prisma.salesRep.update({ where: { user_id: rep.id }, data: { is_active: false } });
    const revokedOutcome = await eraseUser(rep.id, 'self');
    check('a revoked rep can delete their own account', revokedOutcome.mode === 'hard', revokedOutcome);

    // ─── 6. Admin requests get English, not the customer's language ──
    try {
      await eraseUser(busy.id, 'admin');
      check('admin: refused', false, 'resolved');
    } catch (err) {
      check('admin: refusal is in English for staff',
        err instanceof UserErasureError && /This customer has an order in progress/.test(err.message),
        err instanceof Error ? err.message : err);
    }

    // ─── 7. Unknown user ─────────────────────────────────────
    try {
      await eraseUser('00000000-0000-0000-0000-000000000000', 'admin');
      check('unknown: 404', false, 'resolved');
    } catch (err) {
      check('unknown user: 404', err instanceof UserErasureError && err.status === 404, err instanceof Error ? err.message : err);
    }

    // ─── 8. The kept Apple token goes with the account ─────────
    // It is revoked with Apple after the commit. Unconfigured here, so the
    // test never calls Apple — but the row itself must go on both paths,
    // including the one where the user row stays.
    for (const k of ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_PRIVATE_KEY_PATH']) delete process.env[k];
    const quietWarn = console.warn;
    console.warn = () => {};
    try {
      const appleHard = await makeUser('apple-hard', { apple_id: `apple-h-${stamp}` });
      await prisma.appleToken.create({ data: { user_id: appleHard.id, refresh_token: 'r-hard', client_id: 'com.cestoshop.app' } });
      check('apple, no orders: erased outright', (await eraseUser(appleHard.id, 'self')).mode === 'hard');
      check('apple, no orders: token gone', (await prisma.appleToken.findUnique({ where: { user_id: appleHard.id } })) === null);

      const appleSoft = await makeUser('apple-soft', { apple_id: `apple-s-${stamp}` });
      const appleAddress = await makeAddress(appleSoft.id, 'Calle Apple 1');
      await makeOrder(appleSoft.id, appleAddress.id, 'delivered');
      await prisma.appleToken.create({ data: { user_id: appleSoft.id, refresh_token: 'r-soft', client_id: 'com.cestoshop.app' } });
      check('apple, with orders: records kept', (await eraseUser(appleSoft.id, 'self')).mode === 'soft');
      check('apple, with orders: token gone although the user row stays',
        (await prisma.appleToken.findUnique({ where: { user_id: appleSoft.id } })) === null);
    } finally {
      console.warn = quietWarn;
    }
  } finally {
    await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.partnerStoreRole.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.subscriptionDelivery.deleteMany({ where: { subscription: { user_id: { in: userIds } } } });
    await prisma.rashanSubscription.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.orderItem.deleteMany({ where: { order: { user_id: { in: userIds } } } });
    await prisma.order.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.productReview.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.cartItem.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }); // addresses and the rest cascade
    await prisma.b2bLead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.productVariant.deleteMany({ where: { product_id: product.id } });
    await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
    await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
    await prisma.category.delete({ where: { id: category.id } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
