import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, FileText, MapPin, SearchX, ShoppingCart, Store, Tag } from 'lucide-react';
import { useBusinessProduct, type BusinessSize } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useCartStore } from '@/stores/cartStore';
import { money } from '@/sales/lib/format';
import BackLink from '@/sales/components/BackLink';
import { Card } from '@/sales/components/ui';
import EmptyState from '@/sales/components/EmptyState';
import { Skeleton } from '@/sales/components/Skeleton';
import { nameOf } from '@/sales/components/catalogue/data';
import QuotationRequestModal from '@/components/QuotationRequestModal';
import { useBizT } from './lib/i18n';
import { QtyStepper, StockTag } from './components/catalogue';
import { pricesOf, stockOf } from './lib/sizes';
import Photo from './components/Photo';

/**
 * One product, all of it (2026-10-29): its pictures, where it comes from, and
 * every size a business can buy — each with what they pay (never a retail
 * price), its stock, and the add button that becomes its quantity. The rep
 * catalogue's sheet (sales ProductSheet) as a page of its own, so a link to a
 * product — a notification, a shared product page (routeAccess
 * businessPathFor) — lands on it.
 *
 * Bulk beyond the stock is a conversation, not a cart line: where the office
 * enabled it, "Pedir presupuesto" is the shop's quotation request.
 */
