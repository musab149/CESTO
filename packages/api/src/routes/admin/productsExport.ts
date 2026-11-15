import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import prisma from '../../lib/prisma';
import { VAT_RATES } from '../../lib/tax';
import { error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';

// Hard cap so a mistake (forgetting to apply filters on a huge catalogue)
// can't hang the API. Above this we ask the admin to narrow the filter.
const MAX_EXPORT_ROWS = 20_000;

const router = Router();

// ─── Column definitions ────────────────────────────────
// STRICT 1:1 with the IMPORT template
// (packages/api/src/routes/admin/productsImport.ts:60). Every heading here
// must appear in the importer's COLUMNS array, in the same order and with
// the same width — that way a plain export → tweak → re-import round-trips
// through the existing bulk importer with zero column drift.
// Do NOT add admin-only informational columns here; they'd break the
// round-trip contract and confuse admins re-uploading their edits.

interface ExportColumn {
  key: string;
  header: string;
  width: number;
}

const EXPORT_COLUMNS: ExportColumn[] = [
  // Grouping key — importer merges rows that share product_key into one
  // product. We emit the product's UUID here so identical products cluster
  // naturally, and re-imports would treat it as one product.
  { key: 'product_key',        header: 'product_key',        width: 18 },
  { key: 'name_es',            header: 'name_es',            width: 28 },
  { key: 'name_en',            header: 'name_en',            width: 28 },
  { key: 'description_es',     header: 'description_es',     width: 40 },
  { key: 'description_en',     header: 'description_en',     width: 40 },
  { key: 'brand',              header: 'brand',              width: 16 },
  { key: 'origin',             header: 'origin',             width: 16 },
  { key: 'store_slug',         header: 'store_slug',         width: 16 },
  { key: 'store_name',         header: 'store_name',         width: 20 },
  { key: 'category',           header: 'category',           width: 22 },
  { key: 'subcategory',        header: 'subcategory',        width: 22 },
  { key: 'product_type',       header: 'product_type',       width: 22 },
  { key: 'is_active',          header: 'is_active',          width: 10 },
  { key: 'is_featured',        header: 'is_featured',        width: 12 },
  { key: 'iva',                header: 'iva',                width: 8 },
  { key: 'variant_name_es',    header: 'variant_name_es',    width: 18 },
  { key: 'variant_name_en',    header: 'variant_name_en',    width: 18 },
  { key: 'price',              header: 'price',              width: 10 },
  { key: 'compare_at_price',   header: 'compare_at_price',   width: 16 },
  { key: 'b2b_price',          header: 'b2b_price',          width: 10 },
  { key: 'stock_quantity',     header: 'stock_quantity',     width: 14 },
  { key: 'low_stock_threshold',header: 'low_stock_threshold',width: 18 },
  { key: 'sku',                header: 'sku',                width: 14 },
  { key: 'is_default_variant', header: 'is_default_variant', width: 16 },
  { key: 'image_urls',         header: 'image_urls',         width: 50 },
];

// ─── Filter schema ─────────────────────────────────────
// Mirrors the shape of GET /api/admin/products so the export button on the
// admin ProductsPage can hand the current filter URL params through verbatim
// and users export "what they see". The `format` param is the only export-
// specific addition.

const exportQuerySchema = z.object({
  format:        z.enum(['csv', 'xlsx']).default('xlsx'),
  q:             z.string().max(200).optional(),
  categoryId:    z.string().uuid().optional(),
  subcategoryId: z.string().uuid().optional(),
  productTypeId: z.string().uuid().optional(),
  storeId:       z.string().uuid().optional(),
  brandId:       z.string().uuid().optional(),
  originId:      z.string().uuid().optional(),
  isActive:      z.enum(['true', 'false']).optional(),
  isFeatured:    z.enum(['true', 'false']).optional(),
  isVerified:    z.enum(['true', 'false']).optional(),
  isTopSeller:   z.enum(['true', 'false']).optional(),
  isSponsored:   z.enum(['true', 'false']).optional(),
  stock:         z.enum(['in', 'out', 'low']).optional(),
  lowStock:      z.enum(['true', 'false']).optional(),
  hasOrders:     z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'oldest', 'name_asc', 'name_desc', 'rating_desc']).optional(),
}).passthrough();

// ─── Row shape ─────────────────────────────────────────

