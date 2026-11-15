import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';

/**
 * Partner-scoped bulk product importer.
 *
 * Same enqueue → poll → job-worker contract as admin's importer at
 * routes/admin/productsImport.ts, but:
 *   · The importer table is `partner_product_import_jobs` (isolated from
 *     admin's job table) so a partner can never see admin's imports and
 *     vice versa.
 *   · `store_id` is FORCED from req.partnerRole.store.id on every product
 *     row — the workbook has no store_slug / store_name columns, and any
 *     stray values in a hand-edited sheet are ignored.
 *   · Brand / origin / category / subcategory / product-type all require
 *     an exact match against curated rows. Unknown values do NOT auto-
 *     create suggestions the way admin's importer does — partners can't
 *     grow the taxonomy. Rows with unknown category/subcategory/product-
 *     type surface as errors so the partner can fix the sheet or contact
 *     the Cesto admin to add the missing entry.
 *   · Rashan / pending queue plumbing is dropped — those are admin-only.
 *
 * Idempotency: SHA-256 of the file bytes. A same-file resubmit within
 * 1h returns the ORIGINAL job's id + `replay: true` — the client keeps
 * seeing the same report instead of double-importing.
 */

const IDEMPOTENCY_REPLAY_MS = 60 * 60 * 1000;
class ImportJobFailure extends Error {}

const router = Router();

// ─── Multer (in-memory) ────────────────────────────────

const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (ALLOWED_MIME.has(file.mimetype) || name.endsWith('.xlsx') || name.endsWith('.xls')) {
      return cb(null, true);
    }
    cb(new Error(`Unsupported file type: ${file.mimetype}. Upload a .xlsx or .xls file.`));
  },
});

// ─── Template columns ─────────────────────────────────
// Same shape as admin's minus the store_* columns (partner store is
// implicit) and minus the marketing signals partners don't control
// (is_verified / is_top_seller / is_sponsored — none of those are here).

interface ColumnSpec {
  key: string;
  header: string;
  width: number;
  example: string | number | boolean;
  note: string;
}

const COLUMNS: ColumnSpec[] = [
  { key: 'product_key',        header: 'product_key',        width: 18, example: 'P001',                          note: 'Group key. Rows sharing a product_key become one product with multiple variants. Not stored.' },
  { key: 'name_es',            header: 'name_es',            width: 28, example: 'Arroz Basmati Tilda',           note: 'Spanish product name. Required on the first row of each product_key.' },
  { key: 'name_en',            header: 'name_en',            width: 28, example: 'Tilda Basmati Rice',            note: 'English product name. Required on the first row of each product_key.' },
  { key: 'description_es',     header: 'description_es',     width: 40, example: 'Arroz basmati de grano largo.', note: 'Optional. Spanish description.' },
  { key: 'description_en',     header: 'description_en',     width: 40, example: 'Long-grain basmati rice.',      note: 'Optional. English description.' },
  { key: 'brand',              header: 'brand',              width: 16, example: 'Tilda',                         note: 'Optional. Must match a curated Cesto brand (case-insensitive). Unknown brands become blank; contact your admin to have new brands added.' },
  { key: 'origin',             header: 'origin',             width: 16, example: 'India',                         note: 'Optional. Must match a curated Cesto origin (case-insensitive). Unknown origins become blank.' },
  { key: 'category',           header: 'category',           width: 22, example: 'Arroz y Legumbres',             note: 'Required (first row). Must match a Cesto category name_es / name_en. Unknown categories fail the row.' },
  { key: 'subcategory',        header: 'subcategory',        width: 22, example: '',                              note: 'Optional. Must belong to the chosen category. Unknown subcategories fail the row.' },
  { key: 'product_type',       header: 'product_type',       width: 22, example: '',                              note: 'Optional third-tier taxonomy. Must belong to the chosen subcategory. Unknown types fail the row.' },
  { key: 'is_active',          header: 'is_active',          width: 10, example: true,                            note: 'Optional. TRUE/FALSE or 1/0. Default TRUE.' },
  { key: 'variant_name_es',    header: 'variant_name_es',    width: 18, example: '1 kg',                          note: 'Required. The variant label in Spanish (e.g. "1 kg", "Pack 3").' },
  { key: 'variant_name_en',    header: 'variant_name_en',    width: 18, example: '1 kg',                          note: 'Required. Same in English.' },
  { key: 'price',              header: 'price',              width: 10, example: 3.95,                            note: 'Required. B2C / customer price. EUR, two decimals. Use a number, not a string.' },
  { key: 'compare_at_price',   header: 'compare_at_price',   width: 16, example: '',                              note: 'Optional. Strike-through price for promos.' },
  { key: 'b2b_price',          header: 'b2b_price',          width: 10, example: 3.20,                            note: 'Optional. B2B / wholesale price shown only to approved business customers.' },
  { key: 'stock_quantity',     header: 'stock_quantity',     width: 14, example: 120,                             note: 'Required. Non-negative integer.' },
  { key: 'low_stock_threshold',header: 'low_stock_threshold',width: 18, example: 10,                              note: 'Optional. Default 10.' },
  { key: 'sku',                header: 'sku',                width: 14, example: 'TIL-BAS-1K',                    note: 'Optional. Free-text.' },
  { key: 'is_default_variant', header: 'is_default_variant', width: 16, example: true,                            note: 'Mark exactly one variant per product. If none, the first variant is used.' },
  { key: 'image_urls',         header: 'image_urls',         width: 50, example: 'https://example.com/a.jpg;https://example.com/b.jpg', note: 'Optional. Semicolon-separated. The first URL becomes the primary image.' },
];

