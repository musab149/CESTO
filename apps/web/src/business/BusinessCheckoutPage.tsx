import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Banknote, Check, Clock, CreditCard, Loader2, MapPin, Package, Plus, ShieldCheck, Truck, WifiOff,
} from 'lucide-react';
import {
  MAX_ORDER_LINES, probeConnection, useAddresses, useCheckout, useOrderQuote, useProductsByIds,
  type ConnectionVerdict, type PaymentMethod,
} from '@grocery-app/shared';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { useCheckoutFailure, slowOrderHint, type CheckoutStage, type FailureCopy } from '@/lib/checkoutFailure';
import OrderProgressPanel from '@/components/OrderProgressPanel';
import { money } from '@/sales/lib/format';
import BackLink from '@/sales/components/BackLink';
import { Card } from '@/sales/components/ui';
import EmptyState from '@/sales/components/EmptyState';
import { useBizT } from './lib/i18n';
import Photo from './components/Photo';

/**
 * Placing the buyer's order (2026-10-29): the shop's checkout
 * (pages/CheckoutPage) in the panel — and every rule it learned the hard way,
 * kept as they are there:
 *   · the basket is pushed to the server first, and NOTHING is ordered if
 *     that fails (an order is placed from the server's copy of the basket);
 *   · one attempt key per basket, kept across a failed press, so a retry after
 *     a timeout gets the order that was placed instead of a second one;
 *   · one flag for the whole act — a ref as well as state, against a double
 *     press in one tick;
 *   · the progress panel while it runs, and why it is slow if it is;
 *   · failures worded by whose side they were on (lib/checkoutFailure).
 * Without Home Grocery: it is not for businesses.
 *
 * The total is the server's quote. Delivery is added by the team once they
 * have seen the order, so the quote's zero is "not decided" and says so.
 */

const SLOW_ORDER_MS = 8_000;
const NOTES_LIMIT = 500;

function FailureNotice({ failure }: { failure: FailureCopy }) {
  const connection = failure.kind === 'offline' || failure.kind === 'slow_connection';
  return (
    <div role="alert" className="flex gap-2.5 bg-danger-bg border border-danger/25 rounded-xl p-3 mb-3">
      {connection ? <WifiOff size={16} strokeWidth={1.75} className="text-danger shrink-0 mt-px" /> : <Clock size={16} strokeWidth={1.75} className="text-danger shrink-0 mt-px" />}
      <div>
        <p className="text-[13px] font-bold text-danger font-display">{failure.title}</p>
        <p className="text-[12.5px] text-charcoal mt-0.5">{failure.body}</p>
      </div>
    </div>
  );
}

type SummaryLine = { variantId: string; quantity: number; name: string; size: string; price: number; image?: string | null };

const SummaryLines = memo(function SummaryLines({ lines }: { lines: SummaryLine[] }) {
  return (
    <ul className="flex flex-col gap-3 max-h-[280px] overflow-y-auto pr-1">
      {lines.map((l) => (
        <li key={l.variantId} className="flex items-center gap-3">
          <span className="sales-photo w-11 h-11 rounded-lg bg-surface-cream ring-1 ring-inset ring-border overflow-hidden shrink-0 flex items-center justify-center">
            <Photo url={l.image} preset="thumb" icon={16} className="w-full h-full object-contain p-0.5" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold font-display text-ink truncate">{l.name}</span>
            <span className="block text-[11.5px] text-muted">{l.quantity} × {money(l.price)}{l.size ? ` · ${l.size}` : ''}</span>
          </span>
          <span className="text-[13.5px] font-bold font-display text-ink tabular-nums">{money(l.price * l.quantity)}</span>
        </li>
      ))}
    </ul>
  );
});

