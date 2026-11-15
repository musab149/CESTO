import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CalendarDays, Check, ChevronRight, Loader2, MapPin, Maximize2, Minus, Package, Plus,
  ShoppingCart, Trash2, Truck, X,
} from 'lucide-react';
import {
  useOrder, useEditMyOrderItems, resolveImageUrl, lockingInvoiceOf, deliveryFeeIsPending, newProgressKey,
  computeTaxBreakdown, previewLineTotal, VAT_RATES, MAX_LINE_QUANTITY, MAX_ORDER_LINES, HOME_GROCERY_PLAN_KEY,
  unitDiscountText, lineVatCategory, customerCanEditOrder, recargoOnCents,
  editBasketKey, editBaselineOf, nextNewKey, readBasket, writeBasket, clearBasket, sweepBaskets,
  type CustomerOrderEditOperation, type IssuedInvoiceRef, type Order, type VatCategory,
} from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useFloatingActionsStore } from '@/stores/floatingActionsStore';
import { useToast } from '@/components/Toast';
import QuantityField from '@/components/QuantityField';
import OrderProgressPanel from '@/components/OrderProgressPanel';
import CatalogPanel, { type CatalogPick } from '@/components/order-edit/CatalogPanel';
import ChangeSlotDialog from '@/components/home-grocery/plan/ChangeSlotDialog';
import { StatusChip } from '@/components/home-grocery/plan/PlanHistory';
import { PLAN_COPY, planDate, windowLine } from '@/components/home-grocery/planCopy';
import { formatCurrency } from '@/sales/lib/format';

/* ═══════════════════════════════════════════════════════
   /orders/:orderId/edit — a household changing a Home Grocery order on the
   screen staff and reps use to change one (2026-10-23, user request).

   PORTED from the rep's order screen (sales/SalesNewOrderPage.tsx, itself
   admin's OrderCreatePage): the order on the left — which order it is, its
   lines as a numbered table with steppers, the totals with IVA — and the
   whole catalogue on the right, a drawer below xl. What a customer may not
   do is simply absent: no discounts, no delivery fee to type, no address to
   swap, no "not in the catalogue" product, no draft.

   ONE BATCHED SAVE, as the order page's inline editor does: the server
   applies the set in one transaction, re-prices from the catalogue and
   refuses all of it if a line is short. Everything shown before that is a
   preview.
   ═══════════════════════════════════════════════════════ */

/** A Home Grocery order's slot moves while nobody has started on it. */
const SLOT_MOVABLE = ['draft', 'pending', 'confirmed'];

interface Line {
  /** The order line's id, or `new:n` for one added here. */
  key: string;
  /** Set only on lines the order already had — its absence makes an `add`. */
  orderItemId?: string;
  variantId: string;
  name: string;
  variantName: string;
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
  vatCategory: VatCategory;
  /**
   * A discount already on the line, kept so the preview matches. Not editable
   * here. Euros off one unit (`unitDiscount`, 2026-10-25), so it follows the
   * quantity as the server does; a line discounted before then carries its
   * flat figure (`discount`) until its quantity changes, when it becomes that
   * figure per unit (`unitDiscountOnChange`) — again as the server reads it.
   */
  discount?: string;
  unitDiscount?: string;
  unitDiscountOnChange?: string;
}

/**
 * A line at a new quantity. An older line's flat discount becomes per unit
 * once its quantity moves — through the stepper, a typed figure, or adding
 * the same product from the catalogue.
 */
const withQuantity = (l: Line, quantity: number): Line => ({
  ...l,
  quantity: Math.min(MAX_LINE_QUANTITY, Math.max(1, quantity)),
  ...(l.unitDiscountOnChange ? { unitDiscount: l.unitDiscountOnChange, discount: undefined, unitDiscountOnChange: undefined } : {}),
});

interface Shortfall { productName: string; needed: number; available: number }

type OrderRow = {
  id: string; variant_id: string; quantity: number; unit_price: number | string;
  discount_amount?: number | string | null; unit_discount?: number | string | null; vat_category?: VatCategory | null;
  /** The IVA rate the line was charged with; null on lines from before 2026-11-01. */
  tax_rate_pct?: number | null;
  product?: { vat_category?: VatCategory | null; vat_category_reviewed?: boolean | null } | null;
  product_snapshot?: { name_es?: string; name_en?: string; variant_name_es?: string; variant_name_en?: string; image_url?: string | null } | null;
};

function seedLines(order: Order, lang: 'es' | 'en'): Line[] {
  return ((order.items ?? []) as unknown as OrderRow[]).map((it) => ({
    key: it.id,
    orderItemId: it.id,
    variantId: it.variant_id,
    name: (lang === 'en' ? it.product_snapshot?.name_en : it.product_snapshot?.name_es) ?? it.product_snapshot?.name_es ?? '',
    variantName: (lang === 'en' ? it.product_snapshot?.variant_name_en : it.product_snapshot?.variant_name_es) ?? '',
    unitPrice: Number(it.unit_price),
    quantity: it.quantity,
    imageUrl: it.product_snapshot?.image_url ?? null,
    vatCategory: lineVatCategory(it),
    ...(Number(it.unit_discount ?? 0) > 0
      ? { unitDiscount: unitDiscountText(it) }
      : Number(it.discount_amount ?? 0) > 0
        ? { discount: String(Number(it.discount_amount)), unitDiscountOnChange: unitDiscountText(it) }
        : {}),
  }));
}

