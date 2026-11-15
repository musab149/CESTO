import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Package, Plus, Minus, Trash2, X, Save, Loader2, AlertTriangle, Undo2,
} from 'lucide-react';
import {
  useEditMyOrderItems, resolveImageUrl, lineVatCategory, effectiveVatCategory, recargoOnCents, VAT_RATES,
  type Product, type ProductVariant, type CustomerOrderEditOperation, type VatCategory,
} from '@grocery-app/shared';
import AddOrderItemModal from './AddOrderItemModal';
import QuantityField from './QuantityField';
import OrderProgressPanel from './OrderProgressPanel';
import {
  MAX_LINE_QUANTITY, newProgressKey,
  editBasketKey, editBaselineOf, readBasket, writeBasket, clearBasket, sweepBaskets,
} from '@grocery-app/shared';

/**
 * Customer-side order editing, while the order is still in the shop's hands.
 *
 * ONE BATCHED SAVE, not a request per tap. The server applies the whole set
 * in a transaction and refuses all of it if any line is short of stock, so a
 * partial apply is not a state that can exist. Mutating per tap would give up
 * that guarantee and race the stock check on every press.
 *
 * So changes live here as a local draft until "Save". Everything shown is
 * derived from that draft, including the running total, which is computed
 * from the same unit prices the server will use — but it is a PREVIEW. The
 * server re-prices from the catalogue and its answer wins; nothing here is
 * ever sent as a price.
 */

type Item = {
  id: string;
  quantity: number;
  unit_price: string | number;
  line_total: string | number;
  variant_id?: string;
  /** The rate the line was charged with; `product` is the fallback for an older line. */
  tax_rate_pct?: number | null;
  product?: { vat_category?: VatCategory | null; vat_category_reviewed?: boolean | null } | null;
  product_snapshot: {
    name_es?: string; name_en?: string;
    variant_name_es?: string; variant_name_en?: string;
    image_url?: string | null;
  };
};

/** A line the customer added in this editing session, not yet saved. */
type PendingAdd = {
  key: string;
  variantId: string;
  quantity: number;
  name_es: string;
  name_en: string;
  variantName_es: string;
  variantName_en: string;
  unitPrice: number;
  imageUrl: string | null;
  stock: number;
  /** Absent on a line kept in the browser before this existed: counted as 0 %. */
  vatCategory?: VatCategory;
};

/**
 * A row as kept in this browser between reloads: an existing line (its id as
 * the key, its quantity, whether it was taken out) or one being added.
 */
type KeptLine = { key: string; variantId: string; quantity: number; removed?: boolean } | PendingAdd;

interface Props {
  orderId: string;
  /** The customer: whose browser-kept changes these are. */
  userId: string;
  storeId: string | null;
  /** Drives the "already being packed" warning. */
  status: string;
  items: Item[];
  deliveryFee: number;
  /** This order is charged recargo de equivalencia itself (not a part of a purchase). */
  recargoOn?: boolean;
  lang: 'es' | 'en';
  onClose: () => void;
  onSaved: () => void;
}

const num = (v: string | number | null | undefined) => (v == null ? 0 : Number(v));

