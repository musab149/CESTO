/**
 * Column registry for the bulk-edit grid.
 *
 * One entry per editable field. `scope` decides which row kind the cell
 * belongs to — product columns render blank on variant rows and vice versa,
 * which is what gives the grid Shopify's parent/child look.
 *
 * Fields deliberately absent: images (edited in the single-product form) and
 * the Nutrition tab (ingredients/allergens/storage/country) — those have no
 * columns in the Prisma schema and are never persisted.
 */

export type CellType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'boolean'
  | 'select'
  | 'default-radio';

export type OptionsSource =
  | 'category'
  | 'subcategory'
  | 'productType'
  | 'store'
  | 'brand'
  | 'origin';

export interface ColumnDef {
  /** Unique column key. Variant columns are prefixed `v.`. */
  key: string;
  scope: 'product' | 'variant';
  /** DB field name sent in the patch payload. */
  field: string;
  /** i18n key under products.bulk.fields */
  labelKey: string;
  /** i18n key under products.bulk.groups — groups the Columns picker. */
  group: 'general' | 'organization' | 'visibility' | 'pricing' | 'inventory';
  type: CellType;
  width: number;
  defaultVisible: boolean;
  optionsSource?: OptionsSource;
  /** Column key this one cascades from — changing the parent clears this. */
  dependsOn?: string;
  /** Empty string clears the value to null rather than failing validation. */
  nullable?: boolean;
  /** Minimum allowed numeric value. */
  min?: number;
  max?: number;
  integer?: boolean;
}

export const BULK_COLUMNS: ColumnDef[] = [
  // ─── General ───
  { key: 'name_es', scope: 'product', field: 'name_es', labelKey: 'name_es', group: 'general', type: 'text', width: 280, defaultVisible: true },
  { key: 'name_en', scope: 'product', field: 'name_en', labelKey: 'name_en', group: 'general', type: 'text', width: 280, defaultVisible: false },
  { key: 'description_es', scope: 'product', field: 'description_es', labelKey: 'description_es', group: 'general', type: 'textarea', width: 320, defaultVisible: false, nullable: true },
  { key: 'description_en', scope: 'product', field: 'description_en', labelKey: 'description_en', group: 'general', type: 'textarea', width: 320, defaultVisible: false, nullable: true },

  // ─── Organization ───
  { key: 'category_id', scope: 'product', field: 'category_id', labelKey: 'category_id', group: 'organization', type: 'select', width: 220, defaultVisible: true, optionsSource: 'category' },
  { key: 'subcategory_id', scope: 'product', field: 'subcategory_id', labelKey: 'subcategory_id', group: 'organization', type: 'select', width: 220, defaultVisible: false, optionsSource: 'subcategory', dependsOn: 'category_id', nullable: true },
  { key: 'product_type_id', scope: 'product', field: 'product_type_id', labelKey: 'product_type_id', group: 'organization', type: 'select', width: 220, defaultVisible: false, optionsSource: 'productType', dependsOn: 'subcategory_id', nullable: true },
  { key: 'brand', scope: 'product', field: 'brand', labelKey: 'brand', group: 'organization', type: 'select', width: 200, defaultVisible: false, optionsSource: 'brand', nullable: true },
  { key: 'origin', scope: 'product', field: 'origin', labelKey: 'origin', group: 'organization', type: 'select', width: 200, defaultVisible: false, optionsSource: 'origin', nullable: true },
  { key: 'store_id', scope: 'product', field: 'store_id', labelKey: 'store_id', group: 'organization', type: 'select', width: 220, defaultVisible: false, optionsSource: 'store', nullable: true },

  // ─── Visibility ───
  { key: 'is_active', scope: 'product', field: 'is_active', labelKey: 'is_active', group: 'visibility', type: 'boolean', width: 110, defaultVisible: true },
  { key: 'is_featured', scope: 'product', field: 'is_featured', labelKey: 'is_featured', group: 'visibility', type: 'boolean', width: 110, defaultVisible: false },
  { key: 'is_new_arrival', scope: 'product', field: 'is_new_arrival', labelKey: 'is_new_arrival', group: 'visibility', type: 'boolean', width: 110, defaultVisible: false },
  { key: 'is_top_seller', scope: 'product', field: 'is_top_seller', labelKey: 'is_top_seller', group: 'visibility', type: 'boolean', width: 120, defaultVisible: false },
  { key: 'is_sponsored', scope: 'product', field: 'is_sponsored', labelKey: 'is_sponsored', group: 'visibility', type: 'boolean', width: 120, defaultVisible: false },
  { key: 'is_verified', scope: 'product', field: 'is_verified', labelKey: 'is_verified', group: 'visibility', type: 'boolean', width: 110, defaultVisible: false },
  { key: 'rating', scope: 'product', field: 'rating', labelKey: 'rating', group: 'visibility', type: 'number', width: 110, defaultVisible: false, nullable: true, min: 0, max: 5 },
  { key: 'rating_count', scope: 'product', field: 'rating_count', labelKey: 'rating_count', group: 'visibility', type: 'number', width: 130, defaultVisible: false, min: 0, integer: true },

  // ─── Variant: pricing ───
  { key: 'v.name_es', scope: 'variant', field: 'name_es', labelKey: 'variant_name_es', group: 'pricing', type: 'text', width: 180, defaultVisible: false },
  { key: 'v.sku', scope: 'variant', field: 'sku', labelKey: 'sku', group: 'pricing', type: 'text', width: 150, defaultVisible: false, nullable: true },
  { key: 'v.price', scope: 'variant', field: 'price', labelKey: 'price', group: 'pricing', type: 'currency', width: 130, defaultVisible: true, min: 0 },
  { key: 'v.compare_at_price', scope: 'variant', field: 'compare_at_price', labelKey: 'compare_at_price', group: 'pricing', type: 'currency', width: 150, defaultVisible: false, nullable: true, min: 0 },
  { key: 'v.b2b_price', scope: 'variant', field: 'b2b_price', labelKey: 'b2b_price', group: 'pricing', type: 'currency', width: 130, defaultVisible: false, nullable: true, min: 0 },
  // The buying price — admin only (API lib/prisma omits it everywhere else). Shown by default: every size starts at 0 and this grid is the quick way to fill them in.
  { key: 'v.cost_price', scope: 'variant', field: 'cost_price', labelKey: 'cost_price', group: 'pricing', type: 'currency', width: 130, defaultVisible: true, min: 0 },

  // ─── Variant: inventory ───
  { key: 'v.stock_quantity', scope: 'variant', field: 'stock_quantity', labelKey: 'stock_quantity', group: 'inventory', type: 'number', width: 110, defaultVisible: true, min: 0, integer: true },
  { key: 'v.low_stock_threshold', scope: 'variant', field: 'low_stock_threshold', labelKey: 'low_stock_threshold', group: 'inventory', type: 'number', width: 140, defaultVisible: false, min: 0, integer: true },
  { key: 'v.is_default', scope: 'variant', field: 'is_default', labelKey: 'is_default', group: 'inventory', type: 'default-radio', width: 110, defaultVisible: false },
];

