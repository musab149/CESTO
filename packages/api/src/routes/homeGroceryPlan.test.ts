// ─── Integration test · Home Grocery plans and orders ────────────────
//
// Run:  cd packages/api && npm run test:home-grocery-plan
//
// The plan is an approved household's delivery settings, made from its
// request; every Home Grocery order is placed by the household, staff or a
// rep, with its own slot — a day and a part of the day (lib/homeGroceryPlan,
// reshaped 2026-10-22). This drives the real routes over HTTP against the
// real database and asserts what can quietly go wrong:
//
//   - the plan is made from the request, once — not twice at once, and not
//     again behind the household's back after staff end it;
//   - a household's order is an ordinary order: stock taken, priced, in the
//     Home Grocery book, a receipt and an office ping, a retry is the same
//     order, and two orders may share a day;
//   - the slot is checked (tomorrow on for the household, today for staff),
//     can be moved until preparing starts, and the order can be edited;
//   - the due day follows the last order; the reminder goes once per due day,
//     and not to a plan that is paused or has reminders off;
//   - staff and reps place Home Grocery orders the same way;
//   - the old list and skip routes still answer for older app builds.
//
// Creates its own throwaway rows — users, products, orders — and removes them
// in a finally block. Touches nothing seeded.

import http from 'http';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAdminAccessToken, generateAccessToken } from '../lib/jwt';
import {
  dueAfter, isDue, checkSlot, onOrAfterWeekday, addDays, isoWeekday, madridToday, toDate,
  afterPlanOrderChange, REMIND_DAYS_AHEAD, PlanError,
} from '../lib/homeGroceryPlan';

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
const mail = (who: string) => `hgp.${who}.${stamp}@cesto-test.invalid`;
const iso = (d: string | Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);

async function eventually<T>(read: () => Promise<T | null>, ms = 3000): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}
const refused = (fn: () => void) => { try { fn(); return false; } catch (e) { return e instanceof PlanError; } };

function rules() {
  console.log('\n0 · Dates and slots');
  const today = madridToday();
  const tomorrow = addDays(today, 1);
  check('no order yet: due straight away (from tomorrow)', dueAfter(null, 'biweekly', null) === tomorrow);
  check('no order yet, a preferred weekday: the first one from tomorrow',
    dueAfter(null, 'weekly', 5) === onOrAfterWeekday(tomorrow, 5));
  const recent = addDays(today, 2);
  check('every 2 weeks after the last order, on the weekday',
    dueAfter(recent, 'biweekly', isoWeekday(recent)) === addDays(recent, 14));
  check('monthly is 4 weeks', dueAfter(recent, 'monthly', null) === addDays(recent, 28));
  check('a long-ago last order: due from tomorrow', dueAfter('2025-01-01', 'weekly', null) === tomorrow);
  check(`due opens ${REMIND_DAYS_AHEAD} days before the day`, isDue(addDays(today, REMIND_DAYS_AHEAD), false) && !isDue(addDays(today, REMIND_DAYS_AHEAD + 1), false));
  check('an order on its way: not due', !isDue(today, true));
  check('a household cannot pick today', refused(() => checkSlot({ scheduled_for: today })));
  check('staff can', !refused(() => checkSlot({ scheduled_for: today }, { staff: true })));
  check('nor past 30 days', refused(() => checkSlot({ scheduled_for: addDays(today, 31) })));
  check('nor a made-up part of the day', refused(() => checkSlot({ scheduled_for: tomorrow, delivery_window: 'night' as never })));
  check('tomorrow afternoon is fine', !refused(() => checkSlot({ scheduled_for: tomorrow, delivery_window: 'afternoon' })));
}

