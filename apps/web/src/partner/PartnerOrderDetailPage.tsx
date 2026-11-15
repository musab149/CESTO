import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Phone, MapPin, MessageSquare, Truck, CheckCircle, XCircle, FileDown, Loader2, Pencil, Lock,
} from 'lucide-react';
import {
  usePartnerOrder,
  useUpdatePartnerOrderStatus,
  useAssignPartnerOrderRider,
  useCancelPartnerOrder,
  useConfirmPartnerDraftStock,
  useSetPartnerOrderDeliveryFee,
  lockingInvoiceOf,
  usePartnerRiders,
  usePartnerStore,
  useStoreSettings,
  resolveImageUrl,
  type PartnerOrderStatusTarget,
  type IssuedInvoiceRef,
  deliveryFeeIsPending,
} from '@grocery-app/shared';
import { downloadOrderInvoice } from '@grocery-app/shared/invoice';
import { usePartnerT } from './lib/i18n';
import { useLanguageStore } from '@/stores/languageStore';
import { buildPartnerInvoiceLabels } from './lib/invoiceLabels';
import { useToast } from '@/components/Toast';
import EditOrderModal from './components/EditOrderModal';

/**
 * Partner-scoped order detail. Mirrors admin's OrderDetailPage.tsx shape
 * but hits /api/partner/orders/:id — server rejects any id that doesn't
 * include an item from the partner's store, so cross-store detail leaks
 * are impossible.
 *
 * Status transitions available to the partner (from
 * PartnerOrderStatusTarget): pending → confirmed → preparing → on_the_way.
 * `delivered` and `cancelled` are terminal transitions that only the
 * rider or a Cesto admin can trigger — partners just watch.
 */

const STATUS_TRANSITIONS: Partial<Record<string, PartnerOrderStatusTarget>> = {
  pending:    'confirmed',
  confirmed:  'preparing',
  preparing:  'on_the_way',
  // Partner can also mark delivered as of 2026-07-23. Slice 6's rider app
  // will do the same transition; whichever actor confirms first wins,
  // delivered is terminal so no double-mark risk.
  on_the_way: 'delivered',
};

const STATUS_LABELS: Record<string, string> = {
  pending:    'Pending',
  confirmed:  'Confirmed',
  preparing:  'Preparing',
  on_the_way: 'On the way',
  delivered:  'Delivered',
  cancelled:  'Cancelled',
  draft:      'Draft',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  pending:    'bg-amber-mist text-amber-deep',
  confirmed:  'bg-info-bg text-info',
  preparing:  'bg-brand-mist text-brand',
  on_the_way: 'bg-brand-mist text-brand',
  delivered:  'bg-success-bg text-success',
  cancelled:  'bg-danger-bg text-danger',
  draft:      'bg-surface-linen text-muted',
};

function formatCurrency(n: number): string {
  return n.toFixed(2).replace('.', ',') + ' €';
}

