import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { VAT_RATES, type VatCategory } from '../../lib/tax';
import { invalidateCountCache } from '../../lib/count-cache';
import { success, error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';

/**
 * How long a completed job's cached result is treated as a valid "replay" for
 * a matching idempotency key. Beyond this window we treat the resubmit as a
 * fresh intent (business data may have changed) and start a new job.
 */
const IDEMPOTENCY_REPLAY_MS = 60 * 60 * 1000; // 1 hour

/**
 * Wraps a failure inside the worker so the top-level try/catch can pull a
 * clean message out into ProductImportJob.error_message. Anything else
 * bubbles as a generic "unexpected error".
 */
class ImportJobFailure extends Error {}

const router = Router();

// ─── Multer (in-memory) ────────────────────────────────
// Spreadsheets are small enough that we keep the file in memory and stream
// it straight into ExcelJS — no disk write needed.

const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',                                          // .xls
  'application/octet-stream',                                          // some browsers
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (ALLOWED_MIME.has(file.mimetype) || name.endsWith('.xlsx') || name.endsWith('.xls')) {
      return cb(null, true);
    }
    cb(new Error(`Unsupported file type: ${file.mimetype}. Upload a .xlsx or .xls file.`));
  },
});

// ─── Template columns (single source of truth) ─────────
// The order here drives both the downloadable template and the import parser,
// so header changes only need to happen in one place.

interface ColumnSpec {
  key: string;
  header: string;
  width: number;
  example: string | number | boolean;
  note: string;
}

const COLUMNS: ColumnSpec[] = [
  { key: 'product_key',        header: 'product_key',        width: 18, example: 'P001',                          note: 'Group key. Rows that share a product_key become one product with multiple variants. Not stored.' },
  { key: 'name_es',            header: 'name_es',            width: 28, example: 'Arroz Basmati Tilda',           note: 'Spanish product name. Required on the first row of each product_key.' },
  { key: 'name_en',            header: 'name_en',            width: 28, example: 'Tilda Basmati Rice',            note: 'English product name. Required on the first row of each product_key.' },
  { key: 'description_es',     header: 'description_es',     width: 40, example: 'Arroz basmati de grano largo.', note: 'Optional. Spanish description.' },
  { key: 'description_en',     header: 'description_en',     width: 40, example: 'Long-grain basmati rice.',      note: 'Optional. English description.' },
  { key: 'brand',              header: 'brand',              width: 16, example: 'Tilda',                         note: 'Optional.' },
  { key: 'origin',             header: 'origin',             width: 16, example: 'India',                         note: 'Optional.' },
  { key: 'store_slug',         header: 'store_slug',         width: 16, example: 'wahed-mart',                    note: 'Optional. Slug of an active partner Store (see the /stores admin page). Blank or unknown → Cesto Shop default. First row only. Legacy header "shop_id" still accepted.' },
  { key: 'store_name',         header: 'store_name',         width: 20, example: 'Wahed Mart',                    note: 'Optional fallback. Used only when store_slug is blank — matches active Stores by name (case-insensitive). First row only. Legacy header "shop_name" still accepted.' },
  { key: 'category',           header: 'category',           width: 22, example: 'Arroz y Legumbres',             note: 'Required (first row). Match by category name_es / name_en (case-insensitive) or by id (uuid).' },
  { key: 'subcategory',        header: 'subcategory',        width: 22, example: '',                              note: 'Optional. Same matching rules as category. Must belong to the chosen category.' },
  { key: 'product_type',       header: 'product_type',       width: 22, example: '',                              note: 'Optional third-tier taxonomy. Match by product-type name_es / name_en (case-insensitive) or by id (uuid). Must belong to the chosen subcategory. Unknown names are auto-created as inactive suggestions for admin review.' },
  { key: 'is_active',          header: 'is_active',          width: 10, example: true,                            note: 'Optional. TRUE/FALSE or 1/0. Default TRUE.' },
  { key: 'is_featured',        header: 'is_featured',        width: 12, example: false,                           note: 'Optional. Default FALSE.' },
  { key: 'iva',                header: 'iva',                width: 8,  example: 10,                              note: 'Optional. IVA rate in %: 0, 4, 10 or 21 (first row of each product_key). Blank = 0 %, the default until a rate is chosen. The prices in this sheet are WITHOUT IVA: customers pay them plus this rate.' },
  { key: 'variant_name_es',    header: 'variant_name_es',    width: 18, example: '1 kg',                          note: 'Required. The variant label in Spanish (e.g. "1 kg", "Pack 3").' },
  { key: 'variant_name_en',    header: 'variant_name_en',    width: 18, example: '1 kg',                          note: 'Required. Same in English.' },
  { key: 'price',              header: 'price',              width: 10, example: 3.95,                            note: 'Required. B2C / customer price WITHOUT IVA (see iva). EUR, two decimals. Use a number, not a string.' },
  { key: 'compare_at_price',   header: 'compare_at_price',   width: 16, example: '',                              note: 'Optional. Strike-through price for promos (shown next to the B2C price). Without IVA, like price.' },
  { key: 'b2b_price',          header: 'b2b_price',          width: 10, example: 3.20,                            note: 'Optional. B2B / wholesale price WITHOUT IVA, shown (plus IVA) only to approved business customers. Blank = no B2B pricing on this variant.' },
  { key: 'stock_quantity',     header: 'stock_quantity',     width: 14, example: 120,                             note: 'Required. Non-negative integer.' },
  { key: 'low_stock_threshold',header: 'low_stock_threshold',width: 18, example: 10,                              note: 'Optional. Default 10.' },
  { key: 'sku',                header: 'sku',                width: 14, example: 'TIL-BAS-1K',                    note: 'Optional. Free-text.' },
  { key: 'is_default_variant', header: 'is_default_variant', width: 16, example: true,                            note: 'Mark exactly one variant per product. If none, the first variant is used.' },
  { key: 'image_urls',         header: 'image_urls',         width: 50, example: 'https://example.com/a.jpg;https://example.com/b.jpg', note: 'Optional. Semicolon-separated. The first URL becomes the primary image.' },
];

// ─── Seed catalogue (template payload) ─────────────────
// 20-product sample dataset that ships with the downloadable template.
// Spans South Asian + Spanish grocery categories so the admin sees real
// shape (multiple brands, variants, prices, promos) on first download.
// Image URLs are Lorem Flickr placeholders so the import lands with usable
// thumbnails out of the box.

interface SampleVariant {
  variant_name_es: string;
  variant_name_en: string;
  price: number;
  compare_at_price?: number;
  /** Optional B2B / wholesale price for the sample rows. Rendered in the
   *  template so first-time admins see the column populated. */
  b2b_price?: number;
  stock_quantity: number;
  low_stock_threshold?: number;
  sku: string;
  is_default: boolean;
}

interface SampleProduct {
  product_key: string;
  name_es: string;
  name_en: string;
  description_es: string;
  description_en: string;
  brand: string;
  origin: string;
  /** Optional Store slug the sample belongs to. Blank on most samples so
   *  the template shows both the "assigned" and "Cesto default" cases. */
  store_slug?: string;
  store_name?: string;
  category: string;
  subcategory?: string;
  /** Optional third-tier taxonomy — must belong to the chosen subcategory. */
  product_type?: string;
  is_active: boolean;
  is_featured: boolean;
  image_urls?: string;
  variants: SampleVariant[];
}

