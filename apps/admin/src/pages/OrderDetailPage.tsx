import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import {
  BadgeCheck,
  Phone,
  MapPin,
  MessageSquare,
  Truck,
  XCircle,
  CheckCircle,
  Check,
  Save,
  GitBranch,
  Store as StoreIcon,
  ChevronRight,
  AlertCircle, FileDown, FileText, ReceiptText,
  Loader2,
  AlertTriangle,
  Trash2,
  Pencil,
  Receipt,
  Lock,
  ImageOff, MoreVertical, Package as PackageIcon, ShoppingBasket,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useGoBack } from '@/lib/useGoBack';
import {
  useAdminOrder,
  useUpdateOrderStatus,
  newProgressKey,
  useUpdateOrderNotes,
  useAssignRider,
  useAdminRiders,
  useAdminSettings,
  useCreateInvoiceForOrder,
  useSetOrderDeliveryFee, useSetOrderRecargo,
  useConfirmDraftStock,
  useDeleteOrder,
  resolveImageUrl,
  issuedInvoiceOf,
  lockingInvoiceOf, deliveryFeeIsPending, adminOrders, useSetOrderItemCosts, useAdminMe,
  staffCanEditOrder } from '@grocery-app/shared';
import { downloadBill, downloadOrderInvoice } from '@grocery-app/shared/invoice';
import type { OrderStatus, IssuedInvoiceRef, InvoiceBlocker, EditOrderNewOrder, AdminRepOrderEarning } from '@grocery-app/shared';
import { RepOrderEarningCard, PurchaseRepEarnings } from '@/components/salesRep/RepOrderEarning';
import StatusBadge, { statusConfig } from '@/components/StatusBadge';
import BackLink from '@/components/BackLink';
import { WINDOW_HOURS, planDate } from '@/components/home-grocery-plan/planFormat';
import ChangeSlotModal from '@/components/home-grocery-plan/ChangeSlotModal';

/** A Home Grocery order's day and time can move until preparing starts — the API's changeOrderSlot. */
const HG_SLOT_MOVABLE = ['draft', 'pending', 'confirmed'];
import { PlanDeliveryStatus } from '@/components/home-grocery-plan/PlanDeliveries';
import ConfirmModal from '@/components/ConfirmModal';
import OrderProgressPanel from '@/components/OrderProgressPanel';
import DeleteOrderModal from '@/components/DeleteOrderModal';
import { useToast } from '@/components/Toast';
import { buildInvoiceLabels } from '@/lib/invoiceLabels';
import { buildBillLabels } from '@/lib/billLabels';
import { useBlockerMessage } from '@/lib/blockerMessage';

/** A plan delivery's status, as PlanDeliveryStatus reads it. */
type PlanRowStatus = Parameters<typeof PlanDeliveryStatus>[0]['status'];

const STATUS_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: 'confirmed',
  confirmed: 'preparing',
  preparing: 'on_the_way',
  on_the_way: 'delivered',
};

function formatCurrency(amount: number): string {
  return amount.toFixed(2).replace('.', ',') + ' €';
}

/** What the buying-price helpers read off a line. */
type CostLine = { id: string; quantity: number | string; unit_cost?: number | string | null; product_snapshot?: { name_es?: string } | null };

/**
 * Editing the buying price of one list of lines (2026-10-27, user: "on each
 * order we should be able to edit the buying price... It will be done by the
 * admin and not the reps"). Copied from the product when the line was made;
 * a figure above 0 saved here becomes the product's too (user: "Yes,
 * everywhere" — the latest entered wins). One edit mode for the whole list,
 * saved with one press — a buying invoice is entered line after line.
 *
 * A hook, because its buttons sit ABOVE the lines, beside "Edit order" (user:
 * "along with edit order.... above not below"), while its fields are in them.
 */
function useLineCosts(items: CostLine[], orderId: string) {
  const { t } = useTranslation();
  const toast = useToast();
  const setCosts = useSetOrderItemCosts();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const costOf = (item: CostLine): number => Number(item.unit_cost ?? 0);
  const parse = (raw: string) => Number(raw.trim().replace(',', '.'));
  const draftCost = (item: CostLine): number => {
    const raw = draft[item.id];
    if (!editing || raw === undefined) return costOf(item);
    if (raw.trim() === '') return 0;
    const n = parse(raw);
    return Number.isFinite(n) && n >= 0 ? n : costOf(item);
  };
  const buyingTotal = items.reduce((s, item) => s + draftCost(item) * Number(item.quantity), 0);
  const invalid = editing && items.some((item) => {
    const raw = draft[item.id];
    if (raw === undefined || raw.trim() === '') return false;
    const n = parse(raw);
    return !Number.isFinite(n) || n < 0;
  });

  const start = () => {
    // Written the way the page shows money (a decimal comma); either separator is read back.
    setDraft(Object.fromEntries(items.map((item) => [item.id, costOf(item) > 0 ? costOf(item).toFixed(2).replace('.', ',') : ''])));
    setEditing(true);
  };
  const save = () => {
    const changed = items
      .map((item) => {
        const raw = (draft[item.id] ?? '').trim();
        const next = raw === '' ? 0 : Math.round(parse(raw) * 100) / 100;
        return { order_item_id: item.id, unit_cost: next, was: costOf(item) };
      })
      .filter((c) => Math.abs(c.unit_cost - c.was) >= 0.005)
      .map(({ order_item_id, unit_cost }) => ({ order_item_id, unit_cost }));
    if (changed.length === 0) { setEditing(false); return; }
    setCosts.mutate({ id: orderId, items: changed }, {
      onSuccess: () => {
        setEditing(false);
        toast.success(t('orderDetail.costs.saved', { count: changed.length, defaultValue: 'Buying prices saved' }));
      },
      onError: (e) => toast.error(t('orderDetail.costs.saveFailed', 'Could not save the buying prices'), e instanceof Error ? e.message : String(e)),
    });
  };

  return {
    editing, draft, setDraft, costOf, buyingTotal, invalid, start, save,
    cancel: () => setEditing(false), pending: setCosts.isPending,
  };
}
type LineCosts = ReturnType<typeof useLineCosts>;

/** "Edit buying prices", or Cancel + Save while editing — for a card's header. */
function LineCostButtons({ costs }: { costs: LineCosts }) {
  const { t } = useTranslation();
  if (!costs.editing) {
    return (
      <button
        type="button"
        onClick={costs.start}
        className="h-9 px-3.5 rounded-lg text-xs font-semibold font-display border-2 border-border text-ink hover:border-brand hover:bg-brand-mist/40 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
      >
        <Pencil size={14} strokeWidth={1.75} />
        {t('orderDetail.costs.edit', 'Edit buying prices')}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={costs.cancel}
        disabled={costs.pending}
        className="h-9 px-3 rounded-lg text-xs font-semibold font-display border-2 border-border bg-card text-ink hover:border-brand disabled:opacity-50"
      >
        {t('common.cancel', 'Cancel')}
      </button>
      <button
        type="button"
        onClick={costs.save}
        disabled={costs.pending || costs.invalid}
        className="h-9 px-3.5 rounded-lg bg-brand hover:bg-brand-mid text-white text-xs font-semibold font-display inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
      >
        {costs.pending ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : <Check size={14} strokeWidth={2.25} />}
        {t('orderDetail.costs.save', 'Save buying prices')}
      </button>
    </span>
  );
}

/** A single order's lines, under a header with "Edit order" and the buying-price buttons. */
function OrderItemsCard({ items, orderId, canEdit, onEditOrder }: {
  items: CostLine[]; orderId: string; canEdit: boolean; onEditOrder: () => void;
}) {
  const { t } = useTranslation();
  const costs = useLineCosts(items, orderId);
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-base font-bold font-display text-ink">{t('orderDetail.orderItems')}</h2>
        <span className="flex flex-wrap items-center gap-2">
          {canEdit && !costs.editing && (
            <button
              type="button"
              onClick={onEditOrder}
              className="h-9 px-3.5 rounded-lg text-xs font-semibold font-display border-2 border-border text-ink hover:border-brand hover:bg-brand-mist/40 transition-colors inline-flex items-center gap-1.5"
            >
              <Pencil size={14} strokeWidth={1.75} />
              {t('orderDetail.editOrder.button')}
            </button>
          )}
          <LineCostButtons costs={costs} />
        </span>
      </div>
      <OrderItems items={items} costs={costs} />
    </div>
  );
}