/**
 * Waits for a FRESH read of the order, then mounts the editor keyed on it.
 * The editor's starting point is read once (a useState initialiser); a cached
 * copy from the order page would make "unchanged" mean an older order.
 */
export default function OrderEditPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { lang } = useLanguageStore();
  const q = useOrder(orderId);
  const L = (es: string, en: string) => (lang === 'en' ? en : es);

  if (!q.data || !q.isFetchedAfterMount) {
    if (q.isError && !q.data) {
      return (
        <Frame lang={lang} orderId={orderId}>
          <div className="rounded-lg bg-card border border-border p-10 text-center max-w-xl mx-auto">
            <AlertTriangle size={28} strokeWidth={1.5} className="mx-auto text-muted" />
            <p className="mt-3 text-[15px] text-ink font-body">{L('No hemos podido cargar el pedido.', "We couldn't load the order.")}</p>
            <button type="button" onClick={() => q.refetch()}
              className="mt-4 min-h-[52px] px-6 rounded-xl bg-brand text-white text-[15px] font-bold font-display hover:bg-brand-mid">
              {L('Reintentar', 'Try again')}
            </button>
          </div>
        </Frame>
      );
    }
    return (
      <Frame lang={lang} orderId={orderId}>
        <div className="xl:flex xl:gap-6">
          <div className="space-y-3 xl:w-[560px] 2xl:w-[620px] xl:shrink-0">
            <div className="skeleton h-[132px] !rounded-xl" />
            <div className="skeleton h-[340px] !rounded-xl" />
            <div className="skeleton h-[200px] !rounded-xl" />
          </div>
          <div className="hidden xl:block flex-1 skeleton h-[640px] !rounded-xl" />
        </div>
      </Frame>
    );
  }

  const order = q.data;
  const lockedBy = lockingInvoiceOf(order as { invoices?: IssuedInvoiceRef[] | null });
  // The customer edit rule (packages/shared orderEditing.ts): in the shop's
  // hands, or a draft they made themselves.
  if (!customerCanEditOrder(order) || lockedBy) {
    return (
      <Frame lang={lang} orderId={orderId} orderNumber={order.order_number}>
        <div className="rounded-lg bg-surface-cream shadow-card border border-border/40 p-10 text-center max-w-xl mx-auto">
          <Package size={30} strokeWidth={1.5} className="mx-auto text-muted" />
          <h1 className="mt-3 text-[20px] font-bold text-ink font-display">{L('Este pedido ya no se puede cambiar', 'This order can no longer be changed')}</h1>
          <p className="mt-2 text-[14px] text-gray font-body">
            {lockedBy
              ? L('Ya se ha emitido su factura. Contacta con nosotros si necesitas cambiar algo.', 'Its invoice has been issued. Get in touch if something needs changing.')
              : L('Ya va de camino o se ha cerrado.', "It's on its way or closed.")}
          </p>
          <Link to={`/orders/${order.id}`}
            className="mt-6 inline-flex min-h-[52px] px-7 rounded-xl bg-brand text-white text-[15px] font-bold font-display items-center hover:bg-brand-mid">
            {L('Ver el pedido', 'View order')}
          </Link>
        </div>
      </Frame>
    );
  }

  return <Editor key={order.id} order={order} lang={lang} />;
}

function Frame({ lang, orderId, orderNumber, children }: {
  lang: 'es' | 'en'; orderId?: string; orderNumber?: string; children: React.ReactNode;
}) {
  const L = (es: string, en: string) => (lang === 'en' ? en : es);
  return (
    <div className="bg-surface-linen min-h-screen pb-40 xl:pb-12">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-10 py-6">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm font-body text-muted mb-4 min-w-0">
          <Link to="/" className="hover:text-brand transition-colors shrink-0">{L('Inicio', 'Home')}</Link>
          <ChevronRight size={14} className="shrink-0" />
          <Link to="/orders" className="hover:text-brand transition-colors shrink-0">{L('Mis pedidos', 'My orders')}</Link>
          <ChevronRight size={14} className="shrink-0" />
          {orderId && (
            <>
              <Link to={`/orders/${orderId}`} className="hover:text-brand transition-colors font-mono truncate">{orderNumber ?? '…'}</Link>
              <ChevronRight size={14} className="shrink-0" />
            </>
          )}
          <span className="text-ink font-semibold shrink-0">{L('Editar', 'Edit')}</span>
        </nav>
        {children}
      </div>
    </div>
  );
}

