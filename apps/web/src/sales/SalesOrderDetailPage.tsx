import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  MapPin,
  MessageSquare,
  Truck,
  XCircle,
  CheckCircle,
  Save,
  GitBranch,
  Store as StoreIcon,
  ChevronRight,
  Loader2,
  Pencil,
  Lock,
  ImageOff, MoreVertical, Package as PackageIcon,
  FileText, Download, AlertTriangle, Receipt, ReceiptText, UserRound,
} from 'lucide-react';
import { useGoBack } from './lib/useGoBack';
import { downloadBill, downloadFactura, downloadPdfFile, facturaPdfFile } from '@grocery-app/shared/invoice';
import {
  useSalesOrder,
  useCancelSalesOrder,
  useConfirmSalesOrderStock,
  useSetSalesOrderDeliveryFee,
  useSetSalesOrderNotes,
  useDraftSalesInvoice,
  useIssueSalesInvoice,
  salesInvoices,
  salesOrders,
  resolveImageUrl,
  lockingInvoiceOf,
  deliveryFeeIsPending,
  newProgressKey,
  staffCanEditOrder,
} from '@grocery-app/shared';
import type { OrderStatus, IssuedInvoiceRef, EditOrderNewOrder, Invoice, InvoiceBlocker } from '@grocery-app/shared';
import SalesStatusBadge, { statusConfig } from './components/SalesStatusBadge';
import BackLink from './components/BackLink';
import ConfirmModal from './components/ConfirmModal';
import { useToast } from './components/Toast';
import { SectionTitle } from './components/ui';
import OrderEarningCard from './components/OrderEarningCard';
import { usePortT } from './lib/portT';
import OrderProgressPanel from '@/components/OrderProgressPanel';
import { useLanguageStore } from '@/stores/languageStore';
import { FACTURA_LABELS } from './lib/facturaLabels';
import { billLabels } from './lib/billLabels';



function formatCurrency(amount: number): string {
  return amount.toFixed(2).replace('.', ',') + ' €';
}

/**
 * The lines of an order, as a list on a phone and a table on a screen.
 *
 * It was a five-column table at a 520–600px minimum width, which on any
 * phone meant a horizontal scrollbar — and the columns that scrolled out of
 * reach were quantity, unit price and line total, which is the whole reason
 * anyone opens this. The product column, already the widest, was the one that
 * stayed.
 *
 * So below sm the same rows read downward instead: image, what it is, and
 * `qty × unit` with the line total set against it on the right. Nothing is
 * dropped and nothing scrolls.
 *
 * Lives here because the page drew this twice — once for a standalone order
 * and once per part of a split purchase — from two copies of the markup that
 * had already drifted apart in padding and image size.
 */