async function main() {
  rules();

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const productIds: string[] = [];

  try {
    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    const category = await prisma.category.findFirst({ select: { id: true } });
    if (!admin || !category) { console.log('  SKIP  no admin or category row to work with'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    type Res = { status: number; body: { data?: any; error?: string } };
    const call = async (method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}): Promise<Res> => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() as Res['body'] };
    };
    const asAdmin = (m: string, p: string, b?: unknown) => call(m, p, b, adminToken);

    const variants: Array<{ product_id: string; variant_id: string }> = [];
    for (const n of [1, 2]) {
      const p = await prisma.product.create({
        data: {
          name_es: `HGP Producto ${n} ${stamp}`, name_en: `HGP Product ${n} ${stamp}`, category_id: category.id,
          variants: { create: { name_es: 'Unidad', name_en: 'Unit', price: 2 + n, stock_quantity: 100 } },
        },
        select: { id: true, variants: { select: { id: true } } },
      });
      productIds.push(p.id);
      variants.push({ product_id: p.id, variant_id: p.variants[0].id });
    }
    const stockOf = async (i: number) =>
      (await prisma.productVariant.findUnique({ where: { id: variants[i].variant_id }, select: { stock_quantity: true } }))!.stock_quantity;
    const lines = [{ variant_id: variants[0].variant_id, quantity: 2 }, { variant_id: variants[1].variant_id, quantity: 1 }];

    const addressRows = [
      { contact_name: 'HGP', contact_phone: '600111222', street_line_1: 'Calle Uno 1', postcode: '28001', city: 'Madrid', province: 'Madrid', is_default: true },
      { contact_name: 'HGP', contact_phone: '600111222', street_line_1: 'Calle Dos 2', postcode: '28002', city: 'Madrid', province: 'Madrid' },
    ];
    const sub = await prisma.user.create({
      data: {
        name: 'HGP Household', email: mail('sub'),
        home_grocery_profile: { create: { household_size: 4, frequency: 'biweekly', preferred_slot: 'Por la tarde' } },
        addresses: { create: addressRows },
      },
      select: { id: true, addresses: { select: { id: true, street_line_1: true } } },
    });
    const work = sub.addresses.find((a) => a.street_line_1 === 'Calle Dos 2')!.id;
    const subToken = generateAccessToken({ userId: sub.id, email: mail('sub') });
    const plain = await prisma.user.create({
      data: {
        name: 'HGP Plain', email: mail('plain'),
        addresses: { create: { contact_name: 'P', contact_phone: '600', street_line_1: 'Calle 3', postcode: '28003', city: 'Madrid', province: 'Madrid' } },
      },
      select: { id: true, addresses: { select: { id: true } } },
    });
    const plainToken = generateAccessToken({ userId: plain.id, email: mail('plain') });
    const noAddr = await prisma.user.create({
      data: { name: 'HGP NoAddr', email: mail('noaddr'), home_grocery_profile: { create: { household_size: 2, frequency: 'monthly' } } },
      select: { id: true },
    });
    const noAddrToken = generateAccessToken({ userId: noAddr.id, email: mail('noaddr') });

    const today = madridToday();
    const tomorrow = addDays(today, 1);

    console.log('\n1 · The plan is made from the request');
    const notSub = await call('GET', '/api/home-grocery/plan', undefined, plainToken);
    check('a household never approved has no plan', notSub.body.data?.subscriber === false && notSub.body.data?.plan === null, notSub.body);
    const reads = await Promise.all([0, 1, 2, 3].map(() => call('GET', '/api/home-grocery/plan', undefined, subToken)));
    const first = reads[0].body.data;
    check('an approved household has a plan on first visit', reads.every((r) => r.status === 200) && !!first?.plan, reads.map((r) => r.status));
    check('…exactly one, though four visits came at once',
      (await prisma.rashanSubscription.count({ where: { user_id: sub.id } })) === 1);
    check("…with the request's frequency and part of the day", first?.plan?.frequency === 'biweekly' && first?.plan?.preferred_window === 'afternoon', first?.plan);
    check('…to the default address', first?.plan?.address?.street_line_1 === 'Calle Uno 1', first?.plan?.address);
    check('…no orders yet, so the first one is due', first?.due === true && first?.next_due === tomorrow && first?.upcoming === null, [first?.due, first?.next_due]);
    const none = await call('GET', '/api/home-grocery/plan', undefined, noAddrToken);
    check('no address yet: no plan, but a subscriber', none.body.data?.subscriber === true && none.body.data?.plan === null, none.body.data);
    const noAddrOrder = await call('POST', '/api/home-grocery/plan/orders', { scheduled_for: tomorrow, items: lines }, noAddrToken);
    check('…and ordering says to add an address', noAddrOrder.status === 422 && /address/i.test(noAddrOrder.body.error ?? ''), noAddrOrder.body);

    console.log('\n2 · The household places an order');
    const plainOrder = await call('POST', '/api/home-grocery/plan/orders', { scheduled_for: tomorrow, items: lines }, plainToken);
    check('a household never approved is refused', plainOrder.status === 422, plainOrder.body);
    const todayOrder = await call('POST', '/api/home-grocery/plan/orders', { scheduled_for: today, items: lines }, subToken);
    check('today is refused', todayOrder.status === 422, todayOrder.body);
    const badWindow = await call('POST', '/api/home-grocery/plan/orders', { scheduled_for: tomorrow, delivery_window: 'night', items: lines }, subToken);
    check('a made-up part of the day is refused', badWindow.status === 400 || badWindow.status === 422, badWindow.status);
    const before0 = await stockOf(0);
    const day = addDays(today, 3);
    const placed = await call('POST', '/api/home-grocery/plan/orders',
      { scheduled_for: day, delivery_window: 'afternoon', items: lines, customer_notes: 'Timbre 2B' }, subToken, { 'Idempotency-Key': `hgp-${stamp}` });
    check('placed (201)', placed.status === 201, placed.body);
    const orderId: string = placed.body.data?.order?.id;
    const row = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    check('an ordinary pending order that took its stock', row?.status === 'pending' && (await stockOf(0)) === before0 - 2, [row?.status, before0, await stockOf(0)]);
    check('…tagged to the plan, with its day and part of the day',
      row?.rashan_subscription_id === first?.plan?.id && iso(row?.scheduled_for) === day && row?.delivery_window === 'afternoon');
    check('…placed by the household itself', row?.created_by_admin_id === null && row?.created_by_sales_rep_id === null);
    check('…priced, the fee in the total', Number(row?.total) === Number(row?.subtotal) + Number(row?.delivery_fee) && Number(row?.subtotal) === 2 * 3 + 4, [row?.subtotal, row?.delivery_fee, row?.total]);
    check('…with their note', row?.customer_notes === 'Timbre 2B');
    check('the office is told', !!(await eventually(() => prisma.notification.findFirst({
      where: { type: 'admin_new_order', data: { path: ['order_id'], equals: orderId } },
    }))));
    check('the household gets its receipt', !!(await eventually(() => prisma.notification.findFirst({
      where: { user_id: sub.id, type: 'order_placed', data: { path: ['order_id'], equals: orderId } },
    }))));
    const replay = await call('POST', '/api/home-grocery/plan/orders',
      { scheduled_for: day, delivery_window: 'afternoon', items: lines }, subToken, { 'Idempotency-Key': `hgp-${stamp}` });
    check('a retry with the same key is the same order', replay.status === 200 && replay.body.data?.order?.id === orderId, replay.body.data?.order?.id);
    const inBook = await asAdmin('GET', `/api/admin/orders?source=admin&customerType=retail&q=${encodeURIComponent(row!.order_number)}&limit=10`);
    check('it is in the Home Grocery book', (inBook.body.data?.items ?? []).some((o: { id: string }) => o.id === orderId));
    const second = await call('POST', '/api/home-grocery/plan/orders', { scheduled_for: day, items: [lines[1]], address_id: work }, subToken);
    check('a second order for the same day is fine', second.status === 201, second.body);
    const secondRow = await prisma.order.findUnique({ where: { id: second.body.data?.order?.id }, select: { address_snapshot: true, delivery_window: true } });
    check('…to another of their addresses, any time of day',
      (secondRow?.address_snapshot as { street_line_1?: string } | null)?.street_line_1 === 'Calle Dos 2' && secondRow?.delivery_window === null);
    const view = (await call('GET', '/api/home-grocery/plan', undefined, subToken)).body.data;
    check('the plan shows both under way, earliest first, still editable',
      view?.open?.length === 2 && view?.upcoming?.delivery_window !== undefined && view?.upcoming?.editable === true, view?.open?.map((o: { order_number: string }) => o.order_number));
    check('…and nothing is due while they are on their way', view?.due === false);
    check('…the next one due an interval after them', view?.next_due === addDays(day, 14), view?.next_due);

    console.log('\n3 · Changing an order');
    const moved = await call('PUT', `/api/home-grocery/plan/orders/${orderId}/slot`, { scheduled_for: addDays(today, 4), delivery_window: 'morning' }, subToken);
    const movedRow = await prisma.order.findUnique({ where: { id: orderId }, select: { scheduled_for: true, delivery_window: true } });
    check('the household moves its order', moved.status === 200 && iso(movedRow?.scheduled_for) === addDays(today, 4) && movedRow?.delivery_window === 'morning', moved.body);
    const toToday = await call('PUT', `/api/home-grocery/plan/orders/${orderId}/slot`, { scheduled_for: today }, subToken);
    check('…not to today', toToday.status === 422, toToday.body);
    const notTheirs = await call('PUT', `/api/home-grocery/plan/orders/${orderId}/slot`, { scheduled_for: addDays(today, 5) }, plainToken);
    check("…and nobody else can move it (404)", notTheirs.status === 404, notTheirs.status);
    const staffMove = await asAdmin('PUT', `/api/admin/home-grocery/orders/${orderId}/slot`, { scheduled_for: today, delivery_window: 'evening' });
    check('staff can move it to today', staffMove.status === 200, staffMove.body);
    const edited = await call('PUT', `/api/orders/${orderId}/items`, {
      operations: [{ action: 'update_qty', order_item_id: row!.items[0].id, new_quantity: 3 }],
    }, subToken);
    check('the household edits it like any order', edited.status === 200, edited.body);
    await prisma.order.update({ where: { id: orderId }, data: { status: 'preparing' } });
    const tooLate = await call('PUT', `/api/home-grocery/plan/orders/${orderId}/slot`, { scheduled_for: addDays(today, 6) }, subToken);
    check('once preparing starts, its day stays', tooLate.status === 409, tooLate.body);

    console.log('\n4 · When the next order is due (shown nowhere now; still answered)');
    // Both orders settle; the last that was not cancelled sets the due day.
    const longAgo = addDays(today, -20);
    await prisma.order.update({ where: { id: orderId }, data: { status: 'delivered', scheduled_for: toDate(longAgo) } });
    await prisma.order.update({ where: { id: second.body.data.order.id }, data: { status: 'cancelled', scheduled_for: toDate(addDays(today, -2)) } });
    await afterPlanOrderChange(orderId);
    const planRow = await prisma.rashanSubscription.findFirst({ where: { user_id: sub.id } });
    check('a delivered order counts', planRow?.cycles_completed === 1, planRow?.cycles_completed);
    check('due from the last order not cancelled — long past, so from tomorrow', iso(planRow?.next_delivery_date) === tomorrow, iso(planRow?.next_delivery_date));
    const v2 = (await call('GET', '/api/home-grocery/plan', undefined, subToken)).body.data;
    check('the household sees it is due', v2?.due === true && v2?.recent?.length === 2, [v2?.due, v2?.recent?.length]);
    const tab = await asAdmin('GET', `/api/admin/users?segment=rashan&q=${encodeURIComponent(mail('sub'))}`);
    const tabRow = (tab.body.data?.items ?? [])[0];
    check('staff see they are due, and when', tabRow?.home_grocery_plan?.due === true && tabRow?.home_grocery_plan?.next_due === tomorrow, tabRow?.home_grocery_plan);
    const paused = await call('POST', '/api/home-grocery/plan/pause', {}, subToken);
    check('pausing is gone: an older screen is told so (410)', paused.status === 410, paused.body);
    const resumed = await call('POST', '/api/home-grocery/plan/resume', {}, subToken);
    check('…and "resume" just answers with things as they are', resumed.status === 200 && resumed.body.data?.plan?.status === 'active');
    await prisma.rashanSubscription.updateMany({ where: { user_id: sub.id }, data: { status: 'paused' } });
    const unpaused = await call('GET', '/api/home-grocery/plan', undefined, subToken);
    check('a row the old screens left paused is active again on the next read', unpaused.body.data?.plan?.status === 'active', unpaused.body.data?.plan?.status);
    const weekdayNow = isoWeekday(addDays(today, 2));
    const set = await call('PUT', '/api/home-grocery/plan/settings', { preferred_weekday: weekdayNow, frequency: 'weekly' }, subToken);
    check('settings saved; the due day moves to the new weekday',
      set.status === 200 && set.body.data?.next_due === onOrAfterWeekday(tomorrow, weekdayNow), set.body.data?.next_due);

    console.log('\n5 · Staff and reps place Home Grocery orders');
    const staffOrder = await asAdmin('POST', '/api/admin/orders', {
      user_id: sub.id, address_id: sub.addresses[0].id, items: [lines[0]], home_grocery: { scheduled_for: today, delivery_window: 'morning' },
    });
    const staffRow = staffOrder.body.data?.order;
    check('staff place one, today allowed', staffOrder.status === 201 && staffRow?.rashan_subscription_id === first?.plan?.id && staffRow?.delivery_window === 'morning', staffOrder.body.error ?? staffRow?.rashan_subscription_id);
    const staffPlain = await asAdmin('POST', '/api/admin/orders', {
      user_id: plain.id, address_id: plain.addresses[0].id, items: [lines[0]], home_grocery: { scheduled_for: today },
    });
    check('…but not for a household never approved', staffPlain.status === 422, staffPlain.body);
    const staffNormal = await asAdmin('POST', '/api/admin/orders', { user_id: plain.id, address_id: plain.addresses[0].id, items: [lines[0]] });
    check('an ordinary staff order is untouched', staffNormal.status === 201 && staffNormal.body.data?.order?.rashan_subscription_id === null, staffNormal.body.error);
    const rep = await prisma.user.create({ data: { name: 'HGP Rep', email: mail('rep') }, select: { id: true } });
    await prisma.salesRep.create({ data: { user_id: rep.id, code: `HGP-${stamp}`, house_store: true } }); // its products are Cesto's own (lib/repStore)
    await prisma.user.update({ where: { id: sub.id }, data: { created_by_sales_rep_id: rep.id } });
    const repToken = generateAccessToken({ userId: rep.id, email: mail('rep') });
    const repClient = await call('GET', `/api/sales/clients/${sub.id}`, undefined, repToken);
    const hgOf = repClient.body.data?.home_grocery;
    check('the rep sees the household\'s plan on the client: its settings and when the next order is due',
      repClient.status === 200 && hgOf?.frequency === 'weekly' && hgOf?.preferred_weekday === weekdayNow && hgOf?.preferred_window === first?.plan?.preferred_window
        && typeof hgOf?.next_due === 'string' && hgOf?.due === false, hgOf);
    const repOrder = await call('POST', '/api/sales/orders', {
      user_id: sub.id, address_id: sub.addresses[0].id, items: [lines[1]], home_grocery: { scheduled_for: tomorrow, delivery_window: 'evening' },
    }, repToken);
    const repRow = repOrder.body.data?.order;
    check('a rep places one for a household in their book', repOrder.status === 201 && repRow?.rashan_subscription_id === first?.plan?.id && repRow?.created_by_sales_rep_id === rep.id, repOrder.body.error);

    console.log('\n5b · The cart is the grocery list: every checkout is a Home Grocery order');
    const fillCart = (token: string, items: Array<{ product_id: string; variant_id: string; quantity: number }>) =>
      call('PUT', '/api/cart', { items: items.map((i) => ({ productId: i.product_id, variantId: i.variant_id, quantity: i.quantity })) }, token);
    const cartOf = async (token: string) => {
      const d = (await call('GET', '/api/cart', undefined, token)).body.data;
      return (Array.isArray(d) ? d : d?.items ?? []) as Array<{ variantId: string; quantity: number }>;
    };
    const planNow = (await call('GET', '/api/home-grocery/plan', undefined, subToken)).body.data;
    await fillCart(subToken, [{ ...variants[0], quantity: 2 }, { ...variants[1], quantity: 1 }]);
    const co = await call('POST', '/api/orders', { addressId: sub.addresses[0].id, paymentMethod: 'cod' }, subToken, { 'Idempotency-Key': `hgp-co-${stamp}` });
    const coRow = co.body.data;
    const expectDay = onOrAfterWeekday(tomorrow, planNow.plan.preferred_weekday);
    check("a household's checkout is a Home Grocery order: its plan, the default slot, Cesto's",
      co.status === 201 && coRow?.rashan_subscription_id === planNow.plan.id && iso(coRow?.scheduled_for) === expectDay
        && coRow?.delivery_window === planNow.plan.preferred_window && coRow?.store_id === null,
      co.body.error ?? { d: iso(coRow?.scheduled_for), expectDay, w: coRow?.delivery_window });
    check('…and the cart is empty after it', (await cartOf(subToken)).length === 0);
    const coAgain = await call('POST', '/api/orders', { addressId: sub.addresses[0].id, paymentMethod: 'cod' }, subToken, { 'Idempotency-Key': `hgp-co-${stamp}` });
    check('a retry with the same key is the same order', coAgain.status === 200 && coAgain.body.data?.id === coRow?.id, coAgain.status);
    await fillCart(subToken, [{ ...variants[1], quantity: 1 }]);
    const coSlot = await call('POST', '/api/orders', { addressId: work, paymentMethod: 'cod', homeGrocery: { scheduled_for: addDays(today, 3), delivery_window: 'evening' } }, subToken);
    check("the slot chosen at checkout is the order's, at the address chosen",
      coSlot.status === 201 && iso(coSlot.body.data?.scheduled_for) === addDays(today, 3) && coSlot.body.data?.delivery_window === 'evening' && coSlot.body.data?.address_id === work,
      coSlot.body.error);
    await fillCart(subToken, [{ ...variants[1], quantity: 1 }]);
    const coToday = await call('POST', '/api/orders', { addressId: work, paymentMethod: 'cod', homeGrocery: { scheduled_for: today } }, subToken);
    check('…but not for today', coToday.status === 422, coToday.body);
    await fillCart(subToken, [{ ...variants[0], quantity: 99 }]);
    await prisma.productVariant.update({ where: { id: variants[0].variant_id }, data: { stock_quantity: 5 } });
    const coShort = await call('POST', '/api/orders', { addressId: work, paymentMethod: 'cod' }, subToken);
    check('short of stock: refused with the shortfall, not parked as a draft', coShort.status === 400 && Array.isArray(coShort.body.data?.shortfalls), coShort.body);
    check('…and the list is still there', (await cartOf(subToken)).length === 1);
    await prisma.productVariant.update({ where: { id: variants[0].variant_id }, data: { stock_quantity: 100 } });
    await fillCart(plainToken, [{ ...variants[1], quantity: 1 }]);
    const coPlain = await call('POST', '/api/orders', { addressId: plain.addresses[0].id, paymentMethod: 'cod', homeGrocery: { scheduled_for: tomorrow } }, plainToken);
    check("anyone else's checkout is an ordinary order (a stray slot ignored)", coPlain.status === 201 && !coPlain.body.data?.rashan_subscription_id, coPlain.body.error);

    // Reorder: back into the list, adding to it or replacing it, and named when it cannot.
    await fillCart(subToken, [{ ...variants[1], quantity: 1 }]);
    const reAdd = await call('POST', `/api/orders/${coRow.id}/reorder`, { mode: 'add' }, subToken);
    const addItems = (reAdd.body.data?.items ?? []) as Array<{ variantId: string; quantity: number }>;
    check('reorder "add" keeps the list and adds the order on top',
      reAdd.status === 200 && addItems.find((i) => i.variantId === variants[0].variant_id)?.quantity === 2
        && addItems.find((i) => i.variantId === variants[1].variant_id)?.quantity === 2, addItems);
    const reRep = await call('POST', `/api/orders/${coSlot.body.data.id}/reorder`, undefined, subToken);
    check('reorder with no body replaces the list, as older clients expect',
      reRep.status === 200 && reRep.body.data?.items?.length === 1 && reRep.body.data.items[0].variantId === variants[1].variant_id, reRep.body.data?.items);
    await prisma.productVariant.update({ where: { id: variants[0].variant_id }, data: { is_active: false } });
    const reGone = await call('POST', `/api/orders/${coRow.id}/reorder`, { mode: 'replace' }, subToken);
    check('a product no longer on sale is left out, by name',
      reGone.body.data?.skipped_items?.[0]?.reason === 'unavailable' && /HGP Producto 1/.test(reGone.body.data.skipped_items[0].name_es), reGone.body.data?.skipped_items);
    await prisma.productVariant.update({ where: { id: variants[0].variant_id }, data: { is_active: true } });
    await call('DELETE', '/api/cart', undefined, subToken);

    // Edits keep a Home Grocery order whole, a partner's product included.
    const store = await prisma.store.findFirst({ where: { is_active: true }, select: { id: true } });
    if (store) {
      const partnerProduct = await prisma.product.create({
        data: {
          name_es: `HGP Tienda ${stamp}`, name_en: `HGP Shop ${stamp}`, category_id: category.id, store_id: store.id,
          variants: { create: { name_es: 'Unidad', name_en: 'Unit', price: 4, stock_quantity: 50 } },
        },
        select: { id: true, variants: { select: { id: true } } },
      });
      productIds.push(partnerProduct.id);
      const ed = await call('PUT', `/api/orders/${coRow.id}/items`, {
        operations: [{ action: 'add', new_variant_id: partnerProduct.variants[0].id, new_quantity: 1 }],
      }, subToken);
      const after2 = await prisma.order.findUnique({ where: { id: coRow.id }, include: { items: true } });
      check("adding a partner's product to a Home Grocery order keeps it on that order, Cesto's",
        ed.status === 200 && after2?.store_id === null && !!after2?.items.some((i) => i.variant_id === partnerProduct.variants[0].id), ed.body.error ?? ed.status);
    } else {
      console.log('  SKIP  no partner store to test an edit with');
    }

    // Staff and reps: a plan holder's order is a Home Grocery one even with no slot sent.
    const staffNoSlot = await asAdmin('POST', '/api/admin/orders', { user_id: sub.id, address_id: sub.addresses[0].id, items: [lines[1]] });
    check("staff: a plan holder's order without a slot is still theirs, on the default day (today on)",
      staffNoSlot.status === 201 && staffNoSlot.body.data?.order?.rashan_subscription_id === planNow.plan.id
        && iso(staffNoSlot.body.data.order.scheduled_for) === onOrAfterWeekday(today, planNow.plan.preferred_weekday),
      staffNoSlot.body.error ?? iso(staffNoSlot.body.data?.order?.scheduled_for));

    console.log('\n6 · Older app builds and the end of a plan');
    const oldItems = await call('PUT', '/api/home-grocery/plan/items', { items: [{ ...variants[0], quantity: 1 }] }, subToken);
    check('the old list route still answers', oldItems.status === 200, oldItems.body);
    const oldSkip = await call('POST', '/api/home-grocery/plan/skip', {}, subToken);
    check('the old skip route says there is nothing to skip', oldSkip.status === 409, oldSkip.body);
    const oldCreate = await call('POST', '/api/home-grocery/plan', { address_id: work, items: [{ ...variants[0], quantity: 1 }] }, subToken);
    check('starting a second plan is refused (409)', oldCreate.status === 409, oldCreate.status);
    const ended = await asAdmin('POST', `/api/admin/home-grocery/plans/user/${sub.id}/end`, { reason: 'Moving away' });
    check('ending is gone: an older admin screen is told so (410)', ended.status === 410, ended.body);
    const before = (await call('GET', '/api/home-grocery/plan', undefined, subToken)).body.data?.plan?.id;
    await prisma.rashanSubscription.updateMany({ where: { user_id: sub.id }, data: { status: 'cancelled', cancelled_at: new Date() } });
    const after = await call('GET', '/api/home-grocery/plan', undefined, subToken);
    check('a row the old screens ended comes back on the next read — the same one, so its orders stay with it',
      after.body.data?.plan?.id === before && after.body.data?.plan?.status === 'active', after.body.data?.plan);
    const again = await call('POST', '/api/home-grocery/plan', { address_id: work, frequency: 'monthly' }, subToken);
    check('there is never a second one (409)', again.status === 409, again.status);
  } finally {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: 'hgp.', endsWith: `.${stamp}@cesto-test.invalid` } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    const orders = await prisma.order.findMany({ where: { user_id: { in: userIds } }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
    await prisma.orderIdempotency.deleteMany({ where: { order_id: { in: orderIds } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.rashanSubscription.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.notification.deleteMany({
      where: { audience: 'admin', OR: [
        ...orderIds.map((id) => ({ data: { path: ['order_id'], equals: id } })),
        ...userIds.map((id) => ({ data: { path: ['user_id'], equals: id } })),
      ] },
    });
    await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { created_by_sales_rep_id: null } });
    await prisma.homeGroceryProfile.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
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
