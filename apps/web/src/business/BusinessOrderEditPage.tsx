import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, Check, FileLock2, Loader2, MapPin, Maximize2, Minus, Package, Plus, SearchX, ShoppingCart, Store,
  StickyNote, Trash2, Truck,
} from 'lucide-react';
import {
  MAX_ORDER_LINES, VAT_RATES, computeTaxBreakdown, deliveryFeeIsPending, discountEuros, isUncertainOutcome, recargoOnCents,
  lockingInvoiceOf, newProgressKey, previewLineTotal, previewSubtotal, useEditMyOrderItems, useMyOrderForEdit,
  useSetMyOrderNotes, customerCanEditOrder,
  editBasketKey, editBaselineOf, nextNewKey, readBasket, writeBasket, clearBasket, sweepBaskets,
  type BusinessProduct, type BusinessSize, type IssuedInvoiceRef, type Order,
} from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import OrderProgressPanel from '@/components/OrderProgressPanel';
import QuantityField from '@/components/QuantityField';
import { money } from '@/sales/lib/format';
import BackLink from '@/sales/components/BackLink';
import { Card } from '@/sales/components/ui';
import ConfirmModal from '@/sales/components/ConfirmModal';
import { Dialog } from '@/sales/components/Dialog';
import EmptyState from '@/sales/components/EmptyState';
import { Skeleton } from '@/sales/components/Skeleton';
import SalesStatusBadge from '@/sales/components/SalesStatusBadge';
import { useToast } from '@/sales/components/Toast';
import { useBizT } from './lib/i18n';
import { lineFromCatalogue, operationsOf, previewOf, seedLines, type EditLine } from './lib/editBasket';
import EditProductPanel from './components/EditProductPanel';
import Photo from './components/Photo';

/**
 * Changing an order (2026-10-30, user: "edit order should be as we have edit
 * order on rep side") — the rep's edit screen (sales/SalesNewOrderPage with an
 * order) for the buyer's own order: which order it is, its lines with their
 * quantities typed or stepped and taken out, the catalogue beside it to add
 * more, what it now comes to with its IVA, their note, and one save.
 *
 * What the rep has and a buyer does not is the office's: the delivery fee
 * (set by our team) and a price off a line (agreed with a rep, then shown
 * here as it applies). The catalogue holds only the order's own shop — what
 * the customer edit route accepts (routes/orders.ts PUT /:id/items).
 *
 * The save is the rep builder's: a DIFF against the order as the screen
 * opened (lib/editBasket), items first because they can be refused — stock,
 * an order that moved on, an invoice issued — then the note.
 */

interface Shortfall { productName: string; needed: number; available: number }

function shortfallsFrom(err: unknown): Shortfall[] | null {
  const data = (err as { data?: { shortfalls?: unknown } } | null)?.data;
  return data && Array.isArray(data.shortfalls) ? (data.shortfalls as Shortfall[]) : null;
}

type EditableOrder = Order & { sub_orders?: unknown[]; parent_order_id?: string | null };

/**
 * Waits for the order, then hands it to an editor keyed on its id: the editor
 * reads the order ONCE as its starting point (the rep builder's reason for
 * the same split), from a fetch of its own (useMyOrderForEdit) so that start
 * is never an older cached copy.
 */
export default function BusinessOrderEditPage() {
  const t = useBizT();
  const navigate = useNavigate();
  const { orderId } = useParams();
  const { data, isLoading, error } = useMyOrderForEdit(orderId);

  if (isLoading) {
    return (
      <div className="xl:flex xl:gap-4">
        <div className="space-y-3 xl:w-[540px] xl:shrink-0">
          <Card className="p-5 space-y-3"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-4 w-1/3" /></Card>
          <Card className="p-5 space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></Card>
        </div>
        <Card className="hidden xl:block flex-1 h-[60vh]"><span /></Card>
      </div>
    );
  }
  if (!data || error) {
    return (
      <div>
        <BackLink label={t('biz.orders.title')} onClick={() => navigate('/business/orders')} />
        <Card>
          <EmptyState
            icon={<SearchX size={28} strokeWidth={1.75} className="text-muted" />}
            title={t('biz.order.goneTitle')}
            description={t('biz.order.goneBody')}
            action={{ label: t('biz.orders.seeAll'), onClick: () => navigate('/business/orders') }}
          />
        </Card>
      </div>
    );
  }
  const order = data as EditableOrder;
  // A purchase split across shops is edited part by part, from each part.
  if (order.sub_orders) return <Navigate to={`/business/orders/${order.id}`} replace />;
  return <OrderEditor key={order.id} order={order} />;
}