export default function BusinessCheckoutPage() {
  const t = useBizT();
  const lang = useLanguageStore((s) => s.lang) as 'es' | 'en';
  const navigate = useNavigate();
  const items = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clearCart);
  const syncToServer = useCartStore((s) => s.syncToServer);
  const { data: addresses, isLoading: addressesLoading } = useAddresses();

  const productIds = useMemo(() => Array.from(new Set(items.map((i) => i.productId))), [items]);
  const { data: products = [] } = useProductsByIds(productIds, { inlineErrors: true });
  const shopCount = useMemo(() => new Set(products.map((p) => p.store_id ?? 'cesto')).size, [products]);
  const lines: SummaryLine[] = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    return items.map((i) => {
      const p = byId.get(i.productId);
      const v = p?.variants?.find((x) => x.id === i.variantId);
      return {
        variantId: i.variantId,
        quantity: i.quantity,
        name: p ? ((lang === 'en' && p.name_en) || p.name_es) : '…',
        size: v ? ((lang === 'en' && v.name_en) || v.name_es) : '',
        price: v ? Number(v.price) : 0,
        image: p?.images?.find((im) => im.is_primary)?.url ?? p?.images?.[0]?.url,
      };
    });
  }, [items, products, lang]);
  // The cart holds checkout while a line has no wholesale price; arriving here
  // anyway (a link, the back button) is sent back to it.
  const noB2b = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    return items.some((i) => {
      const v = byId.get(i.productId)?.variants?.find((x) => x.id === i.variantId);
      return !!v && v.b2b_price == null;
    });
  }, [items, products]);

  const [addressId, setAddressId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const notesError = notes.length > NOTES_LIMIT ? t('biz.checkout.notesTooLong', { max: NOTES_LIMIT }) : null;

  useEffect(() => {
    if (addressId || !addresses?.length) return;
    setAddressId((addresses.find((a) => a.is_default) ?? addresses[0]).id);
  }, [addresses, addressId]);

  // The quote: the server prices the server's basket, so it is pushed up first.
  const orderQuote = useOrderQuote();
  const runQuote = useCallback(async () => {
    if (!addressId || items.length === 0) return;
    try { await syncToServer(); } catch { /* the quote surfaces any basket issue */ }
    orderQuote.mutate(addressId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressId, items.length]);
  const cartSignature = useMemo(() => items.map((i) => `${i.variantId}:${i.quantity}`).sort().join('|'), [items]);
  useEffect(() => {
    void runQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressId, cartSignature]);
  const quote = orderQuote.data;
  const linesSubtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const subtotal = quote ? Number(quote.subtotal) : linesSubtotal;
  const total = quote ? Number(quote.total) : linesSubtotal;
  const feeLater = !quote || quote.deliveryFeePending === true || quote.delivery?.reason === 'b2b' || Number(quote.deliveryFee) === 0;
  /** The quote's IVA rows with something in them (2026-11-01); none from an older API. */
  const vatRows = (quote?.tax?.by_rate ?? []).filter((g) => g.rate_pct > 0);
  const quoteFailure = useCheckoutFailure(orderQuote.isError ? orderQuote.error : null, 'quote', lang);
  const issues = quote?.issues ?? [];
  const blocking = issues.filter((i) => i.reason !== 'out_of_stock');
  const shortOnes = issues.filter((i) => i.reason === 'out_of_stock');
  const nameOfVariant = (variantId: string) => lines.find((l) => l.variantId === variantId)?.name ?? t('biz.checkout.anItem');

  const checkout = useCheckout();
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  const attemptKeyRef = useRef<string | null>(null);
  const busy = placing || checkout.isPending;
  const [orderPhase, setOrderPhase] = useState<'before' | 'server' | 'after'>('before');
  const [progressKey, setProgressKey] = useState<string | null>(null);
  const [orderErr, setOrderErr] = useState<{ err: unknown; stage: CheckoutStage } | null>(null);
  const orderFailure = useCheckoutFailure(orderErr?.err ?? null, orderErr?.stage ?? 'order', lang);
  const orderShortfalls = ((orderErr?.err as { data?: { shortfalls?: unknown } } | undefined)?.data?.shortfalls ?? []) as
    Array<{ productName: string; needed: number; available: number }>;
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
    try { await runPlaceOrder(); } finally { placingRef.current = false; setPlacing(false); }
  }

  async function runPlaceOrder() {
    setError(null);
    setOrderErr(null);
    if (!addressId) { setError(t('biz.checkout.pickAddress')); return; }
    if (items.length === 0) { setError(t('biz.cart.emptyTitle')); return; }
    if (notesError) { setError(notesError); return; }
    if (noB2b) { setError(t('biz.cart.blockedTitle')); return; }
    if (blocking.length > 0) { setError(t('biz.checkout.blockingTitle')); return; }
    if (items.length > MAX_ORDER_LINES) { setError(t('biz.cart.tooMany', { count: items.length, max: MAX_ORDER_LINES })); return; }
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
        customerNotes: notes.trim() || undefined,
        idempotencyKey: attemptKeyRef.current,
      });
      attemptKeyRef.current = null;
      setOrderPhase('after');
      clearCart();
      const isSplit = 'orders' in resp && Array.isArray((resp as { orders?: unknown }).orders);
      const landId = isSplit ? (resp as { parent_order: { id: string } }).parent_order.id : (resp as { id: string }).id;
      navigate(`/business/orders/${landId}?placed=1`, { replace: true });
    } catch (err) {
      // The key is kept: the next press is the same attempt.
      setOrderErr({ err, stage: 'order' });
    }
  }

  if (items.length === 0) {
    return (
      <div>
        <BackLink label={t('biz.cart.title')} onClick={() => navigate('/business/cart')} />
        <Card>
          <EmptyState
            icon={<Package size={28} strokeWidth={1.75} className="text-muted" />}
            title={t('biz.cart.emptyTitle')}
            description={t('biz.cart.emptyBody')}
            action={{ label: t('biz.cart.emptyCta'), onClick: () => navigate('/business/catalogue') }}
          />
        </Card>
      </div>
    );
  }

  const section = 'text-[16px] font-bold font-display text-ink';
  return (
    <div className="pb-6">
      <BackLink label={t('biz.cart.title')} title={t('biz.checkout.title')} onClick={() => navigate('/business/cart')} />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-3 md:gap-4 items-start">
        <div className="flex flex-col gap-3 md:gap-4 min-w-0">
          {/* ── Where it goes ── */}
          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className={section}>{t('biz.checkout.address')}</h2>
              <button type="button" onClick={() => navigate('/business/account/addresses', { state: { from: '/business/checkout' } })} className="inline-flex items-center gap-1 text-[13px] font-semibold font-display text-brand hover:underline">
                <Plus size={15} strokeWidth={2} />{t('biz.checkout.manageAddresses')}
              </button>
            </div>
            {addressesLoading ? (
              <p className="text-[13.5px] text-muted">{t('biz.checkout.loadingAddresses')}</p>
            ) : !addresses?.length ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-center">
                <p className="text-[13.5px] text-charcoal">{t('biz.checkout.noAddress')}</p>
                <button type="button" onClick={() => navigate('/business/account/addresses', { state: { from: '/business/checkout', add: true } })} className="mt-3 h-11 px-5 rounded-xl bg-brand text-white text-[14px] font-semibold font-display hover:bg-brand-mid">
                  {t('biz.checkout.addAddress')}
                </button>
              </div>
            ) : (
              <div role="radiogroup" aria-label={t('biz.checkout.address')} className="grid gap-2 sm:grid-cols-2">
                {addresses.map((a) => {
                  const on = a.id === addressId;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setAddressId(a.id)}
                      className={`text-left rounded-xl border p-3 flex gap-2.5 transition-colors ${on ? 'border-brand bg-brand-whisper' : 'border-border bg-card hover:border-brand/40'}`}
                    >
                      <MapPin size={17} strokeWidth={1.75} className={on ? 'text-brand mt-0.5 shrink-0' : 'text-muted mt-0.5 shrink-0'} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold font-display text-ink truncate">{a.street_line_1}</span>
                        <span className="block text-[12.5px] text-gray truncate">{[a.postcode, a.city].filter(Boolean).join(' ')}</span>
                        <span className="block text-[12px] text-muted truncate mt-0.5">{a.contact_name}{a.contact_phone ? ` · ${a.contact_phone}` : ''}</span>
                      </span>
                      {on && <Check size={17} strokeWidth={2.5} className="text-brand shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* ── How it is paid ── */}
          <Card className="p-4 sm:p-5">
            <h2 className={`${section} mb-3`}>{t('biz.checkout.payment')}</h2>
            <div role="radiogroup" aria-label={t('biz.checkout.payment')} className="grid gap-2 sm:grid-cols-2">
              {(['cod', 'card'] as PaymentMethod[]).map((m) => {
                const on = paymentMethod === m;
                const Icon = m === 'cod' ? Banknote : CreditCard;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setPaymentMethod(m)}
                    className={`text-left rounded-xl border p-3 flex items-center gap-3 transition-colors ${on ? 'border-brand bg-brand-whisper' : 'border-border bg-card hover:border-brand/40'}`}
                  >
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${on ? 'bg-card text-brand' : 'bg-surface-cream text-muted'}`}><Icon size={19} strokeWidth={1.75} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold font-display text-ink">{t(`biz.checkout.pay.${m}`)}</span>
                      <span className="block text-[12.5px] text-gray">{t(`biz.checkout.pay.${m}Hint`)}</span>
                    </span>
                    {on && <Check size={17} strokeWidth={2.5} className="text-brand shrink-0" />}
                  </button>
                );
              })}
            </div>
          </Card>

          {/* ── Notes for the team ── */}
          <Card className="p-4 sm:p-5">
            <label htmlFor="biz-notes" className={section}>{t('biz.checkout.notes')}</label>
            <p className="text-[12.5px] text-muted mt-0.5">{t('biz.checkout.notesHint')}</p>
            <textarea
              id="biz-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={t('biz.checkout.notesPlaceholder')}
              className="mt-3 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-[14px] text-ink placeholder:text-muted focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
            <p className={`mt-1 text-right text-[11.5px] tabular-nums ${notesError ? 'text-danger' : 'text-muted'}`}>{notes.length} / {NOTES_LIMIT}</p>
          </Card>
        </div>

        {/* ── The order ── */}
        <Card className="p-4 sm:p-5 lg:sticky lg:top-16">
          <h2 className={`${section} mb-3`}>{t('biz.checkout.summary')}</h2>
          <SummaryLines lines={lines} />
          {/* BASE + VAT = TOTAL (user, 2026-11-01). A business reads its sums
              without VAT, so the summary starts from the base and adds each
              rate's VAT up to the total — the quote's own figures, as the
              order's documents back them out. The lines above keep their
              prices with VAT. 0 % adds nothing, so it has no row. An API from
              before the quote carried `tax` gets the subtotal as it was. */}
          <dl className="mt-4 pt-3 border-t border-border text-[14px]">
            {quote?.tax ? (
              <>
                <div className="flex items-baseline justify-between gap-3 py-1">
                  <dt className="text-gray">{t('biz.checkout.base')}</dt>
                  <dd className="font-semibold font-display text-ink tabular-nums">{money(Number(quote.tax.base))}</dd>
                </div>
                {vatRows.map((g) => (
                  <div key={g.rate_pct} className="flex items-baseline justify-between gap-3 py-1">
                    <dt className="text-gray">{t('biz.edit.vatAt', { rate: g.rate_pct })}</dt>
                    <dd className="font-semibold font-display text-ink tabular-nums">{money(Number(g.vat))}</dd>
                  </div>
                ))}
                {/* Recargo de equivalencia (2026-11-04): a shop under the
                    regime pays it on top of IVA, on the same base. Already in
                    the quoted total. */}
                {quote.recargo !== undefined && (
                  <div className="flex items-baseline justify-between gap-3 py-1">
                    <dt className="text-gray">{t('biz.checkout.recargo')}</dt>
                    <dd className="font-semibold font-display text-ink tabular-nums">{money(Number(quote.recargo))}</dd>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-baseline justify-between gap-3 py-1">
                <dt className="text-gray">{t('biz.cart.subtotal')}</dt>
                <dd className="font-semibold font-display text-ink tabular-nums">{money(subtotal)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3 py-1">
              <dt className="text-gray">{t('biz.cart.delivery')}</dt>
              <dd className="text-right">{feeLater ? <span className="text-gray">{t('biz.cart.deliveryLater')}</span> : <span className="font-semibold font-display text-ink tabular-nums">{money(Number(quote!.deliveryFee))}</span>}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 pt-3 mt-2 border-t border-dashed border-border">
              <dt className="text-[15px] font-semibold font-display text-ink">{feeLater ? t('biz.checkout.totalSoFar') : t('biz.cart.total')}</dt>
              <dd className="text-[22px] font-bold font-display text-brand tabular-nums">{money(total)}</dd>
            </div>
          </dl>
          {feeLater && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-muted"><Truck size={14} strokeWidth={1.75} className="shrink-0 mt-px" />{t('biz.cart.deliveryNote')}</p>
          )}

          {quoteFailure && (
            <div role="alert" className="mt-3 bg-danger-bg border border-danger/25 rounded-xl p-3">
              <p className="text-[13px] font-bold text-danger font-display">{quoteFailure.title}</p>
              <p className="text-[12.5px] text-charcoal mt-0.5">{quoteFailure.body}</p>
              <button type="button" onClick={() => void runQuote()} className="mt-2 text-[12.5px] font-semibold font-display text-brand">{t('biz.retry')}</button>
            </div>
          )}
          {shortOnes.length > 0 && (
            <div className="mt-3 bg-warning-bg border border-warning/25 rounded-xl p-3">
              <p className="text-[13px] font-bold text-warning font-display">{t('biz.checkout.shortTitle')}</p>
              <ul className="mt-1 text-[12.5px] text-charcoal space-y-0.5">{shortOnes.map((i) => <li key={i.variantId}>· {nameOfVariant(i.variantId)} — {t('biz.checkout.shortNote')}</li>)}</ul>
            </div>
          )}
          {blocking.length > 0 && (
            <div className="mt-3 bg-danger-bg border border-danger/25 rounded-xl p-3">
              <p className="text-[13px] font-bold text-danger font-display">{t('biz.checkout.blockingTitle')}</p>
              <ul className="mt-1 text-[12.5px] text-charcoal space-y-0.5">{blocking.map((i) => <li key={i.variantId}>· {nameOfVariant(i.variantId)} — {t('biz.checkout.unavailable')}</li>)}</ul>
            </div>
          )}
          {noB2b && (
            <div className="mt-3 bg-warning-bg border border-warning/25 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle size={16} strokeWidth={2} className="text-warning shrink-0 mt-px" />
              <div>
                <p className="text-[13px] font-bold text-ink font-display">{t('biz.cart.blockedTitle')}</p>
                <button type="button" onClick={() => navigate('/business/cart')} className="mt-1 text-[12.5px] font-semibold font-display text-brand">{t('biz.checkout.backToCart')}</button>
              </div>
            </div>
          )}

          <div className="mt-4">
            {error && <p className="text-[13px] text-danger bg-danger-bg rounded-xl p-3 mb-3">{error}</p>}
            {orderFailure && <FailureNotice failure={orderFailure} />}
            {orderShortfalls.length > 0 && (
              <ul className="mb-3 rounded-xl bg-danger-bg/60 px-4 py-2.5 text-[12.5px] text-charcoal space-y-0.5">
                {orderShortfalls.map((s) => <li key={s.productName}>· {s.productName} — {t('biz.checkout.left', { count: s.available })}</li>)}
              </ul>
            )}
            <button
              type="button"
              onClick={() => void placeOrder()}
              disabled={busy || !addressId || blocking.length > 0 || noB2b}
              className="w-full min-h-[52px] rounded-xl bg-brand hover:bg-brand-mid text-white text-[15.5px] font-semibold font-display inline-flex items-center justify-center gap-2 shadow-[0_10px_22px_-10px_rgba(5,78,232,0.7)] transition-colors disabled:bg-surface-sand disabled:text-muted disabled:shadow-none"
            >
              {busy && <Loader2 size={18} strokeWidth={2} className="animate-spin" />}
              {busy ? t('biz.checkout.placing') : t('biz.checkout.place', { total: money(total) })}
            </button>
            {waitVerdict && <p role="status" className="text-[12.5px] text-charcoal text-center mt-3 leading-relaxed">{slowOrderHint(waitVerdict, lang, items.length)}</p>}
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-muted"><ShieldCheck size={13} strokeWidth={1.75} />{t('biz.checkout.payOnDelivery')}</p>
          </div>
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
        </Card>
      </div>
    </div>
  );
}
