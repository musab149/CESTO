import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Minus, Trash2, ShoppingCart, MapPin, Check, AlertTriangle, Loader2, Truck, Package,
  Maximize2, X, FileText,
  Building2, UserRound, Contact, Mail, Phone, ChevronDown, GitBranch, ShoppingBasket,
} from 'lucide-react';
import {
  useAdminUser, useAdminMe, useCreateAdminOrder, useAdminSettings, resolveImageUrl,
  useAdminOrderForEdit, useEditOrderItems, useSetOrderDeliveryFee, lockingInvoiceOf, staffCanEditOrder,
  basketKey, editBasketKey, editBaselineOf, nextNewKey, clearBasket, mergeSavedLines, readBasket, sweepBaskets,
  writeBasket,
  computeTaxBreakdown, VAT_RATES, isUncertainOutcome, recargoOnCents, type VatCategory, type Product,
  type OrderEditOperation, type EditOrderNewOrder, type IssuedInvoiceRef,
  type OrderStatus, type Order, MAX_ORDER_LINES, newProgressKey,
  discountEuros, previewLineTotal, previewSubtotal, useAdminHomeGroceryPlan,
  unitDiscountText, lineVatCategory, useAdminCustomerDiscounts, type PreviewLine,
  effectiveVatCategory, priceWithVat,
  adminOrders, useSetOrderItemCosts } from '@grocery-app/shared';
import { type PickedVariant } from '@/components/ProductPicker';
import BackLink from '@/components/BackLink';
import QuantityField from '@/components/QuantityField';
import OrderProgressPanel from '@/components/OrderProgressPanel';
import OrderProductPanel from '@/components/OrderProductPanel';
import DeliveryAddressModal from '@/components/DeliveryAddressModal';
import QuickCreateProductModal from '@/components/QuickCreateProductModal';
import ConfirmModal from '@/components/ConfirmModal';
import { TableSkeleton } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { formatCurrency } from '@/lib/format';
import StatusBadge from '@/components/StatusBadge';
import { useGoBack } from '@/lib/useGoBack';
import { useAdminAuthStore } from '@/stores/authStore';
import PlanSlotFields, { type SlotValue } from '@/components/home-grocery-plan/PlanSlotFields';
import { WINDOW_HOURS, madridToday, planDate, suggestedDay } from '@/components/home-grocery-plan/planFormat';

/**
 * Build an order for one client, on one screen.
 *
 * Routed under the customer (`/customers/:userId/orders/new`) rather than
 * living at `/orders/new` behind a client picker. A rep has just created this
 * person, or is looking at their page — asking them to search for the
 * customer they are sitting with is a step backwards, and the whole point of
 * this flow is that it does not send them wandering around admin.
 *
 * So everything is here: their addresses, the catalogue search, a way to
 * create a product that is not in the catalogue yet, the basket, and the
 * totals. The only navigation is in at the start and out at the end.
 */

interface BasketLine {
  /**
   * Identity of the ROW, which is not identity of the product.
   *
   * Creating, one line per variant is guaranteed — addVariant merges a repeat
   * into the existing line — so the variant id was identity enough. An order
   * being EDITED can carry the same variant on several lines, so keying the
   * quantity, discount and remove handlers on the variant would aim them at
   * whichever row matched first.
   */
  key: string;
  variantId: string;
  productName: string;
  variantName: string;
  unitPrice: number;
  quantity: number;
  storeId: string | null;
  storeName: string | null;
  imageUrl: string | null;
  /** Schema default is `reduced`; an older payload without it lands there
   *  too, which is the same answer the server would reach. */
  vatCategory: VatCategory;
  /** Set only while editing, on lines the order already had. Its absence is
   *  what makes a line an `add` rather than an `update_qty`. */
  orderItemId?: string;
  /**
   * Euros off ONE unit (2026-10-25 — "a €4 product with €2 off costs that
   * customer €2"), while creating as well as editing.
   *
   * Kept as the typed string, which is the edit modal's own reason: a
   * half-written "1." must not round-trip through a number and erase itself
   * while somebody is still typing. `discountEuros` is what reads it as
   * money, and `previewLineTotal` is what the line then costs.
   *
   * A NEW line shows the price agreed with this customer — their saved
   * discount for the product size — until somebody types into the field
   * (`discountTouched`). Only a typed figure is SENT, which saves it for the
   * customer (zero forgets it); a line nobody touched says nothing and the
   * server applies the saved one, so a list still loading can never clear a
   * customer's price.
   */
  discount?: string;
  discountTouched?: boolean;
  /** Shown from the customer's saved discount, not typed — see `discount`. */
  agreed?: boolean;
  /**
   * An order line discounted before discounts were per unit: its flat figure,
   * so it previews at what it actually costs until its quantity or discount
   * changes. From then on it is per unit, which is how the server reads it.
   */
  flatDiscount?: string;
  /**
   * The line's buying price, as typed ("2,40"; '' = 0). Starts at the size's
   * (the product's), or the line's own on an order being edited.
   */
  unitCost?: string;
  /**
   * Must be saved to the line after the order is: typed here, or following
   * a change made on the product's card. Lines whose buying price nobody
   * touched are left to the server, which copies the product's.
   */
  costChanged?: boolean;
}