/** A split purchase's part: its buying-price buttons above its lines. */
function PartItems({ items, purchaseId }: { items: CostLine[]; purchaseId: string }) {
  // Saved through the purchase's id (the API takes a part's lines under its
  // parent), so the page that refreshes is the one showing them.
  const costs = useLineCosts(items, purchaseId);
  return (
    <>
      <div className="flex justify-end px-4 py-2 border-b border-border">
        <LineCostButtons costs={costs} />
      </div>
      <OrderItems items={items} costs={costs} />
    </>
  );
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
function OrderItems({ items, costs }: { items: any[]; costs: LineCosts }) {
  const { t } = useTranslation();
  const { editing, draft, setDraft, costOf } = costs;

  const costInput = (item: CostLine, className: string) => (
    <input
      type="text"
      inputMode="decimal"
      value={draft[item.id] ?? ''}
      onChange={(e) => setDraft((d) => ({ ...d, [item.id]: e.target.value }))}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); costs.save(); } }}
      placeholder="0,00"
      aria-label={t('orderDetail.costs.inputLabel', { name: item.product_snapshot?.name_es ?? '', defaultValue: 'Buying price of one {{name}}' })}
      className={`${className} bg-card border border-border rounded-lg px-2 text-sm font-display text-ink text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand`}
    />
  );

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
                {item.quantity} {'×'} {formatCurrency(Number(item.unit_price))}
              </p>
              {Number(item.discount_amount ?? 0) > 0 && (
                <p className="text-[11.5px] text-success tabular-nums">
                  {t('orderDetail.table.discount', 'Discount')}{' −'}
                  {formatCurrency(Number(item.discount_amount))}
                  {/* Agreed per unit since 2026-10-25. */}
                  {Number(item.unit_discount ?? 0) > 0 && (
                    <span className="text-muted">{' ('}{t('orderDetail.table.perUnit', '{{amount}} each', { amount: formatCurrency(Number(item.unit_discount)) })}{')'}</span>
                  )}
                </p>
              )}
              {editing ? (
                <label className="mt-1.5 flex items-center gap-2 text-[11.5px] text-gray whitespace-nowrap">
                  {t('orderDetail.costs.label', 'Buying price')}
                  {costInput(item, 'h-8 w-24')}
                </label>
              ) : (
                <p className={`text-[11.5px] tabular-nums ${costOf(item) > 0 ? 'text-gray' : 'text-muted'}`}>
                  {t('orderDetail.costs.each', { amount: formatCurrency(costOf(item)), defaultValue: 'Bought at {{amount}} each' })}
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
                <th key={header} className="px-3 py-2.5 text-left text-xs font-semibold font-display text-gray uppercase tracking-wider">
                  {header}
                </th>
              ))}
              <th
                className="px-3 py-2.5 text-right text-xs font-semibold font-display text-gray uppercase tracking-wider whitespace-nowrap"
                title={t('orderDetail.costs.hint', 'What we paid for one. Saving it also sets the product\'s buying price. Only admins see it.')}
              >
                {t('orderDetail.costs.label', 'Buying price')}
              </th>
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
                        {'−'}{formatCurrency(Number(item.discount_amount))}
                        {Number(item.unit_discount ?? 0) > 0 && (
                          <span className="block text-[11px] text-muted">{t('orderDetail.table.perUnit', '{{amount}} each', { amount: formatCurrency(Number(item.unit_discount)) })}</span>
                        )}
                      </span>
                    )
                    : <span className="text-muted/60">{'—'}</span>}
                </td>
                <td className="px-3 py-3 text-sm font-display font-semibold text-ink whitespace-nowrap">{formatCurrency(Number(item.line_total))}</td>
                <td className={`px-3 py-3 text-sm font-display text-right whitespace-nowrap tabular-nums ${costOf(item) > 0 ? 'text-gray' : 'text-muted'}`}>
                  {editing ? costInput(item, 'h-9 w-24') : formatCurrency(costOf(item))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* What the lines cost us; the buttons that change it are above. */}
      <p className="border-t border-border bg-surface-cream/50 px-4 py-2.5 text-[13px] text-gray">
        {t('orderDetail.costs.total', 'Buying total')}
        <span className="ml-2 font-semibold text-ink tabular-nums">{formatCurrency(costs.buyingTotal)}</span>
      </p>
    </>
  );
}


/** Either creator column, as the API sends them. At most one is ever set. */
interface BuiltByRow {
  created_by_admin?: { id: string; name: string } | null;
  created_by_sales_rep?: { id: string; name: string } | null;
}

/**
 * Who built this, when it was not the customer.
 *
 * The two columns collapse into one answer because the question is the same
 * either way, and the rep's name is a LINK: ops opens this page asking who to
 * ring about an order, and the rep's own page has the number.
 *
 * Renders nothing for a customer's own order, which is most of them — the
 * absence of this line is itself the answer that the customer placed it.
 */
function BuiltByLine({ row }: { row: BuiltByRow | null | undefined }) {
  const { t } = useTranslation();
  const rep = row?.created_by_sales_rep;
  const staff = row?.created_by_admin;
  if (!rep && !staff) return null;

  const name = rep?.name ?? staff!.name;
  const role = rep
    ? t('orderDetail.builtByRep', 'sales rep')
    : t('orderDetail.builtByStaff', 'staff');

  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] min-w-0">
      <BadgeCheck size={13} strokeWidth={2} className="text-brand shrink-0" />
      <span className="text-gray shrink-0">{t('orderDetail.builtBy', 'Built by')}</span>
      {rep ? (
        <Link
          to={`/sales-reps/${rep.id}`}
          className="font-semibold font-display text-brand hover:underline truncate"
        >
          {name}
        </Link>
      ) : (
        <span className="font-semibold font-display text-ink truncate">{name}</span>
      )}
      <span className="text-muted shrink-0">· {role}</span>
    </p>
  );
}