const TEMPLATE_PRODUCTS: SampleProduct[] = [
  {
    product_key: 'P001',
    name_es: 'Arroz Basmati Tilda',
    name_en: 'Tilda Basmati Rice',
    description_es: 'Arroz basmati de grano largo, aromático, ideal para biryani y pilaf.',
    description_en: 'Long-grain aromatic basmati rice, perfect for biryani and pilaf.',
    brand: 'Tilda',
    origin: 'India',
    store_slug: 'tilda',
    store_name: 'Tilda',
    category: 'Arroz y Legumbres',
    is_active: true,
    is_featured: true,
    image_urls: 'https://loremflickr.com/600/600/basmati,rice?lock=1;https://loremflickr.com/600/600/rice,bag?lock=2',
    variants: [
      { variant_name_es: '1 kg', variant_name_en: '1 kg', price: 3.95, b2b_price: 3.20, stock_quantity: 120, low_stock_threshold: 15, sku: 'TIL-BAS-1K', is_default: true },
      { variant_name_es: '5 kg', variant_name_en: '5 kg', price: 17.50, compare_at_price: 19.95, b2b_price: 14.50, stock_quantity: 40, low_stock_threshold: 5, sku: 'TIL-BAS-5K', is_default: false },
    ],
  },
  {
    product_key: 'P002',
    name_es: 'Lentejas Pardinas',
    name_en: 'Pardina Lentils',
    description_es: 'Lentejas pardinas castellanas, perfectas para guisos.',
    description_en: 'Castilian pardina lentils, ideal for stews.',
    brand: 'Luengo',
    origin: 'España',
    category: 'Arroz y Legumbres',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/lentils?lock=3',
    variants: [
      { variant_name_es: '500 g', variant_name_en: '500 g', price: 1.85, stock_quantity: 90, sku: 'LUE-LEN-500', is_default: true },
      { variant_name_es: '1 kg', variant_name_en: '1 kg', price: 3.40, stock_quantity: 55, sku: 'LUE-LEN-1K', is_default: false },
    ],
  },
  {
    product_key: 'P003',
    name_es: 'Garbanzos Pedrosillanos',
    name_en: 'Pedrosillano Chickpeas',
    description_es: 'Garbanzos pedrosillanos de tamaño mediano, piel fina.',
    description_en: 'Medium-sized pedrosillano chickpeas with a thin skin.',
    brand: 'Luengo',
    origin: 'España',
    category: 'Arroz y Legumbres',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/chickpeas?lock=4',
    variants: [
      { variant_name_es: '1 kg', variant_name_en: '1 kg', price: 3.20, stock_quantity: 75, sku: 'LUE-GAR-1K', is_default: true },
    ],
  },
  {
    product_key: 'P004',
    name_es: 'Garam Masala MDH',
    name_en: 'MDH Garam Masala',
    description_es: 'Mezcla tradicional de especias indias para currys.',
    description_en: 'Traditional Indian spice blend for curries.',
    brand: 'MDH',
    origin: 'India',
    store_slug: 'wahed-mart',
    store_name: 'Wahed Mart',
    category: 'Especias y Condimentos',
    is_active: true,
    is_featured: true,
    image_urls: 'https://loremflickr.com/600/600/spices,masala?lock=5',
    variants: [
      { variant_name_es: '100 g', variant_name_en: '100 g', price: 2.49, b2b_price: 1.95, stock_quantity: 110, sku: 'MDH-GM-100', is_default: true },
      { variant_name_es: '200 g', variant_name_en: '200 g', price: 4.49, b2b_price: 3.60, stock_quantity: 60, sku: 'MDH-GM-200', is_default: false },
    ],
  },
  {
    product_key: 'P005',
    name_es: 'Cúrcuma en Polvo',
    name_en: 'Turmeric Powder',
    description_es: 'Cúrcuma molida 100% pura, sin aditivos.',
    description_en: '100% pure ground turmeric, no additives.',
    brand: 'Eastend',
    origin: 'India',
    category: 'Especias y Condimentos',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/turmeric?lock=6',
    variants: [
      { variant_name_es: '100 g', variant_name_en: '100 g', price: 1.95, stock_quantity: 140, sku: 'EAS-TUR-100', is_default: true },
      { variant_name_es: '400 g', variant_name_en: '400 g', price: 5.95, compare_at_price: 6.95, stock_quantity: 70, sku: 'EAS-TUR-400', is_default: false },
    ],
  },
  {
    product_key: 'P006',
    name_es: 'Comino Molido',
    name_en: 'Ground Cumin',
    description_es: 'Comino molido aromático para guisos y sofritos.',
    description_en: 'Aromatic ground cumin for stews and sautés.',
    brand: 'Carmencita',
    origin: 'España',
    category: 'Especias y Condimentos',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/cumin,spice?lock=7',
    variants: [
      { variant_name_es: '75 g', variant_name_en: '75 g', price: 2.10, stock_quantity: 85, sku: 'CAR-COM-75', is_default: true },
    ],
  },
  {
    product_key: 'P007',
    name_es: 'Aceite de Oliva Virgen Extra',
    name_en: 'Extra Virgin Olive Oil',
    description_es: 'AOVE de primera presión en frío, sabor afrutado intenso.',
    description_en: 'Cold-pressed extra virgin olive oil, intense fruity flavour.',
    brand: 'Carbonell',
    origin: 'España',
    category: 'Aceites y Vinagres',
    is_active: true,
    is_featured: true,
    image_urls: 'https://loremflickr.com/600/600/olive,oil?lock=8',
    variants: [
      { variant_name_es: '500 ml', variant_name_en: '500 ml', price: 5.95, stock_quantity: 100, sku: 'CAR-AOVE-500', is_default: true },
      { variant_name_es: '1 L', variant_name_en: '1 L', price: 10.50, compare_at_price: 11.95, stock_quantity: 65, sku: 'CAR-AOVE-1L', is_default: false },
      { variant_name_es: '5 L', variant_name_en: '5 L', price: 44.90, stock_quantity: 20, low_stock_threshold: 5, sku: 'CAR-AOVE-5L', is_default: false },
    ],
  },
  {
    product_key: 'P008',
    name_es: 'Aceite de Girasol',
    name_en: 'Sunflower Oil',
    description_es: 'Aceite de girasol refinado, ideal para freír.',
    description_en: 'Refined sunflower oil, perfect for frying.',
    brand: 'Koipesol',
    origin: 'España',
    category: 'Aceites y Vinagres',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/sunflower,oil?lock=9',
    variants: [
      { variant_name_es: '1 L', variant_name_en: '1 L', price: 2.85, stock_quantity: 130, sku: 'KOI-GIR-1L', is_default: true },
      { variant_name_es: '5 L', variant_name_en: '5 L', price: 12.95, stock_quantity: 25, sku: 'KOI-GIR-5L', is_default: false },
    ],
  },
  {
    product_key: 'P009',
    name_es: 'Vinagre de Manzana',
    name_en: 'Apple Cider Vinegar',
    description_es: 'Vinagre de manzana sin filtrar, con la madre.',
    description_en: 'Unfiltered apple cider vinegar with the mother.',
    brand: 'La Catedral',
    origin: 'España',
    category: 'Aceites y Vinagres',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/vinegar,apple?lock=10',
    variants: [
      { variant_name_es: '500 ml', variant_name_en: '500 ml', price: 3.25, stock_quantity: 60, sku: 'CAT-VIN-500', is_default: true },
    ],
  },
  {
    product_key: 'P010',
    name_es: 'Harina Chapati Aashirvaad',
    name_en: 'Aashirvaad Chapati Flour',
    description_es: 'Atta integral premium para chapatis, rotis y parathas.',
    description_en: 'Premium whole-wheat atta for chapatis, rotis and parathas.',
    brand: 'Aashirvaad',
    origin: 'India',
    category: 'Harinas y Cereales',
    is_active: true,
    is_featured: true,
    image_urls: 'https://loremflickr.com/600/600/wheat,flour?lock=11',
    variants: [
      { variant_name_es: '5 kg', variant_name_en: '5 kg', price: 11.95, stock_quantity: 50, sku: 'AAS-ATTA-5K', is_default: true },
      { variant_name_es: '10 kg', variant_name_en: '10 kg', price: 22.50, compare_at_price: 24.95, stock_quantity: 25, sku: 'AAS-ATTA-10K', is_default: false },
    ],
  },
  {
    product_key: 'P011',
    name_es: 'Harina Repostería',
    name_en: 'Pastry Flour',
    description_es: 'Harina de trigo floja, ideal para repostería y bizcochos.',
    description_en: 'Soft wheat flour, ideal for pastries and cakes.',
    brand: 'Gallo',
    origin: 'España',
    category: 'Harinas y Cereales',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/pastry,flour?lock=12',
    variants: [
      { variant_name_es: '1 kg', variant_name_en: '1 kg', price: 1.10, stock_quantity: 80, sku: 'GAL-REP-1K', is_default: true },
    ],
  },
  {
    product_key: 'P012',
    name_es: 'Avena en Copos',
    name_en: 'Rolled Oats',
    description_es: 'Copos de avena integrales, ricos en fibra.',
    description_en: 'Whole rolled oats, rich in fibre.',
    brand: 'Quaker',
    origin: 'Reino Unido',
    category: 'Harinas y Cereales',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/oats,oatmeal?lock=13',
    variants: [
      { variant_name_es: '500 g', variant_name_en: '500 g', price: 2.65, stock_quantity: 95, sku: 'QUA-AVE-500', is_default: true },
      { variant_name_es: '1 kg', variant_name_en: '1 kg', price: 4.85, stock_quantity: 45, sku: 'QUA-AVE-1K', is_default: false },
    ],
  },
  {
    product_key: 'P013',
    name_es: 'Patatas Fritas Original',
    name_en: 'Original Potato Chips',
    description_es: 'Patatas fritas clásicas con sal.',
    description_en: 'Classic salted potato chips.',
    brand: "Lay's",
    origin: 'España',
    category: 'Snacks y Aperitivos',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/chips,crisps?lock=14',
    variants: [
      { variant_name_es: '45 g', variant_name_en: '45 g', price: 0.95, stock_quantity: 200, sku: 'LAY-ORI-45', is_default: false },
      { variant_name_es: '125 g', variant_name_en: '125 g', price: 1.95, stock_quantity: 150, sku: 'LAY-ORI-125', is_default: true },
      { variant_name_es: '200 g', variant_name_en: '200 g', price: 2.95, stock_quantity: 90, sku: 'LAY-ORI-200', is_default: false },
    ],
  },
  {
    product_key: 'P014',
    name_es: 'Bombay Mix Picante',
    name_en: 'Spicy Bombay Mix',
    description_es: 'Mezcla crujiente de garbanzos, lentejas y cacahuetes con especias.',
    description_en: 'Crunchy mix of chickpeas, lentils and peanuts with spices.',
    brand: 'Haldiram',
    origin: 'India',
    category: 'Snacks y Aperitivos',
    is_active: true,
    is_featured: true,
    image_urls: 'https://loremflickr.com/600/600/bombay,mix,snack?lock=15',
    variants: [
      { variant_name_es: '150 g', variant_name_en: '150 g', price: 2.25, stock_quantity: 100, sku: 'HAL-BMB-150', is_default: true },
      { variant_name_es: '400 g', variant_name_en: '400 g', price: 5.50, stock_quantity: 50, sku: 'HAL-BMB-400', is_default: false },
    ],
  },
  {
    product_key: 'P015',
    name_es: 'Té Negro Premium',
    name_en: 'Premium Black Tea',
    description_es: 'Té negro CTC indio de hoja fuerte, perfecto para chai.',
    description_en: 'Strong-leaf Indian CTC black tea, perfect for chai.',
    brand: 'Wagh Bakri',
    origin: 'India',
    category: 'Té y Café',
    is_active: true,
    is_featured: true,
    image_urls: 'https://loremflickr.com/600/600/tea,chai?lock=16',
    variants: [
      { variant_name_es: '250 g', variant_name_en: '250 g', price: 4.50, stock_quantity: 80, sku: 'WAG-BLK-250', is_default: true },
      { variant_name_es: '500 g', variant_name_en: '500 g', price: 8.50, compare_at_price: 9.50, stock_quantity: 40, sku: 'WAG-BLK-500', is_default: false },
    ],
  },
  {
    product_key: 'P016',
    name_es: 'Café Molido Natural',
    name_en: 'Natural Ground Coffee',
    description_es: 'Café 100% arábica molido para cafetera italiana.',
    description_en: '100% arabica ground coffee for moka pots.',
    brand: 'Marcilla',
    origin: 'España',
    category: 'Té y Café',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/coffee,ground?lock=17',
    variants: [
      { variant_name_es: '250 g', variant_name_en: '250 g', price: 3.75, stock_quantity: 110, sku: 'MAR-CAF-250', is_default: true },
      { variant_name_es: '500 g', variant_name_en: '500 g', price: 6.95, stock_quantity: 60, sku: 'MAR-CAF-500', is_default: false },
    ],
  },
  {
    product_key: 'P017',
    name_es: 'Salsa de Soja',
    name_en: 'Soy Sauce',
    description_es: 'Salsa de soja fermentada de forma natural.',
    description_en: 'Naturally fermented soy sauce.',
    brand: 'Kikkoman',
    origin: 'Japón',
    category: 'Salsas y Conservas',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/soy,sauce?lock=18',
    variants: [
      { variant_name_es: '150 ml', variant_name_en: '150 ml', price: 2.95, stock_quantity: 90, sku: 'KIK-SOY-150', is_default: true },
      { variant_name_es: '500 ml', variant_name_en: '500 ml', price: 6.50, stock_quantity: 45, sku: 'KIK-SOY-500', is_default: false },
    ],
  },
  {
    product_key: 'P018',
    name_es: 'Tomate Frito Casero',
    name_en: 'Homestyle Fried Tomato',
    description_es: 'Tomate frito tradicional con aceite de oliva.',
    description_en: 'Traditional fried tomato sauce with olive oil.',
    brand: 'Solís',
    origin: 'España',
    category: 'Salsas y Conservas',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/tomato,sauce?lock=19',
    variants: [
      { variant_name_es: '350 g', variant_name_en: '350 g', price: 1.45, stock_quantity: 120, sku: 'SOL-TF-350', is_default: true },
      { variant_name_es: '780 g', variant_name_en: '780 g', price: 2.65, stock_quantity: 70, sku: 'SOL-TF-780', is_default: false },
    ],
  },
  {
    product_key: 'P019',
    name_es: 'Leche Entera UHT',
    name_en: 'UHT Whole Milk',
    description_es: 'Leche entera de larga duración, calidad premium.',
    description_en: 'Long-life whole milk, premium quality.',
    brand: 'Pascual',
    origin: 'España',
    category: 'Lácteos',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/milk,carton?lock=20',
    variants: [
      { variant_name_es: '1 L', variant_name_en: '1 L', price: 1.15, stock_quantity: 200, sku: 'PAS-LEC-1L', is_default: true },
      { variant_name_es: 'Pack 6 × 1 L', variant_name_en: 'Pack 6 × 1 L', price: 6.50, compare_at_price: 6.90, stock_quantity: 50, sku: 'PAS-LEC-6PK', is_default: false },
    ],
  },
  {
    product_key: 'P020',
    name_es: 'Galletas María Clásicas',
    name_en: 'Classic María Biscuits',
    description_es: 'Galletas María tradicionales, perfectas para mojar.',
    description_en: 'Traditional María biscuits, perfect for dunking.',
    brand: 'Fontaneda',
    origin: 'España',
    category: 'Dulces y Galletas',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/biscuits,cookies?lock=21',
    variants: [
      { variant_name_es: '200 g', variant_name_en: '200 g', price: 1.55, stock_quantity: 140, sku: 'FON-MAR-200', is_default: true },
      { variant_name_es: '800 g', variant_name_en: '800 g', price: 4.50, stock_quantity: 60, sku: 'FON-MAR-800', is_default: false },
    ],
  },

  // ─── Demo scenarios (2026-07-24) ──
  // The next five rows exist so a first-time admin can download the
  // template, upload it as-is, and immediately see the three review
  // flows on the Duplicates page:
  //   • DUP-DEMO-A + DUP-DEMO-B  → same identity, SAME store. Second row
  //     lands on the "Duplicates → From Excel import" tab as a pending
  //     review with Create Anyway / Dismiss buttons.
  //   • MULTI-A + MULTI-B  → same identity, DIFFERENT stores. Both create
  //     cleanly; both appear together on the "Multi-store listings" tab.
  //   • NEW-SUB → uses a subcategory ("Sushi Rice") that doesn't exist
  //     under "Arroz y Legumbres" yet. The product creates and the
  //     subcategory auto-creates as is_active=false under its parent
  //     category (see it on the Categories page + on the import report).
  // Remove or rename these once real catalogue rows exist.
  {
    product_key: 'DUP-DEMO-A',
    name_es: 'Arroz Zafarani Premium',
    name_en: 'Zafarani Premium Rice',
    description_es: 'Demo — fila que crea el producto base para probar duplicados.',
    description_en: 'Demo — creates the base product used to test the duplicates flow.',
    brand: 'Zafarani',
    origin: 'India',
    store_slug: 'wahed-mart',
    store_name: 'Wahed Mart',
    category: 'Arroz y Legumbres',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/basmati,rice?lock=101',
    variants: [
      { variant_name_es: '1 kg', variant_name_en: '1 kg', price: 4.25, stock_quantity: 60, sku: 'ZAF-PRE-1K', is_default: true },
    ],
  },
  {
    product_key: 'DUP-DEMO-B',
    name_es: 'Arroz Zafarani Premium',
    name_en: 'Zafarani Premium Rice',
    description_es: 'Demo — misma identidad que DUP-DEMO-A en la MISMA tienda. Debería aparecer en "Duplicados > Desde Excel" para revisión.',
    description_en: 'Demo — same identity as DUP-DEMO-A in the SAME store. Should surface under "Duplicates > From Excel import" for review.',
    brand: 'Zafarani',
    origin: 'India',
    store_slug: 'wahed-mart',
    store_name: 'Wahed Mart',
    category: 'Arroz y Legumbres',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/basmati,rice?lock=102',
    variants: [
      { variant_name_es: '5 kg', variant_name_en: '5 kg', price: 19.50, stock_quantity: 20, sku: 'ZAF-PRE-5K', is_default: true },
    ],
  },
  {
    product_key: 'MULTI-A',
    name_es: 'Arroz Basmati Kohinoor',
    name_en: 'Kohinoor Basmati Rice',
    description_es: 'Demo — mismo producto listado por DOS tiendas. Aparecerá en la pestaña "Multi-store listings" del panel de duplicados.',
    description_en: 'Demo — same product listed by TWO stores. Will appear on the "Multi-store listings" tab.',
    brand: 'Kohinoor',
    origin: 'India',
    store_slug: 'wahed-mart',
    store_name: 'Wahed Mart',
    category: 'Arroz y Legumbres',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/basmati,rice?lock=103',
    variants: [
      { variant_name_es: '1 kg', variant_name_en: '1 kg', price: 4.75, stock_quantity: 45, sku: 'KOH-BAS-1K-WM', is_default: true },
    ],
  },
  {
    product_key: 'MULTI-B',
    name_es: 'Arroz Basmati Kohinoor',
    name_en: 'Kohinoor Basmati Rice',
    description_es: 'Demo — misma identidad que MULTI-A pero en una tienda DISTINTA. Ambos productos se crean; la página de duplicados los agrupa como listado multi-tienda.',
    description_en: 'Demo — same identity as MULTI-A but in a DIFFERENT store. Both create; duplicates page groups them as a multi-store listing.',
    brand: 'Kohinoor',
    origin: 'India',
    store_slug: 'tilda',
    store_name: 'Tilda',
    category: 'Arroz y Legumbres',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/basmati,rice?lock=104',
    variants: [
      { variant_name_es: '1 kg', variant_name_en: '1 kg', price: 4.95, stock_quantity: 30, sku: 'KOH-BAS-1K-TL', is_default: true },
    ],
  },
  {
    product_key: 'NEW-SUB',
    name_es: 'Arroz Sushi Premium',
    name_en: 'Premium Sushi Rice',
    description_es: 'Demo — usa una subcategoría "Sushi Rice" y un product_type "Nishiki Grade" que aún no existen. El importador los crea automáticamente como inactivos: la subcategoría bajo "Arroz y Legumbres" y el product_type bajo la nueva subcategoría.',
    description_en: 'Demo — uses subcategory "Sushi Rice" AND product_type "Nishiki Grade" that don\'t exist yet. Importer auto-creates both as inactive: the subcategory under "Arroz y Legumbres", the product_type nested under the newly-created subcategory.',
    brand: 'Yamamotoyama',
    origin: 'Japón',
    category: 'Arroz y Legumbres',
    subcategory: 'Sushi Rice',
    product_type: 'Nishiki Grade',
    is_active: true,
    is_featured: false,
    image_urls: 'https://loremflickr.com/600/600/sushi,rice?lock=105',
    variants: [
      { variant_name_es: '1 kg', variant_name_en: '1 kg', price: 5.75, stock_quantity: 35, sku: 'YAM-SUS-1K', is_default: true },
    ],
  },
];

