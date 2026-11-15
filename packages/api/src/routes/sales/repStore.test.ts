// ─── Integration test · the shops a sales rep sells from ─────────────────
//
// Run:  cd packages/api && npm run test:rep-store
//
// 2026-10-25, the user: "Admin will be able to assign the rep a store and then
// rep will be only able to see the products in his panel from that assigned
// store. If no store is assigned then the rep will not be able to create the
// orders… Only the active products from that will be shown." 2026-10-26: "now
// admin can assign multiple stores to the rep and from those assigned stores
// the products will show to them". Decisions: the order stays Cesto's;
// quick-add files under one of the rep's shops, asking which when they have
// several.
//
// What has to hold (lib/repStore):
//   · admin assigns any number of shops, and Cesto's own, when granting and
//     later; a new one that cannot be sold from is refused, one already
//     assigned may stay; the one-shop field of older admin pages still works;
//   · the rep's catalogue and its filter lists hold only those shops' active
//     products — nothing at all with none, or with only shops switched off;
//     a shop switched off drops out and the others still sell;
//   · creating an order, adding to one, and quick-add refuse without a shop,
//     and refuse a product from any other shop by name; lines already on an
//     order from elsewhere can still be changed;
//   · a shop deleted for good drops out of its reps' shops.
//
// Makes its own shops, products, reps and client, and deletes them afterwards.
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
type View = { id: string; name: string; sellable: boolean; unavailable: string | null };
const ids = (v: View[] | undefined) => (v ?? []).map((s) => s.id);

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const storeIds: string[] = [];
  const productIds: string[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];

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
    const category = await prisma.category.findFirst({ where: { is_active: true, approval_status: 'approved' }, select: { id: true } });
    const admin = await prisma.admin.findFirst({ where: { role: 'super_admin' }, select: { id: true, email: true, role: true } });
    if (!category || !admin) { console.log('  SKIP  need an approved category and a super admin'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    const mkStore = async (label: string, data: Record<string, unknown> = {}) => {
      const s = await prisma.store.create({ data: { name: `QA Rep Shop ${label} ${stamp}`, slug: `qa-rep-shop-${label.toLowerCase()}-${stamp}`, status: 'live', is_active: true, ...data }, select: { id: true, name: true } });
      storeIds.push(s.id);
      return s;
    };
    const X = await mkStore('X');
    const Y = await mkStore('Y');
    const Z = await mkStore('Z');
    const Off = await mkStore('Off', { is_active: false });
    const mkProduct = async (storeId: string | null, label: string, active = true) => {
      const p = await prisma.product.create({
        data: {
          name_es: `QA RepShop ${label} ${stamp}`, name_en: `QA RepShop ${label} ${stamp}`, category_id: category.id, store_id: storeId, is_active: active,
          variants: { create: [{ name_es: 'Unidad', name_en: 'Unit', price: 5, stock_quantity: 50, is_default: true }] },
        },
        select: { id: true, name_es: true, variants: { select: { id: true } } },
      });
      productIds.push(p.id);
      return { id: p.id, name: p.name_es, size: p.variants[0].id };
    };
    const px = await mkProduct(X.id, 'X1');
    const pxOff = await mkProduct(X.id, 'X2-inactive', false);
    const py = await mkProduct(Y.id, 'Y1');
    const pz = await mkProduct(Z.id, 'Z1');
    const pHouse = await mkProduct(null, 'House1');

    // A rep with no shop yet, granted the way staff do it.
    const repEmail = `qa.repshop.${stamp}@cesto.test`;
    const granted = await call('/api/admin/sales-reps', { method: 'POST', token: adminToken, body: { name: 'QA RepShop Rep', email: repEmail, send_credentials: false } });
    const repId = granted.body.data?.user_id as string;
    if (repId) userIds.push(repId);
    check('admin grants a rep without a shop', granted.status === 201 && Array.isArray(granted.body.data?.stores) && granted.body.data.stores.length === 0 && granted.body.data?.store === null,
      { status: granted.status, error: granted.body.error, stores: granted.body.data?.stores });
    const repToken = generateAccessToken({ userId: repId, email: repEmail });
    const client = await prisma.user.create({ data: { name: `QA RepShop Client ${stamp}`, email: `qa.repshop.client.${stamp}@cesto.test`, created_by_sales_rep_id: repId }, select: { id: true } });
    userIds.push(client.id);
    const addr = await prisma.address.create({ data: { user_id: client.id, contact_name: 'QA', contact_phone: '600000006', street_line_1: 'C/ Tienda 6', postcode: '28016', city: 'Madrid', province: 'Madrid' }, select: { id: true } });

    const me = async () => (await call('/api/sales/me', { token: repToken })).body.data;
    const catalogue = async (extra = '') => ((await call(`/api/sales/catalogue/products?limit=100&q=${encodeURIComponent('QA RepShop')}${extra}`, { token: repToken })).body.data?.items ?? []).map((p: { id: string }) => p.id);
    const order = (...variantIds: string[]) => call('/api/sales/orders', { method: 'POST', token: repToken, body: { user_id: client.id, address_id: addr.id, delivery_fee: 0, items: variantIds.map((variant_id) => ({ variant_id, quantity: 1 })) } });
    const quick = (storeId?: string) => call('/api/sales/products/quick', { method: 'POST', token: repToken, body: { name_es: `QA RepShop Quick ${stamp}`, name_en: `QA RepShop Quick ${stamp}`, category_id: category.id, vat_category: 'reduced', price: 3, ...(storeId ? { store_id: storeId } : {}) } });
    const setShops = (picks: string[]) => call(`/api/admin/sales-reps/${repId}`, { method: 'PUT', token: adminToken, body: { store_ids: picks } });
    /** A quick-added product, for the cleanup. */
    const keep = <T extends Awaited<ReturnType<typeof call>>>(r: T): T => { if (r.body.data?.id) productIds.push(r.body.data.id); return r; };

    // ─── 1. No shop: nothing to sell ─────────────────────────
    const m0 = await me();
    check('the rep is told they have no shop', Array.isArray(m0?.stores) && m0.stores.length === 0 && m0?.store === null, m0 && { stores: m0.stores, store: m0.store });
    check('their catalogue is empty', (await catalogue()).length === 0);
    const noShopOrder = await order(px.size);
    check('creating an order is refused, saying why', noShopOrder.status === 422 && noShopOrder.body.data?.code === 'rep_no_store', { status: noShopOrder.status, body: noShopOrder.body });
    const noShopQuick = await quick();
    check('...and so is quick-add', noShopQuick.status === 422 && noShopQuick.body.data?.code === 'rep_no_store', noShopQuick.status);
    const storesNone = await call('/api/sales/catalogue/stores', { token: repToken });
    check('the shop filter offers nothing', (storesNone.body.data?.items ?? []).length === 0);

    // ─── 2. Admin assigns one shop ───────────────────────────
    const toOff = await setShops([Off.id]);
    check('admin cannot assign a shop that is switched off', toOff.status === 422, { status: toOff.status, error: toOff.body.error });
    const toNowhere = await setShops(['00000000-0000-0000-0000-000000000000']);
    check('...or one that does not exist', toNowhere.status === 422, toNowhere.status);
    const toX = await setShops([X.id]);
    check('admin assigns shop X', toX.status === 200 && ids(toX.body.data?.stores).join() === X.id && toX.body.data?.stores?.[0]?.sellable === true, toX.body.data?.stores);
    const listed = ((await call('/api/admin/sales-reps?q=QA%20RepShop', { token: adminToken })).body.data?.items ?? []).find((r: { user_id: string }) => r.user_id === repId);
    check('the reps list shows it', listed?.stores?.[0]?.name === X.name, listed?.stores);

    // ─── 3. The rep sells from X only ───────────────────────
    check('the rep sees shop X as theirs', ids((await me())?.stores).join() === X.id);
    const seen = await catalogue();
    check('their catalogue holds X\'s active product only — not its inactive one, not Y\'s, not Cesto\'s',
      seen.includes(px.id) && !seen.includes(pxOff.id) && !seen.includes(py.id) && !seen.includes(pHouse.id), seen);
    const viaFilter = await catalogue(`&storeId=${Y.id}`);
    check('a storeId filter for another shop finds nothing rather than widening it', viaFilter.length === 0, viaFilter.length);
    const cats = (await call('/api/sales/catalogue/categories', { token: repToken })).body.data ?? [];
    const cat = cats.find((c: { id: string }) => c.id === category.id);
    check('categories say how many of the shop\'s products are in each', cat && cat.shop_products >= 1 && cats.length > 1, cat && { shop_products: cat.shop_products, listed: cats.length });
    const shops1 = (await call('/api/sales/catalogue/stores', { token: repToken })).body.data?.items ?? [];
    check('the shop filter offers only X', shops1.length === 1 && shops1[0].id === X.id, shops1.map((s: { name: string }) => s.name));

    const ok = await order(px.size);
    const okId = ok.body.data?.order?.id as string | undefined;
    if (okId) orderIds.push(okId);
    check('an order with X\'s product is created — and it is Cesto\'s', ok.status === 201 && ok.body.data?.order?.store_id === null, { status: ok.status, error: ok.body.error, store: ok.body.data?.order?.store_id });
    const other = await order(py.size);
    check('an order with Y\'s product is refused, naming it', other.status === 422 && other.body.data?.code === 'rep_outside_store' && other.body.data?.products?.includes(py.name), { status: other.status, data: other.body.data });
    const inactive = await order(pxOff.size);
    check('...and so is X\'s inactive product', inactive.status !== 201, inactive.status);
    const made = keep(await quick());
    check('with one shop, quick-add files the new product under it without asking', made.status === 201 && made.body.data?.store_id === X.id, { status: made.status, store: made.body.data?.store_id });

    // ─── 4. Several shops, and Cesto's own ──────────────────
    const toMany = await setShops([Y.id, X.id, 'cesto', X.id]);
    check('admin assigns X, Y and Cesto\'s own — Cesto\'s first, then by name, once each',
      toMany.status === 200 && ids(toMany.body.data?.stores).join() === ['cesto', X.id, Y.id].join(), toMany.body.data?.stores);
    check('the rep sees all three as theirs', ids((await me())?.stores).join() === ['cesto', X.id, Y.id].join());
    const many = await catalogue();
    check('their catalogue holds X\'s, Y\'s and Cesto\'s own — not Z\'s, not X\'s inactive one',
      many.includes(px.id) && many.includes(py.id) && many.includes(pHouse.id) && !many.includes(pz.id) && !many.includes(pxOff.id), many);
    const onlyY = await catalogue(`&storeId=${Y.id}`);
    check('a storeId filter for one of theirs narrows to it', onlyY.length === 1 && onlyY[0] === py.id, onlyY);
    const onlyHouse = await catalogue('&storeId=cesto');
    check('...and \'cesto\' narrows to Cesto\'s own', onlyHouse.includes(pHouse.id) && !onlyHouse.includes(px.id) && !onlyHouse.includes(py.id), onlyHouse);
    const viaZ = await catalogue(`&storeId=${Z.id}`);
    check('...but one for a shop not theirs still finds nothing', viaZ.length === 0, viaZ.length);
    const shops2 = (await call('/api/sales/catalogue/stores', { token: repToken })).body.data?.items ?? [];
    check('the shop filter offers X and Y', shops2.map((s: { id: string }) => s.id).sort().join() === [X.id, Y.id].sort().join(), shops2.map((s: { name: string }) => s.name));
    const cat2 = ((await call('/api/sales/catalogue/categories', { token: repToken })).body.data ?? []).find((c: { id: string }) => c.id === category.id);
    check('category counts take in every shop of theirs', cat2 && cat2.shop_products >= 3, cat2?.shop_products);

    const mixed = await order(px.size, py.size, pHouse.size);
    if (mixed.body.data?.order?.id) orderIds.push(mixed.body.data.order.id);
    check('one order with products from X, Y and Cesto\'s own is created — still Cesto\'s, not split',
      mixed.status === 201 && mixed.body.data?.order?.store_id === null && (mixed.body.data?.order?.items ?? []).length === 3,
      { status: mixed.status, error: mixed.body.error, store: mixed.body.data?.order?.store_id, lines: (mixed.body.data?.order?.items ?? []).length });
    const withZ = await order(px.size, pz.size);
    check('an order with Z\'s product is refused, naming only it', withZ.status === 422 && withZ.body.data?.code === 'rep_outside_store' && withZ.body.data?.products?.join() === pz.name, withZ.body.data);

    const unsaid = await quick();
    check('with several shops, quick-add asks which', unsaid.status === 422 && unsaid.body.data?.code === 'rep_pick_store', { status: unsaid.status, data: unsaid.body.data });
    const intoY = keep(await quick(Y.id));
    check('...files it under the one picked', intoY.status === 201 && intoY.body.data?.store_id === Y.id, { status: intoY.status, store: intoY.body.data?.store_id });
    const intoHouse = keep(await quick('cesto'));
    check('...or under Cesto\'s own', intoHouse.status === 201 && intoHouse.body.data?.store_id === null, { status: intoHouse.status, store: intoHouse.body.data?.store_id });
    const intoZ = keep(await quick(Z.id));
    check('...and refuses a shop not theirs', intoZ.status === 422 && intoZ.body.data?.code === 'rep_outside_store', intoZ.status);

    // ─── 5. Editing after a change of shops ─────────────────
    await setShops([Y.id]);
    if (okId) {
      const line = await prisma.orderItem.findFirst({ where: { order_id: okId }, select: { id: true } });
      const qty = await call(`/api/sales/orders/${okId}/items`, { method: 'PUT', token: repToken, body: { operations: [{ action: 'update_qty', order_item_id: line!.id, new_quantity: 2 }] } });
      check('moved to shop Y only, the rep can still change X\'s line already on the order', qty.status === 200, { status: qty.status, error: qty.body.error });
      const addX = await call(`/api/sales/orders/${okId}/items`, { method: 'PUT', token: repToken, body: { operations: [{ action: 'add', new_variant_id: px.size, new_quantity: 1 }] } });
      check('...but cannot add X\'s product any more', addX.status === 422 && addX.body.data?.code === 'rep_outside_store', { status: addX.status, error: addX.body.error });
      const addY = await call(`/api/sales/orders/${okId}/items`, { method: 'PUT', token: repToken, body: { operations: [{ action: 'add', new_variant_id: py.size, new_quantity: 1 }] } });
      check('...and can add Y\'s', addY.status === 200, { status: addY.status, error: addY.body.error });
    }

    // ─── 6. One of their shops switched off ─────────────────
    await setShops([X.id, Y.id]);
    await prisma.store.update({ where: { id: Y.id }, data: { is_active: false } });
    const half = (await me())?.stores as View[];
    const yView = half?.find((s) => s.id === Y.id);
    check('a shop switched off: the rep is told it cannot be sold from, and keeps the other',
      yView?.sellable === false && yView?.unavailable === 'inactive' && half?.find((s) => s.id === X.id)?.sellable === true, half);
    const halfSeen = await catalogue();
    check('...their catalogue loses its products and keeps X\'s', halfSeen.includes(px.id) && !halfSeen.includes(py.id), halfSeen);
    const halfY = await order(py.size);
    check('...an order with its product is refused', halfY.status === 422 && halfY.body.data?.code === 'rep_outside_store', halfY.status);
    const halfX = await order(px.size);
    if (halfX.body.data?.order?.id) orderIds.push(halfX.body.data.order.id);
    check('...and one from X is still made', halfX.status === 201, { status: halfX.status, error: halfX.body.error });
    check('...the legacy one-shop field names the shop they can still sell from', (await me())?.store?.id === X.id, (await me())?.store);
    const addZ = await setShops([X.id, Y.id, Z.id]);
    check('admin can add a shop while one already assigned is switched off', addZ.status === 200 && ids(addZ.body.data?.stores).includes(Z.id), { status: addZ.status, error: addZ.body.error });
    const addOff = await setShops([X.id, Y.id, Z.id, Off.id]);
    check('...but not add a new one that is switched off', addOff.status === 422, addOff.status);
    const profile = (await call(`/api/admin/sales-reps/${repId}`, { token: adminToken })).body.data;
    check('the admin profile shows it as unavailable', (profile?.stores as View[] | undefined)?.find((s) => s.id === Y.id)?.sellable === false, profile?.stores);
    const storeRow = (await call(`/api/admin/stores/${Y.id}`, { token: adminToken })).body.data;
    check('the shop says how many active reps sell from it', storeRow?._count?.sales_reps === 1, storeRow?._count);

    // ─── 7. Only shops switched off ─────────────────────────
    await setShops([Y.id]);
    check('with only a switched-off shop, their catalogue is empty', (await catalogue()).length === 0);
    const deadOrder = await order(py.size);
    check('...and orders are refused as having no shop', deadOrder.status === 422 && deadOrder.body.data?.code === 'rep_no_store', deadOrder.status);

    // ─── 8. A shop deleted for good ─────────────────────────
    await setShops([X.id, Y.id]);
    await prisma.store.update({ where: { id: Y.id }, data: { is_active: true } });
    // For good: its products go first, as a permanent delete requires.
    await prisma.orderItem.deleteMany({ where: { product_id: { in: productIds } , product: { store_id: Y.id } } });
    const yProducts = (await prisma.product.findMany({ where: { store_id: Y.id }, select: { id: true } })).map((p) => p.id);
    await prisma.productImage.deleteMany({ where: { product_id: { in: yProducts } } });
    await prisma.productVariant.deleteMany({ where: { product_id: { in: yProducts } } });
    await prisma.product.deleteMany({ where: { id: { in: yProducts } } });
    await prisma.store.delete({ where: { id: Y.id } });
    storeIds.splice(storeIds.indexOf(Y.id), 1);
    check('a shop deleted for good drops out of the rep\'s shops; the other stays', ids((await me())?.stores).join() === X.id, (await me())?.stores);

    // ─── 9. The one-shop field an older admin page sends ────
    const legacyOne = await call(`/api/admin/sales-reps/${repId}`, { method: 'PUT', token: adminToken, body: { store_id: Z.id } });
    check('an older admin page setting one shop replaces them with it', legacyOne.status === 200 && ids(legacyOne.body.data?.stores).join() === Z.id && legacyOne.body.data?.store?.id === Z.id, legacyOne.body.data?.stores);
    const legacyNone = await call(`/api/admin/sales-reps/${repId}`, { method: 'PUT', token: adminToken, body: { store_id: null } });
    check('...and null clears them', legacyNone.status === 200 && legacyNone.body.data?.stores?.length === 0 && legacyNone.body.data?.store === null, legacyNone.body.data?.stores);

    // ─── 10. Granting with shops, revoking, re-granting ─────
    const secondEmail = `qa.repshop2.${stamp}@cesto.test`;
    const second = await call('/api/admin/sales-reps', { method: 'POST', token: adminToken, body: { name: 'QA RepShop Rep 2', email: secondEmail, send_credentials: false, store_ids: [X.id, 'cesto'] } });
    const secondId = second.body.data?.user_id as string | undefined;
    if (secondId) userIds.push(secondId);
    check('admin can pick several shops when granting', second.status === 201 && ids(second.body.data?.stores).join() === ['cesto', X.id].join(), second.body.data?.stores);
    if (secondId) {
      await call(`/api/admin/sales-reps/${secondId}`, { method: 'PUT', token: adminToken, body: { is_active: false } });
      const back = await call('/api/admin/sales-reps', { method: 'POST', token: adminToken, body: { user_id: secondId, send_credentials: false } });
      check('revoked and granted again without picking, they keep their shops', back.status === 201 && ids(back.body.data?.stores).join() === ['cesto', X.id].join(), back.body.data?.stores);
    }
    const legacyGrant = await call('/api/admin/sales-reps', { method: 'POST', token: adminToken, body: { name: 'QA RepShop Rep 3', email: `qa.repshop3.${stamp}@cesto.test`, send_credentials: false, store_id: X.id } });
    if (legacyGrant.body.data?.user_id) userIds.push(legacyGrant.body.data.user_id);
    check('an older admin page granting with one shop still works', legacyGrant.status === 201 && ids(legacyGrant.body.data?.stores).join() === X.id, legacyGrant.body.data?.stores);
  } finally {
    if (orderIds.length) {
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderIdempotency.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (productIds.length) {
      await prisma.orderItem.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.productImage.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (userIds.length) {
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { created_by_sales_rep_id: null } });
      await prisma.userRefreshToken.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (storeIds.length) await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
