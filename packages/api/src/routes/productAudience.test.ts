// ─── Integration test · who is shown a product ─────────────────────────────
//
// Run:  cd packages/api && npm run test:product-audience
//
// 2026-10-25, the user: "a button for the added products that whether we want
// to show this product for b2c only, b2b only or both of them… by default it
// shows to both kinds of users with the respective prices."
//
// B2B = a business account (is_business); everyone else — signed-in retail
// shoppers and visitors — is B2C (lib/audience). What has to hold:
//   · every way the shop lists or opens a product shows each kind only theirs;
//   · nobody can put the other kind's product in their cart, be quoted for it,
//     check it out, add it to their own order, or get it back by reordering;
//   · admin sets it per product, filters by it, and sets it in bulk;
//   · the rep's catalogue for a client shows what that client is shown;
//   · staff can still build an order with it — a deliberate exception.
//
// Borrows three real products and puts their setting, stock and every row it
// made back afterwards.
import http from 'http';
import { Prisma, ProductAudience } from '@prisma/client';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAccessToken, generateAdminAccessToken } from '../lib/jwt';
import { createOrderForCustomer, CreateOrderError } from '../lib/createOrder';
import { buildProductWhere } from '../lib/product-filters';

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

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const taken = new Map<string, number>();
  const note = (variantId: string, units: number) => taken.set(variantId, (taken.get(variantId) ?? 0) + units);
  let restore: Array<{ id: string; audience: ProductAudience }> = [];
  let pricesBefore: Array<{ id: string; b2b_price: Prisma.Decimal | null }> = [];

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
    // ─── Fixtures ────────────────────────────────────────────
    const products = await prisma.product.findMany({
      where: {
        is_active: true, store_id: null,
        variants: { some: { is_active: true, stock_quantity: { gte: 20 } } },
      },
      select: {
        id: true, name_es: true, audience: true, category_id: true,
        variants: { where: { is_active: true, stock_quantity: { gte: 20 } }, select: { id: true }, take: 1 },
      },
      take: 3,
      orderBy: { created_at: 'asc' },
    });
    if (products.length < 3) { console.log('  SKIP  need three Cesto products with stock'); return; }
    restore = products.map((p) => ({ id: p.id, audience: p.audience }));
    const [C, B, BOTH] = products; // C: B2C only, B: B2B only, BOTH: both
    await prisma.product.update({ where: { id: C.id }, data: { audience: 'b2c' } });
    await prisma.product.update({ where: { id: B.id }, data: { audience: 'b2b' } });
    await prisma.product.update({ where: { id: BOTH.id }, data: { audience: 'all' } });
    const vC = C.variants[0].id; const vB = B.variants[0].id; const vBoth = BOTH.variants[0].id;
    // B2B prices, put back afterwards: B is priced, C and BOTH are not.
    pricesBefore = await prisma.productVariant.findMany({
      where: { product_id: { in: products.map((p) => p.id) } }, select: { id: true, b2b_price: true },
    });
    await prisma.productVariant.updateMany({ where: { product_id: B.id }, data: { b2b_price: 3 } });
    await prisma.productVariant.updateMany({ where: { product_id: { in: [C.id, BOTH.id] } }, data: { b2b_price: null } });
    const bothSizes = (await prisma.productVariant.findMany({ where: { product_id: BOTH.id, is_active: true }, select: { id: true } })).map((v) => v.id);
    console.log(`  ..    B2C only "${C.name_es}", B2B only "${B.name_es}", both "${BOTH.name_es}"\n`);

    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    const retail = await prisma.user.create({ data: { name: `QA Aud Retail ${stamp}`, email: `qa.aud.retail.${stamp}@cesto.test` } });
    const business = await prisma.user.create({ data: { name: `QA Aud Biz ${stamp}`, email: `qa.aud.biz.${stamp}@cesto.test`, is_business: true, pricing_mode: 'b2b' } });
    const rep = await prisma.user.create({ data: { name: `QA Aud Rep ${stamp}`, email: `qa.aud.rep.${stamp}@cesto.test` } });
    userIds.push(retail.id, business.id, rep.id);
    await prisma.salesRep.create({ data: { user_id: rep.id, is_active: true, house_store: true } }); // its products are Cesto's own (lib/repStore)
    await prisma.user.update({ where: { id: business.id }, data: { created_by_sales_rep_id: rep.id } });
    const tRetail = generateAccessToken({ userId: retail.id, email: retail.email ?? undefined });
    const tBiz = generateAccessToken({ userId: business.id, email: business.email ?? undefined });
    const tRep = generateAccessToken({ userId: rep.id, email: rep.email ?? undefined });
    const addr = async (userId: string) => (await prisma.address.create({
      data: { user_id: userId, contact_name: 'QA', contact_phone: '600000005', street_line_1: 'C/ Audiencia 5', postcode: '28016', city: 'Madrid', province: 'Madrid' },
      select: { id: true },
    })).id;
    const aRetail = await addr(retail.id);
    const aBiz = await addr(business.id);

    // ─── 1. What each kind is shown ──────────────────────────
    const idsQ = `${C.id},${B.id},${BOTH.id}`;
    const shown = async (token?: string) => ((await call(`/api/products/by-ids?ids=${idsQ}`, { token })).body.data ?? []).map((p: { id: string }) => p.id).sort();
    const want = (...ids: string[]) => ids.sort();
    check('a visitor is shown B2C-only and both, not B2B-only', JSON.stringify(await shown()) === JSON.stringify(want(C.id, BOTH.id)));
    check('a retail customer is shown the same', JSON.stringify(await shown(tRetail)) === JSON.stringify(want(C.id, BOTH.id)));
    check('a business is shown B2B-only and both, not B2C-only', JSON.stringify(await shown(tBiz)) === JSON.stringify(want(B.id, BOTH.id)));

    const open = async (id: string, token?: string) => (await call(`/api/products/${id}`, { token })).status;
    check('a B2B-only product page is a 404 for a visitor and a retail customer', (await open(B.id)) === 404 && (await open(B.id, tRetail)) === 404);
    check('...and opens for a business', (await open(B.id, tBiz)) === 200);
    check('a B2C-only product page is a 404 for a business', (await open(C.id, tBiz)) === 404);
    check('a both-audience product opens for everyone', (await open(BOTH.id)) === 200 && (await open(BOTH.id, tBiz)) === 200);

    const listed = async (q: string, token?: string) => ((await call(`/api/products?q=${encodeURIComponent(q)}&limit=60`, { token })).body.data?.items ?? []).map((p: { id: string }) => p.id);
    check('the catalogue list leaves B2B-only out for retail', !(await listed(B.name_es, tRetail)).includes(B.id));
    check('...and in for a business', (await listed(B.name_es, tBiz)).includes(B.id));
    const searched = async (q: string, token?: string) => ((await call(`/api/search?q=${encodeURIComponent(q)}`, { token })).body.data?.products ?? []).map((p: { id: string }) => p.id);
    check('search follows the same rule', !(await searched(B.name_es, tRetail)).includes(B.id) && (await searched(B.name_es, tBiz)).includes(B.id));
    const inCategory = async (catId: string, token?: string) => {
      const r = await call(`/api/categories/${catId}/products?limit=50`, { token });
      return (r.body.data?.items ?? r.body.data?.products ?? []).map((p: { id: string }) => p.id);
    };
    check('a category page leaves B2C-only out for a business', !(await inCategory(C.category_id, tBiz)).includes(C.id));

    // ─── 2. Buying ───────────────────────────────────────────
    const addToCart = (token: string, productId: string, variantId: string) =>
      call('/api/cart/items', { method: 'POST', token, body: { productId, variantId, quantity: 1 } });
    check('retail cannot put a B2B-only product in their cart', (await addToCart(tRetail, B.id, vB)).status === 404);
    check('a business cannot put a B2C-only product in theirs', (await addToCart(tBiz, C.id, vC)).status === 404);
    check('a business can put a B2B-only one in', (await addToCart(tBiz, B.id, vB)).status === 201);

    // A line that got into the cart before the product was restricted.
    await prisma.cartItem.create({ data: { user_id: business.id, product_id: C.id, variant_id: vC, quantity: 1 } });
    const quote = await call('/api/orders/quote', { method: 'POST', token: tBiz, body: { addressId: aBiz } });
    check('the quote calls the B2C-only line unavailable for a business',
      (quote.body.data?.issues ?? []).some((i: { variantId: string; reason: string }) => i.variantId === vC && i.reason === 'unavailable'), quote.body.data?.issues);
    const checkout = await call('/api/orders', { method: 'POST', token: tBiz, body: { addressId: aBiz, paymentMethod: 'cod' } });
    check('...and checkout refuses it', checkout.status === 400 && /not available for your account/.test(checkout.body.error ?? ''), { status: checkout.status, error: checkout.body.error });
    await prisma.cartItem.deleteMany({ where: { user_id: business.id, variant_id: vC } });
    const ok = await call('/api/orders', { method: 'POST', token: tBiz, body: { addressId: aBiz, paymentMethod: 'cod' } });
    const bizOrder = (ok.body.data?.id ?? ok.body.data?.order?.id ?? ok.body.data?.orders?.[0]?.id) as string | undefined;
    check('without it, the business checks out its B2B-only product', ok.status === 201 && !!bizOrder, { status: ok.status, error: ok.body.error });
    if (bizOrder) {
      orderIds.push(bizOrder); note(vB, 1);
      const addC = await call(`/api/orders/${bizOrder}/items`, { method: 'PUT', token: tBiz, body: { operations: [{ action: 'add', new_variant_id: vC, new_quantity: 1 }] } });
      check('a business cannot add a B2C-only product to its own order', addC.status === 400 && /not available/.test(addC.body.error ?? ''), { status: addC.status, error: addC.body.error });
      // Restricted after it was bought: reordering skips it.
      await prisma.product.update({ where: { id: B.id }, data: { audience: 'b2c' } });
      const re = await call(`/api/orders/${bizOrder}/reorder`, { method: 'POST', token: tBiz, body: { mode: 'replace' } });
      check('reordering skips a product the business is no longer shown',
        (re.body.data?.skipped_items ?? []).some((s: { variant_id: string; reason: string }) => s.variant_id === vB && s.reason === 'unavailable'), re.body.data?.skipped_items);
      await prisma.product.update({ where: { id: B.id }, data: { audience: 'b2b' } });
      await call('/api/cart', { method: 'DELETE', token: tBiz });
    }

    // A customer's own Home Grocery-style order (no builder) is held to it too.
    let refused = false;
    try {
      await createOrderForCustomer({ user_id: retail.id, address_id: aRetail, payment_method: 'cod', items: [{ variant_id: vB, quantity: 1 }] }, { adminId: null, salesRepId: null });
    } catch (e) { refused = e instanceof CreateOrderError && e.status === 422; }
    check('a customer\'s own order through createOrder refuses a product they are not shown', refused);

    // ─── 3. Staff and reps ───────────────────────────────────
    const staff = await call('/api/admin/orders', { method: 'POST', token: adminToken, body: { user_id: retail.id, address_id: aRetail, delivery_fee: 0, items: [{ variant_id: vB, quantity: 1 }] } });
    const staffId = staff.body.data?.order?.id as string | undefined;
    check('staff can still build a retail customer an order with a B2B-only product', staff.status === 201, { status: staff.status, error: staff.body.error });
    if (staffId) { orderIds.push(staffId); note(vB, 1); }

    const repList = async (q: string) => ((await call(`/api/sales/catalogue/products?q=${encodeURIComponent(q)}&for_client=${business.id}&limit=50`, { token: tRep })).body.data?.items ?? []).map((p: { id: string }) => p.id);
    check('the rep\'s catalogue for a business client leaves B2C-only out', !(await repList(C.name_es)).includes(C.id));
    check('...and has B2B-only', (await repList(B.name_es)).includes(B.id));

    // ─── 4. Admin sets it ────────────────────────────────────
    const adminRow = async (id: string) => ((await call(`/api/admin/products?ids=${id}`, { token: adminToken })).body.data?.items ?? [])[0];
    check('the products table carries the setting', (await adminRow(B.id))?.audience === 'b2b', (await adminRow(B.id))?.audience);
    // B2B only needs a B2B price on every size (lib/audience) — BOTH has none.
    const audienceNow = async (id: string) => (await prisma.product.findUnique({ where: { id }, select: { audience: true } }))?.audience;
    const b2bPrices = async (id: string) => (await prisma.productVariant.findMany({ where: { product_id: id, is_active: true }, select: { b2b_price: true } })).map((v) => (v.b2b_price == null ? null : Number(v.b2b_price)));
    const unpriced = await call(`/api/admin/products/${BOTH.id}/audience`, { method: 'PUT', token: adminToken, body: { audience: 'b2b' } });
    check('B2B only is refused while a size has no B2B price, naming those sizes',
      unpriced.status === 422 && unpriced.body.data?.code === 'b2b_price_required'
        && JSON.stringify((unpriced.body.data?.sizes ?? []).map((s: { id: string }) => s.id).sort()) === JSON.stringify([...bothSizes].sort()),
      { status: unpriced.status, data: unpriced.body.data });
    check('...and leaves the product as it was', (await audienceNow(BOTH.id)) === 'all');
    const stranger = await call(`/api/admin/products/${BOTH.id}/audience`, {
      method: 'PUT', token: adminToken,
      body: { audience: 'b2b', b2b_prices: [...bothSizes.map((id) => ({ variant_id: id, b2b_price: 2.5 })), { variant_id: vC, b2b_price: 1 }] },
    });
    check('a B2B price for another product\'s size is refused, and nothing is written',
      stranger.status === 422 && (await audienceNow(BOTH.id)) === 'all' && (await b2bPrices(BOTH.id)).every((p) => p === null) && (await b2bPrices(C.id)).every((p) => p === null),
      { status: stranger.status, error: stranger.body.error });
    const set = await call(`/api/admin/products/${BOTH.id}/audience`, {
      method: 'PUT', token: adminToken,
      body: { audience: 'b2b', b2b_prices: bothSizes.map((id) => ({ variant_id: id, b2b_price: 2.5 })) },
    });
    check('admin sets one product to B2B only from the table, giving its B2B prices in the same step',
      set.status === 200 && set.body.data?.audience === 'b2b' && (await b2bPrices(BOTH.id)).every((p) => p === 2.5), set.body);
    check('...and a visitor no longer sees it', (await open(BOTH.id)) === 404);
    check('a product already priced goes to B2B only without being asked', (await call(`/api/admin/products/${B.id}/audience`, { method: 'PUT', token: adminToken, body: { audience: 'b2b' } })).status === 200);

    // The form: what it sends, with everything the product already has.
    const formBody = (p: any, over: Record<string, unknown> = {}) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      name_es: p.name_es, name_en: p.name_en, description_es: p.description_es, description_en: p.description_en,
      brand: p.brand, origin: p.origin, store_id: p.store_id, category_id: p.category_id,
      subcategory_id: p.subcategory_id, product_type_id: p.product_type_id,
      is_active: p.is_active, is_featured: p.is_featured, is_verified: p.is_verified, is_top_seller: p.is_top_seller,
      is_sponsored: p.is_sponsored, is_new_arrival: p.is_new_arrival, is_quotation_enabled: p.is_quotation_enabled,
      rating: p.rating == null ? null : Number(p.rating), rating_count: p.rating_count,
      variants: p.variants.filter((v: { is_active: boolean }) => v.is_active).map((v: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        id: v.id, name_es: v.name_es, name_en: v.name_en, price: Number(v.price),
        compare_at_price: v.compare_at_price == null ? null : Number(v.compare_at_price),
        b2b_price: v.b2b_price == null ? null : Number(v.b2b_price),
        stock_quantity: v.stock_quantity, low_stock_threshold: v.low_stock_threshold, is_default: v.is_default, sku: v.sku,
      })),
      images: p.images.map((i: any) => ({ id: i.id, url: i.url, alt_text: i.alt_text, sort_order: i.sort_order, is_primary: i.is_primary })), // eslint-disable-line @typescript-eslint/no-explicit-any
      ...over,
    });
    const bothNow = (await call(`/api/admin/products/${BOTH.id}`, { token: adminToken })).body.data;
    const cleared = formBody(bothNow);
    cleared.variants = cleared.variants.map((v: Record<string, unknown>) => ({ ...v, b2b_price: null }));
    const clearSave = await call(`/api/admin/products/${BOTH.id}`, { method: 'PUT', token: adminToken, body: cleared });
    check('the form cannot clear a B2B-only product\'s B2B price',
      clearSave.status === 422 && clearSave.body.data?.code === 'b2b_price_required' && (await b2bPrices(BOTH.id)).every((p) => p === 2.5),
      { status: clearSave.status, error: clearSave.body.error });
    const cNow = (await call(`/api/admin/products/${C.id}`, { token: adminToken })).body.data;
    const cToB2b = await call(`/api/admin/products/${C.id}`, { method: 'PUT', token: adminToken, body: formBody(cNow, { audience: 'b2b' }) });
    check('the form cannot pick B2B only for a product with no B2B price', cToB2b.status === 422 && (await audienceNow(C.id)) === 'b2c', { status: cToB2b.status, error: cToB2b.body.error });
    const okSave = await call(`/api/admin/products/${BOTH.id}`, { method: 'PUT', token: adminToken, body: formBody(bothNow, { audience: 'b2b' }) });
    check('...a B2B-only product with its prices saves as usual', okSave.status === 200, { status: okSave.status, error: okSave.body.error });
    const created = await call('/api/admin/products', {
      method: 'POST', token: adminToken,
      body: { name_es: `QA Aud Nuevo ${stamp}`, name_en: `QA Aud New ${stamp}`, category_id: C.category_id, audience: 'b2b', variants: [{ name_es: '1 kg', name_en: '1 kg', price: 4 }], images: [] },
    });
    check('a new product cannot start as B2B only without a B2B price', created.status === 422 && created.body.data?.code === 'b2b_price_required'
      && (await prisma.product.count({ where: { name_es: `QA Aud Nuevo ${stamp}` } })) === 0, { status: created.status, error: created.body.error });

    // The bulk-edit grid: emptying the B2B price of a B2B-only product fails that row.
    const grid = await call('/api/admin/products/bulk', { method: 'POST', token: adminToken, body: { items: [{ id: BOTH.id, variants: [{ id: bothSizes[0], b2b_price: null }] }] } });
    check('the bulk-edit grid cannot clear it either, and says why',
      grid.status === 200 && grid.body.data?.updated === 0 && /B2B price/.test(grid.body.data?.failed?.[0]?.error ?? '') && (await b2bPrices(BOTH.id)).every((p) => p === 2.5),
      grid.body.data);
    const gridOk = await call('/api/admin/products/bulk', { method: 'POST', token: adminToken, body: { items: [{ id: BOTH.id, variants: [{ id: bothSizes[0], b2b_price: 2.75 }] }] } });
    check('...but can change it', gridOk.body.data?.updated === 1 && (await b2bPrices(BOTH.id)).includes(2.75), gridOk.body.data);
    const bad = await call(`/api/admin/products/${BOTH.id}/audience`, { method: 'PUT', token: adminToken, body: { audience: 'vip' } });
    check('...anything else is refused', bad.status === 422, bad.status);
    const onlyB2b = ((await call(`/api/admin/products?audience=b2b&ids=${idsQ}`, { token: adminToken })).body.data?.items ?? []).map((p: { id: string }) => p.id).sort();
    check('admin filters the table by "B2B only"', JSON.stringify(onlyB2b) === JSON.stringify(want(B.id, BOTH.id)), onlyB2b);
    const forRetail = ((await call(`/api/admin/products?shownTo=b2c&ids=${idsQ}`, { token: adminToken })).body.data?.items ?? []).map((p: { id: string }) => p.id);
    check('the order builder\'s "shown to B2C" leaves B2B-only out', JSON.stringify(forRetail) === JSON.stringify([C.id]), forRetail);
    const bulk = await call('/api/admin/products/bulk/action', { method: 'POST', token: adminToken, body: { action: 'set_audience', ids: [C.id, B.id, BOTH.id], audience: 'all' } });
    check('bulk: show all three to everyone', bulk.status === 200 && bulk.body.data?.updated === 3, bulk.body);
    check('...and a business is shown all three again', (await shown(tBiz)).length === 3);
    const bulkBad = await call('/api/admin/products/bulk/action', { method: 'POST', token: adminToken, body: { action: 'set_audience', ids: [C.id] } });
    check('bulk set_audience without an audience is refused', bulkBad.status === 422, bulkBad.status);
    const bulkB2b = await call('/api/admin/products/bulk/action', { method: 'POST', token: adminToken, body: { action: 'set_audience', ids: [C.id, B.id, BOTH.id], audience: 'b2b' } });
    check('bulk B2B only: the two with B2B prices are set, the one without is named and left',
      bulkB2b.status === 200 && bulkB2b.body.data?.updated === 2 && bulkB2b.body.data?.needs_b2b_price === 1
        && bulkB2b.body.data?.needs_b2b_price_products?.[0]?.id === C.id
        && (await audienceNow(C.id)) === 'all' && (await audienceNow(B.id)) === 'b2b' && (await audienceNow(BOTH.id)) === 'b2b',
      bulkB2b.body.data);
    // Through a filter with its own size condition (stock: in): C's name scopes it, and whatever else it matches is put back.
    const filter = { q: C.name_es, stock: 'in' as const };
    const alsoMatched = await prisma.product.findMany({ where: buildProductWhere(filter), select: { id: true, audience: true } });
    restore.push(...alsoMatched.filter((p) => !restore.some((r) => r.id === p.id)));
    const bulkFilter = await call('/api/admin/products/bulk/action', { method: 'POST', token: adminToken, body: { action: 'set_audience', filter, audience: 'b2b' } });
    check('...the same through a filter that has its own size condition',
      bulkFilter.status === 200 && (bulkFilter.body.data?.needs_b2b_price_products ?? []).some((p: { id: string }) => p.id === C.id) && (await audienceNow(C.id)) === 'all',
      bulkFilter.body);

    // A save from a form that predates the field leaves it alone.
    await prisma.product.update({ where: { id: C.id }, data: { audience: 'b2c' } });
    const full = (await call(`/api/admin/products/${C.id}`, { token: adminToken })).body.data;
    const { audience: _drop, ...older } = formBody(full) as Record<string, unknown>;
    const resave = await call(`/api/admin/products/${C.id}`, { method: 'PUT', token: adminToken, body: older });
    const after = await prisma.product.findUnique({ where: { id: C.id }, select: { audience: true } });
    check('saving the product from a form without the field keeps "B2C only"', after?.audience === 'b2c', { status: resave.status, error: resave.body?.error, audience: after?.audience });
  } finally {
    for (const r of restore) await prisma.product.update({ where: { id: r.id }, data: { audience: r.audience } }).catch(() => {});
    for (const v of pricesBefore) await prisma.productVariant.update({ where: { id: v.id }, data: { b2b_price: v.b2b_price } }).catch(() => {});
    await prisma.product.deleteMany({ where: { name_es: `QA Aud Nuevo ${stamp}` } }).catch(() => {});
    if (orderIds.length) {
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderIdempotency.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    for (const [variantId, units] of taken) {
      await prisma.productVariant.update({ where: { id: variantId }, data: { stock_quantity: { increment: units } } });
    }
    if (userIds.length) {
      await prisma.cartItem.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { created_by_sales_rep_id: null } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