// ─── GET /api/admin/products/import/template ───────────
// Streams a styled .xlsx with the column headers, a 20-product seed
// dataset, and a separate "Instructions" sheet.

router.get('/template', asyncHandler(async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cesto Admin';
  wb.created = new Date();

  // ── Products sheet ────
  const ws = wb.addWorksheet('Products');
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  // Header styling
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Outfit' };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F8B5C' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
  headerRow.height = 22;

  // 20-product seed catalogue. Categories named in Spanish — if any of them
  // don't yet exist in the DB, the parked-products flow queues the rows
  // until admin creates the matching Category.
  for (const p of TEMPLATE_PRODUCTS) {
    p.variants.forEach((v, idx) => {
      const isHead = idx === 0;
      ws.addRow({
        product_key:        p.product_key,
        name_es:            isHead ? p.name_es : '',
        name_en:            isHead ? p.name_en : '',
        description_es:     isHead ? p.description_es : '',
        description_en:     isHead ? p.description_en : '',
        brand:              isHead ? p.brand : '',
        origin:             isHead ? p.origin : '',
        store_slug:         isHead && p.store_slug ? p.store_slug : '',
        store_name:         isHead && p.store_name ? p.store_name : '',
        category:           isHead ? p.category : '',
        subcategory:        isHead && p.subcategory ? p.subcategory : '',
        product_type:       isHead && p.product_type ? p.product_type : '',
        is_active:          isHead ? p.is_active : '',
        is_featured:        isHead ? p.is_featured : '',
        // Blank on the samples: 0 %, the default, until somebody picks a rate.
        iva:                '',
        variant_name_es:    v.variant_name_es,
        variant_name_en:    v.variant_name_en,
        price:              v.price,
        compare_at_price:   v.compare_at_price ?? '',
        b2b_price:          v.b2b_price ?? '',
        stock_quantity:     v.stock_quantity,
        low_stock_threshold: v.low_stock_threshold ?? '',
        sku:                v.sku,
        is_default_variant: v.is_default,
        image_urls:         isHead ? (p.image_urls ?? '') : '',
      });
    });
  }

  // Freeze the header row so it stays visible while editing
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Instructions sheet ────
  const info = wb.addWorksheet('Instructions');
  info.columns = [
    { header: 'Column',  key: 'col',  width: 24 },
    { header: 'Notes',   key: 'note', width: 90 },
  ];
  const infoHeader = info.getRow(1);
  infoHeader.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Outfit' };
  infoHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F8B5C' } };

  for (const c of COLUMNS) {
    info.addRow({ col: c.header, note: c.note });
  }

  info.addRow({});
  info.addRow({ col: 'Grouping', note: 'Rows that share the same product_key are merged into one product. Put the product fields (name_es, name_en, category, brand, etc.) on the FIRST row of each group; subsequent rows only need variant fields.' });
  info.addRow({ col: 'Defaults', note: 'is_active defaults to TRUE, is_featured to FALSE, low_stock_threshold to 10. Leave blank to accept defaults.' });
  info.addRow({ col: 'Images',   note: 'image_urls is read from the FIRST row of each product_key. Use a semicolon (;) as the separator. The first URL becomes the primary image. URLs must start with http(s):// or be a server path starting with /.' });
  info.addRow({ col: 'Currency', note: 'Prices are in EUR. Always enter as a number (3.95) — never with the € symbol or quotes.' });
  info.addRow({ col: 'IVA',      note: 'Every price here is WITHOUT IVA. Put the product\'s rate in iva (0, 4, 10 or 21) and customers pay the price plus it; leave it blank for 0 %. A product parked for review (unknown category, possible duplicate) keeps the rate given here only if it is published from the duplicate review; set it in the product form otherwise.' });
  info.addRow({ col: 'Errors',   note: 'After upload you will see a per-row report. Products that pass validation are created; rows with errors are skipped and reported so you can fix and re-upload only those.' });

  info.addRow({});
  info.addRow({ col: 'Demo scenarios', note: 'The last five sample rows are demos for the Duplicates page. Upload the template as-is and go to Admin → Products → Duplicates:' });
  info.addRow({ col: '  DUP-DEMO-A / DUP-DEMO-B', note: 'Same identity + same store (Wahed Mart). DUP-DEMO-A creates the base product; DUP-DEMO-B lands on the "From Excel import" tab so you can try Create Anyway / Dismiss.' });
  info.addRow({ col: '  MULTI-A / MULTI-B', note: 'Same identity in DIFFERENT stores (Wahed Mart + Tilda). Both create cleanly; they appear together on the "Multi-store listings" tab. All demo rows use the "Arroz y Legumbres" category, so if you\'ve created only that one, the demos still trigger.' });
  info.addRow({ col: '  NEW-SUB', note: 'Names a subcategory ("Sushi Rice") AND a product_type ("Nishiki Grade") that don\'t exist. The importer auto-creates BOTH as inactive: subcategory under Arroz y Legumbres, product_type nested under the newly-created subcategory. Both surface as separate amber banners in the import report; both appear on the Categories page.' });
  info.addRow({ col: '  Cleanup', note: 'Delete these five rows before importing your real catalogue, or leave them in — they only create a handful of test rows and safely coexist with real products.' });

  // ── Stream to client ────
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="products-import-template.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

// ─── Cell value helpers ────────────────────────────────
// ExcelJS gives us either primitives or rich-value objects depending on
// formatting (rich text, hyperlinks, formula results). Normalise everything
// to a string so downstream parsing is uniform.

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>;
    if ('text' in v && typeof v.text === 'string') return v.text.trim();
    if ('result' in v && v.result !== undefined && v.result !== null) {
      return cellToString(v.result as ExcelJS.CellValue);
    }
    if ('richText' in v && Array.isArray(v.richText)) {
      return v.richText.map((r: { text?: string }) => r.text ?? '').join('').trim();
    }
    if ('hyperlink' in v && typeof v.hyperlink === 'string') return v.hyperlink.trim();
  }
  return String(value).trim();
}

function parseBool(raw: string, fallback: boolean): boolean {
  if (raw === '') return fallback;
  const v = raw.toLowerCase();
  if (['true', 'yes', 'y', '1', 'si', 'sí', 'verdadero'].includes(v)) return true;
  if (['false', 'no', 'n', '0', 'falso'].includes(v)) return false;
  return fallback;
}

