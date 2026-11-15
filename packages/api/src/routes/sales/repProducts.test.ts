// ─── Integration test · products assigned to a sales rep by hand ────────
//
// Run:  cd packages/api && npm run test:rep-products
//
// 2026-10-27, the user: "we should also be able to assign any products to the
// rep and these products can be from any store and they show up in catalogue
// of the rep and when they are creating the orders or edit".
//
// What has to hold (lib/repStore):
//   · an admin searches every shop's active products, assigns any of them and
//     takes them off again; assigning twice is harmless, a product that does
//     not exist is refused, and only a super admin may change them;
//   · the rep's catalogue holds them beside their shops' products, each row
//     saying it is theirs by hand, and `assigned=true` narrows to them;
//   · orders take them — created and added to — and refuse any product
//     neither from their shops nor assigned; the order stays Cesto's;
//   · a rep with assigned products and no shop builds orders from those
//     alone, but has no shop to quick-add into;
//   · an assigned product leaves when it goes inactive, its shop is suspended,
//     it is unassigned or deleted — and a merged duplicate hands its
//     assignment to the product it was merged into.
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
type Row = { id: string; assigned?: boolean; store?: { id: string; name: string } | null; shop_unavailable?: string | null; in_stock?: boolean; audience?: string };

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const storeIds: string[] = [];
  const productIds: string[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const adminIds: string[] = [];

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
    const ops = await prisma.admin.create({ data: { name: `QA RepProd Ops ${stamp}`, email: `qa.repprod.ops.${stamp}@cesto.test`, password_hash: 'x', role: 'ops' }, select: { id: true, email: true, role: true } });
    adminIds.push(ops.id);
    const opsToken = generateAdminAccessToken({ adminId: ops.id, email: ops.email, role: ops.role });

    const mkStore = async (label: string) => {
      const s = await prisma.store.create({ data: { name: `QA RepProd Shop ${label} ${stamp}`, slug: `qa-repprod-shop-${label.toLowerCase()}-${stamp}`, status: 'live', is_active: true }, select: { id: true, name: true } });
      storeIds.push(s.id);
      return s;
    };
    const X = await mkStore('X');
    const Y = await mkStore('Y');
    const Z = await mkStore('Z');
    const mkProduct = async (storeId: string | null, label: string, active = true) => {
      const p = await prisma.product.create({
        data: {
          name_es: `QA RepProd ${label} ${stamp}`, name_en: `QA RepProd ${label} ${stamp}`, category_id: category.id, store_id: storeId, is_active: active,
          variants: { create: [{ name_es: 'Unidad', name_en: 'Unit', price: 4, stock_quantity: 50, is_default: true }] },
        },
        select: { id: true, name_es: true, variants: { select: { id: true } } },
      });
      productIds.push(p.id);
      return { id: p.id, name: p.name_es, size: p.variants[0].id };
    };
    const px = await mkProduct(X.id, 'X1');
    const py = await mkProduct(Y.id, 'Y1');
    const pyOff = await mkProduct(Y.id, 'Y2-inactive', false);
    const pz = await mkProduct(Z.id, 'Z1');
    const pHouse = await mkProduct(null, 'House1');

    // Rep A sells from shop X.
    const repEmail = `qa.repprod.${stamp}@cesto.test`;
    const granted = await call('/api/admin/sales-reps', { method: 'POST', token: adminToken, body: { name: 'QA RepProd Rep', email: repEmail, send_credentials: false, store_ids: [X.id] } });
    const repId = granted.body.data?.user_id as string;
    if (repId) userIds.push(repId);
    check('a rep is granted with shop X', granted.status === 201 && granted.body.data?.assigned_products === 0, { status: granted.status, error: granted.body.error, assigned: granted.body.data?.assigned_products });
    const repToken = generateAccessToken({ userId: repId, email: repEmail });
    const client = await prisma.user.create({ data: { name: `QA RepProd Client ${stamp}`, email: `qa.repprod.client.${stamp}@cesto.test`, created_by_sales_rep_id: repId }, select: { id: true } });
    userIds.push(client.id);
    const addr = await prisma.address.create({ data: { user_id: client.id, contact_name: 'QA', contact_phone: '600000007', street_line_1: 'C/ Producto 7', postcode: '28016', city: 'Madrid', province: 'Madrid' }, select: { id: true } });

    const me = async (token = repToken) => (await call('/api/sales/me', { token })).body.data;
    const catalogueRows = async (extra = '', token = repToken): Promise<Row[]> =>
      (await call(`/api/sales/catalogue/products?limit=100&q=${encodeURIComponent('QA RepProd')}${extra}`, { token })).body.data?.items ?? [];
    const catalogue = async (extra = '', token = repToken) => (await catalogueRows(extra, token)).map((p) => p.id);
    const order = (variantIds: string[], token = repToken, userId = client.id, addressId = addr.id) =>
      call('/api/sales/orders', { method: 'POST', token, body: { user_id: userId, address_id: addressId, delivery_fee: 0, items: variantIds.map((variant_id) => ({ variant_id, quantity: 1 })) } });
    const assign = (ids: string[], token = adminToken, rep = repId) => call(`/api/admin/sales-reps/${rep}/products`, { method: 'POST', token, body: { product_ids: ids } });
    const unassign = (ids: string[], rep = repId) => call(`/api/admin/sales-reps/${rep}/products/remove`, { method: 'POST', token: adminToken, body: { product_ids: ids } });
    const assignedList = async (rep = repId): Promise<Row[]> => (await call(`/api/admin/sales-reps/${rep}/products?limit=200`, { token: adminToken })).body.data?.items ?? [];

    // ─── 1. Before: their shop only ─────────────────────────
    const before = await catalogue();
    check('before any assignment the catalogue holds X\'s product only', before.includes(px.id) && !before.includes(py.id) && !before.includes(pHouse.id), before);
    const yBefore = await order([py.size]);
    check('...and an order with Y\'s product is refused', yBefore.status === 422 && yBefore.body.data?.code === 'rep_outside_store', yBefore.status);

    // ─── 2. The admin's picker ──────────────────────────────
    const found = await call(`/api/admin/sales-reps/${repId}/products/search?q=${encodeURIComponent(`QA RepProd`)}&limit=100`, { token: adminToken });
    const foundIds = ((found.body.data?.items ?? []) as Row[]).map((r) => r.id);
    check('the picker searches every shop\'s active products, Cesto\'s own included',
      found.status === 200 && [px.id, py.id, pz.id, pHouse.id].every((id) => foundIds.includes(id)) && !foundIds.includes(pyOff.id), { status: found.status, foundIds });
    const onlyY = ((await call(`/api/admin/sales-reps/${repId}/products/search?q=QA%20RepProd&storeId=${Y.id}`, { token: adminToken })).body.data?.items ?? []) as Row[];
    check('...narrows to one shop', onlyY.length === 1 && onlyY[0].id === py.id && onlyY[0].store?.name === Y.name, onlyY);

    // ─── 3. Assigning ───────────────────────────────────────
    const byOps = await assign([py.id], opsToken);
    check('an ops admin cannot assign products', byOps.status === 403, byOps.status);
    const a1 = await assign([py.id, pHouse.id, py.id]);
    check('a super admin assigns Y\'s product and one of Cesto\'s own', a1.status === 201 && a1.body.data?.added === 2 && a1.body.data?.total === 2, a1.body);
    const again = await assign([py.id]);
    check('assigning one already theirs is harmless', again.status === 201 && again.body.data?.added === 0 && again.body.data?.total === 2, again.body);
    const ghost = await assign(['00000000-0000-0000-0000-000000000000']);
    check('a product that does not exist is refused', ghost.status === 422, ghost.status);
    const marked = ((await call(`/api/admin/sales-reps/${repId}/products/search?q=QA%20RepProd&limit=100`, { token: adminToken })).body.data?.items ?? []) as Row[];
    check('the picker now marks them as assigned', marked.find((r) => r.id === py.id)?.assigned === true && marked.find((r) => r.id === pz.id)?.assigned === false);
    const search = async (extra: string): Promise<Row[]> =>
      ((await call(`/api/admin/sales-reps/${repId}/products/search?q=QA%20RepProd&limit=100${extra}`, { token: adminToken })).body.data?.items ?? []) as Row[];
    const notYet = (await search('&assigned=false')).map((r) => r.id);
    check('assigned=false leaves out the ones already theirs', notYet.includes(px.id) && notYet.includes(pz.id) && !notYet.includes(py.id) && !notYet.includes(pHouse.id), notYet);
    const theirs = (await search('&assigned=true')).map((r) => r.id).sort();
    check('assigned=true holds only theirs', theirs.join() === [py.id, pHouse.id].sort().join(), theirs);
    const asc = (await search('')).map((r) => r.id);
    const desc = (await search('&sort=name_desc')).map((r) => r.id);
    check('sort=name_desc reverses the default A–Z', asc.length > 1 && desc.join() === [...asc].reverse().join(), { asc, desc });
    check('a row says if it is in stock and who it is shown to', marked.find((r) => r.id === pz.id)?.in_stock === true && marked.find((r) => r.id === pz.id)?.audience === 'all');
    check('stock=out finds none of these (all in stock)', (await search('&stock=out')).length === 0);
    const badSort = await call(`/api/admin/sales-reps/${repId}/products/search?sort=price`, { token: adminToken });
    check('an unknown sort is refused', badSort.status === 422, badSort.status);
    const list = await assignedList();
    check('the admin list holds both, with their shop (none for Cesto\'s own)',
      list.length === 2 && list.find((r) => r.id === py.id)?.store?.id === Y.id && list.find((r) => r.id === pHouse.id)?.store === null, list);
    const repRow = ((await call('/api/admin/sales-reps?q=QA%20RepProd', { token: adminToken })).body.data?.items ?? []).find((r: { user_id: string }) => r.user_id === repId);
    check('the reps list counts them', repRow?.assigned_products === 2, repRow?.assigned_products);

    // ─── 4. The rep's catalogue ─────────────────────────────
    check('/sales/me says how many they can sell', (await me())?.assigned_products === 2, (await me())?.assigned_products);
    const rows = await catalogueRows();
    const ids = rows.map((r) => r.id);
    check('the catalogue holds X\'s product AND the assigned ones — not Z\'s, not Y\'s inactive one',
      ids.includes(px.id) && ids.includes(py.id) && ids.includes(pHouse.id) && !ids.includes(pz.id) && !ids.includes(pyOff.id), ids);
    check('...each row says whether it is theirs by hand', rows.find((r) => r.id === py.id)?.assigned === true && rows.find((r) => r.id === px.id)?.assigned === false);
    const mine = await catalogue('&assigned=true');
    check('assigned=true narrows to the assigned ones', mine.length === 2 && mine.includes(py.id) && mine.includes(pHouse.id), mine);
    const viaY = await catalogue(`&storeId=${Y.id}`);
    check('a storeId filter for the assigned product\'s shop finds only it', viaY.length === 1 && viaY[0] === py.id, viaY);
    const cat = ((await call('/api/sales/catalogue/categories', { token: repToken })).body.data ?? []).find((c: { id: string }) => c.id === category.id);
    check('category counts take in the assigned products', cat && cat.shop_products >= 3, cat?.shop_products);

    // ─── 5. Orders ──────────────────────────────────────────
    const made = await order([px.size, py.size, pHouse.size]);
    const madeId = made.body.data?.order?.id as string | undefined;
    if (madeId) orderIds.push(madeId);
    check('one order takes X\'s product and the two assigned ones — Cesto\'s, not split',
      made.status === 201 && made.body.data?.order?.store_id === null && (made.body.data?.order?.items ?? []).length === 3,
      { status: made.status, error: made.body.error, lines: (made.body.data?.order?.items ?? []).length });
    const withZ = await order([px.size, pz.size]);
    check('Z\'s product, neither theirs nor assigned, is refused by name', withZ.status === 422 && withZ.body.data?.code === 'rep_outside_store' && withZ.body.data?.products?.join() === pz.name, withZ.body.data);
    if (madeId) {
      const addZ = await call(`/api/sales/orders/${madeId}/items`, { method: 'PUT', token: repToken, body: { operations: [{ action: 'add', new_variant_id: pz.size, new_quantity: 1 }] } });
      check('editing: Z\'s product cannot be added', addZ.status === 422 && addZ.body.data?.code === 'rep_outside_store', addZ.status);
      await assign([pz.id]);
      const addZ2 = await call(`/api/sales/orders/${madeId}/items`, { method: 'PUT', token: repToken, body: { operations: [{ action: 'add', new_variant_id: pz.size, new_quantity: 1 }] } });
      check('...and can once it is assigned — from the rep\'s very next request', addZ2.status === 200, { status: addZ2.status, error: addZ2.body.error });
    }

    // ─── 6. Taken away ──────────────────────────────────────
    const off = await unassign([py.id]);
    check('the admin takes Y\'s product off', off.status === 200 && off.body.data?.removed === 1 && off.body.data?.total === 2, off.body);
    check('...it leaves the catalogue', !(await catalogue()).includes(py.id));
    const yAgain = await order([py.size]);
    check('...and orders refuse it again', yAgain.status === 422 && yAgain.body.data?.code === 'rep_outside_store', yAgain.status);
    if (madeId) {
      const line = await prisma.orderItem.findFirst({ where: { order_id: madeId, variant_id: py.size }, select: { id: true } });
      const qty = await call(`/api/sales/orders/${madeId}/items`, { method: 'PUT', token: repToken, body: { operations: [{ action: 'update_qty', order_item_id: line!.id, new_quantity: 2 }] } });
      check('...while its line already on an order can still be changed', qty.status === 200, { status: qty.status, error: qty.body.error });
    }

    // ─── 7. Inactive, suspended shop, deleted ───────────────
    await assign([py.id, pyOff.id]);
    check('an assigned product that is inactive does not show', !(await catalogue()).includes(pyOff.id));
    await prisma.store.update({ where: { id: Y.id }, data: { status: 'suspended' } });
    check('an assigned product whose shop is suspended leaves the catalogue', !(await catalogue()).includes(py.id));
    const ySusp = await order([py.size]);
    check('...orders refuse it', ySusp.status === 422 && ySusp.body.data?.code === 'rep_outside_store', ySusp.status);
    const flagged = (await assignedList()).find((r) => r.id === py.id);
    check('...and the admin list says why', flagged?.shop_unavailable === 'suspended', flagged);
    check('...and it is not counted as sellable', (await me())?.assigned_products === 2, (await me())?.assigned_products);
    type Shop = { store: { id: string; name: string } | null; count: number; hidden: number };
    const listOf = async (extra = '') => (await call(`/api/admin/sales-reps/${repId}/products?limit=200${extra}`, { token: adminToken })).body;
    const all = (await listOf()).data;
    const byShop = (all?.by_shop ?? []) as Shop[];
    const yShop = byShop.find((g) => g.store?.id === Y.id);
    check("by_shop counts Y's two, both hidden (one inactive, its shop suspended)", yShop?.count === 2 && yShop?.hidden === 2 && yShop?.store?.name === Y.name, yShop);
    check("...Z's one, shown, and Cesto's own as store null",
      byShop.find((g) => g.store?.id === Z.id)?.hidden === 0 && byShop.find((g) => g.store === null)?.count === 1 && byShop.length === 3, byShop);
    check('...biggest first', byShop[0]?.store?.id === Y.id, byShop.map((g) => g.count));
    const onlyYList = (await listOf(`&storeId=${Y.id}`)).data;
    check('storeId narrows the list to one shop; by_shop still counts them all',
      onlyYList?.total === 2 && (onlyYList?.items as Row[]).every((r) => r.store?.id === Y.id) && (onlyYList?.by_shop as Shop[]).length === 3, onlyYList?.total);
    const onlyHouse = (await listOf('&storeId=cesto')).data;
    check("storeId=cesto is Cesto's own", onlyHouse?.total === 1 && (onlyHouse?.items as Row[])[0]?.id === pHouse.id, onlyHouse?.total);
    const badShop = await call(`/api/admin/sales-reps/${repId}/products?storeId=nope`, { token: adminToken });
    check('a storeId that is not a shop is refused', badShop.status === 422, badShop.status);
    await prisma.store.update({ where: { id: Y.id }, data: { status: 'live' } });

    // ─── 8. A rep with assigned products and no shop ────────
    const soloEmail = `qa.repprod.solo.${stamp}@cesto.test`;
    const solo = await call('/api/admin/sales-reps', { method: 'POST', token: adminToken, body: { name: 'QA RepProd Solo', email: soloEmail, send_credentials: false } });
    const soloId = solo.body.data?.user_id as string;
    if (soloId) userIds.push(soloId);
    const soloToken = generateAccessToken({ userId: soloId, email: soloEmail });
    const soloClient = await prisma.user.create({ data: { name: `QA RepProd Solo Client ${stamp}`, email: `qa.repprod.solo.client.${stamp}@cesto.test`, created_by_sales_rep_id: soloId }, select: { id: true } });
    userIds.push(soloClient.id);
    const soloAddr = await prisma.address.create({ data: { user_id: soloClient.id, contact_name: 'QA', contact_phone: '600000008', street_line_1: 'C/ Solo 8', postcode: '28016', city: 'Madrid', province: 'Madrid' }, select: { id: true } });
    const empty = await order([pz.size], soloToken, soloClient.id, soloAddr.id);
    check('with nothing assigned, a rep without a shop cannot order', empty.status === 422 && empty.body.data?.code === 'rep_no_store', empty.status);
    await assign([pz.id], adminToken, soloId);
    const soloMe = await me(soloToken);
    check('with one product assigned, they have no shop but one product to sell', Array.isArray(soloMe?.stores) && soloMe.stores.length === 0 && soloMe?.assigned_products === 1, soloMe && { stores: soloMe.stores, assigned: soloMe.assigned_products });
    const soloSeen = await catalogue('', soloToken);
    check('...their catalogue holds just it', soloSeen.length === 1 && soloSeen[0] === pz.id, soloSeen);
    const soloOrder = await order([pz.size], soloToken, soloClient.id, soloAddr.id);
    if (soloOrder.body.data?.order?.id) orderIds.push(soloOrder.body.data.order.id);
    check('...and an order with it is created', soloOrder.status === 201, { status: soloOrder.status, error: soloOrder.body.error });
    const soloQuick = await call('/api/sales/products/quick', { method: 'POST', token: soloToken, body: { name_es: `QA RepProd Quick ${stamp}`, name_en: `QA RepProd Quick ${stamp}`, category_id: category.id, vat_category: 'reduced', price: 3 } });
    if (soloQuick.body.data?.id) productIds.push(soloQuick.body.data.id);
    check('...but quick-add has no shop to put a product in', soloQuick.status === 422 && soloQuick.body.data?.code === 'rep_no_store' && /shops/.test(soloQuick.body.error ?? ''), { status: soloQuick.status, error: soloQuick.body.error });

    // ─── 9. Merged and deleted ──────────────────────────────
    const dup = await mkProduct(Z.id, 'Z1-duplicate');
    await assign([dup.id], adminToken, soloId);
    const merged = await call('/api/admin/products/duplicates/merge', { method: 'POST', token: adminToken, body: { groups: [{ keep_id: px.id, remove_ids: [dup.id] }] } });
    productIds.splice(productIds.indexOf(dup.id), 1);
    const soloList = (await assignedList(soloId)).map((r) => r.id);
    check('a merged duplicate hands its assignment to the product kept', merged.status === 200 && soloList.includes(px.id) && !soloList.includes(dup.id), { status: merged.status, error: merged.body.error, soloList });
    const gone = await mkProduct(Z.id, 'Z3-deleted');
    await assign([gone.id], adminToken, soloId);
    await prisma.productVariant.deleteMany({ where: { product_id: gone.id } });
    await prisma.product.delete({ where: { id: gone.id } });
    productIds.splice(productIds.indexOf(gone.id), 1);
    check('a product deleted for good leaves the rep\'s list', !(await assignedList(soloId)).some((r) => r.id === gone.id));
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
    if (adminIds.length) await prisma.admin.deleteMany({ where: { id: { in: adminIds } } });
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
