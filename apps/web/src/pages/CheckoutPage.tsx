import { memo, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { MAX_ORDER_LINES } from '@grocery-app/shared';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Clock, CreditCard, Banknote, ShieldCheck, Plus, Zap, Loader2, WifiOff, CalendarDays } from 'lucide-react';
import {
  useAddresses,
  useOrderQuote,
  useCheckout,
  useProductsByIds,
  probeConnection,
} from '@grocery-app/shared';
import type { PaymentMethod, ConnectionVerdict } from '@grocery-app/shared';
import { useCheckoutFailure, slowOrderHint, type CheckoutStage, type FailureCopy } from '@/lib/checkoutFailure';
import OrderProgressPanel from '@/components/OrderProgressPanel';
import ProductThumb from '@/components/ProductThumb';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { useCartWords, useHomeGroceryShopper } from '@/lib/homeGroceryShopper';
import PlanSlotPicker from '@/components/home-grocery/plan/PlanSlotPicker';
import { suggestedDay, type SlotValue } from '@/components/home-grocery/plan/planSlot';
import { FREQ_LABELS, WEEKDAYS, windowLine } from '@/components/home-grocery/planCopy';

/** How long an order may be on its way before the page says why it is slow. */
const SLOW_ORDER_MS = 8_000;

/** The failure box: connection problems look different from ours. */
function FailureNotice({ failure }: { failure: FailureCopy }) {
  const connection = failure.kind === 'offline' || failure.kind === 'slow_connection';
  return (
    <div role="alert" className="flex gap-2.5 bg-danger-bg border border-danger/25 rounded-xl p-3 mb-4">
      {connection
        ? <WifiOff size={16} strokeWidth={1.75} className="text-danger shrink-0 mt-px" />
        : <Clock size={16} strokeWidth={1.75} className="text-danger shrink-0 mt-px" />}
      <div>
        <p className="text-xs font-bold text-danger font-display mb-1">{failure.title}</p>
        <p className="text-xs text-charcoal font-body">{failure.body}</p>
      </div>
    </div>
  );
}

type SummaryLine = {
  variantId: string;
  quantity: number;
  product?: { name_es?: string | null };
  variant?: { price: number };
  image?: { url?: string | null };
};

/**
 * The basket's lines in the summary card, drawn only when the lines change.
 *
 * Placing an order changes the page's state several times — the button goes
 * busy, the step moves on, the progress key is set — and each change redrew
 * every line. On a 1,000-line basket that held the page up for over a second
 * right after "Place order", so the progress panel could not appear until it
 * finished (staging, 2026-10-21).
 */