const SAMPLE_ROWS: Array<Record<string, string | number | boolean>> = [
  {
    product_key: 'P001', name_es: 'Arroz Basmati Tilda', name_en: 'Tilda Basmati Rice',
    description_es: 'Arroz basmati de grano largo, aromático.', description_en: 'Long-grain aromatic basmati rice.',
    brand: 'Tilda', origin: 'India', category: 'Arroz y Legumbres', is_active: true,
    variant_name_es: '1 kg', variant_name_en: '1 kg', price: 3.95, compare_at_price: '', b2b_price: 3.20,
    stock_quantity: 120, low_stock_threshold: 15, sku: 'TIL-BAS-1K', is_default_variant: true,
    image_urls: '',
  },
  {
    product_key: 'P001', name_es: '', name_en: '',
    description_es: '', description_en: '', brand: '', origin: '', category: '', is_active: '',
    variant_name_es: '5 kg', variant_name_en: '5 kg', price: 17.50, compare_at_price: 19.95, b2b_price: 14.50,
    stock_quantity: 40, low_stock_threshold: 5, sku: 'TIL-BAS-5K', is_default_variant: false,
    image_urls: '',
  },
];

// ─── GET /api/partner/products/import/template ─────────

router.get('/template', asyncHandler(async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cesto Partner';
  wb.created = new Date();

  const ws = wb.addWorksheet('Products');
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  // Header styling
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6FD' } };
  header.height = 24;
  header.alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of SAMPLE_ROWS) ws.addRow(row);

  // Instructions sheet
  const notesSheet = wb.addWorksheet('Instructions');
  notesSheet.columns = [
    { header: 'Column',      key: 'header', width: 24 },
    { header: 'Note',        key: 'note',   width: 90 },
  ];
  const notesHeader = notesSheet.getRow(1);
  notesHeader.font = { bold: true };
  notesHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6FD' } };
  for (const c of COLUMNS) notesSheet.addRow({ header: c.header, note: c.note });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="partner-products-import-template.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

// ─── Cell parsers (same helpers as admin's importer) ────

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'text' in (value as any)) return String((value as any).text).trim();
  if (typeof value === 'object' && 'richText' in (value as any)) {
    return ((value as any).richText as Array<{ text: string }>).map((r) => r.text).join('').trim();
  }
  if (typeof value === 'object' && 'result' in (value as any)) {
    const r = (value as any).result;
    return r === null || r === undefined ? '' : String(r);
  }
  if (typeof value === 'object' && 'hyperlink' in (value as any)) return String((value as any).hyperlink).trim();
  return '';
}
function parseBool(raw: string, fallback: boolean): boolean {
  const v = raw.trim().toLowerCase();
  if (['true', 't', '1', 'yes', 'y', 'sí', 'si'].includes(v)) return true;
  if (['false', 'f', '0', 'no', 'n'].includes(v)) return false;
  return fallback;
}
function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function parseInt0(raw: string, fallback: number): number {
  const s = raw.trim();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

const IMAGE_URL_RE = /^(https?:\/\/|\/|data:|blob:)/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── POST /api/partner/products/import ────────────────

router.post(
  '/',
  upload.single('file') as unknown as import('express').RequestHandler,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return error(res, 'No file uploaded. Send field "file" as multipart/form-data.', 400);
    }
    const userId  = req.partnerRole!.user.id;
    const storeId = req.partnerRole!.store.id;

    const clientKey = (req.header('Idempotency-Key') ?? '').trim();
    const idempotencyKey = clientKey || createHash('sha256').update(req.file.buffer).digest('hex');

    // Concurrent-submit guard — one active job per store.
    const activeForStore = await prisma.partnerProductImportJob.findFirst({
      where: { store_id: storeId, status: { in: ['queued', 'running'] } },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    });
    if (activeForStore) {
      return success(res, { jobId: activeForStore.id, alreadyRunning: true }, 200);
    }

    // Same file within 1h → replay the previous report.
    const replayCandidate = await prisma.partnerProductImportJob.findFirst({
      where: {
        store_id: storeId,
        idempotency_key: idempotencyKey,
        status: 'done',
        finished_at: { gte: new Date(Date.now() - IDEMPOTENCY_REPLAY_MS) },
      },
      orderBy: { finished_at: 'desc' },
      select: { id: true },
    });
    if (replayCandidate) {
      return success(res, { jobId: replayCandidate.id, replay: true }, 200);
    }

    const job = await prisma.partnerProductImportJob.create({
      data: {
        partner_user_id: userId,
        store_id:        storeId,
        idempotency_key: idempotencyKey,
        status:          'queued',
        filename:        req.file.originalname,
        file_size:       req.file.size,
      },
      select: { id: true },
    });

    // Buffer copy so the file object can be GC'd — the worker owns its bytes.
    const buffer = Buffer.from(req.file.buffer);
    setImmediate(() => {
      runImportJobWorker(job.id, storeId, buffer).catch((e) => {
        // eslint-disable-next-line no-console
        console.error(`[partner-import] worker crashed for job ${job.id}:`, e);
      });
    });

    return success(res, { jobId: job.id, status: 'queued' }, 202);
  }),
);

