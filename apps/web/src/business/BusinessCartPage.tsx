import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Minus, Plus, ShoppingCart, Store, Trash2, Truck } from 'lucide-react';
import { MAX_ORDER_LINES, useProductsByIds, type Product, type ProductVariant } from '@grocery-app/shared';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { money } from '@/sales/lib/format';
import { Card, PageHeader } from '@/sales/components/ui';
import EmptyState from '@/sales/components/EmptyState';
import { Skeleton } from '@/sales/components/Skeleton';
import { useToast } from '@/sales/components/Toast';
import QuantityField from '@/components/QuantityField';
import { useBizT } from './lib/i18n';
import Photo from './components/Photo';

/**
 * The buyer's cart (2026-10-29): the shop's cart (stores/cartStore — the same
 * basket, kept on the server) in the panel's dress, grouped by the shop each
 * line comes from, because an order across shops is placed as one order per
 * shop.
 *
 * Every price is what they pay (the API prices a business at wholesale), and
 * no retail price is shown anywhere (user, 2026-10-30). A line with no
 * wholesale price — put in before the panel, or by repeating an old order —
 * would be charged retail, and this catalogue is wholesale only (user,
 * 2026-10-29: "Only products with a B2B price"): it is marked, without a
 * price, and checkout waits until it is taken out.
 */

type Line = {
  productId: string;
  variantId: string;
  quantity: number;
  product?: Product;
  variant?: ProductVariant;
};

