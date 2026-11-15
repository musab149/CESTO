// ─── Integration test · editing drafts, staff and reps ─────────────────────
//
// Run:  cd packages/api && npm run test:draft-edit
//
// Since 2026-11-04 a draft our team built — by staff, by a rep, or a Home
// Grocery order — can be edited before it is placed: by staff in the admin
// panel, and by the rep who built it in theirs. Same edit as any order, with
// one difference: a draft holds no stock (confirming its stock takes it), so
//
//   · no stock moves on an edit, and the customer is told nothing;
//   · a raised line must fit in stock AS A WHOLE, since none of it is held;
//   · confirming the stock afterwards takes the EDITED quantities, at the
//     EDITED prices — nothing re-prices a draft somebody edited.
//
// Covers small and big drafts (300 lines, edited in one request), wholesale
// pricing, the same product on two lines, Home Grocery drafts (a rep's, and
// one the old plan made), a customer editing the draft their own checkout
// made, a draft emptied by any of them (cancelled, not refused), and what
// stays closed: another rep's draft, a draft the team is still building for
// the customer, a PLACED order edited to nothing.
//
// Goes through the real routes over HTTP. Builds its own products, clients
// and orders, and removes them.
import http from 'http';
import app from '../../server';
import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { generateAccessToken, generateAdminAccessToken } from '../../lib/jwt';
import { generateOrderNumber } from '../../lib/pagination';
import { isEditableDraft, EMPTIED_DRAFT_REASON } from '../../lib/editOrder';

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
const cents = (v: unknown) => Math.round(Number(v) * 100);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lines on the big draft, and spare products for its edit to add. */
const BIG_LINES = 300;
const BIG_SPARES = 20;

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const productIds: string[] = [];
  let categoryId = '';

  const call = async (path: string, init: { method?: string; body?: unknown; token: string }) => {
    const started = Date.now();
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${init.token}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, ms: Date.now() - started, body: await res.json() as { success: boolean; error?: string; data?: any } };
  };

  try {
    // ─── Fixtures ────────────────────────────────────────────
    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    categoryId = (await prisma.category.create({
      data: { name_es: `QA Draft Cat ${stamp}`, name_en: `QA Draft Cat ${stamp}` },
    })).id;
    type P = { productId: string; variantId: string; price: Prisma.Decimal; name: string };
    /** Cesto's own, IVA undecided (0 %), so a price is exactly what is stored. */
    const makeProduct = async (name: string, price: string, stock: number, b2b?: string): Promise<P> => {
      const p = await prisma.product.create({
        data: {
          name_es: `QA Draft ${name} ${stamp}`, name_en: `QA Draft ${name} ${stamp}`,
          category_id: categoryId, store_id: null,
          variants: {
            create: [{
              name_es: 'Ud', name_en: 'Unit', price: new Prisma.Decimal(price),
              ...(b2b ? { b2b_price: new Prisma.Decimal(b2b) } : {}),
              stock_quantity: stock, is_default: true,
            }],
          },
        },
        include: { variants: true },
      });
      productIds.push(p.id);
      return { productId: p.id, variantId: p.variants[0].id, price: p.variants[0].price, name: p.name_es };
    };
    const A = await makeProduct('A', '2.00', 5);
    const B = await makeProduct('B', '3.00', 10);
    const C = await makeProduct('C', '1.50', 50, '1.20');
    const D = await makeProduct('D', '4.00', 50);
    const big: P[] = [];
    for (let i = 0; i < BIG_LINES + BIG_SPARES; i += 25) {
      big.push(...await Promise.all(
        Array.from({ length: Math.min(25, BIG_LINES + BIG_SPARES - i) }, (_, k) => makeProduct(`Big${i + k}`, '1.00', 10)),
      ));
    }
    const stockOf = async (variantId: string) =>
      (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { stock_quantity: true } })).stock_quantity;
    const setStock = (variantId: string, n: number) =>
      prisma.productVariant.update({ where: { id: variantId }, data: { stock_quantity: n } });

    // Two reps selling Cesto's own catalogue.
    const makeRep = async (tag: string) => {
      const u = await prisma.user.create({
        data: { name: `QA Draft ${tag} ${stamp}`, email: `qa.draft${tag.toLowerCase()}.${stamp}@cesto.test` },
        select: { id: true, email: true },
      });
      userIds.push(u.id);
      await prisma.salesRep.create({ data: { user_id: u.id, is_active: true, house_store: true } });
      return { id: u.id, token: generateAccessToken({ userId: u.id, email: u.email ?? undefined }) };
    };
    const rep = await makeRep('Rep');
    const otherRep = await makeRep('Other');

    /** A client the rep opened (so in their reach), with an address. */
    const makeClient = async (tag: string, extra: Prisma.UserUncheckedCreateInput | object = {}) => {
      const u = await prisma.user.create({
        data: {
          name: `QA Draft ${tag} ${stamp}`, email: `qa.draft${tag.toLowerCase()}.${stamp}@cesto.test`,
          created_by_sales_rep_id: rep.id, ...extra,
        },
        select: { id: true },
      });
      userIds.push(u.id);
      const a = await prisma.address.create({
        data: {
          user_id: u.id, contact_name: 'QA', contact_phone: '600000009',
          street_line_1: 'C/ Borrador 1', postcode: '28012', city: 'Madrid', province: 'Madrid',
        },
        select: { id: true },
      });
      return { id: u.id, addressId: a.id };
    };
    const retail = await makeClient('Retail');
    const wholesale = await makeClient('Wholesale', { is_business: true, pricing_mode: 'b2b' });
    const household = await makeClient('Household');
    await prisma.homeGroceryProfile.create({ data: { user_id: household.id, household_size: 2 } });

    const notices = (userId: string) => prisma.notification.count({ where: { user_id: userId } });
    const orderOf = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });
    /** subtotal = the lines, total = subtotal + fee — the books balance. */
    const balances = (o: Awaited<ReturnType<typeof orderOf>>) => {
      const lines = o.items.reduce((s, i) => s + cents(i.line_total), 0);
      return lines === cents(o.subtotal) && cents(o.subtotal) + cents(o.delivery_fee) === cents(o.total);
    };

    /** Built straight in the database, for kinds no route makes today. */
    const insertDraft = async (
      clientId: string, addressId: string,
      lines: Array<{ v: P; qty: number }>,
      by: { created_by_admin_id?: string; created_by_sales_rep_id?: string; rashan_subscription_id?: string },
    ) => {
      const subtotal = lines.reduce((s, l) => s.plus(l.v.price.mul(l.qty)), new Prisma.Decimal(0));
      const o = await prisma.order.create({
        data: {
          order_number: generateOrderNumber(),
          user_id: clientId, address_id: addressId,
          address_snapshot: {} as Prisma.InputJsonValue,
          payment_method: 'cod', status: 'draft',
          subtotal, delivery_fee: new Prisma.Decimal(0), total: subtotal,
          ...by,
          items: {
            create: lines.map((l) => ({
              product_id: l.v.productId, variant_id: l.v.variantId, quantity: l.qty,
              unit_price: l.v.price, line_total: l.v.price.mul(l.qty), tax_rate_pct: 0,
              product_snapshot: { name_es: l.v.name, name_en: l.v.name } as Prisma.InputJsonValue,
            })),
          },
        },
        include: { items: { orderBy: { id: 'asc' } } },
      });
      orderIds.push(o.id);
      return o;
    };
    /** Built the way a rep builds one: their create route, saved as a draft. */
    const repDraftVia = async (clientId: string, addressId: string, items: Array<{ variant_id: string; quantity: number }>) => {
      const r = await call('/api/sales/orders', {
        method: 'POST', token: rep.token,
        body: { user_id: clientId, address_id: addressId, items, status: 'draft' },
      });
      const id = r.body.data?.order?.id as string | undefined;
      if (id) orderIds.push(id);
      return { r, id };
    };

    // ═══ 1. Staff edit a small rep draft ══════════════════════
    console.log('\n  — staff, small draft —');
    const d1 = await insertDraft(retail.id, retail.addressId, [{ v: A, qty: 2 }, { v: B, qty: 1 }], { created_by_sales_rep_id: rep.id });
    const d1A = d1.items.find((i) => i.variant_id === A.variantId)!;
    const r1 = await call(`/api/admin/orders/${d1.id}/items`, {
      method: 'PUT', token: adminToken,
      body: { operations: [{ action: 'update_qty', order_item_id: d1A.id, new_quantity: 4 }] },
    });
    check('staff change a rep\'s draft: accepted', r1.status === 200, r1.body);
    let o1 = await orderOf(d1.id);
    check('it is still a draft, with the new quantity', o1.status === 'draft' && o1.items.find((i) => i.id === d1A.id)?.quantity === 4);
    check('subtotal and total follow (4 × 2.00 + 1 × 3.00 = 11.00)', cents(o1.total) === 1100 && balances(o1), { subtotal: o1.subtotal, total: o1.total });
    check('no stock moved', (await stockOf(A.variantId)) === 5 && (await stockOf(B.variantId)) === 10);
    const log1 = await prisma.orderEditLog.findFirst({ where: { order_id: d1.id }, select: { editor_type: true, editor_admin_id: true } });
    check('the edit is logged against the admin', log1?.editor_type === 'admin' && log1.editor_admin_id === admin.id, log1);

    const r1b = await call(`/api/admin/orders/${d1.id}/items`, {
      method: 'PUT', token: adminToken,
      body: { operations: [{ action: 'update_qty', order_item_id: d1A.id, new_quantity: 6 }] },
    });
    check('raising past stock is refused, counting the whole draft (need 6, have 5)',
      r1b.status === 400 && /need 6, have 5/.test(r1b.body.error ?? ''), r1b.body);

    const r1c = await call(`/api/admin/orders/${d1.id}/items`, {
      method: 'PUT', token: adminToken,
      body: { operations: [{ action: 'add', new_variant_id: B.variantId, new_quantity: 9 }] },
    });
    check('adding up to exactly what is in stock (1 + 9 of 10): accepted', r1c.status === 200, r1c.body);
    const r1d = await call(`/api/admin/orders/${d1.id}/delivery-fee`, { method: 'PUT', token: adminToken, body: { delivery_fee: 4.5 } });
    check('staff set the delivery fee on the draft (38.00 + 4.50)', r1d.status === 200 && cents(r1d.body.data?.total) === 4250, r1d.body);
    check('still no stock moved', (await stockOf(A.variantId)) === 5 && (await stockOf(B.variantId)) === 10);
    await wait(600);
    check('the client was told nothing', (await notices(retail.id)) === 0, await notices(retail.id));

    const r1e = await call(`/api/admin/orders/${d1.id}/confirm-stock`, { method: 'POST', token: adminToken });
    check('confirming the stock places it', r1e.status === 200 && r1e.body.data?.status === 'pending', r1e.body);
    check('...taking the EDITED quantities (A 5 → 1, B 10 → 0)', (await stockOf(A.variantId)) === 1 && (await stockOf(B.variantId)) === 0);
    await setStock(A.variantId, 5); await setStock(B.variantId, 10);

    // ═══ 2. The rep edits their own draft, in their panel ═════
    console.log('\n  — rep, their own draft —');
    const { r: c2, id: d2 } = await repDraftVia(retail.id, retail.addressId, [
      { variant_id: A.variantId, quantity: 2 }, { variant_id: B.variantId, quantity: 2 }, { variant_id: C.variantId, quantity: 4 },
    ]);
    check('the rep saves a draft through their create route', c2.status === 201 && !!d2, c2.body);
    if (!d2) throw new Error('no rep draft');
    let o2 = await orderOf(d2);
    check('...a draft that took no stock', o2.status === 'draft' && (await stockOf(A.variantId)) === 5);
    /** What this client had heard before any of this — the confirm above told them about that order. */
    const heardBefore = await notices(retail.id);
    /** The fee the draft was built with; an edit leaves it alone. */
    const builtFee = cents(o2.delivery_fee);
    const l2 = (vid: string) => o2.items.find((i) => i.variant_id === vid)!;
    const r2 = await call(`/api/sales/orders/${d2}/items`, {
      method: 'PUT', token: rep.token,
      body: {
        operations: [
          { action: 'update_qty', order_item_id: l2(A.variantId).id, new_quantity: 3 },
          { action: 'set_discount', order_item_id: l2(A.variantId).id, unit_discount: 0.5 },
          { action: 'replace', order_item_id: l2(B.variantId).id, new_variant_id: D.variantId, new_quantity: 2 },
          { action: 'remove', order_item_id: l2(C.variantId).id },
          { action: 'add', new_variant_id: C.variantId, new_quantity: 6 },
        ],
        note: 'QA rep draft edit',
      },
    });
    check('the rep edits their draft — change, discount, swap, remove, add in one save', r2.status === 200, r2.body);
    o2 = await orderOf(d2);
    // A 3 × (2.00 − 0.50) = 4.50 · D 2 × 4.00 = 8.00 · C 6 × 1.50 = 9.00
    check('the lines are what was asked (A×3 at 0.50 off, D×2, C×6; no B)',
      o2.items.length === 3
      && o2.items.find((i) => i.variant_id === A.variantId)?.quantity === 3
      && cents(o2.items.find((i) => i.variant_id === A.variantId)?.unit_discount) === 50
      && o2.items.find((i) => i.variant_id === D.variantId)?.quantity === 2
      && o2.items.find((i) => i.variant_id === C.variantId)?.quantity === 6
      && !o2.items.some((i) => i.variant_id === B.variantId),
      o2.items.map((i) => [i.variant_id.slice(0, 6), i.quantity, String(i.unit_discount)]));
    check('...and the subtotal is theirs (4.50 + 8.00 + 9.00 = 21.50), the fee left as built',
      cents(o2.subtotal) === 2150 && cents(o2.delivery_fee) === builtFee && balances(o2), { subtotal: o2.subtotal, fee: o2.delivery_fee, total: o2.total });
    check('no stock moved for any of them',
      (await stockOf(A.variantId)) === 5 && (await stockOf(B.variantId)) === 10
      && (await stockOf(C.variantId)) === 50 && (await stockOf(D.variantId)) === 50);
    const log2 = await prisma.orderEditLog.count({ where: { order_id: d2, editor_type: 'sales_rep', editor_sales_rep_id: rep.id } });
    // Five rows: the quantity and the discount on A, the swap, the removal, the add.
    check('every change is logged against the rep', log2 === 5, log2);
    const f2 = await call(`/api/sales/orders/${d2}/delivery-fee`, { method: 'PUT', token: rep.token, body: { delivery_fee: 3 } });
    check('the rep sets the delivery fee on their draft', f2.status === 200 && cents(f2.body.data?.total) === 2450, f2.body);
    const x2 = await call(`/api/sales/orders/${d2}/items`, {
      method: 'PUT', token: otherRep.token,
      body: { operations: [{ action: 'update_qty', order_item_id: o2.items[0].id, new_quantity: 1 }] },
    });
    check('another rep cannot touch it', x2.status === 404, x2.body);
    await wait(600);
    check('the client was told nothing about the edit or the fee', (await notices(retail.id)) === heardBefore, { before: heardBefore, now: await notices(retail.id) });
    const k2 = await call(`/api/sales/orders/${d2}/confirm-stock`, { method: 'POST', token: rep.token });
    check('the rep confirms its stock and it is placed', k2.status === 200 && k2.body.data?.status === 'pending', k2.body);
    check('...taking what the edit left (A 5 → 2, C 50 → 44, D 50 → 48, B untouched)',
      (await stockOf(A.variantId)) === 2 && (await stockOf(C.variantId)) === 44
      && (await stockOf(D.variantId)) === 48 && (await stockOf(B.variantId)) === 10);
    o2 = await orderOf(d2);
    check('...at the edited prices (21.50 + 3.00 fee)', cents(o2.total) === 2450 && balances(o2), { total: o2.total });
    // And now it is an ordinary placed order: the same screen edits it, with stock.
    const p2 = await call(`/api/sales/orders/${d2}/items`, {
      method: 'PUT', token: rep.token,
      body: { operations: [{ action: 'update_qty', order_item_id: o2.items.find((i) => i.variant_id === C.variantId)!.id, new_quantity: 5 }] },
    });
    check('once placed, an edit moves stock as it always did (C 44 → 45)', p2.status === 200 && (await stockOf(C.variantId)) === 45, p2.body);
    for (const v of [A, C, D]) await setStock(v.variantId, v === A ? 5 : 50);

    // ═══ 3. Wholesale client ══════════════════════════════════
    console.log('\n  — wholesale draft —');
    const { r: c3, id: d3 } = await repDraftVia(wholesale.id, wholesale.addressId, [{ variant_id: A.variantId, quantity: 1 }]);
    check('a draft for a wholesale client', c3.status === 201 && !!d3, c3.body);
    if (!d3) throw new Error('no wholesale draft');
    const r3 = await call(`/api/sales/orders/${d3}/items`, {
      method: 'PUT', token: rep.token,
      body: { operations: [{ action: 'add', new_variant_id: C.variantId, new_quantity: 10 }] },
    });
    const o3 = await orderOf(d3);
    check('a product added to it is priced wholesale (1.20, not 1.50)',
      r3.status === 200 && cents(o3.items.find((i) => i.variant_id === C.variantId)?.unit_price) === 120, { status: r3.status, items: o3.items.map((i) => String(i.unit_price)) });

    // ═══ 4. The same product on two lines ═════════════════════
    console.log('\n  — same product twice —');
    const d4 = await insertDraft(retail.id, retail.addressId, [{ v: A, qty: 2 }, { v: A, qty: 2 }], { created_by_admin_id: admin.id });
    const r4a = await call(`/api/admin/orders/${d4.id}/items`, {
      method: 'PUT', token: adminToken,
      body: { operations: [{ action: 'update_qty', order_item_id: d4.items[0].id, new_quantity: 3 }] },
    });
    check('raising one of two lines of A to 5 in all, with 5 in stock: accepted', r4a.status === 200, r4a.body);
    const r4b = await call(`/api/admin/orders/${d4.id}/items`, {
      method: 'PUT', token: adminToken,
      body: { operations: [{ action: 'update_qty', order_item_id: d4.items[1].id, new_quantity: 3 }] },
    });
    check('raising the other to 6 in all is refused (need 6, have 5)', r4b.status === 400 && /need 6, have 5/.test(r4b.body.error ?? ''), r4b.body);

    // ═══ 5. Home Grocery ══════════════════════════════════════
    console.log('\n  — Home Grocery drafts —');
    const { r: c5, id: d5 } = await repDraftVia(household.id, household.addressId, [{ variant_id: A.variantId, quantity: 1 }, { variant_id: B.variantId, quantity: 1 }]);
    check('a rep saves a draft for a Home Grocery household', c5.status === 201 && !!d5, c5.body);
    if (!d5) throw new Error('no HG draft');
    let o5 = await orderOf(d5);
    check('...and it is a Home Grocery order', !!o5.rashan_subscription_id, o5.rashan_subscription_id);
    const r5 = await call(`/api/sales/orders/${d5}/items`, {
      method: 'PUT', token: rep.token,
      body: { operations: [{ action: 'update_qty', order_item_id: o5.items.find((i) => i.variant_id === A.variantId)!.id, new_quantity: 3 }] },
    });
    check('the rep edits the Home Grocery draft', r5.status === 200, r5.body);
    const r5s = await call(`/api/admin/orders/${d5}/items`, {
      method: 'PUT', token: adminToken,
      body: { operations: [{ action: 'add', new_variant_id: D.variantId, new_quantity: 1 }] },
    });
    check('so do staff', r5s.status === 200, r5s.body);
    // Prices move before anybody confirms it.
    await prisma.productVariant.update({ where: { id: A.variantId }, data: { price: new Prisma.Decimal('2.40') } });
    const k5 = await call(`/api/admin/orders/${d5}/confirm-stock`, { method: 'POST', token: adminToken });
    o5 = await orderOf(d5);
    check('confirming keeps what was edited — A×3 at 2.00, D×1, B×1 (14.00), not re-priced',
      k5.status === 200 && o5.status === 'pending' && o5.items.length === 3
      && o5.items.find((i) => i.variant_id === A.variantId)?.quantity === 3
      && cents(o5.items.find((i) => i.variant_id === A.variantId)?.unit_price) === 200
      && cents(o5.subtotal) === 1300 && balances(o5),
      { status: k5.status, subtotal: o5.subtotal, items: o5.items.map((i) => [i.quantity, String(i.unit_price)]) });
    await setStock(A.variantId, 5); await setStock(B.variantId, 10); await setStock(D.variantId, 50);

    const planId = o5.rashan_subscription_id!;
    // A draft the old plan made: no creator, only the plan.
    const d6 = await insertDraft(household.id, household.addressId, [{ v: B, qty: 2 }], { rashan_subscription_id: planId });
    const r6 = await call(`/api/admin/orders/${d6.id}/items`, {
      method: 'PUT', token: adminToken,
      body: { operations: [{ action: 'update_qty', order_item_id: d6.items[0].id, new_quantity: 3 }] },
    });
    check('staff edit a draft the old plan made', r6.status === 200, r6.body);
    const x6 = await call(`/api/sales/orders/${d6.id}/items`, {
      method: 'PUT', token: rep.token,
      body: { operations: [{ action: 'update_qty', order_item_id: d6.items[0].id, new_quantity: 1 }] },
    });
    check('a rep cannot — they did not build it', x6.status === 404, x6.body);
    await prisma.productVariant.update({ where: { id: B.variantId }, data: { price: new Prisma.Decimal('3.30') } });
    await call(`/api/admin/orders/${d6.id}/confirm-stock`, { method: 'POST', token: adminToken });
    const o6 = await orderOf(d6.id);
    check('confirming it keeps the edit: 3 at 3.00, not re-priced to 3.30',
      o6.status === 'pending' && o6.items[0].quantity === 3 && cents(o6.items[0].unit_price) === 300, o6.items.map((i) => [i.quantity, String(i.unit_price)]));
    // One nobody touched is still brought up to today's price, as before.
    const d7 = await insertDraft(household.id, household.addressId, [{ v: B, qty: 1 }], { rashan_subscription_id: planId });
    await call(`/api/admin/orders/${d7.id}/confirm-stock`, { method: 'POST', token: adminToken });
    const o7 = await orderOf(d7.id);
    check('an old plan draft nobody edited is still re-priced on confirm (3.30)', cents(o7.items[0].unit_price) === 330, o7.items.map((i) => String(i.unit_price)));
    await prisma.productVariant.update({ where: { id: A.variantId }, data: { price: new Prisma.Decimal('2.00') } });
    await prisma.productVariant.update({ where: { id: B.variantId }, data: { price: new Prisma.Decimal('3.00') } });
    await setStock(B.variantId, 10);

    // ═══ 6. Big draft, edited in one request ══════════════════
    console.log(`\n  — big draft: ${BIG_LINES} lines —`);
    const lines = big.slice(0, BIG_LINES);
    const spares = big.slice(BIG_LINES);
    const { r: c8, id: d8 } = await repDraftVia(retail.id, retail.addressId, lines.map((v) => ({ variant_id: v.variantId, quantity: 2 })));
    check(`the rep saves a ${BIG_LINES}-line draft`, c8.status === 201 && !!d8, { status: c8.status, error: c8.body.error });
    if (!d8) throw new Error('no big draft');
    const o8 = await orderOf(d8);
    const lineOf = new Map(o8.items.map((i) => [i.variant_id, i.id]));
    const ops = [
      ...lines.slice(0, 150).map((v) => ({ action: 'update_qty', order_item_id: lineOf.get(v.variantId)!, new_quantity: 3 })),
      ...lines.slice(150, 200).map((v) => ({ action: 'remove', order_item_id: lineOf.get(v.variantId)! })),
      ...lines.slice(200, 250).map((v) => ({ action: 'set_discount', order_item_id: lineOf.get(v.variantId)!, unit_discount: 0.1 })),
      ...spares.map((v) => ({ action: 'add', new_variant_id: v.variantId, new_quantity: 4 })),
    ];
    const r8 = await call(`/api/sales/orders/${d8}/items`, { method: 'PUT', token: rep.token, body: { operations: ops } });
    console.log(`        ${ops.length} operations in ${r8.ms} ms`);
    check(`all ${ops.length} changes save in one request`, r8.status === 200, { status: r8.status, error: r8.body.error });
    check('...well inside the 8 s budget', r8.ms < 8000, { ms: r8.ms });
    const e8 = await orderOf(d8);
    // 150 × 3 + 50 × (2 − 0.20) + 50 × 2 + 20 × 4, all at 1.00
    check(`${BIG_LINES - 50 + BIG_SPARES} lines, totalling 720.00, and the books balance`,
      e8.items.length === BIG_LINES - 50 + BIG_SPARES && cents(e8.subtotal) === 72000 && balances(e8),
      { lines: e8.items.length, subtotal: e8.subtotal });
    const want = new Map<string, number>();
    lines.slice(0, 150).forEach((v) => want.set(v.variantId, 3));
    lines.slice(200, 300).forEach((v) => want.set(v.variantId, 2));
    spares.forEach((v) => want.set(v.variantId, 4));
    const wrongQty = e8.items.filter((i) => want.get(i.variant_id) !== i.quantity);
    check('every line holds its new quantity', wrongQty.length === 0, wrongQty.slice(0, 3).map((i) => [i.variant_id, i.quantity]));
    const bigStock = await prisma.productVariant.findMany({ where: { id: { in: big.map((v) => v.variantId) } }, select: { id: true, stock_quantity: true } });
    check(`no stock moved on any of the ${big.length} products`, bigStock.every((v) => v.stock_quantity === 10),
      bigStock.filter((v) => v.stock_quantity !== 10).slice(0, 3));
    const k8 = await call(`/api/sales/orders/${d8}/confirm-stock`, { method: 'POST', token: rep.token });
    const afterK8 = new Map((await prisma.productVariant.findMany({ where: { id: { in: big.map((v) => v.variantId) } }, select: { id: true, stock_quantity: true } })).map((v) => [v.id, v.stock_quantity]));
    const wrongTaken = big.filter((v) => afterK8.get(v.variantId) !== 10 - (want.get(v.variantId) ?? 0));
    check('confirming takes exactly what each edited line holds, and nothing for removed ones',
      k8.status === 200 && wrongTaken.length === 0,
      { status: k8.status, wrong: wrongTaken.slice(0, 3).map((v) => [v.variantId, afterK8.get(v.variantId)]) });

    // ═══ 7. The customer's own draft ══════════════════════════
    console.log('\n  — the customer\'s own draft —');
    const me = await prisma.user.findUniqueOrThrow({ where: { id: retail.id }, select: { email: true } });
    const customerToken = generateAccessToken({ userId: retail.id, email: me.email ?? undefined });
    // What their checkout parks when stock is short: no creator, Cesto's own shop.
    const d9 = await insertDraft(retail.id, retail.addressId, [{ v: A, qty: 3 }, { v: B, qty: 2 }], {});
    const heard9 = await notices(retail.id);
    const r9 = await call(`/api/orders/${d9.id}/items`, {
      method: 'PUT', token: customerToken,
      body: {
        operations: [
          { action: 'update_qty', order_item_id: d9.items.find((i) => i.variant_id === A.variantId)!.id, new_quantity: 1 },
          { action: 'add', new_variant_id: C.variantId, new_quantity: 2 },
        ],
      },
    });
    let o9 = await orderOf(d9.id);
    check('the customer edits a draft their checkout made', r9.status === 200, r9.body);
    // A 1 × 2.00 + B 2 × 3.00 + C 2 × 1.50 = 11.00
    check('...it stays a draft, totalled afresh (11.00), and no stock moved',
      o9.status === 'draft' && cents(o9.subtotal) === 1100 && balances(o9)
      && (await stockOf(A.variantId)) === 5 && (await stockOf(C.variantId)) === 50, { status: o9.status, subtotal: o9.subtotal });
    const log9 = await prisma.orderEditLog.count({ where: { order_id: d9.id, editor_type: 'customer', editor_customer_id: retail.id } });
    check('...logged as theirs', log9 === 2, log9);
    const r9b = await call(`/api/orders/${d9.id}/items`, {
      method: 'PUT', token: customerToken,
      body: { operations: [{ action: 'update_qty', order_item_id: d9.items.find((i) => i.variant_id === A.variantId)!.id, new_quantity: 6 }] },
    });
    check('raising a line past stock is refused for them too (need 6, have 5)',
      r9b.status === 409 && /asked for 6, 5 left/.test(r9b.body.error ?? ''), r9b.body);
    const n9 = await call(`/api/orders/${d9.id}/notes`, { method: 'PUT', token: customerToken, body: { customer_notes: 'Timbre 2B' } });
    check('they can change its note', n9.status === 200, n9.body);
    await wait(600);
    check('...and are not sent a notice about their own change', (await notices(retail.id)) === heard9, { before: heard9, now: await notices(retail.id) });
    const x9 = await call(`/api/admin/orders/${d9.id}/items`, {
      method: 'PUT', token: adminToken,
      body: { operations: [{ action: 'update_qty', order_item_id: o9.items[0].id, new_quantity: 1 }] },
    });
    check('staff do not edit a customer\'s own draft', x9.status === 400, x9.body);
    const f9 = await call(`/api/admin/orders/${d9.id}/delivery-fee`, { method: 'PUT', token: adminToken, body: { delivery_fee: 3 } });
    check('...nor set its delivery fee', f9.status === 422, f9.body);
    const teamDraft = await insertDraft(retail.id, retail.addressId, [{ v: A, qty: 1 }], { created_by_sales_rep_id: rep.id });
    const y9 = await call(`/api/orders/${teamDraft.id}/items`, {
      method: 'PUT', token: customerToken,
      body: { operations: [{ action: 'update_qty', order_item_id: teamDraft.items[0].id, new_quantity: 2 }] },
    });
    check('a customer cannot edit a draft their rep is still building', y9.status === 422, y9.body);

    // ═══ 8. A draft emptied is cancelled ══════════════════════
    console.log('\n  — emptying a draft —');
    o9 = await orderOf(d9.id);
    const linesBefore = o9.items.length;
    const e9 = await call(`/api/orders/${d9.id}/items`, {
      method: 'PUT', token: customerToken,
      body: { operations: o9.items.map((i) => ({ action: 'remove', order_item_id: i.id })) },
    });
    o9 = await orderOf(d9.id);
    check('the customer removes every line: their draft is cancelled, and the answer says so',
      e9.status === 200 && e9.body.data?.draftCancelled === true && o9.status === 'cancelled', { status: e9.status, body: e9.body.data?.draftCancelled, order: o9.status });
    check('...saying why, keeping what it held, moving no stock',
      o9.cancelled_reason === EMPTIED_DRAFT_REASON && o9.items.length === linesBefore
      && (await stockOf(A.variantId)) === 5 && (await stockOf(B.variantId)) === 10 && (await stockOf(C.variantId)) === 50,
      { reason: o9.cancelled_reason, lines: o9.items.length });

    const d10 = await insertDraft(retail.id, retail.addressId, [{ v: A, qty: 1 }], { created_by_sales_rep_id: rep.id });
    const r10 = await call(`/api/sales/orders/${d10.id}/items`, {
      method: 'PUT', token: rep.token,
      body: { operations: [{ action: 'remove', order_item_id: d10.items[0].id }] },
    });
    const o10 = await orderOf(d10.id);
    check('the rep removes the only line of a one-line draft: it is cancelled',
      r10.status === 200 && r10.body.data?.draftCancelled === true && o10.status === 'cancelled' && o10.cancelled_reason === EMPTIED_DRAFT_REASON,
      { status: r10.status, order: o10.status });
    const d11 = await insertDraft(retail.id, retail.addressId, [{ v: A, qty: 1 }, { v: B, qty: 1 }], { created_by_admin_id: admin.id });
    const r11 = await call(`/api/admin/orders/${d11.id}/items`, {
      method: 'PUT', token: adminToken,
      body: { operations: d11.items.map((i) => ({ action: 'remove', order_item_id: i.id })) },
    });
    check('staff empty a two-line draft: it is cancelled',
      r11.status === 200 && r11.body.data?.draftCancelled === true && (await orderOf(d11.id)).status === 'cancelled', r11.body);
    const heard12 = await notices(retail.id);
    await wait(600);
    check('the client was told nothing about drafts our team emptied', (await notices(retail.id)) === heard12);
    // An emptied draft changes nothing about removing AND adding in one save.
    const d12 = await insertDraft(retail.id, retail.addressId, [{ v: A, qty: 1 }], { created_by_admin_id: admin.id });
    const r12 = await call(`/api/admin/orders/${d12.id}/items`, {
      method: 'PUT', token: adminToken,
      body: { operations: [{ action: 'remove', order_item_id: d12.items[0].id }, { action: 'add', new_variant_id: B.variantId, new_quantity: 2 }] },
    });
    const o12 = await orderOf(d12.id);
    check('swapping the only line for another in one save keeps the draft',
      r12.status === 200 && !r12.body.data?.draftCancelled && o12.status === 'draft' && o12.items.length === 1, { status: o12.status, lines: o12.items.length });

    // ═══ 9. What stays closed ═════════════════════════════════
    console.log('\n  — what stays closed —');
    const { r: c13, id: d13 } = await repDraftVia(retail.id, retail.addressId, [{ variant_id: A.variantId, quantity: 1 }]);
    if (!d13) throw new Error('no order to place');
    await call(`/api/sales/orders/${d13}/confirm-stock`, { method: 'POST', token: rep.token });
    const o13 = await orderOf(d13);
    const r13 = await call(`/api/sales/orders/${d13}/items`, {
      method: 'PUT', token: rep.token,
      body: { operations: [{ action: 'remove', order_item_id: o13.items[0].id }] },
    });
    check('a PLACED order still cannot be emptied — cancel it instead',
      c13.status === 201 && o13.status === 'pending' && r13.status === 400 && /zero items/.test(r13.body.error ?? ''), { placed: o13.status, status: r13.status, error: r13.body.error });
    await setStock(A.variantId, 5);
    check('the rule: a draft from a checkout is not one our team edits',
      !isEditableDraft({ status: 'draft', created_by_admin_id: null, created_by_sales_rep_id: null, rashan_subscription_id: null }));
    check('stock of the small products is back where it started',
      (await stockOf(A.variantId)) === 5 && (await stockOf(B.variantId)) === 10
      && (await stockOf(C.variantId)) === 50 && (await stockOf(D.variantId)) === 50);
  } finally {
    // Notifications from the confirms are sent without waiting; let them land first.
    await wait(1500);
    if (orderIds.length) {
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderIdempotency.deleteMany({ where: { order_id: { in: orderIds } } }).catch(() => {});
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (userIds.length) {
      await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.customerProductDiscount.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.rashanSubscription.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.homeGroceryProfile.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.userRefreshToken.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (productIds.length) {
      await prisma.cartItem.deleteMany({ where: { variant: { product_id: { in: productIds } } } }).catch(() => {});
      await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (categoryId) await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});
    server.close();
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
