import { useRef, useState } from 'react';
import {
  X, Minus, Plus, RefreshCw, Trash2, Search, Loader2, AlertTriangle, PackagePlus, Info,
} from 'lucide-react';
import {
  useEditPartnerOrderItems, usePartnerProducts, usePartnerProduct, resolveImageUrl,
  priceWithVat, effectiveVatCategory, lineVatCategory, recargoOnCents, VAT_RATES, type VatCategory,
  type Order, type OrderEditOperation,
} from '@grocery-app/shared';
import { usePartnerT } from '../lib/i18n';

/**
 * Partner-scoped "Edit Order" modal. Lets the store change an item's
 * quantity, replace it with a different product/variant, or remove it,
 * then save in one batch. Structural template: ImportProductsModal.tsx
 * (scrollable body, sticky footer). Server is authoritative on pricing/
 * stock — the running total shown here is a client-side estimate.
 */

interface Props {
  order: Order & { items: any[] };
  onClose: () => void;
}

interface RowState {
  orderItemId: string;
  originalQuantity: number;
  quantity: number;
  removed: boolean;
  confirmingRemove: boolean;
  replacement: { variantId: string; name: string; price: number; vatCategory: VatCategory } | null;
  vatCategory: VatCategory;
  nameEs: string;
  variantNameEs: string;
  imageUrl: string | null;
  unitPrice: number;
}

interface NewItemState {
  tempId: string;
  variantId: string;
  name: string;
  price: number;
  vatCategory: VatCategory;
  quantity: number;
}

/** What the picker hands back: a size, priced with IVA, and the band it was priced at. */
type PickedVariant = { id: string; name: string; price: number; vatCategory: VatCategory };

function formatCurrency(n: number): string {
  return n.toFixed(2).replace('.', ',') + ' €';
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return 'Something went wrong. Please try again.';
}