export default function BusinessCartPage() {
  const t = useBizT();
  const lang = useLanguageStore((s) => s.lang) as 'es' | 'en';
  const navigate = useNavigate();
  const toast = useToast();
  const items = useCartStore((s) => s.items);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const clearCart = useCartStore((s) => s.clearCart);
  const syncToServer = useCartStore((s) => s.syncToServer);

  const productIds = useMemo(() => Array.from(new Set(items.map((i) => i.productId))), [items]);
  const { data: products = [], isLoading } = useProductsByIds(productIds, { inlineErrors: true });

  const lines: Line[] = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    return items.map((i) => {
      const product = byId.get(i.productId);
      return { ...i, product, variant: product?.variants?.find((v) => v.id === i.variantId) as Line['variant'] };
    });
  }, [items, products]);

  // By shop, Cesto's own first: one order is placed per shop.
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; name: string; lines: Line[] }>();
    for (const l of lines) {
      const key = l.product?.store_id ?? 'cesto';
      const name = l.product?.store?.name ?? t('biz.house');
      if (!m.has(key)) m.set(key, { key, name, lines: [] });
      m.get(key)!.lines.push(l);
    }
    return [...m.values()].sort((a, b) => (a.key === 'cesto' ? -1 : b.key === 'cesto' ? 1 : a.name.localeCompare(b.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, lang]);

  const hasB2b = (l: Line) => l.variant?.b2b_price != null;
  const resolved = (l: Line) => !!l.variant;
  const noB2b = lines.filter((l) => resolved(l) && !hasB2b(l));
  const gone = lines.filter((l) => !isLoading && !resolved(l));
  const payable = lines.filter((l) => resolved(l) && hasB2b(l));
  const subtotal = payable.reduce((s, l) => s + Number(l.variant!.price) * l.quantity, 0);
  const units = items.reduce((s, i) => s + i.quantity, 0);
  const blocked = noB2b.length > 0 || gone.length > 0;
  const tooMany = items.length > MAX_ORDER_LINES;

  const removeBlocked = async () => {
    for (const l of [...noB2b, ...gone]) removeItem(l.variantId);
    try { await syncToServer(); } catch { /* checkout syncs again */ }
  };
  const emptyCart = async () => {
    clearCart();
    try { await syncToServer(); } catch { /* checkout syncs again */ }
  };

  if (items.length === 0) {
    return (
      <div>
        <PageHeader title={t('biz.cart.title')} />
        <Card>
          <EmptyState
            icon={<ShoppingCart size={28} strokeWidth={1.75} className="text-muted" />}
            title={t('biz.cart.emptyTitle')}
            description={t('biz.cart.emptyBody')}
            action={{ label: t('biz.cart.emptyCta'), onClick: () => navigate('/business/catalogue') }}
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('biz.cart.title')}
        subtitle={t(items.length === 1 ? 'biz.cart.summary_one' : 'biz.cart.summary_other', { lines: items.length, units })}
        actions={(
          <button
            type="button"
            onClick={() => void emptyCart()}
            className="h-10 px-3.5 rounded-xl bg-card border border-border shadow-card inline-flex items-center gap-2 text-[13.5px] font-semibold font-display text-gray hover:text-danger hover:border-danger/40 transition-colors"
          >
            <Trash2 size={16} strokeWidth={1.75} />
            <span className="hidden sm:inline">{t('biz.cart.clear')}</span>
          </button>
        )}
      />

      {blocked && (
        <div role="alert" className="mb-3 rounded-2xl border border-warning/25 bg-warning-bg px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={20} strokeWidth={1.75} className="text-warning shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold font-display text-ink">{t('biz.cart.blockedTitle')}</p>
            <p className="text-[13px] text-gray mt-0.5">{t('biz.cart.blockedBody')}</p>
          </div>
          <button type="button" onClick={() => void removeBlocked()} className="shrink-0 h-9 px-3 rounded-lg bg-card border border-warning/30 text-[13px] font-semibold font-display text-ink hover:border-warning transition-colors">
            {t('biz.cart.removeThem')}
          </button>
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-3 md:gap-4 items-start">
        <div className="flex flex-col gap-3 md:gap-4 min-w-0">
          {groups.map((g) => (
            <Card key={g.key} className="overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-border flex items-center gap-2">
                <Store size={16} strokeWidth={1.75} className="text-brand" />
                <h2 className="text-[14.5px] font-bold font-display text-ink truncate">{g.name}</h2>
                <span className="text-[12.5px] text-muted">{t(g.lines.length === 1 ? 'biz.orders.lines_one' : 'biz.orders.lines_other', { count: g.lines.length })}</span>
              </div>
              <ul className="divide-y divide-border">
                {g.lines.map((l) => (
                  <CartLine
                    key={l.variantId}
                    line={l}
                    lang={lang}
                    loading={isLoading && !l.variant}
                    onQty={(n) => updateQuantity(l.variantId, n)}
                    onRemove={() => removeItem(l.variantId)}
                    onCapped={(n) => toast.warning(t('biz.cart.capped', { count: n }))}
                    onOpen={() => navigate(`/business/products/${l.productId}`)}
                  />
                ))}
              </ul>
            </Card>
          ))}
        </div>

        {/* ── What it comes to ── */}
        <Card className="p-4 sm:p-5 lg:sticky lg:top-16">
          <h2 className="text-[16px] font-bold font-display text-ink">{t('biz.cart.summaryTitle')}</h2>
          <dl className="mt-3 text-[14px]">
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-gray">{t('biz.cart.subtotal')}</dt>
              <dd className="font-semibold font-display text-ink tabular-nums">{isLoading ? '—' : money(subtotal)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-gray">{t('biz.cart.delivery')}</dt>
              <dd className="text-gray text-right">{t('biz.cart.deliveryLater')}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 pt-3 mt-2 border-t border-dashed border-border">
              <dt className="text-[15px] font-semibold font-display text-ink">{t('biz.cart.total')}</dt>
              <dd className="text-[22px] font-bold font-display text-brand tabular-nums">{isLoading ? '—' : money(subtotal)}</dd>
            </div>
          </dl>
          <p className="mt-2 flex items-start gap-1.5 text-[12px] text-muted">
            <Truck size={14} strokeWidth={1.75} className="shrink-0 mt-px" />
            {t('biz.cart.deliveryNote')}
          </p>
          {tooMany && <p className="mt-3 text-[13px] text-danger">{t('biz.cart.tooMany', { count: items.length, max: MAX_ORDER_LINES })}</p>}
          <button
            type="button"
            onClick={() => navigate('/business/checkout')}
            disabled={blocked || tooMany || isLoading}
            className="mt-4 w-full min-h-[52px] rounded-xl bg-brand hover:bg-brand-mid text-white text-[15px] font-semibold font-display inline-flex items-center justify-center gap-2 shadow-[0_10px_22px_-10px_rgba(5,78,232,0.7)] transition-colors disabled:bg-surface-sand disabled:text-muted disabled:shadow-none"
          >
            {t('biz.cart.checkout')}
            <ArrowRight size={18} strokeWidth={2.25} />
          </button>
          <button type="button" onClick={() => navigate('/business/catalogue')} className="mt-2 w-full h-11 rounded-xl text-[14px] font-semibold font-display text-brand hover:bg-brand-whisper transition-colors">
            {t('biz.cart.keepShopping')}
          </button>
        </Card>
      </div>
    </div>
  );
}

function CartLine({ line: l, lang, loading, onQty, onRemove, onCapped, onOpen }: {
  line: Line; lang: 'es' | 'en'; loading: boolean;
  onQty: (n: number) => void; onRemove: () => void; onCapped: (n: number) => void; onOpen: () => void;
}) {
  const t = useBizT();
  if (loading) {
    return (
      <li className="px-4 sm:px-5 py-3.5 flex gap-3">
        <Skeleton className="w-16 h-16 rounded-xl" />
        <div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/3" /></div>
      </li>
    );
  }
  const p = l.product;
  const v = l.variant;
  const name = p ? ((lang === 'en' && p.name_en) || p.name_es) : t('biz.cart.goneName');
  const size = v ? ((lang === 'en' && v.name_en) || v.name_es) : '';
  const img = p?.images?.find((i) => i.is_primary)?.url ?? p?.images?.[0]?.url;
  const noB2b = !!v && v.b2b_price == null;
  const pay = v ? Number(v.price) : 0;
  const max = v ? Math.max(1, v.stock_quantity) : 1;
  return (
    <li className={`px-4 sm:px-5 py-3.5 flex gap-3 ${noB2b || !v ? 'bg-warning-bg/40' : ''}`}>
      <button type="button" onClick={onOpen} disabled={!p} className="sales-photo w-16 h-16 rounded-xl overflow-hidden bg-surface-cream ring-1 ring-inset ring-border shrink-0 flex items-center justify-center">
        <Photo url={img} preset="thumb" icon={22} className="w-full h-full object-contain p-1" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <button type="button" onClick={onOpen} disabled={!p} className="min-w-0 flex-1 text-left">
            <span className="block text-[14.5px] font-semibold font-display text-ink leading-snug line-clamp-2">{name}</span>
            {size && <span className="block text-[12.5px] text-muted mt-0.5">{size}</span>}
          </button>
          <button type="button" onClick={onRemove} aria-label={t('biz.cart.remove', { name })} title={t('biz.cart.remove', { name })} className="w-9 h-9 -mr-1.5 -mt-1 rounded-lg flex items-center justify-center text-muted hover:text-danger hover:bg-danger-bg transition-colors shrink-0">
            <Trash2 size={16} strokeWidth={1.75} />
          </button>
        </div>
        {noB2b || !v ? (
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] font-semibold font-display text-warning">
            <AlertTriangle size={14} strokeWidth={2} />
            {v ? t('biz.cart.noB2b') : t('biz.cart.gone')}
          </p>
        ) : (
          <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
            <div className="inline-flex items-center rounded-xl border border-border bg-surface-cream overflow-hidden">
              <button type="button" onClick={() => (l.quantity <= 1 ? onRemove() : onQty(l.quantity - 1))} aria-label={t('biz.cat.less')} className="w-9 h-9 flex items-center justify-center text-charcoal hover:bg-brand-whisper transition-colors">
                <Minus size={15} strokeWidth={2.5} />
              </button>
              <QuantityField value={l.quantity} max={max} onChange={onQty} onCapped={onCapped} label={t('biz.cart.qty')} className="w-12 h-9 bg-transparent text-center text-[15px] font-bold font-display text-ink tabular-nums" />
              <button type="button" onClick={() => onQty(Math.min(max, l.quantity + 1))} disabled={l.quantity >= max} aria-label={t('biz.cat.more')} className="w-9 h-9 flex items-center justify-center text-charcoal hover:bg-brand-whisper transition-colors disabled:opacity-40">
                <Plus size={15} strokeWidth={2.5} />
              </button>
            </div>
            <div className="text-right">
              <p className="text-[16px] font-bold font-display text-ink tabular-nums leading-none">{money(pay * l.quantity)}</p>
              <p className="text-[11.5px] text-muted tabular-nums mt-1">{money(pay)} {t('biz.cart.each')}</p>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
