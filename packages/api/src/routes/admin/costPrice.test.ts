// ─── Integration test · the buying price ────────────────
//
// Run:  cd packages/api && npm run test:cost-price
//
// 2026-10-27, the user: "we need to add the buying price for all the
// products... set the buying price to 0 by default... It will also show in
// the products table to admin but it wont show to the sales rep".
//
// What has to hold:
//   · a size's buying price defaults to 0; the admin sets it on create, in the
//     form (PUT) and in the bulk grid, and it is never negative;
//   · a save that does not mention it leaves it as it was;
//   · the admin product list and product read return it;
//   · nothing else does — the client omits it from every read (lib/prisma),
//     so the shop, the rep's catalogue and an order the rep builds never
//     carry the key at all.
//
// Makes its own product, rep and client, and deletes them afterwards.
import http from 'http';
import app from '../../server';
import prisma from '../../lib/prisma';
import { generateAccessToken, generateAdminAccessToken } from '../../lib/jwt';

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
const leaks = (body: unknown) => JSON.stringify(body ?? null).includes('cost_price');
type V = { id: string; name_es: string; cost_price?: number; price?: number };

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  let productId: string | null = null;

  const call = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: await res.json().catch(() => null) as { success: boolean; error?: string; data?: any } };
  };

  try {
    const category = await prisma.category.findFirst({ where: { is_active: true, approval_status: 'approved' }, select: { id: true } });
    const admin = await prisma.admin.findFirst({ where: { role: 'super_admin' }, select: { id: true, email: true, role: true } });
    if (!category || !admin) { console.log('  SKIP  need an approved category and a super admin'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    // ─── 1. Create: one size with a buying price, one without ─
    const name = `QA Cost Arroz ${stamp}`;
    const sizes = (extra: Partial<Record<'a' | 'b', object>> = {}, ids?: [string, string]) => [
      { ...(ids ? { id: ids[0] } : {}), name_es: '1 kg', name_en: '1 kg', price: 3, stock_quantity: 40, is_default: true, ...extra.a },
      { ...(ids ? { id: ids[1] } : {}), name_es: '5 kg', name_en: '5 kg', price: 12, stock_quantity: 40, ...extra.b },
    ];
    const productBody = (variants: object[]) => ({
      name_es: name, name_en: name, category_id: category.id, is_active: true, variants, images: [],
    });
    const made = await call('/api/admin/products', { method: 'POST', token: adminToken, body: productBody(sizes({ a: { cost_price: 1.25 } })) });
    productId = made.body.data?.id ?? null;
    const madeV = (made.body.data?.variants ?? []) as V[];
    const v1 = madeV.find((v) => v.name_es === '1 kg');
    const v5 = madeV.find((v) => v.name_es === '5 kg');
    check('admin creates a product: 1.25 where given, 0 by default', made.status === 201 && v1?.cost_price === 1.25 && v5?.cost_price === 0, { status: made.status, error: made.body.error, v1: v1?.cost_price, v5: v5?.cost_price });
    if (!productId || !v1 || !v5) throw new Error('no product');
    const ids: [string, string] = [v1.id, v5.id];

    // ─── 2. The admin reads it ──────────────────────────────
    const one = await call(`/api/admin/products/${productId}`, { token: adminToken });
    check('admin product read carries it', (one.body.data?.variants as V[])?.find((v) => v.id === v1.id)?.cost_price === 1.25);
    const list = await call(`/api/admin/products?q=${encodeURIComponent(name)}`, { token: adminToken });
    const row = (list.body.data?.items ?? [])[0];
    check('admin products list (the table) carries it per size', (row?.variants as V[])?.some((v) => v.cost_price === 1.25) && (row?.variants as V[])?.some((v) => v.cost_price === 0), row?.variants);

    // ─── 3. Saves ───────────────────────────────────────────
    const keep = await call(`/api/admin/products/${productId}`, { method: 'PUT', token: adminToken, body: productBody(sizes({}, ids)) });
    check('a form save that does not send it leaves it as it was', keep.status === 200 && (keep.body.data?.variants as V[])?.find((v) => v.id === v1.id)?.cost_price === 1.25, { status: keep.status, error: keep.body.error });
    const set = await call(`/api/admin/products/${productId}`, { method: 'PUT', token: adminToken, body: productBody(sizes({ b: { cost_price: 9.4 } }, ids)) });
    check('a form save sets it', (set.body.data?.variants as V[])?.find((v) => v.id === v5.id)?.cost_price === 9.4, set.body.error);
    const neg = await call(`/api/admin/products/${productId}`, { method: 'PUT', token: adminToken, body: productBody(sizes({ a: { cost_price: -1 } }, ids)) });
    check('a negative buying price is refused', neg.status === 422, neg.status);
    const bulk = await call('/api/admin/products/bulk', { method: 'POST', token: adminToken, body: { items: [{ id: productId, variants: [{ id: v1.id, cost_price: 1.5 }] }] } });
    const afterBulk = await prisma.productVariant.findUnique({ where: { id: v1.id }, select: { cost_price: true } });
    check('the bulk grid sets it', bulk.status === 200 && Number(afterBulk?.cost_price) === 1.5, { status: bulk.status, error: bulk.body.error, cost: afterBulk?.cost_price });

    // ─── 4. Nobody else ─────────────────────────────────────
    const plain = await prisma.productVariant.findUnique({ where: { id: v1.id } });
    check('the client leaves it out of a read that does not ask', !!plain && !('cost_price' in plain), plain && Object.keys(plain));
    const shopList = await call(`/api/products?q=${encodeURIComponent(name)}`);
    const shopOne = await call(`/api/products/${productId}`);
    check('the shop: list and product page carry no buying price', shopList.status === 200 && shopOne.status === 200 && !leaks(shopList.body) && !leaks(shopOne.body), { list: shopList.status, one: shopOne.status });

    const repEmail = `qa.cost.rep.${stamp}@cesto.test`;
    const granted = await call('/api/admin/sales-reps', { method: 'POST', token: adminToken, body: { name: 'QA Cost Rep', email: repEmail, send_credentials: false, store_ids: [] } });
    const repId = granted.body.data?.user_id as string;
    if (repId) userIds.push(repId);
    await call(`/api/admin/sales-reps/${repId}/products`, { method: 'POST', token: adminToken, body: { product_ids: [productId] } });
    const repToken = generateAccessToken({ userId: repId, email: repEmail });
    const cat = await call(`/api/sales/catalogue/products?q=${encodeURIComponent(name)}&limit=10`, { token: repToken });
    const catOne = await call(`/api/sales/catalogue/products?productId=${productId}`, { token: repToken });
    check('the rep: their catalogue lists it, with no buying price', cat.status === 200 && (cat.body.data?.items ?? []).length === 1 && !leaks(cat.body) && !leaks(catOne.body), { status: cat.status, n: (cat.body.data?.items ?? []).length });

    const client = await prisma.user.create({ data: { name: `QA Cost Client ${stamp}`, email: `qa.cost.client.${stamp}@cesto.test`, created_by_sales_rep_id: repId }, select: { id: true } });
    userIds.push(client.id);
    const addr = await prisma.address.create({ data: { user_id: client.id, contact_name: 'QA', contact_phone: '600000009', street_line_1: 'C/ Coste 1', postcode: '28016', city: 'Madrid', province: 'Madrid' }, select: { id: true } });
    const order = await call('/api/sales/orders', { method: 'POST', token: repToken, body: { user_id: client.id, address_id: addr.id, delivery_fee: 0, items: [{ variant_id: v1.id, quantity: 2 }] } });
    const orderId = order.body.data?.order?.id as string | undefined;
    if (orderId) orderIds.push(orderId);
    const repOrder = orderId ? await call(`/api/sales/orders/${orderId}`, { token: repToken }) : null;
    check('the rep: an order they build, and its page, carry no buying price', order.status === 201 && !leaks(order.body) && !!repOrder && !leaks(repOrder.body), { status: order.status, error: order.body.error });
  } finally {
    if (orderIds.length) {
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } }).catch(() => {});
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderIdempotency.deleteMany({ where: { order_id: { in: orderIds } } }).catch(() => {});
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (userIds.length) {
      await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.salesRepProduct.deleteMany({ where: { sales_rep_id: { in: userIds } } });
      await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.userRefreshToken.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (productId) {
      await prisma.cartItem.deleteMany({ where: { variant: { product_id: productId } } }).catch(() => {});
      await prisma.productVariant.deleteMany({ where: { product_id: productId } });
      await prisma.productImage.deleteMany({ where: { product_id: productId } });
      await prisma.product.delete({ where: { id: productId } });
    }
    server.close();
    await prisma.$disconnect();
    console.log(`\n${passed}/${passed + failed} passed`);
    process.exit(failed === 0 ? 0 : 1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