function OrderItems({ items }: { items: any[] }) {
  const t = usePortT();

  return (
    <>
      <ul className="sm:hidden divide-y divide-border">
        {items.map((item: any) => (
          <li key={item.id} className="flex gap-3 px-4 py-3">
            <span className="w-11 h-11 rounded-lg bg-surface-linen border border-border shrink-0 overflow-hidden flex items-center justify-center">
              {item.product_snapshot?.image_url
                ? <img src={resolveImageUrl(item.product_snapshot.image_url, 'thumb')} alt="" className="w-full h-full object-cover" />
                : <ImageOff size={15} strokeWidth={1.75} className="text-muted" />}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink leading-snug line-clamp-2">
                {item.product_snapshot?.name_es}
              </p>
              {item.product_snapshot?.variant_name_es && (
                <p className="text-[11.5px] text-muted truncate mt-0.5">
                  {item.product_snapshot.variant_name_es}
                </p>
              )}
              <p className="text-[12px] text-gray tabular-nums mt-1">
                {item.quantity} {'\u00d7'} {formatCurrency(Number(item.unit_price))}
              </p>
              {Number(item.discount_amount ?? 0) > 0 && (
                <p className="text-[11.5px] text-success tabular-nums">
                  {t('orderDetail.table.discount', 'Discount')}{' \u2212'}
                  {formatCurrency(Number(item.discount_amount))}
                  {/* Agreed per unit since 2026-10-25. */}
                  {Number(item.unit_discount ?? 0) > 0 && (
                    <span className="text-muted">{' ('}{t('orderDetail.table.perUnit', '{{amount}} each', { amount: formatCurrency(Number(item.unit_discount)) })}{')'}</span>
                  )}
                </p>
              )}
            </div>

            <span className="text-sm font-semibold text-ink tabular-nums shrink-0">
              {formatCurrency(Number(item.line_total))}
            </span>
          </li>
        ))}
      </ul>

      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-cream">
              {[
                t('orderDetail.table.product'),
                t('orderDetail.table.variant'),
                t('orderDetail.table.qty'),
                t('orderDetail.table.unitPrice'),
                t('orderDetail.table.discount', 'Discount'),
                t('orderDetail.table.total'),
              ].map((header) => (
                <th key={header} className="px-3 py-2.5 text-left text-[12.5px] font-medium font-display text-muted">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item: any) => (
              <tr key={item.id} className="border-t border-border">
                <td className="px-3 py-3">
                  <div className="flex items-center gap-3">
                    {item.product_snapshot?.image_url && (
                      <img
                        src={resolveImageUrl(item.product_snapshot.image_url, 'thumb')}
                        alt={item.product_snapshot.name_es}
                        className="w-12 h-12 rounded-lg object-cover bg-surface-linen flex-shrink-0"
                      />
                    )}
                    <span className="text-sm font-display font-medium text-ink">{item.product_snapshot?.name_es}</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-sm font-display text-gray">{item.product_snapshot?.variant_name_es}</td>
                <td className="px-3 py-3 text-sm font-display text-ink text-center">{item.quantity}</td>
                <td className="px-3 py-3 text-sm font-display text-gray whitespace-nowrap">{formatCurrency(Number(item.unit_price))}</td>
                <td className="px-3 py-3 text-sm font-display whitespace-nowrap tabular-nums">
                  {Number(item.discount_amount ?? 0) > 0
                    ? (
                      <span className="text-success">
                        {'\u2212'}{formatCurrency(Number(item.discount_amount))}
                        {Number(item.unit_discount ?? 0) > 0 && (
                          <span className="block text-[11px] text-muted">{t('orderDetail.table.perUnit', '{{amount}} each', { amount: formatCurrency(Number(item.unit_discount)) })}</span>
                        )}
                      </span>
                    )
                    : <span className="text-muted/60">{'\u2014'}</span>}
                </td>
                <td className="px-3 py-3 text-sm font-display font-semibold text-ink whitespace-nowrap">{formatCurrency(Number(item.line_total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}



/**
 * One order a rep built — admin's OrderDetailPage, ported.
 *
 * Same cards, same split-purchase handling, same items table and summary.
 * What is missing is what ops owns, and it is missing because the ENDPOINT is:
 * there is no status march, no rider picker, no delete and no invoice issuing
 * under /api/sales/*, so the controls are absent rather than present and
 * failing. The rider still SHOWS — a rep asked "where is my order" needs the
 * answer; they just do not set it.
 *
 * THE DOCUMENTS ARE THE ALBARÁN AND THE BILL. A factura is the office's alone
 * (2026-11-07): the API sends none, and all this page says about one is why the
 * order can no longer change.
 *
 * What stays is their own work: edit the basket, cancel, confirm a parked
 * draft's stock, the delivery fee, and the client's note.
 */
export default function SalesOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  // Back pops the history entry when there is one, so opening an order from
  // a customer's page returns there rather than to the orders list. The
  // argument is only the cold-start fallback.
  const goBack = useGoBack();
  const t = usePortT();


  const toast = useToast();

  // Delivery fee, edited in place on the summary.
  const setFee = useSetSalesOrderDeliveryFee();
  const [editingFee, setEditingFee] = useState(false);
  const [feeDraft, setFeeDraft] = useState('');
  const feeNumber = Number(feeDraft.replace(',', '.'));
  const feeValid = feeDraft.trim() !== '' && Number.isFinite(feeNumber) && feeNumber >= 0;

  const saveFee = () => {
    if (!feeValid || !orderId) return;
    setFee.mutate({ id: orderId, deliveryFee: feeNumber }, {
      onSuccess: () => {
        setEditingFee(false);
        toast.success(t('orderDetail.feeUpdated', 'Delivery fee updated'));
      },
      // The server refuses once an invoice is issued, on a sub-order of a
      // split purchase, and outside the editable window — each with its own
      // reason, so show it rather than a generic failure.
      onError: (err) => toast.error(
        t('orderDetail.feeFailed', 'Could not change the delivery fee'),
        err instanceof Error ? err.message : String(err),
      ),
    });
  };
  const { data: order, isLoading, error: orderError, refetch } = useSalesOrder(orderId);
  const updateNotes = useSetSalesOrderNotes();
  const draftInvoice = useDraftSalesInvoice();
  const issueInvoice = useIssueSalesInvoice();
  const confirmDraftStock = useConfirmSalesOrderStock();
  const cancelOrder = useCancelSalesOrder();
  /**
   * Parts a cross-shop edit just spun off beside this order.
   *
   * Arrives in the navigation state, because editing now happens on its own
   * screen and this page is where it lands afterwards. Read ONCE into state
   * rather than off `location` every render, so dismissing it sticks.
   *
   * Held until dismissed rather than flashed as a toast. It is a thing that
   * happened to the order in front of the rep, and there is somewhere to go
   * about it, so it has to survive long enough to be read and followed.
   */
  /**
   * Why the last albarán attempt was refused, kept on screen.
   *
   * A toast is the wrong container for this: the answer is a list of things to
   * change on screens the rep may not even have — company tax details, a
   * product's IVA rate — and it faded while they were still reading the first
   * one. It sits under the header until an attempt succeeds.
   */
  const [docBlockers, setDocBlockers] = useState<InvoiceBlocker[]>([]);
  /**
   * Which button is working, so only that one spins.
   *
   * `'albaran'` for making one, or the id of the document being downloaded —
   * there is a download per issued document, and a literal union could not
   * name them. Comparing that union to an id typechecked and never matched,
   * so the spinner silently belonged to no button at all.
   */
  const [docBusy, setDocBusy] = useState<string | null>(null);

  const [spunOff, setSpunOff] = useState<EditOrderNewOrder[]>(
    () => (location.state as { spunOff?: EditOrderNewOrder[] } | null)?.spunOff ?? [],
  );


  const [adminNotes, setAdminNotes] = useState<string>('');
  // HOOKS LIVE ABOVE THE EARLY RETURNS. This component returns early three
  // times — loading, error, and the split-purchase shape — so a useState
  // declared below them runs on some renders and not others. The first paint
  // is always the loading branch, so putting these after it meant the hook
  // count GREW the moment the order arrived, and React threw "rendered more
  // hooks than during the previous render" on every single order page.
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!actionsOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!actionsRef.current) return;
      if (!actionsRef.current.contains(e.target as Node)) setActionsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setActionsOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [actionsOpen]);

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const lang = useLanguageStore((s) => s.lang);
  /** Names the cancel so the progress panel can follow it on the server. */
  const [cancelKey, setCancelKey] = useState<string | null>(null);
  /** That panel is up, so the confirm box under it steps aside. */
  const [cancelPanelUp, setCancelPanelUp] = useState(false);
  // Reason for admin-initiated cancel. Kept optional (admin often has
  // context out-of-band and doesn't need to write it here) but strongly
  // encouraged by the modal copy — the customer email surfaces this text.
  const [cancelReason, setCancelReason] = useState<string>('');

  useEffect(() => {
    if (order) setAdminNotes((order as any).admin_notes ?? '');
  }, [order]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted font-display text-sm">{t('orderDetail.loading')}</p>
      </div>
    );
  }

  // A failed request used to fall into the branch above and render "Loading
  // order…" forever, because an errored react-query has isLoading false and
  // data undefined. That hid a 500 completely — the page looked busy rather
  // than broken, which is the worst of both. Anything that is not a
  // successful load now says so, and offers a way out.
  if (orderError || !order) {
    const message = orderError instanceof Error ? orderError.message : null;
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-center px-6">
        <XCircle size={32} strokeWidth={1.75} className="text-danger" />
        <p className="text-ink font-display font-semibold">
          {orderError ? "Couldn't load this order" : 'Order not found'}
        </p>
        {message && (
          <p className="text-xs text-muted font-body max-w-md break-words">{message}</p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            onClick={() => refetch()}
            className="h-10 px-4 rounded-lg bg-ink text-card text-sm font-display font-semibold hover:bg-ink/90 transition-colors"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => goBack('/sales/orders')}
            className="h-10 px-4 rounded-lg border border-border bg-card text-sm font-display font-semibold text-ink hover:bg-surface-cream transition-colors"
          >
            Back to orders
          </button>
        </div>
      </div>
    );
  }

  // MV Slice 4 — GET /api/admin/orders/:id auto-detects parent vs Order and
  // returns either shape. Presence of `sub_orders` on the response is the
  // reliable disambiguator (Order shape never has it). Render a lightweight
  // parent summary instead of the Order editor so admins clicking the
  // "part of #P" chip in the list don't hit a crash / half-rendered page.
  const parentShape = order as unknown as {
    id: string;
    order_number: string;
    invoices?: IssuedInvoiceRef[] | null;
    subtotal: number | string;
    delivery_fee_total: number | string;
    /** Recargo de equivalencia on the whole purchase (2026-11-04). */
    recargo?: number | string;
    total: number | string;
    created_at: string;
    payment_method: string;
    customer_notes: string | null;
    /** Derived from the parts by the API — a ParentOrder has no status column. */
    derived_status?: OrderStatus;
    user?: { name: string; email: string | null; phone: string | null };
    address?: any;
    address_snapshot?: any;
    sub_orders?: Array<{
      id: string;
      order_number: string;
      status: OrderStatus;
      subtotal: number | string;
      delivery_fee: number | string;
      total: number | string;
      rider?: { id: string; name: string } | null;
      store?: { id: string; slug: string; name: string; logo_url?: string | null } | null;
      items?: Array<any>;
      _count?: { items: number };
    }>;
  };
  if (parentShape.sub_orders) {
    // One purchase that the database had to store as several Orders — split
    // by store, and also by availability, since an out-of-stock item goes to
    // its own `draft` part even when the cart never left one shop.
    //
    // This used to be a list of links: the admin landed here from the orders
    // list and still had to open each part to find out what was in it. The
    // parts are shown with their contents instead, because from the
    // customer's side this was one order and answering "what did they buy?"
    // shouldn't cost three page loads.
    const parts = parentShape.sub_orders;

    const address = parentShape.address_snapshot ?? parentShape.address;
    return (
      <div>
        {/* Same card as a single order's, so landing on a split purchase does
            not look like landing in a different product.

            THE DOCUMENTS LIVE HERE, not on the parts. A split purchase is one
            basket that happened to come from several shops, so it gets one
            albarán and one factura covering all of it — see
            Invoice.parent_order_id. */}
        <BackLink
          label={t('common.backToOrders', 'Back to orders')}
          onClick={() => goBack('/sales/orders')}
          className="mb-3"
        />

        <header className="bg-card rounded-2xl border border-border shadow-card mb-3 md:mb-3.5 2xl:mb-4">
          <div className="p-4 sm:p-5 flex items-start gap-3.5 sm:gap-4">
            <div
              className={`w-[52px] h-[52px] sm:w-16 sm:h-16 rounded-2xl shrink-0 flex items-center justify-center ${
                parentShape.derived_status
                  ? `${statusConfig[parentShape.derived_status].bg} ${statusConfig[parentShape.derived_status].text}`
                  : 'bg-surface-linen text-muted'
              }`}
              aria-hidden="true"
            >
              <GitBranch className="w-6 h-6 sm:w-7 sm:h-7" strokeWidth={1.75} />
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[21px] sm:text-[27px] leading-[1.15] font-bold tracking-[-0.02em] text-ink">
                <span className="font-mono">{parentShape.order_number}</span>
              </h1>
              <p className="text-[13px] text-gray mt-1.5 truncate">
                {parentShape.user?.name ?? '—'}
              </p>

              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                {parentShape.derived_status && <SalesStatusBadge status={parentShape.derived_status} />}
                <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-semibold font-display bg-brand-mist text-brand">
                  <GitBranch size={12} strokeWidth={2} />
                  {t('orderDetail.partsBadge', { count: parts.length })}
                </span>
              </div>
            </div>

          </div>

          <p className="px-4 sm:px-5 py-3 border-t border-border bg-surface-cream/50 rounded-b-xl text-[13px] text-gray">
            {t('orderDetail.partsExplainer')}
          </p>
        </header>

        <div className="grid lg:grid-cols-3 gap-3 md:gap-3.5 2xl:gap-4">
          <div className="lg:col-span-2 space-y-3 md:space-y-3.5 2xl:space-y-4">
            {parts.map((sub) => (
              <div key={sub.id} className="bg-card rounded-2xl border border-border shadow-card overflow-hidden">
                <div className="flex items-center gap-3 p-4 border-b border-border bg-surface-cream/50">
                  <div className="w-10 h-10 rounded-xl bg-surface-cream border border-border overflow-hidden flex items-center justify-center shrink-0">
                    {sub.store?.logo_url
                      ? <img src={resolveImageUrl(sub.store.logo_url, 'thumb')} alt="" className="w-full h-full object-cover" />
                      : <StoreIcon size={16} strokeWidth={1.75} className="text-ink/60" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* store === null is the Cesto house store, per Product.store_id. */}
                    <p className="text-sm font-semibold font-display text-ink truncate">{sub.store?.name ?? 'Cesto'}</p>
                    <p className="text-xs font-mono text-muted truncate">{sub.order_number}</p>
                  </div>
                  {sub.rider && (
                    <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-display text-ink/70">
                      <Truck size={13} strokeWidth={1.75} className="text-brand" />
                      {sub.rider.name}
                    </span>
                  )}
                  <SalesStatusBadge status={sub.status} />
                  <button
                    onClick={() => navigate(`/sales/orders/${sub.id}`)}
                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold font-display text-brand hover:bg-brand-mist transition-colors shrink-0"
                    title={t('orderDetail.openPart')}
                  >
                    {t('orderDetail.openPart')}
                    <ChevronRight size={14} strokeWidth={2} />
                  </button>
                </div>

                <OrderItems items={sub.items ?? []} />

                <div className="flex justify-end gap-6 px-4 py-2.5 border-t border-border text-sm font-display">
                  <span className="text-muted">
                    {t('orderDetail.subtotal')} <span className="text-ink font-mono ml-1">{formatCurrency(Number(sub.subtotal))}</span>
                  </span>
                  <span className="text-ink font-semibold">
                    {t('orderDetail.total')} <span className="font-mono ml-1">{formatCurrency(Number(sub.total))}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>

          <aside className="space-y-3 md:space-y-3.5 2xl:space-y-4">
            <div className="bg-card rounded-2xl border border-border shadow-card p-5">
              <SectionTitle title={t('orderDetail.customer')} icon={UserRound} />
              <p className="text-sm font-display text-ink">{parentShape.user?.name ?? '—'}</p>
              {parentShape.user?.phone && <p className="text-xs font-display text-muted mt-0.5">{parentShape.user.phone}</p>}
              {parentShape.user?.email && <p className="text-xs font-display text-muted mt-0.5 truncate">{parentShape.user.email}</p>}
            </div>

            {address && (
              <div className="bg-card rounded-2xl border border-border shadow-card p-5">
                <SectionTitle title={t('orderDetail.deliveryAddress')} icon={MapPin} />
                <div className="flex items-start gap-2">
                  <MapPin size={14} strokeWidth={1.75} className="text-muted mt-0.5 flex-shrink-0" />
                  <p className="text-sm font-body text-ink leading-relaxed">
                    {address.street_line_1}
                    {address.street_line_2 && (<>, {address.street_line_2}</>)}
                    <br />
                    {address.postcode} {address.city}, {address.province}
                  </p>
                </div>
              </div>
            )}

            {parentShape.customer_notes && (
              <div className="bg-card rounded-2xl border border-border shadow-card p-5">
                <SectionTitle title={t('orderDetail.customerNotes')} icon={MessageSquare} />
                <p className="text-sm font-body text-ink leading-relaxed">{parentShape.customer_notes}</p>
              </div>
            )}

            <div className="bg-card rounded-2xl border border-border shadow-card p-5">
              <SectionTitle title={t('orderDetail.orderSummary')} icon={Receipt} />
              <dl className="space-y-1.5 text-sm font-display">
                <div className="flex justify-between"><dt className="text-muted">{t('orderDetail.subtotal')}</dt><dd className="text-ink font-mono">{formatCurrency(Number(parentShape.subtotal))}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">{t('orderDetail.deliveryFee')}</dt><dd className="text-ink font-mono">{formatCurrency(Number(parentShape.delivery_fee_total))}</dd></div>
                {Number(parentShape.recargo ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted">{t('orderDetail.recargo', 'Recargo de equivalencia')}</dt>
                    <dd className="text-ink font-mono">{formatCurrency(Number(parentShape.recargo))}</dd>
                  </div>
                )}
                <div className="flex justify-between font-semibold pt-2 border-t border-border"><dt className="text-ink">{t('orderDetail.total')}</dt><dd className="text-ink font-mono">{formatCurrency(Number(parentShape.total))}</dd></div>
              </dl>
              <p className="text-[12.5px] font-display text-muted mt-3">{t(`orderDetail.payment.${parentShape.payment_method}`, parentShape.payment_method)}</p>
            </div>

          </aside>
        </div>

      </div>
    );
  }

  const o = order as typeof order & {
    user?: { id: string; name: string; phone: string | null; email: string | null };
    address?: any;
    rider?: { id: string; name: string; phone: string; vehicle_type: string } | null;
    items: Array<any>;
    address_snapshot?: any;
    subtotal: number;
    delivery_fee: number;
    total: number;
    cancelled_reason?: string | null;
    customer_notes?: string | null;
    admin_notes?: string | null;
  };

  /**
   * Where "back" goes from here.
   *
   * A sub-order is one part of a purchase the customer made, and paid for, as
   * a single order. The admin reaches it by opening that purchase and picking
   * a part, so back belongs on the combined view — dropping them at the orders
   * list means re-finding the purchase and re-expanding it to check the part
   * next to this one.
   */
  const parentId = (o as any).parent_order?.id ?? o.parent_order_id ?? null;
  // A rep-built order lives in the rashan list, not the customer one. Only the
  // cold-start fallback: goBack pops the real history when there is any, so
  // this is what gets used when the order was opened from a link.
  /**
   * Admin picks a BOOK here — a rep-built order belongs in the rashan list, a
   * customer's in the other. There is one list on this surface, because every
   * order a rep can open is one they built, so there is nothing to choose.
   *
   * Only the cold-start fallback either way: goBack pops real history when
   * there is any, and this is what gets used when the order was opened from a
   * link.
   */
  const backTarget = parentId ? `/sales/orders/${parentId}` : '/sales/orders';

  // The disc behind the order icon takes the status's own colours, so the
  // state is stated once and cannot drift from the badge beside it.
  // Summed from the lines rather than stored on the order: the discount is a
  // per-line fact, and a second column on Order would be a copy that can drift
  // from the lines that produced it.
  const totalDiscount = (o.items ?? []).reduce(
    (sum: number, it: any) => sum + Number(it.discount_amount ?? 0), 0,
  );

  const statusTint = statusConfig[o.status] ?? { bg: 'bg-surface-linen', text: 'text-muted' };


  /**
   * Narrower than admin's, and narrower on purpose.
   *
   * Admin is the ops backstop and may cancel through on_the_way, rider en
   * route. A rep may not: cancelling an order somebody is already carrying
   * does not stop them, so the server refuses it (422) and the screen should
   * not offer what the server will refuse.
   */
  const cancellableStatus = ['pending', 'confirmed', 'preparing', 'draft'].includes(o.status);
  // An issued factura is immutable and states this order's totals, so the
  // order behind it is frozen too — items AND delivery fee. The server
  // refuses either (editOrder + the fee route, both 409); this is so the
  // screen stops offering them. An albarán freezes nothing: it is a quote, and
  // the order behind one stays editable and can be quoted again.
  //
  // `factura_issued` is the API's yes or no. An API older than 2026-11-07 does
  // not send it and sends the factura instead, hence the fallback, while the
  // two deploy separately.
  const orderInvoices = o as { invoices?: IssuedInvoiceRef[] | null; factura_issued?: boolean };
  const facturaIssued = orderInvoices.factura_issued ?? !!lockingInvoiceOf(orderInvoices);
  // A factura outlives a cancellation until a credit note corrects it, and that
  // is the office's. The server refuses this too.
  const canCancel = cancellableStatus && !facturaIssued;
  /**
   * The albaranes already issued on this order, newest first.
   *
   * Drafts are left out on purpose: a draft has no number and is not a thing to
   * hand anybody. So is anything but an albarán, which the API has stopped
   * sending; this is for one that still does, while the two deploy separately.
   */
  const issuedDocs = (orderInvoices.invoices ?? []).filter((d) => d.status === 'issued' && d.kind === 'albaran');

  // Narrower than canCancel — editing items is only safe before the order
  // has left the store. A draft they built is editable too (2026-11-04): it
  // holds no stock, so the edit moves none. The admin screens' rule
  // (packages/shared orderEditing.ts).
  const canEdit = staffCanEditOrder(o) && !facturaIssued;
  const phoneClean = (o.address_snapshot?.contact_phone ?? o.user?.phone ?? '').replace(/\s+/g, '');


  const onConfirmCancel = () => {
    // Fall back to a generic marker if admin skipped the field — the API
    // stores this on cancelled_reason and the customer email renders it,
    // so leaving it blank would produce an empty "Reason: " line.
    const reason = cancelReason.trim() || 'Cancelled by the sales rep';
    const key = newProgressKey();
    setCancelKey(key);
    setCancelPanelUp(false);
    cancelOrder.mutate(
      { id: o.id, reason, progressKey: key },
      {
        onSuccess: () => { setShowCancelConfirm(false); setCancelReason(''); },
        // Modal stays open on failure so the rep can retry without re-typing.
      },
    );
  };


  const onSaveNotes = () => {
    updateNotes.mutate({ id: o.id, customerNotes: adminNotes });
  };

  /**
   * Make the albarán and hand it over, in one press.
   *
   * THREE STEPS, ONE BUTTON. Admin drafts, lands on the document's own page,
   * edits it if it needs editing, then issues — right for an office, wrong
   * for a counter. A rep wants the albarán in their hand, so drafting,
   * issuing and printing happen together and they are not asked anything.
   *
   * The refusal can come from either of the first two steps, which is why the
   * blockers are read off whichever failed rather than assumed to come from
   * the draft.
   */
  const makeAlbaran = async () => {
    setDocBlockers([]);
    setDocBusy('albaran');
    try {
      const drafted = await draftInvoice.mutateAsync({ id: o.id, kind: 'albaran' });
      const draft = (drafted as { invoice?: Invoice } | undefined)?.invoice;
      if (!draft) throw new Error('No document came back.');

      // Already issued? Then this is a reprint, not a second document: burning
      // an albarán number for a reprint would leave a gap nobody asked for.
      const issued = draft.status === 'issued'
        ? draft
        : ((await issueInvoice.mutateAsync({ id: draft.id })) as { invoice?: Invoice } | undefined)?.invoice;
      if (!issued) throw new Error('The document was not issued.');

      // One file: what the rep hands over is what the office's archive keeps. If
      // that fails it costs the rep nothing: the archive makes it on first opening.
      const file = await facturaPdfFile({ invoice: issued, labels: FACTURA_LABELS });
      downloadPdfFile(file);
      void salesInvoices.savePdf(issued.id, file).catch(() => undefined);
      toast.success(
        t('orderDetail.albaranReady', 'Albarán {{n}} issued', { n: issued.invoice_number ?? '' }),
        t('orderDetail.docDownloaded', 'The PDF has been downloaded.'),
      );
    } catch (err) {
      const rows = (err as { data?: { blockers?: InvoiceBlocker[] } })?.data?.blockers;
      // `albaran_ok` means "this one does not stop an albarán". The API has
      // stopped sending those; this is for one that still does, while the two
      // deploy separately.
      const stopping = (rows ?? []).filter((b) => !b.albaran_ok);
      if (stopping.length) {
        setDocBlockers(stopping);
        return;
      }
      toast.error(
        t('orderDetail.docFailed', 'Could not create the document'),
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setDocBusy(null);
    }
  };

  /**
   * The Bill (2026-10-27): the client's name, lines and totals — nothing
   * else about them, and nothing of Cesto's (no company name since
   * 2026-11-04). The server builds it from the order
   * as it stands (GET /api/sales/orders/:id/bill); nothing is issued or
   * numbered, so it can be printed as often as the rep likes.
   */
  const downloadTheBill = async () => {
    setDocBusy('bill');
    try {
      const bill = await salesOrders.bill(o.id);
      await downloadBill({ bill, labels: billLabels(t), lang });
    } catch (err) {
      toast.error(
        t('bill.failedTitle', 'Couldn\'t make the bill'),
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setDocBusy(null);
    }
  };

  /** Re-print one that already exists, without making another. */
  const downloadExisting = async (invoiceId: string) => {
    setDocBusy(invoiceId);
    try {
      const invoice = await salesInvoices.get(invoiceId);
      await downloadFactura({ invoice, labels: FACTURA_LABELS });
    } catch (err) {
      toast.error(
        t('orderDetail.docFailed', 'Could not create the document'),
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setDocBusy(null);
    }
  };


  /**
   * The actions that are not the primary one. Declared once and rendered
   * twice — as buttons from lg, as menu items below it — because two hand-kept
   * lists of the same actions drift the moment one gains a third.
   */
  const secondaryActions: Array<{
    key: string; label: string; icon: React.ReactNode;
    disabled?: boolean; onClick: () => void;
  }> = [];

  /**
   * The documents.
   *
   * A PART OF A SPLIT PURCHASE GETS NONE. The client made one purchase, so
   * billing per shop would hand them three albaranes for one basket — the
   * documents belong to the whole, which the primary action already offers
   * the way to, and the server refuses the request anyway.
   */
  if (!parentId) {
    /**
     * EVERY issued albarán gets its own download, not just the newest: the order
     * may have changed between them, and the one the client holds may be either.
     */
    for (const doc of issuedDocs) {
      secondaryActions.push({
        key: `doc-${doc.id}`,
        label: doc.invoice_number
          ? t('orderDetail.reprint', 'Download {{n}}', { n: doc.invoice_number })
          : t('orderDetail.reprintPlain', 'Download document'),
        icon: docBusy === doc.id
          ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />
          : <Download size={16} strokeWidth={1.75} />,
        disabled: docBusy !== null,
        onClick: () => { void downloadExisting(doc.id); },
      });
    }

    /**
     * The albarán is theirs to make. The factura is not, and there is no
     * button for it here at all.
     *
     * The line is the one printed on the paper: an albarán is explicitly not
     * a fiscal document and is reissued whenever the order changes, so a rep
     * can make one in front of a client without consequence. A factura closes
     * the order, states totals nobody may alter afterwards, and is corrected
     * only by a credit note, so it stays with the office.
     *
     * Hidden once a factura exists: the server's own `already_invoiced` blocker
     * refuses an albarán after one too.
     */
    if (!facturaIssued) {
      secondaryActions.push({
        key: 'albaran',
        label: issuedDocs.some((d) => d.kind === 'albaran')
          ? t('orderDetail.newAlbaran', 'New albarán')
          : t('orderDetail.albaran', 'Albarán'),
        icon: docBusy === 'albaran'
          ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />
          : <FileText size={16} strokeWidth={1.75} />,
        disabled: docBusy !== null,
        onClick: () => { void makeAlbaran(); },
      });
    }
  }

  // The Bill, on every order they built: after a factura too, and on a part
  // of a split purchase, where it covers the whole purchase. Not a fiscal
  // document, so nothing above stops it.
  secondaryActions.push({
    key: 'bill',
    label: t('bill.download', 'Download bill'),
    icon: docBusy === 'bill'
      ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />
      : <ReceiptText size={16} strokeWidth={1.75} />,
    disabled: docBusy !== null,
    onClick: () => { void downloadTheBill(); },
  });

  /**
   * The one thing a rep came here to do.
   *
   * Admin's primary action is invoicing, which is not theirs. Theirs is the
   * basket — or, for an order they parked, taking its stock, because that is
   * the decision parking it deferred. A part of a split purchase offers the
   * way to the whole instead, for the reason admin gives: the customer made
   * ONE purchase, and the part is not the thing to act on.
   */
  const primaryAction = parentId ? (
    <button
      type="button"
      onClick={() => navigate(`/sales/orders/${parentId}`)}
      className="flex-1 lg:flex-none h-11 sm:h-10 px-4 sm:px-5 whitespace-nowrap rounded-xl text-sm font-semibold font-display border border-brand/40 text-brand hover:bg-brand-mist/40 transition-colors inline-flex items-center justify-center gap-2"
    >
      <GitBranch size={16} strokeWidth={1.75} />
      {t('orderDetail.backToFullOrder')}
    </button>
  ) : o.status === 'draft' ? (
    <button
      onClick={() => confirmDraftStock.mutate({ id: o.id })}
      disabled={confirmDraftStock.isPending}
      className="flex-1 lg:flex-none h-11 sm:h-10 px-4 sm:px-5 whitespace-nowrap rounded-xl text-sm font-semibold font-display bg-brand hover:bg-brand-mid text-white transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60"
    >
      {confirmDraftStock.isPending
        ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />
        : <CheckCircle size={16} strokeWidth={1.75} />}
      {t('orderDetail.confirmStock', 'Confirm stock')}
    </button>
  ) : canEdit ? (
    <button
      onClick={() => navigate(`/sales/orders/${orderId}/edit`)}
      className="flex-1 lg:flex-none h-11 sm:h-10 px-4 sm:px-5 whitespace-nowrap rounded-xl text-sm font-semibold font-display bg-brand hover:bg-brand-mid text-white transition-colors inline-flex items-center justify-center gap-2"
    >
      <Pencil size={16} strokeWidth={1.75} />
      {t('orderDetail.editItems', 'Edit items')}
    </button>
  ) : null;

  return (
    <div>
      {/* Same shape as the customer page: a labelled way back, then one card
          that says what this is, what state it is in, and the thing you came
          to do. The status drives the colour of the disc, so the state is
          carried by the most visible element rather than only a chip. */}
      <BackLink
        label={parentId ? t('orderDetail.backToFullOrder') : t('common.backToOrders', 'Back to orders')}
        title={t('orderDetail.barTitle', 'Order')}
        onClick={() => goBack(backTarget)}
        className="mb-3"
      />

      {/* A SPLIT IS NOT SILENT.

          Swapping a line for another shop's product moves that line out of
          this order and onto a new one, because a shop can only deliver its
          own goods. The edit succeeds, so nothing looks wrong — the order
          just quietly gets shorter, and a part of the rep's own purchase
          exists somewhere they were never told about. */}
      {spunOff.length > 0 && (
        <section className="bg-brand-whisper rounded-xl border border-brand/25 p-4 mb-3">
          <div className="flex items-start gap-3">
            <GitBranch size={18} strokeWidth={1.75} className="text-brand shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold font-display text-ink">
                {t('orderDetail.splitOff', 'Part of this order moved to another shop')}
              </p>
              <p className="text-xs font-body text-muted mt-1">
                {t(
                  'orderDetail.splitOffWhy',
                  'A shop can only deliver its own products, so those items are now a separate order. The client still pays for one purchase.',
                )}
              </p>
              <ul className="mt-3 space-y-1.5">
                {spunOff.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/sales/orders/${n.id}`)}
                      className="inline-flex items-center gap-1.5 text-[13px] font-semibold font-display text-brand hover:underline"
                    >
                      <span className="font-mono">{n.order_number}</span>
                      {n.store_name && (
                        <span className="font-body font-normal text-muted">· {n.store_name}</span>
                      )}
                      <ChevronRight size={14} strokeWidth={2} />
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setSpunOff([])}
                className="mt-3 text-xs font-semibold font-display text-muted hover:text-ink transition-colors"
              >
                {t('common.dismiss', 'Dismiss')}
              </button>
            </div>
          </div>
        </section>
      )}

      <header className="bg-card rounded-2xl border border-border shadow-card mb-3 md:mb-3.5 2xl:mb-4">
        <div className="p-4 sm:p-5 flex items-start gap-3.5 sm:gap-4">
          <div
            className={`w-[52px] h-[52px] sm:w-16 sm:h-16 rounded-2xl shrink-0 flex items-center justify-center ${statusTint.bg} ${statusTint.text}`}
            aria-hidden="true"
          >
            <PackageIcon className="w-6 h-6 sm:w-7 sm:h-7" strokeWidth={1.75} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-[21px] sm:text-[27px] leading-[1.15] font-bold tracking-[-0.02em] text-ink">
                  <span className="font-mono">{o.order_number}</span>
                </h1>
                {/* Two lines rather than an ellipsis: on a narrow phone the
                    name and date do not fit one, and the date is never cut. */}
                <p className="text-[13px] text-gray mt-1.5 line-clamp-2">
                  {o.user?.name ?? o.address_snapshot?.contact_name ?? '\u2014'}
                  {o.created_at && ' '}
                  {o.created_at && (
                    <span className="text-muted whitespace-nowrap">
                      {'\u00b7  '}
                      {new Date(o.created_at).toLocaleDateString('es-ES', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* A desktop has room for the actions themselves, and three
                    labelled buttons beat a glyph that hides them. A phone does
                    not, so there the same actions live behind the menu — which
                    is why each one appears twice: once here, once as a menu
                    item, from one definition. */}
                <span className="hidden lg:flex items-center gap-2">
                  {secondaryActions.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      onClick={a.onClick}
                      disabled={a.disabled}
                      className="h-10 px-4 rounded-xl text-sm font-semibold font-display border border-border bg-card text-ink hover:border-brand/50 hover:bg-brand-mist/40 transition-colors inline-flex items-center gap-2 disabled:opacity-50"
                    >
                      {a.icon}
                      {a.label}
                    </button>
                  ))}
                  {primaryAction}
                </span>

                <div className="relative shrink-0 lg:hidden" ref={actionsRef}>
                  <button
                    type="button"
                    onClick={() => setActionsOpen((v) => !v)}
                    aria-haspopup="menu"
                    aria-expanded={actionsOpen}
                    aria-label={t('customerDetail.moreActions', 'More actions')}
                    className={`w-10 h-10 rounded-xl border transition-colors inline-flex items-center justify-center ${
                      actionsOpen ? 'border-brand text-brand bg-brand-whisper' : 'border-border text-gray hover:bg-surface-linen'
                    }`}
                  >
                    <MoreVertical className="w-4 h-4" strokeWidth={1.75} />
                  </button>

                  {actionsOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 mt-2 w-64 bg-card border border-border rounded-2xl shadow-modal z-30 overflow-hidden p-1.5 sales-pop"
                    >
                      {secondaryActions.map((a, i) => (
                        <button
                          key={a.key}
                          type="button"
                          role="menuitem"
                          onClick={() => { setActionsOpen(false); a.onClick(); }}
                          disabled={a.disabled}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-cream disabled:opacity-60 text-left transition-colors ${
                            i > 0 ? 'mt-0.5' : ''
                          }`}
                        >
                          {a.icon}
                          <span className="text-sm font-semibold text-ink truncate">{a.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-2.5">
              <SalesStatusBadge status={o.status} />
              {(o as any).parent_order && (
                <button
                  onClick={() => navigate(`/sales/orders/${(o as any).parent_order.id}`)}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-brand-mist text-brand text-xs font-semibold font-display hover:bg-brand hover:text-white transition-colors"
                  title={t('orderDetail.backToFullOrder')}
                >
                  <GitBranch size={12} strokeWidth={2.25} />
                  {t('orderDetail.partOf', { orderNumber: (o as any).parent_order.order_number })}
                </button>
              )}
              {(o as any).store && (
                <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-surface-cream border border-border text-ink/80 text-xs font-semibold">
                  <StoreIcon size={12} strokeWidth={2} className="text-muted" />
                  {(o as any).store.name}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Why the edit controls are gone. Without this the page just quietly
            stops offering them and the reason is a mystery — and the reason
            matters, because the way out is the office, not a retry. It is
            the card's foot now rather than a box below it: it is a fact about
            this order, like a block is a fact about a customer. */}
        {/* WHY THE ALBARÁN WAS REFUSED, in the same slot as the lock notice.
            Not a toast: every line of this is a thing to go and change on a
            screen the rep may not even have — the company's tax details, a
            product's IVA rate — so it has to stay still long enough to be
            read, and to be shown to whoever can fix it.

            Only the blockers that stop an ALBARÁN reach this panel, because
            that is the only document offered here. The ones that merely stop
            a factura — no CIF on the client, an IVA rate nobody has reviewed
            — are filtered out: they are true, and they are not the rep's
            problem, and listing them under "cannot be created" beside a
            document that was in fact created would be a lie. */}
        {docBlockers.length > 0 && (
          <div className="px-4 sm:px-5 py-3 bg-amber-mist border-t border-amber-deep/25 lg:rounded-b-2xl flex items-start gap-2.5">
            <AlertTriangle size={16} strokeWidth={1.75} className="text-amber-deep shrink-0 mt-0.5" />
            <div className="min-w-0 text-[13px] flex-1">
              <p className="font-semibold text-ink">
                {t('orderDetail.albaranBlocked', 'No albarán can be issued for this order')}
              </p>
              <ul className="mt-1 space-y-0.5 text-gray list-disc pl-4">
                {docBlockers.map((b) => (
                  <li key={b.code}>{b.message}</li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setDocBlockers([])}
                className="mt-2 text-xs font-semibold font-display text-gray hover:text-ink transition-colors"
              >
                {t('common.dismiss', 'Dismiss')}
              </button>
            </div>
          </div>
        )}

        {facturaIssued && (
          <div className={`px-4 sm:px-5 py-3 bg-brand-whisper border-t border-brand/15 ${primaryAction ? 'lg:rounded-b-2xl' : 'rounded-b-2xl'} flex items-start gap-2.5`}>
            <Lock size={16} strokeWidth={1.75} className="text-brand shrink-0 mt-0.5" />
            <div className="min-w-0 text-[13px]">
              <p className="font-semibold text-ink">
                {t('orderDetail.lockedTitle', 'The office has invoiced this order')}
              </p>
              <p className="text-gray mt-0.5">
                {t('orderDetail.lockedBody', 'Items and the delivery fee can no longer be changed. If something needs correcting, ask the office.')}
              </p>
            </div>
          </div>
        )}

        {/* lg, not sm: the inline cluster above starts at lg, so anything
            narrower needs the primary action here or it has nowhere to be. */}
        {/* Only when there is one: a delivered order has nothing to do, and
            an empty footer read as a broken card. */}
        {primaryAction && (
          <div className="lg:hidden border-t border-border/80 rounded-b-2xl p-3 flex items-center gap-2">
            {primaryAction}
          </div>
        )}
      </header>

      <div className="grid lg:grid-cols-3 gap-3 md:gap-3.5 2xl:gap-4">
        {/* Left: items + summary */}
        <div className="lg:col-span-2 space-y-3 md:space-y-3.5 2xl:space-y-4">
          <div className="bg-card rounded-2xl border border-border shadow-card p-5">
            <SectionTitle title={t('orderDetail.orderItems')} icon={PackageIcon} action={canEdit && (
                <button
                  type="button"
                  onClick={() => navigate(`/sales/orders/${orderId}/edit`)}
                  // On a phone the header card's full-width button is the way in; two read as two different edits.
                  className="hidden lg:inline-flex h-9 px-3.5 rounded-lg text-xs font-semibold font-display border border-border bg-card text-ink hover:border-brand/50 hover:bg-brand-mist/40 transition-colors items-center gap-1.5"
                >
                  <Pencil size={14} strokeWidth={1.75} />
                  {t('orderDetail.editOrder.button')}
                </button>
              )} />
            <OrderItems items={o.items ?? []} />
          </div>

          <div className="bg-card rounded-2xl border border-border shadow-card p-5">
            <SectionTitle title={t('orderDetail.orderSummary')} icon={Receipt} />
            <div className="space-y-2">
              {/* `subtotal` is already net of every line discount, so showing
                  it alone would hide the money that came off. The gross is
                  reconstructed from the lines and shown above the saving, so
                  the two figures explain each other instead of one of them
                  looking wrong. */}
              {totalDiscount > 0 && (
                <div className="flex justify-between text-sm font-display">
                  <span className="text-gray">{t('orderDetail.grossSubtotal', 'Items before discount')}</span>
                  <span className="text-muted tabular-nums">
                    {formatCurrency(Number(o.subtotal) + totalDiscount)}
                  </span>
                </div>
              )}
              {totalDiscount > 0 && (
                <div className="flex justify-between text-sm font-display">
                  <span className="text-success">{t('orderDetail.totalDiscount', 'Discount')}</span>
                  <span className="text-success tabular-nums">
                    {'\u2212'}{formatCurrency(totalDiscount)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm font-display">
                <span className="text-gray">{t('orderDetail.subtotal')}</span>
                <span className="text-ink">{formatCurrency(Number(o.subtotal))}</span>
              </div>
              {/* Editable while the order still is. The fee is a judgement
                  about the parcel, and the parcel changes — items get added,
                  or it turns out heavier than it looked at the counter. */}
              <div className="flex justify-between items-center text-sm font-display gap-3">
                <span className="text-gray">{t('orderDetail.deliveryFee')}</span>
                {editingFee ? (
                  <span className="flex items-center gap-1.5">
                    <input
                      value={feeDraft}
                      onChange={(e) => setFeeDraft(e.target.value)}
                      inputMode="decimal"
                      autoFocus
                      aria-label={t('orderDetail.deliveryFee')}
                      className="w-20 h-8 px-2 rounded-lg border border-border bg-surface-cream text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                    />
                    <button
                      type="button"
                      onClick={saveFee}
                      disabled={setFee.isPending || !feeValid}
                      className="h-8 px-2.5 rounded-lg bg-brand text-white text-xs font-semibold disabled:opacity-50"
                    >
                      {t('common.save', 'Save')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingFee(false)}
                      className="h-8 px-2.5 rounded-lg border border-border text-xs font-semibold text-gray"
                    >
                      {t('common.cancel', 'Cancel')}
                    </button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-ink">
                      {/* Never "Free": a zero is a fee nobody has set yet. */}
                      {deliveryFeeIsPending(o)
                        ? t('orderDetail.feeComesLater', 'Added by us shortly')
                        : formatCurrency(Number(o.delivery_fee))}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => { setFeeDraft(Number(o.delivery_fee).toFixed(2)); setEditingFee(true); }}
                        className="text-xs font-semibold text-brand hover:underline"
                      >
                        {t('common.edit', 'Edit')}
                      </button>
                    )}
                  </span>
                )}
              </div>
              {/* Recargo de equivalencia (2026-11-04), on top of IVA for a
                  client under the regime; a part of a purchase carries none. */}
              {Number(o.recargo ?? 0) > 0 && (
                <div className="flex justify-between text-sm font-display">
                  <span className="text-gray">{t('orderDetail.recargo', 'Recargo de equivalencia')}</span>
                  <span className="text-ink">{formatCurrency(Number(o.recargo))}</span>
                </div>
              )}
              <div className="border-t border-border pt-2 flex justify-between">
                <span className="text-lg font-bold font-display text-ink">{t('orderDetail.total')}</span>
                <span className="text-lg font-bold font-display text-ink">{formatCurrency(Number(o.total))}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: actions */}
        <div className="space-y-3 md:space-y-3.5 2xl:space-y-4">
          {/* What they earn from it (API lib/repEarnings) — never a buying price. */}
          {o.earning && <OrderEarningCard earning={o.earning} />}
          {/* Customer */}
          <div className="bg-card rounded-2xl border border-border shadow-card p-5">
            <SectionTitle title={t('orderDetail.customer')} icon={UserRound} />
            <div className="space-y-3">
              <div>
                <p className="text-[12.5px] font-display text-muted mb-0.5">{t('orderDetail.customerName')}</p>
                {/* Their profile, where a rep also gives them a shop login. */}
                {o.user?.id ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/sales/clients/${o.user!.id}`)}
                    className="text-left text-sm font-semibold font-display text-brand hover:underline inline-flex items-center gap-1"
                  >
                    {o.user.name ?? o.address_snapshot?.contact_name ?? '—'}
                    <ChevronRight size={14} strokeWidth={2} />
                  </button>
                ) : (
                  <p className="text-sm font-display text-ink">{o.address_snapshot?.contact_name ?? '—'}</p>
                )}
              </div>
              <div>
                <p className="text-[12.5px] font-display text-muted mb-0.5">{t('orderDetail.phone')}</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-display text-ink">{o.address_snapshot?.contact_phone ?? o.user?.phone ?? '—'}</p>
                  {phoneClean && (
                    <a
                      href={`https://wa.me/${phoneClean.replace('+', '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-display font-semibold text-brand hover:text-brand-mid transition-colors"
                    >
                      WhatsApp
                    </a>
                  )}
                </div>
              </div>
              {o.address_snapshot && (
                <div>
                  <p className="text-[12.5px] font-display text-muted mb-0.5">{t('orderDetail.deliveryAddress')}</p>
                  <div className="flex items-start gap-2">
                    <MapPin size={14} strokeWidth={1.75} className="text-muted mt-0.5 flex-shrink-0" />
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

          {/* The "Delivery slot" card stood here. It read "ASAP — within 60
              min" from a hardcoded string: booked windows went with the zone
              system, `delivery_slot_id` is gone from the schema, and no order
              has ever carried one. So it was a heading over a promise nobody
              measures, on the screen ops use to decide what to tell a
              customer who is asking where their order is. */}

          {/* Notes */}
          <div className="bg-card rounded-2xl border border-border shadow-card p-5">
            <SectionTitle title={t('orderDetail.notes')} icon={MessageSquare} />
            <div className="space-y-4">
              <div>
                <p className="text-[12.5px] font-display text-muted mb-1">{t('orderDetail.customerNotes')}</p>
                <p className="text-sm font-body text-ink bg-surface-cream rounded-lg p-3">
                  {o.customer_notes || t('orderDetail.noCustomerNotes')}
                </p>
              </div>
              <div>
                <p className="text-[12.5px] font-display text-muted mb-1">{t('orderDetail.adminNotes')}</p>
                <textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder={t('orderDetail.adminNotesPlaceholder')}
                  rows={3}
                  className="w-full bg-surface-cream border border-border rounded-lg p-3 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 resize-none"
                />
                <button
                  onClick={onSaveNotes}
                  disabled={updateNotes.isPending}
                  className="mt-2 h-9 px-3 rounded-lg bg-brand text-white text-xs font-semibold font-display inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save size={14} strokeWidth={1.75} />
                  {t('orderDetail.saveNote', 'Save note')}
                </button>
              </div>
            </div>
          </div>

          {/* Cancel */}
          {canCancel && (
            <div className="bg-card rounded-2xl border border-border shadow-card p-5">
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="w-full h-[52px] rounded-xl text-sm font-semibold font-display text-white bg-danger hover:bg-danger/90 transition-colors inline-flex items-center justify-center gap-2"
              >
                <XCircle size={16} strokeWidth={1.75} />
                {t('orderDetail.cancelOrder')}
              </button>
            </div>
          )}

        </div>
      </div>

      {/* Cancelling a big order restocks every line: say so while it runs. */}
      {cancelOrder.isPending && (
        <OrderProgressPanel
          key={cancelKey ?? 'cancel'}
          kind="cancel"
          phase="server"
          progressKey={cancelKey}
          lang={lang}
          detail={{ lines: o.items?.length }}
          onVisible={() => setCancelPanelUp(true)}
        />
      )}

      {/* Back once the cancel ends: a failure leaves it open to retry. */}
      <ConfirmModal
        open={showCancelConfirm && !(cancelOrder.isPending && cancelPanelUp)}
        title={t('orderDetail.confirmCancelTitle')}
        message={t('orderDetail.confirmCancelMsg', { orderNumber: o.order_number })}
        confirmLabel={cancelOrder.isPending
          ? t('orderDetail.confirmCancelPending', 'Cancelling…')
          : t('orderDetail.confirmCancelYes')}
        confirmDisabled={cancelOrder.isPending}
        danger
        onConfirm={onConfirmCancel}
        onCancel={() => { if (!cancelOrder.isPending) { setShowCancelConfirm(false); setCancelReason(''); } }}
      >
        <label className="text-[13px] font-semibold font-display text-ink mb-1 block">
          {t('orderDetail.cancelReasonLabel', 'Reason (optional — visible to the customer)')}
        </label>
        <textarea
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder={t('orderDetail.cancelReasonPlaceholder', 'e.g. "Store closed early" or "Customer requested via phone"')}
          rows={3}
          className="w-full rounded-lg border border-border bg-surface-cream p-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-danger/30 resize-none"
          disabled={cancelOrder.isPending}
        />
        <p className="mt-1.5 text-[11px] text-muted font-body">
          {o.status === 'draft'
            ? t('orderDetail.cancelReasonHintDraft')
            : t('orderDetail.cancelReasonHint', 'Items will be restocked automatically. The customer receives an email with your reason.')}
        </p>
      </ConfirmModal>

    </div>
  );
}