function parseNumber(raw: string): number | null {
  if (raw === '') return null;
  // Accept both "1.234,56" (es-ES) and "1234.56".
  const normalized = raw.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * The `iva` cell as a band: 0, 4, 10 or 21, with or without a % sign — and a
 * cell Excel formatted as a percentage, which arrives as 0.1. Blank is null:
 * the product keeps the 0 % default, unreviewed. Anything else is undefined,
 * which the caller reports as a row error rather than guessing a rate.
 */
function parseIva(raw: string): VatCategory | null | undefined {
  if (raw.trim() === '') return null;
  const n = parseNumber(raw.replace('%', ''));
  if (n === null) return undefined;
  const pct = n > 0 && n < 1 ? Math.round(n * 100) : n;
  return (Object.keys(VAT_RATES) as VatCategory[]).find((band) => VAT_RATES[band] === pct);
}

function parseInt0(raw: string, fallback: number): number {
  if (raw === '') return fallback;
  const n = parseNumber(raw);
  if (n === null) return fallback;
  return Math.trunc(n);
}

const IMAGE_URL_RE = /^(https?:\/\/|\/|data:|blob:)/;

// ─── Verbatim-compare helper ───────────────────────────
// Called when a row's identity+store already matches an existing product.
// If the incoming payload is byte-identical, we silently skip (don't
// queue for review) — otherwise we queue so admin can decide.
// "Byte-identical" here means: same descriptions, same variants (name +
// prices + stock + threshold + sku + is_default flag) in the same order,
// same image URLs in the same order. Order matters because the first
// image becomes primary and variant order drives the default fallback.

interface IncomingVariantForCompare {
  name_es: string;
  name_en: string;
  price: number;
  compare_at_price: number | null;
  b2b_price: number | null;
  stock_quantity: number;
  low_stock_threshold: number;
  sku: string | null;
  is_default: boolean;
}

interface ExistingProductForCompare {
  description_es: string | null;
  description_en: string | null;
  variants: Array<{
    name_es: string;
    name_en: string;
    price: import('@prisma/client/runtime/library').Decimal;
    compare_at_price: import('@prisma/client/runtime/library').Decimal | null;
    b2b_price: import('@prisma/client/runtime/library').Decimal | null;
    stock_quantity: number;
    low_stock_threshold: number;
    sku: string | null;
    is_default: boolean;
  }>;
  images: Array<{ url: string }>;
}

interface IncomingForCompare {
  description_es: string | null;
  description_en: string | null;
  variants: IncomingVariantForCompare[];
  image_urls: string[];
}

function sameOptionalString(a: string | null, b: string | null): boolean {
  return (a ?? '').trim() === (b ?? '').trim();
}

function isVerbatimDuplicate(existing: ExistingProductForCompare, incoming: IncomingForCompare): boolean {
  // Descriptions — trimmed compare so trailing whitespace from the sheet
  // doesn't count as a real difference.
  if (!sameOptionalString(existing.description_es, incoming.description_es)) return false;
  if (!sameOptionalString(existing.description_en, incoming.description_en)) return false;

  // Variant count then per-variant deep compare in the existing order.
  // The Prisma select above already orders variants by DB insertion; the
  // incoming array preserves the sheet's row order. If those two happen
  // to disagree even for otherwise-identical data, we prefer to queue
  // (safer) — matching the "any doubt → let admin decide" bias.
  if (existing.variants.length !== incoming.variants.length) return false;
  for (let i = 0; i < existing.variants.length; i++) {
    const ev = existing.variants[i];
    const iv = incoming.variants[i];
    if (ev.name_es !== iv.name_es) return false;
    if (ev.name_en !== iv.name_en) return false;
    if (Number(ev.price) !== iv.price) return false;
    if ((ev.compare_at_price == null ? null : Number(ev.compare_at_price)) !== iv.compare_at_price) return false;
    if ((ev.b2b_price        == null ? null : Number(ev.b2b_price))        !== iv.b2b_price) return false;
    if (ev.stock_quantity !== iv.stock_quantity) return false;
    if (ev.low_stock_threshold !== iv.low_stock_threshold) return false;
    if ((ev.sku ?? '') !== (iv.sku ?? '')) return false;
    if (ev.is_default !== iv.is_default) return false;
  }

  // Images — same count + same URLs in the same order. First URL becomes
  // primary in both places, so order matters here.
  if (existing.images.length !== incoming.image_urls.length) return false;
  for (let i = 0; i < existing.images.length; i++) {
    if (existing.images[i].url.trim() !== incoming.image_urls[i].trim()) return false;
  }
  return true;
}

// ─── Row → parsed shape ────────────────────────────────

interface RawRow {
  product_key: string;
  name_es: string;
  name_en: string;
  description_es: string;
  description_en: string;
  brand: string;
  origin: string;
  /** New name. Legacy header "shop_id" still populates this via getCell. */
  store_slug: string;
  /** New name. Legacy header "shop_name" still populates this via getCell. */
  store_name: string;
  category: string;
  subcategory: string;
  /** Third-tier taxonomy — optional, must belong to `subcategory`. Unknown
   *  values auto-created as `is_active=false` suggestions for admin review. */
  product_type: string;
  is_active: string;
  is_featured: string;
  iva: string;
  variant_name_es: string;
  variant_name_en: string;
  price: string;
  compare_at_price: string;
  b2b_price: string;
  stock_quantity: string;
  low_stock_threshold: string;
  sku: string;
  is_default_variant: string;
  image_urls: string;
  // For per-row error reporting
  _rowNumber: number;
}

interface ParsedVariant {
  name_es: string;
  name_en: string;
  price: number;
  compare_at_price: number | null;
  b2b_price: number | null;
  stock_quantity: number;
  low_stock_threshold: number;
  sku: string | null;
  is_default: boolean;
  is_active: boolean;
  _rowNumber: number;
}

interface ParsedProduct {
  product_key: string;
  name_es: string;
  name_en: string;
  description_es: string | null;
  description_en: string | null;
  /** Canonical brand/origin STRINGS — populated on every row so the
   *  denormalised Product.brand/origin columns stay in sync with the FK. */
  brand: string | null;
  origin: string | null;
  /** FK ids to Brand/Origin. Null on rows where the sheet value didn't
   *  match any existing row — those get auto-created as is_active=false
   *  in a pre-insert pass and their ids stitched in via `unknownBrandFillIn`. */
  brand_id: string | null;
  origin_id: string | null;
  store_id: string | null;
  /** Intended slug for the store, whether matched or awaiting auto-create.
   *  Used by the pre-insert store auto-create pass to stitch newly-created
   *  store ids back into products where store_id landed null. */
  store_slug: string | null;
  category_raw: string;
  subcategory_raw: string;
  is_active: boolean;
  is_featured: boolean;
  /** The IVA band the sheet gave; null = none, so the 0 % default, unreviewed. */
  vat_category: VatCategory | null;
  variants: ParsedVariant[];
  image_urls: string[];
  _firstRowNumber: number;
}

interface RowResult {
  row: number;
  product_key: string;
  status: 'created' | 'skipped' | 'error' | 'pending_category' | 'duplicate';
  productId?: string;
  productName?: string;
  variantCount?: number;
  error?: string;
  /** When status === 'pending_category', the raw category name that was queued. */
  pending_category_name?: string;
  /** Non-fatal notices — e.g. an unknown shop_name fell back to Cesto. */
  warnings?: string[];
  /** When status === 'duplicate', the existing row we matched against. */
  duplicate_of_id?: string;
  duplicate_of_source?: 'product' | 'pending';
}

// ─── POST /api/admin/products/import ───────────────────

// ─── POST /api/admin/products/import ───────────────────
// Now an ENQUEUE endpoint (Layer 3). Persists a ProductImportJob row and
// hands the file buffer to a same-process worker (setImmediate). Returns
// { jobId } immediately so the client can poll /jobs/:id for progress
// and the final BulkImportResult payload — no more 10-second-timeout /
// "did-it-actually-finish?" confusion.

router.post(
  '/',
  upload.single('file') as unknown as import('express').RequestHandler,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return error(res, 'No file uploaded. Send field "file" as multipart/form-data.', 400);
    }
    const adminId = req.admin?.adminId;
    if (!adminId) {
      return error(res, 'Admin authentication required.', 401);
    }

    // Prefer a client-supplied Idempotency-Key (the admin frontend sends a
    // SHA-256 of the file bytes); fall back to hashing the buffer ourselves
    // so a client that forgets the header still gets dedup.
    const clientKey = (req.header('Idempotency-Key') ?? '').trim();
    const idempotencyKey = clientKey || createHash('sha256').update(req.file.buffer).digest('hex');

    // If this admin already has an active import — running or queued —
    // return that job's id instead of starting a second one. Prevents the
    // double-submit → duplicate rows problem at the DB level (single
    // source of truth, unlike the in-memory lock we shipped in Layer 2).
    const activeForAdmin = await prisma.productImportJob.findFirst({
      where: { admin_id: adminId, status: { in: ['queued', 'running'] } },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    });
    if (activeForAdmin) {
      return success(res, { jobId: activeForAdmin.id, alreadyRunning: true }, 200);
    }

    // Same file, same admin, recent success? Replay the result — don't
    // insert a second copy of the same products. Keeps a 1-hour window so
    // stale replays don't happen months later after business data drifts.
    const replayCandidate = await prisma.productImportJob.findFirst({
      where: {
        admin_id: adminId,
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

    // Fresh job. Persist, hand the buffer to the worker, respond.
    const job = await prisma.productImportJob.create({
      data: {
        admin_id: adminId,
        idempotency_key: idempotencyKey,
        status: 'queued',
        filename: req.file.originalname,
        file_size: req.file.size,
      },
      select: { id: true },
    });

    // Copy the buffer so the file object can be GC'd — the worker owns
    // its own bytes for the duration of processing.
    const buffer = Buffer.from(req.file.buffer);
    setImmediate(() => {
      runImportJobWorker(job.id, buffer).catch((e) => {
        // eslint-disable-next-line no-console
        console.error(`[import] worker crashed for job ${job.id}:`, e);
      });
    });

    return success(res, { jobId: job.id, status: 'queued' }, 202);
  }),
);

// ─── GET /api/admin/products/import/jobs/:id ───────────
// Modal polls this every ~1s while a job is running. Returns status,
// processed / total for the progress bar, and the full BulkImportResult
// payload once status = 'done'. Guarded to the owning admin so admins
// can't peek at each other's jobs.

router.get(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const adminId = req.admin?.adminId;
    if (!adminId) return error(res, 'Admin authentication required.', 401);

    const job = await prisma.productImportJob.findFirst({
      where: { id: req.params.id, admin_id: adminId },
      select: {
        id: true,
        status: true,
        processed: true,
        total: true,
        result: true,
        error_message: true,
        filename: true,
        file_size: true,
        created_at: true,
        started_at: true,
        finished_at: true,
      },
    });
    if (!job) return error(res, 'Import job not found.', 404);
    return success(res, job);
  }),
);

// ─── GET /api/admin/products/import/jobs ───────────────
// Recent jobs for this admin — powers the "your last N imports" surface so
// admins can see prior reports without re-uploading the sheet.

router.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    const adminId = req.admin?.adminId;
    if (!adminId) return error(res, 'Admin authentication required.', 401);

    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '10'), 10) || 10));
    const jobs = await prisma.productImportJob.findMany({
      where: { admin_id: adminId },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        processed: true,
        total: true,
        error_message: true,
        filename: true,
        file_size: true,
        created_at: true,
        started_at: true,
        finished_at: true,
      },
    });
    return success(res, jobs);
  }),
);

// ─── Worker ────────────────────────────────────────────
// Same-process background execution. Owns its own buffer copy; updates the
// ProductImportJob row as it works. Kicked off via setImmediate from the
// POST handler above. Not tied to a request lifetime.

