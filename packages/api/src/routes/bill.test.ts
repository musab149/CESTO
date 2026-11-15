// ─── Integration test · the Bill ────────────────────────
//
// Run:  cd packages/api && npm run test:bill
//
// 2026-10-27, the user: "along with albaran and facture we need an invoice
// that can be downloaded and it will not have any information related to
// customer other then his name and our company name that's it". Then, on
// 2026-11-04: "remove the information related to cesto from that".
//
// What has to hold (lib/bill):
//   · admin and rep get the same payload: the customer's name, number, date,
//     lines and totals — and not one other field, so no address, phone,
//     email or tax id can reach the PDF, and nothing of Cesto's either (no
//     company name, legal or brand);
//   · a line's unit price is what the customer pays for one (net of their
//     discount), so quantity × price is the line;
//   · no delivery fee yet reads as pending, not free;
//   · a split purchase is billed whole, by the parent's id or any part's, and
//     a deleted part drops out;
//   · a rep reads only the orders they built; anyone else is told nothing.
//
// Makes its own client, reps, product and orders, and deletes them afterwards.
import http from 'http';
import { Prisma } from '@prisma/client';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAccessToken, generateAdminAccessToken } from '../lib/jwt';
import { generateOrderNumber } from '../lib/pagination';
import { generateParentOrderNumber } from '../lib/parentOrder';
import { getInvoicingSettings } from '../lib/invoicing';

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
const BILL_KEYS = ['customer', 'date', 'delivery_fee', 'delivery_pending', 'lines', 'order_number', 'recargo', 'subtotal', 'total'];

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const parentIds: string[] = [];
  let productId: string | null = null;

  const call = async (path: string, token?: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: await res.json().catch(() => null) as { success: boolean; error?: string; data?: any } };
  };

  try {
    // ─── Fixtures ────────────────────────────────────────────
    const category = await prisma.category.findFirst({ where: { is_active: true }, select: { id: true } });
    const admin = await prisma.admin.findFirst({ where: { role: 'super_admin' }, select: { id: true, email: true, role: true } });
    if (!category || !admin) { console.log('  SKIP  need a category and a super admin'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    const product = await prisma.product.create({
      data: {
        name_es: `QA Bill Arroz ${stamp}`, name_en: `QA Bill Rice ${stamp}`, category_id: category.id, is_active: true,
        variants: { create: [{ name_es: '5 kg', name_en: '5 kg', price: 5, stock_quantity: 50, is_default: true }] },
      },
      select: { id: true, variants: { select: { id: true } } },
    });
    productId = product.id;
    const variantId = product.variants[0].id;

    // A client with everything a bill must NOT print.
    const secrets = { email: `qa.bill.client.${stamp}@cesto.test`, phone: '611223344', tax_id: 'B12345678', street: `Calle Secreta ${stamp}` };
    const client = await prisma.user.create({
      data: { name: `QA Bill Client ${stamp}`, email: secrets.email, phone: secrets.phone, tax_id: secrets.tax_id },
      select: { id: true, name: true },
    });
    userIds.push(client.id);
    const address = await prisma.address.create({
      data: { user_id: client.id, contact_name: 'QA', contact_phone: secrets.phone, street_line_1: secrets.street, postcode: '28016', city: 'Madrid', province: 'Madrid' },
      select: { id: true },
    });
    const snapshot = { contact_name: 'QA', contact_phone: secrets.phone, street_line_1: secrets.street, postcode: '28016', city: 'Madrid' };

    const grant = async (label: string) => {
      const email = `qa.bill.rep.${label}.${stamp}@cesto.test`;
      const r = await call('/api/admin/sales-reps', adminToken, { method: 'POST', body: { name: `QA Bill Rep ${label}`, email, send_credentials: false, store_ids: [] } });
      const id = r.body.data?.user_id as string;
      if (id) userIds.push(id);
      return { id, token: generateAccessToken({ userId: id, email }), status: r.status };
    };
    const repA = await grant('a');
    const repB = await grant('b');
    check('two reps are granted', repA.status === 201 && repB.status === 201, [repA.status, repB.status]);

    const snap = { name_es: `QA Bill Arroz ${stamp}`, name_en: `QA Bill Rice ${stamp}`, variant_name_es: '5 kg', variant_name_en: '5 kg' };
    const line = (qty: number, price: string, unitDiscount?: string) => {
      const net = new Prisma.Decimal(price).sub(unitDiscount ?? 0);
      return {
        product_id: product.id, variant_id: variantId, product_snapshot: snap, quantity: qty,
        unit_price: new Prisma.Decimal(price),
        ...(unitDiscount ? { unit_discount: new Prisma.Decimal(unitDiscount), discount_amount: new Prisma.Decimal(unitDiscount).mul(qty) } : {}),
        line_total: net.mul(qty),
      };
    };

    // Order 1: built by rep A, no fee yet, one line discounted.
    const o1 = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(), user_id: client.id, address_id: address.id, address_snapshot: snapshot,
        status: 'pending', payment_method: 'cod', created_by_sales_rep_id: repA.id,
        subtotal: new Prisma.Decimal('21.00'), delivery_fee: new Prisma.Decimal(0), total: new Prisma.Decimal('21.00'),
        items: { create: [line(3, '4.00'), line(2, '5.00', '0.50')] },
      },
      select: { id: true, order_number: true },
    });
    orderIds.push(o1.id);

    // A split purchase: two parts, a fee set.
    const parent = await prisma.parentOrder.create({
      data: {
        order_number: generateParentOrderNumber(), user_id: client.id, address_id: address.id, payment_method: 'cod',
        address_snapshot: snapshot,
        subtotal: new Prisma.Decimal('12.00'), delivery_fee_total: new Prisma.Decimal('3.50'), total: new Prisma.Decimal('15.50'),
      },
      select: { id: true, order_number: true },
    });
    parentIds.push(parent.id);
    const parts: string[] = [];
    for (const qty of [1, 2]) {
      const sub = await prisma.order.create({
        data: {
          order_number: generateOrderNumber(), user_id: client.id, address_id: address.id, address_snapshot: snapshot,
          status: 'pending', payment_method: 'cod', parent_order_id: parent.id,
          subtotal: new Prisma.Decimal(4 * qty), delivery_fee: new Prisma.Decimal(0), total: new Prisma.Decimal(4 * qty),
          items: { create: [line(qty, '4.00')] },
        },
        select: { id: true },
      });
      orderIds.push(sub.id);
      parts.push(sub.id);
    }

    // Whatever our legal name is set to, it must not be on the bill.
    const legalName = (await getInvoicingSettings()).legal_name.trim();

    // ─── 1. An order's bill, for the admin ──────────────────
    const a1 = await call(`/api/admin/orders/${o1.id}/bill`, adminToken);
    const bill = a1.body.data;
    check('admin: 200 with exactly the bill\'s fields', a1.status === 200 && JSON.stringify(Object.keys(bill ?? {}).sort()) === JSON.stringify(BILL_KEYS), Object.keys(bill ?? {}));
    check('...the customer\'s name', bill?.customer === client.name, { customer: bill?.customer });
    const raw = JSON.stringify(a1.body);
    check('...and none of the customer\'s address, phone, email or tax id',
      !raw.includes(secrets.street) && !raw.includes(secrets.phone) && !raw.includes(secrets.email) && !raw.includes(secrets.tax_id));
    check('...and nothing of Cesto\'s: no company name, legal or brand',
      !('company' in (bill ?? {})) && !/cesto/i.test(raw) && (legalName === '' || !raw.includes(legalName)), { legalName });
    check('...the order\'s number', bill?.order_number === o1.order_number);
    // Lines come in the order page's order (by id), so find them by quantity.
    const lines = (bill?.lines ?? []) as { quantity: number; unit_price: string; line_total: string; name_es: string; variant_es: string | null }[];
    const plain = lines.find((l) => l.quantity === 3);
    const disc = lines.find((l) => l.quantity === 2);
    check('a plain line: 3 × 4.00 = 12.00, named with its size', plain?.quantity === 3 && plain?.unit_price === '4.00' && plain?.line_total === '12.00' && plain?.name_es === snap.name_es && plain?.variant_es === '5 kg', plain);
    check('a discounted line prints what one unit costs them: 2 × 4.50 = 9.00', disc?.quantity === 2 && disc?.unit_price === '4.50' && disc?.line_total === '9.00', disc);
    check('no fee yet is pending, not free; the totals are the order\'s',
      bill?.delivery_pending === true && bill?.delivery_fee === '0.00' && bill?.subtotal === '21.00' && bill?.total === '21.00', bill);

    // ─── 2. The rep's ───────────────────────────────────────
    const r1 = await call(`/api/sales/orders/${o1.id}/bill`, repA.token);
    check('rep A, who built it, gets the same bill', r1.status === 200 && JSON.stringify(r1.body.data) === JSON.stringify(bill), r1.status);
    const r2 = await call(`/api/sales/orders/${o1.id}/bill`, repB.token);
    check('rep B is told it does not exist', r2.status === 404, r2.status);
    const r3 = await call(`/api/sales/orders/${parent.id}/bill`, repA.token);
    check('a rep cannot reach a purchase by its parent id', r3.status === 404, r3.status);

    // ─── 3. A split purchase ────────────────────────────────
    const p1 = await call(`/api/admin/orders/${parent.id}/bill`, adminToken);
    check('a split purchase by its id: one bill, both parts\' lines, the fee set',
      p1.status === 200 && p1.body.data?.order_number === parent.order_number && p1.body.data?.lines?.length === 2
        && p1.body.data?.delivery_fee === '3.50' && p1.body.data?.delivery_pending === false && p1.body.data?.total === '15.50', p1.body.data);
    const p2 = await call(`/api/admin/orders/${parts[1]}/bill`, adminToken);
    check('...by a part\'s id, the same whole bill', p2.status === 200 && JSON.stringify(p2.body.data) === JSON.stringify(p1.body.data));
    await prisma.order.update({ where: { id: parts[0] }, data: { deleted_at: new Date() } });
    const p3 = await call(`/api/admin/orders/${parent.id}/bill`, adminToken);
    check('a deleted part drops out — its line and its money: 8.00 + 3.50 fee = 11.50',
      p3.body.data?.lines?.length === 1 && p3.body.data?.lines?.[0]?.quantity === 2
        && p3.body.data?.subtotal === '8.00' && p3.body.data?.total === '11.50', p3.body.data);

    // ─── 4. Nothing to bill ─────────────────────────────────
    const ghost = await call('/api/admin/orders/00000000-0000-0000-0000-000000000000/bill', adminToken);
    const junk = await call('/api/admin/orders/not-an-id/bill', adminToken);
    check('an unknown id, or one that is not an id, is a 404', ghost.status === 404 && junk.status === 404, [ghost.status, junk.status]);
    const anon = await call(`/api/admin/orders/${o1.id}/bill`);
    const anonRep = await call(`/api/sales/orders/${o1.id}/bill`);
    check('without a login, nothing', anon.status === 401 && anonRep.status === 401, [anon.status, anonRep.status]);
  } finally {
    if (orderIds.length) {
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (parentIds.length) await prisma.parentOrder.deleteMany({ where: { id: { in: parentIds } } });
    if (userIds.length) {
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.userRefreshToken.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (productId) {
      await prisma.productVariant.deleteMany({ where: { product_id: productId } });
      await prisma.product.delete({ where: { id: productId } });
    }
    server.close();
    await prisma.$disconnect();
    console.log(`\n${passed}/${passed + failed} passed`);
    process.exit(failed === 0 ? 0 : 1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