export default function PartnerOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const t = usePartnerT();
  const lang = useLanguageStore((s) => s.lang);
  const toast = useToast();

  const { data: order, isLoading } = usePartnerOrder(orderId);
  const updateStatus = useUpdatePartnerOrderStatus();
  const assignRider  = useAssignPartnerOrderRider();
  const cancelOrder  = useCancelPartnerOrder();
  const confirmStock = useConfirmPartnerDraftStock();
  const { data: riders = [] } = usePartnerRiders({ activeOnly: true });
  const { data: partnerStoreData } = usePartnerStore();
  const { data: cestoSettings } = useStoreSettings();
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);

  async function handleDownloadInvoice() {
    if (!order) return;
    setDownloadingInvoice(true);
    try {
      await downloadOrderInvoice({
        order: order as any,
        settings: {
          storeName: partnerStoreData?.name ?? cestoSettings?.storeName ?? 'Cesto',
          address: cestoSettings?.address ?? '',
          contactEmail: cestoSettings?.contactEmail ?? '',
          contactPhone: cestoSettings?.contactPhone ?? '',
        },
        labels: buildPartnerInvoiceLabels(t),
        lang,
      });
    } catch (err) {
      toast.error(
        t('orders.invoiceFailedTitle'),
        err instanceof Error ? err.message : t('orders.invoiceFailedBody'),
      );
    } finally {
      setDownloadingInvoice(false);
    }
  }

  const [selectedStatus, setSelectedStatus] = useState<PartnerOrderStatusTarget | ''>('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelReasonError, setCancelReasonError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingFee, setEditingFee] = useState(false);
  const [feeDraft, setFeeDraft] = useState('');
  const [feeError, setFeeError] = useState<string | null>(null);
  const setFee = useSetPartnerOrderDeliveryFee();

  if (isLoading || !order) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted text-sm">Loading order…</p>
      </div>
    );
  }

  const o = order as typeof order & {
    user?: { id: string; name: string; phone: string | null; email: string | null };
    rider?: { id: string; name: string; phone: string; vehicle_type: string } | null;
    items: Array<any>;
    address_snapshot?: any;
    subtotal: number;
    delivery_fee: number;
    total: number;
    cancelled_reason?: string | null;
    customer_notes?: string | null;
    /** Set when this order is one part of a split purchase. The delivery fee
     *  then lives on the parent and every part carries zero, so there is no
     *  fee here for the shop to set. */
    parent_order_id?: string | null;
    /** The issued invoice freezing this order, when there is one. Absent on
     *  an API deployed before this field existed — see issuedInvoiceOf. */
    invoices?: IssuedInvoiceRef[] | null;
  };

  const nextStatus = STATUS_TRANSITIONS[o.status];
  const phoneClean = (o.address_snapshot?.contact_phone ?? o.user?.phone ?? '').replace(/\s+/g, '');
  function submitStatus() {
    if (!selectedStatus || !o.id) return;
    // onSuccess only — leave the dropdown populated on failure so the user
    // can retry or read the error next to their intended action, instead of
    // watching the field silently reset.
    updateStatus.mutate(
      { id: o.id, status: selectedStatus },
      { onSuccess: () => setSelectedStatus('') },
    );
  }

  // Extract an actionable message from a mutation error. Prisma / API layer
  // shapes errors as { message } most of the time; fall through to a generic
  // fallback so a network blip still shows *something*.
  function errorMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) {
      const m = (err as { message: unknown }).message;
      if (typeof m === 'string' && m.trim()) return m;
    }
    return 'Something went wrong. Please try again.';
  }

  const canCancel = o.id && ['pending', 'confirmed', 'preparing', 'draft'].includes(o.status);
  // Narrower than canCancel — editing items is only safe before the store
  // starts fulfilling the order. Excludes draft (nothing to edit against
  // yet — resolve stock first) as well as on_the_way/delivered/cancelled.
  // An issued invoice states this order's totals and cannot be altered, so
  // the order behind it is frozen — items and fee alike. The server refuses
  // both with a 409; this stops the screen offering them in the first place.
  // Permissive when the field is missing, so a frontend running ahead of the
  // API falls back to letting the server do the refusing.
  // Only a FACTURA freezes the order. A proforma is a quote, and the order
  // behind one stays editable — it is the quote that gets reissued.
  const lockedBy = lockingInvoiceOf(o);
  const canEdit = !!(o.id && ['pending', 'confirmed', 'preparing'].includes(o.status)) && !lockedBy;
  // The shop prices its own delivery — it is holding the parcel and Cesto
  // cannot judge weight from a line-item list. Same window as editing items.
  // Hidden rather than disabled on one part of a split purchase: the fee
  // belongs to the whole purchase, so there is nothing here to edit and an
  // affordance that only ever 422s is worse than no affordance.
  const canEditFee = canEdit && !o.parent_order_id;

  function submitFee() {
    if (!o.id) return;
    const value = Number(feeDraft);
    // Guarded client-side so the shop sees the constraint next to the field
    // rather than as a 422 after a round-trip. The server enforces the same
    // bounds regardless — this is convenience, not the check.
    if (!Number.isFinite(value) || value < 0 || value > 1000) {
      setFeeError('Enter an amount between €0 and €1000.');
      return;
    }
    setFeeError(null);
    setFee.mutate(
      { id: o.id, deliveryFee: Math.round(value * 100) / 100 },
      {
        onSuccess: () => {
          setEditingFee(false);
          toast.success('Delivery fee updated');
        },
        // Stay open on failure: the three server refusals (window, issued
        // invoice, split purchase) are all things worth reading next to the
        // number you were trying to change.
        onError: (err) => setFeeError(errorMessage(err)),
      },
    );
  }

  function submitCancel() {
    const reason = cancelReason.trim();
    // Reason is required + min 5 chars — same gate the API enforces. Blocking
    // client-side saves a round-trip and shows the constraint next to the
    // input rather than as a generic 422.
    if (reason.length < 5) {
      setCancelReasonError('Give at least a short reason (≥5 chars) — the customer will see this.');
      return;
    }
    if (!o.id) return;
    setCancelReasonError(null);
    cancelOrder.mutate(
      { id: o.id, reason },
      {
        onSuccess: () => {
          setCancelOpen(false);
          setCancelReason('');
        },
      },
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/partner/orders')}
            className="p-2 rounded-lg hover:bg-surface-linen text-muted hover:text-ink transition-colors"
            aria-label="Back to orders"
          >
            <ArrowLeft size={20} strokeWidth={1.75} />
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-display text-ink">
              Order <span className="font-mono">{o.order_number}</span>
            </h1>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_BADGE_CLASS[o.status]}`}>
              {STATUS_LABELS[o.status]}
            </span>
          </div>
        </div>
        <button
          onClick={handleDownloadInvoice}
          disabled={downloadingInvoice}
          className="h-10 px-4 rounded-xl text-sm font-semibold border-2 border-border text-ink hover:border-brand hover:bg-brand-mist/40 transition-colors inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait"
        >
          {downloadingInvoice
            ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />
            : <FileDown size={16} strokeWidth={1.75} />}
          {downloadingInvoice ? t('orders.generatingInvoice') : t('orders.downloadInvoice')}
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left column — items + summary */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold font-display text-ink">Order items</h2>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="h-9 px-3.5 rounded-lg text-xs font-semibold border-2 border-border text-ink hover:border-brand hover:bg-brand-mist/40 transition-colors inline-flex items-center gap-1.5"
                >
                  <Pencil size={14} strokeWidth={1.75} />
                  {t('orders.editOrder.button')}
                </button>
              )}
            </div>
            {/* Mobile: line items as rows rather than a 600px table. Qty and
                line total are what get checked against a physical pick, so
                they stay on one line with the name. */}
            <div className="md:hidden divide-y divide-border">
              {(o.items ?? []).map((item: any) => (
                <div key={item.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  {item.product_snapshot?.image_url && (
                    <img
                      src={resolveImageUrl(item.product_snapshot.image_url, 'thumb') ?? ''}
                      alt={item.product_snapshot.name_es}
                      className="w-12 h-12 rounded-lg object-cover bg-surface-linen shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13.5px] text-ink leading-snug min-w-0">
                        {item.product_snapshot?.name_es}
                      </p>
                      <span className="text-[13.5px] font-semibold text-ink shrink-0 whitespace-nowrap">
                        {formatCurrency(Number(item.line_total))}
                      </span>
                    </div>
                    <p className="text-[12px] text-gray mt-0.5">
                      {item.product_snapshot?.variant_name_es}
                      {item.product_snapshot?.variant_name_es && ' · '}
                      {item.quantity} × {formatCurrency(Number(item.unit_price))}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="bg-surface-cream">
                    {['Product', 'Variant', 'Qty', 'Unit', 'Total'].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray uppercase tracking-wider first:rounded-tl-lg last:rounded-tr-lg">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(o.items ?? []).map((item: any) => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          {item.product_snapshot?.image_url && (
                            <img
                              src={resolveImageUrl(item.product_snapshot.image_url, 'thumb') ?? ''}
                              alt={item.product_snapshot.name_es}
                              className="w-12 h-12 rounded-lg object-cover bg-surface-linen shrink-0"
                            />
                          )}
                          <span className="text-sm text-ink">{item.product_snapshot?.name_es}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray">{item.product_snapshot?.variant_name_es}</td>
                      <td className="px-3 py-3 text-sm text-ink text-center">{item.quantity}</td>
                      <td className="px-3 py-3 text-sm text-gray whitespace-nowrap">{formatCurrency(Number(item.unit_price))}</td>
                      <td className="px-3 py-3 text-sm font-semibold text-ink whitespace-nowrap">{formatCurrency(Number(item.line_total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Why the Edit controls are gone. A partner cannot issue or correct
              an invoice themselves, so the honest next step is to contact us
              — saying that here beats leaving them to guess. */}
          {lockedBy && (
            <div className="rounded-xl border border-brand/30 bg-brand-mist/40 px-4 py-3 flex items-start gap-2.5">
              <Lock size={16} strokeWidth={1.75} className="text-brand shrink-0 mt-0.5" />
              <div className="min-w-0 text-sm">
                <p className="font-semibold font-display text-ink">This order is closed by an invoice</p>
                <p className="text-gray font-body mt-0.5">
                  Items and the delivery fee are fixed, because invoice{' '}
                  <span className="font-mono text-ink">{lockedBy.invoice_number ?? '—'}</span>{' '}
                  states these totals and cannot be altered. Contact us if something needs correcting.
                </p>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-border p-5">
            <h2 className="text-base font-bold font-display text-ink mb-4">Order summary</h2>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray">Subtotal</span>
                <span className="text-ink">{formatCurrency(Number(o.subtotal))}</span>
              </div>
              <div className="flex justify-between text-sm items-center min-h-[32px]">
                <span className="text-gray">Delivery fee</span>
                {editingFee ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-muted">€</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      max="1000"
                      value={feeDraft}
                      autoFocus
                      onChange={(e) => { setFeeDraft(e.target.value); setFeeError(null); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); submitFee(); }
                        if (e.key === 'Escape') { setEditingFee(false); setFeeError(null); }
                      }}
                      className="w-20 h-8 px-2 rounded-lg border border-border bg-white text-sm text-ink text-right font-mono focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                    />
                    <button
                      type="button"
                      onClick={submitFee}
                      disabled={setFee.isPending}
                      className="h-8 px-2.5 rounded-lg bg-brand text-white text-xs font-semibold disabled:opacity-60"
                    >
                      {setFee.isPending ? '…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingFee(false); setFeeError(null); }}
                      className="h-8 px-2.5 rounded-lg border border-border text-xs font-semibold text-gray"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-ink">
                      {/* Never "Free": a zero is a fee nobody has set yet. */}
                      {deliveryFeeIsPending(o) ? 'Added by Cesto shortly' : formatCurrency(Number(o.delivery_fee))}
                    </span>
                    {canEditFee && (
                      <button
                        type="button"
                        onClick={() => {
                          setFeeDraft(Number(o.delivery_fee).toFixed(2));
                          setFeeError(null);
                          setEditingFee(true);
                        }}
                        className="text-xs font-semibold text-brand hover:underline"
                      >
                        Edit
                      </button>
                    )}
                  </span>
                )}
              </div>
              {feeError && (
                <p className="text-xs text-danger font-body text-right">{feeError}</p>
              )}
              {/* Recargo de equivalencia (2026-11-04): charged on top of IVA
                  to a customer under the regime — part of the total. */}
              {Number(o.recargo ?? 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray">Recargo de equivalencia</span>
                  <span className="text-ink">{formatCurrency(Number(o.recargo))}</span>
                </div>
              )}
              <div className="border-t border-border pt-2 flex justify-between">
                <span className="text-lg font-bold font-display text-ink">Total</span>
                <span className="text-lg font-bold font-display text-ink">{formatCurrency(Number(o.total))}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right column — status + rider + customer */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <Truck size={18} strokeWidth={1.75} className="text-brand" />
              <h2 className="text-base font-bold font-display text-ink">Status</h2>
            </div>
            <div className="mb-3">
              <p className="text-xs text-gray uppercase tracking-wider mb-1">Current status</p>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_BADGE_CLASS[o.status]}`}>
                {STATUS_LABELS[o.status]}
              </span>
            </div>
            {nextStatus ? (
              <>
                <div className="mb-3">
                  <label className="text-xs text-gray uppercase tracking-wider mb-1 block">Advance to</label>
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value as PartnerOrderStatusTarget)}
                    className="w-full h-10 bg-surface-cream border border-border rounded-lg px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                  >
                    <option value="">Select next status</option>
                    <option value={nextStatus}>{STATUS_LABELS[nextStatus]}</option>
                  </select>
                </div>
                <button
                  onClick={submitStatus}
                  disabled={!selectedStatus || updateStatus.isPending}
                  className="w-full h-[52px] rounded-xl text-sm font-semibold text-white bg-brand hover:bg-brand-mid transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  <CheckCircle size={16} strokeWidth={1.75} />
                  {updateStatus.isPending ? 'Updating…' : 'Update status'}
                </button>
                {updateStatus.isError && (
                  <p role="alert" className="mt-2 text-xs font-body text-danger">
                    {errorMessage(updateStatus.error)}
                  </p>
                )}
                {/* Cancel is a secondary action next to the primary advance-
                    status flow — kept out of the dropdown so it doesn't get
                    picked accidentally. Only shown while the order is still
                    at the store (pending/confirmed/preparing). on_the_way
                    is out-of-scope: rider has it, cancellation from that
                    point is a support ticket. */}
                {canCancel && (
                  <button
                    type="button"
                    onClick={() => setCancelOpen(true)}
                    className="mt-3 w-full h-11 rounded-xl text-sm font-semibold border-2 border-danger/40 text-danger bg-white hover:bg-danger-bg/40 transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <XCircle size={16} strokeWidth={2} />
                    Cancel order
                  </button>
                )}
              </>
            ) : o.status === 'draft' ? (
              <div>
                <p className="text-sm font-body text-ink/80 mb-3">
                  This order has items that were out of stock at checkout. Confirm it once they're restocked.
                </p>
                <button
                  onClick={() => confirmStock.mutate(o.id)}
                  disabled={confirmStock.isPending}
                  className="w-full h-[52px] rounded-xl text-sm font-semibold text-white bg-brand hover:bg-brand-mid transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  <CheckCircle size={16} strokeWidth={1.75} />
                  {confirmStock.isPending ? 'Confirming…' : 'Confirm stock'}
                </button>
                {confirmStock.isError && (
                  <p role="alert" className="mt-2 text-xs font-body text-danger">
                    {errorMessage(confirmStock.error)}
                  </p>
                )}
                {canCancel && (
                  <button
                    type="button"
                    onClick={() => setCancelOpen(true)}
                    className="mt-3 w-full h-11 rounded-xl text-sm font-semibold border-2 border-danger/40 text-danger bg-white hover:bg-danger-bg/40 transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <XCircle size={16} strokeWidth={2} />
                    Cancel order
                  </button>
                )}
              </div>
            ) : o.status === 'delivered' ? (
              <p className="text-sm font-body text-success">Delivered — nothing more to do.</p>
            ) : o.status === 'cancelled' ? (
              <div>
                <p className="text-sm font-body text-danger">Cancelled.</p>
                {o.cancelled_reason && (
                  <p className="text-xs font-body text-gray mt-1">Reason: {o.cancelled_reason}</p>
                )}
              </div>
            ) : null}
          </div>

          {/* Rider assign — only pre-dispatch */}
          {o.status !== 'delivered' && o.status !== 'cancelled' && (
            <div className="bg-white rounded-xl border border-border p-5">
              <div className="flex items-center gap-2 mb-4">
                <Truck size={18} strokeWidth={1.75} className="text-brand" />
                <h2 className="text-base font-bold font-display text-ink">Rider</h2>
              </div>
              {o.rider && (
                <div className="mb-3 p-3 rounded-lg bg-surface-cream">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold text-sm">
                      {o.rider.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink leading-tight">{o.rider.name}</p>
                      <p className="text-xs font-mono text-ink/60 leading-tight mt-0.5">{o.rider.phone}</p>
                    </div>
                  </div>
                </div>
              )}
              <label className="text-xs text-gray uppercase tracking-wider mb-1 block">
                {o.rider ? 'Change rider' : 'Assign rider'}
              </label>
              <select
                value={o.rider?.id ?? ''}
                onChange={(e) => assignRider.mutate({ id: o.id, riderId: e.target.value || null })}
                disabled={assignRider.isPending}
                className="w-full h-10 bg-surface-cream border border-border rounded-lg px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-50"
              >
                <option value="">— Unassigned —</option>
                {riders.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              {assignRider.isError && (
                <p role="alert" className="mt-2 text-xs font-body text-danger">
                  {errorMessage(assignRider.error)}
                </p>
              )}
              {riders.length === 0 && (
                <p className="mt-2 text-xs text-muted font-body">
                  No active riders yet — add one on <a href="/partner/riders" className="text-brand underline">Riders</a>.
                </p>
              )}
            </div>
          )}

          {/* Customer */}
          <div className="bg-white rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <Phone size={18} strokeWidth={1.75} className="text-brand" />
              <h2 className="text-base font-bold font-display text-ink">Customer</h2>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray uppercase tracking-wider mb-0.5">Name</p>
                <p className="text-sm text-ink">{o.user?.name ?? o.address_snapshot?.contact_name ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray uppercase tracking-wider mb-0.5">Phone</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm text-ink">{o.address_snapshot?.contact_phone ?? o.user?.phone ?? '—'}</p>
                  {phoneClean && (
                    <a
                      href={`https://wa.me/${phoneClean.replace('+', '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-brand hover:text-brand-mid"
                    >
                      WhatsApp
                    </a>
                  )}
                </div>
              </div>
              {o.address_snapshot && (
                <div>
                  <p className="text-xs text-gray uppercase tracking-wider mb-0.5">Delivery address</p>
                  <div className="flex items-start gap-2">
                    <MapPin size={14} strokeWidth={1.75} className="text-muted mt-0.5 shrink-0" />
                    <p className="text-sm font-body text-ink leading-relaxed">
                      {o.address_snapshot?.street_line_1}
                      {o.address_snapshot?.street_line_2 && (<>, {o.address_snapshot.street_line_2}</>)}
                      <br />
                      {o.address_snapshot?.postcode} {o.address_snapshot?.city}, {o.address_snapshot?.province}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* A "Time slot" card stood here, reading from a `delivery_slot`
              relation that no longer exists on the order — so it printed the
              ASAP fallback on every order ever opened. Removed with its
              counterparts on the admin and customer order pages. */}

          {/* Customer notes */}
          {o.customer_notes && (
            <div className="bg-white rounded-xl border border-border p-5">
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare size={18} strokeWidth={1.75} className="text-brand" />
                <h2 className="text-base font-bold font-display text-ink">Customer notes</h2>
              </div>
              <p className="text-sm font-body text-ink bg-surface-cream rounded-lg p-3">
                {o.customer_notes}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Cancel modal — reason is required. Rendered outside the columns so
          it overlays the whole page rather than a sidebar column. Backdrop
          click + Cancel button both dismiss without firing the mutation. */}
      {cancelOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => { if (!cancelOrder.isPending) setCancelOpen(false); }}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-danger-bg text-danger flex items-center justify-center shrink-0">
                <XCircle size={20} strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold font-display text-ink leading-tight">Cancel this order?</h3>
                <p className="text-xs font-body text-muted mt-1 leading-snug">
                  {o.status === 'draft'
                    ? "Nothing will be restocked — none of this draft order's items were ever reserved. The customer will be notified. This can't be undone."
                    : "Items will be restocked and the customer will be notified. This can't be undone."}
                </p>
              </div>
            </div>
            <label className="text-xs font-semibold text-ink uppercase tracking-wider mb-1 block">
              Reason <span className="text-danger normal-case">*</span>
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => { setCancelReason(e.target.value); if (cancelReasonError) setCancelReasonError(null); }}
              placeholder="Why is this order being cancelled? (e.g. 'Out of stock', 'Store closing early')"
              rows={4}
              autoFocus
              className={`w-full rounded-lg border p-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-danger/30 resize-none ${
                cancelReasonError ? 'border-danger' : 'border-border bg-surface-cream'
              }`}
            />
            {cancelReasonError && (
              <p role="alert" className="mt-1 text-xs text-danger font-body">{cancelReasonError}</p>
            )}
            {cancelOrder.isError && (
              <p role="alert" className="mt-2 text-xs text-danger font-body">
                {errorMessage(cancelOrder.error)}
              </p>
            )}
            <div className="flex items-center gap-2 mt-5">
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                disabled={cancelOrder.isPending}
                className="flex-1 h-11 rounded-xl text-sm font-semibold border border-border text-ink hover:bg-surface-cream disabled:opacity-50"
              >
                Keep order
              </button>
              <button
                type="button"
                onClick={submitCancel}
                disabled={cancelOrder.isPending}
                className="flex-1 h-11 rounded-xl text-sm font-semibold text-white bg-danger hover:bg-danger/90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                <XCircle size={16} strokeWidth={2} />
                {cancelOrder.isPending ? 'Cancelling…' : 'Cancel order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editOpen && (
        <EditOrderModal order={o as any} onClose={() => setEditOpen(false)} />
      )}
    </div>
  );
}
