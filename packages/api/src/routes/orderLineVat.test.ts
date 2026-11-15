// ─── Integration test · an order line's IVA, as every screen reads it ─────
//
// Run:  cd packages/api && npm run test:order-line-vat
//
// The albarán and factura charge a line at its PRODUCT's IVA band
// (lib/invoicing buildInvoiceLines). Four order editors preview that IVA —
// admin's, the rep's, the business panel's and a customer's — and they read
// it from the order line's own `vat_category`, a column nothing has ever
// written. So a 4 % or 21 % product already on an order previewed at 10 %,
// and a customer adding one from the shop catalogue, which did not send the
// band at all, got 10 % too.
//
// Checked here:
//   · every read those editors seed from carries each line's product band —
//     the customer's (an order and a split purchase), admin's (both) and the
//     rep's — without letting a buying price into the customer or rep ones;
//   · the shop catalogue sends the band with each product;
//   · the document marks the lines whose band nobody reviewed, and not the
//     delivery line, which carried that asterisk on every factura with a fee;
//   · and its IVA, per rate, to the cent.
//
// Inserts its own fixtures, reads them back over HTTP, and removes them.
import http from 'http';
import app from '../server';
import prisma from '../lib/prisma';
import { Prisma, type VatCategory } from '@prisma/client';
import { generateAccessToken, generateAdminAccessToken } from '../lib/jwt';
import { generateOrderNumber } from '../lib/pagination';
import { generateParentOrderNumber } from '../lib/parentOrder';
import { repShop } from '../lib/testRepShop';

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

interface Line { product_id: string; unit_cost?: unknown; product?: { vat_category?: VatCategory } | null }
interface DocLine { product_id: string | null; rate_pct: number; vat_source: string }

/** Each line's band, by product, as a read returned it. */
const bandsOf = (items: Line[] | undefined): Record<string, VatCategory | null> =>
  Object.fromEntries((items ?? []).map((i) => [i.product_id, i.product?.vat_category ?? null]));