function OrderEditor({ order }: { order: EditableOrder }) {
  const t = useBizT();
  const lang = useLanguageStore((s) => s.lang) as 'es' | 'en';
  const navigate = useNavigate();
  const toast = useToast();
  const editItems = useEditMyOrderItems();
  const setNotesCall = useSetMyOrderNotes();

  // The order as the screen opened: what the save is measured against.
  const [seed] = useState(() => ({ lines: seedLines(order.items ?? [], lang), notes: order.customer_notes ?? '' }));
  const [lines, setLines] = useState<EditLine[]>(seed.lines);
  const [notes, setNotes] = useState(seed.notes);
  const nextKey = useRef(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [expandOpen, setExpandOpen] = useState(false);
  const [shortfalls, setShortfalls] = useState<Shortfall[] | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [progressKey, setProgressKey] = useState<string | null>(null);
  const savingRef = useRef(false);

  const toOrder = () => navigate(`/business/orders/${order.id}`);
  const lockedBy = lockingInvoiceOf(order as { invoices?: IssuedInvoiceRef[] | null });
  // In the shop's hands, or a draft they made themselves (packages/shared orderEditing.ts).
  const editable = customerCanEditOrder(order) && !lockedBy;
  const storeId = order.store_id ?? 'cesto';
  const shopName = order.store?.name ?? t('biz.house');

  // Units of each size in the order, summed: one size may sit on two lines.
  const quantities = useMemo(
    () => lines.reduce<Record<string, number>>((m, l) => { m[l.variantId] = (m[l.variantId] ?? 0) + l.quantity; return m; }, {}),
    [lines],
  );
  const subtotal = useMemo(() => previewSubtotal(lines.map(previewOf)), [lines]);
  // Prices include IVA: the breakdown splits what is already in the subtotal.
  const taxLines = useMemo(() => lines.map((l) => ({
    grossCents: Math.round(previewLineTotal(previewOf(l)) * 100),
    rate_pct: VAT_RATES[l.vatCategory],
  })), [lines]);
  const tax = useMemo(() => computeTaxBreakdown(taxLines), [taxLines]);
  // A 0 % line carries no IVA, so it gets no row, as at checkout.
  const vatGroups = tax.groups.filter((g) => g.rate_pct > 0);
  const partOfPurchase = !!order.parent_order_id;
  const feePending = deliveryFeeIsPending(order);
  const fee = partOfPurchase || feePending ? 0 : Number(order.delivery_fee);
  // Recargo de equivalencia (2026-11-04) when the order is under the regime;
  // a part of a purchase carries none (the purchase does). The server's rule.
  const recargo = order.recargo_equivalencia && !partOfPurchase
    ? recargoOnCents(taxLines, Math.round(fee * 100)) / 100
    : 0;
  const total = subtotal + fee + recargo;

  const operations = useMemo(() => operationsOf(seed.lines, lines), [seed.lines, lines]);
  const notesChanged = notes.trim() !== seed.notes.trim();
  const dirty = operations.length > 0 || notesChanged;

  /**
   * UNSAVED CHANGES SURVIVE A RELOAD (2026-11-04, packages/shared
   * savedBasket.ts) — the lines and the note, kept in this browser per buyer
   * and order, put back only while the order is still the one they were made
   * against, dropped once saved or on Cancel. Save first, restore second: on
   * the first pass the save sees nothing restored yet and stays out of the way.
   */
  const savedKey = editBasketKey('business', order.user_id, order.id);
  const [editBaseline] = useState(() => editBaselineOf(seed.lines, { notes: seed.notes }));
  const restoredRef = useRef(false);
  /** Saved or discarded: nothing writes the changes back on the way out. */
  const doneRef = useRef(false);
  useEffect(() => {
    if (!restoredRef.current || doneRef.current) return;
    if (!dirty) { clearBasket(savedKey); return; }
    writeBasket<EditLine>(savedKey, {
      lines, addressId: '', feeInput: null, notes, hgSlot: null, attemptKey: null, baseline: editBaseline,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, notes, dirty]);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    sweepBaskets('business');
    const saved = readBasket<EditLine>(savedKey);
    if (!saved) return;
    if (saved.baseline !== editBaseline) {
      clearBasket(savedKey);
      toast.warning(t('biz.edit.restoreStaleTitle'), t('biz.edit.restoreStaleBody'));
      return;
    }
    nextKey.current = nextNewKey(saved.lines, nextKey.current);
    setLines(saved.lines);
    setNotes(saved.notes);
    toast.info(t('biz.edit.restoredTitle'), t('biz.edit.restoredBody'));
    // Once, when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Cancel: these changes are not wanted — forget them, then leave. */
  const discardAndLeave = () => {
    doneRef.current = true;
    clearBasket(savedKey);
    toOrder();
  };
  const overLineLimit = lines.length > MAX_ORDER_LINES;
  const saving = editItems.isPending || setNotesCall.isPending;
  /**
   * Every line taken off a draft. Saving it so cancels the draft — the server
   * does it — so the screen says that first and offers the other way out.
   */
  const emptiesDraft = order.status === 'draft' && lines.length === 0;
  const canSave = (lines.length > 0 || emptiesDraft) && dirty && !saving && !overLineLimit;

  const addFromCatalogue = (p: BusinessProduct, v: BusinessSize) => {
    setShortfalls(null);
    setLines((prev) => (prev.some((l) => l.variantId === v.id)
      ? prev.map((l) => (l.variantId === v.id ? { ...l, quantity: l.quantity + 1 } : l))
      : [...prev, lineFromCatalogue(p, v, lang, `new:${nextKey.current++}`)]));
  };
  // An older line's flat discount becomes per unit once its quantity moves, as the server reads it.
  const setQty = (key: string, n: number) => {
    setShortfalls(null);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, quantity: Math.max(1, n), flatDiscount: undefined } : l)));
  };
  const removeLine = (key: string) => { setShortfalls(null); setLines((prev) => prev.filter((l) => l.key !== key)); };
  // The catalogue's stepper speaks in sizes; it moves the first row of that size.
  const setSizeQty = (variantId: string, n: number) => {
    const first = lines.find((l) => l.variantId === variantId);
    if (!first) return;
    if (n <= 0) removeLine(first.key);
    else setQty(first.key, n);
  };

  /** Items first — they are what can be refused — then the note. One press at a time. */
  const save = async () => {
    if (savingRef.current || !canSave) return;
    savingRef.current = true;
    setSubmitError(null);
    setShortfalls(null);
    let step: 'items' | 'notes' = 'items';
    try {
      if (operations.length > 0) {
        const key = newProgressKey();
        setProgressKey(key);
        const res = await editItems.mutateAsync({ id: order.id, operations, progressKey: key });
        // Emptied, so the server cancelled it: no note to save on it.
        if ((res as { draftCancelled?: boolean } | undefined)?.draftCancelled) {
          doneRef.current = true;
          clearBasket(savedKey);
          toast.success(t('biz.order.draftCancelled'));
          navigate(`/business/orders/${order.id}`, { replace: true });
          return;
        }
      }
      if (notesChanged) {
        step = 'notes';
        await setNotesCall.mutateAsync({ id: order.id, customerNotes: notes.trim() });
      }
      doneRef.current = true;
      clearBasket(savedKey);
      toast.success(t('biz.order.editSaved'));
      // Replace: back must not return to a basket whose starting point is now the past.
      navigate(`/business/orders/${order.id}`, { replace: true });
    } catch (err) {
      const short = shortfallsFrom(err);
      if (short) { setShortfalls(short); return; }
      const msg = step === 'items' && isUncertainOutcome(err)
        ? t('biz.edit.unsure')
        : err instanceof Error ? err.message : String(err);
      setSubmitError(step === 'notes' ? t('biz.edit.notesFailed', { msg }) : msg);
      toast.error(t('biz.order.editFailed'), msg);
    } finally {
      savingRef.current = false;
    }
  };

  // It stopped being editable — on its way, invoiced, cancelled — between the
  // order page and here. The server would refuse; this says so first.
  if (!editable) {
    return (
      <div className="max-w-lg">
        <BackLink label={order.order_number} title={t('biz.edit.title')} onClick={toOrder} />
        <Card className="p-5">
          <div className="flex items-start gap-3">
            {lockedBy
              ? <FileLock2 size={20} strokeWidth={1.75} className="text-brand shrink-0 mt-0.5" />
              : <AlertTriangle size={20} strokeWidth={1.75} className="text-warning shrink-0 mt-0.5" />}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[15px] font-bold font-display text-ink">{t('biz.edit.lockedTitle')}</h2>
                <SalesStatusBadge status={order.status} />
              </div>
              <p className="text-[13px] text-gray mt-1">
                {lockedBy ? t('biz.order.invoiced', { number: lockedBy.invoice_number ?? '—' }) : t('biz.edit.lockedBody')}
              </p>
              <button type="button" onClick={() => navigate(`/business/orders/${order.id}`, { replace: true })} className="mt-4 h-11 px-4 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display transition-colors">
                {t('biz.edit.backToOrder')}
              </button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const a = order.address_snapshot;
  const rowProps = (l: EditLine) => ({
    l,
    onDec: () => setQty(l.key, l.quantity - 1),
    onInc: () => setQty(l.key, l.quantity + 1),
    onSet: (n: number) => setQty(l.key, n),
    onRemove: () => removeLine(l.key),
  });

  return (
    <div className="pb-48 lg:pb-6">
      <BackLink label={order.order_number} title={t('biz.edit.title')} onClick={toOrder} />
      <div className="xl:flex xl:gap-4 xl:items-start">
        <div className="space-y-3 max-w-2xl xl:max-w-none xl:w-[540px] 2xl:w-[600px] xl:shrink-0">
          {/* ─── Which order this is ─── */}
          <section className="bg-card rounded-2xl border border-border/80 shadow-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5">
              <span className="w-8 h-8 rounded-lg bg-brand-whisper text-brand flex items-center justify-center shrink-0"><Package size={16} strokeWidth={1.75} /></span>
              <h2 className="text-[15px] font-semibold font-display text-ink min-w-0 truncate">{t('biz.edit.orderCard')}</h2>
              <span className="flex-1" />
              <SalesStatusBadge status={order.status} />
            </div>
            <div className="border-t border-border/60 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold font-mono text-ink truncate leading-tight">{order.order_number}</span>
                  <span className="block text-[12.5px] text-muted truncate">
                    {new Date(order.created_at).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid' })}
                  </span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block text-[12px] text-muted font-display">{t('biz.edit.now')}</span>
                  <span className="block text-[15px] font-bold font-display text-ink tabular-nums">{money(Number(order.total))}</span>
                </span>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-gray min-w-0">
                <Store size={13} strokeWidth={1.75} className="text-brand shrink-0" />
                <span className="truncate font-semibold font-display">{shopName}</span>
              </p>
              {a && (
                <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-gray min-w-0">
                  <MapPin size={13} strokeWidth={1.75} className="text-muted shrink-0" />
                  <span className="truncate">{a.street_line_1}{a.street_line_2 ? `, ${a.street_line_2}` : ''}, {a.postcode} {a.city}</span>
                </p>
              )}
              <p className="mt-2.5 pt-2.5 border-t border-border/60 text-[12px] text-muted">{t('biz.edit.addressFixed')}</p>
            </div>
          </section>

          {/* ─── The lines ─── */}
          <section className="bg-card rounded-2xl border border-border/80 shadow-card p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-brand-whisper text-brand flex items-center justify-center shrink-0"><ShoppingCart size={16} strokeWidth={1.75} /></span>
                <h2 className="text-[15px] font-semibold font-display text-ink whitespace-nowrap">{t('biz.edit.list')}</h2>
                {lines.length > 0 && (
                  <span className="hidden sm:inline text-[13px] text-muted whitespace-nowrap">
                    ({t(lines.length === 1 ? 'biz.order.lines_one' : 'biz.order.lines_other', { count: lines.length })})
                  </span>
                )}
              </div>
              {lines.length > 0 && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button type="button" onClick={() => setExpandOpen(true)} title={t('biz.edit.expand')} aria-label={t('biz.edit.expand')} className="w-8 h-8 rounded-lg border border-border hover:border-brand flex items-center justify-center text-muted hover:text-brand transition-colors">
                    <Maximize2 size={14} strokeWidth={1.75} />
                  </button>
                  <button type="button" onClick={() => setClearOpen(true)} className="h-8 px-2 rounded-lg inline-flex items-center gap-1.5 text-[13px] font-bold font-display text-danger hover:bg-danger-bg transition-colors">
                    <Trash2 size={14} strokeWidth={2} />{t('biz.edit.clearAll')}
                  </button>
                </div>
              )}
            </div>

            {lines.length === 0 && (
              <div className="h-28 sm:h-[216px] mb-3 flex flex-col items-center justify-center gap-1 border-y border-border px-4 text-center">
                <p className="text-sm text-ink font-semibold font-display">
                  {emptiesDraft ? t('biz.order.emptyDraftTitle') : t('biz.edit.empty')}
                </p>
                <p className="text-[12.5px] text-muted">
                  {emptiesDraft ? t('biz.order.emptyDraftBody') : t('biz.order.editEmpty')}
                </p>
              </div>
            )}

            {lines.length > 0 && (
              <>
                <ul className="sm:hidden mb-3 border-y border-border divide-y divide-border">
                  {lines.map((l, i) => <LineRow key={l.key} index={i} {...rowProps(l)} />)}
                </ul>

                {/* A fixed height, so the totals and the save under it never move (the rep's reason). */}
                <div className="hidden sm:block mb-3 -mx-4 h-[260px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-surface-cream border-y border-border">
                        <th className="w-10 text-left text-[12.5px] font-medium text-muted px-4 py-2.5 font-display">#</th>
                        <th className="text-left text-[12.5px] font-medium text-muted py-2.5 font-display">{t('biz.edit.colProduct')}</th>
                        <th className="text-right text-[12.5px] font-medium text-muted py-2.5 font-display">{t('biz.edit.colPrice')}</th>
                        <th className="text-center text-[12.5px] font-medium text-muted px-3 py-2.5 font-display">{t('biz.cart.qty')}</th>
                        <th className="text-right text-[12.5px] font-medium text-muted py-2.5 font-display">{t('biz.cart.total')}</th>
                        <th className="w-12 px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => {
                        const off = discountEuros(l.flatDiscount ?? l.discount) > 0;
                        return (
                          <tr key={l.key} className="border-b border-border last:border-0 transition-colors hover:bg-surface-cream/60 focus-within:bg-brand-whisper">
                            <td className="px-4 py-2.5 text-xs text-muted tabular-nums align-middle">{i + 1}</td>
                            <td className="py-2.5 align-middle">
                              <span className="flex items-center gap-2.5 min-w-0">
                                <span className="sales-photo w-9 h-9 rounded-lg bg-surface-cream border border-border shrink-0 overflow-hidden flex items-center justify-center">
                                  <Photo url={l.imageUrl} preset="thumb" icon={15} className="w-full h-full object-contain p-0.5" />
                                </span>
                                <span className="min-w-0">
                                  <span className="block text-[13px] font-medium text-ink leading-snug line-clamp-2">
                                    {l.name}
                                    {!l.orderItemId && <NewTag />}
                                  </span>
                                  <span className="block text-[11px] text-muted truncate">
                                    {l.sizeName}
                                    {off && <span className="text-success font-semibold">{l.sizeName ? ' · ' : ''}{t('biz.cat.agreed')}</span>}
                                  </span>
                                </span>
                              </span>
                            </td>
                            <td className="py-2.5 text-right text-[13px] text-gray tabular-nums whitespace-nowrap align-middle">{money(l.unitPrice)}</td>
                            <td className="px-3 py-2.5 align-middle">
                              <span className="flex items-center justify-center gap-1">
                                <button type="button" onClick={() => setQty(l.key, l.quantity - 1)} disabled={l.quantity <= 1} aria-label={t('biz.cat.less')} className="w-7 h-7 rounded-md border border-border bg-card text-ink flex items-center justify-center disabled:opacity-40 hover:border-brand transition-colors">
                                  <Minus size={12} strokeWidth={2.5} />
                                </button>
                                <QuantityField value={l.quantity} max={Infinity} onChange={(n) => setQty(l.key, n)} label={t('biz.cart.qty')} className="min-w-8 text-xs font-bold text-ink" />
                                <button type="button" onClick={() => setQty(l.key, l.quantity + 1)} aria-label={t('biz.cat.more')} className="w-7 h-7 rounded-md border border-border bg-card text-ink flex items-center justify-center hover:border-brand transition-colors">
                                  <Plus size={12} strokeWidth={2.5} />
                                </button>
                              </span>
                            </td>
                            <td className="py-2.5 text-right text-[13px] font-bold text-ink tabular-nums whitespace-nowrap align-middle">
                              {off && <span className="block text-[11px] font-normal text-muted line-through">{money(l.unitPrice * l.quantity)}</span>}
                              {money(previewLineTotal(previewOf(l)))}
                            </td>
                            <td className="px-4 py-2.5 align-middle">
                              <button type="button" onClick={() => removeLine(l.key)} aria-label={t('biz.cart.remove', { name: l.name })} title={t('biz.cart.remove', { name: l.name })} className="w-7 h-7 rounded-lg hover:bg-danger-bg flex items-center justify-center text-muted hover:text-danger transition-colors">
                                <Trash2 size={14} strokeWidth={1.75} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <button type="button" onClick={() => setPickerOpen(true)} className="xl:hidden w-full min-h-[52px] rounded-xl border-2 border-dashed border-border hover:border-brand text-sm font-semibold font-display text-brand inline-flex items-center justify-center gap-2">
              <Plus size={16} strokeWidth={2.5} />{t('biz.edit.addProducts')}
            </button>
          </section>

          {/* ─── What it comes to ─── */}
          <section className="bg-card rounded-2xl border border-border/80 shadow-card p-4 space-y-2.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray">{t('biz.cart.subtotal')}</span>
              <span className="font-semibold text-ink tabular-nums">{money(subtotal)}</span>
            </div>
            <div className="flex items-start justify-between gap-3 text-sm">
              <span className="text-gray inline-flex items-center gap-1.5"><Truck size={14} strokeWidth={1.75} />{t('biz.cart.delivery')}</span>
              <span className="text-right">
                {partOfPurchase
                  ? <span className="text-gray">{t('biz.edit.feeOnPurchase')}</span>
                  : feePending
                    ? <span className="text-gray">{t('biz.cart.deliveryLater')}</span>
                    : <span className="font-semibold text-ink tabular-nums">{money(fee)}</span>}
              </span>
            </div>
            {vatGroups.length > 0 && (
              <div className="pt-2 border-t border-border space-y-1">
                {vatGroups.map((g) => (
                  <div key={g.rate_pct} className="flex items-center justify-between text-xs">
                    <span className="text-muted">
                      {t('biz.edit.vatAt', { rate: g.rate_pct })}
                      <span className="text-muted/70">{'  ·  '}{t('biz.edit.vatBase')} {money(g.base_cents / 100)}</span>
                    </span>
                    <span className="text-gray tabular-nums">{money(g.vat_cents / 100)}</span>
                  </div>
                ))}
                <p className="text-[11px] text-muted/80 pt-0.5">{t('biz.edit.vatIncluded')}</p>
              </div>
            )}
            {recargo > 0 && (
              <div className="flex items-center justify-between text-xs mt-2">
                <span className="text-gray">{t('biz.checkout.recargo')}</span>
                <span className="text-ink tabular-nums">{money(recargo)}</span>
              </div>
            )}
            <div className="-mx-4 -mb-4 mt-3 px-4 py-3 bg-brand-whisper border-t border-brand/15 flex items-center justify-between rounded-b-2xl">
              <span className="text-base font-bold font-display text-ink">{feePending && !partOfPurchase ? t('biz.checkout.totalSoFar') : t('biz.cart.total')}</span>
              <span className="text-xl font-bold font-display text-ink tabular-nums">{money(total)}</span>
            </div>
          </section>

          {/* ─── Their note ─── */}
          <section className="bg-card rounded-2xl border border-border/80 shadow-card p-4">
            <label htmlFor="order-notes" className="flex items-center gap-2 text-sm font-semibold font-display text-ink mb-1">
              <StickyNote size={15} strokeWidth={1.75} className="text-brand" />{t('biz.checkout.notes')}
            </label>
            <p className="text-[12px] text-muted mb-2">{t('biz.checkout.notesHint')}</p>
            <textarea
              id="order-notes"
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('biz.checkout.notesPlaceholder')}
              className="w-full rounded-lg border border-border bg-surface-cream px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
          </section>

          {shortfalls && (
            <div className="bg-danger-bg border border-danger/20 rounded-xl p-4" role="alert">
              <p className="flex items-start gap-2 text-sm font-semibold text-danger">
                <AlertTriangle size={16} strokeWidth={2} className="shrink-0 mt-0.5" />{t('biz.edit.shortTitle')}
              </p>
              <ul className="mt-1.5 text-sm text-danger space-y-0.5 pl-6">
                {shortfalls.map((s) => (
                  <li key={s.productName}>{t('biz.edit.shortLine', { name: s.productName, needed: s.needed, available: s.available })}</li>
                ))}
              </ul>
            </div>
          )}

          {editItems.isPending && (
            <OrderProgressPanel key={progressKey ?? 'edit'} kind="edit" phase="server" progressKey={progressKey} lang={lang} detail={{ lines: operations.length }} />
          )}

          {overLineLimit && (
            <p role="alert" className="bg-warning-bg border border-warning/30 rounded-xl p-4 text-sm font-medium text-ink">
              {t('biz.cart.tooMany', { count: lines.length, max: MAX_ORDER_LINES })}
            </p>
          )}

          {/* Said beside the button, where the decision is made. */}
          {emptiesDraft && (
            <div role="status" className="bg-warning-bg border border-warning/30 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle size={18} strokeWidth={1.75} className="text-warning shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{t('biz.order.emptyDraftTitle')}</p>
                <p className="text-[13px] text-ink/80 mt-0.5">{t('biz.order.emptyDraftBody')}</p>
              </div>
            </div>
          )}

          {submitError && (
            <p role="alert" className="bg-danger-bg border border-danger/20 rounded-xl p-4 text-sm text-danger font-medium">{submitError}</p>
          )}

          {/* The action bar: fixed under the thumb on a phone, the end of the form from lg. */}
          <div className="fixed lg:static bottom-0 left-0 right-0 z-30 bg-card/95 lg:bg-transparent backdrop-blur lg:backdrop-blur-none border-t lg:border-t-0 border-border lg:pt-1 shadow-[0_-4px_16px_rgba(26,26,26,0.06)] lg:shadow-none">
            <div className="lg:hidden flex items-center gap-2 px-4 pt-3">
              <button type="button" onClick={() => setExpandOpen(true)} disabled={lines.length === 0} className="min-w-0 flex-1 text-left disabled:opacity-50 rounded-lg -mx-1 px-1 py-0.5">
                <span className="block text-[11px] text-muted leading-tight">
                  {t(lines.length === 1 ? 'biz.order.lines_one' : 'biz.order.lines_other', { count: lines.length })}
                </span>
                <span className="block text-base font-bold text-ink tabular-nums leading-tight">{money(total)}</span>
              </button>
              <button type="button" onClick={() => setPickerOpen(true)} className="xl:hidden min-h-[44px] px-3.5 rounded-xl border border-brand text-brand font-semibold font-display text-sm inline-flex items-center gap-1.5 shrink-0">
                <Plus size={16} strokeWidth={2.5} />
                <span className="max-[379px]:hidden">{t('biz.edit.addProducts')}</span>
              </button>
            </div>
            <div className="flex gap-3 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] lg:p-0 lg:justify-end">
              <button type="button" onClick={discardAndLeave} className="hidden lg:block min-h-[52px] px-5 rounded-xl bg-card border border-border hover:border-brand/50 font-semibold font-display text-sm text-ink">
                {t('biz.order.discard')}
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={!canSave}
                className={`flex-1 lg:flex-none min-h-[52px] px-6 rounded-xl disabled:opacity-50 text-white font-semibold font-display text-sm inline-flex items-center justify-center gap-2 transition-colors ${
                  emptiesDraft ? 'bg-danger hover:bg-danger/90' : 'bg-brand hover:bg-brand-mid'}`}
              >
                {saving
                  ? <Loader2 size={16} strokeWidth={2.5} className="animate-spin" />
                  : emptiesDraft ? <Trash2 size={16} strokeWidth={2} /> : <Check size={16} strokeWidth={2.5} />}
                {emptiesDraft ? t('biz.order.cancelDraft') : t('biz.order.save')}
              </button>
            </div>
          </div>
        </div>

        <EditProductPanel
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          storeId={storeId}
          shopName={shopName}
          quantities={quantities}
          onAdd={addFromCatalogue}
          onSetQuantity={setSizeQty}
        />
      </div>

      <ConfirmModal
        open={clearOpen}
        danger
        title={t('biz.edit.clearTitle')}
        message={t('biz.edit.clearBody')}
        confirmLabel={t('biz.edit.clearAll')}
        cancelLabel={t('biz.order.keep')}
        onConfirm={() => { setLines([]); setShortfalls(null); setClearOpen(false); }}
        onCancel={() => setClearOpen(false)}
      />

      {expandOpen && (
        <Dialog
          onClose={() => setExpandOpen(false)}
          closeLabel={t('biz.closeMenu')}
          icon={ShoppingCart}
          size="xl"
          ariaLabel={t('biz.edit.list')}
          title={t('biz.edit.list')}
          bodyClassName="px-4 sm:px-6"
          footer={(
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray">{t('biz.cart.subtotal')}</span>
              <span className="text-lg font-bold font-display text-ink tabular-nums">{money(subtotal)}</span>
            </div>
          )}
        >
          {lines.length === 0
            ? <p className="py-8 text-center text-sm text-muted">{t('biz.edit.empty')}</p>
            : <ul className="divide-y divide-border">{lines.map((l, i) => <LineRow key={l.key} index={i} {...rowProps(l)} />)}</ul>}
        </Dialog>
      )}
    </div>
  );
}

function NewTag() {
  const t = useBizT();
  return <span className="ml-1.5 inline-flex h-[18px] items-center px-1.5 rounded-md bg-brand-whisper text-brand text-[10px] font-bold font-display align-[1px]">{t('biz.edit.newLine')}</span>;
}

/** One line, stacked: the phone's list and the enlarged dialog's. */
function LineRow({ l, index, onDec, onInc, onSet, onRemove }: {
  l: EditLine; index: number;
  onDec: () => void; onInc: () => void; onSet: (n: number) => void; onRemove: () => void;
}) {
  const t = useBizT();
  const off = discountEuros(l.flatDiscount ?? l.discount) > 0;
  return (
    <li className="flex gap-3 py-3">
      <span className="w-5 shrink-0 pt-0.5 text-xs font-semibold text-muted tabular-nums">{index + 1}</span>
      <span className="sales-photo w-11 h-11 rounded-lg bg-surface-cream border border-border shrink-0 overflow-hidden flex items-center justify-center">
        <Photo url={l.imageUrl} preset="thumb" icon={17} className="w-full h-full object-contain p-0.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink leading-snug line-clamp-2">{l.name}{!l.orderItemId && <NewTag />}</p>
        {/* The unit price on the size's line: beside the stepper it was cut off on a phone. */}
        <p className="text-[11.5px] text-muted mt-0.5 tabular-nums">
          {l.sizeName}{l.sizeName ? ' · ' : ''}{money(l.unitPrice)} {t('biz.cart.each')}
          {off && <span className="text-success font-semibold">{' · '}{t('biz.cat.agreed')}</span>}
        </p>
        <div className="flex items-center gap-1 mt-1.5">
          <button type="button" onClick={onDec} disabled={l.quantity <= 1} aria-label={t('biz.cat.less')} className="w-9 h-9 rounded-lg border border-border bg-card text-ink flex items-center justify-center disabled:opacity-40 hover:border-brand active:bg-surface-cream transition-colors">
            <Minus size={14} strokeWidth={2.5} />
          </button>
          <QuantityField value={l.quantity} max={Infinity} onChange={onSet} label={t('biz.cart.qty')} className="min-w-8 text-sm font-bold text-ink" />
          <button type="button" onClick={onInc} aria-label={t('biz.cat.more')} className="w-9 h-9 rounded-lg border border-border bg-card text-ink flex items-center justify-center hover:border-brand active:bg-surface-cream transition-colors">
            <Plus size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>
      <div className="flex flex-col items-end justify-between shrink-0">
        <span className="text-right leading-snug">
          {off && <span className="block text-[11px] text-muted tabular-nums line-through">{money(l.unitPrice * l.quantity)}</span>}
          <span className="block text-sm font-bold text-ink tabular-nums">{money(previewLineTotal(previewOf(l)))}</span>
        </span>
        <button type="button" onClick={onRemove} aria-label={t('biz.cart.remove', { name: l.name })} className="-mr-1 w-8 h-8 rounded-lg hover:bg-danger-bg flex items-center justify-center text-muted hover:text-danger transition-colors">
          <Trash2 size={15} strokeWidth={1.75} />
        </button>
      </div>
    </li>
  );
}
