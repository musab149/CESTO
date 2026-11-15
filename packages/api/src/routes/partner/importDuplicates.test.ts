// ─── Integration tests · partner import-duplicate queue ────
//
// Covers /api/partner/products/import-duplicates. The rules worth pinning are
// the ones a typecheck cannot see:
//
//   · store scoping — another store's queued row is invisible, and its id is
//     404 on every mutation (not 403, so the endpoint cannot enumerate)
//   · create uses store_id from the JWT, NOT from the stored payload, so a
//     tampered payload cannot plant a product in someone else's store
//   · pending is a state machine: create/dismiss twice must 409, not double-
//     create a product
//   · dismiss-all only touches this store's pending rows
//
// Ephemeral port, own fixtures, cleaned up in a finally block.
//
// Run:  cd packages/api && npm run test:partner-import-duplicates

import http from 'http';
import app from '../../server';
import prisma from '../../lib/prisma';
import { generateAccessToken } from '../../lib/jwt';

let base = '';
let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

async function req(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const stamp = Date.now();
  let storeA = '';
  let storeB = '';
  let userA = '';
  let categoryId = '';
  const createdProductIds: string[] = [];

  const payload = (over: Record<string, unknown> = {}) => ({
    product_key: 'k',
    name_es: 'Producto Importado',
    name_en: 'Imported Product',
    description_es: null,
    description_en: null,
    brand: 'TestBrand',
    origin: null,
    brand_id: null,
    origin_id: null,
    category_id: categoryId,
    subcategory_id: null,
    product_type_id: null,
    is_active: true,
    variants: [{
      name_es: '1kg', name_en: '1kg', price: 9.5,
      compare_at_price: null, b2b_price: null,
      stock_quantity: 10, low_stock_threshold: 2,
      sku: null, is_default: true, is_active: true,
    }],
    image_urls: [],
    ...over,
  });

  try {
    const cat = await prisma.category.findFirst({ select: { id: true } });
    if (!cat) throw new Error('No category in the database — seed one first.');
    categoryId = cat.id;

    const a = await prisma.store.create({
      data: { name: `ImpDupA ${stamp}`, slug: `impdupa-${stamp}`, status: 'live', is_active: true },
      select: { id: true },
    });
    const b = await prisma.store.create({
      data: { name: `ImpDupB ${stamp}`, slug: `impdupb-${stamp}`, status: 'live', is_active: true },
      select: { id: true },
    });
    storeA = a.id;
    storeB = b.id;

    const u = await prisma.user.create({
      data: {
        name: 'Import Dup Partner',
        email: `impdup-${stamp}@cesto.local`,
        phone: `+3461000${String(stamp).slice(-4)}`,
        password_hash: 'x'.repeat(60),
        status: 'active',
      },
      select: { id: true },
    });
    userA = u.id;
    await prisma.partnerStoreRole.create({
      data: { user_id: userA, store_id: storeA, role: 'owner' },
    });
    const token = generateAccessToken({ userId: userA, email: `impdup-${stamp}@cesto.local` } as any);

    const jobFor = async (storeId: string) =>
      (await prisma.partnerProductImportJob.create({
        data: {
          store_id: storeId, partner_user_id: userA,
          idempotency_key: `k-${storeId}-${stamp}`,
          status: 'done', filename: 'catalogue.xlsx', file_size: 1234,
        },
        select: { id: true },
      })).id;

    const queue = async (storeId: string, over: Record<string, unknown> = {}, row = 2) =>
      (await prisma.partnerProductImportDuplicate.create({
        data: {
          job_id: await jobFor(storeId),
          store_id: storeId,
          source_row_number: row,
          payload: payload(over) as any,
          matched_product_id: null,
          matched_product_name: 'Existing Product',
        },
        select: { id: true },
      })).id;

    // ── auth ────────────────────────────────────────────
    console.log('\nAuthentication');
    {
      const r = await req('GET', '/api/partner/products/import-duplicates');
      check('unauthenticated request is rejected', r.status === 401, r.status);
    }

    // ── listing + scoping ───────────────────────────────
    console.log('\nListing and store scoping');
    const rowA = await queue(storeA);
    const rowB = await queue(storeB);
    {
      const r = await req('GET', '/api/partner/products/import-duplicates', token);
      const items = r.body?.data?.items ?? [];
      check('lists this store\'s pending rows', r.status === 200 && items.length === 1, { status: r.status, n: items.length });
      check('it is the right row', items[0]?.id === rowA, items[0]?.id);
      check("another store's row is absent", !items.some((i: any) => i.id === rowB), items.map((i: any) => i.id));
    }
    {
      const r = await req('POST', `/api/partner/products/import-duplicates/${rowB}/dismiss`, token, {});
      check("cannot dismiss another store's row", r.status === 404, r.status);
      const missing = await req('POST', '/api/partner/products/import-duplicates/00000000-0000-4000-8000-0000000000aa/dismiss', token, {});
      check('and it is indistinguishable from a missing row',
        r.status === missing.status && r.body?.error === missing.body?.error,
        { other: r.body?.error, missing: missing.body?.error });
    }
    {
      const r = await req('POST', `/api/partner/products/import-duplicates/${rowB}/create`, token, {});
      check("cannot create from another store's row", r.status === 404, r.status);
      const still = await prisma.partnerProductImportDuplicate.findUnique({
        where: { id: rowB }, select: { status: true },
      });
      check('that row is still pending', still?.status === 'pending', still?.status);
    }

    // ── create ──────────────────────────────────────────
    console.log('\nCreate anyway');
    {
      const r = await req('POST', `/api/partner/products/import-duplicates/${rowA}/create`, token, {});
      check('creates the product', r.status === 200 && !!r.body?.data?.id, r.body);
      const pid = r.body?.data?.id;
      if (pid) createdProductIds.push(pid);

      const created = await prisma.product.findUnique({
        where: { id: pid },
        select: { store_id: true, name_es: true, _count: { select: { variants: true } } },
      });
      check('it lands in the partner\'s own store', created?.store_id === storeA, created?.store_id);
      check('with its variants', created?._count.variants === 1, created?._count.variants);

      const row = await prisma.partnerProductImportDuplicate.findUnique({
        where: { id: rowA }, select: { status: true, resolved_at: true },
      });
      check('the queue row is marked created', row?.status === 'created', row?.status);
      check('and stamped resolved_at', !!row?.resolved_at, row?.resolved_at);
    }
    {
      const r = await req('POST', `/api/partner/products/import-duplicates/${rowA}/create`, token, {});
      check('creating twice is refused', r.status === 409, r.status);
      const n = await prisma.product.count({ where: { store_id: storeA, name_es: 'Producto Importado' } });
      check('and no second product appears', n === 1, n);
    }

    // ── payload store_id cannot redirect the create ─────
    console.log('\nPayload tampering');
    {
      // A payload naming ANOTHER store. store_id must come from the JWT.
      const tampered = await queue(storeA, { store_id: storeB, name_es: 'Tampered Product' });
      const r = await req('POST', `/api/partner/products/import-duplicates/${tampered}/create`, token, {});
      const pid = r.body?.data?.id;
      if (pid) createdProductIds.push(pid);
      const created = pid
        ? await prisma.product.findUnique({ where: { id: pid }, select: { store_id: true } })
        : null;
      check('store_id in the payload is ignored', created?.store_id === storeA, created?.store_id);
      const leaked = await prisma.product.count({ where: { store_id: storeB } });
      check('nothing landed in the other store', leaked === 0, leaked);
    }

    // ── dismiss ─────────────────────────────────────────
    console.log('\nDismiss');
    {
      const row = await queue(storeA, { name_es: 'To Dismiss' }, 5);
      const r = await req('POST', `/api/partner/products/import-duplicates/${row}/dismiss`, token, {});
      check('dismisses a pending row', r.status === 200, r.body);
      const after = await prisma.partnerProductImportDuplicate.findUnique({
        where: { id: row }, select: { status: true },
      });
      check('status becomes dismissed', after?.status === 'dismissed', after?.status);

      const again = await req('POST', `/api/partner/products/import-duplicates/${row}/dismiss`, token, {});
      check('dismissing twice is refused', again.status === 409, again.status);

      const list = await req('GET', '/api/partner/products/import-duplicates', token);
      check('dismissed rows leave the pending list',
        !(list.body?.data?.items ?? []).some((i: any) => i.id === row),
        (list.body?.data?.items ?? []).map((i: any) => i.id));

      const all = await req('GET', '/api/partner/products/import-duplicates?status=all', token);
      check('but remain visible under status=all',
        (all.body?.data?.items ?? []).some((i: any) => i.id === row),
        (all.body?.data?.items ?? []).length);
    }

    // ── dismiss-all ─────────────────────────────────────
    console.log('\nDismiss all');
    {
      await queue(storeA, { name_es: 'Bulk 1' }, 7);
      await queue(storeA, { name_es: 'Bulk 2' }, 8);
      const r = await req('POST', '/api/partner/products/import-duplicates/dismiss-all', token, {});
      check('dismisses every pending row', r.status === 200 && r.body?.data?.dismissed === 2, r.body?.data);

      const mine = await prisma.partnerProductImportDuplicate.count({
        where: { store_id: storeA, status: 'pending' },
      });
      check('none of this store\'s rows are left pending', mine === 0, mine);

      const theirs = await prisma.partnerProductImportDuplicate.findUnique({
        where: { id: rowB }, select: { status: true },
      });
      check("the other store's row is untouched", theirs?.status === 'pending', theirs?.status);
    }

    // ── bad status filter ───────────────────────────────
    console.log('\nValidation');
    {
      const r = await req('GET', '/api/partner/products/import-duplicates?status=bogus', token);
      check('rejects an unknown status filter', r.status === 422, r.status);
    }
  } finally {
    if (createdProductIds.length) {
      await prisma.productVariant.deleteMany({ where: { product_id: { in: createdProductIds } } });
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    }
    for (const sid of [storeA, storeB].filter(Boolean)) {
      await prisma.partnerProductImportDuplicate.deleteMany({ where: { store_id: sid } });
      await prisma.partnerProductImportJob.deleteMany({ where: { store_id: sid } });
      await prisma.product.deleteMany({ where: { store_id: sid } });
    }
    if (userA) await prisma.partnerStoreRole.deleteMany({ where: { user_id: userA } });
    if (userA) await prisma.user.delete({ where: { id: userA } }).catch(() => {});
    for (const sid of [storeA, storeB].filter(Boolean)) {
      await prisma.store.delete({ where: { id: sid } }).catch(() => {});
    }
    await new Promise<void>((r) => server.close(() => r()));
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