function getAvailableStatuses(current: OrderStatus): OrderStatus[] {
  const next = STATUS_TRANSITIONS[current];
  return next ? [next] : [];
}

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  // Back pops the history entry when there is one, so opening an order from
  // a customer's page returns there rather than to the orders list. The
  // argument is only the cold-start fallback.
  const goBack = useGoBack();
  const { t, i18n } = useTranslation();
  const blockerText = useBlockerMessage();
  /** Approving a rep's earning, and setting its expenses, is a super admin's. */
  const { data: me } = useAdminMe();
  const isSuperAdmin = me?.role === 'super_admin';

  const STATUS_LABELS: Record<OrderStatus, string> = {
    pending: t('orderDetail.statusLabels.pending'),
    confirmed: t('orderDetail.statusLabels.confirmed'),
    preparing: t('orderDetail.statusLabels.preparing'),
    on_the_way: t('orderDetail.statusLabels.on_the_way'),
    delivered: t('orderDetail.statusLabels.delivered'),
    cancelled: t('orderDetail.statusLabels.cancelled'),
    // MV Slice 4 — parent-derived status; never stored on an Order row,
    // but the map must be exhaustive per OrderStatus.
    partially_completed: t('orderDetail.statusLabels.partially_completed'),
    draft: t('orderDetail.statusLabels.draft'),
  };

  const toast = useToast();
  const createInvoice = useCreateInvoiceForOrder();

  // Delivery fee, edited in place on the summary.
  const setFee = useSetOrderDeliveryFee();
  /**
   * RECARGO DE EQUIVALENCIA on an order already placed (2026-11-04): the
   * customer was put under the regime after ordering, so the order carries
   * none — the office adds it here (or takes it off), and the total, bill and
   * factura follow. On a split purchase it is the whole purchase's.
   */
  const setRecargo = useSetOrderRecargo();
  const toggleRecargo = (id: string, on: boolean) => setRecargo.mutate({ id, on }, {
    onSuccess: () => toast.success(on
      ? t('orderDetail.recargoAdded', 'Recargo de equivalencia added')
      : t('orderDetail.recargoRemoved', 'Recargo de equivalencia removed')),
    onError: (err) => toast.error(
      t('orderDetail.recargoFailed', 'Could not change the recargo'),
      err instanceof Error ? err.message : String(err),
    ),
  });
  const [editingFee, setEditingFee] = useState(false);
  const [movingSlot, setMovingSlot] = useState(false);
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
  const { data: order, isLoading, error: orderError, refetch } = useAdminOrder(orderId);
  const updateStatus = useUpdateOrderStatus();
  /** Names a cancel so the progress panel can follow it on the server. */
  const [cancelKey, setCancelKey] = useState<string | null>(null);
  /** That panel is up, so the confirm box under it steps aside. */
  const [cancelPanelUp, setCancelPanelUp] = useState(false);
  const updateNotes = useUpdateOrderNotes();
  const assignRider = useAssignRider();
  const confirmDraftStock = useConfirmDraftStock();
  const deleteOrder = useDeleteOrder();
  const { data: riders } = useAdminRiders(true);
  const { data: storeSettings } = useAdminSettings();
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  /**
   * Parts a cross-shop edit just spun off beside this order.
   *
   * Arrives in the navigation state, because editing happens on its own
   * screen now and this page is where it lands afterwards. Read ONCE into
   * state rather than off `location` every render, so dismissing it sticks.
   */
  const [spunOff, setSpunOff] = useState<EditOrderNewOrder[]>(
    () => (location.state as { spunOff?: EditOrderNewOrder[] } | null)?.spunOff ?? [],
  );

  async function handleDownloadInvoice() {
    if (!order) return;
    setDownloadingInvoice(true);
    try {
      // MV Slice 4 — a sub-order that belongs to a partner store shows that
      // store as the invoice's seller; house orders (store === null) fall
      // back to Cesto.
      const storeName = (order as any).store?.name ?? storeSettings?.storeName ?? 'Cesto';
      await downloadOrderInvoice({
        order: order as any,
        settings: {
          storeName,
          address: storeSettings?.address ?? '',
          contactEmail: storeSettings?.contactEmail ?? '',
          contactPhone: storeSettings?.contactPhone ?? '',
        },
        labels: buildInvoiceLabels(t),
        lang: i18n.language,
      });
    } catch (err) {
      toast.error(
        t('orderDetail.invoiceFailedTitle'),
        err instanceof Error ? err.message : t('orderDetail.invoiceFailedBody'),
      );
    } finally {
      setDownloadingInvoice(false);
    }
  }

  /**
   * The Bill (2026-10-27): the customer's name, lines and totals — nothing
   * else about them, and nothing of Cesto's (no company name since
   * 2026-11-04). Built by the server from the order
   * as it stands (GET /orders/:id/bill), so the screen cannot add to it; a
   * part of a split purchase bills the whole purchase.
   */
  const [downloadingBill, setDownloadingBill] = useState(false);
  async function handleDownloadBill(id: string) {
    setDownloadingBill(true);
    try {
      const bill = await adminOrders.bill(id);
      await downloadBill({ bill, labels: buildBillLabels(t), lang: i18n.language });
    } catch (err) {
      toast.error(
        t('bill.failedTitle', 'Couldn\'t make the bill'),
        err instanceof Error ? err.message : t('orderDetail.invoiceFailedBody'),
      );
    } finally {
      setDownloadingBill(false);
    }
  }

  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | ''>('');
  const [pendingKind, setPendingKind] = useState<'albaran' | 'invoice' | null>(null);
  /**
   * Why the last factura attempt was refused, kept on screen.
   *
   * A toast was carrying this and a toast is the wrong container for it: the
   * answer is a list of things to go and change on three different pages, and
   * it faded while the person was still reading the first one. It sits under
   * the header until the attempt succeeds.
   */
  const [facturaBlockers, setFacturaBlockers] = useState<InvoiceBlocker[]>([]);
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

  const [showStatusConfirm, setShowStatusConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
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
            onClick={() => goBack('/orders')}
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
    recargo_equivalencia?: boolean;
    total: number | string;
    created_at: string;
    payment_method: string;
    customer_notes: string | null;
    /** Derived from the parts by the API — a ParentOrder has no status column. */
    derived_status?: OrderStatus;
    user?: { name: string; email: string | null; phone: string | null; recargo_equivalencia?: boolean };
    address?: any;
    address_snapshot?: any;
    sub_orders?: Array<{
      id: string;
      order_number: string;
      status: OrderStatus;
      subtotal: number | string;
      delivery_fee: number | string;
      total: number | string;
      /** A purchase has no buyer_is_business of its own; its parts carry it. */
      buyer_is_business?: boolean | null;
      rider?: { id: string; name: string } | null;
      store?: { id: string; slug: string; name: string; logo_url?: string | null } | null;
      items?: Array<any>;
      _count?: { items: number };
      created_by_admin?: { id: string; name: string } | null;
      created_by_sales_rep?: { id: string; name: string } | null;
      /** What the rep who built this part earns from it (API lib/repEarnings). */
      rep_earning?: AdminRepOrderEarning | null;
    }>;
  };
  /**
   * A wholesale purchase nobody has priced yet. Same rule as a single order —
   * a business buyer whose fee is still zero — read off a part, because the
   * flag lives on the parts while the fee lives on the purchase.
   */
  const parentFeePending = deliveryFeeIsPending({
    delivery_fee: parentShape.delivery_fee_total,
  });

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
    const parentIssued = issuedInvoiceOf(parentShape);

    /**
     * Draft the document for the WHOLE purchase. The endpoint takes a parent
     * id as readily as an order id — it flattens the sub-orders into one
     * basket — so this is the same call the single-order buttons make.
     */
    const draftForPurchase = (kind: 'albaran' | 'invoice') => {
      createInvoice.mutate({ orderId: parentShape.id, kind }, {
        onSuccess: (res) => navigate(`/invoices/${res.invoice.id}`),
        onError: (err) => toast.error(
          kind === 'invoice'
            ? t('invoices.facturaBlocked', 'This order cannot be invoiced yet')
            : t('invoices.createFailed', 'Could not create the invoice'),
          err instanceof Error ? err.message : String(err),
        ),
      });
    };
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
          onClick={() => goBack('/orders')}
          className="mb-3"
        />

        <header className="bg-card rounded-xl border border-border shadow-card mb-6">
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
              {/* Read off the PARTS. A purchase is built once and then
                  stored as several Orders, so the parent row has no creator
                  column of its own — any part that names one names the same
                  person. */}
              <BuiltByLine row={parts.find((p) => p.created_by_sales_rep || p.created_by_admin)} />

              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                {parentShape.derived_status && <StatusBadge status={parentShape.derived_status} />}
                <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-semibold font-display bg-brand-mist text-brand">
                  <GitBranch size={12} strokeWidth={2} />
                  {t('orderDetail.partsBadge', { count: parts.length })}
                </span>
              </div>
            </div>

            {/* One albarán and one factura for the whole purchase. */}
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              {parentIssued ? (
                <button
                  type="button"
                  onClick={() => navigate(`/invoices/${parentIssued.id}`)}
                  className="h-10 px-4 rounded-xl text-sm font-semibold font-display border-2 border-brand/40 text-brand hover:bg-brand-mist/40 transition-colors inline-flex items-center gap-2"
                >
                  <Receipt size={16} strokeWidth={1.75} />
                  {parentIssued.invoice_number ?? t('invoices.viewInvoice', 'View invoice')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => { void handleDownloadBill(parentShape.id); }}
                disabled={downloadingBill}
                className="h-10 px-4 rounded-xl text-sm font-semibold font-display border-2 border-border text-ink hover:border-brand hover:bg-brand-mist/40 transition-colors inline-flex items-center gap-2 disabled:opacity-60 whitespace-nowrap"
              >
                {downloadingBill
                  ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />
                  : <ReceiptText size={16} strokeWidth={1.75} />}
                {t('bill.short', 'Bill')}
              </button>
              <button
                type="button"
                onClick={() => draftForPurchase('albaran')}
                disabled={createInvoice.isPending}
                className="h-10 px-4 rounded-xl text-sm font-semibold font-display border-2 border-border text-ink hover:border-brand hover:bg-brand-mist/40 transition-colors inline-flex items-center gap-2 disabled:opacity-60 whitespace-nowrap"
              >
                <FileText size={16} strokeWidth={1.75} />
                {t('invoices.createAlbaran', 'Albarán')}
              </button>
              <button
                type="button"
                onClick={() => draftForPurchase('invoice')}
                disabled={createInvoice.isPending}
                className="h-10 px-4 rounded-xl text-sm font-semibold font-display bg-brand hover:bg-brand-mid text-white transition-colors inline-flex items-center gap-2 disabled:opacity-60 whitespace-nowrap"
              >
                <Receipt size={16} strokeWidth={1.75} />
                {t('invoices.createFactura', 'Factura')}
              </button>
            </div>
          </div>

          <p className="px-4 sm:px-5 py-3 border-t border-border bg-surface-cream/50 rounded-b-xl text-[13px] text-gray">
            {t('orderDetail.partsExplainer')}
          </p>
        </header>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {parts.map((sub) => (
              <div key={sub.id} className="bg-card rounded-xl border border-border overflow-hidden">
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
                  <StatusBadge status={sub.status} />
                  <button
                    onClick={() => navigate(`/orders/${sub.id}`)}
                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold font-display text-brand hover:bg-brand-mist transition-colors shrink-0"
                    title={t('orderDetail.openPart')}
                  >
                    {t('orderDetail.openPart')}
                    <ChevronRight size={14} strokeWidth={2} />
                  </button>
                </div>

                <PartItems items={sub.items ?? []} purchaseId={parentShape.id} />

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

          <aside className="space-y-4">
            <PurchaseRepEarnings parts={parts.map((p) => ({ id: p.id, order_number: p.order_number, rep_earning: p.rep_earning ?? null }))} />
            <div className="bg-card rounded-xl border border-border p-5">
              <h2 className="text-sm font-bold font-display text-ink mb-3">{t('orderDetail.customer')}</h2>
              <p className="text-sm font-display text-ink">{parentShape.user?.name ?? '—'}</p>
              {parentShape.user?.phone && <p className="text-xs font-display text-muted mt-0.5">{parentShape.user.phone}</p>}
              {parentShape.user?.email && <p className="text-xs font-display text-muted mt-0.5 truncate">{parentShape.user.email}</p>}
            </div>

            {address && (
              <div className="bg-card rounded-xl border border-border p-5">
                <h2 className="text-sm font-bold font-display text-ink mb-3">{t('orderDetail.deliveryAddress')}</h2>
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
              <div className="bg-card rounded-xl border border-border p-5">
                <h2 className="text-sm font-bold font-display text-ink mb-3">{t('orderDetail.customerNotes')}</h2>
                <p className="text-sm font-body text-ink leading-relaxed">{parentShape.customer_notes}</p>
              </div>
            )}

            <div className="bg-card rounded-xl border border-border p-5">
              <h2 className="text-sm font-bold font-display text-ink mb-3">{t('orderDetail.orderSummary')}</h2>
              <dl className="space-y-1.5 text-sm font-display">
                <div className="flex justify-between"><dt className="text-muted">{t('orderDetail.subtotal')}</dt><dd className="text-ink font-mono">{formatCurrency(Number(parentShape.subtotal))}</dd></div>
                {/* EDITABLE HERE, AND ONLY HERE. A split basket is one
                    delivery — Cesto takes the whole package out — so the fee
                    is charged once, on the purchase, and each part carries
                    zero. The parts' own pages deliberately refuse it, and the
                    server refuses it there too.

                    Same state and same mutation as the single-order editor
                    below: `orderId` is this purchase's id, which the route
                    now accepts. */}
                <div className="flex justify-between items-center gap-2">
                  <dt className="text-muted">{t('orderDetail.deliveryFee')}</dt>
                  <dd className="text-ink font-mono">
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
                        <span className={parentFeePending ? 'text-amber-deep font-semibold' : ''}>
                          {parentFeePending
                            ? t('orderDetail.feeNotPriced', 'Not set yet — add it')
                            : formatCurrency(Number(parentShape.delivery_fee_total))}
                        </span>
                        <button
                          type="button"
                          onClick={() => { setFeeDraft(Number(parentShape.delivery_fee_total).toFixed(2)); setEditingFee(true); }}
                          className="text-xs font-semibold text-brand hover:underline"
                        >
                          {t('common.edit', 'Edit')}
                        </button>
                      </span>
                    )}
                  </dd>
                </div>
                {parentShape.recargo_equivalencia ? (
                  <div className="flex justify-between">
                    <dt className="text-muted">{t('orderDetail.recargo', 'Recargo de equivalencia')}</dt>
                    <dd className="flex items-center gap-2">
                      <span className="text-ink font-mono">{formatCurrency(Number(parentShape.recargo ?? 0))}</span>
                      <button
                        type="button"
                        onClick={() => toggleRecargo(parentShape.id, false)}
                        disabled={setRecargo.isPending}
                        className="text-xs font-semibold text-brand hover:underline disabled:opacity-60"
                      >
                        {t('orderDetail.recargoRemove', 'Remove')}
                      </button>
                    </dd>
                  </div>
                ) : parentShape.user?.recargo_equivalencia ? (
                  <div className="rounded-lg border border-warning/30 bg-warning-bg/60 px-3 py-2 text-xs text-ink flex items-center justify-between gap-3 flex-wrap">
                    <span>{t('orderDetail.recargoMissing', 'This customer is under recargo de equivalencia, but this was placed before.')}</span>
                    <button
                      type="button"
                      onClick={() => toggleRecargo(parentShape.id, true)}
                      disabled={setRecargo.isPending}
                      className="h-8 px-3 rounded-lg bg-brand text-white text-xs font-semibold disabled:opacity-60"
                    >
                      {t('orderDetail.recargoAdd', 'Add recargo')}
                    </button>
                  </div>
                ) : null}
                <div className="flex justify-between font-semibold pt-2 border-t border-border"><dt className="text-ink">{t('orderDetail.total')}</dt><dd className="text-ink font-mono">{formatCurrency(Number(parentShape.total))}</dd></div>
              </dl>
              <p className="text-xs font-display text-muted mt-3 uppercase tracking-wide">{parentShape.payment_method}</p>
            </div>

            {/* Deleting the WHOLE purchase, which is a different action from
                deleting one shop's part — that one lives on the part's own
                page. Both exist because both are real: a purchase cancelled
                outright goes in one piece, and one shop dropping out does
                not take the rest with it. The server takes every part in a
                single transaction, so a purchase can never end up half
                deleted. */}
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
              <div className="flex items-start gap-3 mb-3">
                <AlertTriangle size={18} strokeWidth={2} className="text-danger shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-danger font-display">{t('orderDetail.dangerZone')}</p>
                  <p className="text-xs text-danger/80 font-display mt-1 leading-relaxed">
                    {t('orderDetail.deletePurchaseHint', {
                      count: parentShape.sub_orders?.length ?? 0,
                      defaultValue: 'Deletes the whole purchase — all {{count}} shop orders at once. To drop just one shop, open that part and delete it there.',
                    })}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="w-full h-11 rounded-xl text-sm font-semibold font-display text-danger border-2 border-danger/40 bg-card hover:bg-danger hover:text-white hover:border-danger transition-colors inline-flex items-center justify-center gap-2"
              >
                <Trash2 size={16} strokeWidth={1.75} />
                {t('orderDetail.deletePurchase', 'Delete whole purchase')}
              </button>
            </div>
          </aside>
        </div>

        <DeleteOrderModal
          open={showDeleteModal}
          orderNumber={parentShape.order_number}
          status={parentShape.derived_status}
          isSubmitting={deleteOrder.isPending}
          errorMessage={deleteOrder.isError ? (deleteOrder.error instanceof Error ? deleteOrder.error.message : null) : null}
          onConfirm={({ reason }) => {
            deleteOrder.mutate({ id: parentShape.id, reason }, {
              onSuccess: () => {
                toast.success(
                  t('orderDetail.deleteSuccessTitle'),
                  t('orderDetail.deleteSuccessBody', { orderNumber: parentShape.order_number }),
                );
                goBack('/orders');
              },
            });
          }}
          onCancel={() => { if (!deleteOrder.isPending) setShowDeleteModal(false); }}
        />
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
    /** Wholesale buyer: a zero fee means "not priced yet", not "free". */
    buyer_is_business?: boolean | null;
    total: number;
    cancelled_reason?: string | null;
    customer_notes?: string | null;
    admin_notes?: string | null;
    created_by_admin?: { id: string; name: string } | null;
    created_by_sales_rep?: { id: string; name: string } | null;
    /** What the rep who built it earns from it (API lib/repEarnings). */
    rep_earning?: AdminRepOrderEarning | null;
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
  const built = o as {
    created_by_admin_id?: string | null;
    created_by_sales_rep_id?: string | null;
  };
  const ordersList = built.created_by_admin_id || built.created_by_sales_rep_id
    ? '/orders?book=rashan'
    : '/orders';

  const backTarget = parentId ? `/orders/${parentId}` : ordersList;

  // The disc behind the order icon takes the status's own colours, so the
  // state is stated once and cannot drift from the badge beside it.
  // Summed from the lines rather than stored on the order: the discount is a
  // per-line fact, and a second column on Order would be a copy that can drift
  // from the lines that produced it.
  const totalDiscount = (o.items ?? []).reduce(
    (sum: number, it: any) => sum + Number(it.discount_amount ?? 0), 0,
  );

  const statusTint = statusConfig[o.status] ?? { bg: 'bg-surface-linen', text: 'text-muted' };


  const availableStatuses = getAvailableStatuses(o.status);
  // Admin is the ops backstop — allowed to cancel through on_the_way even
  // though it's edge-case (rider en route). Matches ALLOWED_TRANSITIONS on
  // the API. Delivered / already-cancelled remain terminal.
  const canCancel = ['pending', 'confirmed', 'preparing', 'on_the_way', 'draft'].includes(o.status);
  const canDelete = !o.deleted_at;
  // An issued invoice is immutable and states this order's totals, so the
  // order behind it is frozen too — items AND delivery fee. The server
  // refuses either (editOrder + the fee route, both 409); this is so the
  // screen stops offering them. Permissive if the field is absent: a
  // frontend deployed ahead of the API falls back to today's behaviour,
  // where the button shows and the server does the refusing.
  // Two different questions off one projection. `anyIssued` is "a document
  // already exists", which decides whether the Invoice button creates or
  // links — a partial unique index allows only one issued non-credit-note
  // per order, so offering a second is always an error. `lockedBy` is "the
  // order is frozen", which only a FACTURA does; an albarán is a quote and
  // the order behind it stays editable.
  const orderInvoices = o as { invoices?: IssuedInvoiceRef[] | null };
  const anyIssued = issuedInvoiceOf(orderInvoices);
  const lockedBy = lockingInvoiceOf(orderInvoices);

  // Narrower than canCancel — editing items is only safe before the order
  // has left the store. A draft our team built (staff, a rep or Home Grocery)
  // is editable too (2026-11-04); a checkout draft is not. One rule, shared
  // with the edit screen (packages/shared orderEditing.ts).
  const canEdit = staffCanEditOrder(o) && !lockedBy;
  const riderRequired = selectedStatus === 'on_the_way' || selectedStatus === 'delivered';
  const riderMissing = riderRequired && !o.rider;
  const phoneClean = (o.address_snapshot?.contact_phone ?? o.user?.phone ?? '').replace(/\s+/g, '');

  const onConfirmStatus = () => {
    if (!selectedStatus || !o.id) return;
    updateStatus.mutate(
      { id: o.id, status: selectedStatus as OrderStatus },
      { onSettled: () => { setShowStatusConfirm(false); setSelectedStatus(''); } },
    );
  };

  const onConfirmCancel = () => {
    // Fall back to a generic marker if admin skipped the field — the API
    // stores this on cancelled_reason and the customer email renders it,
    // so leaving it blank would produce an empty "Reason: " line.
    const reason = cancelReason.trim() || 'Cancelled by Cesto admin';
    const key = newProgressKey();
    setCancelKey(key);
    setCancelPanelUp(false);
    updateStatus.mutate(
      { id: o.id, status: 'cancelled', reason, progressKey: key },
      {
        onSuccess: () => { setShowCancelConfirm(false); setCancelReason(''); },
        // Modal stays open on failure so admin can retry without re-typing.
      },
    );
  };

  const onConfirmDelete = ({ reason }: { reason?: string }) => {
    deleteOrder.mutate(
      { id: o.id, reason },
      {
        onSuccess: () => {
          toast.success(t('orderDetail.deleteSuccessTitle'), t('orderDetail.deleteSuccessBody', { orderNumber: o.order_number }));
          // Same reasoning as backTarget: hiding one part of a purchase leaves
          // the rest of it, and that is what the admin needs to look at next.
          goBack(backTarget);
        },
        // Modal stays open on failure so admin can see the error and retry.
      },
    );
  };

  const onSaveNotes = () => {
    updateNotes.mutate({ id: o.id, adminNotes });
  };

  const onAssignRider = (riderId: string) => {
    assignRider.mutate({ id: o.id, riderId: riderId || null });
  };

  /**
   * The actions that are not the primary one. Declared once and rendered
   * twice — as buttons from lg, as menu items below it — because two hand-kept
   * lists of the same actions drift the moment one gains a third.
   */
  const secondaryActions: Array<{
    key: string; label: string; icon: React.ReactNode;
    disabled?: boolean; onClick: () => void;
  }> = [
    {
      key: 'download',
      label: downloadingInvoice ? t('orderDetail.generatingInvoice') : t('orderDetail.downloadInvoice'),
      icon: downloadingInvoice
        ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin text-gray shrink-0" />
        : <FileDown size={16} strokeWidth={1.75} className="text-gray shrink-0" />,
      disabled: downloadingInvoice,
      onClick: () => { void handleDownloadInvoice(); },
    },
    // Always offered — after a factura too, and on a part (it bills the whole
    // purchase): it is not a fiscal document and locks nothing.
    {
      key: 'bill',
      label: downloadingBill ? t('orderDetail.generatingInvoice') : t('bill.download', 'Download bill'),
      icon: downloadingBill
        ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin text-gray shrink-0" />
        : <ReceiptText size={16} strokeWidth={1.75} className="text-gray shrink-0" />,
      disabled: downloadingBill,
      onClick: () => { void handleDownloadBill(o.id); },
    },
    // The issued document, unless it is already the primary button.
    ...(anyIssued && !lockedBy ? [{
      key: 'view-issued',
      label: anyIssued.invoice_number ?? t('invoices.viewInvoice', 'View invoice'),
      icon: <Receipt size={16} strokeWidth={1.75} className="text-gray shrink-0" />,
      onClick: () => navigate(`/invoices/${anyIssued.id}`),
    }] : []),
  ];

  /**
   * Draft a document of a named kind.
   *
   * Both are offered rather than derived. Eligibility is not obligation: a rep
   * may want an albarán for an order that could perfectly well be invoiced,
   * because the customer has not agreed to be billed yet. And when a factura
   * is refused the server now names every blocker, which is more use than
   * silently handing back an albarán and leaving the admin to wonder.
   */
  const draftDocument = (kind: 'albaran' | 'invoice') => {
    setPendingKind(kind);
    setFacturaBlockers([]);
    createInvoice.mutate(
      { orderId: o.id, kind },
      {
        onSuccess: (res) => navigate(`/invoices/${res.invoice.id}`),
        onError: (err) => {
          // The 422 carries the blockers as data, not just prose. Prefer it.
          const rows = (err as { data?: { blockers?: InvoiceBlocker[] } })?.data?.blockers;
          if (kind === 'invoice' && rows?.length) {
            setFacturaBlockers(rows);
            return;
          }
          toast.error(
            kind === 'invoice'
              ? t('invoices.facturaBlocked', 'This order cannot be invoiced yet')
              : t('invoices.createFailed', 'Could not create the invoice'),
            err instanceof Error ? err.message : String(err),
          );
        },
        onSettled: () => setPendingKind(null),
      },
    );
  };

  const busy = (kind: 'albaran' | 'invoice') => createInvoice.isPending && pendingKind === kind;

  /**
   * A part of a split purchase carries no document of its own.
   *
   * The customer made ONE purchase; billing them per shop would hand them
   * three albaranes for one basket. The documents live on the parent, so this
   * part offers the way there instead of a second set of buttons that would
   * produce exactly the thing we are trying to stop.
   */
  const primaryAction = parentId ? (
    <button
      type="button"
      onClick={() => navigate(`/orders/${parentId}`)}
      className="flex-1 lg:flex-none h-11 sm:h-10 px-4 sm:px-5 whitespace-nowrap rounded-xl text-sm font-semibold font-display border-2 border-brand/40 text-brand hover:bg-brand-mist/40 transition-colors inline-flex items-center justify-center gap-2"
    >
      <Receipt size={16} strokeWidth={1.75} />
      {t('orderDetail.documentsOnPurchase', 'Documents are on the full order')}
    </button>
  ) : lockedBy ? (
    <button
      onClick={() => navigate(`/invoices/${lockedBy.id}`)}
      className="flex-1 lg:flex-none h-11 sm:h-10 px-4 sm:px-5 whitespace-nowrap rounded-xl text-sm font-semibold border-2 border-brand/40 text-brand hover:bg-brand-mist/40 transition-colors inline-flex items-center justify-center gap-2"
    >
      <Receipt size={16} strokeWidth={1.75} />
      {lockedBy.invoice_number ?? t('invoices.viewInvoice', 'View invoice')}
    </button>
  ) : (
    <>
      <button
        onClick={() => draftDocument('albaran')}
        disabled={createInvoice.isPending}
        className="flex-1 lg:flex-none h-11 sm:h-10 px-4 sm:px-5 whitespace-nowrap rounded-xl text-sm font-semibold font-display border-2 border-border text-ink hover:border-brand hover:bg-brand-mist/40 transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {busy('albaran')
          ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />
          : <FileText size={16} strokeWidth={1.75} />}
        {anyIssued?.kind === 'albaran'
          ? t('invoices.reissue', 'New albarán')
          : t('invoices.createAlbaran', 'Albarán')}
      </button>
      <button
        onClick={() => draftDocument('invoice')}
        disabled={createInvoice.isPending}
        className="flex-1 lg:flex-none h-11 sm:h-10 px-4 sm:px-5 whitespace-nowrap rounded-xl text-sm font-semibold font-display bg-brand hover:bg-brand-mid text-white transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {busy('invoice')
          ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />
          : <Receipt size={16} strokeWidth={1.75} />}
        {t('invoices.createFactura', 'Factura')}
      </button>
    </>
  );

  return (
    <div>
      {/* Same shape as the customer page: a labelled way back, then one card
          that says what this is, what state it is in, and the thing you came
          to do. The status drives the colour of the disc, so the state is
          carried by the most visible element rather than only a chip. */}
      <BackLink
        label={parentId ? t('orderDetail.backToFullOrder') : t('common.backToOrders', 'Back to orders')}
        onClick={() => goBack(backTarget)}
        className="mb-3"
      />

      {/* WHAT THE LAST EDIT SPUN OFF.
          A cross-shop add moves those items onto a sibling order under a
          shared parent, so the order you were editing legitimately gets
          shorter. Held until dismissed rather than toasted: there is
          somewhere to go about it, and a message that fades while you are
          still reading the first line is how it went unnoticed. */}
      {spunOff.length > 0 && (
        <section className="rounded-xl border border-brand/30 bg-brand-mist/40 p-4 mb-6">
          <div className="flex items-start gap-2.5">
            <GitBranch size={17} strokeWidth={1.75} className="text-brand shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold font-display text-ink">
                {t('orderEdit.splitOff', 'Part of this order moved to another shop')}
              </p>
              <p className="text-xs font-body text-gray mt-0.5">
                {t('orderEdit.splitOffWhy', 'A shop can only deliver its own goods, so those items are now their own order. The customer still pays for one purchase.')}
              </p>
              <ul className="mt-2.5 space-y-1.5">
                {spunOff.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/orders/${n.id}`)}
                      className="inline-flex items-center gap-1.5 text-[13px] font-semibold font-display text-brand hover:underline"
                    >
                      <span className="font-mono">{n.order_number}</span>
                      {n.store_name && (
                        <span className="font-body font-normal text-gray">{' \u00b7 '}{n.store_name}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setSpunOff([])}
                className="mt-3 text-xs font-semibold font-display text-gray hover:text-ink transition-colors"
              >
                {t('common.dismiss', 'Dismiss')}
              </button>
            </div>
          </div>
        </section>
      )}

      {facturaBlockers.length > 0 && (
        <section className="rounded-xl border border-danger/30 bg-danger-bg p-4 mb-6">
          <div className="flex items-start gap-2.5">
            <AlertCircle size={17} strokeWidth={1.75} className="text-danger shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold font-display text-ink">
                {t('invoices.facturaBlocked', 'This order cannot be invoiced yet')}
              </p>
              <p className="text-xs font-body text-gray mt-0.5">
                {t('invoices.facturaBlockedWhy', 'Resolve the points below, or switch this draft to an albarán.')}
              </p>
              <ul className="mt-2.5 space-y-1.5">
                {facturaBlockers.map((b) => (
                  <li key={b.code} className="text-[13px] font-body text-ink flex gap-2">
                    <span aria-hidden="true" className="text-danger">{'\u2022'}</span>
                    <span>{blockerText(b)}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setFacturaBlockers([])}
                className="mt-3 text-xs font-semibold font-display text-gray hover:text-ink transition-colors"
              >
                {t('common.dismiss', 'Dismiss')}
              </button>
            </div>
          </div>
        </section>
      )}

      <header className="bg-card rounded-xl border border-border shadow-card mb-6">
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
                <p className="text-[13px] text-gray mt-1.5 truncate">
                  {o.user?.name ?? o.address_snapshot?.contact_name ?? '\u2014'}
                  {o.created_at && (
                    <span className="text-muted">
                      {'  \u00b7  '}
                      {new Date(o.created_at).toLocaleDateString(i18n.language === 'en' ? 'en-GB' : 'es-ES', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </span>
                  )}
                </p>
                {/* Its own line rather than a fourth fact appended to the
                    one above: that line truncates, and the name of the person
                    to ring is not the part to lose on a phone. */}
                <BuiltByLine row={o} />
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
                      className="h-10 px-4 rounded-xl text-sm font-semibold font-display border-2 border-border text-ink hover:border-brand hover:bg-brand-mist/40 transition-colors inline-flex items-center gap-2 disabled:opacity-50"
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
                      className="absolute right-0 mt-2 w-64 bg-card border border-border rounded-xl shadow-modal z-30 overflow-hidden"
                    >
                      {secondaryActions.map((a, i) => (
                        <button
                          key={a.key}
                          type="button"
                          role="menuitem"
                          onClick={() => { setActionsOpen(false); a.onClick(); }}
                          disabled={a.disabled}
                          className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-brand-mist/40 disabled:opacity-60 text-left transition-colors ${
                            i > 0 ? 'border-t border-border' : ''
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
              {o.rashan_subscription_id ? <PlanDeliveryStatus status={o.status as PlanRowStatus} cancelledReason={o.cancelled_reason} /> : <StatusBadge status={o.status} />}
              {(o as any).parent_order && (
                <button
                  onClick={() => navigate(`/orders/${(o as any).parent_order.id}`)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-brand-mist text-brand text-xs font-semibold font-display hover:bg-brand hover:text-white transition-colors"
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
            matters, because the way out is a credit note, not a retry. It is
            the card's foot now rather than a box below it: it is a fact about
            this order, like a block is a fact about a customer. */}
        {lockedBy && (
          <div className="px-4 sm:px-5 py-3 bg-brand-whisper border-t border-brand/15 lg:rounded-b-xl flex items-start gap-2.5">
            <Lock size={16} strokeWidth={1.75} className="text-brand shrink-0 mt-0.5" />
            <div className="min-w-0 text-[13px]">
              <p className="font-semibold text-ink">
                {t('orderDetail.lockedTitle', 'This order is closed by an issued invoice')}
              </p>
              <p className="text-gray mt-0.5">
                {t('orderDetail.lockedBody', 'Items and the delivery fee can no longer be changed, because {{n}} states these totals and cannot be altered. A correction goes out as a credit note.', { n: lockedBy.invoice_number ?? '\u2014' })}
              </p>
            </div>
          </div>
        )}

        {/* lg, not sm: the inline cluster above starts at lg, so anything
            narrower needs the primary action here or it has nowhere to be. */}
        <div className="lg:hidden border-t border-border rounded-b-xl p-3 flex items-center gap-2">
          {primaryAction}
        </div>
      </header>

      {/* A Home Grocery order: say so, say its day and part of the day, and
          — until preparing starts — let it move (the API's changeOrderSlot). */}
      {o.rashan_subscription_id && (
        <section className="-mt-3 mb-6 rounded-xl border border-success/25 bg-success-bg/60 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span className="w-9 h-9 rounded-lg bg-card text-success flex items-center justify-center shrink-0">
              <ShoppingBasket size={18} strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold font-display text-ink">
                {t('orderDetail.hgOrder', 'Home Grocery order')}
                {o.scheduled_for && (
                  <span className="font-normal text-gray">
                    {' · '}
                    {planDate(o.scheduled_for, i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}
                    {', '}
                    {o.delivery_window
                      ? `${t(`hgPlan.window.${o.delivery_window}`, o.delivery_window).toLowerCase()} (${WINDOW_HOURS[o.delivery_window]})`
                      : t('hgPlan.schedule.anyTime', 'Any time').toLowerCase()}
                  </span>
                )}
              </p>
              <p className="text-[12.5px] font-body text-gray mt-0.5">
                {o.status === 'draft'
                  ? t('orderDetail.hgDraftNote', 'A draft: it holds no stock until you confirm stock.')
                  : HG_SLOT_MOVABLE.includes(o.status)
                    ? t('orderDetail.hgOpenNote', 'The household can change its products, day and time until preparing starts.')
                    : t('orderDetail.hgFixedNote', 'Its day and time are fixed now that it is being prepared.')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            {o.scheduled_for && HG_SLOT_MOVABLE.includes(o.status) && (
              <button
                type="button"
                onClick={() => setMovingSlot(true)}
                className="h-10 px-4 rounded-lg bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display transition-colors"
              >
                {t('hgSlot.changeTitle', 'Change day and time')}
              </button>
            )}
            {o.user?.id && (
              <button
                type="button"
                onClick={() => navigate(`/customers/${o.user!.id}`)}
                className="h-10 px-4 rounded-lg bg-card border border-border text-sm font-semibold font-display text-ink hover:border-brand hover:text-brand transition-colors"
              >
                {t('orderDetail.openPlan', 'Their delivery information')}
              </button>
            )}
          </div>
        </section>
      )}
      {movingSlot && o.rashan_subscription_id && (
        <ChangeSlotModal
          orderId={o.id}
          scheduledFor={o.scheduled_for ?? null}
          deliveryWindow={o.delivery_window}
          preferredWeekday={null}
          onClose={() => setMovingSlot(false)}
        />
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: items + summary */}
        <div className="lg:col-span-2 space-y-6">
          <OrderItemsCard
            items={o.items ?? []}
            orderId={o.id}
            canEdit={canEdit}
            onEditOrder={() => navigate(`/orders/${orderId}/edit`)}
          />

          <div className="bg-card rounded-xl border border-border p-5">
            <h2 className="text-base font-bold font-display text-ink mb-4">{t('orderDetail.orderSummary')}</h2>
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
                  // Wraps under itself on a phone, the amount kept whole —
                  // "0,00 €" broke across two lines beside its note (2026-11-05).
                  <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-right">
                    <span className={`whitespace-nowrap ${deliveryFeeIsPending(o) ? 'text-amber-deep font-semibold' : 'text-ink'}`}>
                      {/* THE CUE THAT MAKES THE FLOW WORK. The storefront
                          prices no delivery (every customer order since
                          2026-10-23), so this order is waiting for somebody
                          here to put a number on it — and the customer has
                          been told exactly that, and is told again when it
                          is set. Showing "Free" would tell the one person who
                          can act that there is nothing to do. */}
                      {deliveryFeeIsPending(o)
                        ? t('orderDetail.feeNotPriced', 'Not set yet — add it')
                        : formatCurrency(Number(o.delivery_fee))}
                    </span>
                    {/* NOT ON A PART of a split purchase. One delivery is
                        charged once, on the purchase, so the server refuses a
                        fee here — and an Edit button that saves into an error
                        toast is a worse way to learn that than not offering
                        one. The purchase is linked a few lines above. */}
                    {parentId ? (
                      <span className="text-xs text-muted">
                        {t('orderDetail.feeOnPurchase', 'Charged on the whole purchase')}
                      </span>
                    ) : canEdit ? (
                      <button
                        type="button"
                        onClick={() => { setFeeDraft(Number(o.delivery_fee).toFixed(2)); setEditingFee(true); }}
                        className="text-xs font-semibold text-brand hover:underline py-2 -my-2"
                      >
                        {t('common.edit', 'Edit')}
                      </button>
                    ) : null}
                  </span>
                )}
              </div>
              {/* Recargo de equivalencia (2026-11-04): charged on top of IVA
                  for a customer under the regime — a part of a split purchase
                  carries none (the purchase does). */}
              {(() => {
                const charged = !!o.recargo_equivalencia && !parentId;
                const customerUnder = !!(o.user as { recargo_equivalencia?: boolean } | null | undefined)?.recargo_equivalencia;
                // Changeable exactly when the delivery fee is; a part's is the purchase's.
                const changeable = canEdit && !parentId;
                if (charged) {
                  return (
                    <div className="flex justify-between text-sm font-display">
                      <span className="text-gray">{t('orderDetail.recargo', 'Recargo de equivalencia')}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-ink">{formatCurrency(Number(o.recargo ?? 0))}</span>
                        {changeable && (
                          <button
                            type="button"
                            onClick={() => toggleRecargo(o.id, false)}
                            disabled={setRecargo.isPending}
                            className="text-xs font-semibold text-brand hover:underline disabled:opacity-60"
                          >
                            {t('orderDetail.recargoRemove', 'Remove')}
                          </button>
                        )}
                      </span>
                    </div>
                  );
                }
                // The case this is for: put under the regime after ordering.
                if (customerUnder && changeable) {
                  return (
                    <div className="rounded-lg border border-warning/30 bg-warning-bg/60 px-3 py-2 text-xs text-ink flex items-center justify-between gap-3 flex-wrap">
                      <span>{t('orderDetail.recargoMissing', 'This customer is under recargo de equivalencia, but this was placed before.')}</span>
                      <button
                        type="button"
                        onClick={() => toggleRecargo(o.id, true)}
                        disabled={setRecargo.isPending}
                        className="h-8 px-3 rounded-lg bg-brand text-white text-xs font-semibold disabled:opacity-60"
                      >
                        {t('orderDetail.recargoAdd', 'Add recargo')}
                      </button>
                    </div>
                  );
                }
                return null;
              })()}
              <div className="border-t border-border pt-2 flex justify-between">
                <span className="text-lg font-bold font-display text-ink">{t('orderDetail.total')}</span>
                <span className="text-lg font-bold font-display text-ink">{formatCurrency(Number(o.total))}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: actions */}
        <div className="space-y-6">
          {/* What the rep who built it earns from it — approved here once delivered. */}
          {o.rep_earning && <RepOrderEarningCard orderId={o.id} earning={o.rep_earning} canEdit={isSuperAdmin} />}
          {/* Status */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <Truck size={18} strokeWidth={1.75} className="text-brand" />
              <h2 className="text-base font-bold font-display text-ink">{t('orderDetail.statusManagement')}</h2>
            </div>
            <div className="mb-3">
              <p className="text-xs font-display text-gray uppercase tracking-wider mb-1">{t('orderDetail.currentStatus')}</p>
              {o.rashan_subscription_id ? <PlanDeliveryStatus status={o.status as PlanRowStatus} cancelledReason={o.cancelled_reason} /> : <StatusBadge status={o.status} />}
            </div>
            {availableStatuses.length > 0 && (
              <>
                <div className="mb-3">
                  <label className="text-xs font-display text-gray uppercase tracking-wider mb-1 block">{t('orderDetail.changeTo')}</label>
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value as OrderStatus)}
                    className="w-full h-10 bg-surface-cream border border-border rounded-lg px-3 text-sm font-display text-ink appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand/30"
                  >
                    <option value="">{t('orderDetail.selectStatus')}</option>
                    {availableStatuses.map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => selectedStatus && setShowStatusConfirm(true)}
                  disabled={!selectedStatus || updateStatus.isPending || riderMissing}
                  className="w-full h-[52px] rounded-xl text-sm font-semibold font-display text-white bg-brand hover:bg-brand-mid transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  <CheckCircle size={16} strokeWidth={1.75} />
                  {t('orderDetail.updateStatus')}
                </button>
                {riderMissing && (
                  <p className="mt-2 text-xs font-body text-danger">
                    {t('orderDetail.riderRequiredForStatus')}
                  </p>
                )}
              </>
            )}
            {o.status === 'draft' && (
              <div className="mt-2">
                <p className="text-sm font-body text-ink/80 mb-3">
                  {o.rashan_subscription_id
                    ? t('orderDetail.hgDraftStockMsg', 'A Home Grocery order saved as a draft. Confirm stock when you start preparing it: that takes the stock.')
                    : t('orderDetail.draftStockMsg')}
                </p>
                <button
                  onClick={() => confirmDraftStock.mutate(o.id)}
                  disabled={confirmDraftStock.isPending}
                  className="w-full h-[52px] rounded-xl text-sm font-semibold font-display text-white bg-brand hover:bg-brand-mid transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  <CheckCircle size={16} strokeWidth={1.75} />
                  {t('orderDetail.confirmStock')}
                </button>
                {confirmDraftStock.isError && (
                  <p className="mt-2 text-xs font-body text-danger">
                    {confirmDraftStock.error instanceof Error ? confirmDraftStock.error.message : t('orderDetail.confirmStockFailed')}
                  </p>
                )}
              </div>
            )}
            {o.status === 'delivered' && (
              <p className="text-sm font-body text-success mt-2">{t('orderDetail.deliveredMsg')}</p>
            )}
            {o.status === 'cancelled' && (
              <div className="mt-2">
                <p className="text-sm font-body text-danger">{t('orderDetail.cancelledMsg')}</p>
                {o.cancelled_reason && (
                  <p className="text-xs font-body text-gray mt-1">
                    {t('orderDetail.reason')} {o.cancelled_reason}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Rider assignment — hide once the order is closed out */}
          {o.status !== 'delivered' && o.status !== 'cancelled' && (
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center gap-2 mb-4">
                <Truck size={18} strokeWidth={1.75} className="text-brand" />
                <h2 className="text-base font-bold font-display text-ink">{t('orderDetail.rider')}</h2>
              </div>
              {o.rider && (
                <div className="mb-3 p-3 rounded-lg bg-surface-cream">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold font-display text-sm">
                      {o.rider.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold font-display text-ink leading-tight">{o.rider.name}</p>
                      <p className="text-xs font-mono text-ink/60 leading-tight mt-0.5">{o.rider.phone}</p>
                    </div>
                  </div>
                </div>
              )}
              <label className="text-xs font-display text-gray uppercase tracking-wider mb-1 block">
                {o.rider ? t('orderDetail.changeRider') : t('orderDetail.assignRider')}
              </label>
              <select
                value={o.rider?.id ?? ''}
                onChange={(e) => onAssignRider(e.target.value)}
                disabled={assignRider.isPending}
                className="w-full h-10 bg-surface-cream border border-border rounded-lg px-3 text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-50"
              >
                <option value="">— {t('orderDetail.unassigned')} —</option>
                {(riders ?? []).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          )}
          {(o.status === 'delivered' || o.status === 'cancelled') && o.rider && (
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center gap-2 mb-4">
                <Truck size={18} strokeWidth={1.75} className="text-brand" />
                <h2 className="text-base font-bold font-display text-ink">{t('orderDetail.rider')}</h2>
              </div>
              <p className="text-sm font-display text-ink">{o.rider.name}</p>
              <p className="text-xs font-mono text-ink/60 mt-1">{o.rider.phone}</p>
            </div>
          )}

          {/* Customer */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <Phone size={18} strokeWidth={1.75} className="text-brand" />
              <h2 className="text-base font-bold font-display text-ink">{t('orderDetail.customer')}</h2>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-display text-gray uppercase tracking-wider mb-0.5">{t('orderDetail.customerName')}</p>
                <p className="text-sm font-display text-ink">{o.user?.name ?? o.address_snapshot?.contact_name ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs font-display text-gray uppercase tracking-wider mb-0.5">{t('orderDetail.phone')}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {/* Tap to call: on a phone this is how the office reaches
                      the customer from the road (2026-11-05). */}
                  {phoneClean ? (
                    <a href={`tel:${phoneClean}`} className="text-sm font-display text-ink underline decoration-border underline-offset-4 hover:decoration-brand py-1.5 -my-1.5">
                      {o.address_snapshot?.contact_phone ?? o.user?.phone}
                    </a>
                  ) : (
                    <p className="text-sm font-display text-ink">{o.address_snapshot?.contact_phone ?? o.user?.phone ?? '—'}</p>
                  )}
                  {phoneClean && (
                    <a
                      href={`https://wa.me/${phoneClean.replace('+', '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center h-8 px-3 rounded-full bg-brand-mist text-xs font-display font-semibold text-brand hover:bg-brand hover:text-white transition-colors"
                    >
                      WhatsApp
                    </a>
                  )}
                </div>
              </div>
              {o.address_snapshot && (
                <div>
                  <p className="text-xs font-display text-gray uppercase tracking-wider mb-0.5">{t('orderDetail.deliveryAddress')}</p>
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
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare size={18} strokeWidth={1.75} className="text-brand" />
              <h2 className="text-base font-bold font-display text-ink">{t('orderDetail.notes')}</h2>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-xs font-display text-gray uppercase tracking-wider mb-1">{t('orderDetail.customerNotes')}</p>
                <p className="text-sm font-body text-ink bg-surface-cream rounded-lg p-3">
                  {o.customer_notes || t('orderDetail.noCustomerNotes')}
                </p>
              </div>
              <div>
                <p className="text-xs font-display text-gray uppercase tracking-wider mb-1">{t('orderDetail.adminNotes')}</p>
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
                  Save
                </button>
              </div>
            </div>
          </div>

          {/* Cancel */}
          {canCancel && (
            <div className="bg-card rounded-xl border border-border p-5">
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="w-full h-[52px] rounded-xl text-sm font-semibold font-display text-white bg-danger hover:bg-danger/90 transition-colors inline-flex items-center justify-center gap-2"
              >
                <XCircle size={16} strokeWidth={1.75} />
                {t('orderDetail.cancelOrder')}
              </button>
            </div>
          )}

          {/* Danger zone — soft-delete. Separate, more severe visual
              treatment than Cancel since it hides the order everywhere,
              including revenue/order-count stats, not just its own status. */}
          {canDelete && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
              <div className="flex items-start gap-3 mb-3">
                <AlertTriangle size={18} strokeWidth={2} className="text-danger shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-danger font-display">{t('orderDetail.dangerZone')}</p>
                  <p className="text-xs text-danger/80 font-display mt-1 leading-relaxed">{t('orderDetail.dangerZoneHint')}</p>
                </div>
              </div>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="w-full h-11 rounded-xl text-sm font-semibold font-display text-danger border-2 border-danger/40 bg-card hover:bg-danger hover:text-white hover:border-danger transition-colors inline-flex items-center justify-center gap-2"
              >
                <Trash2 size={16} strokeWidth={1.75} />
                {t('orderDetail.deleteOrder')}
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={showStatusConfirm}
        title={t('orderDetail.confirmStatusTitle')}
        message={t('orderDetail.confirmStatusMsg', {
          status: selectedStatus ? STATUS_LABELS[selectedStatus as OrderStatus] : '',
        })}
        confirmLabel={t('orderDetail.confirmStatusYes')}
        onConfirm={onConfirmStatus}
        onCancel={() => setShowStatusConfirm(false)}
      >
        {/* The API lets an admin cancel an invoiced order on purpose — it is
            the only way out until credit notes exist, since every other
            actor is refused. It should not be a SILENT way out. Warn here,
            before the confirmation, so the person choosing it knows a
            correction is now owed rather than discovering it at the audit. */}
        {lockedBy && selectedStatus === 'cancelled' && (
          <div className="rounded-xl border border-warning/40 bg-warning-bg/50 px-4 py-3 flex items-start gap-2.5">
            <AlertTriangle size={16} strokeWidth={1.75} className="text-warning shrink-0 mt-0.5" />
            <div className="min-w-0 text-sm">
              <p className="font-semibold font-display text-ink">
                {t('orderDetail.cancelInvoicedTitle', 'Invoice {{n}} has been issued for this order', { n: lockedBy.invoice_number ?? '—' })}
              </p>
              <p className="text-gray font-body mt-0.5">
                {t('orderDetail.cancelInvoicedBody', 'Cancelling does not withdraw it — that document stays valid and outstanding. You will need to issue a credit note for it by hand.')}
              </p>
            </div>
          </div>
        )}
      </ConfirmModal>

      {/* Cancelling a big order restocks every line: say so while it runs. */}
      {updateStatus.isPending && cancelKey && (
        <OrderProgressPanel
          key={cancelKey}
          kind="cancel"
          phase="server"
          progressKey={cancelKey}
          lang={i18n.language === 'es' ? 'es' : 'en'}
          detail={{ lines: o.items?.length }}
          onVisible={() => setCancelPanelUp(true)}
        />
      )}

      {/* Back once the cancel ends: a failure leaves it open to retry. */}
      <ConfirmModal
        open={showCancelConfirm && !(updateStatus.isPending && cancelPanelUp)}
        title={t('orderDetail.confirmCancelTitle')}
        message={t('orderDetail.confirmCancelMsg', { orderNumber: o.order_number })}
        confirmLabel={updateStatus.isPending
          ? t('orderDetail.confirmCancelPending', 'Cancelling…')
          : t('orderDetail.confirmCancelYes')}
        confirmDisabled={updateStatus.isPending}
        danger
        onConfirm={onConfirmCancel}
        onCancel={() => { if (!updateStatus.isPending) { setShowCancelConfirm(false); setCancelReason(''); } }}
      >
        <label className="text-[11px] font-semibold text-ink uppercase tracking-wider mb-1 block">
          {t('orderDetail.cancelReasonLabel', 'Reason (optional — visible to the customer)')}
        </label>
        <textarea
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder={t('orderDetail.cancelReasonPlaceholder', 'e.g. "Store closed early" or "Customer requested via phone"')}
          rows={3}
          className="w-full rounded-lg border border-border bg-surface-cream p-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-danger/30 resize-none"
          disabled={updateStatus.isPending}
        />
        <p className="mt-1.5 text-[11px] text-muted font-body">
          {o.status === 'draft'
            ? t('orderDetail.cancelReasonHintDraft')
            : t('orderDetail.cancelReasonHint', 'Items will be restocked automatically. The customer receives an email with your reason.')}
        </p>
      </ConfirmModal>

      <DeleteOrderModal
        open={showDeleteModal}
        orderNumber={o.order_number}
        status={o.status}
        isSubmitting={deleteOrder.isPending}
        errorMessage={deleteOrder.isError ? (deleteOrder.error instanceof Error ? deleteOrder.error.message : null) : null}
        onConfirm={onConfirmDelete}
        onCancel={() => { if (!deleteOrder.isPending) setShowDeleteModal(false); }}
      />

    </div>
  );
}
