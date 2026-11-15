// ─── Integration test · what may change an existing product's sizes ───────
//
// Run:  cd packages/api && npm run test:product-size-guards
//
// The admin form and the bulk-edit grid are covered in productAudience.test.ts.
// These are the other routes that change the sizes of a product that already
// exists — a partner editing their own product, and merging duplicates (admin
// and partner) — which move, rewrite or add sizes:
//   · a partner's edit touches only the sizes of the product being edited;
//     every size's id is public in the shop's payloads, and an unscoped write
//     let a partner rewrite the price or stock of any size in the catalogue.
//
// Makes its own stores, partner and products, and deletes them afterwards.
import http from 'http';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAccessToken, generateAdminAccessToken } from '../lib/jwt';

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

  const storeIds: string[] = [];
  const productIds: string[] = [];
  const userIds: string[] = [];

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
    const category = await prisma.category.findFirst({ select: { id: true } });
    if (!category) { console.log('  SKIP  no category'); return; }
    const mkStore = async (label: string) => {
      const s = await prisma.store.create({ data: { name: `QA Sizes ${label} ${stamp}`, slug: `qa-sizes-${label}-${stamp}`, status: 'live', is_active: true }, select: { id: true } });
      storeIds.push(s.id);
      return s.id;
    };
    const mine = await mkStore('mine');
    const theirs = await mkStore('theirs');
    const partner = await prisma.user.create({
      data: { name: 'QA Sizes Partner', email: `qa.sizes.${stamp}@cesto.test`, password_hash: 'x'.repeat(60), status: 'active' },
      select: { id: true, email: true },
    });
    userIds.push(partner.id);
    await prisma.partnerStoreRole.create({ data: { user_id: partner.id, store_id: mine, role: 'owner' } });
    const partnerToken = generateAccessToken({ userId: partner.id, email: partner.email ?? undefined });

    /** A product with one size, at this price and B2B price. */
    const mkProduct = async (storeId: string | null, name: string, price: number, b2b: number | null) => {
      const p = await prisma.product.create({
        data: {
          name_es: name, name_en: name, category_id: category.id, store_id: storeId,
          variants: { create: [{ name_es: 'Unidad', name_en: 'Unit', price, b2b_price: b2b, stock_quantity: 10, is_default: true }] },
        },
        select: { id: true, variants: { select: { id: true } } },
      });
      productIds.push(p.id);
      return { id: p.id, size: p.variants[0].id };
    };
    const sizeOf = async (id: string) => {
      const v = await prisma.productVariant.findUnique({ where: { id }, select: { price: true, b2b_price: true, stock_quantity: true, name_es: true, product_id: true, is_active: true } });
      return v && { price: Number(v.price), b2b: v.b2b_price == null ? null : Number(v.b2b_price), stock: v.stock_quantity, name: v.name_es, product: v.product_id, active: v.is_active };
    };
    /** The partner form's body for one of their products. */
    const partnerBody = (sizes: Array<Record<string, unknown>>) => ({
      name_es: `QA Mío ${stamp}`, name_en: `QA Mine ${stamp}`, category_id: category.id, variants: sizes, images: [],
    });

    // ─── 1. A partner edits only their own product's sizes ───
    const own = await mkProduct(mine, `QA Mío ${stamp}`, 5, null);
    const victim = await mkProduct(theirs, `QA Ajeno ${stamp}`, 7, 6);
    const before = await sizeOf(victim.size);
    const sneaky = await call(`/api/partner/products/${own.id}`, {
      method: 'PATCH', token: partnerToken,
      body: partnerBody([
        { id: own.size, name_es: 'Unidad', name_en: 'Unit', price: 5, stock_quantity: 10, is_default: true },
        { id: victim.size, name_es: 'Hackeado', name_en: 'Hacked', price: 0.01, b2b_price: 0.01, stock_quantity: 0 },
      ]),
    });
    const after = await sizeOf(victim.size);
    check('a partner cannot rewrite another shop\'s size by sending it with their own product',
      sneaky.status === 422 && JSON.stringify(after) === JSON.stringify(before), { status: sneaky.status, error: sneaky.body?.error, before, after });
    check('...and nothing of theirs moved either (one transaction)', (await sizeOf(own.size))?.price === 5);
    const cesto = await mkProduct(null, `QA Cesto ${stamp}`, 9, 8);
    const cestoBefore = await sizeOf(cesto.size);
    await call(`/api/partner/products/${own.id}`, {
      method: 'PATCH', token: partnerToken,
      body: partnerBody([{ id: cesto.size, name_es: 'Unidad', name_en: 'Unit', price: 0.5, stock_quantity: 9999, is_default: true }]),
    });
    check('...nor one of Cesto\'s own', JSON.stringify(await sizeOf(cesto.size)) === JSON.stringify(cestoBefore), await sizeOf(cesto.size));
    const ok = await call(`/api/partner/products/${own.id}`, {
      method: 'PATCH', token: partnerToken,
      body: partnerBody([{ id: own.size, name_es: 'Unidad', name_en: 'Unit', price: 6, stock_quantity: 12, is_default: true }]),
    });
    check('their own size still edits as before', ok.status === 200 && (await sizeOf(own.size))?.price === 6 && (await sizeOf(own.size))?.stock === 12, { status: ok.status, error: ok.body?.error });

    // ─── 2. B2B only keeps a B2B price on every size (lib/audience) ──
    // Cesto shows one of the partner's products to B2B only; they cannot
    // change that, nor leave it with a size a business would pay retail for.
    const b2bOwn = await mkProduct(mine, `QA Mío ${stamp}`, 5, 4);
    await prisma.product.update({ where: { id: b2bOwn.id }, data: { audience: 'b2b' } });
    const emptied = await call(`/api/partner/products/${b2bOwn.id}`, {
      method: 'PATCH', token: partnerToken,
      body: partnerBody([{ id: b2bOwn.size, name_es: 'Unidad', name_en: 'Unit', price: 5, b2b_price: null, stock_quantity: 10, is_default: true }]),
    });
    check('a partner cannot empty the B2B price of a product Cesto shows to B2B only',
      emptied.status === 422 && emptied.body?.data?.code === 'b2b_price_required' && (await sizeOf(b2bOwn.size))?.b2b === 4,
      { status: emptied.status, error: emptied.body?.error, b2b: (await sizeOf(b2bOwn.size))?.b2b });
    const sizesBefore = await prisma.productVariant.count({ where: { product_id: b2bOwn.id } });
    const unpricedSize = await call(`/api/partner/products/${b2bOwn.id}`, {
      method: 'PATCH', token: partnerToken,
      body: partnerBody([
        { id: b2bOwn.size, name_es: 'Unidad', name_en: 'Unit', price: 5, b2b_price: 4, stock_quantity: 10, is_default: true },
        { name_es: 'Caja', name_en: 'Box', price: 40, stock_quantity: 5 },
      ]),
    });
    check('...nor add a size without one, and the size is not created',
      unpricedSize.status === 422 && (await prisma.productVariant.count({ where: { product_id: b2bOwn.id } })) === sizesBefore,
      { status: unpricedSize.status, error: unpricedSize.body?.error });
    const priced = await call(`/api/partner/products/${b2bOwn.id}`, {
      method: 'PATCH', token: partnerToken,
      body: partnerBody([
        { id: b2bOwn.size, name_es: 'Unidad', name_en: 'Unit', price: 5, b2b_price: 3.5, stock_quantity: 10, is_default: true },
        { name_es: 'Caja', name_en: 'Box', price: 40, b2b_price: 32, stock_quantity: 5 },
      ]),
    });
    check('...with a B2B price on each, the edit saves', priced.status === 200 && (await sizeOf(b2bOwn.size))?.b2b === 3.5, { status: priced.status, error: priced.body?.error });
    check('...and the product is still B2B only', (await prisma.product.findUnique({ where: { id: b2bOwn.id }, select: { audience: true } }))?.audience === 'b2b');

    // Admin's Duplicates → merge: sizes moving INTO a B2B-only product.
    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });
    const keep = await mkProduct(null, `QA Duplicado ${stamp}`, 10, 8);
    await prisma.product.update({ where: { id: keep.id }, data: { audience: 'b2b' } });
    const extra = await mkProduct(null, `QA Duplicado ${stamp}`, 18, null);
    const merge = (path: string, token: string, keepId: string, removeId: string) =>
      call(path, { method: 'POST', token, body: { groups: [{ keep_id: keepId, remove_ids: [removeId] }] } });
    const m1 = await merge('/api/admin/products/duplicates/merge', adminToken, keep.id, extra.id);
    check('admin merge: an unpriced size cannot move into a B2B-only product — skipped, saying why',
      m1.status === 200 && m1.body.data?.deleted === 0 && m1.body.data?.merged_variants === 0 && /B2B price/.test(m1.body.data?.skipped?.[0]?.reason ?? '')
        && (await sizeOf(extra.size))?.product === extra.id && !!(await prisma.product.findUnique({ where: { id: extra.id } })),
      m1.body.data);
    await prisma.productVariant.update({ where: { id: extra.size }, data: { b2b_price: 15 } });
    const m2 = await merge('/api/admin/products/duplicates/merge', adminToken, keep.id, extra.id);
    check('...priced, it merges', m2.body.data?.deleted === 1 && m2.body.data?.merged_variants === 1 && (await sizeOf(extra.size))?.product === keep.id, m2.body.data);
    const extraAll = await mkProduct(null, `QA Duplicado ${stamp}`, 20, null);
    const keepAll = await mkProduct(null, `QA Duplicado ${stamp}`, 11, null);
    const m3 = await merge('/api/admin/products/duplicates/merge', adminToken, keepAll.id, extraAll.id);
    check('...and merging into a product shown to everyone needs no B2B price', m3.body.data?.deleted === 1, m3.body.data);

    // The partner's own Duplicates → merge.
    const pKeep = await mkProduct(mine, `QA Duplicado P ${stamp}`, 6, 5);
    await prisma.product.update({ where: { id: pKeep.id }, data: { audience: 'b2b' } });
    const pExtra = await mkProduct(mine, `QA Duplicado P ${stamp}`, 12, null);
    const p1 = await merge('/api/partner/products/duplicates/merge', partnerToken, pKeep.id, pExtra.id);
    check('partner merge: the same refusal, skipped with the reason',
      p1.status === 200 && p1.body.data?.deleted === 0 && p1.body.data?.merged_variants === 0 && /B2B price/.test(p1.body.data?.skipped?.[0]?.reason ?? '') && (await sizeOf(pExtra.size))?.product === pExtra.id,
      p1.body.data);
    await prisma.productVariant.update({ where: { id: pExtra.size }, data: { b2b_price: 10 } });
    const p2 = await merge('/api/partner/products/duplicates/merge', partnerToken, pKeep.id, pExtra.id);
    check('...priced, it merges', p2.body.data?.deleted === 1 && (await sizeOf(pExtra.size))?.product === pKeep.id, p2.body.data);
  } finally {
    if (productIds.length) {
      await prisma.productImage.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (userIds.length) {
      await prisma.partnerStoreRole.deleteMany({ where: { user_id: { in: userIds } } });
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