export default function BusinessProductPage() {
  const t = useBizT();
  const lang = useLanguageStore((s) => s.lang) as 'es' | 'en';
  const navigate = useNavigate();
  const location = useLocation();
  const { productId } = useParams();
  const { data: p, isLoading, error } = useBusinessProduct(productId);
  const [pic, setPic] = useState(0);
  const [moreText, setMoreText] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const cartLines = useCartStore((s) => s.items.length);

  const back = () => {
    if ((location.state as { fromList?: boolean } | null)?.fromList) { navigate(-1); return; }
    navigate('/business/catalogue');
  };

  if (isLoading) {
    return (
      <div>
        <BackLink label={t('biz.cat.title')} onClick={back} />
        <div className="grid lg:grid-cols-2 gap-4">
          <Skeleton className="aspect-square rounded-2xl" />
          <div className="space-y-3"><Skeleton className="h-8 w-3/4" /><Skeleton className="h-5 w-1/2" /><Skeleton className="h-24 w-full" /></div>
        </div>
      </div>
    );
  }
  if (!p || error) {
    return (
      <div>
        <BackLink label={t('biz.cat.title')} onClick={back} />
        <Card>
          <EmptyState
            icon={<SearchX size={28} strokeWidth={1.75} className="text-muted" />}
            title={t('biz.product.goneTitle')}
            description={t('biz.product.goneBody')}
            action={{ label: t('biz.product.toCatalogue'), onClick: () => navigate('/business/catalogue') }}
          />
        </Card>
      </div>
    );
  }

  const name = nameOf(p, lang);
  const images = p.images ?? [];
  const shown = images[Math.min(pic, Math.max(0, images.length - 1))]?.url;
  const description = (lang === 'en' && p.description_en) || p.description_es || '';
  const facts: Array<{ icon: React.ElementType; label: string; onClick?: () => void }> = [
    ...(p.store ? [{ icon: Store, label: p.store.name, onClick: () => navigate(`/business/catalogue/stores/${p.store!.id}`) }] : [{ icon: Store, label: t('biz.house'), onClick: () => navigate('/business/catalogue/stores/cesto') }]),
    ...(p.brand_ref ? [{ icon: Tag, label: p.brand_ref.name, onClick: () => navigate(`/business/catalogue/brands/${p.brand_ref!.id}`) }] : p.brand ? [{ icon: Tag, label: p.brand }] : []),
    ...(p.origin_ref ? [{ icon: MapPin, label: (lang === 'en' && p.origin_ref.label_en) || p.origin_ref.label_es, onClick: () => navigate(`/business/catalogue/origins/${p.origin_ref!.id}`) }] : []),
  ];

  return (
    <div className="pb-24 lg:pb-0">
      <BackLink label={t('biz.cat.title')} title={name} onClick={back} />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-3 md:gap-4 2xl:gap-5 items-start">
        {/* ── Pictures ── */}
        <Card className="overflow-hidden lg:sticky lg:top-16">
          <div className={`sales-photo relative bg-surface-cream flex items-center justify-center ${shown ? 'aspect-square' : 'aspect-[16/9] lg:aspect-square'}`}>
            <Photo url={shown} alt={name} icon={44} className="absolute inset-0 w-full h-full object-contain p-4" />
          </div>
          {images.length > 1 && (
            <div className="px-3 py-3 border-t border-border flex gap-2 overflow-x-auto hide-scrollbar">
              {images.map((im, i) => (
                <button
                  key={im.url + i}
                  type="button"
                  onClick={() => setPic(i)}
                  aria-label={t('biz.product.picture', { n: i + 1 })}
                  aria-pressed={i === pic}
                  className={`sales-photo w-16 h-16 rounded-xl overflow-hidden shrink-0 bg-surface-cream ring-2 ring-inset transition flex items-center justify-center ${i === pic ? 'ring-brand' : 'ring-transparent hover:ring-border'}`}
                >
                  <Photo url={im.url} preset="thumb" icon={18} className="w-full h-full object-contain p-1" />
                </button>
              ))}
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-3 md:gap-4 min-w-0">
          {/* ── What it is ── */}
          <Card className="p-4 sm:p-5">
            <h1 className="text-[24px] lg:text-[28px] font-bold font-display text-ink leading-tight tracking-[-0.02em] break-words">{name}</h1>
            {p.category && (
              <p className="mt-1 text-[13.5px] text-gray">{nameOf(p.category, lang)}</p>
            )}
            {facts.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {facts.map((f) => {
                  const Icon = f.icon;
                  const cls = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-surface-cream border border-border text-[13px] font-semibold font-display text-charcoal';
                  return f.onClick ? (
                    <button key={f.label} type="button" onClick={f.onClick} className={`${cls} hover:border-brand/40 hover:text-brand transition-colors`}>
                      <Icon size={14} strokeWidth={1.75} />{f.label}
                    </button>
                  ) : (
                    <span key={f.label} className={cls}><Icon size={14} strokeWidth={1.75} />{f.label}</span>
                  );
                })}
              </div>
            )}
          </Card>

          {/* ── The sizes a business can buy ── */}
          <Card className="overflow-hidden">
            <div className="px-4 sm:px-5 pt-4 pb-2">
              <h2 className="text-[16px] font-bold font-display text-ink">{t('biz.product.sizes')}</h2>
              <p className="text-[12.5px] text-muted mt-0.5">{t('biz.product.sizesHint')}</p>
            </div>
            <ul className="divide-y divide-border">
              {p.variants.map((v) => <SizeRow key={v.id} productId={p.id} v={v} lang={lang} />)}
            </ul>
            {cartLines > 0 && (
              <div className="px-4 sm:px-5 py-3 border-t border-border bg-surface-cream/60">
                <button
                  type="button"
                  onClick={() => navigate('/business/cart')}
                  className="w-full h-11 rounded-xl border border-brand/30 bg-card text-brand text-[14px] font-semibold font-display inline-flex items-center justify-center gap-2 hover:bg-brand-whisper transition-colors"
                >
                  <ShoppingCart size={17} strokeWidth={1.9} />
                  {t('biz.product.toCart', { count: cartLines })}
                </button>
              </div>
            )}
          </Card>

          {/* ── A bigger amount than the cart can take ── */}
          {p.is_quotation_enabled && (
            <Card className="p-4 sm:p-5 flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl bg-brand-whisper text-brand flex items-center justify-center shrink-0"><FileText size={19} strokeWidth={1.75} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-semibold font-display text-ink">{t('biz.product.quoteTitle')}</p>
                <p className="text-[13px] text-gray mt-0.5">{t('biz.product.quoteBody')}</p>
                <button
                  type="button"
                  onClick={() => setQuoteOpen(true)}
                  className="mt-3 h-10 px-4 rounded-xl bg-card border border-border text-[13.5px] font-semibold font-display text-ink hover:border-brand/40 hover:text-brand transition-colors"
                >
                  {t('biz.product.quoteCta')}
                </button>
              </div>
            </Card>
          )}

          {/* ── What it is, in words ── */}
          {description && (
            <Card className="p-4 sm:p-5">
              <h2 className="text-[16px] font-bold font-display text-ink">{t('biz.product.description')}</h2>
              <p className={`mt-2 text-[14px] text-charcoal leading-relaxed whitespace-pre-line ${moreText ? '' : 'line-clamp-5'}`}>{description}</p>
              {description.length > 320 && (
                <button type="button" onClick={() => setMoreText((m) => !m)} className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold font-display text-brand">
                  {moreText ? t('biz.product.less') : t('biz.product.more')}
                  {moreText ? <ChevronUp size={15} strokeWidth={2} /> : <ChevronDown size={15} strokeWidth={2} />}
                </button>
              )}
            </Card>
          )}
        </div>
      </div>

      {quoteOpen && (
        <QuotationRequestModal open={quoteOpen} onClose={() => setQuoteOpen(false)} product={{ id: p.id, name }} initialQuantity={1} />
      )}
    </div>
  );
}

/** A size: its name and stock, what they pay, and its quantity. */
function SizeRow({ productId, v, lang }: { productId: string; v: BusinessSize; lang: 'es' | 'en' }) {
  const t = useBizT();
  const { pay, agreed } = pricesOf(v);
  const out = stockOf(v) === 'out';
  return (
    <li className="px-4 sm:px-5 py-3.5 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-semibold font-display text-ink truncate">{nameOf(v, lang)}</p>
        <p className="mt-1 flex items-center gap-x-2 gap-y-1 flex-wrap">
          <span className="text-[17px] font-bold font-display text-brand tabular-nums leading-none">{money(pay)}</span>
          {agreed && <span className="inline-flex h-5 items-center px-1.5 rounded-md bg-success-bg text-success text-[10.5px] font-bold font-display">{t('biz.cat.agreed')}</span>}
        </p>
        <span className="mt-1.5 inline-block"><StockTag v={v} /></span>
        {v.sku && <p className="mt-1 text-[11.5px] text-muted font-mono">{v.sku}</p>}
      </div>
      <div className="shrink-0">
        {out
          ? <span className="text-[12.5px] font-semibold font-display text-muted">{t('biz.cat.outOfStock')}</span>
          : <QtyStepper productId={productId} size={v} />}
      </div>
    </li>
  );
}