export default function EditOrderModal({ order, onClose }: Props) {
  const t = usePartnerT();
  const editItems = useEditPartnerOrderItems();
  const [saveError, setSaveError] = useState<string | null>(null);

  const [rows, setRows] = useState<RowState[]>(() =>
    (order.items ?? []).map((it: any) => ({
      orderItemId: it.id,
      originalQuantity: it.quantity,
      quantity: it.quantity,
      removed: false,
      confirmingRemove: false,
      replacement: null,
      nameEs: it.product_snapshot?.name_es ?? '',
      variantNameEs: it.product_snapshot?.variant_name_es ?? '',
      imageUrl: it.product_snapshot?.image_url ?? null,
      unitPrice: Number(it.unit_price),
      vatCategory: lineVatCategory(it),
    })),
  );

  const [pickerForRow, setPickerForRow] = useState<string | null>(null);
  const [newItems, setNewItems] = useState<NewItemState[]>([]);
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const nextTempId = useRef(0);

  // Recargo de equivalencia, by the server's rule, on an order under the regime;
  // a part of a split purchase carries none (the purchase does).
  const recargo = order.recargo_equivalencia && !order.parent_order_id
    ? recargoOnCents([
      ...rows.filter((r) => !r.removed).map((r) => ({
        grossCents: Math.round(r.quantity * (r.replacement?.price ?? r.unitPrice) * 100),
        rate_pct: VAT_RATES[r.replacement?.vatCategory ?? r.vatCategory],
      })),
      ...newItems.map((n) => ({ grossCents: Math.round(n.quantity * n.price * 100), rate_pct: VAT_RATES[n.vatCategory] })),
    ], Math.round(Number(order.delivery_fee) * 100)) / 100
    : 0;

  const estimatedTotal = rows
    .filter((r) => !r.removed)
    .reduce((sum, r) => sum + r.quantity * (r.replacement?.price ?? r.unitPrice), 0)
    + newItems.reduce((sum, n) => sum + n.quantity * n.price, 0)
    + Number(order.delivery_fee)
    + recargo;

  // Mirrors editOrder.ts's own zero-item guard: block save once removes
  // minus adds would leave nothing on the order.
  const remainingCount = rows.filter((r) => !r.removed).length + newItems.length;
  const wouldBeEmpty = remainingCount <= 0;

  const operations: OrderEditOperation[] = [];
  for (const r of rows) {
    if (r.removed) {
      operations.push({ action: 'remove', order_item_id: r.orderItemId });
    } else if (r.replacement) {
      operations.push({
        action: 'replace', order_item_id: r.orderItemId,
        new_variant_id: r.replacement.variantId, new_quantity: r.quantity,
      });
    } else if (r.quantity !== r.originalQuantity) {
      operations.push({ action: 'update_qty', order_item_id: r.orderItemId, new_quantity: r.quantity });
    }
  }
  for (const n of newItems) {
    operations.push({ action: 'add', new_variant_id: n.variantId, new_quantity: n.quantity });
  }

  function updateQty(rowId: string, delta: number) {
    setRows((prev) => prev.map((r) => (r.orderItemId === rowId ? { ...r, quantity: Math.max(1, r.quantity + delta) } : r)));
  }

  function startRemove(rowId: string) {
    setRows((prev) => prev.map((r) => (r.orderItemId === rowId ? { ...r, confirmingRemove: true } : r)));
  }
  function cancelRemove(rowId: string) {
    setRows((prev) => prev.map((r) => (r.orderItemId === rowId ? { ...r, confirmingRemove: false } : r)));
  }
  function confirmRemove(rowId: string) {
    setRows((prev) => prev.map((r) => (r.orderItemId === rowId ? { ...r, removed: true, confirmingRemove: false } : r)));
  }
  function undoRemove(rowId: string) {
    setRows((prev) => prev.map((r) => (r.orderItemId === rowId ? { ...r, removed: false } : r)));
  }

  function applyReplacement(rowId: string, variant: PickedVariant) {
    setRows((prev) => prev.map((r) => (r.orderItemId === rowId
      ? { ...r, replacement: { variantId: variant.id, name: variant.name, price: variant.price, vatCategory: variant.vatCategory } }
      : r)));
    setPickerForRow(null);
  }

  function addNewItem(variant: PickedVariant) {
    const tempId = `new-${nextTempId.current++}`;
    setNewItems((prev) => [...prev, { tempId, variantId: variant.id, name: variant.name, price: variant.price, vatCategory: variant.vatCategory, quantity: 1 }]);
    setAddPickerOpen(false);
  }
  function updateNewItemQty(tempId: string, delta: number) {
    setNewItems((prev) => prev.map((n) => (n.tempId === tempId ? { ...n, quantity: Math.max(1, n.quantity + delta) } : n)));
  }
  function removeNewItem(tempId: string) {
    setNewItems((prev) => prev.filter((n) => n.tempId !== tempId));
  }

  function handleSave() {
    setSaveError(null);
    if (operations.length === 0) { onClose(); return; }
    editItems.mutate(
      { id: order.id, payload: { operations } },
      { onSuccess: () => onClose(), onError: (err) => setSaveError(errorMessage(err)) },
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => { if (!editItems.isPending) onClose(); }}
    >
      <div
        className="bg-white rounded-2xl shadow-modal w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-bold font-display text-ink">{t('orders.editOrder.title')}</h2>
            <p className="text-xs text-muted font-body mt-0.5">{t('orders.editOrder.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg hover:bg-surface-cream flex items-center justify-center transition"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-ink" strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          <div className="flex items-start gap-2 rounded-lg bg-info-bg border border-info/30 p-3">
            <Info size={16} strokeWidth={1.75} className="text-info shrink-0 mt-0.5" />
            <p className="text-xs text-info font-body">{t('orders.editOrder.ownStoreNote')}</p>
          </div>

          {rows.map((r) => (
            <div
              key={r.orderItemId}
              className={`rounded-lg border p-3 ${r.removed ? 'border-border bg-surface-linen opacity-60' : 'border-border bg-surface-cream'}`}
            >
              <div className="flex items-start gap-3">
                {r.imageUrl && (
                  <img
                    src={resolveImageUrl(r.imageUrl, 'thumb') ?? ''}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover bg-white shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink truncate">
                    {r.replacement ? r.replacement.name : r.nameEs}
                  </p>
                  {!r.replacement && r.variantNameEs && (
                    <p className="text-xs text-gray truncate">{r.variantNameEs}</p>
                  )}
                  {r.replacement && (
                    <p className="text-xs text-brand truncate">{t('orders.editOrder.replacing')} {r.nameEs}</p>
                  )}
                </div>
                {!r.removed && (
                  <span className="text-sm font-semibold text-ink shrink-0 whitespace-nowrap">
                    {formatCurrency(r.quantity * (r.replacement?.price ?? r.unitPrice))}
                  </span>
                )}
              </div>

              {!r.removed ? (
                <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateQty(r.orderItemId, -1)}
                      disabled={r.quantity <= 1}
                      className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-ink hover:bg-white disabled:opacity-40"
                    >
                      <Minus size={14} strokeWidth={2} />
                    </button>
                    <span className="w-8 text-center text-sm font-semibold text-ink">{r.quantity}</span>
                    <button
                      type="button"
                      onClick={() => updateQty(r.orderItemId, 1)}
                      className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-ink hover:bg-white"
                    >
                      <Plus size={14} strokeWidth={2} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPickerForRow(pickerForRow === r.orderItemId ? null : r.orderItemId)}
                      className="h-8 px-3 rounded-lg border border-border text-xs font-semibold text-ink hover:bg-white inline-flex items-center gap-1.5"
                    >
                      <RefreshCw size={13} strokeWidth={1.75} /> {t('orders.editOrder.replace')}
                    </button>
                    {r.confirmingRemove ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => confirmRemove(r.orderItemId)}
                          className="h-8 px-3 rounded-lg bg-danger text-white text-xs font-semibold hover:bg-danger/90"
                        >
                          {t('orders.editOrder.confirmRemove')}
                        </button>
                        <button
                          type="button"
                          onClick={() => cancelRemove(r.orderItemId)}
                          className="h-8 px-2 rounded-lg text-xs font-semibold text-muted hover:bg-white"
                        >
                          {t('orders.editOrder.cancelRemove')}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startRemove(r.orderItemId)}
                        className="h-8 px-3 rounded-lg border border-danger/40 text-xs font-semibold text-danger hover:bg-danger-bg/40 inline-flex items-center gap-1.5"
                      >
                        <Trash2 size={13} strokeWidth={1.75} /> {t('orders.editOrder.remove')}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs text-muted">{t('orders.editOrder.willBeRemoved')}</p>
                  <button
                    type="button"
                    onClick={() => undoRemove(r.orderItemId)}
                    className="text-xs font-semibold text-brand hover:underline"
                  >
                    {t('orders.editOrder.undo')}
                  </button>
                </div>
              )}

              {pickerForRow === r.orderItemId && (
                <div className="mt-3">
                  <ProductPicker
                    onPick={(v) => applyReplacement(r.orderItemId, v)}
                    onClose={() => setPickerForRow(null)}
                  />
                </div>
              )}
            </div>
          ))}

          {newItems.map((n) => (
            <div key={n.tempId} className="rounded-lg border border-brand/30 bg-brand-mist/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink truncate">{n.name}</p>
                  <p className="text-xs text-brand">{t('orders.editOrder.newItem')}</p>
                </div>
                <span className="text-sm font-semibold text-ink shrink-0 whitespace-nowrap">
                  {formatCurrency(n.quantity * n.price)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => updateNewItemQty(n.tempId, -1)}
                    disabled={n.quantity <= 1}
                    className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-ink hover:bg-white disabled:opacity-40"
                  >
                    <Minus size={14} strokeWidth={2} />
                  </button>
                  <span className="w-8 text-center text-sm font-semibold text-ink">{n.quantity}</span>
                  <button
                    type="button"
                    onClick={() => updateNewItemQty(n.tempId, 1)}
                    className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-ink hover:bg-white"
                  >
                    <Plus size={14} strokeWidth={2} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removeNewItem(n.tempId)}
                  className="h-8 px-3 rounded-lg border border-danger/40 text-xs font-semibold text-danger hover:bg-danger-bg/40 inline-flex items-center gap-1.5"
                >
                  <Trash2 size={13} strokeWidth={1.75} /> {t('orders.editOrder.remove')}
                </button>
              </div>
            </div>
          ))}

          {addPickerOpen ? (
            <ProductPicker onPick={addNewItem} onClose={() => setAddPickerOpen(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setAddPickerOpen(true)}
              className="w-full h-11 rounded-lg border-2 border-dashed border-border text-sm font-semibold text-ink hover:border-brand hover:bg-brand-mist/20 transition-colors inline-flex items-center justify-center gap-2"
            >
              <PackagePlus size={16} strokeWidth={1.75} /> {t('orders.editOrder.addItem')}
            </button>
          )}

          {wouldBeEmpty && (
            <div className="flex items-start gap-2 rounded-lg bg-danger-bg/40 border border-danger/30 p-3">
              <AlertTriangle size={16} strokeWidth={1.75} className="text-danger shrink-0 mt-0.5" />
              <p className="text-xs text-danger font-body">{t('orders.editOrder.cannotRemoveAll')}</p>
            </div>
          )}

          {saveError && (
            <p role="alert" className="text-xs text-danger font-body">{saveError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border flex-wrap">
          <p className="text-sm text-muted font-body">
            {t('orders.editOrder.estimatedTotal')}:{' '}
            <span className="font-semibold text-ink">{formatCurrency(estimatedTotal)}</span>
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={editItems.isPending}
              className="h-11 px-5 rounded-xl text-sm font-semibold border-2 border-border text-gray hover:bg-surface-linen disabled:opacity-50"
            >
              {t('orders.editOrder.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={editItems.isPending || wouldBeEmpty || operations.length === 0}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl text-sm font-semibold bg-brand text-white hover:bg-brand-mid disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {editItems.isPending && <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />}
              {t('orders.editOrder.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Product picker (search → variant sub-list) ─────────
// The store's own product list projection doesn't include variant names
// (only id/price/stock — see partner/products.ts's list select), so a
// multi-variant product needs a second fetch (usePartnerProduct) to show
// variant options. usePartnerProducts is already store-scoped server-side,
// so this can only ever surface this store's own catalogue.
//
// PRICES WITH IVA (2026-11-05). The shop's catalogue holds its prices without
// IVA, as the shop types them; an order line is what the customer pays, with
// IVA. A picked product used to come in at its base, so a swapped-in line read
// 14,00 for one the server then saved at 15,40, and the estimated total was
// short. It is now priced as the server prices it — base plus its band — from
// the band the list and the detail carry. A list from an older API has no band
// and falls back to the base, as before.
const bandOf = (product: unknown) =>
  effectiveVatCategory(product as { vat_category?: VatCategory | null; vat_category_reviewed?: boolean | null });
const withVat = (base: number | string, product: unknown) => priceWithVat(base, bandOf(product));

function ProductPicker({
  onPick, onClose,
}: {
  onPick: (v: PickedVariant) => void;
  onClose: () => void;
}) {
  const t = usePartnerT();
  const [q, setQ] = useState('');
  const [productId, setProductId] = useState<string | null>(null);

  const { data, isLoading } = usePartnerProducts({ q: q || undefined, page: 1, limit: 20 });
  const { data: detail, isLoading: detailLoading } = usePartnerProduct(productId ?? undefined);
  const products = data?.items ?? [];

  if (productId) {
    const variants = detail?.variants ?? [];
    return (
      <div className="rounded-lg border border-border bg-white p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-ink truncate">{detail?.name_es ?? '…'}</p>
          <button type="button" onClick={() => setProductId(null)} className="text-xs text-muted hover:underline shrink-0">
            {t('orders.editOrder.back')}
          </button>
        </div>
        {detailLoading ? (
          <div className="flex items-center justify-center py-4 text-muted">
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
          </div>
        ) : variants.length === 0 ? (
          <p className="text-xs text-muted py-1">{t('orders.editOrder.noVariants')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {variants.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  disabled={v.stock_quantity <= 0}
                  // The product's name with the size: a line read only "500 g".
                  onClick={() => onPick({ id: v.id, name: `${detail?.name_es ?? ''} · ${v.name_es}`, price: withVat(v.price, detail), vatCategory: bandOf(detail) })}
                  className="w-full flex items-center justify-between gap-2 py-2 px-2 text-left hover:bg-surface-cream disabled:opacity-40 disabled:cursor-not-allowed rounded"
                >
                  <span className="text-sm text-ink truncate">{v.name_es}</span>
                  <span className="text-xs text-gray shrink-0 whitespace-nowrap">
                    {formatCurrency(withVat(v.price, detail))} · {t('orders.editOrder.stock')}: {v.stock_quantity}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-white p-3">
      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" strokeWidth={1.75} />
        <input
          autoFocus
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('orders.editOrder.searchPlaceholder')}
          className="w-full bg-surface-cream border border-border rounded-lg h-9 pl-8 pr-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-4 text-muted">
          <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
        </div>
      ) : products.length === 0 ? (
        <p className="text-xs text-muted py-2">{t('orders.editOrder.noResults')}</p>
      ) : (
        <ul className="max-h-56 overflow-y-auto divide-y divide-border">
          {products.map((p) => {
            const variants = p.variants ?? [];
            const firstPrice = variants[0]?.price;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (variants.length === 1) onPick({ id: variants[0].id, name: p.name_es, price: withVat(variants[0].price, p), vatCategory: bandOf(p) });
                    else setProductId(p.id);
                  }}
                  className="w-full flex items-center gap-3 py-2 px-2 text-left hover:bg-surface-cream rounded"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink truncate">{p.name_es}</p>
                    {p.brand && <p className="text-xs text-muted truncate">{p.brand}</p>}
                  </div>
                  {firstPrice != null && (
                    <span className="text-xs text-gray shrink-0 whitespace-nowrap">{formatCurrency(withVat(firstPrice, p))}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" onClick={onClose} className="mt-2 text-xs text-muted hover:underline">
        {t('orders.editOrder.cancel')}
      </button>
    </div>
  );
}