/** One line of the order, stacked — phones, and the enlarged list. */
function LineRow({ l, index, lang, onSet, onRemove }: {
  l: Line; index: number; lang: 'es' | 'en'; onSet: (n: number) => void; onRemove: () => void;
}) {
  const L = (es: string, en: string) => (lang === 'en' ? en : es);
  return (
    <li className="flex gap-3 py-3">
      <span className="w-5 shrink-0 pt-0.5 text-xs font-semibold text-muted tabular-nums">{index + 1}</span>
      <Thumb url={l.imageUrl} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink leading-snug line-clamp-2">
          {l.name}{l.variantName && <span className="text-muted"> · {l.variantName}</span>}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <Stepper value={l.quantity} onSet={onSet} lang={lang} />
          <span className="text-[11px] text-muted tabular-nums truncate">{'× '}{formatCurrency(l.unitPrice)}</span>
        </div>
      </div>
      <div className="flex flex-col items-end justify-between shrink-0">
        <LineTotal l={l} />
        <button type="button" onClick={onRemove} aria-label={L('Quitar', 'Remove')}
          className="-mr-1 w-7 h-7 rounded-lg hover:bg-danger-bg flex items-center justify-center text-muted hover:text-danger transition-colors">
          <Trash2 size={14} strokeWidth={1.75} />
        </button>
      </div>
    </li>
  );
}

function Thumb({ url }: { url: string | null }) {
  return (
    <span className="photo-well w-11 h-11 rounded-lg bg-surface-cream border border-border shrink-0 overflow-hidden flex items-center justify-center">
      {url
        ? <img src={resolveImageUrl(url, 'thumb')} alt="" className="w-full h-full object-cover" draggable={false} />
        : <Package size={17} strokeWidth={1.75} className="text-muted" />}
    </span>
  );
}

function Stepper({ value, onSet, lang }: { value: number; onSet: (n: number) => void; lang: 'es' | 'en' }) {
  const L = (es: string, en: string) => (lang === 'en' ? en : es);
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button type="button" onClick={() => onSet(value - 1)} disabled={value <= 1} aria-label={L('Quitar uno', 'Decrease')}
        className="w-7 h-7 rounded-md border border-border bg-card flex items-center justify-center disabled:opacity-40 hover:border-brand transition-colors">
        <Minus size={12} strokeWidth={2.5} />
      </button>
      <QuantityField value={value} max={MAX_LINE_QUANTITY} onChange={onSet} label={L('Cantidad', 'Quantity')}
        className="min-w-6 text-xs font-bold text-ink" />
      <button type="button" onClick={() => onSet(value + 1)} disabled={value >= MAX_LINE_QUANTITY} aria-label={L('Añadir uno', 'Increase')}
        className="w-7 h-7 rounded-md border border-border bg-card flex items-center justify-center disabled:opacity-40 hover:border-brand transition-colors">
        <Plus size={12} strokeWidth={2.5} />
      </button>
    </div>
  );
}

/** Net of a rep's discount, with the price it came off struck through above. */
function LineTotal({ l }: { l: Line }) {
  const gross = l.unitPrice * l.quantity;
  const net = previewLineTotal(l);
  return (
    <span className="text-right leading-snug">
      {net < gross && <span className="block text-[11px] text-muted tabular-nums line-through">{formatCurrency(gross)}</span>}
      <span className="block text-sm font-bold text-ink tabular-nums">{formatCurrency(net)}</span>
    </span>
  );
}