/** name_es is rendered as the sticky first column, never in the scroll area. */
export const STICKY_COLUMN_KEY = 'name_es';

export const COLUMN_GROUPS = ['general', 'organization', 'visibility', 'pricing', 'inventory'] as const;

export const DEFAULT_VISIBLE_KEYS = BULK_COLUMNS
  .filter((c) => c.defaultVisible && c.key !== STICKY_COLUMN_KEY)
  .map((c) => c.key);

const STORAGE_KEY = 'cesto-admin-bulk-columns';

/**
 * Columns added after a layout was saved as a bare array — the format before
 * the save started remembering which columns existed. A default-visible one
 * of these is shown to an admin who saved before it was built; otherwise the
 * buying price (2026-10-27) stayed hidden from everyone who ever touched the
 * picker.
 */
const ADDED_AFTER_ARRAY_FORMAT = ['v.cost_price'];

export function loadVisibleColumns(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE_KEYS;
    const parsed = JSON.parse(raw) as unknown;
    // { visible, known }: `known` is every column there was when it was saved.
    const saved = Array.isArray(parsed)
      ? { visible: parsed as unknown[], known: BULK_COLUMNS.map((c) => c.key).filter((k) => !ADDED_AFTER_ARRAY_FORMAT.includes(k)) }
      : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { visible?: unknown }).visible))
        ? { visible: (parsed as { visible: unknown[] }).visible, known: ((parsed as { known?: unknown[] }).known ?? []).filter((k): k is string => typeof k === 'string') }
        : null;
    if (!saved) return DEFAULT_VISIBLE_KEYS;
    // Drop keys from a previous build so a renamed column can't wedge the grid.
    const exists = new Set(BULK_COLUMNS.map((c) => c.key));
    const visible = saved.visible.filter((k): k is string => typeof k === 'string' && exists.has(k) && k !== STICKY_COLUMN_KEY);
    // Columns built since the save, and on by default, join it.
    const fresh = DEFAULT_VISIBLE_KEYS.filter((k) => !saved.known.includes(k) && !visible.includes(k));
    return [...visible, ...fresh];
  } catch {
    return DEFAULT_VISIBLE_KEYS;
  }
}

export function saveVisibleColumns(keys: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ visible: keys, known: BULK_COLUMNS.map((c) => c.key) }));
  } catch {
    // Private-mode / quota — column layout just won't persist.
  }
}

/**
 * Parse a numeric cell. Accepts both `,` and `.` as the decimal separator
 * because the grid renders es-ES formatting and admins type what they see.
 * Returns `undefined` when the text isn't a usable number.
 */
export function parseNumericCell(raw: string, col: ColumnDef): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return col.nullable ? null : undefined;
  const n = Number(trimmed.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return undefined;
  if (col.integer && !Number.isInteger(n)) return undefined;
  if (col.min !== undefined && n < col.min) return undefined;
  if (col.max !== undefined && n > col.max) return undefined;
  // Decimal(10,2) in the DB — round here so the diff doesn't flag a value
  // that the server would silently truncate anyway.
  return col.type === 'currency' ? Math.round(n * 100) / 100 : n;
}