async function runImportJobWorker(jobId: string, fileBuffer: Buffer): Promise<void> {
    // Mark the job as started so the poller sees progress instead of a
    // stuck "queued" indicator.
    await prisma.productImportJob.update({
      where: { id: jobId },
      data: { status: 'running', started_at: new Date() },
    });

    // Small helper: mark the job as failed and stop. We throw
    // ImportJobFailure so all early-return sites can share one control-flow
    // path instead of scattering `return;` calls throughout the body.
    const failJob = async (message: string): Promise<never> => {
      await prisma.productImportJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          error_message: message,
          finished_at: new Date(),
        },
      });
      throw new ImportJobFailure(message);
    };

    try {

    // 1. Parse workbook ───────────────────────────────
    const wb = new ExcelJS.Workbook();
    try {
      // ExcelJS types want a Node Buffer; the setImmediate handoff preserves
      // Buffer, but TS sees a generic Buffer<ArrayBufferLike>. Cast via unknown.
      await wb.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);
    } catch (e) {
      return await failJob(`Could not read spreadsheet: ${(e as Error).message}`);
    }

    const ws = wb.worksheets.find((w) => w.name.toLowerCase() === 'products') ?? wb.worksheets[0];
    if (!ws) return await failJob('Spreadsheet has no worksheets.');

    // Map header row → column index. Tolerant of column reordering as long as
    // the header text matches one of our known keys.
    const headerRow = ws.getRow(1);
    const colIndex = new Map<string, number>();
    headerRow.eachCell((cell, colNumber) => {
      const key = cellToString(cell.value).toLowerCase();
      if (key) colIndex.set(key, colNumber);
    });

    const required = ['product_key', 'name_es', 'name_en', 'category', 'variant_name_es', 'variant_name_en', 'price', 'stock_quantity'];
    const missing = required.filter((k) => !colIndex.has(k));
    if (missing.length > 0) {
      return await failJob(
        `Missing required columns: ${missing.join(', ')}. Download the template to see the expected format.`,
      );
    }

    // 2. Read every data row ──────────────────────────
    const rows: RawRow[] = [];
    // Header aliases — first entry is canonical, later ones are accepted
    // legacy names so uploads authored against an older template still work.
    const HEADER_ALIASES: Record<string, string[]> = {
      store_slug: ['shop_id'],
      store_name: ['shop_name'],
    };
    const getCell = (rowNumber: number, key: string): string => {
      let idx = colIndex.get(key);
      if (!idx) {
        for (const legacy of HEADER_ALIASES[key] ?? []) {
          idx = colIndex.get(legacy);
          if (idx) break;
        }
      }
      if (!idx) return '';
      return cellToString(ws.getCell(rowNumber, idx).value);
    };

    for (let r = 2; r <= ws.rowCount; r++) {
      const row: RawRow = {
        product_key:         getCell(r, 'product_key'),
        name_es:             getCell(r, 'name_es'),
        name_en:             getCell(r, 'name_en'),
        description_es:      getCell(r, 'description_es'),
        description_en:      getCell(r, 'description_en'),
        brand:               getCell(r, 'brand'),
        origin:              getCell(r, 'origin'),
        store_slug:          getCell(r, 'store_slug'),
        store_name:          getCell(r, 'store_name'),
        category:            getCell(r, 'category'),
        subcategory:         getCell(r, 'subcategory'),
        product_type:        getCell(r, 'product_type'),
        is_active:           getCell(r, 'is_active'),
        is_featured:         getCell(r, 'is_featured'),
        iva:                 getCell(r, 'iva'),
        variant_name_es:     getCell(r, 'variant_name_es'),
        variant_name_en:     getCell(r, 'variant_name_en'),
        price:               getCell(r, 'price'),
        compare_at_price:    getCell(r, 'compare_at_price'),
        b2b_price:           getCell(r, 'b2b_price'),
        stock_quantity:      getCell(r, 'stock_quantity'),
        low_stock_threshold: getCell(r, 'low_stock_threshold'),
        sku:                 getCell(r, 'sku'),
        is_default_variant: getCell(r, 'is_default_variant'),
        image_urls:          getCell(r, 'image_urls'),
        _rowNumber: r,
      };
      // Skip wholly blank rows
      const allEmpty = Object.entries(row).every(([k, v]) => k.startsWith('_') || v === '');
      if (allEmpty) continue;
      rows.push(row);
    }

    if (rows.length === 0) {
      return await failJob('Spreadsheet is empty. Add at least one row beneath the header.');
    }

    // Now that we know how many data rows the sheet has, publish the total
    // so the modal's progress bar can render an accurate denominator.
    await prisma.productImportJob.update({
      where: { id: jobId },
      data: { total: rows.length },
    });

    // 3. Resolve all categories / subcategories / stores / brands / origins
    //    in one query each ──────────────────────────────
    // Brands + Origins were promoted from home_sections JSON blobs to real
    // tables on 2026-07-13 (see the `20260713140000_add_brands_and_origins`
    // migration). We read the full lists here so the resolver can match
    // sheet cells case-insensitively.
    const [allCategories, allSubcategories, allProductTypes, allStores, allBrands, allOrigins, existingProducts, existingPending] = await Promise.all([
      prisma.category.findMany({ select: { id: true, name_es: true, name_en: true } }),
      prisma.subCategory.findMany({ select: { id: true, name_es: true, name_en: true, category_id: true } }),
      // MV Slice — product_types (2026-07-17). Load ALL (active + inactive)
      // so the importer FK-links to existing suggestions instead of
      // duplicating them.
      prisma.productType.findMany({ select: { id: true, name_es: true, name_en: true, subcategory_id: true, is_active: true } }),
      // Load ALL stores (not just active) so the importer can FK-link a
      // product to an inactive store that already exists — no need to
      // auto-create a duplicate suggestion when the row is already there.
      prisma.store.findMany({ select: { id: true, slug: true, name: true, is_active: true } }),
      prisma.brand.findMany({ select: { id: true, name: true, is_active: true } }),
      prisma.origin.findMany({ select: { id: true, key: true, label_es: true, label_en: true, is_active: true } }),
      // Pre-import dedup: load identity fields + everything the verbatim
      // compare needs (variants, description, images). Upgraded 2026-07-24
      // from name+brand to full identity fingerprint (name_es + name_en
      // + brand + origin + category + subcategory + product_type) + store
      // awareness, matching the /duplicates endpoint. Pending products
      // stay on the old name+brand key because they lack resolved FKs.
      //
      // 2026-07-24 update: also pull variants + description + images so
      // rows that duplicate an existing product AND carry identical data
      // are silently skipped. Only rows with meaningful differences get
      // queued for admin review (see verbatim compare below).
      prisma.product.findMany({
        select: {
          id: true,
          name_es: true, name_en: true, brand: true, origin: true,
          description_es: true, description_en: true,
          category_id: true, subcategory_id: true, product_type_id: true,
          store_id: true,
          variants: {
            select: {
              name_es: true, name_en: true, price: true,
              compare_at_price: true, b2b_price: true,
              stock_quantity: true, low_stock_threshold: true,
              sku: true, is_default: true, is_active: true,
            },
          },
          images: {
            orderBy: [{ is_primary: 'desc' }, { sort_order: 'asc' }, { created_at: 'asc' }],
            select: { url: true },
          },
        },
      }),
      prisma.pendingProduct.findMany({ select: { id: true, name_es: true, brand: true } }),
    ]);

    // Case-insensitive, accent-stripped normalize — same rule as the
    // /duplicates detection endpoint.
    const normalizeDedup = (s: string) =>
      s.trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ');

    // Identity fingerprint. Two rows with the same fingerprint AND the
    // same store are duplicates. Cross-store is fine (multi-store listing).
    const productFingerprintOf = (p: {
      name_es: string; name_en: string;
      brand: string | null; origin: string | null;
      category_id: string;
      subcategory_id: string | null; product_type_id: string | null;
    }): string => JSON.stringify([
      normalizeDedup(p.name_es),
      normalizeDedup(p.name_en),
      normalizeDedup(p.brand ?? ''),
      normalizeDedup(p.origin ?? ''),
      p.category_id ?? '',
      p.subcategory_id ?? '',
      p.product_type_id ?? '',
    ]);
    // Real-product dedup key = fingerprint + store partition token. A row is
    // only a duplicate when the fingerprint AND the store match — different
    // stores never share a bucket, so the same product can be listed in many
    // stores. The token is the resolved store id, or (for a store the sheet
    // named but we couldn't match to a row) its intended slug, or null for
    // the Cesto house shop.
    const productStoreKey = (fp: string, storeToken: string | null) => `${fp}||${storeToken ?? '__cesto__'}`;

    // Legacy name+brand key for pending products (they lack FK ids).
    const pendingKey = (name: string, brand: string | null) =>
      `${normalizeDedup(name)}::${normalizeDedup(brand ?? '')}`;

    // Map of (fingerprint+store) → matched product entry. The full row is
    // kept so we can do a verbatim-compare (silently skip byte-identical
    // duplicates) without a second DB round-trip per flagged row.
    type MatchedProduct = typeof existingProducts[number];
    interface DedupEntry {
      id: string;
      name_es: string;
      source: 'product';
      /** Null for reservations we make during THIS run (a same-sheet
       *  second row targeting the same identity+store — nothing to
       *  compare against yet, so we treat it as non-verbatim). */
      product: MatchedProduct | null;
    }
    const productDedupMap = new Map<string, DedupEntry>();
    for (const p of existingProducts) {
      const key = productStoreKey(productFingerprintOf(p), p.store_id);
      // Keep the first (oldest) match on collision.
      if (!productDedupMap.has(key)) {
        productDedupMap.set(key, { id: p.id, name_es: p.name_es, source: 'product', product: p });
      }
    }
    const pendingDedupMap = new Map<string, { id: string; source: 'pending' }>();
    for (const p of existingPending) {
      pendingDedupMap.set(pendingKey(p.name_es, p.brand), { id: p.id, source: 'pending' });
    }
    // eslint-disable-next-line no-console
    console.log(
      `[import:dedup] jobId=${jobId} existingProducts=${existingProducts.length} existingPending=${existingPending.length} ` +
      `productMap=${productDedupMap.size} pendingMap=${pendingDedupMap.size} rule=identity+store`,
    );

    // lowerName → { id, canonicalName }. Only `is_active` brands are treated
    // as curated for the "unknown" surface, but the id lookup still finds
    // inactive rows (an admin previously added the brand but hasn't approved
    // it yet — we still FK-link to the row instead of creating a duplicate).
    const brandById = new Map<string, { id: string; name: string; isActive: boolean }>();
    for (const b of allBrands) {
      brandById.set(b.name.toLowerCase(), { id: b.id, name: b.name, isActive: b.is_active });
    }
    // Origins: match against `key`, `label_en`, or `label_es`. Canonical
    // string stored on Product.origin stays label_es.
    const originByAlias = new Map<string, { id: string; key: string; label_es: string; isActive: boolean }>();
    for (const o of allOrigins) {
      const entry = { id: o.id, key: o.key, label_es: o.label_es, isActive: o.is_active };
      for (const alias of [o.key, o.label_en, o.label_es]) {
        const v = alias.trim().toLowerCase();
        if (v && !originByAlias.has(v)) originByAlias.set(v, entry);
      }
    }

    // Sheet values that don't match ANY brand/origin row will get auto-created
    // as is_active=false rows in a pre-insert pass below, then surface in the
    // response so the admin knows to review them.
    const unknownBrandsSeen  = new Map<string, { name: string; count: number }>();
    const unknownOriginsSeen = new Map<string, { name: string; count: number }>();

    // Resolver return type: canonical string for the denormalised
    // Product.brand column PLUS the FK id when the row already exists. Rows
    // that need to be auto-created start with id=null and get filled in by
    // the pre-insert pass.
    interface BrandResolution  { name: string | null; id: string | null }
    interface OriginResolution { name: string | null; id: string | null }

    function resolveBrand(raw: string | null | undefined): BrandResolution {
      const value = (raw ?? '').trim();
      if (!value) return { name: null, id: null };
      const hit = brandById.get(value.toLowerCase());
      if (hit) {
        // Only surface curated-list membership when the row is active — an
        // inactive row still gets the FK link but the admin should re-check
        // it via the "unknown" advisory below.
        if (hit.isActive) return { name: hit.name, id: hit.id };
        const k = value.toLowerCase();
        const existing = unknownBrandsSeen.get(k);
        if (existing) existing.count += 1;
        else unknownBrandsSeen.set(k, { name: hit.name, count: 1 });
        return { name: hit.name, id: hit.id };
      }
      // Not in the table — record for the auto-create pre-pass below.
      const k = value.toLowerCase();
      const existing = unknownBrandsSeen.get(k);
      if (existing) existing.count += 1;
      else unknownBrandsSeen.set(k, { name: value, count: 1 });
      return { name: value, id: null };
    }

    function resolveOrigin(raw: string | null | undefined): OriginResolution {
      const value = (raw ?? '').trim();
      if (!value) return { name: null, id: null };
      const hit = originByAlias.get(value.toLowerCase());
      if (hit) {
        if (hit.isActive) return { name: hit.label_es, id: hit.id };
        const k = value.toLowerCase();
        const existing = unknownOriginsSeen.get(k);
        if (existing) existing.count += 1;
        else unknownOriginsSeen.set(k, { name: hit.label_es, count: 1 });
        return { name: hit.label_es, id: hit.id };
      }
      const k = value.toLowerCase();
      const existing = unknownOriginsSeen.get(k);
      if (existing) existing.count += 1;
      else unknownOriginsSeen.set(k, { name: value, count: 1 });
      return { name: value, id: null };
    }

    // Stores drive the store_slug/store_name resolver. Returns both the
    // Store UUID (for real Products) and its slug (for PendingProduct staging
    // and for the auto-create pre-insert pass below). Matches against ALL
    // stores — active or inactive — so an already-existing suggestion doesn't
    // get duplicated.
    //
    // Unknown-store handling changed on 2026-07-14 to mirror the brand +
    // origin flow: instead of silently defaulting to Cesto, we record the
    // unknown store, auto-create it as is_active=false + source='import'
    // in a pre-insert pass, and stitch its id back into the products array.
    // The admin then reviews suggestions on /stores.
    const unknownStoresSeen = new Map<string, { slug: string; name: string; count: number }>();

    function slugifyStoreKey(raw: string): string {
      return raw
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'store';
    }

    function resolveShop(
      rawId: string,
      rawName: string,
    ): { storeId: string | null; slug: string | null; partitionKey: string | null; warning: string | null } {
      const id   = rawId.trim();
      const name = rawName.trim();
      if (!id && !name) {
        // Unset → Cesto house shop. partitionKey null == the shared Cesto
        // dedup bucket.
        return { storeId: null, slug: null, partitionKey: null, warning: null };
      }

      // Match against any store (active or not), most-specific first:
      //   1. a raw UUID in either column → direct id match
      //   2. exact slug match (store_slug column)
      //   3. exact name match (store_name column)
      //   4. slugify() of either value equals a store slug — survives a
      //      display-name RENAME as long as the stable slug is unchanged.
      let match =
        (id   && UUID_RE.test(id)   ? allStores.find((s) => s.id === id)   : undefined) ??
        (name && UUID_RE.test(name) ? allStores.find((s) => s.id === name) : undefined);
      if (!match && id) {
        match = allStores.find((s) => s.slug.toLowerCase() === id.toLowerCase());
      }
      if (!match && name) {
        match = allStores.find((s) => s.name.toLowerCase() === name.toLowerCase());
      }
      if (!match) {
        for (const raw of [id, name]) {
          if (!raw) continue;
          const asSlug = slugifyStoreKey(raw);
          match = allStores.find((s) => s.slug.toLowerCase() === asSlug);
          if (match) break;
        }
      }
      if (match) {
        return { storeId: match.id, slug: match.slug, partitionKey: match.id, warning: null };
      }

      // Unknown store — record for auto-create + return the intended slug
      // (so PendingProducts + the auto-create pass have something to key on).
      // Prefer the raw slug; if only a name was given, slugify it.
      const displayName = name || id;
      const targetSlug  = id ? slugifyStoreKey(id) : slugifyStoreKey(name);
      const seen = unknownStoresSeen.get(targetSlug);
      if (seen) seen.count += 1;
      else unknownStoresSeen.set(targetSlug, { slug: targetSlug, name: displayName, count: 1 });
      return {
        storeId: null,
        slug:    targetSlug,
        // Partition dedup by the intended slug — NOT null. This keeps an
        // unresolved store in its own bucket instead of colliding with Cesto
        // products (and with other unresolved stores), so the same product
        // listed into a different store is no longer a false "duplicate".
        partitionKey: `slug:${targetSlug}`,
        warning:
          `Store "${displayName}" was not found — a suggested store "${targetSlug}" was ` +
          `created inactive on the Stores page. Assign the product there, or set the ` +
          `store_slug column to the store's existing slug.`,
      };
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    function resolveCategory(raw: string): string | null {
      if (!raw) return null;
      if (UUID_RE.test(raw)) return allCategories.find((c) => c.id === raw)?.id ?? null;
      const lower = raw.toLowerCase();
      return allCategories.find(
        (c) => c.name_es.toLowerCase() === lower || c.name_en.toLowerCase() === lower,
      )?.id ?? null;
    }
    // Unknown-subcategory tracking. Same pattern as product_type / brand /
    // origin — when a sheet names a subcategory that doesn't exist under
    // the row's category, we queue it here and auto-create as
    // is_active=false + source='import' in a post-loop pass, then back-
    // fill subcategory_id on every product that referenced it. The row
    // is NOT rejected; admin reviews the new subcategory on the
    // Categories page.
    const unknownSubcategoriesSeen = new Map<string, {
      key: string;              // "categoryId::lower-name" — dedup key per parent category
      name: string;             // display name (original casing)
      category_id: string;
      count: number;
    }>();
    function resolveSubcategory(raw: string, categoryId: string): string | null {
      if (!raw) return null;
      if (UUID_RE.test(raw)) {
        const found = allSubcategories.find((s) => s.id === raw);
        return found && found.category_id === categoryId ? found.id : null;
      }
      const lower = raw.trim().toLowerCase();
      const match = allSubcategories.find(
        (s) => s.category_id === categoryId && (s.name_es.toLowerCase() === lower || s.name_en.toLowerCase() === lower),
      );
      if (match) return match.id;

      // Unknown — queue for auto-create. Dedup on (category, lowered name).
      const dedupKey = `${categoryId}::${lower}`;
      const seen = unknownSubcategoriesSeen.get(dedupKey);
      if (seen) seen.count += 1;
      else unknownSubcategoriesSeen.set(dedupKey, {
        key: dedupKey,
        name: raw.trim(),
        category_id: categoryId,
        count: 1,
      });
      return null;
    }

    // Product-type resolver — scoped to a subcategory. Match by UUID or by
    // case-insensitive name in either language. Follows the same pattern as
    // resolveBrand/resolveOrigin/resolveStore for unknowns: track them,
    // auto-create as `is_active=false, source='import'` later so admin can
    // review before publishing.
    const unknownProductTypesSeen = new Map<string, {
      key: string;             // normalized "subcatId::lowerName" so we dedup per subcategory
      name: string;            // display name (original casing)
      subcategory_id: string;
      count: number;
    }>();
    function resolveProductType(raw: string, subcategoryId: string): string | null {
      if (!raw) return null;
      if (UUID_RE.test(raw)) {
        const found = allProductTypes.find((t) => t.id === raw);
        return found && found.subcategory_id === subcategoryId ? found.id : null;
      }
      const lower = raw.trim().toLowerCase();
      const match = allProductTypes.find(
        (t) => t.subcategory_id === subcategoryId && (t.name_es.toLowerCase() === lower || t.name_en.toLowerCase() === lower),
      );
      if (match) return match.id;

      // Unknown — queue for auto-create. Dedup on (subcategory, lowered name).
      const dedupKey = `${subcategoryId}::${lower}`;
      const seen = unknownProductTypesSeen.get(dedupKey);
      if (seen) seen.count += 1;
      else unknownProductTypesSeen.set(dedupKey, {
        key: dedupKey,
        name: raw.trim(),
        subcategory_id: subcategoryId,
        count: 1,
      });
      // Return null for now — the auto-create pass below will create the
      // row and this row's product will get FK-linked in the follow-up pass.
      return null;
    }

    // 4. Group rows by product_key and build a ParsedProduct per group ──
    // Per-request maps so concurrent imports never see each other's resolved ids.
    const productCategoryIds = new Map<string, string>();
    const productSubcategoryIds = new Map<string, string | null>();
    // MV Slice — product-type FK per product_key. Kept separate from
    // productSubcategoryIds so the auto-create pass below can back-fill
    // any keys whose product type was auto-created after resolveProductType
    // returned null the first time. Second entry — the raw name — lets the
    // back-fill match without re-scanning rows.
    const productProductTypeIds = new Map<string, string | null>();
    // subcategoryId is nullable: null when the row's subcategory was ALSO
    // unknown and awaiting auto-create. The post-loop back-fill looks up
    // the subcategory id via productSubcategoryIds after both auto-create
    // passes have run.
    const productProductTypeRaw = new Map<string, { subcategoryId: string | null; name: string } | null>();
    // Raw subcategory name per row, filled when resolveSubcategory returned
    // null (queued for auto-create). Same back-fill pattern as product_type.
    const productSubcategoryRaw = new Map<string, { categoryId: string; name: string } | null>();
    const productShopWarnings = new Map<string, string[]>();
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

    // Names + parsed products queued for admin to promote once a real
    // Category exists. Both are written together at the end of the handler.
    const pendingCategoryBumps = new Map<string, { name: string; count: number }>();
    const pendingProductWrites: Array<{
      category_name_key: string;
      category_name_raw: string;
      subcategory_name_raw: string | null;
      product_key: string;
      name_es: string;
      name_en: string;
      description_es: string | null;
      description_en: string | null;
      brand: string | null;
      origin: string | null;
      shop_id: string | null;
      is_active: boolean;
      is_featured: boolean;
      variants: ParsedVariant[];
      image_urls: string[];
      source_row_number: number;
    }> = [];

    const products: ParsedProduct[] = [];
    for (const [key, group] of grouped.entries()) {
      const head = group[0];

      if (!head.name_es || !head.name_en) {
        results.push({ row: head._rowNumber, product_key: key, status: 'error', error: 'name_es and name_en are required on the first row of each product_key.' });
        continue;
      }
      // The rate customers pay on top of this sheet's prices. Refused rather
      // than guessed: a wrong band is a wrong price on every size.
      const vatCategory = parseIva(head.iva);
      if (vatCategory === undefined) {
        results.push({ row: head._rowNumber, product_key: key, status: 'error', error: `iva must be 0, 4, 10 or 21 (got "${head.iva}").` });
        continue;
      }
      if (!head.category) {
        results.push({ row: head._rowNumber, product_key: key, status: 'error', error: 'category is required on the first row of each product_key.' });
        continue;
      }
      const categoryId = resolveCategory(head.category);
      const categoryUnknown = !categoryId;
      if (categoryUnknown) {
        // Queue the unknown name. We still parse variants/images below so the
        // full product can be parked in PendingProduct and resurrected once
        // admin creates the real Category.
        const rawName = head.category.trim();
        const key2 = rawName.toLowerCase();
        const existing = pendingCategoryBumps.get(key2);
        if (existing) existing.count += 1;
        else pendingCategoryBumps.set(key2, { name: rawName, count: 1 });
      }
      let subcategoryId: string | null = null;
      let subcategoryUnknownName: string | null = null;
      if (head.subcategory && !categoryUnknown) {
        subcategoryId = resolveSubcategory(head.subcategory, categoryId!);
        if (!subcategoryId) {
          // Unknown subcategory — queued for auto-create by resolveSubcategory.
          // Remember the raw name here so the back-fill pass below can look
          // up the newly-created id and stitch it onto this row.
          subcategoryUnknownName = head.subcategory.trim();
        }
      }

      // Product type — third-tier taxonomy, only meaningful when a
      // subcategory is set. resolveProductType returns null for unknown
      // names and queues them for the auto-create pass; the FK will get
      // patched in after auto-create runs.
      let productTypeIdInitial: string | null = null;
      let productTypeUnknownName: string | null = null;
      if (head.product_type && subcategoryId) {
        productTypeIdInitial = resolveProductType(head.product_type, subcategoryId);
        if (!productTypeIdInitial) {
          // resolveProductType already queued it in unknownProductTypesSeen
          productTypeUnknownName = head.product_type.trim();
        }
      }

      // Parse variants for every row in the group
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
          name_es: r.variant_name_es,
          name_en: r.variant_name_en,
          price,
          compare_at_price: compare,
          b2b_price: b2b,
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

      // Exactly one default; auto-pick first if none flagged.
      const defaults = variants.filter((v) => v.is_default);
      if (defaults.length === 0) variants[0].is_default = true;
      else if (defaults.length > 1) {
        // keep the first flagged, demote the rest
        let kept = false;
        for (const v of variants) {
          if (v.is_default) {
            if (kept) v.is_default = false;
            else kept = true;
          }
        }
      }

      // Images: only from head row, split on ; and validate
      const rawImages = head.image_urls
        ? head.image_urls.split(';').map((u) => u.trim()).filter(Boolean)
        : [];
      const badImage = rawImages.find((u) => !IMAGE_URL_RE.test(u));
      if (badImage) {
        results.push({ row: head._rowNumber, product_key: key, status: 'error', error: `Invalid image URL: "${badImage}". Must start with http(s):// or /.` });
        continue;
      }

      // Resolve shop assignment from shop_id / shop_name; null = Cesto default.
      const shopResolution = resolveShop(head.store_slug, head.store_name);
      const shopWarnings = shopResolution.warning ? [shopResolution.warning] : undefined;

      // ─── Pre-insert dedup ──
      // Two-layer check:
      //   1. Real product with the same IDENTITY fingerprint in the same
      //      store → stage in `product_import_duplicates` for admin review
      //      (they can Create Anyway or Dismiss on the Duplicates page).
      //   2. Pending product with the same name+brand → skipped as-before
      //      (pending rows haven't been reviewed yet; double-parking a
      //      second copy would just create parallel noise).
      // Within-sheet dedup: we mutate the maps as we go so a second row
      // that would match the first also gets caught.
      const dedupBrand  = resolveBrand(head.brand).name;
      const dedupOrigin = resolveOrigin(head.origin).name;
      const rowFingerprint = productFingerprintOf({
        name_es: head.name_es,
        name_en: head.name_en,
        brand:   dedupBrand,
        origin:  dedupOrigin,
        // Unknown category → categoryId is null; the row can never match a
        // real product's fingerprint anyway (real products always have a
        // resolved category_id). The pending-product check below still fires.
        category_id: categoryId ?? '',
        subcategory_id: subcategoryId,
        product_type_id: productTypeIdInitial,
      });
      const rowStoreKey = productStoreKey(rowFingerprint, shopResolution.partitionKey);
      const existingProductMatch = productDedupMap.get(rowStoreKey);
      const existingPendingMatch = pendingDedupMap.get(pendingKey(head.name_es, dedupBrand));
      const existingMatch = existingProductMatch ?? existingPendingMatch;
      if (head._rowNumber <= 6) {
        // eslint-disable-next-line no-console
        console.log(
          `[import:dedup] row=${head._rowNumber} match=${existingMatch ? `${existingMatch.source}:${existingMatch.id.slice(0, 8)}` : '(none)'} storeKey=${rowStoreKey.slice(0, 60)}…`,
        );
      }
      if (existingMatch) {
        // Real-product match → persist for admin review UNLESS the
        // incoming payload is byte-identical to the existing product
        // (verbatim re-upload of the same sheet). Pending match → just
        // skip as-before.
        const isVerbatim = existingProductMatch?.product
          ? isVerbatimDuplicate(existingProductMatch.product, {
              description_es: head.description_es || null,
              description_en: head.description_en || null,
              variants,
              image_urls: rawImages,
            })
          : false;
        if (existingProductMatch && !isVerbatim) {
          // Same-sheet reservations use a sentinel string id — no real
          // Product row exists yet, so pass null and let the queue entry
          // reference just the snapshot name.
          const matchedId = existingProductMatch.id === '(pending-this-run)'
            ? null
            : existingProductMatch.id;
          try {
            await prisma.productImportDuplicate.create({
              data: {
                job_id: jobId,
                source_row_number: head._rowNumber,
                matched_product_id: matchedId,
                matched_product_name: existingProductMatch.name_es,
                // Full payload — everything needed to actually create the
                // product on "Create anyway". Store the RESOLVED FKs (not
                // raw strings) so a later create doesn't have to re-run
                // resolution against tables that may have shifted. Cast
                // through Prisma.InputJsonValue because ParsedVariant is a
                // named class Prisma's JSON typing doesn't structurally
                // widen to InputJsonObject.
                payload: {
                  product_key: key,
                  name_es: head.name_es,
                  name_en: head.name_en,
                  description_es: head.description_es || null,
                  description_en: head.description_en || null,
                  brand:  dedupBrand,
                  origin: dedupOrigin,
                  brand_id:  resolveBrand(head.brand).id,
                  origin_id: resolveOrigin(head.origin).id,
                  category_id: categoryId,
                  subcategory_id: subcategoryId,
                  product_type_id: productTypeIdInitial,
                  store_id: shopResolution.storeId,
                  store_slug: shopResolution.slug,
                  is_active:   parseBool(head.is_active, true),
                  is_featured: parseBool(head.is_featured, false),
                  // Carried to the product if the review publishes it.
                  vat_category: vatCategory,
                  variants: variants as unknown as Prisma.InputJsonValue,
                  image_urls: rawImages,
                } satisfies Prisma.InputJsonObject,
              },
            });
          } catch (err) {
            // Non-fatal — if the queue insert fails, the row still gets
            // reported as duplicate below and the admin can re-upload later.
            // eslint-disable-next-line no-console
            console.warn(
              `[import:dedup] failed to queue duplicate for admin review (row=${head._rowNumber}): ` +
              (err instanceof Error ? err.message : String(err)),
            );
          }
        }
        results.push({
          row: head._rowNumber,
          product_key: key,
          status: 'duplicate',
          productName: head.name_es,
          duplicate_of_id: existingMatch.id,
          duplicate_of_source: existingMatch.source,
          error: existingProductMatch
            ? (isVerbatim
                ? 'Identical to an existing product — skipped (no changes to review).'
                : 'This product already exists in the same store — queued on the Duplicates page for review (Create anyway / Dismiss).')
            : 'A pending product with this name + brand already exists — skipped. Publish or discard it before re-importing.',
        });
        continue;
      }

      if (categoryUnknown) {
        // Park the fully-parsed product so the admin can publish it after
        // creating the matching Category. We don't add it to `products` —
        // that's the list of rows that will be inserted as real Products now.
        const rawName = head.category.trim();
        const brandRes  = resolveBrand(head.brand);
        const originRes = resolveOrigin(head.origin);
        pendingProductWrites.push({
          category_name_key: rawName.toLowerCase(),
          category_name_raw: rawName,
          subcategory_name_raw: head.subcategory ? head.subcategory.trim() : null,
          product_key: key,
          name_es: head.name_es,
          name_en: head.name_en,
          description_es: head.description_es || null,
          description_en: head.description_en || null,
          // PendingProduct still stores brand/origin as free-text strings —
          // FK linkage happens at publish time by re-resolving against the
          // Brand/Origin tables (which may have grown since parking).
          brand:  brandRes.name,
          origin: originRes.name,
          shop_id: shopResolution.slug,
          is_active: parseBool(head.is_active, true),
          is_featured: parseBool(head.is_featured, false),
          variants,
          image_urls: rawImages,
          source_row_number: head._rowNumber,
        });
        results.push({
          row: head._rowNumber,
          product_key: key,
          status: 'pending_category',
          pending_category_name: rawName,
          productName: head.name_es,
          variantCount: variants.length,
          error: `Category "${rawName}" doesn't exist yet — product queued. Create the category on the Categories page to publish it.`,
          warnings: shopWarnings,
        });
        // Reserve the dedup key so a second sheet-row with the same
        // name+brand this run also gets flagged instead of piling into
        // pending_products a second time. Pending map keys on name+brand
        // (see comment on pendingKey above).
        pendingDedupMap.set(
          pendingKey(head.name_es, dedupBrand),
          { id: '(pending-this-run)', source: 'pending' },
        );
        continue;
      }

      const brandRes  = resolveBrand(head.brand);
      const originRes = resolveOrigin(head.origin);
      products.push({
        product_key: key,
        name_es: head.name_es,
        name_en: head.name_en,
        description_es: head.description_es || null,
        description_en: head.description_en || null,
        brand:     brandRes.name,
        origin:    originRes.name,
        brand_id:  brandRes.id,
        origin_id: originRes.id,
        store_id:   shopResolution.storeId,
        store_slug: shopResolution.slug,
        category_raw: head.category,
        subcategory_raw: head.subcategory,
        is_active: parseBool(head.is_active, true),
        is_featured: parseBool(head.is_featured, false),
        vat_category: vatCategory,
        variants,
        image_urls: rawImages,
        _firstRowNumber: head._rowNumber,
      });
      // Reserve the identity+store key so a SECOND row in this same sheet
      // with the same identity + same store also gets flagged (staged for
      // review) rather than silently creating a real duplicate. `id` here
      // is a placeholder — the row isn't inserted yet, but by the time the
      // second row hits this check it doesn't matter which id we return,
      // just that the map has an entry. product=null means "no existing
      // row to compare against" so the verbatim-skip logic treats the
      // second-in-sheet row as a real collision to queue.
      productDedupMap.set(rowStoreKey, { id: '(pending-this-run)', name_es: head.name_es, source: 'product', product: null });
      // Stash any non-fatal warning so the success row can surface it after the insert.
      if (shopWarnings) productShopWarnings.set(key, shopWarnings);
      // Stash resolved ids on the product via closure variables below.
      // Simpler: keep a parallel map.
      productCategoryIds.set(key, categoryId!);
      productSubcategoryIds.set(key, subcategoryId);
      productProductTypeIds.set(key, productTypeIdInitial);
      // Raw subcategory name — set when resolveSubcategory returned null so
      // the post-loop back-fill can look up the auto-created id.
      productSubcategoryRaw.set(key, subcategoryUnknownName
        ? { categoryId: categoryId!, name: subcategoryUnknownName }
        : null);
      // Raw product_type name — either the sheet's value under a known
      // subcategory (existing behaviour) OR under a subcategory that will
      // exist after the auto-create pass (new: subcategoryId=null here,
      // the back-fill pass looks up the newly-created subcategoryId via
      // productSubcategoryIds AFTER the subcategory auto-create runs).
      const rawProductType = head.product_type ? head.product_type.trim() : '';
      productProductTypeRaw.set(key, rawProductType
        ? { subcategoryId: subcategoryId, name: rawProductType }
        : null);
      // Identity+store reservation was already recorded above (right after
      // products.push) so the second same-sheet dupe gets queued for review.
    }

    // Rollup log — how did the dedup partition end up.
    // eslint-disable-next-line no-console
    console.log(
      `[import:dedup] jobId=${jobId} rollup: total=${results.length} ` +
      `toCreate=${products.length} toPending=${pendingProductWrites.length} ` +
      `duplicatesFlagged=${results.filter((r) => r.status === 'duplicate').length} ` +
      `errors=${results.filter((r) => r.status === 'error').length}`,
    );

    // 4b. Auto-create Brand + Origin rows for any sheet values that didn't
    //     match an existing row. New rows are inserted as is_active=false so
    //     they don't pop onto the customer marquee until the admin curates
    //     them (logo + link + activate). Stitch the fresh ids back into the
    //     `products` array so the create loop can populate brand_id/origin_id.
    //
    // IMPORTANT: we also scan `pendingProductWrites` — those are rows whose
    //     categories don't exist yet, so they get parked instead of inserted.
    //     Without this, an admin who imports a full catalogue before creating
    //     any categories would end up with zero brand/origin suggestions,
    //     because everything landed in the pending queue. Publishing a pending
    //     product later re-resolves brand/origin against whatever curated rows
    //     exist at publish time — so having the rows already exist as
    //     suggestions is strictly better than waiting.
    const brandNamesToCreate  = new Set<string>();
    const originNamesToCreate = new Set<string>();
    for (const p of products) {
      if (p.brand  && !p.brand_id  && p.brand.trim())  brandNamesToCreate.add(p.brand.trim());
      if (p.origin && !p.origin_id && p.origin.trim()) originNamesToCreate.add(p.origin.trim());
    }
    for (const p of pendingProductWrites) {
      if (p.brand  && p.brand.trim())  brandNamesToCreate.add(p.brand.trim());
      if (p.origin && p.origin.trim()) originNamesToCreate.add(p.origin.trim());
    }
    // Drop names that ALREADY exist in the loaded curated map — we only want
    // to create truly-new rows here. (The `products` loop above already
    // filtered by `!p.brand_id`, but the pending pass doesn't have that
    // context, so we re-check against the map explicitly.)
    for (const name of Array.from(brandNamesToCreate)) {
      if (brandById.has(name.toLowerCase())) brandNamesToCreate.delete(name);
    }
    for (const name of Array.from(originNamesToCreate)) {
      if (originByAlias.has(name.toLowerCase())) originNamesToCreate.delete(name);
    }
    if (brandNamesToCreate.size > 0) {
      // Find-then-create so we can set `source='import'` ONLY on rows we
      // actually created here — an admin-created row that happens to match
      // a sheet brand mustn't be reclassified as a suggestion. The
      // per-admin lock earlier in this route guarantees serial execution
      // of imports, so the classic upsert-race isn't a concern.
      for (const name of brandNamesToCreate) {
        try {
          let b = await prisma.brand.findFirst({
            where:  { name: { equals: name, mode: 'insensitive' } },
            select: { id: true, name: true },
          });
          if (!b) {
            b = await prisma.brand.create({
              data: {
                name,
                slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'brand',
                is_active: false,
              },
              select: { id: true, name: true },
            });
            // Write `source='import'` via raw SQL — Prisma client types may
            // be stale on a long-running dev server (needs `prisma generate`
            // + restart to see the new column). Migration already added the
            // column so the write itself is safe.
            await prisma.$executeRawUnsafe(
              `UPDATE brands SET source = 'import' WHERE id = $1::uuid`,
              b.id,
            );
          }
          brandById.set(b.name.toLowerCase(), { id: b.id, name: b.name, isActive: false });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`[import] failed to auto-create Brand "${name}":`, (e as Error).message);
        }
      }
    }
    if (originNamesToCreate.size > 0) {
      for (const label of originNamesToCreate) {
        try {
          const slugKey = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'origin';
          // Same find-then-create pattern as brands so we only set
          // `source='import'` on rows we newly inserted here.
          let o = await prisma.origin.findFirst({
            where:  { key: slugKey },
            select: { id: true, key: true, label_es: true, label_en: true },
          });
          if (!o) {
            o = await prisma.origin.create({
              data: {
                key: slugKey,
                label_es: label,
                label_en: label,
                is_active: false,
              },
              select: { id: true, key: true, label_es: true, label_en: true },
            });
            await prisma.$executeRawUnsafe(
              `UPDATE origins SET source = 'import' WHERE id = $1::uuid`,
              o.id,
            );
          }
          const entry = { id: o.id, key: o.key, label_es: o.label_es, isActive: false };
          for (const alias of [o.key, o.label_en, o.label_es]) {
            const v = alias.trim().toLowerCase();
            if (v) originByAlias.set(v, entry);
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`[import] failed to auto-create Origin "${label}":`, (e as Error).message);
        }
      }
    }
    // 4c. Auto-create Store rows for any sheet values that didn't match an
    //     existing store. Same suggestion contract as brands + origins —
    //     rows land as is_active=false + source='import' for admin review.
    //     Also holds a slug → id map so we can stitch product.store_id back.
    const storeIdBySlug = new Map<string, string>(
      allStores.map((s) => [s.slug.toLowerCase(), s.id]),
    );
    if (unknownStoresSeen.size > 0) {
      for (const [, entry] of unknownStoresSeen) {
        try {
          let existing = await prisma.store.findFirst({
            where:  { slug: entry.slug },
            select: { id: true, slug: true },
          });
          if (!existing) {
            existing = await prisma.store.create({
              data: {
                slug:      entry.slug,
                name:      entry.name,
                is_active: false,
                // logo_bg has a NOT NULL default so no need to pass it.
              },
              select: { id: true, slug: true },
            });
            // `source='import'` via raw SQL — same story as brands/origins:
            // the Prisma client on a long-running dev server may not have
            // the column in its generated types yet. Migration already added
            // it so the write itself is safe.
            await prisma.$executeRawUnsafe(
              `UPDATE stores SET source = 'import' WHERE id = $1::uuid`,
              existing.id,
            );
          }
          storeIdBySlug.set(existing.slug.toLowerCase(), existing.id);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`[import] failed to auto-create Store "${entry.slug}":`, (e as Error).message);
        }
      }
    }

    // 4c-bis. Auto-create SubCategory rows for any sheet values that didn't
    //     match an existing subcategory under the row's category. Same
    //     is_active=false + source='import' suggestion contract as
    //     brands / origins / stores / product_types. Runs BEFORE the
    //     product_type auto-create so a row that queued BOTH an unknown
    //     subcategory AND an unknown product_type resolves in order:
    //     subcategory first, then product_type against the newly-known
    //     subcategory id.
    const subcategoryIdByKey = new Map<string, string>(); // "categoryId::lower-name" → id
    for (const s of allSubcategories) {
      subcategoryIdByKey.set(`${s.category_id}::${s.name_es.trim().toLowerCase()}`, s.id);
      subcategoryIdByKey.set(`${s.category_id}::${s.name_en.trim().toLowerCase()}`, s.id);
    }
    if (unknownSubcategoriesSeen.size > 0) {
      for (const [, entry] of unknownSubcategoriesSeen) {
        try {
          let existing = await prisma.subCategory.findFirst({
            where: {
              category_id: entry.category_id,
              OR: [
                { name_es: { equals: entry.name, mode: 'insensitive' } },
                { name_en: { equals: entry.name, mode: 'insensitive' } },
              ],
            },
            select: { id: true },
          });
          if (!existing) {
            existing = await prisma.subCategory.create({
              data: {
                category_id: entry.category_id,
                name_es:     entry.name,
                name_en:     entry.name,
                is_active:   false,
                // NOTE: SubCategory doesn't have a `source` column today.
                // If/when we add one (mirror of Brand/Origin/ProductType),
                // set it to 'import' here so the Suggestions filter picks
                // up admin-review candidates.
              },
              select: { id: true },
            });
          }
          subcategoryIdByKey.set(entry.key, existing.id);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(
            `[import] failed to auto-create SubCategory "${entry.name}" in category ${entry.category_id}:`,
            (e as Error).message,
          );
        }
      }
    }
    // Back-fill subcategory_id on every product whose subcategory was
    // unknown at row-scan time. Uses the raw name we stashed above.
    for (const [key, raw] of productSubcategoryRaw.entries()) {
      if (!raw) continue;
      const already = productSubcategoryIds.get(key);
      if (already) continue;
      const lookupKey = `${raw.categoryId}::${raw.name.trim().toLowerCase()}`;
      const id = subcategoryIdByKey.get(lookupKey);
      if (id) productSubcategoryIds.set(key, id);
    }

    // 4d. Auto-create ProductType rows for any sheet values that didn't
    //     match an existing type in the row's subcategory. Same suggestion
    //     contract as brands / origins / stores — rows land as
    //     is_active=false + source='import' for admin review. Also builds a
    //     lookup so we can back-fill product_type_id below.
    // Key: `${subcategoryId}::${lowercase-name}` — matches the dedup key used
    // in unknownProductTypesSeen so the same product_type in the same
    // subcategory only auto-creates once.
    //
    // Deferred rows: entries in productProductTypeRaw whose subcategoryId
    // was null at row-scan time (subcategory itself was unknown then). Now
    // that subcategory back-fill has run, we know the real id — re-run
    // resolveProductType-ish logic to detect existing types + queue new
    // ones into unknownProductTypesSeen.
    for (const [key, raw] of productProductTypeRaw.entries()) {
      if (!raw || raw.subcategoryId !== null) continue;
      const subId = productSubcategoryIds.get(key);
      if (!subId) continue; // subcategory auto-create failed — leave product_type null
      const lower = raw.name.trim().toLowerCase();
      const existing = allProductTypes.find(
        (t) => t.subcategory_id === subId
          && (t.name_es.toLowerCase() === lower || t.name_en.toLowerCase() === lower),
      );
      if (existing) {
        productProductTypeIds.set(key, existing.id);
        productProductTypeRaw.set(key, { subcategoryId: subId, name: raw.name });
      } else {
        const dedupKey = `${subId}::${lower}`;
        const seen = unknownProductTypesSeen.get(dedupKey);
        if (seen) seen.count += 1;
        else unknownProductTypesSeen.set(dedupKey, {
          key: dedupKey,
          name: raw.name.trim(),
          subcategory_id: subId,
          count: 1,
        });
        productProductTypeRaw.set(key, { subcategoryId: subId, name: raw.name });
      }
    }

    const productTypeIdByKey = new Map<string, string>();
    for (const t of allProductTypes) {
      productTypeIdByKey.set(`${t.subcategory_id}::${t.name_es.trim().toLowerCase()}`, t.id);
      productTypeIdByKey.set(`${t.subcategory_id}::${t.name_en.trim().toLowerCase()}`, t.id);
    }
    if (unknownProductTypesSeen.size > 0) {
      for (const [, entry] of unknownProductTypesSeen) {
        try {
          let existing = await prisma.productType.findFirst({
            where:  {
              subcategory_id: entry.subcategory_id,
              OR: [
                { name_es: { equals: entry.name, mode: 'insensitive' } },
                { name_en: { equals: entry.name, mode: 'insensitive' } },
              ],
            },
            select: { id: true },
          });
          if (!existing) {
            existing = await prisma.productType.create({
              data: {
                subcategory_id: entry.subcategory_id,
                name_es:        entry.name,
                name_en:        entry.name,
                is_active:      false,
                source:         'import',
              },
              select: { id: true },
            });
          }
          productTypeIdByKey.set(entry.key, existing.id);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`[import] failed to auto-create ProductType "${entry.name}" in subcategory ${entry.subcategory_id}:`, (e as Error).message);
        }
      }
    }

    // Back-fill product_type_id on every parsed product whose type was
    // initially unresolved (auto-created above now has an id). Skip rows
    // whose subcategoryId is still null — that means the subcategory
    // auto-create failed (see console.warn above); the product will get
    // created without a product_type FK, admin can fix on the product form.
    for (const [key, raw] of productProductTypeRaw.entries()) {
      if (!raw || raw.subcategoryId === null) continue;
      const existing = productProductTypeIds.get(key);
      if (existing) continue;
      const lookupKey = `${raw.subcategoryId}::${raw.name.trim().toLowerCase()}`;
      const id = productTypeIdByKey.get(lookupKey);
      if (id) productProductTypeIds.set(key, id);
    }

    // Stitch the newly-known ids back into every parsed product.
    for (const p of products) {
      if (!p.brand_id  && p.brand)  p.brand_id  = brandById.get(p.brand.toLowerCase())?.id  ?? null;
      if (!p.origin_id && p.origin) p.origin_id = originByAlias.get(p.origin.toLowerCase())?.id ?? null;
      if (!p.store_id  && p.store_slug) {
        p.store_id = storeIdBySlug.get(p.store_slug.toLowerCase()) ?? null;
      }
    }

    // 5. Create products one at a time so a single bad row doesn't roll back
    //    the whole batch. Each product create is still atomic on its own.
    // Batch progress writes to the job row every N inserts so the modal's
    // progress bar advances without hammering the DB once per product.
    const PROGRESS_BATCH = 5;
    let sinceLastProgressWrite = 0;
    for (const p of products) {
      try {
        const created = await prisma.product.create({
          data: {
            name_es:        p.name_es,
            name_en:        p.name_en,
            description_es: p.description_es,
            description_en: p.description_en,
            brand:          p.brand,
            origin:         p.origin,
            brand_id:       p.brand_id,
            origin_id:      p.origin_id,
            store_id:       p.store_id,
            category_id:    productCategoryIds.get(p.product_key)!,
            subcategory_id: productSubcategoryIds.get(p.product_key),
            product_type_id: productProductTypeIds.get(p.product_key) ?? null,
            is_active:      p.is_active,
            is_featured:    p.is_featured,
            // A rate the sheet gave is somebody's choice; blank keeps the
            // 0 % default, unreviewed.
            ...(p.vat_category ? { vat_category: p.vat_category, vat_category_reviewed: true } : {}),
            variants: {
              create: p.variants.map((v) => ({
                name_es:             v.name_es,
                name_en:             v.name_en,
                price:               v.price,
                compare_at_price:    v.compare_at_price,
                b2b_price:           v.b2b_price,
                stock_quantity:      v.stock_quantity,
                low_stock_threshold: v.low_stock_threshold,
                sku:                 v.sku,
                is_default:          v.is_default,
                is_active:           v.is_active,
              })),
            },
            images: {
              create: p.image_urls.map((url, i) => ({
                url,
                sort_order: i,
                is_primary: i === 0,
              })),
            },
          },
          select: { id: true, name_es: true, variants: { select: { id: true } } },
        });
        results.push({
          row: p._firstRowNumber,
          product_key: p.product_key,
          status: 'created',
          productId: created.id,
          productName: created.name_es,
          variantCount: created.variants.length,
          warnings: productShopWarnings.get(p.product_key),
        });
      } catch (e) {
        results.push({
          row: p._firstRowNumber,
          product_key: p.product_key,
          status: 'error',
          error: `Database error: ${(e as Error).message}`,
        });
      }
      // Bump progress every PROGRESS_BATCH rows regardless of created/error —
      // the progress bar reports rows CONSUMED, not rows successfully created,
      // which matches what the admin cares about ("is it still moving?").
      sinceLastProgressWrite++;
      if (sinceLastProgressWrite >= PROGRESS_BATCH) {
        sinceLastProgressWrite = 0;
        await prisma.productImportJob.update({
          where: { id: jobId },
          data: { processed: results.length },
        });
      }
    }

    // 6. Persist any newly-seen pending category names. Upsert so re-imports
    //    just bump the row count rather than duplicating.
    for (const { name, count } of pendingCategoryBumps.values()) {
      try {
        await prisma.pendingCategory.upsert({
          where: { name },
          update: {
            source_row_count: { increment: count },
          },
          create: { name, source_row_count: count },
        });
      } catch (e) {
        // Don't fail the whole import over a queue write — just log and continue.
        // eslint-disable-next-line no-console
        console.warn(`[import] failed to queue pending category "${name}":`, (e as Error).message);
      }
    }

    // 6b. Persist the parked products themselves. Each one is independent —
    //     a single failure shouldn't drop the rest.
    for (const p of pendingProductWrites) {
      try {
        await prisma.pendingProduct.create({
          data: {
            category_name_key:    p.category_name_key,
            category_name_raw:    p.category_name_raw,
            subcategory_name_raw: p.subcategory_name_raw,
            product_key:          p.product_key,
            name_es:              p.name_es,
            name_en:              p.name_en,
            description_es:       p.description_es,
            description_en:       p.description_en,
            brand:                p.brand,
            origin:               p.origin,
            shop_id:              p.shop_id,
            is_active:            p.is_active,
            is_featured:          p.is_featured,
            variants:             p.variants as unknown as object,
            image_urls:           p.image_urls as unknown as object,
            source_row_number:    p.source_row_number,
          },
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[import] failed to queue pending product "${p.name_es}":`, (e as Error).message);
      }
    }

    // 7. Sort results by row number for the UI
    results.sort((a, b) => a.row - b.row);
    const created    = results.filter((r) => r.status === 'created').length;
    const failed     = results.filter((r) => r.status === 'error').length;
    const pending    = results.filter((r) => r.status === 'pending_category').length;
    const duplicates = results.filter((r) => r.status === 'duplicate').length;

    // Sheet-brands that don't match anything in the curated Top Brands list.
    // Presented most-frequent first so the admin sees the highest-impact ones
    // at the top. Not an error — imports still succeed either way.
    const unknownBrands = Array.from(unknownBrandsSeen.values())
      .sort((a, b) => b.count - a.count);
    const unknownOrigins = Array.from(unknownOriginsSeen.values())
      .sort((a, b) => b.count - a.count);
    // Stores follow the same pattern — the response surfaces them so the
    // import modal can nudge the admin toward Stores → Suggestions.
    const unknownStores = Array.from(unknownStoresSeen.values())
      .sort((a, b) => b.count - a.count)
      .map(({ slug, name, count }) => ({ slug, name, count }));
    // Product types (2026-07-17). Auto-created as inactive suggestions
    // under their subcategory — admin reviews from the Categories page
    // where product types now sit nested under their subcategories.
    const unknownProductTypes = Array.from(unknownProductTypesSeen.values())
      .sort((a, b) => b.count - a.count)
      .map(({ subcategory_id, name, count }) => ({ subcategory_id, name, count }));
    // Subcategories (2026-07-24). Same pattern — the importer no longer
    // rejects rows with an unknown subcategory; it auto-creates the row
    // as is_active=false so admin activates it on the Categories page.
    const unknownSubcategories = Array.from(unknownSubcategoriesSeen.values())
      .sort((a, b) => b.count - a.count)
      .map(({ category_id, name, count }) => ({ category_id, name, count }));

    const payload = {
      total: results.length,
      created,
      failed,
      pending,
      duplicates,
      results,
      unknownBrands,
      unknownOrigins,
      unknownStores,
      unknownProductTypes,
      unknownSubcategories,
    };
    // Mark the job done and store the full BulkImportResult payload as the
    // job's `result`. The GET /jobs/:id endpoint hands this straight back to
    // the modal, which renders it with the same report table as before.
    await prisma.productImportJob.update({
      where: { id: jobId },
      data: {
        status: 'done',
        processed: results.length,
        result: payload as unknown as object,
        finished_at: new Date(),
      },
    });

    // Once per job rather than once per row — an import can create thousands
    // of products and the cached totals only need to be wrong-free at the end.
    invalidateCountCache();

    } catch (e) {
      // ImportJobFailure means we already updated the job row inside failJob
      // and just want to stop execution — swallow so the process doesn't log
      // it as an unhandled crash.
      if (e instanceof ImportJobFailure) return;
      // Anything else is an unexpected bug — mark the job failed with a
      // best-effort message and re-throw so it surfaces in server logs.
      // eslint-disable-next-line no-console
      console.error(`[import] unexpected worker error for job ${jobId}:`, e);
      await prisma.productImportJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          error_message: e instanceof Error ? e.message : String(e),
          finished_at: new Date(),
        },
      }).catch(() => { /* nothing we can do */ });
    }
}

/**
 * On boot, mark any jobs still in queued/running state as interrupted —
 * setImmediate doesn't survive a process restart, so those jobs will never
 * finish on their own. The admin will see status = 'interrupted' with a
 * clear error_message and can retry with a fresh idempotency window.
 */
export async function recoverInterruptedImportJobs(): Promise<void> {
  try {
    const r = await prisma.productImportJob.updateMany({
      where: { status: { in: ['queued', 'running'] } },
      data: {
        status: 'interrupted',
        error_message: 'API restarted before this import finished. Retry when ready.',
        finished_at: new Date(),
      },
    });
    if (r.count > 0) {
      // eslint-disable-next-line no-console
      console.log(`[import] marked ${r.count} orphaned import job(s) as interrupted on boot`);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[import] recoverInterruptedImportJobs failed:', e);
  }
}

// Multer errors (file too large, wrong type) come through here; surface a
// clean JSON message instead of HTML.
router.use((err: unknown, _req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
  if (err instanceof multer.MulterError) return error(res, err.message, 400);
  if (err instanceof Error && err.message) return error(res, err.message, 400);
  next(err);
});

export default router;