export default function OrderItemsEditor({
  orderId, userId, storeId, status, items, deliveryFee, recargoOn, lang, onClose, onSaved,
}: Props) {
  const t = (es: string, en: string) => (lang === 'en' ? en : es);
  const edit = useEditMyOrderItems();

  // Draft state. Existing lines are keyed by OrderItem id; a quantity of the
  // original value means "untouched" and produces no operation.
  const [qty, setQty] = useState<Record<string, number>>(
    () => Object.fromEntries(items.map((i) => [i.id, i.quantity])),
  );
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [adds, setAdds] = useState<PendingAdd[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** Names this save so the progress panel can follow it on the server. */
  const [progressKey, setProgressKey] = useState<string | null>(null);
  const [shortfalls, setShortfalls] = useState<{ productName: string; needed: number; available: number }[]>([]);

  const original = useMemo(
    () => Object.fromEntries(items.map((i) => [i.id, i])),
    [items],
  );

  const operations = useMemo<CustomerOrderEditOperation[]>(() => {
    const ops: CustomerOrderEditOperation[] = [];
    for (const item of items) {
      if (removed.has(item.id)) {
        ops.push({ action: 'remove', order_item_id: item.id });
        continue;
      }
      const next = qty[item.id];
      if (next != null && next !== item.quantity) {
        ops.push({ action: 'update_qty', order_item_id: item.id, new_quantity: next });
      }
    }
    for (const a of adds) {
      ops.push({ action: 'add', new_variant_id: a.variantId, new_quantity: a.quantity });
    }
    return ops;
  }, [items, qty, removed, adds]);

  const remainingCount = items.filter((i) => !removed.has(i.id)).length + adds.length;
  /**
   * Every line taken off a draft. Saving it so cancels the draft — the server
   * does it — so the screen says that first and offers the other way out.
   * A placed order cannot be emptied: cancelling it is its own button.
   */
  const emptiesDraft = status === 'draft' && remainingCount === 0;
  const dirty = operations.length > 0;

  /**
   * UNSAVED CHANGES SURVIVE A RELOAD (2026-11-04, packages/shared
   * savedBasket.ts): kept in this browser per customer and order, put back
   * only while the order is still the one they were made against, dropped
   * once saved or when the editor is closed. The order page reopens this
   * editor when there are some to put back. Save first, restore second: on
   * the first pass the save sees nothing restored yet and stays out of the way.
   */
  const savedKey = editBasketKey('shop', userId, orderId);
  const [editBaseline] = useState(() => editBaselineOf(items.map((i) => ({
    orderItemId: i.id, variantId: i.variant_id ?? '', quantity: i.quantity, unitPrice: Number(i.unit_price),
  }))));
  const restoredRef = useRef(false);
  /** Saved or discarded: nothing writes the changes back on the way out. */
  const doneRef = useRef(false);
  useEffect(() => {
    if (!restoredRef.current || doneRef.current) return;
    if (!dirty) { clearBasket(savedKey); return; }
    const kept: KeptLine[] = [
      ...items.map((i) => ({
        key: i.id, variantId: i.variant_id ?? '', quantity: qty[i.id] ?? i.quantity, removed: removed.has(i.id),
      })),
      ...adds,
    ];
    writeBasket<KeptLine>(savedKey, {
      lines: kept, addressId: '', feeInput: null, notes: '', hgSlot: null, attemptKey: null, baseline: editBaseline,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty, removed, adds, dirty]);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    sweepBaskets('shop');
    const saved = readBasket<KeptLine>(savedKey);
    if (!saved) return;
    if (saved.baseline !== editBaseline) {
      clearBasket(savedKey);
      setErrorMsg(t(
        'Tus cambios sin guardar no se han conservado: el pedido ha cambiado desde que lo dejaste.',
        'Your unsaved changes were not kept: this order changed after you left it.',
      ));
      return;
    }
    const mine = new Set(items.map((i) => i.id));
    const nextQty: Record<string, number> = Object.fromEntries(items.map((i) => [i.id, i.quantity]));
    const nextRemoved = new Set<string>();
    const nextAdds: PendingAdd[] = [];
    for (const l of saved.lines) {
      if (mine.has(l.key)) {
        nextQty[l.key] = l.quantity;
        if ('removed' in l && l.removed) nextRemoved.add(l.key);
      } else if ('name_es' in l) {
        nextAdds.push(l);
      }
    }
    setQty(nextQty);
    setRemoved(nextRemoved);
    setAdds(nextAdds);
    // Once, when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Closing the editor drops the changes, so it drops the kept copy too. */
  const discard = () => {
    doneRef.current = true;
    clearBasket(savedKey);
    onClose();
  };

  // Preview only — the server recomputes from the catalogue.
  const newSubtotal = useMemo(() => {
    let s = 0;
    for (const item of items) {
      if (removed.has(item.id)) continue;
      s += num(item.unit_price) * (qty[item.id] ?? item.quantity);
    }
    for (const a of adds) s += a.unitPrice * a.quantity;
    return s;
  }, [items, qty, removed, adds]);

  const oldSubtotal = useMemo(
    () => items.reduce((s, i) => s + num(i.line_total), 0),
    [items],
  );

  // Preview too: the server's rule (shared recargoOnCents) on what is on screen.
  const recargo = useMemo(() => {
    if (!recargoOn) return 0;
    const lines = [
      ...items.filter((i) => !removed.has(i.id)).map((i) => ({
        grossCents: Math.round(num(i.unit_price) * (qty[i.id] ?? i.quantity) * 100),
        rate_pct: VAT_RATES[lineVatCategory(i)],
      })),
      ...adds.map((a) => ({
        grossCents: Math.round(a.unitPrice * a.quantity * 100),
        rate_pct: VAT_RATES[a.vatCategory ?? 'zero'],
      })),
    ];
    return recargoOnCents(lines, Math.round(deliveryFee * 100)) / 100;
  }, [recargoOn, items, removed, qty, adds, deliveryFee]);

  const existingVariantIds = useMemo(() => {
    const ids = new Set<string>();
    for (const i of items) if (!removed.has(i.id) && i.variant_id) ids.add(i.variant_id);
    for (const a of adds) ids.add(a.variantId);
    return ids;
  }, [items, removed, adds]);

  function pick(product: Product, variant: ProductVariant) {
    setAdds((prev) => [...prev, {
      key: `${variant.id}-${Date.now()}`,
      variantId: variant.id,
      quantity: 1,
      name_es: product.name_es,
      name_en: product.name_en,
      variantName_es: variant.name_es,
      variantName_en: variant.name_en,
      unitPrice: Number(variant.price),
      imageUrl: product.images?.[0]?.url ?? null,
      stock: variant.stock_quantity,
      vatCategory: effectiveVatCategory(product),
    }]);
    setPickerOpen(false);
  }

  function save() {
    setErrorMsg(null);
    setShortfalls([]);
    const key = newProgressKey();
    setProgressKey(key);
    edit.mutate({ id: orderId, operations, progressKey: key }, {
      onSuccess: () => {
        doneRef.current = true;
        clearBasket(savedKey);
        onSaved();
      },
      onError: (err: unknown) => {
        const e = err as { message?: string; data?: { shortfalls?: typeof shortfalls } };
        setShortfalls(e?.data?.shortfalls ?? []);
        setErrorMsg(
          e?.message
          ?? t('No se pudieron guardar los cambios.', 'Your changes could not be saved.'),
        );
      },
    });
  }

  return (
    <div className="bg-surface-white border-2 border-brand/30 rounded-lg overflow-hidden">
      <div className="px-6 pt-5 pb-4 border-b border-border/60">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold text-ink font-display">
              {t('Editar tu pedido', 'Edit your order')}
            </h3>
            <p className="text-xs text-muted font-body mt-0.5">
              {t(
                'Nada cambia hasta que guardes.',
                'Nothing changes until you save.',
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={discard}
            aria-label={t('Cerrar', 'Close')}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:bg-surface-linen hover:text-ink transition-colors shrink-0"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        {/* The order is already being picked. This is the one case where the
            customer needs to know their change might land too late — the
            shop may already have bagged the thing they just removed. */}
        {status === 'preparing' && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-warning-bg/60 border border-warning/30 px-3 py-2.5">
            <AlertTriangle size={15} strokeWidth={2} className="text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-ink font-body leading-relaxed">
              {t(
                'Ya estamos preparando este pedido. Puedes cambiarlo, pero avísanos si es urgente: puede que ya esté empaquetado.',
                'We’re already packing this order. You can still change it, but tell us if it’s urgent — it may already be bagged.',
              )}
            </p>
          </div>
        )}
      </div>

      {/* Lines */}
      <div className="divide-y divide-border/60">
        {items.map((item) => {
          const gone = removed.has(item.id);
          const name = lang === 'en' ? item.product_snapshot.name_en : item.product_snapshot.name_es;
          const varName = lang === 'en'
            ? item.product_snapshot.variant_name_en
            : item.product_snapshot.variant_name_es;
          const q = qty[item.id] ?? item.quantity;
          const changed = !gone && q !== original[item.id]?.quantity;

          return (
            <div
              key={item.id}
              className={`flex items-center gap-3 sm:gap-4 py-4 px-4 sm:px-6 transition-colors ${gone ? 'bg-surface-linen/60' : ''}`}
            >
              <div className={`photo-well w-14 h-14 rounded-xl bg-surface-linen overflow-hidden shrink-0 border border-border/40 flex items-center justify-center ${gone ? 'opacity-40' : ''}`}>
                {item.product_snapshot.image_url ? (
                  <img
                    src={resolveImageUrl(item.product_snapshot.image_url, 'thumb')}
                    alt={name ?? ''}
                    className="object-cover w-full h-full"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <Package size={18} strokeWidth={1.5} className="text-muted" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <h4 className={`text-sm font-semibold font-display line-clamp-1 ${gone ? 'text-muted line-through' : 'text-ink'}`}>
                  {name}
                </h4>
                <p className="text-xs text-muted font-body">{varName}</p>
                <p className="text-xs text-muted font-body mt-0.5">
                  €{num(item.unit_price).toFixed(2)} {t('cada uno', 'each')}
                </p>
              </div>

              {gone ? (
                <button
                  type="button"
                  onClick={() => setRemoved((prev) => {
                    const n = new Set(prev); n.delete(item.id); return n;
                  })}
                  className="shrink-0 h-9 px-3 rounded-xl text-xs font-bold font-display inline-flex items-center gap-1.5 border border-border text-ink bg-surface-white hover:bg-surface-linen transition-colors"
                >
                  <Undo2 size={14} strokeWidth={2} />
                  {t('Deshacer', 'Undo')}
                </button>
              ) : (
                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                  <div className="flex items-center rounded-xl border border-border bg-surface-white overflow-hidden">
                    <button
                      type="button"
                      aria-label={t('Quitar uno', 'Decrease')}
                      onClick={() => setQty((p) => ({ ...p, [item.id]: Math.max(1, q - 1) }))}
                      disabled={q <= 1}
                      className="w-9 h-9 flex items-center justify-center text-ink hover:bg-surface-linen disabled:text-muted disabled:hover:bg-transparent transition-colors"
                    >
                      <Minus size={14} strokeWidth={2.25} />
                    </button>
                    {/* Up to the line ceiling; whether the stock is there is
                        the server's call when the change is saved. */}
                    <QuantityField
                      value={q}
                      max={MAX_LINE_QUANTITY}
                      onChange={(n) => setQty((p) => ({ ...p, [item.id]: n }))}
                      label={t('Cantidad', 'Quantity')}
                      className={`min-w-8 text-sm font-bold font-display ${changed ? 'text-brand' : 'text-ink'}`}
                    />
                    <button
                      type="button"
                      aria-label={t('Añadir uno', 'Increase')}
                      onClick={() => setQty((p) => ({ ...p, [item.id]: Math.min(MAX_LINE_QUANTITY, q + 1) }))}
                      disabled={q >= MAX_LINE_QUANTITY}
                      className="w-9 h-9 flex items-center justify-center text-ink hover:bg-surface-linen disabled:text-muted disabled:hover:bg-transparent transition-colors"
                    >
                      <Plus size={14} strokeWidth={2.25} />
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label={t('Eliminar', 'Remove')}
                    onClick={() => setRemoved((prev) => new Set(prev).add(item.id))}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-danger/70 hover:text-danger hover:bg-danger-bg/40 transition-colors"
                  >
                    <Trash2 size={16} strokeWidth={1.75} />
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Pending additions */}
        {adds.map((a) => (
          <div key={a.key} className="flex items-center gap-3 sm:gap-4 py-4 px-4 sm:px-6 bg-brand-mist/40">
            <div className="photo-well w-14 h-14 rounded-xl bg-surface-linen overflow-hidden shrink-0 border border-border/40 flex items-center justify-center">
              {a.imageUrl ? (
                <img
                  src={resolveImageUrl(a.imageUrl, 'thumb')}
                  alt={lang === 'en' ? a.name_en : a.name_es}
                  className="object-cover w-full h-full"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <Package size={18} strokeWidth={1.5} className="text-muted" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wide text-brand font-display bg-brand/10 rounded px-1.5 py-0.5">
                  {t('Nuevo', 'New')}
                </span>
              </div>
              <h4 className="text-sm font-semibold text-ink font-display line-clamp-1 mt-0.5">
                {lang === 'en' ? a.name_en : a.name_es}
              </h4>
              <p className="text-xs text-muted font-body">
                {lang === 'en' ? a.variantName_en : a.variantName_es} · €{a.unitPrice.toFixed(2)} {t('cada uno', 'each')}
              </p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <div className="flex items-center rounded-xl border border-border bg-surface-white overflow-hidden">
                <button
                  type="button"
                  aria-label={t('Quitar uno', 'Decrease')}
                  onClick={() => setAdds((prev) => prev.map((x) => (
                    x.key === a.key ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x
                  )))}
                  disabled={a.quantity <= 1}
                  className="w-9 h-9 flex items-center justify-center text-ink hover:bg-surface-linen disabled:text-muted disabled:hover:bg-transparent transition-colors"
                >
                  <Minus size={14} strokeWidth={2.25} />
                </button>
                <QuantityField
                  value={a.quantity}
                  max={Math.max(1, a.stock)}
                  onChange={(n) => setAdds((prev) => prev.map((x) => (x.key === a.key ? { ...x, quantity: n } : x)))}
                  label={t('Cantidad', 'Quantity')}
                  className="min-w-8 text-sm font-bold text-brand font-display"
                />
                <button
                  type="button"
                  aria-label={t('Añadir uno', 'Increase')}
                  onClick={() => setAdds((prev) => prev.map((x) => (
                    x.key === a.key ? { ...x, quantity: Math.min(Math.max(1, x.stock), MAX_LINE_QUANTITY, x.quantity + 1) } : x
                  )))}
                  disabled={a.quantity >= Math.max(1, a.stock)}
                  className="w-9 h-9 flex items-center justify-center text-ink hover:bg-surface-linen disabled:text-muted disabled:hover:bg-transparent transition-colors"
                >
                  <Plus size={14} strokeWidth={2.25} />
                </button>
              </div>
              <button
                type="button"
                aria-label={t('Eliminar', 'Remove')}
                onClick={() => setAdds((prev) => prev.filter((x) => x.key !== a.key))}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-danger/70 hover:text-danger hover:bg-danger-bg/40 transition-colors"
              >
                <Trash2 size={16} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add products */}
      <div className="px-4 sm:px-6 py-4 border-t border-border/60">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="w-full h-11 rounded-xl border-2 border-dashed border-brand/40 text-brand text-sm font-bold font-display inline-flex items-center justify-center gap-2 hover:bg-brand-mist/50 transition-colors"
        >
          <Plus size={16} strokeWidth={2.25} />
          {t('Añadir productos', 'Add products')}
        </button>
      </div>

      {/* Errors */}
      {errorMsg && (
        <div className="mx-4 sm:mx-6 mb-4 rounded-xl bg-danger-bg/60 border border-danger/30 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} strokeWidth={2} className="text-danger shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-danger font-display">{errorMsg}</p>
              {shortfalls.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {shortfalls.map((s) => (
                    <li key={s.productName} className="text-xs text-ink font-body">
                      {s.productName} — {t('quedan', 'only')} {s.available} {t('disponibles', 'left')}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted font-body mt-1.5">
                {t(
                  'Tu pedido no ha cambiado. Ajusta las cantidades y vuelve a intentarlo.',
                  'Your order is unchanged. Adjust the quantities and try again.',
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Totals + actions */}
      <div className="bg-surface-linen/70 border-t border-border/60 px-4 sm:px-6 py-4">
        <div className="flex items-center justify-between text-sm font-body mb-1">
          <span className="text-gray">{t('Subtotal', 'Subtotal')}</span>
          <span className="font-display font-semibold">
            {dirty ? (
              <>
                <span className="text-muted line-through mr-2">€{oldSubtotal.toFixed(2)}</span>
                <span className="text-ink">€{newSubtotal.toFixed(2)}</span>
              </>
            ) : (
              <span className="text-ink">€{oldSubtotal.toFixed(2)}</span>
            )}
          </span>
        </div>
        {/* The fee does not move with the basket — it is distance-based, and
            on a rep-built order it was set by hand. Shown so the estimated
            total below is not a mystery. */}
        <div className="flex items-center justify-between text-sm font-body mb-2">
          <span className="text-gray">{t('Entrega', 'Delivery')}</span>
          <span className="text-ink font-display font-semibold">€{deliveryFee.toFixed(2)}</span>
        </div>
        {recargo > 0 && (
          <div className="flex items-center justify-between text-sm font-body mb-2">
            <span className="text-gray">{t('Recargo de equivalencia', 'Equivalence surcharge (recargo)')}</span>
            <span className="text-ink font-display font-semibold">€{recargo.toFixed(2)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-base font-display font-extrabold text-ink pt-2 border-t border-border/60">
          <span>{t('Total', 'Total')}</span>
          <span>€{(newSubtotal + deliveryFee + recargo).toFixed(2)}</span>
        </div>
        <p className="text-[11px] text-muted font-body mt-1.5">
          {t(
            'Importe estimado. Lo confirmamos al guardar.',
            'Estimated. We confirm it when you save.',
          )}
        </p>

        {/* A big order's save can take a while: say what is happening. */}
        {edit.isPending && (
          <OrderProgressPanel
            key={progressKey ?? 'edit'}
            kind="edit"
            phase="server"
            progressKey={progressKey}
            lang={lang}
            detail={{ lines: operations.length }}
          />
        )}

        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || (remainingCount === 0 && !emptiesDraft) || edit.isPending}
            className={`flex-1 min-h-[52px] rounded-xl text-white text-sm font-bold font-display inline-flex items-center justify-center gap-2 active:scale-[0.99] transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none ${
              emptiesDraft ? 'bg-danger hover:bg-danger/90' : 'bg-brand hover:bg-brand-mid'}`}
          >
            {edit.isPending ? (
              <><Loader2 size={16} className="animate-spin" />{t('Guardando…', 'Saving…')}</>
            ) : emptiesDraft ? (
              <><Trash2 size={16} strokeWidth={2} />{t('Cancelar borrador', 'Cancel draft')}</>
            ) : (
              <><Save size={16} strokeWidth={2} />{t('Guardar cambios', 'Save changes')}</>
            )}
          </button>
          <button
            type="button"
            onClick={discard}
            disabled={edit.isPending}
            className="sm:w-auto min-h-[52px] px-5 rounded-xl border border-border text-ink text-sm font-semibold font-display bg-surface-white hover:bg-surface-linen transition-colors disabled:opacity-50"
          >
            {t('Descartar', 'Discard')}
          </button>
        </div>

        {/* An order with nothing in it is a cancellation, and cancelling has
            its own button, its own confirmation and its own reason field.
            Saying so is better than a disabled button with no explanation. */}
        {emptiesDraft ? (
          <div className="mt-3 rounded-xl bg-warning-bg border border-warning/30 px-4 py-3" role="status">
            <p className="text-sm font-bold text-ink font-display">
              {t('Este borrador se ha quedado sin artículos', 'This draft has no items left')}
            </p>
            <p className="text-xs text-ink/80 font-body mt-0.5">
              {t(
                'Añade productos para mantenerlo o cancela el borrador. Si lo guardas vacío, se cancela.',
                'Add products to keep it, or cancel the draft. Saving it empty cancels it.',
              )}
            </p>
          </div>
        ) : remainingCount === 0 && (
          <p className="text-xs text-danger font-body mt-2.5 text-center">
            {t(
              'Un pedido no puede quedarse vacío. Si no quieres nada, cancela el pedido.',
              'An order can’t be empty. If you don’t want any of it, cancel the order instead.',
            )}
          </p>
        )}
      </div>

      {pickerOpen && (
        <AddOrderItemModal
          storeId={storeId}
          lang={lang}
          existingVariantIds={existingVariantIds}
          onPick={pick}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
