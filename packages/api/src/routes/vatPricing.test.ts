// ─── Integration test · prices are bases, customers pay them plus IVA ─────
//
// Run:  cd packages/api && npm run test:vat-pricing
//
// User, 2026-11-01: the B2C and B2B prices entered in admin "are the base
// prices and they do not include iva... For iva we will have 0, 4, 10, 21...
// Once we select the iva then it will be added to the product price", with
// 0 % "the default", and the sheet import gaining an IVA column defaulting to
// 0 %.
//
// So every price a customer sees or pays carries its product's IVA, to the
// cent, and only once somebody chose a band (lib/pricing, lib/tax):
//
//   · each catalogue surface — shop list and page, search, the business
//     catalogue, the rep's, the cart — shows base + IVA, wholesale included;
//   · the quote charges it and says how much IVA is inside, per rate;
//   · checkout, and an order staff build, charge it — and each line records
//     the rate, so a band changed afterwards re-splits nothing;
//   · an edit's swap and add are charged and recorded the same way;
//   · a product nobody chose a band for is sold at 0 %, and "Set IVA" and the
//     sheet's `iva` column are how one is chosen.
//
// Inserts its fixtures, drives the real routes over HTTP, removes it all.
import http from 'http';
import ExcelJS from 'exceljs';
import app from '../server';
import prisma from '../lib/prisma';
import { Prisma, type VatCategory } from '@prisma/client';
import { generateAccessToken, generateAdminAccessToken } from '../lib/jwt';
import { setCart } from '../lib/cartStore';
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
const TERM = `ivap${stamp}`;
const money = (v: unknown) => (v == null ? null : Number(v).toFixed(2));