// ─── GET /api/partner/products/import/jobs/:id ────────

router.get('/jobs/:id', asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const job = await prisma.partnerProductImportJob.findFirst({
    where: { id: req.params.id, store_id: storeId },
    select: {
      id: true, status: true, processed: true, total: true, result: true, error_message: true,
      filename: true, file_size: true, created_at: true, started_at: true, finished_at: true,
    },
  });
  if (!job) return error(res, 'Import job not found.', 404);
  return success(res, job);
}));

// ─── GET /api/partner/products/import/jobs ────────────

router.get('/jobs', asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '10'), 10) || 10));
  const jobs = await prisma.partnerProductImportJob.findMany({
    where: { store_id: storeId },
    orderBy: { created_at: 'desc' },
    take: limit,
    select: {
      id: true, status: true, processed: true, total: true, error_message: true,
      filename: true, file_size: true, created_at: true, started_at: true, finished_at: true,
    },
  });
  return success(res, jobs);
}));

// ─── Job worker ────────────────────────────────────────

interface RawRow {
  product_key: string;
  name_es: string; name_en: string;
  description_es: string; description_en: string;
  brand: string; origin: string;
  category: string; subcategory: string; product_type: string;
  is_active: string;
  variant_name_es: string; variant_name_en: string;
  price: string; compare_at_price: string; b2b_price: string;
  stock_quantity: string; low_stock_threshold: string;
  sku: string; is_default_variant: string;
  image_urls: string;
  _rowNumber: number;
}