const SummaryLines = memo(function SummaryLines({ lines }: { lines: SummaryLine[] }) {
  return (
    <div className="flex flex-col gap-3 mb-5 max-h-[260px] overflow-y-auto">
      {lines.map((item) => (
        <div key={item.variantId} className="flex items-center gap-3">
          <div className="photo-well w-12 h-12 rounded-lg bg-surface-cream overflow-hidden border border-border/40 shrink-0">
            <ProductThumb url={item.image?.url} iconSize={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-ink font-display line-clamp-1">{item.product?.name_es}</p>
            <p className="text-[11px] text-muted font-body">
              {item.quantity} × €{(item.variant?.price ?? 0).toFixed(2)}
            </p>
          </div>
          <span className="text-sm font-bold text-ink font-display">
            €{((item.variant?.price ?? 0) * item.quantity).toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
});

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { t, lang } = useLanguageStore();

  const items = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clearCart);
  const syncToServer = useCartStore((s) => s.syncToServer);
  const { data: addresses, isLoading: addressesLoading } = useAddresses();

  // Cart preview
  // by-ids, not a paged listing — /api/products caps at 60 rows, so on a real
  // catalogue most cart lines resolved to undefined and the order summary
  // rendered €0.00. (Order totals are recomputed server-side from the live
  // variant price, so this was a display bug only — but it showed the
  // customer the wrong number right before they confirmed.)
  const productIds = useMemo(
    () => Array.from(new Set(items.map((i) => i.productId))),
    [items],
  );
  const { data: products = [] } = useProductsByIds(productIds);
  // How many shops the basket spans — the progress panel says "creating the
  // orders for N shops". Cesto's own products count as one.
  const shopCount = useMemo(() => new Set(products.map((p) => p.store_id ?? 'cesto')).size, [products]);
  // Memoised, and looked up through a map: the inline version searched the
  // product list once per line on every render — a million comparisons for a
  // 1,000-line basket — and made the useMemo below it recompute every time.
  const enriched = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    return items.map((item) => {
      const product = byId.get(item.productId);
      const variant = product?.variants?.find((v) => v.id === item.variantId);
      const image = product?.images?.find((i) => i.is_primary) ?? product?.images?.[0];
      return { ...item, product, variant, image };
    });
  }, [items, products]);

  /**
   * A Home Grocery household's checkout places one of its Home Grocery orders
   * (the server sees to that), so it asks for the one thing such an order
   * adds: the day and the part of the day, prefilled from the plan — their
   * weekday from tomorrow, their part of the day.
   */
  const hg = useHomeGroceryShopper();
  const words = useCartWords();
  const [slotChoice, setSlotChoice] = useState<SlotValue | null>(null);
  const slot: SlotValue | null = hg.plan
    ? slotChoice ?? { scheduled_for: suggestedDay(hg.plan.preferred_weekday), delivery_window: hg.plan.preferred_window }
    : null;

  // Selections
  const [addressId, setAddressId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Inline-validate the notes textarea: optional but capped at 500 chars
  // (matches the server-side validator). Display-only — submit-time check
  // below blocks `placeOrder` if the limit is exceeded.
  const NOTES_LIMIT = 500;
  const notesError =
    notes.length > NOTES_LIMIT ? (lang === 'en' ? `Maximum ${NOTES_LIMIT} characters.` : `Máximo ${NOTES_LIMIT} caracteres.`) : null;

  const selectedAddress = addresses?.find((a) => a.id === addressId);

  // Default-select the user's default address. There is no serviceability
  // check to prefer a deliverable one over it — every saved address is
  // deliverable now that coverage is not modelled.
  // A Home Grocery household's plan address comes first, so wait to know
  // whether they are one before choosing.
  const planAddressId = hg.plan?.address?.id ?? null;
  useEffect(() => {
    if (addressId || !addresses?.length || hg.loading) return;
    const def = addresses.find((a) => a.is_default);
    const planAddr = planAddressId ? addresses.find((a) => a.id === planAddressId) : undefined;
    setAddressId((planAddr ?? def ?? addresses[0]).id);
  }, [addresses, addressId, hg.loading, planAddressId]);

  // Quote — the server prices what's in the *server* cart, so push the local
  // cart up first; otherwise the first quote on this page 400s with an empty
  // cart and the summary stays as "—".
  const orderQuote = useOrderQuote();

  // Extracted so the error state can offer a retry.
  const runQuote = useCallback(async () => {
    if (!addressId) return;
    try {
      await syncToServer();
    } catch { /* fall through — the quote surfaces any cart issue */ }
    orderQuote.mutate(addressId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressId]);

  // Re-quote on cart changes as well as address changes. This was previously
  // address-only because syncToServer went through POST /api/cart/merge,
  // which resolves conflicts in favour of the SERVER cart — re-syncing after
  // a local quantity edit would have reverted that edit. syncToServer now
  // uses PUT /api/cart (replace), so the client is authoritative and this is
  // safe. Keyed on a stable signature rather than array identity so it can't
  // loop.
  const cartSignature = useMemo(
    () => items.map((i) => `${i.variantId}:${i.quantity}`).sort().join('|'),
    [items],
  );

  useEffect(() => {
    void runQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressId, cartSignature]);

  const quote = orderQuote.data;

  // Client-side fallback so the summary is never blank. `variant.price` is
  // already the effective price for this viewer — the API rewrites it to the
  // wholesale value for business accounts in b2b mode — so this figure is
  // correct for regular customers, business buyers and partner staff alike.
  // The server quote still wins whenever it's available; this only covers the
  // window before it lands, and the failure case.
  const itemsSubtotal = useMemo(
    () => enriched.reduce((sum, i) => sum + (i.variant?.price ?? 0) * i.quantity, 0),
    [enriched],
  );

  const subtotalValue = quote ? Number(quote.subtotal) : itemsSubtotal;
  const hasQuote = !!quote;
  /**
   * Delivery is added by our team after the order arrives — every customer's
   * since 2026-10-23, a wholesale one before that — so the zero in the quote
   * is "not decided", not "free", and the total beside it is not final
   * either. Both are labelled accordingly. A zero from an older API reads the
   * same way.
   */
  const feeComesLater = hasQuote && (
    quote!.deliveryFeePending === true || quote!.delivery?.reason === 'b2b' || Number(quote!.deliveryFee) === 0
  );
  /** The quote's IVA rows with something in them; none from an older API. */
  const vatRows = (quote?.tax?.by_rate ?? []).filter((g) => g.rate_pct > 0);

  // Worded by whose side the failure was on — see lib/checkoutFailure.ts.
  const quoteFailure = useCheckoutFailure(orderQuote.isError ? orderQuote.error : null, 'quote', lang);
  // `out_of_stock` issues don't block placing the order — those lines land
  // in a draft order instead. `unavailable` still does; the server
  // hard-rejects checkout for it regardless of the draft-order flag, so
  // catch it here instead of letting the customer hit a late error.
  // (`out_of_area` was the other blocker; it cannot occur any more.)
  // A Home Grocery order is never parked as a draft: short stock refuses it,
  // so for a household it blocks like anything else.
  const hasBlockingIssues = !!quote?.issues?.some((i) => hg.shopper || i.reason !== 'out_of_stock');

  // Checkout
  const checkout = useCheckout();

  /**
   * ONE FLAG FOR THE WHOLE ACT OF ORDERING, not just the mutation.
   *
   * The button used to disable on `checkout.isPending`, which only covers the
   * final call. Everything before it — pushing the basket to the server —
   * left the button live, and that step can now wait 30 seconds and try
   * twice. A shopper who sees nothing happen for half a minute presses again,
   * and the second press runs the whole handler again. That is where the
   * duplicate orders came from.
   *
   * The ref is not redundant. `disabled` only takes effect on the next
   * render, so two presses in the same tick — a double-click, or an
   * impatient double-tap — can both enter this function before React has
   * re-rendered anything. The ref is set synchronously on the way in, so the
   * second one turns around immediately.
   */
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  /**
   * ONE KEY PER BASKET-ATTEMPT, kept across retries.
   *
   * Generated on the first press and held until an order actually exists. If
   * the request times out, or the connection drops after the server committed,
   * the next press carries the SAME key — and the server answers with the
   * order it already placed instead of placing a second one. That is the half
   * the button guard cannot cover: it stops presses, not requests.
   *
   * Cleared on success, so the next basket is a genuinely new intent. A failed
   * attempt deliberately keeps its key: that is the case this exists for.
   */
  const attemptKeyRef = useRef<string | null>(null);
  const busy = placing || checkout.isPending;
  /**
   * Which part of placing the order is under way, for the progress panel:
   * the basket upload (ours), the order request (the server reports its own
   * steps under the attempt key), then moving to the order.
   */
  const [orderPhase, setOrderPhase] = useState<'before' | 'server' | 'after'>('before');
  const [progressKey, setProgressKey] = useState<string | null>(null);

  /** Why the last press did not end in an order, and at which step. */
  const [orderErr, setOrderErr] = useState<{ err: unknown; stage: CheckoutStage } | null>(null);
  const orderFailure = useCheckoutFailure(orderErr?.err ?? null, orderErr?.stage ?? 'order', lang);
  /** A Home Grocery order refused for stock names what ran short. */
  const orderShortfalls = ((orderErr?.err as { data?: { shortfalls?: unknown } } | undefined)?.data?.shortfalls ?? []) as
    Array<{ productName: string; needed: number; available: number }>;

  /**
   * A big basket on a slow line can be on its way for a minute: the sync
   * waits 30s and tries twice, then the order waits 30s. A spinner that long
   * looks frozen, and a shopper who reloads loses the request. So after a few
   * seconds the page checks the connection and says what is going on.
   */
  // Numbered per press, so one attempt's verdict never shows on the next.
  const [attemptNo, setAttemptNo] = useState(0);
  const [waitHint, setWaitHint] = useState<{ attempt: number; verdict: ConnectionVerdict } | null>(null);
  useEffect(() => {
    if (!busy) return;
    let live = true;
    const id = window.setTimeout(() => {
      void probeConnection().then((verdict) => { if (live) setWaitHint({ attempt: attemptNo, verdict }); });
    }, SLOW_ORDER_MS);
    return () => { live = false; window.clearTimeout(id); };
  }, [busy, attemptNo]);
  const waitVerdict = busy && waitHint?.attempt === attemptNo ? waitHint.verdict : null;

  async function placeOrder() {
    if (placingRef.current) return;
    placingRef.current = true;
    setAttemptNo((n) => n + 1);
    setPlacing(true);
    try {
      await runPlaceOrder();
    } finally {
      // Cleared even on the happy path: navigate() leaves this component
      // mounted for a tick, and a failed attempt must leave the button
      // usable again.
      placingRef.current = false;
      setPlacing(false);
    }
  }

  async function runPlaceOrder() {
    setError(null);
    setOrderErr(null);
    if (!addressId) { setError(lang === 'en' ? 'Pick a delivery address.' : 'Elige una dirección de entrega.'); return; }
    if (items.length === 0) { setError(words.empty); return; }
    if (notesError) { setError(notesError); return; }
    if (hasBlockingIssues) { setError(t('checkout.blockingHeading')); return; }
    /**
     * Checked here, before the round trip, so an oversized basket is a
     * sentence the customer can act on instead of a 422 reading "items:
     * Array must contain at most 1000 element(s)".
     *
     * MAX_ORDER_LINES is generous enough that reaching it is a runaway rather
     * than a shop, but it has to say something when it happens: the sync is
     * what fails, and a failed sync used to be swallowed and the order placed
     * from whatever the server still held.
     */
    if (items.length > MAX_ORDER_LINES) {
      setError(lang === 'en'
        ? `Your basket has ${items.length} items, which is more than the ${MAX_ORDER_LINES} we can place in one order. Remove some, or split it into two orders.`
        : `Tienes ${items.length} productos, más de los ${MAX_ORDER_LINES} que caben en un pedido. Quita algunos o divídelo en dos pedidos.`,
      );
      return;
    }
    /**
     * Push the local cart up first, and STOP if it does not land.
     *
     * The order is placed from the SERVER cart. After a failed sync that is
     * the previous one — usually nothing — so carrying on means either buying
     * a stale basket or being told "Your cart is empty" while looking at a
     * full one. That is the report this came from: 74 items on screen, an
     * empty cart according to checkout.
     *
     * Worded by whose side it was on rather than shown raw, because what
     * reaches here is "Request timeout — API server unreachable or too slow",
     * which tells a shopper nothing about what to do or whether they were
     * charged. cartService.replace() has already waited 30s and tried twice by
     * this point, so this is a real problem, not a blip — and the probe says
     * whether it is their connection or us.
     */
    // Made before the upload rather than just before the order request, so
    // the progress panel knows the key from the first moment. Same key, same
    // lifetime: kept across a failed attempt, cleared once an order exists.
    if (!attemptKeyRef.current) attemptKeyRef.current = crypto.randomUUID();
    setProgressKey(attemptKeyRef.current);
    setOrderPhase('before');
    try {
      await syncToServer();
    } catch (err) {
      setOrderErr({ err, stage: 'sync' });
      return;
    }
    try {
      setOrderPhase('server');
      const resp = await checkout.mutateAsync({
        addressId,
        paymentMethod,
        customerNotes: notes || undefined,
        ...(slot ? { homeGrocery: slot } : {}),
        idempotencyKey: attemptKeyRef.current,
      });
      attemptKeyRef.current = null;
      setOrderPhase('after');
      clearCart();
      // MV Slice 4: split checkouts return { parent_order, orders } instead of
      // a single Order. Sniff for `orders` array to pick the destination —
      // the detail page detects the same shape server-side and renders the
      // per-store parent view. Cast is intentional: TS union narrowing here
      // is thwarted by Order also carrying an optional `parent_order` field.
      const isSplit = 'orders' in resp && Array.isArray((resp as { orders?: unknown }).orders);
      const landId = isSplit
        ? (resp as { parent_order: { id: string } }).parent_order.id
        : (resp as { id: string }).id;
      navigate(`/orders/${landId}`, { replace: true });
    } catch (err) {
      // attemptKeyRef is kept: the next press is the same attempt, so if this
      // one did commit, the server hands that order back instead of a second.
      setOrderErr({ err, stage: 'order' });
    }
  }

  if (items.length === 0) {
    return (
      <div className="max-w-[800px] mx-auto px-6 py-20 text-center">
        <h2 className="text-2xl font-extrabold text-ink font-display mb-2">{words.empty}</h2>
        <p className="text-sm text-gray font-body mb-6">{words.emptyDesc}</p>
        <button onClick={() => navigate('/')} className="h-12 px-8 bg-brand text-white rounded-xl font-bold font-display hover:bg-brand-mid">
          {words.startShopping}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-8">
      <button onClick={() => navigate('/cart')} className="flex items-center gap-2 text-sm font-semibold text-muted hover:text-brand transition-colors mb-6">
        <ArrowLeft size={16} />
        {hg.shopper ? (lang === 'en' ? 'Back to my list' : 'Volver a mi lista') : (lang === 'en' ? 'Back to cart' : 'Volver al carrito')}
      </button>

      <h1 className="text-3xl font-extrabold text-ink font-display mb-8">
        {hg.shopper ? (lang === 'en' ? 'Your Home Grocery order' : 'Tu pedido de la compra del hogar') : (lang === 'en' ? 'Checkout' : 'Finalizar compra')}
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">
        {/* LEFT: address + slot + payment */}
        <div className="flex flex-col gap-6">
          {/* Address */}
          <section className="bg-surface-white border border-border/60 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-extrabold text-ink font-display flex items-center gap-2">
                <MapPin size={18} className="text-brand" /> {lang === 'en' ? 'Delivery address' : 'Dirección de entrega'}
              </h2>
              <button
                onClick={() => navigate('/addresses')}
                className="text-xs font-bold text-brand hover:text-brand-mid uppercase tracking-wider flex items-center gap-1"
              >
                <Plus size={12} strokeWidth={2.5} /> {lang === 'en' ? 'Manage' : 'Gestionar'}
              </button>
            </div>

            {addressesLoading ? (
              <p className="text-sm text-muted font-body">{lang === 'en' ? 'Loading addresses…' : 'Cargando direcciones…'}</p>
            ) : !addresses || addresses.length === 0 ? (
              <div className="bg-surface-cream rounded-xl p-5 text-center">
                <p className="text-sm text-charcoal font-body mb-3">{lang === 'en' ? "You don't have any saved addresses yet." : 'Aún no tienes direcciones guardadas.'}</p>
                <button onClick={() => navigate('/addresses')} className="h-11 px-5 bg-brand text-white rounded-xl text-sm font-bold font-display hover:bg-brand-mid">
                  {lang === 'en' ? 'Add address' : 'Añadir dirección'}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {addresses.map((a) => {
                  const selected = addressId === a.id;
                  return (
                    <button
                      key={a.id}
                      onClick={() => setAddressId(a.id)}
                      className={`text-left p-4 rounded-xl border-2 transition-all relative ${
                        selected
                          ? 'border-brand bg-brand-mist/30'
                          : 'border-border bg-surface-white hover:border-brand-soft'
                      }`}
                    >
                      <p className="text-sm font-bold text-ink font-display">{a.contact_name}</p>
                      <p className="text-xs text-muted font-body mt-0.5">{a.contact_phone}</p>
                      <p className="text-sm text-charcoal font-body mt-2 leading-relaxed">
                        {a.street_line_1}
                        {a.street_line_2 && <>, {a.street_line_2}</>}
                        <br />
                        {a.postcode} {a.city}, {a.province}
                        <br />
                        España
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        {a.is_default && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-brand">{lang === 'en' ? 'Default' : 'Predeterminada'}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Delivery day and time — a Home Grocery household's order has a slot */}
          {hg.plan && slot ? (
            <section className="bg-surface-white border border-border/60 rounded-lg p-6">
              <h2 className="text-lg font-extrabold text-ink font-display flex items-center gap-2 mb-1">
                <CalendarDays size={18} className="text-brand" /> {lang === 'en' ? 'Delivery day and time' : 'Día y hora de entrega'}
              </h2>
              <p className="text-[13px] text-gray font-body mb-4">
                {lang === 'en' ? 'From your delivery information: ' : 'De tus datos de entrega: '}
                {FREQ_LABELS[hg.plan.frequency][lang].toLowerCase()}
                {hg.plan.preferred_weekday ? `, ${WEEKDAYS.find((d) => d.id === hg.plan!.preferred_weekday)?.long[lang]}` : ''}
                {', '}{windowLine(hg.plan.preferred_window, lang).toLowerCase()}.
                {' '}{lang === 'en' ? 'Pick another day for this order if you like.' : 'Elige otro día para este pedido si quieres.'}
              </p>
              <PlanSlotPicker value={slot} onChange={setSlotChoice} lang={lang} preferredWeekday={hg.plan.preferred_weekday} />
            </section>
          ) : (
          <section className="bg-surface-white border border-border/60 rounded-lg p-6">
            <h2 className="text-lg font-extrabold text-ink font-display flex items-center gap-2 mb-4">
              <Clock size={18} className="text-brand" /> {lang === 'en' ? 'Delivery time' : 'Entrega'}
            </h2>
            {!selectedAddress ? (
              <p className="text-sm text-muted font-body">{lang === 'en' ? 'Pick an address first.' : 'Elige primero una dirección.'}</p>
            ) : (
              <div className="bg-brand-mist/30 border border-brand-soft rounded-xl p-5 flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand text-white flex items-center justify-center shrink-0">
                  <Zap size={18} strokeWidth={2} fill="currentColor" />
                </div>
                <div>
                  <p className="text-sm font-bold text-ink font-display">{lang === 'en' ? 'Delivers ASAP' : 'Lo antes posible'}</p>
                  <p className="text-xs text-charcoal font-body mt-0.5 leading-relaxed">
                    {lang === 'en'
                      ? 'We start preparing your order as soon as it is confirmed, and you get a notification at every step. Delivery times depend on your area, so they are estimates rather than guarantees.'
                      : 'Empezamos a preparar tu pedido en cuanto se confirma, y te avisamos en cada paso. El tiempo de entrega depende de tu zona: es una estimación, no una garantía.'}
                  </p>
                </div>
              </div>
            )}
          </section>
          )}

          {/* Payment */}
          <section className="bg-surface-white border border-border/60 rounded-lg p-6">
            <h2 className="text-lg font-extrabold text-ink font-display flex items-center gap-2 mb-4">
              <CreditCard size={18} className="text-brand" /> {lang === 'en' ? 'Payment' : 'Pago'}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {(['cod', 'card'] as PaymentMethod[]).map((m) => {
                const Icon = m === 'cod' ? Banknote : CreditCard;
                const label = m === 'cod'
                  ? (lang === 'en' ? 'Cash on delivery' : 'Efectivo al recibir')
                  : (lang === 'en' ? 'Card on delivery' : 'Tarjeta al recibir');
                return (
                  <button
                    key={m}
                    onClick={() => setPaymentMethod(m)}
                    className={`p-4 rounded-xl border-2 transition-all flex items-center gap-3 ${
                      paymentMethod === m
                        ? 'border-brand bg-brand-mist/30'
                        : 'border-border bg-surface-white hover:border-brand-soft'
                    }`}
                  >
                    <Icon size={20} className={paymentMethod === m ? 'text-brand' : 'text-muted'} />
                    <span className="text-sm font-bold font-display text-ink">{label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Notes */}
          <section className="bg-surface-white border border-border/60 rounded-lg p-6">
            <h2 className="text-lg font-extrabold text-ink font-display mb-3">{lang === 'en' ? 'Order notes' : 'Notas del pedido'} <span className="text-xs font-normal text-muted">{lang === 'en' ? '(optional)' : '(opcional)'}</span></h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={lang === 'en' ? 'Anything we should know? Preferences, allergies, building access…' : '¿Algo que debamos saber? Preferencias, alergias, acceso al edificio…'}
              rows={3}
              maxLength={NOTES_LIMIT + 50}
              aria-invalid={notesError ? true : undefined}
              className={`w-full p-4 bg-surface-cream border-2 rounded-xl text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 resize-none transition-colors ${
                notesError
                  ? 'border-danger focus:border-danger focus:ring-danger/20'
                  : 'border-border focus:border-brand focus:ring-brand/30'
              }`}
            />
            <div className="flex items-center justify-between mt-1.5">
              {notesError ? (
                <p role="alert" className="text-[12px] text-danger font-ui font-medium">{notesError}</p>
              ) : <span />}
              <p className="text-[11px] font-mono text-muted">{notes.length} / {NOTES_LIMIT}</p>
            </div>
          </section>
        </div>

        {/* RIGHT: order summary */}
        <aside>
          {/* bg-surface-cream per the card rule — the previous
              bg-surface-linen/50 was the page background, so the card had no
              edge at all. Border kept very light so it reads as a lift rather
              than a box. */}
          <div className="sticky top-[120px] bg-surface-cream rounded-lg border border-border/25 shadow-card p-6">
            <h2 className="text-lg font-extrabold text-ink font-display mb-5">{t('cart.order_summary')}</h2>

            <SummaryLines lines={enriched} />

            <div className="border-t border-border/40 pt-4 flex flex-col gap-2 mb-4">
              {/* Subtotal always renders a real figure: the server quote when
                  we have it, the cart's own line prices otherwise. It used to
                  show "—" until the quote landed, which meant a failed quote
                  left the whole summary blank with nothing explaining why. */}
              <div className="flex justify-between text-sm font-display">
                <span className="text-gray">{t('cart.subtotal')}</span>
                <span className="text-ink font-semibold">€{subtotalValue.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm font-display">
                <span className="text-gray">{t('checkout.delivery')}</span>
                <span className={hasQuote ? 'text-ink font-semibold' : 'text-muted font-medium text-[13px]'}>
                  {hasQuote
                    ? feeComesLater
                      /* NOT "Free": our team adds it once it sees the order,
                         and promising free delivery here means a charge
                         appears later. */
                      ? t('checkout.feeAddedLater')
                      : `€${Number(quote!.deliveryFee).toFixed(2)}`
                    : !addressId
                      ? t('checkout.pickAddress')
                      : t('checkout.calculating')}
                </span>
              </div>

              {/* Where the fee came from, when it came from a distance band.
                  A number that changes with the address needs a reason
                  attached or it reads as a mistake.

                  Optional-chained throughout: an API deployed before distance
                  pricing sends no `delivery` object at all, and in flat mode
                  there is nothing to explain — both render nothing rather
                  than an empty row. */}
              {feeComesLater ? (
                /* Said plainly, because the number beside it is not the one
                   they will pay: our team adds delivery once it can see the
                   order, and tells them. */
                <p className="text-[11.5px] text-muted font-body -mt-1">
                  {t('checkout.feeLaterNote')}
                </p>
              ) : hasQuote && quote!.delivery?.mode === 'distance' ? (
                <p className="text-[11.5px] text-muted font-body -mt-1">
                  {quote!.delivery!.distanceKm} km · {quote!.delivery!.bandLabel}
                </p>
              ) : null}

              {/* Recargo de equivalencia: on top of the prices and already in
                  the quote's total, so the rows have to add up to it. */}
              {hasQuote && Number(quote!.recargo ?? 0) > 0 && (
                <div className="flex justify-between text-sm font-display">
                  <span className="text-gray">{t('order.recargo')}</span>
                  <span className="text-ink font-semibold">€{Number(quote!.recargo).toFixed(2)}</span>
                </div>
              )}

              {/* The IVA inside the subtotal, per rate (2026-11-01): prices
                  are shown with it, so this is what it comes to. The quote's
                  own figures, backed out as the order's documents do it. A
                  0 % row would say nothing, so only real rates are listed —
                  and an API from before this sends no `tax` at all. */}
              {vatRows.map((g) => (
                <div key={g.rate_pct} className="flex justify-between text-[12.5px] font-display">
                  <span className="text-muted">
                    {t('checkout.vat')} {g.rate_pct} %
                    <span className="text-muted/70"> · {t('checkout.vatBase')} €{Number(g.base).toFixed(2)}</span>
                  </span>
                  <span className="text-gray tabular-nums">€{Number(g.vat).toFixed(2)}</span>
                </div>
              ))}

            </div>

            <div className="border-t border-border/40 pt-4 mb-5">
              <div className="flex justify-between items-baseline">
                <span className="text-base font-extrabold text-ink font-display">{t('cart.total')}</span>
                <span className="text-2xl font-extrabold text-ink font-display">
                  €{(hasQuote ? Number(quote!.total) : subtotalValue).toFixed(2)}
                </span>
              </div>
              <p className="text-[11.5px] text-muted font-body mt-1">{t('checkout.vatIncluded')}</p>
              {/* Never imply the fallback figure is final — it has no delivery
                  fee in it. */}
              {!hasQuote ? (
                <p className="text-[11.5px] text-muted font-body mt-1.5">
                  {t('checkout.excludesDelivery')}
                </p>
              ) : feeComesLater ? (
                <p className="text-[11.5px] text-muted font-body mt-1.5">
                  {t('checkout.beforeDelivery')}
                </p>
              ) : null}
            </div>


            {/* A failed quote used to be completely silent. Surface it, and
                give a way back — a server cart emptied by a restart, or a
                transient network failure, both recover on retry. */}
            {quoteFailure && (
              <div className="bg-danger-bg border border-danger/25 rounded-xl p-3 mb-4">
                <p className="text-xs font-bold text-danger font-display mb-1">{quoteFailure.title}</p>
                <p className="text-xs text-charcoal font-body">{quoteFailure.body}</p>
                <button
                  type="button"
                  onClick={() => { void runQuote(); }}
                  disabled={orderQuote.isPending}
                  className="mt-2 text-xs font-bold font-display text-brand hover:text-brand-ink disabled:opacity-60"
                >
                  {orderQuote.isPending ? (lang === 'en' ? 'Retrying…' : 'Reintentando…') : (lang === 'en' ? 'Try again' : 'Reintentar')}
                </button>
              </div>
            )}

            {/* Issues from quote. `out_of_stock` is NOT a checkout blocker —
                the backend routes those lines into a draft order that ships
                once restocked, so this is informational. `unavailable`
                (deactivated product) IS still a hard blocker server-side and
                needs the customer to actually remove the item. `out_of_area`
                used to be a second blocker; with coverage removed no item is
                ever excluded for where it is going. */}
            {quote?.issues?.length ? (() => {
              const named = quote.issues.map((i) => {
                const match = enriched.find((e) => e.variantId === i.variantId);
                return { ...i, name: match?.product?.name_es ?? t('checkout.issueItemFallback') };
              });
              const outOfStock = named.filter((i) => i.reason === 'out_of_stock');
              const blocking = named.filter((i) => i.reason !== 'out_of_stock');
              return (
                <div className="space-y-2 mb-4">
                  {outOfStock.length > 0 && hg.shopper && (
                    <div className="bg-danger-bg border border-danger/25 rounded-xl p-3">
                      <p className="text-xs font-bold text-danger font-display mb-1">
                        {lang === 'en' ? "We don't have enough of these" : 'No tenemos bastante de estos productos'}
                      </p>
                      <ul className="text-xs text-charcoal font-body space-y-0.5">
                        {outOfStock.map((i, idx) => <li key={idx}>· {i.name}</li>)}
                      </ul>
                      <p className="mt-1.5 text-xs text-muted font-body">
                        {lang === 'en' ? 'Lower the quantity or remove them from your list, then place the order.' : 'Baja la cantidad o quítalos de tu lista y haz el pedido.'}
                      </p>
                    </div>
                  )}
                  {outOfStock.length > 0 && !hg.shopper && (
                    <div className="bg-amber-mist/50 border border-amber/30 rounded-xl p-3">
                      <p className="text-xs font-bold text-amber-deep font-display mb-1">
                        {t('checkout.outOfStockHeading')}
                      </p>
                      <ul className="text-xs text-charcoal font-body space-y-0.5">
                        {outOfStock.map((i, idx) => (
                          <li key={idx}>· {i.name} — {t('checkout.outOfStockNote')}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {blocking.length > 0 && (
                    <div className="bg-danger-bg border border-danger/25 rounded-xl p-3">
                      <p className="text-xs font-bold text-danger font-display mb-1">
                        {t('checkout.blockingHeading')}
                      </p>
                      <ul className="text-xs text-charcoal font-body space-y-0.5">
                        {/* `out_of_area` was the other reason here. The API
                            cannot emit it any more — no item is excluded for
                            where it is going — so `unavailable` is the only
                            blocking reason left. */}
                        {blocking.map((i, idx) => (
                          <li key={idx}>
                            · {i.name} — {t('checkout.unavailableNote')}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })() : null}

            {error && (
              <p className="text-sm text-danger font-body bg-danger-bg rounded-xl p-3 mb-4">{error}</p>
            )}
            {orderFailure && <FailureNotice failure={orderFailure} />}
            {orderShortfalls.length > 0 && (
              <ul className="-mt-2 mb-4 rounded-xl bg-danger-bg/60 px-4 py-2.5 text-xs text-charcoal font-body space-y-0.5">
                {orderShortfalls.map((s) => (
                  <li key={s.productName}>· {s.productName} — {lang === 'en' ? `${s.available} left` : `quedan ${s.available}`}</li>
                ))}
              </ul>
            )}

            {/* `!isServiceable` used to be part of the disabled condition.
                Coverage is not modelled any more — every address is
                deliverable — so the only remaining blockers are a missing
                address and an item that cannot be fulfilled. */}
            <button
              onClick={placeOrder}
              disabled={busy || !addressId || hasBlockingIssues || hg.loading}
              className="w-full h-12 bg-brand text-white rounded-xl text-base font-bold font-display hover:bg-brand-mid disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-md"
            >
              {busy && <Loader2 size={18} strokeWidth={2} className="animate-spin" />}
              {busy
                ? (lang === 'en' ? 'Placing order…' : 'Haciendo el pedido…')
                : hg.shopper ? (lang === 'en' ? 'Place my order' : 'Hacer mi pedido') : (lang === 'en' ? 'Place order' : 'Hacer el pedido')}
            </button>
            {waitVerdict && (
              <p role="status" className="text-xs text-charcoal font-body text-center mt-3 leading-relaxed">
                {slowOrderHint(waitVerdict, lang, items.length)}
              </p>
            )}
            {/* Over the page while a slow order is placed: what is happening,
                step by step. The connection hint above moves into it, since
                the panel covers the button it sits under. */}
            {busy && (
              <OrderProgressPanel
                key={attemptNo}
                kind="checkout"
                phase={orderPhase}
                progressKey={progressKey}
                lang={lang}
                detail={{ lines: items.length, shops: shopCount || undefined }}
                withBasket
                withOpening
                note={waitVerdict ? slowOrderHint(waitVerdict, lang, items.length) : undefined}
              />
            )}

            <div className="flex items-center justify-center gap-2 mt-4 text-xs text-muted font-body">
              <ShieldCheck size={12} /> {lang === 'en' ? 'Secure checkout' : 'Pago seguro'}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