interface Size { id: string; price?: unknown; b2b_price?: unknown; compare_at_price?: unknown }
interface Item { id: string; variants?: Size[] }

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const productIds: string[] = [];
  const orderIds: string[] = [];
  const invoiceIds: string[] = [];
  const jobIds: string[] = [];
  let categoryId = '';

  const call = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
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
  /** The first size of a product in a list response, wherever the list sits. */
  const sizeIn = (data: unknown, productId: string): Size | undefined => {
    const d = data as { items?: Item[]; products?: Item[] } | Item[] | undefined;
    const list = Array.isArray(d) ? d : (d?.items ?? d?.products ?? []);
    return list.find((p) => p.id === productId)?.variants?.[0];
  };

  try {
    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    // ─── Fixtures ────────────────────────────────────────────
    const category = await prisma.category.create({
      data: { name_es: `IVA precios ${stamp}`, name_en: `VAT prices ${stamp}`, sort_order: 9999 },
      select: { id: true, name_es: true },
    });
    categoryId = category.id;

    const mkProduct = async (
      label: string, band: VatCategory, reviewed: boolean,
      prices: { price: string; b2b?: string; compare?: string },
    ) => {
      const p = await prisma.product.create({
        data: {
          name_es: `${TERM} ${label}`, name_en: `${TERM} ${label}`,
          category_id: categoryId, is_active: true,
          vat_category: band, vat_category_reviewed: reviewed,
          variants: {
            create: [{
              // Default: search suggestions show only a product's default size.
              name_es: '1 ud', name_en: '1 unit', is_active: true, is_default: true, stock_quantity: 50,
              price: new Prisma.Decimal(prices.price),
              b2b_price: prices.b2b ? new Prisma.Decimal(prices.b2b) : null,
              compare_at_price: prices.compare ? new Prisma.Decimal(prices.compare) : null,
            }],
          },
        },
        include: { variants: true },
      });
      productIds.push(p.id);
      return { id: p.id, variantId: p.variants[0].id };
    };
    // 4 % chosen; 21 % chosen; the old `reduced` placeholder nobody chose
    // (so 0 %); and 0 % chosen on purpose.
    const bread = await mkProduct('pan', 'super_reduced', true, { price: '2.00', b2b: '1.50', compare: '2.50' });
    const soap = await mkProduct('jabon', 'general', true, { price: '10.00', b2b: '8.00' });
    const rice = await mkProduct('arroz', 'reduced', false, { price: '5.00' });
    const water = await mkProduct('agua', 'zero', true, { price: '1.00' });

    const mkUser = async (label: string, extra: { created_by_sales_rep_id?: string; is_business?: boolean; pricing_mode?: 'b2b' } = {}) => {
      const u = await prisma.user.create({
        data: {
          name: `QA IVA precios ${label} ${stamp}`,
          email: `qa.ivap.${label}.${stamp}@cesto.test`,
          phone: `+346${String(Math.floor(Math.random() * 90000000) + 10000000)}`,
          ...extra,
        },
        select: { id: true, email: true },
      });
      userIds.push(u.id);
      return u;
    };
    const rep = await mkUser('rep');
    await prisma.salesRep.create({ data: { user_id: rep.id, code: `QA-IVAP-${stamp}`, ...repShop(null) } });
    const repToken = generateAccessToken({ userId: rep.id, email: rep.email ?? undefined });
    const shopper = await mkUser('shopper', { created_by_sales_rep_id: rep.id });
    const shopperToken = generateAccessToken({ userId: shopper.id, email: shopper.email ?? undefined });
    const firm = await mkUser('firm', { created_by_sales_rep_id: rep.id, is_business: true, pricing_mode: 'b2b' });
    const firmToken = generateAccessToken({ userId: firm.id, email: firm.email ?? undefined });
    const addressOf = async (userId: string) => (await prisma.address.create({
      data: {
        user_id: userId, contact_name: 'QA', contact_phone: '600000009',
        street_line_1: 'C/ IVA 2', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
      select: { id: true },
    })).id;
    const shopperAddress = await addressOf(shopper.id);
    const firmAddress = await addressOf(firm.id);

    // ─── 1. What a customer is shown ─────────────────────────
    const shop = await call(`/api/products?q=${TERM}&limit=50`);
    check('the shop adds the band to the base: 2.00 at 4 % shows 2.08',
      money(sizeIn(shop.body.data, bread.id)?.price) === '2.08', sizeIn(shop.body.data, bread.id));
    check('...and to the "was" price: 2.50 shows 2.60',
      money(sizeIn(shop.body.data, bread.id)?.compare_at_price) === '2.60');
    check('...21 %: 10.00 shows 12.10', money(sizeIn(shop.body.data, soap.id)?.price) === '12.10');
    check('A BAND NOBODY CHOSE IS 0 %: 5.00 stays 5.00, whatever the placeholder',
      money(sizeIn(shop.body.data, rice.id)?.price) === '5.00', sizeIn(shop.body.data, rice.id));
    check('0 % chosen on purpose: 1.00 stays 1.00', money(sizeIn(shop.body.data, water.id)?.price) === '1.00');
    check('...and no wholesale price reaches a visitor', !('b2b_price' in (sizeIn(shop.body.data, bread.id) ?? {})));

    const page = await call(`/api/products/${bread.id}`);
    check('the product page shows the same 2.08', money(page.body.data?.variants?.[0]?.price) === '2.08', page.body.data?.variants?.[0]);

    const search = await call(`/api/search?q=${TERM}`);
    check('search shows the same 2.08', money(sizeIn(search.body.data, bread.id)?.price) === '2.08',
      { status: search.status, size: sizeIn(search.body.data, bread.id) });
    const suggest = await call(`/api/search/suggestions?q=${TERM}`);
    const suggested = (suggest.body.data as Array<{ id: string; variants: Size[] }> | undefined)?.find((p) => p.id === bread.id);
    check('...and so do its suggestions', money(suggested?.variants?.[0]?.price) === '2.08', suggested);

    const asFirm = await call(`/api/products?q=${TERM}&limit=50`, { token: firmToken });
    check('a business is shown its wholesale price with IVA: 1.50 → 1.56',
      money(sizeIn(asFirm.body.data, bread.id)?.price) === '1.56', sizeIn(asFirm.body.data, bread.id));
    const firmCatalogue = await call(`/api/business/catalogue/products?q=${TERM}&limit=50`, { token: firmToken });
    check('...in its own catalogue too: 8.00 at 21 % → 9.68',
      money(sizeIn(firmCatalogue.body.data, soap.id)?.price) === '9.68',
      { status: firmCatalogue.status, size: sizeIn(firmCatalogue.body.data, soap.id) });

    const repRetail = await call(`/api/sales/catalogue/products?q=${TERM}&limit=50`, { token: repToken });
    check("the rep's catalogue shows the shop price with IVA: 2.08, \"was\" 2.60",
      money(sizeIn(repRetail.body.data, bread.id)?.price) === '2.08'
        && money(sizeIn(repRetail.body.data, bread.id)?.compare_at_price) === '2.60',
      { status: repRetail.status, size: sizeIn(repRetail.body.data, bread.id) });
    const repBoth = await call(`/api/sales/catalogue/products?q=${TERM}&limit=50&prices=both`, { token: repToken });
    const repBread = sizeIn(repBoth.body.data, bread.id);
    check('...and, asked for both, both with IVA: 2.08 and 1.56',
      money(repBread?.price) === '2.08' && money(repBread?.b2b_price) === '1.56' && money(repBread?.compare_at_price) === '2.60',
      { status: repBoth.status, repBread });
    const repForFirm = await call(`/api/sales/catalogue/products?q=${TERM}&limit=50&for_client=${firm.id}`, { token: repToken });
    check('...and, for a business client, the one it pays: 1.56, no "was"',
      money(sizeIn(repForFirm.body.data, bread.id)?.price) === '1.56' && sizeIn(repForFirm.body.data, bread.id)?.compare_at_price == null,
      sizeIn(repForFirm.body.data, bread.id));
    const repForShopper = await call(`/api/sales/catalogue/products?q=${TERM}&limit=50&for_client=${shopper.id}`, { token: repToken });
    check('...for a retail client, 2.08 with its "was" 2.60',
      money(sizeIn(repForShopper.body.data, bread.id)?.price) === '2.08'
        && money(sizeIn(repForShopper.body.data, bread.id)?.compare_at_price) === '2.60',
      sizeIn(repForShopper.body.data, bread.id));

    // ─── 2. The basket, the quote, the checkout ──────────────
    await setCart(shopper.id, [
      { productId: bread.id, variantId: bread.variantId, quantity: 2 },
      { productId: soap.id, variantId: soap.variantId, quantity: 1 },
      { productId: rice.id, variantId: rice.variantId, quantity: 1 },
      { productId: water.id, variantId: water.variantId, quantity: 1 },
    ]);
    const cart = await call('/api/cart', { token: shopperToken });
    const cartBread = (cart.body.data?.items ?? []).find((i: { variantId: string }) => i.variantId === bread.variantId);
    check('the cart shows 2.08 too', money(cartBread?.variant?.price) === '2.08', cartBread);

    // 2 × 2.08 + 12.10 + 5.00 + 1.00 = 22.26, with inside it, per rate:
    //   0 %: 6.00 → 0.00 · 4 %: 4.16 → 0.16 + 4.00 · 21 %: 12.10 → 2.10 + 10.00
    const quote = await call('/api/orders/quote', { method: 'POST', token: shopperToken, body: { addressId: shopperAddress } });
    check('the quote charges the prices with IVA: 22.26', money(quote.body.data?.subtotal) === '22.26',
      { status: quote.status, error: quote.body.error, subtotal: quote.body.data?.subtotal });
    const byRate = ((quote.body.data?.tax?.by_rate ?? []) as Array<{ rate_pct: number; base: string; vat: string; gross: string }>)
      .map((g) => [g.rate_pct, g.base, g.vat, g.gross]);
    check('...and says how much IVA is inside, per rate',
      JSON.stringify(byRate) === JSON.stringify([[0, '6.00', '0.00', '6.00'], [4, '4.00', '0.16', '4.16'], [21, '10.00', '2.10', '12.10']]),
      byRate);
    check('...2.26 of it in all, on 20.00 of base',
      quote.body.data?.tax?.vat === '2.26' && quote.body.data?.tax?.base === '20.00', quote.body.data?.tax);

    const placed = await call('/api/orders', { method: 'POST', token: shopperToken, body: { addressId: shopperAddress, paymentMethod: 'cod' } });
    const shopperOrder = await prisma.order.findFirst({
      where: { user_id: shopper.id }, orderBy: { created_at: 'desc' },
      select: { id: true, subtotal: true, items: { select: { variant_id: true, unit_price: true, tax_rate_pct: true } } },
    });
    if (shopperOrder) orderIds.push(shopperOrder.id);
    const lineOf = (o: typeof shopperOrder, variantId: string) => o?.items.find((i) => i.variant_id === variantId);
    check('checkout charges what the quote said: 22.26',
      placed.status === 201 && money(shopperOrder?.subtotal) === '22.26',
      { status: placed.status, error: placed.body.error, subtotal: shopperOrder?.subtotal });
    check('...each line at its price with IVA',
      money(lineOf(shopperOrder, bread.variantId)?.unit_price) === '2.08'
        && money(lineOf(shopperOrder, soap.variantId)?.unit_price) === '12.10'
        && money(lineOf(shopperOrder, rice.variantId)?.unit_price) === '5.00',
      shopperOrder?.items);
    check('EACH LINE RECORDS THE RATE IT WAS CHARGED: 4, 21, 0, 0',
      lineOf(shopperOrder, bread.variantId)?.tax_rate_pct === 4 && lineOf(shopperOrder, soap.variantId)?.tax_rate_pct === 21
        && lineOf(shopperOrder, rice.variantId)?.tax_rate_pct === 0 && lineOf(shopperOrder, water.variantId)?.tax_rate_pct === 0,
      shopperOrder?.items.map((i) => i.tax_rate_pct));

    // ─── 3. A band changed afterwards ────────────────────────
    await prisma.product.update({ where: { id: soap.id }, data: { vat_category: 'reduced' } });
    const later = await call(`/api/products?q=${TERM}&limit=50`);
    check('a band changed on the product reprices it for the next customer: 11.00',
      money(sizeIn(later.body.data, soap.id)?.price) === '11.00', sizeIn(later.body.data, soap.id));
    if (shopperOrder) {
      const doc = await call(`/api/admin/orders/${shopperOrder.id}/invoice`, { method: 'POST', token: adminToken, body: { kind: 'albaran' } });
      if (doc.body.data?.invoice?.id) invoiceIds.push(doc.body.data.invoice.id);
      const docSoap = ((doc.body.data?.invoice?.lines ?? []) as Array<{ product_id: string; rate_pct: number }>).find((l) => l.product_id === soap.id);
      check("...but the order's document keeps the 21 % it was charged", docSoap?.rate_pct === 21,
        { status: doc.status, error: doc.body.error, docSoap });
      const mine = await call(`/api/orders/${shopperOrder.id}`, { token: shopperToken });
      const mySoap = (mine.body.data?.items ?? []).find((i: { variant_id: string }) => i.variant_id === soap.variantId);
      check('...and so does the order the customer reads', mySoap?.tax_rate_pct === 21, mySoap);
    }

    // ─── 4. Staff build and edit ─────────────────────────────
    const built = await call('/api/admin/orders', {
      method: 'POST', token: adminToken,
      body: { user_id: firm.id, address_id: firmAddress, delivery_fee: 0, items: [{ variant_id: bread.variantId, quantity: 1 }] },
    });
    const builtId = built.body.data?.order?.id as string | undefined;
    if (builtId) orderIds.push(builtId);
    const builtLine = builtId
      ? await prisma.orderItem.findFirst({ where: { order_id: builtId }, select: { id: true, unit_price: true, tax_rate_pct: true } })
      : null;
    check('an order staff build for a business charges wholesale with IVA: 1.56, recorded at 4 %',
      money(builtLine?.unit_price) === '1.56' && builtLine?.tax_rate_pct === 4,
      { status: built.status, error: built.body.error, builtLine });

    if (builtId && builtLine) {
      const swapped = await call(`/api/admin/orders/${builtId}/items`, {
        method: 'PUT', token: adminToken,
        body: {
          operations: [
            { action: 'replace', order_item_id: builtLine.id, new_variant_id: soap.variantId },
            { action: 'add', new_variant_id: rice.variantId, new_quantity: 1 },
          ],
        },
      });
      const after = await prisma.orderItem.findMany({
        where: { order_id: builtId }, select: { variant_id: true, unit_price: true, tax_rate_pct: true },
      });
      const swappedIn = after.find((i) => i.variant_id === soap.variantId);
      const added = after.find((i) => i.variant_id === rice.variantId);
      check('a size swapped in on the line is charged and recorded at its band: 8.80 at 10 %',
        swapped.status === 200 && money(swappedIn?.unit_price) === '8.80' && swappedIn?.tax_rate_pct === 10,
        { status: swapped.status, error: swapped.body.error, swappedIn });
      check('...and a line added: 5.00 at 0 %', money(added?.unit_price) === '5.00' && added?.tax_rate_pct === 0, added);
    }

    // ─── 5. Choosing a band ──────────────────────────────────
    const chose = await call('/api/admin/products/bulk/action', {
      method: 'POST', token: adminToken, body: { action: 'set_vat', ids: [rice.id], vat_category: 'reduced' },
    });
    const riceRow = await prisma.product.findUnique({ where: { id: rice.id }, select: { vat_category: true, vat_category_reviewed: true } });
    const afterChoice = await call(`/api/products?q=${TERM}&limit=50`);
    check('"Set IVA" chooses a band, and the price follows: 5.00 → 5.50',
      chose.status === 200 && riceRow?.vat_category_reviewed === true && money(sizeIn(afterChoice.body.data, rice.id)?.price) === '5.50',
      { status: chose.status, error: chose.body.error, riceRow, size: sizeIn(afterChoice.body.data, rice.id) });
    const zeroed = await call('/api/admin/products/bulk/action', {
      method: 'POST', token: adminToken, body: { action: 'set_vat', ids: [rice.id], vat_category: 'zero' },
    });
    const backAtZero = await call(`/api/products?q=${TERM}&limit=50`);
    check('...and 0 % can be chosen too: back to 5.00',
      zeroed.status === 200 && money(sizeIn(backAtZero.body.data, rice.id)?.price) === '5.00',
      { status: zeroed.status, error: zeroed.body.error });

    // ─── 6. The sheet's `iva` column ─────────────────────────
    const headers = ['product_key', 'name_es', 'name_en', 'category', 'iva', 'variant_name_es', 'variant_name_en', 'price', 'stock_quantity'];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Products');
    ws.addRow(headers);
    ws.addRow(['K1', `${TERM} hoja diez`, `${TERM} sheet ten`, category.name_es, 10, '1 ud', '1 unit', 3, 5]);
    ws.addRow(['K2', `${TERM} hoja vacia`, `${TERM} sheet blank`, category.name_es, '', '1 ud', '1 unit', 3, 5]);
    ws.addRow(['K3', `${TERM} hoja mala`, `${TERM} sheet bad`, category.name_es, 7, '1 ud', '1 unit', 3, 5]);
    const sheet = Buffer.from(await wb.xlsx.writeBuffer());
    const form = new FormData();
    form.append('file', new Blob([sheet], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `iva-${stamp}.xlsx`);
    const upload = await fetch(`${base}/api/admin/products/import`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: form,
    });
    const uploaded = await upload.json() as { data?: { jobId?: string }; error?: string };
    const jobId = uploaded.data?.jobId;
    if (jobId) jobIds.push(jobId);
    let job: { status?: string; result?: { results?: Array<{ product_key: string; status: string; error?: string }> } } | undefined;
    for (let i = 0; jobId && i < 60; i++) {
      const r = await call(`/api/admin/products/import/jobs/${jobId}`, { token: adminToken });
      job = r.body.data;
      if (job?.status === 'done' || job?.status === 'failed') break;
      await new Promise((r2) => setTimeout(r2, 500));
    }
    const imported = await prisma.product.findMany({
      where: { name_es: { startsWith: `${TERM} hoja` } },
      select: { id: true, name_es: true, vat_category: true, vat_category_reviewed: true },
    });
    for (const p of imported) productIds.push(p.id);
    const ten = imported.find((p) => p.name_es.endsWith('diez'));
    const blank = imported.find((p) => p.name_es.endsWith('vacia'));
    check('a sheet with iva 10 creates the product at 10 %, chosen',
      job?.status === 'done' && ten?.vat_category === 'reduced' && ten.vat_category_reviewed === true,
      { upload: upload.status, error: uploaded.error, status: job?.status, ten });
    check('...a blank iva leaves it on the 0 % default, not chosen', blank != null && blank.vat_category_reviewed === false, blank);
    const bad = (job?.result?.results ?? []).find((r) => r.product_key === 'K3');
    check('...and an iva that is not 0, 4, 10 or 21 is refused, not guessed',
      bad?.status === 'error' && /iva/.test(bad.error ?? '') && !imported.some((p) => p.name_es.endsWith('mala')),
      bad);
  } finally {
    if (invoiceIds.length) await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    if (orderIds.length) {
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (jobIds.length) await prisma.productImportJob.deleteMany({ where: { id: { in: jobIds } } });
    if (userIds.length) {
      await prisma.cartItem.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.customerProductDiscount.deleteMany({ where: { user_id: { in: userIds } } });
    }
    if (productIds.length) {
      await prisma.productImage.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    if (userIds.length) {
      await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } });
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