/** A buying price as the basket shows and types it: "2,40", '' for none. */
function costText(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  return n > 0 ? n.toFixed(2).replace('.', ',') : '';
}
/** And read back: either separator; blank, junk or negative is 0. */
function costNumber(raw: string | undefined): number {
  const n = Number((raw ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

/** What the preview prices a line at: per unit, or an older line's flat figure. */
function previewOf(l: BasketLine): PreviewLine {
  return l.flatDiscount !== undefined
    ? { unitPrice: l.unitPrice, quantity: l.quantity, discount: l.flatDiscount }
    : { unitPrice: l.unitPrice, quantity: l.quantity, unitDiscount: l.discount ?? '' };
}

/** Everything the screen starts from when it is editing rather than building. */
interface Seed { lines: BasketLine[]; fee: number; notes: string; adminNotes: string }

/**
 * One line of an existing order, as the API sends it.
 *
 * Named here rather than imported: the admin order payload types `items`
 * loosely, and this is the one place that needs these fields.
 */
interface OrderItemRow {
  id: string;
  variant_id: string;
  quantity: number;
  unit_price: string | number;
  discount_amount: string | number | null;
  unit_discount?: string | number | null;
  /** The line's buying price (admin only). */
  unit_cost?: string | number;
  /** The IVA rate the line was charged with; null on lines from before 2026-11-01. */
  tax_rate_pct?: number | null;
  vat_category?: VatCategory;
  product_snapshot?: {
    name_es?: string;
    variant_name_es?: string;
    image_url?: string | null;
  } | null;
  product?: {
    store_id?: string | null; vat_category?: VatCategory | null; vat_category_reviewed?: boolean | null;
  } | null;
}

/**
 * The order, read as a basket.
 *
 * The discount comes back as the typed string it will be edited as — euros
 * off one unit — so a line that already carries one shows it rather than
 * silently clearing it on the first save.
 */
function seedFrom(order: {
  items?: unknown[]; delivery_fee: string | number;
  customer_notes?: string | null; admin_notes?: string | null;
}): Seed {
  return {
    lines: ((order.items ?? []) as OrderItemRow[]).map((it) => ({
      key: it.id,
      orderItemId: it.id,
      variantId: it.variant_id,
      productName: it.product_snapshot?.name_es ?? '',
      variantName: it.product_snapshot?.variant_name_es ?? '',
      unitPrice: Number(it.unit_price),
      quantity: it.quantity,
      storeId: it.product?.store_id ?? null,
      storeName: null,
      imageUrl: it.product_snapshot?.image_url ?? null,
      vatCategory: lineVatCategory(it),
      unitCost: costText(it.unit_cost),
      discount: unitDiscountText(it),
      ...(Number(it.unit_discount ?? 0) <= 0 && Number(it.discount_amount ?? 0) > 0
        ? { flatDiscount: String(Number(it.discount_amount)) }
        : {}),
    })),
    fee: Number(order.delivery_fee),
    notes: order.customer_notes ?? '',
    adminNotes: order.admin_notes ?? '',
  };
}

interface Shortfall { productName: string; needed: number; available: number }

function shortfallsFrom(err: unknown): Shortfall[] | null {
  if (!err || typeof err !== 'object') return null;
  const data = (err as { data?: { shortfalls?: unknown } }).data;
  if (data && Array.isArray(data.shortfalls)) return data.shortfalls as Shortfall[];
  return null;
}

/**
 * One line of the basket.
 *
 * Module level, not a closure inside the page, so the enlarged dialog renders
 * the same rows instead of a second copy that drifts — and so a re-render does
 * not remount every thumbnail.
 */
function BasketRow({ l, index, showStore, onDec, onInc, onSet, onRemove, onDiscount, onCost }: {
  l: BasketLine;
  index: number;
  showStore: boolean;
  onDec: () => void;
  onInc: () => void;
  /** A typed quantity. Stock is checked when the order is saved. */
  onSet: (n: number) => void;
  onRemove: () => void;
  /**
   * Euros off one unit (per unit since 2026-10-25), on BOTH screens since
   * 2026-10-10.
   *
   * It used to be edit-only, because creating could not carry a discount —
   * so a rep who agreed a price at the counter placed the order and then
   * edited it, which wrote the discount into the edit log as though they had
   * changed their mind afterwards. createOrder takes one now.
   *
   * Still optional: its absence is what keeps the control off a screen that
   * has no business offering it, rather than a mode flag this component has
   * to be told about.
   */
  onDiscount?: (raw: string) => void;
  /** The line's buying price, this order only (admin; 2026-10-27). */
  onCost?: (raw: string) => void;
}) {
  const { t } = useTranslation();
  return (
              <li className="flex gap-3 py-3">
                <span className="w-5 shrink-0 pt-0.5 text-xs font-semibold text-muted tabular-nums">
                  {index + 1}
                </span>
                {/* The thumbnail is the anchor. A rep checking a basket
                    against what is on the counter matches packaging far
                    faster than they read a column of near-identical
                    names. */}
                <span className="w-11 h-11 rounded-lg bg-surface-cream border border-border shrink-0 overflow-hidden flex items-center justify-center">
                  {l.imageUrl
                    ? <img src={resolveImageUrl(l.imageUrl)} alt="" className="w-full h-full object-cover" draggable={false} />
                    : <Package size={17} strokeWidth={1.75} className="text-muted" />}
                </span>
    
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink leading-snug line-clamp-2">
                    {l.productName}
                  </p>
                  {/* Stepper and unit price read as one phrase, so the
                      number beside it is plainly a rate and not a second
                      opinion about the total. */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mt-1.5">
                    {/* Thumb-sized on a phone (36px; was 24px — the most
                        tapped control when editing an order on the road,
                        2026-11-05); compact again from sm. */}
                    <div className="flex items-center gap-1.5 sm:gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={onDec}
                        disabled={l.quantity <= 1}
                        aria-label={t('orderCreate.decrease', 'Decrease')}
                        className="w-9 h-9 sm:w-7 sm:h-7 rounded-lg sm:rounded-md border border-border bg-card flex items-center justify-center disabled:opacity-40 hover:border-brand transition-colors"
                      >
                        <Minus size={14} strokeWidth={2.5} className="sm:w-3 sm:h-3" />
                      </button>
                      <QuantityField
                        value={l.quantity}
                        max={Infinity}
                        onChange={onSet}
                        label={t('orderCreate.colQty', 'Qty')}
                        className="min-w-7 sm:min-w-5 text-sm sm:text-xs font-bold text-ink"
                      />
                      <button
                        type="button"
                        onClick={onInc}
                        aria-label={t('orderCreate.increase', 'Increase')}
                        className="w-9 h-9 sm:w-7 sm:h-7 rounded-lg sm:rounded-md border border-border bg-card flex items-center justify-center hover:border-brand transition-colors"
                      >
                        <Plus size={14} strokeWidth={2.5} className="sm:w-3 sm:h-3" />
                      </button>
                    </div>
                    <span className="text-[11px] text-muted tabular-nums truncate">
                      {'\u00d7 '}{formatCurrency(l.unitPrice)}
                      {showStore && (
                        <span>{' \u00b7 '}{l.storeName ?? t('orderCreate.cestoShop', 'Cesto Shop')}</span>
                      )}
                    </span>

                  {/* The per-line discount the edit modal had. Without it,
                      moving editing onto this screen would have quietly taken
                      a capability away rather than added one. */}
                  {onDiscount && (
                    <label className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted shrink-0">
                        {t('orderEdit.lineDiscount', 'Off each')}
                      </span>
                      <span className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={l.discount ?? ''}
                          onChange={(e) => onDiscount(e.target.value)}
                          placeholder="0,00"
                          aria-label={t('orderEdit.lineDiscount', 'Off each')}
                          className="w-[84px] sm:w-[74px] h-9 sm:h-7 pl-2 pr-5 rounded-lg sm:rounded-md border border-border bg-card text-[12px] tabular-nums text-ink focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                        />
                        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-muted pointer-events-none">
                          €
                        </span>
                      </span>
                    </label>
                  )}
                  {onDiscount && l.agreed && (
                    <span className="basis-full block text-[11px] font-semibold text-brand">
                      {t('orderCreate.agreedPrice', 'Agreed price')}
                    </span>
                  )}
                  </div>
                  {/* Its own line: the row above is full with the stepper,
                      the rate and the discount. */}
                  {onCost && (
                    <label className="mt-1.5 flex items-center gap-1.5">
                      <span className="text-[11px] text-muted shrink-0">
                        {t('orderCreate.colCost', 'Buying price')}
                      </span>
                      <span className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={l.unitCost ?? ''}
                          onChange={(e) => onCost(e.target.value)}
                          placeholder="0,00"
                          aria-label={t('orderCreate.costFor', { name: l.productName, defaultValue: 'Buying price of {{name}}, this order' })}
                          className="w-[84px] sm:w-[74px] h-9 sm:h-7 pl-2 pr-5 rounded-lg sm:rounded-md border border-border bg-card text-[12px] tabular-nums text-ink focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                        />
                        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-muted pointer-events-none">
                          €
                        </span>
                      </span>
                    </label>
                  )}
                </div>
    
                {/* Total at the top of its own rail, aligned with the
                    name rather than the controls — it is what the rep
                    reads down the column to check a basket. */}
                <div className="flex flex-col items-end justify-between shrink-0">
                  {/* Net of the discount, with the price it came off struck
                      through above. One figure alone would leave no way to
                      tell a discounted line from a cheaper product. */}
                  <span className="text-right leading-snug">
                    {discountEuros(l.discount) > 0 && (
                      <span className="block text-[11px] text-muted tabular-nums line-through">
                        {formatCurrency(l.unitPrice * l.quantity)}
                      </span>
                    )}
                    <span className="block text-sm font-bold text-ink tabular-nums">
                      {formatCurrency(previewLineTotal(previewOf(l)))}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={onRemove}
                    aria-label={t('orderCreate.remove', 'Remove')}
                    className="-mr-1 w-9 h-9 sm:w-7 sm:h-7 rounded-lg hover:bg-danger-bg flex items-center justify-center text-muted hover:text-danger transition-colors"
                  >
                    <Trash2 size={14} strokeWidth={1.75} />
                  </button>
                </div>
              </li>
  );
}

/**
 * Waits for the order, then hands it to a builder keyed on its id.
 *
 * The `key` is the whole reason for the split. Everything the edit screen
 * starts from — the basket, the discounts, the fee — is read from the order
 * ONCE and then left alone, because every write here invalidates that query
 * and a refetch mid-edit would redefine what "unchanged" means and swallow
 * the work. A fresh mount with the order in hand makes a plain useState
 * initialiser the "once"; the alternatives are an effect that renders the
 * screen empty first, or a ref read during render, and this app's lint
 * forbids both.
 */
export default function OrderCreatePage() {
  const { orderId } = useParams<{ orderId: string }>();
  // ForEdit, not the shared detail query: the seed below is frozen, so it
  // must not be frozen from a cached payload. See the hook.
  const { data: order, isLoading } = useAdminOrderForEdit(orderId);

  if (orderId && (isLoading || !order)) return <TableSkeleton rows={6} cols={3} />;

  return <OrderBuilder key={orderId ?? 'new'} order={orderId ? (order as Order) : null} />;
}

function OrderBuilder({ order }: { order: Order | null }) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language === 'es' ? 'es' : 'en') as 'es' | 'en';
  /**
   * One screen, two jobs, told apart by whether it was given an order.
   *
   * `/customers/:userId/orders/new` builds one; `/orders/:orderId/edit`
   * changes one. The same file rather than a copy, because "edit it the way
   * you built it" is only true if it IS the screen you built it on.
   */
  const editing = !!order;
  const orderId = order?.id;
  const { userId: routeUserId } = useParams<{ userId: string }>();
  // Editing, the customer is a fact of the order rather than of the route.
  const userId = editing ? ((order as unknown as { user_id?: string }).user_id ?? '') : (routeUserId ?? '');
  const navigate = useNavigate();
  // Pop rather than push. This page is reached from the customer, so pushing
  // that route back on makes the two trap each other.
  const goBack = useGoBack();
  const toast = useToast();

  const { data: customer, isLoading } = useAdminUser(userId);
  // The prices agreed with this customer: euros off one unit per product size
  // (lib/customerDiscounts on the API). A new line starts with its own.
  const { data: agreedRows } = useAdminCustomerDiscounts(userId || null);
  const agreed = useMemo(
    () => new Map((agreedRows ?? []).map((r) => [r.variant_id, String(Number(r.amount))])),
    [agreedRows],
  );
  const editItems = useEditOrderItems();
  const setFee = useSetOrderDeliveryFee();
  const setLineCosts = useSetOrderItemCosts();

  /**
   * The buying prices set in this basket, saved onto the lines once the order
   * has them (2026-10-27, user: "it should be available at the time of
   * creating or editing orders too").
   *
   * A second request rather than a field of the create or edit call: those
   * are shared with the rep panel, which must never be able to send one, and
   * the server copies the product's buying price onto every new line anyway —
   * so only lines set by hand here (or following a card change) need it. The
   * server also makes a figure above 0 the product's (the card already shows
   * it). The
   * order is read back for its line ids: a line in the basket and on the
   * order is the same size, matched by its id or, for a new line, its size.
   */
  const saveLineCosts = async (id: string) => {
    const wanted = lines.filter((l) => l.costChanged);
    if (wanted.length === 0) return;
    const fresh = await adminOrders.get(id) as unknown as { items?: OrderItemRow[]; sub_orders?: Array<{ items?: OrderItemRow[] }> };
    const onOrder = fresh.items ?? (fresh.sub_orders ?? []).flatMap((s) => s.items ?? []);
    const known = new Set(lines.map((l) => l.orderItemId).filter(Boolean));
    const used = new Set<string>();
    const items: Array<{ order_item_id: string; unit_cost: number }> = [];
    for (const l of wanted) {
      const row = l.orderItemId
        ? onOrder.find((r) => r.id === l.orderItemId)
        : onOrder.find((r) => r.variant_id === l.variantId && !known.has(r.id) && !used.has(r.id));
      if (!row) continue;
      used.add(row.id);
      items.push({ order_item_id: row.id, unit_cost: costNumber(l.unitCost) });
    }
    if (items.length > 0) await setLineCosts.mutateAsync({ id, items });
  };
  // Whose order this is. A rep at a counter is accountable for what they
  // build, and the order records created_by_admin_id either way — showing it
  // means they can see whose name is on it before they press the button.
  const { data: me } = useAdminMe();
  const { data: storeSettings } = useAdminSettings();
  const createOrder = useCreateAdminOrder();

  /**
   * The order as this screen opened it, which is what the save diffs against.
   *
   * A plain initialiser, because the component is keyed on the order id and so
   * mounts with the order already in hand. Nothing re-reads it afterwards.
   */
  const [seed] = useState<Seed | null>(() => (order ? seedFrom(order as never) : null));
  const nextKey = useRef(0);

  const [addressId, setAddressId] = useState<string>('');
  /** The address a basket put back after a reload chose — used only while it is still one of theirs. */
  const [restoredAddressId, setRestoredAddressId] = useState<string>('');
  const [lines, setLines] = useState<BasketLine[]>(() => seed?.lines ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  /**
   * Cash on delivery, and no longer asked.
   *
   * The picker offered cod or card and every rep-built order was cod — the
   * rep is standing with the client, and card here never meant a card was
   * taken, only that someone ticked it. The server defaults to the same
   * value, so this is sent to keep the request explicit rather than to
   * record a choice anybody made.
   *
   * Bizum is gone separately: the PaymentMethod type and the database enum
   * keep the value so historical orders still read, but nothing creates one.
   */
  const paymentMethod = 'cod' as const;
  /**
   * The rep sets the delivery fee, because only they can see the parcel.
   *
   * The configured fee prices a normal basket by distance or a flat rate; it
   * knows nothing about a client ordering twenty kilos of rice. The rep is
   * standing over the load, so they decide, and the standard fee is offered
   * as a starting point rather than an answer.
   *
   * Kept as a string so the field can be empty mid-typing without snapping
   * to 0 — and so "0" stays a deliberate waiver rather than an empty box.
   */
  const [feeInput, setFeeInput] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Names the create / save under way, so the progress panel can follow it. */
  const [progressKey, setProgressKey] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  /** The deliver-to dialog: picks an existing address or saves a new one. */
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [expandOpen, setExpandOpen] = useState(false);
  const [shortfalls, setShortfalls] = useState<Shortfall[] | null>(null);

  /**
   * A Home Grocery household's order is always one of theirs: tagged to their
   * plan, with its own day and part of the day, suggested from their
   * settings. Only when building — an order's slot is changed from the order
   * page, not here.
   */
  const { data: hgView } = useAdminHomeGroceryPlan(!editing && customer?.home_grocery_profile ? userId : undefined);
  const hgPlan = hgView?.plan ?? null;
  // Every order of a household with a plan is one of theirs (2026-10-23):
  // there is no ordinary order to choose instead, and the server tags it
  // whatever is sent.
  const hgActive = !!hgPlan;
  const [hgSlotChoice, setHgSlotChoice] = useState<SlotValue | null>(null);
  const [hgOpen, setHgOpen] = useState(false);
  const hgSlot: SlotValue | null = hgPlan
    ? hgSlotChoice ?? {
      scheduled_for: suggestedDay(hgPlan.preferred_weekday, madridToday()),
      delivery_window: hgPlan.preferred_window,
    }
    : null;

  const addresses = customer?.addresses ?? [];
  // Their plan's address first for one of their Home Grocery orders.
  const effectiveAddressId = addressId
    || (restoredAddressId && addresses.some((a) => a.id === restoredAddressId) ? restoredAddressId : '')
    || (hgActive && hgPlan?.address && addresses.some((a) => a.id === hgPlan.address!.id) ? hgPlan.address.id : '')
    || addresses.find((a) => a.is_default)?.id || addresses[0]?.id || '';
  const selectedAddress = addresses.find((a) => a.id === effectiveAddressId) ?? null;

  // Products can come from any shop. Cesto delivers a rep-built order itself,
  // so the order belongs to Cesto and no partner is fulfilling any part of it
  // — there is nothing to split and nothing to keep separate.
  const shopsInBasket = useMemo(
    () => new Set(lines.map((l) => l.storeName ?? 'Cesto Shop')),
    [lines],
  );

  // NET of the per-line discounts — the same rule the server applies when it
  // writes the order (lib/orderTotals). This read the gross until 2026-10-10,
  // so a discount typed into a line moved nothing on screen and the only way
  // to see the agreed price was to place the order and open it again.
  /**
   * The basket as it is shown and priced: a new line nobody has typed a
   * discount into carries the customer's agreed one. Derived rather than
   * copied in, so a list that arrives after the line — or a different
   * customer — is simply what the line shows.
   */
  const shownLines = useMemo(
    () => lines.map((l) => {
      if (l.orderItemId || l.discountTouched) return l;
      const saved = agreed.get(l.variantId);
      return saved ? { ...l, discount: saved, agreed: true } : { ...l, discount: '' };
    }),
    [lines, agreed],
  );
  const subtotal = useMemo(() => previewSubtotal(shownLines.map(previewOf)), [shownLines]);

  // What the panel reads to decide between an Add button and a stepper, so a
  // variant already in the basket cannot be silently added a second time.
  const quantities = useMemo(
    () => lines.reduce<Record<string, number>>((acc, l) => {
      // SUMMED: an order being edited can carry one product on two lines, and
      // showing the catalogue one of them would call it the total.
      acc[l.variantId] = (acc[l.variantId] ?? 0) + l.quantity;
      return acc;
    }, {}),
    [lines],
  );

  /**
   * The purchase this order is one PART of, if it is.
   *
   * One delivery is charged once, on the whole purchase, so a part carries
   * `delivery_fee: 0` by design and the fee route refuses to set one on it.
   * This screen showed the part's zero in an editable box anyway: an admin who
   * had already priced the purchase saw 0, typed the fee in again, and the
   * save answered 422 AFTER the items had gone through — which reads as "the
   * fee was reset" every single time.
   *
   * So when there is a parent, the row below states the purchase's figure and
   * where it lives, and sends nothing.
   */
  const purchaseId = editing ? (order?.parent_order_id ?? null) : null;
  const purchaseFee = order?.parent_order?.delivery_fee_total;

  const standardFee = storeSettings?.deliveryFee ?? null;

  /**
   * The typed figure, or the order's, or the configured one — first that is
   * actually an answer.
   *
   * This was an effect copying the configured fee in once settings arrived,
   * guarded by a `feeTouched` flag so it could not overwrite a number
   * somebody had typed. Both were the same statement said twice: a non-null
   * `feeInput` IS "somebody has typed something". Deriving it also drops the
   * only setState-in-an-effect this file had, which the lint objects to.
   */
  const deliveryFee = feeInput
    ?? (seed ? String(seed.fee) : standardFee != null ? String(standardFee) : '');
  const setDeliveryFee = setFeeInput;

  const feeNumber = Number(deliveryFee.replace(',', '.'));
  const feeValid = deliveryFee.trim() !== '' && Number.isFinite(feeNumber) && feeNumber >= 0;

  // Prices in this catalogue are VAT-INCLUSIVE, so the breakdown splits what
  // is already in the subtotal rather than adding to it. Display only: the
  // server recomputes from its own rates when the order is written, and this
  // is here so a rep can answer "how much of that is IVA?" at the counter.
  const taxLines = useMemo(
    () => shownLines.map((l) => ({
      grossCents: Math.round(previewLineTotal(previewOf(l)) * 100),
      rate_pct: VAT_RATES[l.vatCategory],
    })),
    [shownLines],
  );
  const taxBreakdown = useMemo(() => computeTaxBreakdown(taxLines), [taxLines]);
  /**
   * RECARGO DE EQUIVALENCIA (2026-11-04), on top of IVA: a new order follows
   * the customer's switch, an edit the order's own copy — and a part of a
   * split purchase carries none (the purchase is charged it). The server's
   * own rule (shared recargoOnCents), so the preview is the charge.
   */
  const underRecargo = editing
    ? !!order?.recargo_equivalencia && !order?.parent_order_id
    : !!customer?.recargo_equivalencia;
  const recargo = underRecargo
    ? recargoOnCents(taxLines, feeValid ? Math.round(feeNumber * 100) : 0) / 100
    : 0;
  const total = subtotal + (feeValid ? feeNumber : 0) + recargo;
  // A 0 % line carries no IVA, so it gets no row: with most products on the
  // 0 % default, "IVA 0 % · 0,00 €" would sit on nearly every basket and tell
  // nobody anything. Checkout lists the rates the same way.
  const vatGroups = taxBreakdown.groups.filter((g) => g.rate_pct > 0);

  const addVariant = (v: PickedVariant) => {
    setShortfalls(null);
    setLines((prev) => {
      const existing = prev.find((l) => l.variantId === v.id);
      if (existing) {
        return prev.map((l) => (l.variantId === v.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, {
        key: editing ? `new:${nextKey.current++}` : v.id,
        variantId: v.id,
        productName: v.name,
        variantName: '',
        unitPrice: v.price,
        quantity: 1,
        storeId: v.storeId,
        storeName: v.storeName,
        imageUrl: v.imageUrl ?? null,
        vatCategory: v.vatCategory ?? 'zero',
        unitCost: costText(v.unitCost),
      }];
    });
  };

  /** A product created here goes straight into the basket — that is the point. */
  const addFreshProduct = (p: Product) => {
    const variant = p.variants?.[0];
    setQuickCreateOpen(false);
    if (!variant) return;
    setLines((prev) => [...prev, {
      key: editing ? `new:${nextKey.current++}` : variant.id,
      variantId: variant.id,
      productName: p.name_es,
      variantName: variant.name_es,
      // Same rule as the panel and the server: wholesale where it is set,
      // then the product's IVA — the new product comes back at its base.
      unitPrice: priceWithVat(
        customer?.is_business && variant.b2b_price != null ? variant.b2b_price : variant.price,
        effectiveVatCategory(p),
      ),
      quantity: 1,
      storeId: p.store_id ?? null,
      storeName: null,
      imageUrl: p.images?.[0]?.url ?? null,
      vatCategory: effectiveVatCategory(p),
      unitCost: costText(variant.cost_price),
    }]);
  };

  /**
   * The line's buying price, typed here. Saved with the order, a figure
   * above 0 becomes the product's too (2026-10-27, user: "Yes, everywhere"),
   * so the size's card shows it from the moment it is typed.
   */
  const setUnitCost = (key: string, raw: string) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, unitCost: raw, costChanged: true } : l)));

  /**
   * A size's buying price was changed on its card, and saved to the product.
   * Its lines here follow, typed or not: the line and the product are one
   * figure, and the latest entered wins.
   */
  const followProductCost = (variantId: string, cost: number) =>
    setLines((prev) => prev.map((l) => (l.variantId === variantId
      ? { ...l, unitCost: costText(cost), costChanged: true }
      : l)));

  /** What the cards show for the sizes whose buying price was set in this basket. */
  const basketCosts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of lines) if (l.costChanged && costNumber(l.unitCost) > 0) m[l.variantId] = costNumber(l.unitCost);
    return m;
  }, [lines]);

  const setQty = (key: string, qty: number) => {
    // An older line's flat figure becomes per unit once its quantity moves,
    // as the server reads it.
    setLines((prev) => prev
      .map((l) => (l.key === key ? { ...l, quantity: Math.max(1, qty), flatDiscount: undefined } : l)));
  };
  const removeLine = (key: string) =>
    setLines((prev) => prev.filter((l) => l.key !== key));

  /**
   * Euros off one unit, while creating as well as editing. Typing makes it
   * this line's own figure, which is sent and saved for the customer.
   */
  const setDiscount = (key: string, raw: string) => {
    // Digits and one separator, so a stray letter cannot reach the server and
    // a half-written "1." survives being typed.
    if (!/^\d*[.,]?\d{0,2}$/.test(raw)) return;
    setLines((prev) => prev.map((l) => (l.key === key
      ? { ...l, discount: raw, discountTouched: true, agreed: false, flatDiscount: undefined }
      : l)));
  };

  /**
   * The catalogue's stepper speaks in VARIANTS; the basket speaks in rows.
   *
   * With one line per variant those are the same thing. Editing an order that
   * carries a product on two lines they are not, so this aims at the first of
   * them — arbitrary but predictable, and the per-row controls are right there
   * for the case where it matters which.
   */
  const setVariantQty = (variantId: string, qty: number) => {
    const first = lines.find((l) => l.variantId === variantId);
    if (!first) return;
    if (qty <= 0) removeLine(first.key);
    else setQty(first.key, qty);
  };

  /**
   * The edit, as operations.
   *
   * At most ONE stock move per line plus at most one discount, which is
   * exactly what the server allows — two moves on a line are refused because
   * every branch of its delta pass measures against the row as it was before
   * the request, so the second would compute from a stale base. A diff cannot
   * produce two moves, so the shape is the guard rather than something
   * checked against it.
   *
   * A DISCOUNT RIDES ALONGSIDE A QUANTITY CHANGE, deliberately: changing how
   * many and changing the price off are two separate facts about one line, and
   * that is what the modal this replaced sent.
   *
   * There is no `replace`. Swapping a product here is removing a row and
   * adding another, and the server treats a cross-shop `add` exactly as it
   * treated a cross-shop `replace` — the item leaves for a sibling order
   * either way.
   */
  const operations = useMemo<OrderEditOperation[]>(() => {
    if (!editing || !seed) return [];
    const ops: OrderEditOperation[] = [];
    const live = new Map(lines.map((l) => [l.key, l]));
    for (const was of seed.lines) {
      const now = live.get(was.key);
      if (!now) {
        ops.push({ action: 'remove', order_item_id: was.orderItemId! });
        continue;
      }
      if (now.quantity !== was.quantity) {
        ops.push({ action: 'update_qty', order_item_id: was.orderItemId!, new_quantity: now.quantity });
      }
      if (discountEuros(now.discount) !== discountEuros(was.discount)) {
        const unit = discountEuros(now.discount);
        ops.push({
          action: 'set_discount',
          order_item_id: was.orderItemId!,
          // Euros off one unit, saved for the customer. The flat figure rides
          // along for an API from before per-unit discounts.
          unit_discount: unit,
          discount_amount: Math.round(unit * now.quantity * 100) / 100,
        });
      }
    }
    for (const l of lines) {
      if (!l.orderItemId) {
        ops.push({
          action: 'add', new_variant_id: l.variantId, new_quantity: l.quantity,
          // Only a typed figure; one nobody touched gets the saved discount.
          ...(l.discountTouched ? { unit_discount: discountEuros(l.discount) } : {}),
        });
      }
    }
    return ops;
  }, [editing, seed, lines]);

  /**
   * Lines that will LEAVE for another shop's order when this is saved.
   *
   * A shop can only fulfil its own goods, so adding a partner product to an
   * order that is not theirs spins the item off onto a sibling. The modal this
   * replaced said so before you pressed save, and losing that would mean an
   * admin discovering the split afterwards.
   */
  const orderStoreKey = editing
    ? ((order as unknown as { store_id?: string | null }).store_id ?? null)
    : null;
  // Only a customer's own purchase splits by shop. An order staff or a rep
  // built — or a Home Grocery order, whoever placed it — is Cesto's whatever
  // it holds, and the server keeps every line on it (lib/editOrder
  // `builtByUs`), so there is nothing to warn about.
  const builtByUs = editing && !!(
    (order as unknown as { created_by_admin_id?: string | null }).created_by_admin_id
    || (order as unknown as { created_by_sales_rep_id?: string | null }).created_by_sales_rep_id
    || (order as unknown as { rashan_subscription_id?: string | null }).rashan_subscription_id
  );
  const spinsOff = editing && !builtByUs
    ? lines.filter((l) => !l.orderItemId && (l.storeId ?? null) !== orderStoreKey)
    : [];

  // Never on a part: the fee lives on the purchase, so there is nothing here
  // to send and the route would refuse it.
  const feeChanged = editing && !purchaseId && seed != null && feeValid && feeNumber !== seed.fee;
  // A buying price changed here is a change worth saving on its own.
  const dirty = operations.length > 0 || feeChanged || lines.some((l) => l.costChanged);

  /** An issued factura states this order's totals and freezes its contents. */
  const lockedBy = editing
    ? lockingInvoiceOf(order as unknown as { invoices?: IssuedInvoiceRef[] | null } | undefined ?? {})
    : null;
  // The order page's rule (packages/shared orderEditing.ts): in the shop's
  // hands, or a draft our team built (staff, a rep or Home Grocery).
  const notEditable = editing && !!order
    && !staffCanEditOrder(order as unknown as Parameters<typeof staffCanEditOrder>[0]);
  /** Saving keeps it a draft; it holds no stock until somebody confirms it. */
  const editingDraft = editing && (order as unknown as { status?: OrderStatus } | undefined)?.status === 'draft';
  /**
   * Every line taken off a draft. Saving it so cancels the draft — the server
   * does it (lib/editOrder) — so the screen says that first and offers the
   * other way out: add something.
   */
  const emptiesDraft = editingDraft && lines.length === 0;

  const savingEdit = editItems.isPending || setFee.isPending || setLineCosts.isPending;

  const screenTitle = editing
    ? t('orderEdit.title', 'Edit order')
    : t('orderCreate.title', 'Order creation');

  /**
   * A SECOND PRESS MUST NOT PLACE A SECOND ORDER.
   *
   * `canSubmit` already carries `!createOrder.isPending`, but that is React
   * state: it only takes effect on the next render, so two presses in the
   * same tick both get through and both place an order. Duplicate orders
   * from exactly this have reached the shop. A ref is set synchronously on
   * the way in, which is the only thing that stops the second one.
   */
  const submittingRef = useRef(false);
  /**
   * ONE KEY PER ATTEMPT AT THIS ORDER, kept across retries.
   *
   * Made on the first press and kept until the order exists. If the answer
   * is lost — a timeout, a dropped connection — the next press carries the
   * same key and the server hands back the order it already made instead of
   * making a second. Kept after a refusal too: a refused order was not made,
   * so the key is still unused.
   */
  const attemptKeyRef = useRef<string | null>(null);

  /**
   * THE BASKET SURVIVES A RELOAD (2026-11-04, packages/shared savedBasket.ts),
   * as the rep panel's does. Building: kept per admin and customer for a
   * working day — lines with their discounts and typed buying prices, the
   * address, the fee, the Home Grocery slot — and dropped once the order or
   * the draft is made, or the basket is cleared. Editing: the unsaved
   * changes, kept per admin and order, put back only while the order is still
   * the one they were made against (`editBaseline`), and dropped once saved
   * or on Cancel.
   *
   * The SAVE is declared before the RESTORE on purpose. Effects run in order,
   * so on the first pass the save sees nothing restored yet and stays out of
   * the way; without that it would write the empty first render over the
   * basket it was about to put back.
   */
  const signedInId = useAdminAuthStore((st) => st.user?.id);
  const adminId = signedInId || me?.id || '';
  const savedKey = !adminId ? null
    : editing ? (orderId ? editBasketKey('admin', adminId, orderId) : null)
      : (userId ? basketKey('admin', adminId, userId) : null);
  /** The order as this screen opened it — what unsaved edits are a diff against. */
  const editBaseline = useMemo(() => (seed ? editBaselineOf(seed.lines, { fee: seed.fee, notes: seed.notes }) : null), [seed]);
  /** Which basket has been put back already — once per admin and customer. */
  const restoredFor = useRef<string | null>(null);
  /** Set once the order exists, so nothing writes the basket back on the way out. */
  const placedRef = useRef(false);
  const saveBasket = () => {
    if (!savedKey || restoredFor.current !== savedKey || placedRef.current) return;
    // Nothing worth keeping: an empty new basket, or an edit that changes nothing.
    if (editing ? !dirty : lines.length === 0) { clearBasket(savedKey); return; }
    writeBasket<BasketLine>(savedKey, {
      lines,
      addressId: editing ? '' : addressId || restoredAddressId,
      feeInput,
      notes: '',
      hgSlot: editing ? null : hgSlotChoice,
      attemptKey: editing ? null : attemptKeyRef.current,
      baseline: editing ? editBaseline : null,
    });
  };
  /** The admin said no to these changes: forget them, then leave. */
  const discardAndLeave = (to: string) => {
    if (editing && savedKey) {
      placedRef.current = true;
      clearBasket(savedKey);
    }
    goBack(to);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(saveBasket, [savedKey, lines, addressId, restoredAddressId, feeInput, hgSlotChoice, dirty]);
  useEffect(() => {
    if (!savedKey || restoredFor.current === savedKey) return;
    restoredFor.current = savedKey;
    sweepBaskets('admin');
    const saved = readBasket<BasketLine>(savedKey);
    if (!saved) return;
    // EDITING: put back only onto the order it was made against. If that has
    // changed since, the changes describe lines that may not exist any more.
    if (editing) {
      if (saved.baseline !== editBaseline) {
        clearBasket(savedKey);
        toast.warning(
          t('orderEdit.restoreStaleTitle', 'Your unsaved changes were not kept'),
          t('orderEdit.restoreStaleBody', 'This order changed after you left it. Start again from what it holds now.'),
        );
        return;
      }
      // Rows added after this must not reuse a restored row's key.
      nextKey.current = nextNewKey(saved.lines, nextKey.current);
      setLines(saved.lines);
      if (saved.feeInput !== null) setFeeInput(saved.feeInput);
      toast.info(
        t('orderEdit.restoredTitle', 'Your unsaved changes are back'),
        t('orderEdit.restoredBody', 'From before the page reloaded. Save them, or press Cancel to drop them.'),
      );
      return;
    }
    setLines((prev) => mergeSavedLines(saved.lines, prev));
    if (saved.addressId) setRestoredAddressId(saved.addressId);
    if (saved.feeInput !== null) setFeeInput((cur) => cur ?? saved.feeInput);
    // A day already gone is no slot at all: the suggestion takes over again.
    if (saved.hgSlot && saved.hgSlot.scheduled_for >= madridToday()) {
      const slot = saved.hgSlot as SlotValue;
      setHgSlotChoice((cur) => cur ?? slot);
    }
    if (saved.attemptKey && !attemptKeyRef.current) attemptKeyRef.current = saved.attemptKey;
    const count = saved.lines.length;
    toast.info(
      t('orderCreate.restoredTitle', 'Your order is back'),
      count === 1
        ? t('orderCreate.restoredBodyOne', '1 product from before the page reloaded.')
        : t('orderCreate.restoredBodyMany', '{{count}} products from before the page reloaded.', { count }),
    );
    // Once per basket: the handlers are new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  /**
   * The order's own ceiling, checked before the request rather than after.
   *
   * The API refuses more than MAX_ORDER_LINES, and without this the refusal
   * arrives as a 422 about an array length — on a screen where someone has
   * just spent twenty minutes building a restock. A rep reaching it is
   * unlikely at this ceiling; being told clearly if they do costs one line.
   */
  const overLineLimit = lines.length > MAX_ORDER_LINES;

  const canSubmit = editing
    ? (lines.length > 0 || emptiesDraft) && dirty && feeValid && !savingEdit && !lockedBy && !notEditable && !overLineLimit
    : lines.length > 0 && effectiveAddressId !== '' && feeValid && !createOrder.isPending && !overLineLimit;

  /**
   * Save the edit: items, then the fee.
   *
   * TWO ENDPOINTS, because that is what the server offers — items are a set of
   * operations against stock, the fee is a plain field. Only what changed is
   * sent, and items go FIRST because they are the part that can be refused:
   * not enough stock, an order that moved on, a factura already issued.
   * Failing there leaves nothing written. If the fee call fails afterwards the
   * items are already saved, so the message says so rather than claiming
   * nothing was — the two are independently valid.
   *
   * NOTES ARE NOT HERE. This screen has no notes box at all: both notes are
   * edited on the order page, which is where the card below sends people.
   */
  const saveEdit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      await runSaveEdit();
    } finally {
      submittingRef.current = false;
    }
  };

  const runSaveEdit = async () => {
    if (!canSubmit || !orderId) return;
    setSubmitError(null);
    setShortfalls(null);
    let step = 'items';
    try {
      let spunOff: EditOrderNewOrder[] = [];
      if (operations.length > 0) {
        const key = newProgressKey();
        setProgressKey(key);
        const res = await editItems.mutateAsync({ id: orderId, payload: { operations }, progressKey: key });
        spunOff = ((res as { newOrders?: EditOrderNewOrder[] } | undefined)?.newOrders) ?? [];
        // Emptied, so the server cancelled it. Nothing else to save on an
        // order that is no longer going anywhere.
        if ((res as { draftCancelled?: boolean } | undefined)?.draftCancelled) {
          toast.success(
            t('orderEdit.draftCancelled', 'Draft cancelled'),
            t('orderEdit.draftCancelledBody', 'It had no items left.'),
          );
          placedRef.current = true;
          if (savedKey) clearBasket(savedKey);
          navigate(`/orders/${orderId}`, { replace: true });
          return;
        }
      }
      if (feeChanged) {
        step = 'fee';
        await setFee.mutateAsync({ id: orderId, deliveryFee: feeNumber });
      }
      // The order is saved either way; a failure here only means the buying
      // prices were not, and says so.
      await saveLineCosts(orderId).catch((e) => toast.error(
        t('orderCreate.costsNotSaved', 'The order was saved, but its buying prices were not'),
        e instanceof Error ? e.message : String(e),
      ));
      if (operations.length === 0 && !feeChanged) {
        toast.success(t('orderCreate.costsSaved', 'Buying prices saved'));
      } else {
        toast.success(
          t('orderEdit.saved', 'Order updated'),
          editingDraft
            ? t('orderEdit.savedDraftBody', 'Still a draft: no stock is held until you confirm stock.')
            : t('orderEdit.savedBody', 'Stock has been adjusted to match.'),
        );
      }
      // Saved: the kept copy of these changes is done with.
      placedRef.current = true;
      if (savedKey) clearBasket(savedKey);
      // Replace, not push: back must not return to a basket whose baseline now
      // describes the past.
      navigate(`/orders/${orderId}`, { replace: true, state: { spunOff } });
    } catch (err) {
      const short = shortfallsFrom(err);
      if (short) {
        setShortfalls(short);
        return;
      }
      // An edit has no attempt key, so an unanswered one is checked, not resent.
      const msg = step === 'items' && isUncertainOutcome(err)
        ? t('orderEdit.unsure', 'No answer came back in time, so your changes may already be saved. Open the order to check before saving again.')
        : err instanceof Error ? err.message : String(err);
      setSubmitError(step === 'items'
        ? msg
        : t('orderEdit.feeFailed', 'The items were saved, but the delivery fee was not: {{msg}}', { msg }));
      toast.error(t('orderEdit.failed', 'Could not save the changes'), msg);
    }
  };

  /** `draft` parks the basket instead of placing it, and takes NO stock:
   *  parking an unfinished basket is not a claim on the goods. Confirming
   *  the draft later is what reserves them, and re-checks they are still
   *  there — which is the trade for not holding them in the meantime. */
  const submit = async (asDraft = false) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      await runSubmit(asDraft);
    } finally {
      submittingRef.current = false;
    }
  };

  const runSubmit = async (asDraft = false) => {
    if (!canSubmit || !userId) return;
    setSubmitError(null);
    setShortfalls(null);
    if (!attemptKeyRef.current) attemptKeyRef.current = crypto.randomUUID();
    // Into the kept basket at once, so a reload after an unanswered Create
    // still carries it and pressing again cannot make a second order.
    saveBasket();
    // The attempt key doubles as the progress key: the server tracks the
    // create under whichever it is sent.
    setProgressKey(attemptKeyRef.current);
    try {
      const res = await createOrder.mutateAsync({
        idempotencyKey: attemptKeyRef.current,
        user_id: userId,
        address_id: effectiveAddressId,
        payment_method: paymentMethod,
        // `discount` is the typed string — euros off one unit — so an empty or
        // half-written one becomes no discount rather than NaN. Sent only when
        // somebody typed it, which also saves it for the customer (zero
        // forgets it); a line nobody touched gets their agreed price from the
        // server. The flat figure rides along for an API from before.
        items: lines.map((l) => {
          const unit = discountEuros(l.discount);
          return {
            variant_id: l.variantId,
            quantity: l.quantity,
            ...(l.discountTouched
              ? { unit_discount: unit, ...(unit > 0 ? { discount_amount: Math.round(unit * l.quantity * 100) / 100 } : {}) }
              : {}),
          };
        }),
        // Always sent, so the rep's figure is what is charged. Omitting it
        // would hand the decision back to the server's distance/flat rules,
        // which is the thing this field exists to override.
        delivery_fee: feeNumber,
        ...(asDraft ? { status: 'draft' as const } : {}),
        ...(hgActive && hgSlot ? { home_grocery: hgSlot } : {}),
      });
      await saveLineCosts(res.order.id).catch((e) => toast.error(
        t('orderCreate.costsNotSaved', 'The order was saved, but its buying prices were not'),
        e instanceof Error ? e.message : String(e),
      ));
      toast.success(
        asDraft
          ? t('orderCreate.savedDraft', 'Draft saved')
          : t('orderCreate.created', 'Order created'),
        asDraft
          ? t('orderCreate.savedDraftBody', 'No stock is held yet. Finish it from the order whenever you are ready.')
          : t('orderCreate.createdBody', 'Stock is reserved and the order is pending.'),
      );
      // The order exists: the basket that made it must not come back.
      placedRef.current = true;
      if (savedKey) clearBasket(savedKey);
      // Replace, not push. The order exists now, so back must not return to
      // a basket that would place it a second time.
      navigate(`/orders/${res.order.id}`, { replace: true });
    } catch (err) {
      const short = shortfallsFrom(err);
      if (short) {
        setShortfalls(short);
        return;
      }
      // No answer, or the server was busy: the order may exist. Say so, and
      // that pressing again is safe — the attempt key brings it back.
      const msg = isUncertainOutcome(err)
        ? t('orderCreate.unsure', 'No answer came back in time, so the order may already have been created. Press the button again: if it was, you will be taken to it instead of a second one being made.')
        : err instanceof Error ? err.message : String(err);
      setSubmitError(msg);
      toast.error(t('orderCreate.failed', 'Could not create the order'), msg);
    }
  };

  if (isLoading) return <TableSkeleton rows={6} cols={3} />;

  /**
   * An order can stop being editable between the list rendering and somebody
   * arriving here — it gets confirmed, or the factura goes out. The server
   * refuses either way; this says so before a basket is rebuilt that cannot
   * be saved.
   */
  if (editing && (notEditable || lockedBy)) {
    return (
      <div className="p-4 sm:p-6 max-w-lg">
        <BackLink
          label={t('common.back', 'Back')}
          title={screenTitle}
          onClick={() => goBack(`/orders/${orderId}`)}
        />
        <section className="mt-4 bg-card rounded-xl border border-border shadow-card p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} strokeWidth={1.75} className="text-amber-deep shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h2 className="text-sm font-bold font-display text-ink">
                {t('orderEdit.locked', 'This order can no longer be edited')}
              </h2>
              <p className="text-[13px] font-body text-muted mt-1">
                {lockedBy
                  ? t('orderEdit.lockedInvoice', 'Invoice {{n}} has been issued for it. A correction goes out as a credit note.', { n: lockedBy.invoice_number ?? '' })
                  : t('orderEdit.lockedStatus', 'It has moved on since.')}
              </p>
              <button
                type="button"
                onClick={() => navigate(`/orders/${orderId}`, { replace: true })}
                className="mt-4 h-11 px-4 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display transition-colors"
              >
                {t('orderEdit.backToOrder', 'Open the order')}
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="pb-44 lg:pb-0">
      {/* The window is the page here — the sidebar is gone on this route — so
          the title bar is the chrome, and it stays put while the catalogue
          scrolls under it. */}
      {/* No bar of its own. The layout's one bar turns blue on a focus route
          and carries both the way back and this title — see BackTarget.title.
          A second bar underneath it only repeated the account that is already
          sitting on the right of the first. */}
      <BackLink
        label={t('common.back', 'Back')}
        title={screenTitle}
        onClick={() => goBack(editing ? `/orders/${orderId}` : `/customers/${userId}`)}
        className="px-4 sm:px-6 pt-4"
      />
      {/* The bar only draws the title from lg, which is where it draws the
          back link too. Below that both belong to the page. */}
      <div className="lg:hidden px-4 sm:px-6 pt-2">
        <h1 className="text-base font-bold font-display text-ink truncate">
          {screenTitle}
        </h1>
      </div>

      <div className="p-4 sm:p-6 xl:flex xl:gap-6 xl:items-start">
        <div className="space-y-3 max-w-2xl xl:max-w-none xl:w-[560px] 2xl:w-[620px] xl:shrink-0">
          {/* ─── What this is, and for whom ─────────────
              Two cards of one shape: an icon, a title, an action on the right,
              a rule, then the detail. Repeating the shape is what lets the eye
              skip to the part it wants.

              THE FIRST CARD ANSWERS A DIFFERENT QUESTION IN EACH MODE.
              Building, the open question is who is building it. Changing an
              order that already exists, that is not in doubt — WHICH ORDER is:
              its number, where it has got to, and what it currently comes to.
              Same frame, same position, the fact that is actually in
              question. */}
          {editing && order ? (
            <section className="bg-card rounded-xl border border-border/60 shadow-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5">
                <Package size={17} strokeWidth={2} className="text-brand shrink-0" />
                <h2 className="text-sm font-bold font-display text-ink min-w-0 truncate">
                  {t('orderEdit.orderCard', 'Order')}
                </h2>
                <span className="flex-1" />
                <StatusBadge status={(order as unknown as { status: OrderStatus }).status} />
              </div>
              <div className="border-t border-border/60 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold font-display text-ink truncate font-mono leading-tight">
                      {(order as unknown as { order_number: string }).order_number}
                    </span>
                    <span className="block text-[12.5px] text-muted truncate">
                      {new Date((order as unknown as { created_at: string }).created_at)
                        .toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-[11px] text-muted uppercase tracking-wide font-display">
                      {t('orderEdit.currentTotal', 'Now')}
                    </span>
                    <span className="block text-[15px] font-bold font-display text-ink tabular-nums">
                      {formatCurrency(Number((order as unknown as { total: string | number }).total))}
                    </span>
                  </span>
                </div>
                {/* Said once, here, rather than as controls further down that
                    somebody has to press to learn they do nothing. Neither has
                    an endpoint on an existing order: the address has none at
                    all, and PUT /:id/notes writes the INTERNAL note, not the
                    customer's — both are edited on the order page. */}
                <p className="mt-2.5 pt-2.5 border-t border-border/60 text-[12px] font-body text-muted">
                  {t('orderEdit.fixedHere', 'The delivery address and the notes are changed on the order page, not here.')}
                </p>
              </div>
            </section>
          ) : (
          <section className="bg-card rounded-xl border border-border/60 shadow-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5">
              <UserRound size={17} strokeWidth={2} className="text-brand shrink-0" />
              <h2 className="text-sm font-bold font-display text-ink flex-1 min-w-0">
                {t('orderCreate.salesPerson', 'Sales person')}
              </h2>
            </div>
            <div className="border-t border-border/60 px-4 py-3 flex items-center gap-3">
              <span className="w-11 h-11 rounded-full bg-brand text-white flex items-center justify-center text-sm font-bold font-display shrink-0">
                {(me?.name ?? 'A').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold font-display text-ink truncate leading-tight">
                  {me?.name ?? '—'}
                </span>
                <span className="block text-[12.5px] text-muted truncate capitalize">
                  {String(me?.role ?? '').replace(/_/g, ' ')}
                </span>
              </span>
              {/* Their email, where the mockup carries a staff number and a
                  direct line. An Admin row has a name, an email and a role —
                  the other two would be numbers nobody issued. */}
              {me?.email && (
                <span className="hidden sm:inline-flex items-center gap-1.5 text-[12px] text-muted min-w-0 max-w-[200px]">
                  <Mail size={13} strokeWidth={1.75} className="text-brand shrink-0" />
                  <span className="font-mono truncate">{me.email}</span>
                </span>
              )}
            </div>
          </section>
          )}

          <section className="bg-card rounded-xl border border-border/60 shadow-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5">
              <Contact size={17} strokeWidth={2} className="text-brand shrink-0" />
              <h2 className="text-sm font-bold font-display text-ink min-w-0 truncate">
                {t('orderCreate.clientDetails', 'Client details')}
              </h2>
              {/* Which prices this order is being built at. It is a fact about
                  the CLIENT, so it belongs on the client's card — it was
                  sitting above the rail owning a whole row to say two words. */}
              {customer?.is_business && (
                <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-mist text-brand">
                  {t('orderCreate.b2bPricing', 'B2B pricing')}
                </span>
              )}
              <span className="flex-1" />
              {/* Opens the dialog in every case. Choosing is only half the
                  job and usually the half already done — most clients have one
                  address, so a list of one looked like a button doing nothing.
                  The dialog adds one too, which is the half that was missing,
                  and is why a client with none no longer has to leave this
                  screen and lose the basket to fix it. */}
              <button
                type="button"
                onClick={() => setAddressModalOpen(true)}
                className="text-[13px] font-semibold font-display text-brand hover:underline shrink-0 py-2.5 -my-2.5"
              >
                {addresses.length === 0
                  ? t('orderCreate.addAddress', 'Add address')
                  : t('orderCreate.changeAddress', 'Change')}
              </button>
            </div>

            <div className="border-t border-border/60 px-4 py-3">
              {/* ROWS, not columns. The email in a right-hand column was
                  taking the width the address needed, so a one-line address
                  wrapped to three beside it. Name and email share the top
                  line; the address gets the whole of the next one and fits
                  on it. */}
              <div className="flex items-start gap-3">
                <span className="w-11 h-11 rounded-xl bg-brand-whisper text-brand flex items-center justify-center shrink-0">
                  <Building2 size={19} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-3">
                    <p className="text-[15px] font-bold font-display text-ink truncate leading-tight min-w-0">
                      {customer?.business_profile?.company || customer?.name}
                    </p>
                    {customer?.email && (
                      <span className="hidden sm:inline-flex items-center gap-1.5 text-[12.5px] text-gray min-w-0 ml-auto shrink">
                        <Mail size={13} strokeWidth={1.75} className="text-brand shrink-0" />
                        <span className="font-mono truncate">{customer.email}</span>
                      </span>
                    )}
                  </div>

                  {/* NOT reserved, unlike the basket and the totals. Those two
                      change while the rep works — lines go in, the fee is
                      typed — so holding their height stops the Create button
                      moving under the cursor. The client does not change: it
                      is fixed for the whole screen, so these lines are either
                      always there or never, and reserving for the ones this
                      customer does not have only leaves a hole under the
                      address. A B2C client with no CIF had 22px of nothing. */}
                  {/* The whole address on the one line the pin marks, across
                      the full width now that nothing sits beside it. */}
                  {selectedAddress && (
                    <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-gray min-w-0">
                      <MapPin size={13} strokeWidth={1.75} className="text-muted shrink-0" />
                      <span className="truncate">
                        {selectedAddress.street_line_1}
                        {selectedAddress.street_line_2 ? `, ${selectedAddress.street_line_2}` : ''}
                        {', '}{selectedAddress.postcode} {selectedAddress.city}
                      </span>
                    </p>
                  )}

                  {/* The CIF the factura will carry, and the number to ring.
                      User.tax_id is the one the invoicing blocker reads;
                      registration_no is a company registry number and only
                      stands in for accounts approved before there was
                      anywhere to put the CIF. */}
                  {(customer?.tax_id || customer?.business_profile?.registration_no
                    || customer?.phone || customer?.business_profile?.contact_phone) && (
                    <p className="mt-1 flex items-center gap-2 text-[12px] text-muted min-w-0">
                      {(customer?.tax_id || customer?.business_profile?.registration_no) && (
                        <span className="truncate">
                          {t('orderCreate.taxId', 'CIF / NIF')}:{' '}
                          <span className="font-mono">
                            {customer?.tax_id || customer?.business_profile?.registration_no}
                          </span>
                        </span>
                      )}
                      {(customer?.phone || customer?.business_profile?.contact_phone) && (
                        <span className="inline-flex items-center gap-1.5 shrink-0">
                          <Phone size={12} strokeWidth={1.75} className="text-brand shrink-0" />
                          <span className="font-mono">
                            {customer?.phone || customer?.business_profile?.contact_phone}
                          </span>
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>

              {addresses.length === 0 && (
                <p className="mt-2 text-[12.5px] text-danger">
                  {t('orderCreate.noAddress', 'This customer has no address. Add one on their page first.')}
                </p>
              )}
            </div>
          </section>

          {/* ─── Products ─────────────────────────────── */}
          <section className="bg-card rounded-xl border border-border/60 shadow-card p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <ShoppingCart size={17} strokeWidth={2} className="text-brand shrink-0" />
                <h2 className="text-sm font-bold font-display text-ink">
                  {t('orderCreate.orderList', 'Order list')}
                </h2>
                {/* The count belongs to the heading, not to a badge — it is
                    reading material, not a status. */}
                {lines.length > 0 && (
                  <span className="text-[13px] text-muted">
                    ({t('orderCreate.itemCount', '{{count}} items', { count: lines.length })})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {shopsInBasket.size > 1 && (
                  <span className="text-xs text-muted truncate">
                    {t('orderCreate.fromShops', 'From {{count}} shops', { count: shopsInBasket.size })}
                  </span>
                )}
                {/* Both only exist once there is something to act on — an
                    empty basket has nothing to clear and nothing to enlarge. */}
                {lines.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setExpandOpen(true)}
                      title={t('orderCreate.expand', 'Expand')}
                      aria-label={t('orderCreate.expand', 'Expand')}
                      className="w-8 h-8 rounded-lg border border-border hover:border-brand flex items-center justify-center text-muted hover:text-brand transition-colors"
                    >
                      <Maximize2 size={14} strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setClearOpen(true)}
                      className="h-8 px-2 rounded-lg inline-flex items-center gap-1.5 text-[13px] font-bold font-display text-danger hover:bg-danger-bg transition-colors"
                    >
                      <Trash2 size={14} strokeWidth={2} />
                      {t('orderCreate.clearAll', 'Clear all')}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* The same 216px the list occupies, so the card does not jump
                the moment the first product lands in it. */}
            {lines.length === 0 && (
              <div className="h-[216px] mb-3 flex items-center justify-center border-y border-border px-6 text-center">
                {emptiesDraft ? (
                  <div className="max-w-sm">
                    <p className="text-sm font-semibold text-ink">
                      {t('orderEdit.emptyDraftTitle', 'This draft has no items left')}
                    </p>
                    <p className="text-[13px] text-muted mt-1">
                      {t('orderEdit.emptyDraftBody', 'Add products to keep it, or cancel the draft. Saving it empty cancels it.')}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted">
                    {t('orderCreate.empty', 'Nothing added yet.')}
                  </p>
                )}
              </div>
            )}

            {/* A numbered table from sm — the rep reads down Price, Qty and
                Total to check a basket against what is on the counter, and
                columns are what makes that a glance rather than a hunt. Below
                sm the same lines stack, because six columns on a phone is a
                horizontal scrollbar over the figures that matter most. */}
            {lines.length > 0 && (
              <>
                <ul className="sm:hidden mb-3 h-[216px] overflow-y-auto border-y border-border divide-y divide-border">
                  {shownLines.map((l, i) => (
                    <BasketRow
                      key={l.key}
                      l={l}
                      index={i}
                      showStore={shopsInBasket.size > 1}
                      onDec={() => setQty(l.key, l.quantity - 1)}
                      onInc={() => setQty(l.key, l.quantity + 1)}
                    onSet={(n) => setQty(l.key, n)}
                      onRemove={() => removeLine(l.key)}
                      onDiscount={(raw) => setDiscount(l.key, raw)}
                      onCost={(raw) => setUnitCost(l.key, raw)}
                    />
                  ))}
                </ul>

                {/* A FIXED height, so the rail below it never moves. The basket
                    is the one thing on this page that grows without limit, and
                    letting it push the totals and the Create button down the
                    screen means the rep loses the figure they are reading out
                    and the button they are reaching for, exactly when the order
                    is biggest. The list scrolls instead and everything under it
                    stays where it was.

                    216px is three rows under the pinned header. Enough to see
                    that a basket has more in it than fits — a box ending flush
                    with a row reads as the end of the list. */}
                <div className="hidden sm:block mb-3 -mx-4 h-[216px] overflow-y-auto">
                  <table className="w-full">
                    {/* Pinned: scrolling past the headings would leave six
                        columns of figures with nothing saying which is which. */}
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-surface-cream border-y border-border">
                        <th className="w-10 text-left text-[11px] font-semibold text-muted uppercase tracking-wider px-4 py-2 font-display">#</th>
                        <th className="text-left text-[11px] font-semibold text-muted uppercase tracking-wider py-2 font-display">{t('orderCreate.colProduct', 'Product')}</th>
                        <th
                          className="text-right text-[11px] font-semibold text-muted uppercase tracking-wider py-2 font-display"
                          title={t('orderCreate.costHint', 'What we pay for one. Saved with the order, it becomes the product\'s buying price too. Only admins see it.')}
                        >
                          {t('orderCreate.colPrice', 'Price')}
                          <span className="block text-[11px] text-muted/70">{t('orderCreate.colCostShort', 'Buying')}</span>
                        </th>
                        <th className="text-center text-[11px] font-semibold text-muted uppercase tracking-wider px-3 py-2 font-display">{t('orderCreate.colQty', 'Qty')}</th>
                        <th className="text-center text-[11px] font-semibold text-muted uppercase tracking-wider px-3 py-2 font-display">{t('orderEdit.lineDiscount', 'Off each')}</th>
                        <th className="text-right text-[11px] font-semibold text-muted uppercase tracking-wider py-2 font-display">{t('orderCreate.colTotal', 'Total')}</th>
                        <th className="w-12 px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {/* The row under the cursor, and the row being typed
                          into, both light up. A discount is a figure aimed at
                          ONE line in a list of thirty-odd whose names are
                          clipped and whose thumbnails are the same grey
                          placeholder whenever two products have no picture —
                          so "which row am I in" has to be answerable without
                          counting. */}
                      {shownLines.map((l, i) => (
                        <tr
                          key={l.key}
                          className="border-b border-border last:border-0 transition-colors hover:bg-surface-cream/60 focus-within:bg-brand-whisper"
                        >
                          <td className="px-4 py-2.5 text-xs text-muted tabular-nums align-middle">{i + 1}</td>
                          <td className="py-2.5 align-middle">
                            <span className="flex items-center gap-2.5 min-w-0">
                              <span className="w-9 h-9 rounded-lg bg-surface-cream border border-border shrink-0 overflow-hidden flex items-center justify-center">
                                {l.imageUrl
                                  ? <img src={resolveImageUrl(l.imageUrl)} alt="" className="w-full h-full object-cover" draggable={false} />
                                  : <Package size={15} strokeWidth={1.75} className="text-muted" />}
                              </span>
                              <span className="min-w-0">
                                <span className="block text-[13px] font-medium text-ink leading-snug line-clamp-2">
                                  {l.productName}
                                </span>
                                {shopsInBasket.size > 1 && (
                                  <span className="block text-[11px] text-muted truncate">
                                    {l.storeName ?? t('orderCreate.cestoShop', 'Cesto Shop')}
                                  </span>
                                )}
                              </span>
                            </span>
                          </td>
                          {/* The buying price sits under the selling one rather
                              than in a column of its own: this table shares
                              the row with the catalogue, and one more column
                              left the product name a word wide and pushed the
                              remove button out of the box. */}
                          <td className="pl-2 py-2.5 text-right text-[13px] text-gray tabular-nums whitespace-nowrap align-middle">
                            {formatCurrency(l.unitPrice)}
                            <span className="relative block w-[64px] ml-auto mt-1">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={l.unitCost ?? ''}
                                onChange={(e) => setUnitCost(l.key, e.target.value)}
                                placeholder="0,00"
                                aria-label={t('orderCreate.costFor', { name: l.productName, defaultValue: 'Buying price of {{name}}, this order' })}
                                title={t('orderCreate.costHint', 'What we pay for one. Saved with the order, it becomes the product\'s buying price too. Only admins see it.')}
                                className="w-full h-6 pl-1.5 pr-4 rounded-md border border-border bg-card text-[11.5px] tabular-nums text-ink focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                              />
                              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-muted pointer-events-none">
                                {'€'}
                              </span>
                            </span>
                          </td>
                          <td className="px-3 py-2.5 align-middle">
                            <span className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => setQty(l.key, l.quantity - 1)}
                                disabled={l.quantity <= 1}
                                aria-label={t('orderCreate.decrease', 'Decrease')}
                                className="w-6 h-6 rounded-md border border-border bg-card flex items-center justify-center disabled:opacity-40 hover:border-brand transition-colors"
                              >
                                <Minus size={11} strokeWidth={2.5} />
                              </button>
                              <QuantityField
                                value={l.quantity}
                                max={Infinity}
                                onChange={(n) => setQty(l.key, n)}
                                label={t('orderCreate.colQty', 'Qty')}
                                className="min-w-6 text-xs font-bold text-ink"
                              />
                              <button
                                type="button"
                                onClick={() => setQty(l.key, l.quantity + 1)}
                                aria-label={t('orderCreate.increase', 'Increase')}
                                className="w-6 h-6 rounded-md border border-border bg-card flex items-center justify-center hover:border-brand transition-colors"
                              >
                                <Plus size={11} strokeWidth={2.5} />
                              </button>
                            </span>
                          </td>
                          {/* The discount belongs HERE as much as on the
                              stacked rows: this is the table an admin works
                              in on a desktop, and the control living only on
                              the narrow layout is why the field was reported
                              missing. */}
                          <td className="px-3 py-2.5 align-middle">
                            <span className="relative block w-[78px] mx-auto">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={l.discount ?? ''}
                                onChange={(e) => setDiscount(l.key, e.target.value)}
                                placeholder="0,00"
                                aria-label={t('orderEdit.lineDiscount', 'Off each')}
                                className="w-full h-7 pl-2 pr-5 rounded-md border border-border bg-card text-[12px] tabular-nums text-ink focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                              />
                              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-muted pointer-events-none">
                                {'€'}
                              </span>
                            </span>
                            {l.agreed && (
                              <span className="mt-0.5 block text-center text-[11px] font-semibold text-brand">
                                {t('orderCreate.agreedPrice', 'Agreed price')}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 text-right text-[13px] font-bold text-ink tabular-nums whitespace-nowrap align-middle">
                            {discountEuros(l.discount) > 0 && (
                              <span className="block text-[11px] font-normal text-muted line-through">
                                {formatCurrency(l.unitPrice * l.quantity)}
                              </span>
                            )}
                            {formatCurrency(previewLineTotal(previewOf(l)))}
                          </td>
                          <td className="px-4 py-2.5 align-middle">
                            <button
                              type="button"
                              onClick={() => removeLine(l.key)}
                              aria-label={t('orderCreate.remove', 'Remove')}
                              className="w-7 h-7 rounded-lg hover:bg-danger-bg flex items-center justify-center text-muted hover:text-danger transition-colors"
                            >
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

            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="xl:hidden w-full min-h-[52px] rounded-xl border-2 border-dashed border-border hover:border-brand text-sm font-semibold font-display text-brand inline-flex items-center justify-center gap-2"
            >
              <Plus size={16} strokeWidth={2.5} />
              {t('orderCreate.addItems', 'Add products')}
            </button>
          </section>

          {/* WHAT WILL LEAVE THIS ORDER, said before the save rather than
              discovered after it.
              A shop can only fulfil its own goods, so adding a product that
              belongs to a different shop spins the item off onto a sibling
              order under a shared parent. The modal this screen replaced
              warned about that, and dropping the warning would mean finding
              out by noticing the order got shorter. */}
          {spinsOff.length > 0 && (
            <section className="bg-brand-mist/40 rounded-xl border border-brand/25 p-4">
              <div className="flex items-start gap-2.5">
                <GitBranch size={17} strokeWidth={1.75} className="text-brand shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold font-display text-ink">
                    {t('orderEdit.willSplit', '{{count}} item(s) will become a separate order', { count: spinsOff.length })}
                  </p>
                  <p className="text-xs font-body text-muted mt-0.5">
                    {t('orderEdit.willSplitWhy', 'They belong to another shop, which can only deliver its own goods. The customer still pays for one purchase.')}
                  </p>
                  <ul className="mt-2 space-y-0.5">
                    {spinsOff.map((l) => (
                      <li key={l.key} className="text-[12.5px] font-body text-ink truncate">
                        {l.quantity}
                        {' \u00d7 '}
                        {l.productName}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}

          {/* ─── Totals ───────────────────────────────── */}
          <section className="bg-card rounded-xl border border-border/60 shadow-card p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">{t('orderCreate.subtotal', 'Subtotal')}</span>
              <span className="font-semibold text-ink tabular-nums">{formatCurrency(subtotal)}</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <label htmlFor="delivery-fee" className="text-sm text-muted flex items-center gap-1.5">
                  <Truck size={14} strokeWidth={1.75} />
                  {t('orderCreate.deliveryFee', 'Delivery fee')}
                </label>
                <p className="text-xs text-muted mt-0.5 leading-snug">
                  {purchaseId
                    ? t('orderDetail.feeOnPurchase', 'Charged on the whole purchase')
                    : standardFee != null
                      ? t('orderCreate.feeHint', 'Standard is {{fee}} — change it for a heavy load', { fee: formatCurrency(standardFee) })
                      : t('orderCreate.feeHintNoSettings', 'Set what this delivery is worth')}
                </p>
              </div>
              {purchaseId ? (
                /* Read-only, and the PURCHASE's figure rather than this part's
                   zero — a zero in a box is an invitation to type the fee in
                   again, which is what kept happening. */
                <span className="shrink-0 text-sm font-semibold text-ink tabular-nums text-right">
                  {Number(purchaseFee ?? 0) > 0
                    ? formatCurrency(Number(purchaseFee))
                    : t('orderDetail.feeNotPriced', 'Not set yet — add it')}
                </span>
              ) : (
                <div className="relative shrink-0">
                  <input
                    id="delivery-fee"
                    inputMode="decimal"
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(e.target.value)}
                    aria-invalid={!feeValid}
                    className={`w-28 h-11 pl-3 pr-7 rounded-lg border bg-surface-cream text-right text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-brand/30 ${
                      feeValid ? 'border-border focus:border-brand' : 'border-danger'
                    }`}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted pointer-events-none">
                    {'\u20AC'}
                  </span>
                </div>
              )}
            </div>

            {/* A RESERVED BAND, so the Total below does not jump as lines go
                in. Everything between the fee and the total is conditional —
                the fee warning, the note when it differs from standard, and
                one IVA row per rate the basket touches. Rendered as they came,
                the total and the Create button walked up and down the rail as
                a rep typed and added lines.

                44px is one IVA row and its note, and the band GROWS from
                there: every rate shows (user, 2026-11-01). It used to be a
                fixed 44px that scrolled, because almost every basket had one
                rate — only because every line read 10 %. With a band chosen
                per product, two or three rates are ordinary. */}
            <div className="min-h-[44px] pt-2 border-t border-border space-y-1">
              {!feeValid && (
                <p className="text-xs text-danger" role="alert">
                  {t('orderCreate.feeInvalid', 'Enter a delivery fee — use 0 to waive it.')}
                </p>
              )}
              {/* Not on a part: its zero is structural, so "Delivery waived"
                  there would be a claim about the purchase that nobody made. */}
              {!purchaseId && feeValid && standardFee != null && feeNumber !== standardFee && (
                <p className="text-xs text-brand font-medium">
                  {feeNumber > standardFee
                    ? t('orderCreate.feeAbove', 'Above the standard fee')
                    : (feeNumber === 0
                      ? t('orderCreate.feeWaived', 'Delivery waived')
                      : t('orderCreate.feeBelow', 'Below the standard fee'))}
                </p>
              )}

              {/* IVA is not one rate in Spain, so this lists the buckets the
                  basket actually touches rather than a single percentage. The
                  figures come OUT of the subtotal, which is VAT-inclusive —
                  they are shown so a rep can answer the question at the
                  counter, not added to anything. */}
              {vatGroups.map((g) => (
                <div key={g.rate_pct} className="flex items-center justify-between text-xs">
                  <span className="text-muted">
                    {t('orderCreate.vatAt', 'IVA {{rate}}%', { rate: g.rate_pct })}
                    <span className="text-muted/70">
                      {'  ·  '}
                      {t('orderCreate.vatBase', 'base')} {formatCurrency(g.base_cents / 100)}
                    </span>
                  </span>
                  <span className="text-gray tabular-nums">{formatCurrency(g.vat_cents / 100)}</span>
                </div>
              ))}
              {vatGroups.length > 0 && (
                <p className="text-[11px] text-muted/80 pt-0.5">
                  {t('orderCreate.vatIncluded', 'Included in the prices above')}
                </p>
              )}
              {underRecargo && (
                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-gray">{t('orderCreate.recargo', 'Recargo de equivalencia')}</span>
                  <span className="text-ink tabular-nums">{formatCurrency(recargo)}</span>
                </div>
              )}
            </div>

            {/* Lifted onto its own tinted row, as the mockup draws it: this is
                the figure the rep reads out, and it should not look like one
                more line in a list. */}
            <div className="-mx-4 -mb-4 mt-3 px-4 py-3 bg-brand-whisper border-t border-brand/15 flex items-center justify-between rounded-b-xl">
              <span className="text-base font-bold font-display text-ink">{t('orderCreate.total', 'Total')}</span>
              <span className="text-xl font-bold font-display text-ink tabular-nums">{formatCurrency(total)}</span>
            </div>
          </section>

          {/* No notes box here (2026-10-23): not wanted when building an
              order, and it never saved when editing one. Both notes are
              written on the order page. */}
          {/* ─── Home Grocery: the order's day and part of the day ──
              Last, and folded: the day and the time are already filled in
              from the household's settings, so most orders never open it.
              The header says what they are, so nobody has to open it to
              check. */}
          {!editing && hgPlan && hgSlot && (
            <section className="bg-card rounded-xl border border-border/60 shadow-card overflow-hidden">
              <button
                type="button"
                onClick={() => setHgOpen((v) => !v)}
                aria-expanded={hgOpen}
                aria-controls="hg-slot-panel"
                className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-surface-cream/60 transition-colors"
              >
                <ShoppingBasket size={17} strokeWidth={2} className="text-success shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold font-display text-ink">
                    {t('orderCreate.hg.title', 'Home Grocery order')}
                  </span>
                  <span className="block text-[12.5px] font-display text-gray truncate first-letter:uppercase">
                    {`${planDate(hgSlot.scheduled_for, i18n.language, { weekday: 'short', day: 'numeric', month: 'short' })}, ${hgSlot.delivery_window
                      ? `${t(`hgPlan.window.${hgSlot.delivery_window}`, hgSlot.delivery_window).toLowerCase()} (${WINDOW_HOURS[hgSlot.delivery_window]})`
                      : t('hgPlan.schedule.anyTime', 'Any time').toLowerCase()}`}
                  </span>
                </span>
                <ChevronDown size={17} strokeWidth={2} className={`text-muted shrink-0 transition-transform ${hgOpen ? 'rotate-180' : ''}`} />
              </button>
              {hgOpen && (
                <div id="hg-slot-panel" className="border-t border-border/60 px-4 py-3">
                  <p className="text-[12.5px] font-display text-gray mb-3">
                    {t('orderCreate.hg.hint', 'Part of their Home Grocery. The day and time below come from their delivery information.')}
                  </p>
                  <PlanSlotFields value={hgSlot} onChange={setHgSlotChoice} preferredWeekday={hgPlan.preferred_weekday} />
                </div>
              )}
            </section>
          )}

          {shortfalls && (
            <div className="bg-danger-bg border border-danger/20 rounded-lg p-4" role="alert">
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle size={16} strokeWidth={2} className="text-danger shrink-0 mt-0.5" />
                <p className="text-sm font-semibold text-danger">
                  {t('orderCreate.shortfallTitle', 'Not enough stock')}
                </p>
              </div>
              <ul className="text-sm text-danger space-y-0.5 pl-6">
                {shortfalls.map((s) => (
                  <li key={s.productName}>
                    {t('orderCreate.shortfallLine', '{{name}} — asked for {{needed}}, {{available}} left', {
                      name: s.productName, needed: s.needed, available: s.available,
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Over the line ceiling, Create and Save are switched off — and
              that used to be all: a grey button and no reason, on a screen
              someone may have spent an hour filling. */}
          {/* Over the page while a big order is created or saved. */}
          {(createOrder.isPending || editItems.isPending) && (
            <OrderProgressPanel
              key={progressKey ?? 'build'}
              kind={editing ? 'edit' : 'create'}
              phase="server"
              progressKey={progressKey}
              lang={lang}
              detail={{ lines: editing ? operations.length : lines.length }}
              withOpening={!editing}
            />
          )}

          {overLineLimit && (
            <div className="bg-warning-bg border border-warning/30 rounded-lg p-4" role="alert">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} strokeWidth={2} className="text-warning shrink-0 mt-0.5" />
                <p className="text-sm font-medium text-ink">
                  {t('orderCreate.overLineLimit', 'This order has {{count}} products — one order can hold up to {{max}}. Remove {{extra}}, or split it into two orders, to continue.', {
                    count: lines.length, max: MAX_ORDER_LINES, extra: lines.length - MAX_ORDER_LINES,
                  })}
                </p>
              </div>
            </div>
          )}

          {/* Said beside the button, where the decision is made: the list
              saying so is a scroll away on a phone. */}
          {emptiesDraft && (
            <div className="bg-warning-bg border border-warning/30 rounded-lg p-4 flex items-start gap-3" role="status">
              <AlertTriangle size={18} strokeWidth={1.75} className="text-warning shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  {t('orderEdit.emptyDraftTitle', 'This draft has no items left')}
                </p>
                <p className="text-[13px] text-ink/80 mt-0.5">
                  {t('orderEdit.emptyDraftBody', 'Add products to keep it, or cancel the draft. Saving it empty cancels it.')}
                </p>
              </div>
            </div>
          )}

          {submitError && (
            <div className="bg-danger-bg border border-danger/20 rounded-lg p-4" role="alert">
              <p className="text-sm text-danger font-medium">{submitError}</p>
            </div>
          )}

          <div className="fixed lg:static bottom-0 left-0 right-0 z-30 bg-surface-linen/95 lg:bg-transparent backdrop-blur lg:backdrop-blur-none border-t lg:border-t-0 border-border lg:p-0 lg:pt-2">
            {/* Mobile only. The bar is fixed below lg, so Totals is usually
                off-screen and the Items section is a scroll away — meaning the
                number the rep is about to say out loud, and the only way to
                add to it, were both somewhere else. Above lg the bar is static
                at the end of a visible form and this would just repeat it. */}
            <div className="lg:hidden flex items-center gap-2 px-4 pt-3">
              <button
                type="button"
                onClick={() => setExpandOpen(true)}
                disabled={lines.length === 0}
                className="min-w-0 flex-1 text-left disabled:opacity-50 rounded-lg -mx-1 px-1 py-0.5"
              >
                <span className="block text-[11px] text-muted leading-tight">
                  {t('orderCreate.itemCount', { count: lines.length })}
                </span>
                <span className="block text-base font-bold text-ink tabular-nums leading-tight">
                  {formatCurrency(total)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="min-h-[44px] px-3.5 rounded-xl border-2 border-brand text-brand font-semibold font-display text-sm inline-flex items-center gap-1.5 shrink-0"
              >
                <Plus size={16} strokeWidth={2.5} />
                {/* The label goes at the narrowest widths; the icon and the
                    44px target do not. */}
                <span className="max-[379px]:hidden">
                  {t('orderCreate.addItems', 'Add products')}
                </span>
              </button>
            </div>

            <div className="flex gap-3 p-4 lg:p-0 lg:gap-4 lg:justify-end">
              <button
                type="button"
                onClick={() => discardAndLeave(editing ? `/orders/${orderId}` : `/customers/${userId}`)}
                className="flex-1 lg:flex-none min-h-[52px] px-5 rounded-xl bg-card border-2 border-border hover:border-brand font-semibold font-display text-sm text-ink"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              {/* NO DRAFT BUTTON WHEN EDITING. Parking a basket is something
                  you do with one you have not placed; this order exists, has
                  taken stock, and the customer has been told about it. */}
              {!editing && (
                <button
                  type="button"
                  onClick={() => submit(true)}
                  disabled={!canSubmit}
                  className="flex-1 lg:flex-none min-h-[52px] px-4 rounded-xl bg-card border-2 border-border hover:border-brand font-semibold font-display text-sm text-ink inline-flex items-center justify-center gap-2"
                >
                  <FileText size={16} strokeWidth={2} />
                  {t('orderCreate.saveDraft', 'Save draft')}
                </button>
              )}
              <button
                type="button"
                onClick={() => (editing ? saveEdit() : submit(false))}
                disabled={!canSubmit}
                className={`flex-[2] lg:flex-none min-h-[52px] px-5 rounded-xl disabled:opacity-50 text-white font-semibold font-display text-sm inline-flex items-center justify-center gap-2 ${
                  emptiesDraft ? 'bg-danger hover:bg-danger/90' : 'bg-brand hover:bg-brand-mid'}`}
              >
                {(editing ? savingEdit : createOrder.isPending)
                  ? <Loader2 size={16} strokeWidth={2.5} className="animate-spin" />
                  : emptiesDraft ? <Trash2 size={16} strokeWidth={2} /> : <Check size={16} strokeWidth={2.5} />}
                {emptiesDraft
                  ? t('orderEdit.cancelDraft', 'Cancel draft')
                  : editing
                    ? t('orderEdit.submit', 'Save changes')
                    : t('orderCreate.submit', 'Create order')}
              </button>
            </div>
          </div>
        </div>

      <DeliveryAddressModal
        open={addressModalOpen}
        userId={userId ?? ''}
        addresses={addresses}
        selectedId={effectiveAddressId}
        defaultContactName={customer?.name}
        defaultContactPhone={customer?.phone ?? customer?.business_profile?.contact_phone}
        onSelect={setAddressId}
        onClose={() => setAddressModalOpen(false)}
      />

      <OrderProductPanel
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        quantities={quantities}
        onAdd={addVariant}
        onSetQuantity={setVariantQty}
        onCreateNew={() => { setPickerOpen(false); setQuickCreateOpen(true); }}
        wholesale={!!customer?.is_business}
        onCostSaved={followProductCost}
        basketCosts={basketCosts}
      />
      </div>

      {/* Clearing asks first. It is one click to undo an hour of picking, and
          there is no undo — the basket lives in component state. */}
      <ConfirmModal
        open={clearOpen}
        danger
        title={t('orderCreate.clearAll', 'Clear all')}
        message={t('orderCreate.clearConfirm', 'Remove every item from this order? This cannot be undone.')}
        confirmLabel={t('orderCreate.clearAll', 'Clear all')}
        cancelLabel={t('common.cancel', 'Cancel')}
        onConfirm={() => { setLines([]); setShortfalls(null); setClearOpen(false); }}
        onCancel={() => setClearOpen(false)}
      />

      {/* The basket at full width. The form column is 520px, which is the
          right size for the fields and the wrong size for checking twelve
          lines against what is on the counter. Same rows, same controls —
          only the room changes. */}
      {expandOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setExpandOpen(false)}
        >
          <div
            className="bg-card rounded-2xl shadow-modal w-full max-w-3xl max-h-[88vh] sm:max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 px-4 sm:px-6 py-4 border-b border-border flex items-center gap-3">
              <ShoppingCart size={18} strokeWidth={1.75} className="text-brand" />
              <h3 className="text-lg font-bold font-display text-ink flex-1 min-w-0">
                {t('orderCreate.items', 'Items')}
                <span className="ml-2 text-sm font-semibold text-muted tabular-nums">
                  {lines.length}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setExpandOpen(false)}
                aria-label={t('common.close', 'Close')}
                className="w-9 h-9 rounded-lg hover:bg-surface-linen flex items-center justify-center"
              >
                <X size={18} strokeWidth={1.75} className="text-muted" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 sm:px-6">
              <ul className="divide-y divide-border">
                {shownLines.map((l, i) => (
                  <BasketRow
                    key={l.key}
                    l={l}
                    index={i}
                    showStore={shopsInBasket.size > 1}
                    onDec={() => setQty(l.key, l.quantity - 1)}
                    onInc={() => setQty(l.key, l.quantity + 1)}
                    onSet={(n) => setQty(l.key, n)}
                    onRemove={() => removeLine(l.key)}
                    onDiscount={(raw) => setDiscount(l.key, raw)}
                    onCost={(raw) => setUnitCost(l.key, raw)}
                  />
                ))}
              </ul>
            </div>

            <div className="shrink-0 px-4 sm:px-6 py-4 border-t border-border flex items-center justify-between">
              <span className="text-sm text-muted">{t('orderCreate.subtotal', 'Subtotal')}</span>
              <span className="text-lg font-bold text-ink tabular-nums">
                {formatCurrency(subtotal)}
              </span>
            </div>
          </div>
        </div>
      )}

      {quickCreateOpen && (
        <QuickCreateProductModal
          storeId={null}
          onCreated={addFreshProduct}
          onClose={() => setQuickCreateOpen(false)}
        />
      )}
    </div>
  );
}