interface ExportRow {
  product_key: string;
  name_es: string;
  name_en: string;
  description_es: string;
  description_en: string;
  brand: string;
  origin: string;
  store_slug: string;
  store_name: string;
  category: string;
  subcategory: string;
  product_type: string;
  is_active: string | boolean;
  is_featured: string | boolean;
  iva: number | string;
  variant_name_es: string;
  variant_name_en: string;
  price: string;
  compare_at_price: string;
  b2b_price: string;
  stock_quantity: number | string;
  low_stock_threshold: number | string;
  sku: string;
  is_default_variant: string | boolean;
  image_urls: string;
}

// ─── Helpers ───────────────────────────────────────────

/** RFC 4180 CSV escape. Wraps in quotes when the cell contains a comma,
 *  quote, or newline; doubles interior quotes. Numbers/booleans stringify
 *  naturally. */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  if (s === '') return '';
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ─── GET /api/admin/products/export ────────────────────

router.get('/', asyncHandler(async (req, res) => {
  const parsed = exportQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return error(
      res,
      parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      422,
    );
  }
  const {
    format,
    q, categoryId, subcategoryId, productTypeId, storeId, brandId, originId,
    isActive, isFeatured, isVerified, isTopSeller, isSponsored,
    stock, lowStock, hasOrders, sort,
  } = parsed.data;

  // Filter WHERE — deliberately duplicated from the list handler in
  // products.ts. The two must stay in lockstep so "what admin sees" and
  // "what admin exports" line up; drifting is worse than duplication.
  const where: Prisma.ProductWhereInput = {};
  if (categoryId)                 where.category_id     = categoryId;
  if (subcategoryId)              where.subcategory_id  = subcategoryId;
  if (productTypeId)              where.product_type_id = productTypeId;
  if (storeId)                    where.store_id        = storeId;
  if (brandId)                    where.brand_id        = brandId;
  if (originId)                   where.origin_id       = originId;
  if (isActive    !== undefined)  where.is_active       = isActive    === 'true';
  if (isFeatured  !== undefined)  where.is_featured     = isFeatured  === 'true';
  if (isVerified  !== undefined)  where.is_verified     = isVerified  === 'true';
  if (isTopSeller !== undefined)  where.is_top_seller   = isTopSeller === 'true';
  if (isSponsored !== undefined)  where.is_sponsored    = isSponsored === 'true';
  if (q) {
    where.OR = [
      { name_es: { contains: q, mode: 'insensitive' } },
      { name_en: { contains: q, mode: 'insensitive' } },
      { brand:   { contains: q, mode: 'insensitive' } },
    ];
  }
  const stockMode: 'in' | 'out' | 'low' | undefined =
    stock ?? (lowStock === 'true' ? 'low' : undefined);
  if (stockMode === 'in') {
    where.variants = { some: { stock_quantity: { gt: 0 } } };
  } else if (stockMode === 'out') {
    where.variants = { every: { stock_quantity: { lte: 0 } } };
  } else if (stockMode === 'low') {
    where.variants = { some: { stock_quantity: { gt: 0, lte: 10 } } };
  }
  if (hasOrders === 'true')  where.order_items = { some: {} };
  if (hasOrders === 'false') where.order_items = { none: {} };

  let orderBy: Prisma.ProductOrderByWithRelationInput | Prisma.ProductOrderByWithRelationInput[];
  switch (sort) {
    case 'oldest':      orderBy = { created_at: 'asc' };                          break;
    case 'name_asc':    orderBy = [{ name_es: 'asc' },  { name_en: 'asc' }];      break;
    case 'name_desc':   orderBy = [{ name_es: 'desc' }, { name_en: 'desc' }];     break;
    case 'rating_desc': orderBy = [{ rating: 'desc' }, { rating_count: 'desc' }]; break;
    case 'newest':
    default:            orderBy = { created_at: 'desc' };                         break;
  }

  // Safety cap. Count first so we can bail with a clear error before
  // dragging the full payload out of Postgres.
  const total = await prisma.product.count({ where });
  if (total > MAX_EXPORT_ROWS) {
    return error(
      res,
      `Export capped at ${MAX_EXPORT_ROWS.toLocaleString('en-US')} products (matched ${total.toLocaleString('en-US')}). ` +
      'Add filters (category, brand, store, status) to narrow the result and try again.',
      413,
    );
  }

  // Fetch only what the import-shaped export needs.
  const products = await prisma.product.findMany({
    where,
    orderBy,
    select: {
      id: true, name_es: true, name_en: true,
      description_es: true, description_en: true,
      brand: true, origin: true,
      is_active: true, is_featured: true,
      vat_category: true, vat_category_reviewed: true,
      category:     { select: { name_es: true } },
      subcategory:  { select: { name_es: true } },
      product_type: { select: { name_es: true } },
      store:        { select: { slug: true, name: true } },
      variants: {
        orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
        select: {
          name_es: true, name_en: true,
          price: true, compare_at_price: true, b2b_price: true,
          stock_quantity: true, low_stock_threshold: true,
          sku: true, is_default: true,
        },
      },
      images: {
        orderBy: [{ is_primary: 'desc' }, { sort_order: 'asc' }, { created_at: 'asc' }],
        select: { url: true },
      },
    },
  });

  // ─── Row expansion ──
  // One CSV/XLSX row per VARIANT. Product-level fields repeat only on the
  // first row of each product (mirrors the import template's "head row +
  // continuation rows" shape so a re-import doesn't create duplicates on
  // the product-level fields).
  const rows: ExportRow[] = [];
  for (const p of products) {
    // If a product has zero variants (edge case — normally validation
    // prevents this) still emit one row so it appears in the export.
    const variants = p.variants.length > 0
      ? p.variants
      : [{
          name_es: '', name_en: '',
          price: new Prisma.Decimal(0), compare_at_price: null, b2b_price: null,
          stock_quantity: 0, low_stock_threshold: 10,
          sku: null, is_default: false,
        } as typeof p.variants[number]];

    // Semicolon-joined image URLs on the head row only, matching the
    // import parser's convention.
    const imageUrls = p.images.map((img) => img.url).join(';');

    variants.forEach((v, idx) => {
      const isHead = idx === 0;
      rows.push({
        product_key:        p.id,
        name_es:            isHead ? p.name_es : '',
        name_en:            isHead ? p.name_en : '',
        description_es:     isHead ? (p.description_es ?? '') : '',
        description_en:     isHead ? (p.description_en ?? '') : '',
        brand:              isHead ? (p.brand ?? '') : '',
        origin:             isHead ? (p.origin ?? '') : '',
        store_slug:         isHead ? (p.store?.slug ?? '') : '',
        store_name:         isHead ? (p.store?.name ?? '') : '',
        category:           isHead ? (p.category?.name_es ?? '') : '',
        subcategory:        isHead ? (p.subcategory?.name_es ?? '') : '',
        product_type:       isHead ? (p.product_type?.name_es ?? '') : '',
        is_active:          isHead ? p.is_active   : '',
        is_featured:        isHead ? p.is_featured : '',
        // The rate somebody chose; blank when nobody has, so a re-import
        // leaves the product on the 0 % default rather than "choosing" it.
        iva:                isHead && p.vat_category_reviewed ? VAT_RATES[p.vat_category] : '',
        variant_name_es:    v.name_es,
        variant_name_en:    v.name_en,
        price:              v.price.toString(),
        compare_at_price:   v.compare_at_price ? v.compare_at_price.toString() : '',
        b2b_price:          v.b2b_price        ? v.b2b_price.toString()        : '',
        stock_quantity:     v.stock_quantity,
        low_stock_threshold:v.low_stock_threshold,
        sku:                v.sku ?? '',
        is_default_variant: v.is_default,
        image_urls:         isHead ? imageUrls : '',
      });
    });
  }

  const filename = `products-export-${todayStamp()}.${format === 'csv' ? 'csv' : 'xlsx'}`;

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // UTF-8 BOM so Excel opens accented Spanish characters correctly on
    // double-click. Without it "Aceite" imports as "AceÃ­te" on Windows.
    res.write('﻿');
    res.write(EXPORT_COLUMNS.map((c) => csvEscape(c.header)).join(',') + '\r\n');
    for (const row of rows) {
      const cells = EXPORT_COLUMNS.map((c) => csvEscape((row as unknown as Record<string, unknown>)[c.key]));
      res.write(cells.join(',') + '\r\n');
    }
    return res.end();
  }

  // XLSX branch ──
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cesto Admin';
  wb.created = new Date();
  const ws = wb.addWorksheet('Products');
  ws.columns = EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  // Header styling — same green fill as the import template so the two
  // sheets read as siblings.
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Outfit' };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F8B5C' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
  headerRow.height = 22;

  for (const row of rows) {
    ws.addRow(row);
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  return res.end();
}));

export default router;