interface ParsedVariant {
  name_es: string; name_en: string;
  price: number; compare_at_price: number | null; b2b_price: number | null;
  stock_quantity: number; low_stock_threshold: number;
  sku: string | null; is_default: boolean; is_active: boolean;
  _rowNumber: number;
}

interface ParsedProduct {
  product_key: string;
  name_es: string; name_en: string;
  description_es: string | null; description_en: string | null;
  brand: string | null; brand_id: string | null;
  origin: string | null; origin_id: string | null;
  category_id: string;
  subcategory_id: string | null;
  product_type_id: string | null;
  is_active: boolean;
  variants: ParsedVariant[];
  image_urls: string[];
  _rowNumber: number;
}

interface RowResult {
  row: number;
  product_key: string;
  status: 'created' | 'skipped' | 'error' | 'duplicate';
  productId?: string;
  productName?: string;
  variantCount?: number;
  error?: string;
  duplicate_of_id?: string;
  duplicate_of_source?: 'product';
  warnings?: string[];
}

async function runImportJobWorker(jobId: string, storeId: string, fileBuffer: Buffer): Promise<void> {
  await prisma.partnerProductImportJob.update({
    where: { id: jobId },
    data: { status: 'running', started_at: new Date() },
  });

  const failJob = async (message: string): Promise<never> => {
    await prisma.partnerProductImportJob.update({
      where: { id: jobId },
      data: { status: 'failed', error_message: message, finished_at: new Date() },
    });
    throw new ImportJobFailure(message);
  };

  try {
    // 1. Parse workbook
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);
    } catch (e) {
      return await failJob(`Could not read spreadsheet: ${(e as Error).message}`);
    }

    const ws = wb.worksheets.find((w) => w.name.toLowerCase() === 'products') ?? wb.worksheets[0];
    if (!ws) return await failJob('Spreadsheet has no worksheets.');

    const headerRow = ws.getRow(1);
    const colIndex = new Map<string, number>();
    headerRow.eachCell((cell, colNumber) => {
      const key = cellToString(cell.value).toLowerCase();
      if (key) colIndex.set(key, colNumber);
    });

    const required = ['product_key', 'name_es', 'name_en', 'category', 'variant_name_es', 'variant_name_en', 'price', 'stock_quantity'];
    const missing = required.filter((k) => !colIndex.has(k));
    if (missing.length > 0) {
      return await failJob(`Missing required columns: ${missing.join(', ')}. Download the template to see the expected format.`);
    }

    const getCell = (rowNumber: number, key: string): string => {
      const idx = colIndex.get(key);
      if (!idx) return '';
      return cellToString(ws.getCell(rowNumber, idx).value);
    };

    // 2. Read data rows
    const rows: RawRow[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row: RawRow = {
        product_key:         getCell(r, 'product_key'),
        name_es:             getCell(r, 'name_es'),
        name_en:             getCell(r, 'name_en'),
        description_es:      getCell(r, 'description_es'),
        description_en:      getCell(r, 'description_en'),
        brand:               getCell(r, 'brand'),
        origin:              getCell(r, 'origin'),
        category:            getCell(r, 'category'),
        subcategory:         getCell(r, 'subcategory'),
        product_type:        getCell(r, 'product_type'),
        is_active:           getCell(r, 'is_active'),
        variant_name_es:     getCell(r, 'variant_name_es'),
        variant_name_en:     getCell(r, 'variant_name_en'),
        price:               getCell(r, 'price'),
        compare_at_price:    getCell(r, 'compare_at_price'),
        b2b_price:           getCell(r, 'b2b_price'),
        stock_quantity:      getCell(r, 'stock_quantity'),
        low_stock_threshold: getCell(r, 'low_stock_threshold'),
        sku:                 getCell(r, 'sku'),
        is_default_variant:  getCell(r, 'is_default_variant'),
        image_urls:          getCell(r, 'image_urls'),
        _rowNumber: r,
      };
      const allEmpty = Object.entries(row).every(([k, v]) => k.startsWith('_') || v === '');
      if (allEmpty) continue;
      rows.push(row);
    }

    if (rows.length === 0) {
      return await failJob('Spreadsheet is empty. Add at least one row beneath the header.');
    }

    await prisma.partnerProductImportJob.update({
      where: { id: jobId },
      data: { total: rows.length },
    });

    // 3. Load taxonomy + existing catalogue for this store (dedup pool
    //    is scoped to the partner's own store — cross-store dupes are
    //    fine and expected).
    const [allCategories, allSubcategories, allProductTypes, allBrands, allOrigins, existingProducts] = await Promise.all([
      prisma.category.findMany({ select: { id: true, name_es: true, name_en: true } }),
      prisma.subCategory.findMany({ select: { id: true, name_es: true, name_en: true, category_id: true } }),
      prisma.productType.findMany({ select: { id: true, name_es: true, name_en: true, subcategory_id: true } }),
      prisma.brand.findMany({ where: { is_active: true }, select: { id: true, name: true } }),
      prisma.origin.findMany({ where: { is_active: true }, select: { id: true, key: true, label_es: true, label_en: true } }),
      prisma.product.findMany({ where: { store_id: storeId }, select: { id: true, name_es: true, brand: true } }),
    ]);

    const normalizeDedup = (s: string) =>
      s.trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
    const dedupKey = (name: string, brand: string | null) =>
      `${normalizeDedup(name)}::${normalizeDedup(brand ?? '')}`;

    const productDedupMap = new Map<string, string>();
    for (const p of existingProducts) productDedupMap.set(dedupKey(p.name_es, p.brand), p.id);

    // Curated brand + origin resolvers. Unknown → drop to null (no auto-create).
    const brandByName = new Map<string, { id: string; name: string }>();
    for (const b of allBrands) brandByName.set(b.name.toLowerCase(), { id: b.id, name: b.name });

    const originByAlias = new Map<string, { id: string; label_es: string }>();
    for (const o of allOrigins) {
      for (const alias of [o.key, o.label_en, o.label_es]) {
        const v = alias.trim().toLowerCase();
        if (v && !originByAlias.has(v)) originByAlias.set(v, { id: o.id, label_es: o.label_es });
      }
    }

    interface Resolution { name: string | null; id: string | null }
    function resolveBrand(raw: string): Resolution {
      const value = raw.trim();
      if (!value) return { name: null, id: null };
      const hit = brandByName.get(value.toLowerCase());
      return hit ? { name: hit.name, id: hit.id } : { name: null, id: null };
    }
    function resolveOrigin(raw: string): Resolution {
      const value = raw.trim();
      if (!value) return { name: null, id: null };
      const hit = originByAlias.get(value.toLowerCase());
      return hit ? { name: hit.label_es, id: hit.id } : { name: null, id: null };
    }
    function resolveCategory(raw: string): string | null {
      if (!raw) return null;
      if (UUID_RE.test(raw)) return allCategories.find((c) => c.id === raw)?.id ?? null;
      const lower = raw.toLowerCase();
      return allCategories.find((c) => c.name_es.toLowerCase() === lower || c.name_en.toLowerCase() === lower)?.id ?? null;
    }
    function resolveSubcategory(raw: string, categoryId: string): string | null {
      if (!raw) return null;
      if (UUID_RE.test(raw)) {
        const found = allSubcategories.find((s) => s.id === raw);
        return found && found.category_id === categoryId ? found.id : null;
      }
      const lower = raw.toLowerCase();
      return allSubcategories.find(
        (s) => s.category_id === categoryId && (s.name_es.toLowerCase() === lower || s.name_en.toLowerCase() === lower),
      )?.id ?? null;
    }
    function resolveProductType(raw: string, subcategoryId: string): string | null {
      if (!raw) return null;
      if (UUID_RE.test(raw)) {
        const found = allProductTypes.find((t) => t.id === raw);
        return found && found.subcategory_id === subcategoryId ? found.id : null;
      }
      const lower = raw.trim().toLowerCase();
      return allProductTypes.find(
        (t) => t.subcategory_id === subcategoryId && (t.name_es.toLowerCase() === lower || t.name_en.toLowerCase() === lower),
      )?.id ?? null;
    }

    // 4. Group rows by product_key, parse each into a ParsedProduct
    const results: RowResult[] = [];
    const grouped = new Map<string, RawRow[]>();
    for (const row of rows) {
      const key = row.product_key.trim();
      if (!key) {
        results.push({ row: row._rowNumber, product_key: '', status: 'error', error: 'product_key is required.' });
        continue;
      }
      const bucket = grouped.get(key) ?? [];
      bucket.push(row);
      grouped.set(key, bucket);
    }

    const products: ParsedProduct[] = [];
    for (const [key, group] of grouped.entries()) {
      const head = group[0];
      if (!head.name_es || !head.name_en) {
        results.push({ row: head._rowNumber, product_key: key, status: 'error', error: 'name_es and name_en are required on the first row of each product_key.' });
        continue;
      }
      if (!head.category) {
        results.push({ row: head._rowNumber, product_key: key, status: 'error', error: 'category is required on the first row of each product_key.' });
        continue;
      }
      const categoryId = resolveCategory(head.category);
      if (!categoryId) {
        results.push({ row: head._rowNumber, product_key: key, status: 'error', error: `Category "${head.category}" not found. Contact the Cesto admin to add it.` });
        continue;
      }
      let subcategoryId: string | null = null;
      if (head.subcategory) {
        subcategoryId = resolveSubcategory(head.subcategory, categoryId);
        if (!subcategoryId) {
          results.push({ row: head._rowNumber, product_key: key, status: 'error', error: `Subcategory "${head.subcategory}" not found inside category "${head.category}".` });
          continue;
        }
      }
      let productTypeId: string | null = null;
      if (head.product_type && subcategoryId) {
        productTypeId = resolveProductType(head.product_type, subcategoryId);
        if (!productTypeId) {
          results.push({ row: head._rowNumber, product_key: key, status: 'error', error: `Product type "${head.product_type}" not found inside subcategory "${head.subcategory}".` });
          continue;
        }
      }

      // Variants
      let variantError: string | null = null;
      const variants: ParsedVariant[] = [];
      for (const r of group) {
        if (!r.variant_name_es || !r.variant_name_en) {
          variantError = `Row ${r._rowNumber}: variant_name_es and variant_name_en are required.`;
          break;
        }
        const price = parseNumber(r.price);
        if (price === null || price <= 0) {
          variantError = `Row ${r._rowNumber}: price must be a positive number.`;
          break;
        }
        const compare = r.compare_at_price === '' ? null : parseNumber(r.compare_at_price);
        if (r.compare_at_price !== '' && (compare === null || compare <= 0)) {
          variantError = `Row ${r._rowNumber}: compare_at_price must be a positive number.`;
          break;
        }
        const b2b = r.b2b_price === '' ? null : parseNumber(r.b2b_price);
        if (r.b2b_price !== '' && (b2b === null || b2b <= 0)) {
          variantError = `Row ${r._rowNumber}: b2b_price must be a positive number.`;
          break;
        }
        const stock = parseInt0(r.stock_quantity, NaN);
        if (!Number.isFinite(stock) || stock < 0) {
          variantError = `Row ${r._rowNumber}: stock_quantity must be a non-negative integer.`;
          break;
        }
        variants.push({
          name_es: r.variant_name_es, name_en: r.variant_name_en,
          price, compare_at_price: compare, b2b_price: b2b,
          stock_quantity: stock,
          low_stock_threshold: parseInt0(r.low_stock_threshold, 10),
          sku: r.sku || null,
          is_default: parseBool(r.is_default_variant, false),
          is_active: true,
          _rowNumber: r._rowNumber,
        });
      }
      if (variantError) {
        results.push({ row: head._rowNumber, product_key: key, status: 'error', error: variantError });
        continue;
      }

      // Ensure exactly one default variant
      const defaults = variants.filter((v) => v.is_default);
      if (defaults.length === 0) variants[0].is_default = true;
      else if (defaults.length > 1) {
        let kept = false;
        for (const v of variants) {
          if (v.is_default) { if (kept) v.is_default = false; else kept = true; }
        }
      }

      // Images
      const rawImages = head.image_urls
        ? head.image_urls.split(';').map((u) => u.trim()).filter(Boolean)
        : [];
      const badImage = rawImages.find((u) => !IMAGE_URL_RE.test(u));
      if (badImage) {
        results.push({ row: head._rowNumber, product_key: key, status: 'error', error: `Invalid image URL: "${badImage}". Must start with http(s):// or /.` });
        continue;
      }

      // Brand / origin — curated lookup; unknown drops to null with a warning.
      const brandRes = resolveBrand(head.brand);
      const originRes = resolveOrigin(head.origin);
      const warnings: string[] = [];
      if (head.brand.trim() && !brandRes.id)   warnings.push(`Brand "${head.brand.trim()}" isn't in the Cesto brand list — saved without a brand.`);
      if (head.origin.trim() && !originRes.id) warnings.push(`Origin "${head.origin.trim()}" isn't in the Cesto origin list — saved without an origin.`);

      // Store-scoped dedup on name + brand (canonical brand casing).
      const dupKey = dedupKey(head.name_es, brandRes.name);
      const existingId = productDedupMap.get(dupKey);
      if (existingId) {
        // Queue it for review rather than dropping it. A silent skip is the
        // wrong default: the partner cannot tell whether their sheet was
        // rejected or their catalogue already had the row, and re-importing
        // does not help because it skips again.
        //
        // 'in-flight' means the match is an earlier row of THIS sheet, which
        // has no Product id yet — store null and let the snapshot name carry
        // the display.
        const matchedId = existingId === 'in-flight' ? null : existingId;
        const matchedName = matchedId
          ? (existingProducts.find((p) => p.id === matchedId)?.name_es ?? head.name_es)
          : head.name_es;
        try {
          await prisma.partnerProductImportDuplicate.create({
            data: {
              job_id: jobId,
              store_id: storeId,
              source_row_number: head._rowNumber,
              matched_product_id: matchedId,
              matched_product_name: matchedName,
              // RESOLVED FKs, not raw strings — a later "Create anyway" must
              // not have to re-run resolution against tables that may have
              // changed since the upload.
              payload: {
                product_key: key,
                name_es: head.name_es,
                name_en: head.name_en,
                description_es: head.description_es || null,
                description_en: head.description_en || null,
                brand: brandRes.name,
                origin: originRes.name,
                brand_id: brandRes.id,
                origin_id: originRes.id,
                category_id: categoryId,
                subcategory_id: subcategoryId,
                product_type_id: productTypeId,
                store_id: storeId,
                is_active: parseBool(head.is_active, true),
                variants: variants as unknown as Prisma.InputJsonValue,
                image_urls: rawImages,
              } satisfies Prisma.InputJsonObject,
            },
          });
        } catch (err) {
          // Non-fatal. The row is still reported as a duplicate below; the
          // partner loses only the ability to review it from the queue.
          // eslint-disable-next-line no-console
          console.warn(
            `[partner-import:dedup] failed to queue duplicate (row=${head._rowNumber}): ` +
            (err instanceof Error ? err.message : String(err)),
          );
        }

        results.push({
          row: head._rowNumber, product_key: key, status: 'duplicate',
          productName: head.name_es, duplicate_of_id: existingId, duplicate_of_source: 'product',
          error: 'This product already exists in your store — queued on the Duplicates page for review (Create anyway / Dismiss).',
        });
        continue;
      }

      products.push({
        product_key: key,
        name_es: head.name_es, name_en: head.name_en,
        description_es: head.description_es || null,
        description_en: head.description_en || null,
        brand:  brandRes.name,  brand_id:  brandRes.id,
        origin: originRes.name, origin_id: originRes.id,
        category_id: categoryId,
        subcategory_id: subcategoryId,
        product_type_id: productTypeId,
        is_active: parseBool(head.is_active, true),
        variants,
        image_urls: rawImages,
        _rowNumber: head._rowNumber,
      });

      // Track this row so within-sheet dupes get caught too.
      productDedupMap.set(dupKey, 'in-flight');
    }

    // 5. Persist — one product at a time so a bad row doesn't roll back the whole sheet.
    //    Update `processed` as we go so the poller's progress bar tracks reality.
    let processed = 0;
    let created = 0;
    for (const p of products) {
      try {
        const row = await prisma.product.create({
          data: {
            name_es: p.name_es, name_en: p.name_en,
            description_es: p.description_es, description_en: p.description_en,
            brand: p.brand, brand_id: p.brand_id,
            origin: p.origin, origin_id: p.origin_id,
            category_id: p.category_id,
            subcategory_id: p.subcategory_id,
            product_type_id: p.product_type_id,
            store_id: storeId, // FORCED — never trusts the workbook
            is_active: p.is_active,
            variants: {
              create: p.variants.map(({ _rowNumber: _r, ...v }) => v),
            },
            images: p.image_urls.length > 0
              ? { create: p.image_urls.map((url, i) => ({
                  url, alt_text: p.name_es, sort_order: i, is_primary: i === 0,
                })) }
              : undefined,
          },
          select: { id: true },
        });
        const warns = results.find(() => false); // placeholder to appease TS
        void warns;
        results.push({
          row: p._rowNumber,
          product_key: p.product_key,
          status: 'created',
          productId: row.id,
          productName: p.name_es,
          variantCount: p.variants.length,
        });
        created += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ row: p._rowNumber, product_key: p.product_key, status: 'error', error: message });
      }
      processed += 1;
      // Cheap update — we don't need TX guarantees on the counter.
      if (processed % 5 === 0 || processed === products.length) {
        await prisma.partnerProductImportJob.update({
          where: { id: jobId },
          data: { processed },
        });
      }
    }

    // 6. Wrap up — write the full report + mark done.
    const failed     = results.filter((r) => r.status === 'error').length;
    const duplicates = results.filter((r) => r.status === 'duplicate').length;
    const reportPayload = {
      total: rows.length,
      created,
      failed,
      duplicates,
      results,
    };
    await prisma.partnerProductImportJob.update({
      where: { id: jobId },
      data: {
        status: 'done',
        processed: rows.length,
        result: reportPayload as unknown as import('@prisma/client').Prisma.InputJsonValue,
        finished_at: new Date(),
      },
    });
  } catch (err) {
    if (err instanceof ImportJobFailure) return; // failJob already updated the row
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[partner-import] unexpected error in job ${jobId}:`, err);
    await prisma.partnerProductImportJob.update({
      where: { id: jobId },
      data: { status: 'failed', error_message: message, finished_at: new Date() },
    });
  }
}

/**
 * Boot-time recovery — anything in queued/running when the process starts
 * belongs to a previous run that died mid-import. Flip them to
 * 'interrupted' so the UI stops showing a stuck spinner.
 */
export async function recoverInterruptedPartnerImportJobs(): Promise<void> {
  try {
    const r = await prisma.partnerProductImportJob.updateMany({
      where: { status: { in: ['queued', 'running'] } },
      data: { status: 'interrupted', finished_at: new Date(), error_message: 'Server restarted before this job could finish.' },
    });
    if (r.count > 0) {
      // eslint-disable-next-line no-console
      console.log(`[boot] flipped ${r.count} partner import job(s) to interrupted`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[boot] recoverInterruptedPartnerImportJobs threw:', err);
  }
}

export default router;