function Editor({ order, lang }: { order: Order; lang: 'es' | 'en' }) {
  const L = (es: string, en: string) => (lang === 'en' ? en : es);
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const edit = useEditMyOrderItems();
  const c = PLAN_COPY[lang];

  const [baseline] = useState<Line[]>(() => seedLines(order, lang));
  const [lines, setLines] = useState<Line[]>(baseline);
  const nextKey = useRef(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandOpen, setExpandOpen] = useState(false);
  const [movingSlot, setMovingSlot] = useState(false);
  const [shortfalls, setShortfalls] = useState<Shortfall[] | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [progressKey, setProgressKey] = useState<string | null>(null);

  // This screen's bottom bar takes the corner the WhatsApp / cart buttons use.
  const hideFloating = useFloatingActionsStore((s) => s.hide);
  useEffect(() => hideFloating(), [hideFloating]);

  const isHomeGrocery = !!order.rashan_subscription_id;
  const canMoveSlot = isHomeGrocery && !!order.scheduled_for && SLOT_MOVABLE.includes(order.status);
  const address = order.address_snapshot as { street_line_1?: string; street_line_2?: string | null; postcode?: string; city?: string } | null;
  const feePending = deliveryFeeIsPending(order);
  const fee = Number(order.delivery_fee ?? 0);

  const quantities = useMemo(
    () => lines.reduce<Record<string, number>>((acc, l) => {
      // Summed: an order can carry one product on two lines.
      acc[l.variantId] = (acc[l.variantId] ?? 0) + l.quantity;
      return acc;
    }, {}),
    [lines],
  );
  const subtotal = useMemo(() => lines.reduce((s, l) => s + previewLineTotal(l), 0), [lines]);
  const taxLines = useMemo(
    () => lines.map((l) => ({ grossCents: Math.round(previewLineTotal(l) * 100), rate_pct: VAT_RATES[l.vatCategory] })),
    [lines],
  );
  const taxBreakdown = useMemo(() => computeTaxBreakdown(taxLines), [taxLines]);
  const shownFee = feePending ? 0 : fee;
  // Recargo de equivalencia, by the server's rule: on the lines and the fee, for
  // an order under the regime. A part of a split purchase carries none (the
  // purchase does).
  const recargo = order.recargo_equivalencia && !order.parent_order_id
    ? recargoOnCents(taxLines, Math.round(shownFee * 100)) / 100
    : 0;
  const total = subtotal + shownFee + recargo;
  // A 0 % line carries no IVA, so it gets no row, as at checkout.
  const vatGroups = taxBreakdown.groups.filter((g) => g.rate_pct > 0);

  /** The edit, as operations: one per changed row, which is what the server accepts. */
  const operations = useMemo<CustomerOrderEditOperation[]>(() => {
    const ops: CustomerOrderEditOperation[] = [];
    const live = new Map(lines.map((l) => [l.key, l]));
    for (const was of baseline) {
      const now = live.get(was.key);
      if (!now) ops.push({ action: 'remove', order_item_id: was.orderItemId! });
      else if (now.quantity !== was.quantity) ops.push({ action: 'update_qty', order_item_id: was.orderItemId!, new_quantity: now.quantity });
    }
    for (const l of lines) {
      if (!l.orderItemId) ops.push({ action: 'add', new_variant_id: l.variantId, new_quantity: l.quantity });
    }
    return ops;
  }, [lines, baseline]);

  const dirty = operations.length > 0;

  /**
   * UNSAVED CHANGES SURVIVE A RELOAD (2026-11-04, packages/shared
   * savedBasket.ts) — kept in this browser per customer and order, put back
   * only while the order is still the one they were made against, dropped
   * once saved or on Cancel. Save first, restore second: on the first pass
   * the save sees nothing restored yet and stays out of the way.
   */
  const savedKey = editBasketKey('shop', order.user_id, order.id);
  const [editBaseline] = useState(() => editBaselineOf(baseline));
  const restoredRef = useRef(false);
  /** Saved or discarded: nothing writes the changes back on the way out. */
  const doneRef = useRef(false);
  useEffect(() => {
    if (!restoredRef.current || doneRef.current) return;
    if (!dirty) { clearBasket(savedKey); return; }
    writeBasket<Line>(savedKey, {
      lines, addressId: '', feeInput: null, notes: '', hgSlot: null, attemptKey: null, baseline: editBaseline,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, dirty]);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    sweepBaskets('shop');
    const saved = readBasket<Line>(savedKey);
    if (!saved) return;
    if (saved.baseline !== editBaseline) {
      clearBasket(savedKey);
      toast.warning(
        L('No se han conservado tus cambios sin guardar', 'Your unsaved changes were not kept'),
        L('El pedido ha cambiado desde que lo dejaste. Empieza de nuevo con lo que tiene ahora.', 'This order changed after you left it. Start again from what it holds now.'),
      );
      return;
    }
    nextKey.current = nextNewKey(saved.lines, nextKey.current);
    setLines(saved.lines);
    toast.info(
      L('Tus cambios sin guardar siguen aquí', 'Your unsaved changes are back'),
      L('De antes de recargar la página. Guárdalos o pulsa Cancelar para descartarlos.', 'From before the page reloaded. Save them, or press Cancel to drop them.'),
    );
    // Once, when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const overLineLimit = lines.length > MAX_ORDER_LINES;
  /**
   * Every line taken off a draft. Saving it so cancels the draft — the server
   * does it — so the screen says that first and offers the other way out.
   */
  const emptiesDraft = order.status === 'draft' && lines.length === 0;
  const canSave = dirty && (lines.length > 0 || emptiesDraft) && !overLineLimit && !edit.isPending;

  const add = (p: CatalogPick) => {
    setShortfalls(null);
    setLines((prev) => {
      // A product already on the order gets one more, on its line.
      if (prev.some((l) => l.variantId === p.variantId)) {
        let done = false;
        return prev.map((l) => {
          if (done || l.variantId !== p.variantId) return l;
          done = true;
          return withQuantity(l, l.quantity + 1);
        });
      }
      return [...prev, {
        key: `new:${nextKey.current++}`,
        variantId: p.variantId,
        name: p.name,
        variantName: p.variantName,
        unitPrice: p.price,
        quantity: 1,
        imageUrl: p.imageUrl,
        vatCategory: p.vatCategory,
      }];
    });
  };
  const setQty = (key: string, n: number) =>
    setLines((prev) => prev.map((l) => (l.key === key ? withQuantity(l, n) : l)));
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));
  /** The catalogue's stepper speaks in variants; the order in rows — it moves the first row of that variant. */
  const setVariantQty = (variantId: string, n: number) => {
    const first = lines.find((l) => l.variantId === variantId);
    if (!first) return;
    if (n <= 0) removeLine(first.key);
    else setQty(first.key, n);
  };

  const back = () => navigate(`/orders/${order.id}`);
  /** Cancel: these changes are not wanted — forget them, then leave. */
  const discardAndBack = () => {
    doneRef.current = true;
    clearBasket(savedKey);
    back();
  };

  const save = () => {
    setSubmitError(null);
    setShortfalls(null);
    const key = newProgressKey();
    setProgressKey(key);
    edit.mutate({ id: order.id, operations, progressKey: key }, {
      onSuccess: (res) => {
        doneRef.current = true;
        clearBasket(savedKey);
        qc.invalidateQueries({ queryKey: HOME_GROCERY_PLAN_KEY });
        if ((res as { draftCancelled?: boolean } | undefined)?.draftCancelled) {
          toast.success(L('Borrador cancelado', 'Draft cancelled'));
        } else {
          toast.success(L('Pedido actualizado', 'Order updated'));
        }
        back();
      },
      onError: (err: unknown) => {
        const e = err as { message?: string; data?: { shortfalls?: Shortfall[] } };
        setShortfalls(e?.data?.shortfalls?.length ? e.data.shortfalls : null);
        setSubmitError(e?.message ?? L('No se han podido guardar los cambios.', 'Your changes could not be saved.'));
      },
    });
  };

  const statusLabel = c.upcomingStatus[order.status] ?? order.status;

  return (
    <Frame lang={lang} orderId={order.id} orderNumber={order.order_number}>
      <h1 className="text-[26px] sm:text-[28px] font-extrabold text-ink font-display mb-4">{L('Editar pedido', 'Edit order')}</h1>

      <div className="xl:flex xl:gap-6 xl:items-start">
        <div className="space-y-3 max-w-2xl xl:max-w-none xl:w-[560px] 2xl:w-[620px] xl:shrink-0">
          {/* ─── Which order ─────────────────────────── */}
          <section className="bg-card rounded-xl border border-border/60 shadow-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5">
              <Package size={17} strokeWidth={2} className="text-brand shrink-0" />
              <h2 className="text-sm font-bold font-display text-ink min-w-0 truncate">
                {isHomeGrocery ? L('Pedido de tu compra del hogar', 'Home Grocery order') : L('Pedido', 'Order')}
              </h2>
              <span className="flex-1" />
              <StatusChip statusKey={order.status} label={statusLabel} />
            </div>
            <div className="border-t border-border/60 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold text-ink truncate leading-tight font-mono">{order.order_number}</span>
                  <span className="block text-[12.5px] text-muted truncate">
                    {new Date(order.created_at).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block text-[11px] text-muted font-display">{L('Ahora', 'Now')}</span>
                  <span className="block text-[15px] font-bold font-display text-ink tabular-nums">{formatCurrency(Number(order.total))}</span>
                </span>
              </div>

              {/* When and where it goes. The day and time can move here; the
                  address cannot — there is no way to move an order's address. */}
              <div className="mt-2.5 pt-2.5 border-t border-border/60 space-y-1.5">
                {isHomeGrocery && order.scheduled_for && (
                  <div className="flex items-center gap-2 text-[13px] text-ink">
                    <CalendarDays size={14} strokeWidth={1.75} className="text-brand shrink-0" />
                    <span className="min-w-0 flex-1 truncate first-letter:uppercase">
                      {planDate(order.scheduled_for, lang)} · {windowLine(order.delivery_window, lang)}
                    </span>
                    {canMoveSlot && (
                      <button type="button" onClick={() => setMovingSlot(true)}
                        className="shrink-0 text-[13px] font-semibold font-display text-brand hover:underline">
                        {L('Cambiar', 'Change')}
                      </button>
                    )}
                  </div>
                )}
                {address?.street_line_1 && (
                  <p className="flex items-center gap-2 text-[12.5px] text-gray min-w-0">
                    <MapPin size={13} strokeWidth={1.75} className="text-muted shrink-0" />
                    <span className="truncate">
                      {address.street_line_1}{address.street_line_2 ? `, ${address.street_line_2}` : ''}, {address.postcode} {address.city}
                    </span>
                  </p>
                )}
              </div>

              {order.status === 'preparing' && (
                <div className="mt-3 flex items-start gap-2 rounded-xl bg-warning-bg/60 border border-warning/30 px-3 py-2.5">
                  <AlertTriangle size={15} strokeWidth={2} className="text-warning shrink-0 mt-0.5" />
                  <p className="text-xs text-ink font-body leading-relaxed">
                    {L('Ya estamos preparando este pedido. Puedes cambiarlo, pero avísanos si es urgente: puede que ya esté empaquetado.',
                      'We’re already packing this order. You can still change it, but tell us if it’s urgent — it may already be bagged.')}
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* ─── Its lines ───────────────────────────── */}
          <section className="bg-card rounded-xl border border-border/60 shadow-card p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <ShoppingCart size={17} strokeWidth={2} className="text-brand shrink-0" />
                <h2 className="text-sm font-bold font-display text-ink">{L('Productos del pedido', 'Order items')}</h2>
                {lines.length > 0 && (
                  <span className="text-[13px] text-muted">({lines.length})</span>
                )}
              </div>
              {lines.length > 0 && (
                <button type="button" onClick={() => setExpandOpen(true)} title={L('Ampliar', 'Expand')} aria-label={L('Ampliar', 'Expand')}
                  className="w-8 h-8 rounded-lg border border-border hover:border-brand flex items-center justify-center text-muted hover:text-brand transition-colors">
                  <Maximize2 size={14} strokeWidth={1.75} />
                </button>
              )}
            </div>

            {lines.length === 0 ? (
              <div className="h-[288px] mb-3 flex flex-col items-center justify-center gap-1 border-y border-border text-center px-6">
                {emptiesDraft ? (
                  <>
                    <p className="text-sm font-semibold text-ink">{L('Este borrador se ha quedado sin artículos', 'This draft has no items left')}</p>
                    <p className="text-xs text-muted">
                      {L('Añade productos para mantenerlo o cancela el borrador. Si lo guardas vacío, se cancela.', 'Add products to keep it, or cancel the draft. Saving it empty cancels it.')}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-ink">{L('No queda nada en el pedido.', 'Nothing is left on the order.')}</p>
                    <p className="text-xs text-muted">
                      {L('Añade productos, o vuelve al pedido y cancélalo si ya no lo quieres.', "Add products, or go back to the order and cancel it if you don't want it.")}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <>
                <ul className="sm:hidden mb-3 h-[288px] overflow-y-auto border-y border-border divide-y divide-border">
                  {lines.map((l, i) => (
                    <LineRow key={l.key} l={l} index={i} lang={lang} onSet={(n) => setQty(l.key, n)} onRemove={() => removeLine(l.key)} />
                  ))}
                </ul>
                {/* A fixed height, so the totals and the Save button never
                    move: the list scrolls instead. */}
                <div className="hidden sm:block mb-3 -mx-4 h-[288px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-surface-cream border-y border-border">
                        <th className="w-10 text-left text-[11px] font-semibold text-muted uppercase tracking-wider px-4 py-2 font-display">#</th>
                        <th className="text-left text-[11px] font-semibold text-muted uppercase tracking-wider py-2 font-display">{L('Producto', 'Product')}</th>
                        <th className="text-right text-[11px] font-semibold text-muted uppercase tracking-wider py-2 font-display">{L('Precio', 'Price')}</th>
                        <th className="text-center text-[11px] font-semibold text-muted uppercase tracking-wider px-3 py-2 font-display">{L('Cant.', 'Qty')}</th>
                        <th className="text-right text-[11px] font-semibold text-muted uppercase tracking-wider py-2 font-display">{L('Total', 'Total')}</th>
                        <th className="w-12" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {lines.map((l, i) => (
                        <tr key={l.key} className={l.orderItemId ? '' : 'bg-brand-whisper/50'}>
                          <td className="px-4 py-2.5 text-xs font-semibold text-muted tabular-nums align-middle">{i + 1}</td>
                          <td className="py-2.5 pr-3 align-middle">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Thumb url={l.imageUrl} />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-ink leading-snug line-clamp-2">{l.name}</span>
                                {(l.variantName || !l.orderItemId) && (
                                  <span className="block text-[11.5px] text-muted truncate">
                                    {!l.orderItemId && <span className="font-bold text-brand">{L('Nuevo', 'New')}</span>}
                                    {!l.orderItemId && l.variantName && ' · '}
                                    {l.variantName}
                                  </span>
                                )}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 text-right text-[13px] text-gray tabular-nums align-middle whitespace-nowrap">{formatCurrency(l.unitPrice)}</td>
                          <td className="px-3 py-2.5 align-middle"><div className="flex justify-center"><Stepper value={l.quantity} onSet={(n) => setQty(l.key, n)} lang={lang} /></div></td>
                          <td className="py-2.5 align-middle whitespace-nowrap"><div className="flex justify-end"><LineTotal l={l} /></div></td>
                          <td className="pr-3 py-2.5 align-middle text-right">
                            <button type="button" onClick={() => removeLine(l.key)} aria-label={L('Quitar', 'Remove')}
                              className="w-8 h-8 rounded-lg hover:bg-danger-bg inline-flex items-center justify-center text-muted hover:text-danger transition-colors">
                              <Trash2 size={14} strokeWidth={1.75} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <button type="button" onClick={() => setPickerOpen(true)}
              className="xl:hidden w-full min-h-[52px] rounded-xl border-2 border-dashed border-border hover:border-brand text-sm font-semibold font-display text-brand inline-flex items-center justify-center gap-2">
              <Plus size={16} strokeWidth={2.5} />
              {L('Añadir productos', 'Add products')}
            </button>
          </section>

          {/* ─── Totals ──────────────────────────────── */}
          <section className="bg-card rounded-xl border border-border/60 shadow-card p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">{L('Subtotal', 'Subtotal')}</span>
              <span className="font-semibold text-ink tabular-nums">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted inline-flex items-center gap-1.5">
                <Truck size={14} strokeWidth={1.75} />
                {L('Envío', 'Delivery')}
              </span>
              <span className="font-semibold text-ink tabular-nums text-right">
                {feePending ? L('Lo añadimos en breve', 'Added shortly') : formatCurrency(fee)}
              </span>
            </div>
            {recargo > 0 && (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted">{L('Recargo de equivalencia', 'Equivalence surcharge (recargo)')}</span>
                <span className="font-semibold text-ink tabular-nums text-right">{formatCurrency(recargo)}</span>
              </div>
            )}
            {vatGroups.length > 0 && (
              <div className="pt-2 border-t border-border space-y-1">
                {vatGroups.map((g) => (
                  <div key={g.rate_pct} className="flex items-center justify-between text-xs">
                    <span className="text-muted">
                      IVA {g.rate_pct}%
                      <span className="text-muted/70">{'  ·  '}{L('base', 'base')} {formatCurrency(g.base_cents / 100)}</span>
                    </span>
                    <span className="text-gray tabular-nums">{formatCurrency(g.vat_cents / 100)}</span>
                  </div>
                ))}
                <p className="text-[11px] text-muted/80 pt-0.5">{L('Incluido en los precios', 'Included in the prices')}</p>
              </div>
            )}
            <div className="-mx-4 -mb-4 mt-3 px-4 py-3 bg-brand-whisper border-t border-brand/15 rounded-b-xl">
              <div className="flex items-center justify-between">
                <span className="text-base font-bold font-display text-ink">{L('Total', 'Total')}</span>
                <span className="text-xl font-bold font-display text-ink tabular-nums">{formatCurrency(total)}</span>
              </div>
              <p className="text-[11px] text-muted mt-0.5">{L('Importe estimado: lo confirmamos al guardar.', 'Estimated: we confirm it when you save.')}</p>
            </div>
          </section>

          {shortfalls && (
            <div className="bg-danger-bg border border-danger/20 rounded-lg p-4" role="alert">
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle size={16} strokeWidth={2} className="text-danger shrink-0 mt-0.5" />
                <p className="text-sm font-semibold text-danger">{L('No tenemos bastante de algunos productos', "We don't have enough of some products")}</p>
              </div>
              <ul className="text-sm text-danger space-y-0.5 pl-6">
                {shortfalls.map((s) => (
                  <li key={s.productName}>
                    {L(`${s.productName}: pediste ${s.needed}, quedan ${s.available}`, `${s.productName}: you asked for ${s.needed}, ${s.available} left`)}
                  </li>
                ))}
              </ul>
              <p className="mt-2 pl-6 text-xs text-ink">{L('Tu pedido no ha cambiado. Ajusta las cantidades y vuelve a guardar.', 'Your order is unchanged. Adjust the quantities and save again.')}</p>
            </div>
          )}
          {/* Said beside the button, where the decision is made. */}
          {emptiesDraft && (
            <div className="bg-warning-bg border border-warning/30 rounded-lg p-4 flex items-start gap-3" role="status">
              <AlertTriangle size={18} strokeWidth={1.75} className="text-warning shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{L('Este borrador se ha quedado sin artículos', 'This draft has no items left')}</p>
                <p className="text-[13px] text-ink/80 mt-0.5">
                  {L('Añade productos para mantenerlo o cancela el borrador. Si lo guardas vacío, se cancela.', 'Add products to keep it, or cancel the draft. Saving it empty cancels it.')}
                </p>
              </div>
            </div>
          )}
          {submitError && !shortfalls && (
            <div className="bg-danger-bg border border-danger/20 rounded-lg p-4" role="alert">
              <p className="text-sm text-danger font-medium">{submitError}</p>
            </div>
          )}
          {overLineLimit && (
            <div className="bg-warning-bg border border-warning/30 rounded-lg p-4" role="alert">
              <p className="text-sm font-medium text-ink">
                {L(`Un pedido puede tener hasta ${MAX_ORDER_LINES} productos. Quita ${lines.length - MAX_ORDER_LINES} para poder guardar.`,
                  `One order can hold up to ${MAX_ORDER_LINES} products. Remove ${lines.length - MAX_ORDER_LINES} to save.`)}
              </p>
            </div>
          )}

          {edit.isPending && (
            <OrderProgressPanel key={progressKey ?? 'edit'} kind="edit" phase="server" progressKey={progressKey} lang={lang}
              detail={{ lines: operations.length }} />
          )}

          {/* Fixed above the tab bar below xl, so the total and the way to add
              to it stay in reach; part of the column from xl. */}
          <div className="fixed xl:static inset-x-0 z-30 bottom-[calc(58px+env(safe-area-inset-bottom))] lg:bottom-0 bg-surface-cream/95 xl:bg-transparent backdrop-blur xl:backdrop-blur-none border-t xl:border-t-0 border-border shadow-[0_-4px_16px_rgba(0,0,0,0.06)] xl:shadow-none xl:pt-2">
            <div className="xl:hidden flex items-center gap-2 px-4 pt-3">
              <button type="button" onClick={() => setExpandOpen(true)} disabled={lines.length === 0}
                className="min-w-0 flex-1 text-left disabled:opacity-50 rounded-lg -mx-1 px-1 py-0.5">
                <span className="block text-[11px] text-muted leading-tight">
                  {lines.length === 1 ? L('1 producto', '1 item') : L(`${lines.length} productos`, `${lines.length} items`)}
                </span>
                <span className="block text-base font-bold text-ink tabular-nums leading-tight">{formatCurrency(total)}</span>
              </button>
              <button type="button" onClick={() => setPickerOpen(true)}
                className="min-h-[44px] px-3.5 rounded-xl border-2 border-brand text-brand font-semibold font-display text-sm inline-flex items-center gap-1.5 shrink-0">
                <Plus size={16} strokeWidth={2.5} />
                <span className="max-[379px]:hidden">{L('Añadir productos', 'Add products')}</span>
              </button>
            </div>
            <div className="flex gap-3 p-4 xl:p-0 xl:justify-end">
              <button type="button" onClick={discardAndBack}
                className="flex-1 xl:flex-none min-h-[52px] px-5 rounded-xl bg-card border-2 border-border hover:border-brand font-semibold font-display text-sm text-ink">
                {L('Cancelar', 'Cancel')}
              </button>
              <button type="button" onClick={save} disabled={!canSave}
                className={`flex-[2] xl:flex-none min-h-[52px] px-6 rounded-xl disabled:opacity-50 text-white font-semibold font-display text-sm inline-flex items-center justify-center gap-2 ${
                  emptiesDraft ? 'bg-danger hover:bg-danger/90' : 'bg-brand hover:bg-brand-mid'}`}>
                {edit.isPending
                  ? <Loader2 size={16} strokeWidth={2.5} className="animate-spin" />
                  : emptiesDraft ? <Trash2 size={16} strokeWidth={2} /> : <Check size={16} strokeWidth={2.5} />}
                {emptiesDraft ? L('Cancelar borrador', 'Cancel draft') : L('Guardar cambios', 'Save changes')}
              </button>
            </div>
          </div>
        </div>

        <CatalogPanel
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          quantities={quantities}
          onAdd={add}
          onSetQuantity={setVariantQty}
          lang={lang}
        />
      </div>

      {/* The order's lines at full width, to check a long one. */}
      {expandOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setExpandOpen(false)}>
          <div className="bg-card rounded-2xl shadow-modal w-full max-w-3xl max-h-[88vh] sm:max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="shrink-0 px-4 sm:px-6 py-4 border-b border-border flex items-center gap-3">
              <ShoppingCart size={18} strokeWidth={1.75} className="text-brand" />
              <h3 className="text-lg font-bold font-display text-ink flex-1 min-w-0">
                {L('Productos del pedido', 'Order items')}
                <span className="ml-2 text-sm font-semibold text-muted tabular-nums">{lines.length}</span>
              </h3>
              <button type="button" onClick={() => setExpandOpen(false)} aria-label={L('Cerrar', 'Close')}
                className="w-9 h-9 rounded-lg hover:bg-surface-linen flex items-center justify-center">
                <X size={18} strokeWidth={1.75} className="text-muted" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 sm:px-6">
              <ul className="divide-y divide-border">
                {lines.map((l, i) => (
                  <LineRow key={l.key} l={l} index={i} lang={lang} onSet={(n) => setQty(l.key, n)} onRemove={() => removeLine(l.key)} />
                ))}
              </ul>
            </div>
            <div className="shrink-0 px-4 sm:px-6 py-4 border-t border-border flex items-center justify-between">
              <span className="text-sm text-muted">{L('Subtotal', 'Subtotal')}</span>
              <span className="text-lg font-bold text-ink tabular-nums">{formatCurrency(subtotal)}</span>
            </div>
          </div>
        </div>
      )}

      {movingSlot && order.scheduled_for && (
        <ChangeSlotDialog
          orderId={order.id}
          initial={{ scheduled_for: order.scheduled_for.slice(0, 10), delivery_window: order.delivery_window ?? null }}
          preferredWeekday={null}
          lang={lang}
          onClose={() => setMovingSlot(false)}
        />
      )}
    </Frame>
  );
}