/** Same bands for the same products, in whatever order the read sorted its lines. */
const sameBands = (got: Record<string, VatCategory | null>, want: Record<string, VatCategory>) =>
  Object.keys(got).length === Object.keys(want).length
  && Object.entries(want).every(([id, band]) => got[id] === band);

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const parentIds: string[] = [];
  const invoiceIds: string[] = [];
  const productIds: string[] = [];
  let categoryId = '';

  const call = async (path: string, init: { method?: string; body?: unknown; token?: string }) => {
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

    // ─── Fixtures: one product per band ──────────────────────
    const category = await prisma.category.create({
      data: { name_es: `IVA ${stamp}`, name_en: `VAT ${stamp}`, sort_order: 9999 },
      select: { id: true },
    });
    categoryId = category.id;

    // The rice sits on the schema's `reduced` placeholder, NOT reviewed, so
    // it carries 0 % (the default since 2026-11-01) and is the line the
    // document has to mark. The other two somebody confirmed.
    const mkProduct = async (label: string, band: VatCategory, reviewed: boolean, price: string) => {
      const p = await prisma.product.create({
        data: {
          name_es: `IVA prueba ${label} ${stamp}`, name_en: `VAT test ${label} ${stamp}`,
          category_id: categoryId, is_active: true,
          vat_category: band, vat_category_reviewed: reviewed,
          variants: {
            create: [{
              name_es: '1 ud', name_en: '1 unit',
              price: new Prisma.Decimal(price), stock_quantity: 50, is_active: true,
            }],
          },
        },
        include: { variants: true },
      });
      productIds.push(p.id);
      return { id: p.id, variantId: p.variants[0].id, name: p.name_es, price };
    };
    const bread = await mkProduct('pan', 'super_reduced', true, '2.00');
    const rice = await mkProduct('arroz', 'reduced', false, '5.00');
    const soap = await mkProduct('jabon', 'general', true, '10.00');

    const mkUser = async (label: string, extra: { created_by_sales_rep_id?: string } = {}) =>
      prisma.user.create({
        data: {
          name: `QA IVA ${label} ${stamp}`,
          email: `qa.iva.${label}.${stamp}@cesto.test`,
          phone: `+346${String(Math.floor(Math.random() * 90000000) + 10000000)}`,
          ...extra,
        },
        select: { id: true, email: true },
      });

    const rep = await mkUser('rep');
    userIds.push(rep.id);
    await prisma.salesRep.create({ data: { user_id: rep.id, code: `QA-IVA-${stamp}`, ...repShop(null) } });
    const repToken = generateAccessToken({ userId: rep.id, email: rep.email ?? undefined });

    const customer = await mkUser('client', { created_by_sales_rep_id: rep.id });
    userIds.push(customer.id);
    const customerToken = generateAccessToken({ userId: customer.id, email: customer.email ?? undefined });
    const address = await prisma.address.create({
      data: {
        user_id: customer.id, contact_name: 'QA', contact_phone: '600000007',
        street_line_1: 'C/ IVA 1', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
      select: { id: true },
    });

    const line = (p: { id: string; variantId: string; name: string; price: string }, quantity: number) => ({
      product_id: p.id, variant_id: p.variantId, quantity,
      product_snapshot: { name_es: p.name, variant_name_es: '1 ud' },
      unit_price: new Prisma.Decimal(p.price),
      line_total: new Prisma.Decimal(p.price).mul(quantity),
    });

    // 2 × 2.00 at 4 %, 1 × 5.00 at 0 %, 1 × 10.00 at 21 %, and 3.00 of
    // delivery — which the document taxes at 21 % too. Inserted with no
    // recorded rate, like a line from before lines kept one, so the document
    // reads each product's band.
    const order = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(),
        user_id: customer.id, address_id: address.id, address_snapshot: {},
        payment_method: 'cod', status: 'pending',
        subtotal: new Prisma.Decimal('19.00'),
        delivery_fee: new Prisma.Decimal('3.00'),
        total: new Prisma.Decimal('22.00'),
        created_by_sales_rep_id: rep.id,
        items: { create: [line(bread, 2), line(rice, 1), line(soap, 1)] },
      },
      select: { id: true },
    });
    orderIds.push(order.id);

    // A split purchase, for the reads' second branch.
    const parent = await prisma.parentOrder.create({
      data: {
        order_number: generateParentOrderNumber(),
        user_id: customer.id, address_id: address.id, payment_method: 'cod',
        address_snapshot: {},
        subtotal: new Prisma.Decimal('10.00'),
        delivery_fee_total: new Prisma.Decimal(0),
        total: new Prisma.Decimal('10.00'),
      },
      select: { id: true },
    });
    parentIds.push(parent.id);
    const part = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(),
        parent_order_id: parent.id,
        user_id: customer.id, address_id: address.id, address_snapshot: {},
        payment_method: 'cod', status: 'pending',
        subtotal: new Prisma.Decimal('10.00'),
        delivery_fee: new Prisma.Decimal(0),
        total: new Prisma.Decimal('10.00'),
        items: { create: [line(soap, 1)] },
      },
      select: { id: true },
    });
    orderIds.push(part.id);

    const expected: Record<string, VatCategory> = {
      [bread.id]: 'super_reduced', [rice.id]: 'reduced', [soap.id]: 'general',
    };

    // ─── 1. The reads the editors seed from ──────────────────
    const mine = await call(`/api/orders/${order.id}`, { token: customerToken });
    check('the customer read gives each line its product band',
      sameBands(bandsOf(mine.body.data?.items), expected),
      { status: mine.status, got: bandsOf(mine.body.data?.items) });
    check('...and no buying price',
      (mine.body.data?.items ?? []).every((i: Line) => !('unit_cost' in i)));

    const minePurchase = await call(`/api/orders/${parent.id}`, { token: customerToken });
    check('...a split purchase too, part by part',
      bandsOf(minePurchase.body.data?.sub_orders?.[0]?.items)[soap.id] === 'general',
      { status: minePurchase.status, got: bandsOf(minePurchase.body.data?.sub_orders?.[0]?.items) });

    const staff = await call(`/api/admin/orders/${order.id}`, { token: adminToken });
    check('the admin read gives each line its product band',
      sameBands(bandsOf(staff.body.data?.items), expected),
      { status: staff.status, got: bandsOf(staff.body.data?.items) });
    check('...and still the buying price only it asks for',
      (staff.body.data?.items ?? []).length === 3
        && (staff.body.data?.items ?? []).every((i: Line) => 'unit_cost' in i));

    const staffPurchase = await call(`/api/admin/orders/${parent.id}`, { token: adminToken });
    check('...a split purchase too, part by part',
      bandsOf(staffPurchase.body.data?.sub_orders?.[0]?.items)[soap.id] === 'general',
      { status: staffPurchase.status, got: bandsOf(staffPurchase.body.data?.sub_orders?.[0]?.items) });

    const theirs = await call(`/api/sales/orders/${order.id}`, { token: repToken });
    check("the rep's read gives each line its product band",
      sameBands(bandsOf(theirs.body.data?.items), expected),
      { status: theirs.status, error: theirs.body.error, got: bandsOf(theirs.body.data?.items) });
    check('...and no buying price',
      (theirs.body.data?.items ?? []).length === 3
        && (theirs.body.data?.items ?? []).every((i: Line) => !('unit_cost' in i)));

    // ─── 2. The shop catalogue a customer adds from ──────────
    const shop = await call(`/api/products?q=${encodeURIComponent(`IVA prueba jabon ${stamp}`)}`, {});
    const listed = (shop.body.data?.items ?? []).find((p: { id: string }) => p.id === soap.id);
    check('the shop catalogue says which IVA a product pays',
      listed?.vat_category === 'general',
      { status: shop.status, found: !!listed, vat: listed?.vat_category });

    // ─── 3. The document ─────────────────────────────────────
    const drafted = await call(`/api/admin/orders/${order.id}/invoice`, {
      method: 'POST', token: adminToken, body: { kind: 'albaran' },
    });
    const invoice = drafted.body.data?.invoice;
    if (invoice?.id) invoiceIds.push(invoice.id);
    check('a document is drafted for the order', drafted.status === 201 && !!invoice,
      { status: drafted.status, error: drafted.body.error });

    const lines = (invoice?.lines ?? []) as DocLine[];
    const lineOf = (productId: string | null) => lines.find((l) => l.product_id === productId);
    check('each line is charged at its product band, 0 % where nobody chose one',
      lineOf(bread.id)?.rate_pct === 4 && lineOf(rice.id)?.rate_pct === 0 && lineOf(soap.id)?.rate_pct === 21,
      lines.map((l) => [l.product_id, l.rate_pct]));
    check('a band nobody reviewed is marked as such',
      lineOf(rice.id)?.vat_source === 'default', lineOf(rice.id));
    check('...and a reviewed one is not',
      lineOf(bread.id)?.vat_source === 'product' && lineOf(soap.id)?.vat_source === 'product',
      [lineOf(bread.id)?.vat_source, lineOf(soap.id)?.vat_source]);
    check('THE DELIVERY LINE IS NOT MARKED "NOT REVIEWED"',
      lineOf(null)?.vat_source === 'delivery' && lineOf(null)?.rate_pct === 21, lineOf(null));

    // vat = round(gross × rate / (100 + rate)), base = gross − vat, per rate:
    //   0 %:   5.00 → 0.00 + 5.00
    //   4 %:   4.00 → 0.15 + 3.85
    //   21 %: 13.00 (10.00 + 3.00 delivery) → 2.26 + 10.74
    // As tuples: the totals come back out of JSONB, which reorders keys.
    const byRate = ((invoice?.totals?.by_rate ?? []) as Array<{ rate_pct: number; base: string; vat: string; gross: string }>)
      .map((g) => [g.rate_pct, g.base, g.vat, g.gross]);
    check('the IVA is split per rate, to the cent',
      JSON.stringify(byRate) === JSON.stringify([
        [0, '5.00', '0.00', '5.00'],
        [4, '3.85', '0.15', '4.00'],
        [21, '10.74', '2.26', '13.00'],
      ]), byRate);
    check('...and adds up to the order total',
      invoice?.totals?.base === '19.59' && invoice?.totals?.vat === '2.41' && invoice?.totals?.gross === '22.00',
      { base: invoice?.totals?.base, vat: invoice?.totals?.vat, gross: invoice?.totals?.gross });

  } finally {
    if (invoiceIds.length) await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    if (orderIds.length) {
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (parentIds.length) await prisma.parentOrder.deleteMany({ where: { id: { in: parentIds } } });
    if (productIds.length) {
      await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    if (userIds.length) {
      await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
