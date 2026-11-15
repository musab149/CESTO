import { useEffect } from 'react';
import {
  Eye, Globe, Maximize2, Minimize2, X, ArrowRight,
  Store as StoreIcon, CheckCircle2, Heart, Share2, Star, Clock, Zap,
  Package, ChevronRight, Search, Grid, List, Home,
} from 'lucide-react';
import {
  resolveImageUrl,
  formatHoursStatus,
  isOpenNow,
  WEEKDAY_KEYS,
  weekdayLabel,
  type ShopHours,
} from '@grocery-app/shared';

type Lang = 'en' | 'es';

/** Snapshot of the store form draft used to render the preview. */
export interface StorePreviewDraft {
  name: string;
  slug: string;
  tagline_es: string;
  tagline_en: string;
  description_es: string;
  description_en: string;
  logo_url: string | null;
  logo_bg: string;
  cover_url: string | null;
  rating: string;
  rating_count: string;
  is_verified: boolean;
  fast_delivery: boolean;
  shop_hours: ShopHours;
}

function deliveryLabel(fast: boolean): string {
  return fast ? '30–45 min' : '45–60 min';
}

function formatShopCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K+`;
  }
  return `${n}+`;
}

// ─── Browser-window frame ────────────────────────────────────────────────
// A subtle chrome around each preview so the admin sees "this is what the
// customer app looks like at URL X" rather than a floating widget.

function BrowserFrame({
  url,
  children,
}: { url: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
      <div className="h-9 bg-surface-cream border-b border-border flex items-center gap-2 px-3">
        {/* macOS-style traffic lights just for the "this is a page" cue */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-danger/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-success/70" />
        </div>
        <div className="flex-1 min-w-0 mx-3">
          <div className="h-6 rounded-md bg-card border border-border/70 flex items-center px-3 text-[11px] font-mono text-muted truncate">
            {url}
          </div>
        </div>
        <div className="text-[10px] font-display font-semibold uppercase tracking-wide text-muted">
          Cesto
        </div>
      </div>
      {children}
    </div>
  );
}

// ─── Card in context (Top Shops rail as it appears on the home page) ─────

function StoreCardMini({ draft, lang }: { draft: StorePreviewDraft; lang: Lang }) {
  const logoSrc = draft.logo_url ? resolveImageUrl(draft.logo_url, 'logo') : null;
  const coverSrc = draft.cover_url ? resolveImageUrl(draft.cover_url, 'tile') : null;
  const delivery = deliveryLabel(draft.fast_delivery);
  const rating = draft.rating ? parseFloat(draft.rating) : NaN;
  const ratingCount = parseInt(draft.rating_count || '0', 10) || 0;
  const reviewsLabel = lang === 'en' ? 'reviews' : 'reseñas';
  const tags = lang === 'en'
    ? ['Grocery', 'Fresh Food', 'Daily Essentials']
    : ['Comestibles', 'Comida fresca', 'Básicos'];
  const initials = (draft.name || 'ST')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative rounded-[18px] border-2 border-brand bg-card overflow-hidden ring-4 ring-brand/15">
      <div
        className="relative h-[100px]"
        style={{
          background: coverSrc
            ? undefined
            : `linear-gradient(135deg, ${draft.logo_bg || '#FFFFFF'} 0%, #F5F0E8 100%)`,
        }}
      >
        {coverSrc && (
          <img src={coverSrc} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
        )}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 70%)' }}
        />
        <div className="absolute top-2 right-2 inline-flex items-center gap-1.5 bg-white/95 backdrop-blur-sm rounded-full px-2.5 py-1 shadow-[0_1px_3px_rgba(15,23,42,0.18)]">
          <Clock size={12} strokeWidth={2.25} className="text-amber-deep" />
          <span className="text-[11.5px] font-bold text-amber-deep tracking-tight tabular-nums">{delivery}</span>
        </div>
      </div>
      <div
        className="absolute left-4 w-16 h-16 rounded-full border-[3px] border-card overflow-hidden flex items-center justify-center shadow-[0_2px_4px_rgba(15,23,42,0.12)] top-[68px]"
        style={{ background: draft.logo_bg || '#FFFFFF' }}
      >
        {logoSrc ? (
          <img src={logoSrc} alt={draft.name} className="w-full h-full object-cover" draggable={false} />
        ) : (
          <span className="text-[16px] font-extrabold text-brand tracking-wider">{initials}</span>
        )}
      </div>
      <div className="px-4 pt-10 pb-3.5">
        <h3 className="text-[17px] font-bold text-ink tracking-tight truncate flex items-center gap-1">
          <span className="truncate">{draft.name || (lang === 'en' ? 'Store name' : 'Nombre de la tienda')}</span>
          {draft.is_verified && (
            <CheckCircle2 size={13} strokeWidth={2.25} className="text-brand shrink-0" />
          )}
        </h3>
        <div className="mt-2 flex items-center gap-1.5">
          <Star size={14} strokeWidth={2} className="text-amber-deep fill-amber-deep" />
          <span className="text-[13px] font-bold text-ink tabular-nums">
            {Number.isFinite(rating) ? rating.toFixed(1) : '—'}
          </span>
          <span className="text-[12px] text-muted truncate">
            ({formatShopCount(ratingCount)} {reviewsLabel})
          </span>
        </div>
        <div className="flex flex-wrap mt-3 gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className="rounded-full border border-border bg-surface-linen px-2.5 py-1 text-[11px] font-semibold text-gray">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Ghost card used to fill the Top Shops rail so the admin sees the real card
 *  in a peer context instead of floating alone. */
function GhostStoreCard() {
  return (
    <div className="relative rounded-[18px] border border-border/60 bg-card overflow-hidden opacity-60">
      <div className="h-[100px] bg-gradient-to-br from-surface-cream to-surface-linen" />
      <div className="absolute left-4 w-16 h-16 rounded-full border-[3px] border-card bg-surface-cream top-[68px]" />
      <div className="px-4 pt-10 pb-3.5 space-y-2">
        <div className="h-4 bg-surface-cream rounded w-3/4" />
        <div className="h-3 bg-surface-cream rounded w-1/2" />
        <div className="flex gap-1.5 mt-3">
          <div className="h-5 w-14 bg-surface-cream rounded-full" />
          <div className="h-5 w-16 bg-surface-cream rounded-full" />
        </div>
      </div>
    </div>
  );
}

function CardInRail({ draft, lang }: { draft: StorePreviewDraft; lang: Lang }) {
  return (
    <BrowserFrame url="cesto.es">
      <div className="bg-surface-linen p-6">
        {/* SectionHeader mirroring the home page */}
        <div className="flex items-end justify-between gap-3 mb-5">
          <div>
            <h2 className="font-display text-[22px] md:text-[26px] text-ink tracking-tight" style={{ fontWeight: 600 }}>
              {lang === 'en' ? 'Top Shops' : 'Tiendas destacadas'}
            </h2>
            <p className="text-[13px] text-gray mt-1">
              {lang === 'en' ? 'The partner shops shoppers see first' : 'Las tiendas que los clientes ven primero'}
            </p>
          </div>
          <div className="shrink-0 inline-flex items-center gap-2 h-10 px-4 rounded-full border border-border bg-card text-[13px] font-bold text-ink">
            {lang === 'en' ? 'See more' : 'Ver más'}
            <ArrowRight size={14} strokeWidth={2.5} />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          <StoreCardMini draft={draft} lang={lang} />
          <GhostStoreCard />
          <GhostStoreCard />
          <GhostStoreCard />
        </div>
        <p className="mt-4 text-[11px] text-muted italic">
          {lang === 'en'
            ? 'The highlighted card is your store — the rest fill in from real stores.'
            : 'La tarjeta resaltada es tu tienda — el resto se rellena con tiendas reales.'}
        </p>
      </div>
    </BrowserFrame>
  );
}

// ─── Storefront-in-context (customer /stores/:slug page) ────────────────

function ProductPlaceholder({ i, lang }: { i: number; lang: Lang }) {
  // Cycle through subtle tinted surfaces so the placeholder row reads as
  // real products at a glance without needing real image fixtures.
  const bgs = ['bg-brand-mist/40', 'bg-amber-mist/60', 'bg-surface-cream', 'bg-brand-mist/60'];
  const names = lang === 'en'
    ? ['Basmati Rice', 'Chai Blend', 'Turmeric', 'Ghee']
    : ['Arroz Basmati', 'Té Masala', 'Cúrcuma', 'Ghee'];
  const prices = ['3.95', '2.49', '1.95', '5.75'];
  return (
    <div className="bg-card border border-border/70 rounded-2xl p-2.5 flex flex-col">
      <div className={`aspect-square rounded-xl ${bgs[i % 4]} flex items-center justify-center relative`}>
        <Package size={28} strokeWidth={1.5} className="text-ink/25" />
        {i === 0 && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-warning text-white px-2 py-0.5 text-[10px] font-bold font-display uppercase tracking-wide">
            Top
          </span>
        )}
      </div>
      <div className="mt-2 text-sm font-bold text-ink font-display">
        €{prices[i % 4]}
      </div>
      <div className="text-[12px] font-semibold text-ink font-ui truncate mt-0.5">
        {names[i % 4]}
      </div>
      <div className="text-[10.5px] text-muted mt-0.5 truncate">
        {lang === 'en' ? 'Sold by' : 'Vendido por'}{' '}
        <span className="text-ink/70 font-semibold">
          {i === 0 ? 'this store' : 'Cesto Shop'}
        </span>
      </div>
    </div>
  );
}

function StorefrontInContext({ draft, lang }: { draft: StorePreviewDraft; lang: Lang }) {
  const description = lang === 'en' ? draft.description_en : draft.description_es;
  const tagline = lang === 'en' ? draft.tagline_en : draft.tagline_es;
  const coverSrc = draft.cover_url ? resolveImageUrl(draft.cover_url, 'tile') : null;
  const logoSrc = draft.logo_url ? resolveImageUrl(draft.logo_url, 'logo') : null;
  const delivery = deliveryLabel(draft.fast_delivery);
  const rating = draft.rating ? parseFloat(draft.rating) : NaN;
  const ratingCount = parseInt(draft.rating_count || '0', 10) || 0;
  const openNow = isOpenNow(draft.shop_hours);
  const hoursStatus = formatHoursStatus(draft.shop_hours, lang);

  const tabs = lang === 'en'
    ? ['All Products', 'Best Sellers', 'New Arrivals', 'Featured']
    : ['Todos los productos', 'Más vendidos', 'Novedades', 'Destacados'];

  const url = `cesto.es/stores/${draft.slug || (draft.name ? draft.name.toLowerCase().replace(/\s+/g, '-').slice(0, 30) : 'new-store')}`;

  return (
    <BrowserFrame url={url}>
      {/* Fake customer nav so the preview reads as the real customer surface */}
      <div className="bg-brand text-white h-11 flex items-center px-4 gap-3">
        <span className="text-sm font-display font-bold">Cesto</span>
        <div className="flex-1 max-w-md hidden sm:flex items-center bg-white/20 rounded-full h-7 px-3">
          <Search size={12} strokeWidth={2.25} className="text-white/70" />
          <span className="text-[11px] font-body text-white/70 ml-2">
            {lang === 'en' ? 'Search Cesto' : 'Buscar en Cesto'}
          </span>
        </div>
        <div className="ml-auto text-[11px] font-display font-semibold uppercase tracking-wide">
          {lang.toUpperCase()}
        </div>
      </div>

      <div className="bg-surface-linen p-4 lg:p-6">
        {/* Breadcrumb — matches /stores/:slug */}
        <nav className="text-xs text-muted mb-3 flex items-center gap-1.5">
          <Home size={11} strokeWidth={2} />
          <span>{lang === 'en' ? 'Home' : 'Inicio'}</span>
          <ChevronRight size={12} />
          <span>{lang === 'en' ? 'Stores' : 'Tiendas'}</span>
          <ChevronRight size={12} />
          <span className="text-ink font-semibold truncate">
            {draft.name || (lang === 'en' ? 'Store name' : 'Nombre de la tienda')}
          </span>
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
          {/* Sidebar — logo card + hours */}
          <aside className="space-y-4">
            <section className="bg-surface-cream border border-border rounded-lg p-5 shadow-card flex flex-col items-center text-center">
              <div
                className="w-24 h-24 rounded-2xl border border-border overflow-hidden flex items-center justify-center mb-3"
                style={{ backgroundColor: draft.logo_bg }}
              >
                {logoSrc ? (
                  <img src={logoSrc} alt={draft.name} className="w-full h-full object-contain p-2" />
                ) : (
                  <StoreIcon size={36} strokeWidth={1.5} className="text-muted" />
                )}
              </div>
              <h1 className="font-display font-bold text-ink text-lg leading-tight flex items-center gap-1.5">
                {draft.name || (lang === 'en' ? 'Store name' : 'Nombre de la tienda')}
                {draft.is_verified && <CheckCircle2 size={16} strokeWidth={2} className="text-brand shrink-0" />}
              </h1>
              {tagline && <div className="text-xs text-muted mt-1">{tagline}</div>}
              <div className="mt-4 w-full h-10 rounded-xl font-display font-semibold text-sm inline-flex items-center justify-center gap-2 bg-brand text-white">
                <Heart size={14} strokeWidth={2} />
                {lang === 'en' ? 'Follow' : 'Seguir'}
              </div>
              <div className="grid grid-cols-3 gap-1 w-full mt-4 text-center divide-x divide-border">
                <div className="px-1">
                  <div className="font-display font-bold text-ink text-sm">0</div>
                  <div className="text-[9px] text-muted uppercase tracking-wide mt-0.5">
                    {lang === 'en' ? 'Follow.' : 'Segui.'}
                  </div>
                </div>
                <div className="px-1">
                  <div className="font-display font-bold text-ink text-sm">—</div>
                  <div className="text-[9px] text-muted uppercase tracking-wide mt-0.5">
                    {lang === 'en' ? 'Prods.' : 'Prods.'}
                  </div>
                </div>
                <div className="px-1">
                  <div className="inline-flex items-center gap-0.5 font-display font-bold text-ink text-sm">
                    <Star size={11} strokeWidth={2} className="text-warning fill-warning" />
                    {Number.isFinite(rating) ? rating.toFixed(1) : '—'}
                  </div>
                  <div className="text-[9px] text-muted uppercase tracking-wide mt-0.5">
                    {ratingCount > 0 ? formatShopCount(ratingCount) : (lang === 'en' ? 'Rating' : 'Nota')}
                  </div>
                </div>
              </div>
              <div className="mt-3 w-full h-9 rounded-xl border border-border bg-card font-display font-semibold text-[11px] text-ink inline-flex items-center justify-center gap-2">
                <Share2 size={12} strokeWidth={2} />
                {lang === 'en' ? 'Share store' : 'Compartir tienda'}
              </div>
            </section>

            <section className="bg-surface-cream border border-border rounded-lg p-4 shadow-card">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-display font-semibold text-ink text-sm inline-flex items-center gap-1.5">
                  <Clock size={13} strokeWidth={2} />
                  {lang === 'en' ? 'Hours' : 'Horario'}
                </h2>
                <span
                  className={`text-[10px] font-display font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                    openNow ? 'bg-brand/15 text-brand-dark' : 'bg-gray-200 text-gray-700'
                  }`}
                >
                  {openNow ? (lang === 'en' ? 'Open' : 'Abierto') : (lang === 'en' ? 'Closed' : 'Cerrado')}
                </span>
              </div>
              <p className="text-xs text-ink">{hoursStatus}</p>
              <ul className="mt-3 space-y-1 text-xs">
                {WEEKDAY_KEYS.map((k) => {
                  const day = draft.shop_hours?.[k];
                  return (
                    <li key={k} className="flex items-center justify-between">
                      <span className="text-muted">{weekdayLabel(k, lang)}</span>
                      <span className="text-ink font-semibold">
                        {!day || day.closed ? (lang === 'en' ? 'Closed' : 'Cerrado') : `${day.open} – ${day.close}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </aside>

          {/* Main — cover + tabs + toolbar + products */}
          <div>
            <div
              className="relative h-40 lg:h-48 rounded-lg overflow-hidden border border-border shadow-card mb-5"
              style={{
                background: coverSrc
                  ? undefined
                  : `linear-gradient(135deg, ${draft.logo_bg || '#FFFFFF'} 0%, #F5F0E8 100%)`,
              }}
            >
              {coverSrc ? (
                <img src={coverSrc} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
                  <span className="font-display font-black text-ink/[0.06] uppercase tracking-tight text-6xl lg:text-8xl truncate max-w-full px-6">
                    {draft.name || 'STORE'}
                  </span>
                </div>
              )}
              <div
                className={`absolute inset-0 ${
                  coverSrc
                    ? 'bg-gradient-to-t from-black/55 via-black/15 to-transparent'
                    : 'bg-gradient-to-t from-ink/70 via-ink/20 to-transparent'
                }`}
              />
              {description && (
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <p className="text-white text-sm font-body max-w-2xl line-clamp-3 drop-shadow-sm">
                    {description}
                  </p>
                </div>
              )}
              <span className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur px-2.5 py-1 text-xs font-display font-bold text-amber-deep shadow-sm">
                <Clock size={12} strokeWidth={2.25} />
                <span className="tabular-nums tracking-tight">{delivery}</span>
              </span>
              {draft.fast_delivery && (
                <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-white/95 backdrop-blur px-2.5 py-1 text-xs font-display font-semibold text-ink shadow-sm">
                  <Zap size={12} strokeWidth={2.25} className="text-warning" />
                  {lang === 'en' ? 'Fast delivery' : 'Entrega rápida'}
                </span>
              )}
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto mb-4 border-b border-border">
              {tabs.map((label, i) => (
                <div
                  key={label}
                  className={`shrink-0 h-10 px-3 -mb-px border-b-2 font-display font-semibold text-sm ${
                    i === 0 ? 'border-brand text-brand' : 'border-transparent text-muted'
                  }`}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Toolbar — search + sort + view toggle */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <div className="relative flex-1 min-w-[180px] h-10 bg-surface-cream border border-border rounded-lg flex items-center pl-3 gap-2">
                <Search size={13} strokeWidth={2} className="text-muted" />
                <span className="text-xs text-muted">
                  {lang === 'en' ? 'Search this store…' : 'Buscar en esta tienda…'}
                </span>
              </div>
              <div className="h-10 px-3 bg-surface-cream border border-border rounded-lg inline-flex items-center gap-1 text-xs font-display text-ink">
                {lang === 'en' ? 'Sort: Popular' : 'Orden: Popular'}
              </div>
              <div className="inline-flex rounded-lg border border-border overflow-hidden bg-surface-cream">
                <div className="h-10 w-10 inline-flex items-center justify-center bg-brand text-white">
                  <Grid size={13} strokeWidth={2} />
                </div>
                <div className="h-10 w-10 inline-flex items-center justify-center text-muted">
                  <List size={13} strokeWidth={2} />
                </div>
              </div>
            </div>

            {/* Product grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <ProductPlaceholder key={i} i={i} lang={lang} />
              ))}
            </div>
            <p className="mt-4 text-[11px] text-muted italic">
              {lang === 'en'
                ? 'Products preview is illustrative — assign real products from the Products tab.'
                : 'La vista previa es ilustrativa — asigna productos reales desde la pestaña Productos.'}
            </p>
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

// ─── Overlay + chip (full-screen preview) ────────────────────────────────

export type PreviewState = 'closed' | 'open' | 'minimized';

interface OverlayProps {
  state: PreviewState;
  lang: Lang;
  onLangChange: (l: Lang) => void;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  draft: StorePreviewDraft;
}

/**
 * Full-screen storefront preview overlay for the admin store form. Mirrors
 * the design of HomeSectionsPage's PreviewOverlay so admins get the same
 * three-state (open/minimize/close) affordance across editors.
 */
export default function StorePreviewOverlay({
  state, lang, onLangChange, onClose, onMinimize, onRestore, draft,
}: OverlayProps) {
  // Close on Escape while open.
  useEffect(() => {
    if (state !== 'open') return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state, onClose]);

  // Body-scroll lock while open.
  useEffect(() => {
    if (state !== 'open') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [state]);

  if (state === 'minimized') {
    return (
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-1 bg-night rounded-full pl-4 pr-1.5 py-1.5 shadow-modal">
        <button
          type="button"
          onClick={onRestore}
          className="text-white text-xs font-semibold font-display flex items-center gap-2 pr-2"
        >
          <Eye size={13} strokeWidth={2} /> {lang === 'en' ? 'Store preview' : 'Vista previa'}
          <Maximize2 size={12} strokeWidth={2} className="text-white/70" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center"
          title="Dismiss"
        >
          <X size={12} strokeWidth={2.25} className="text-white" />
        </button>
      </div>
    );
  }

  if (state !== 'open') return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-veil/45 backdrop-blur-sm">
      {/* Header bar */}
      <div className="h-14 bg-card border-b border-border px-4 lg:px-6 flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-brand-mist/60 flex items-center justify-center shrink-0">
            <Eye size={14} strokeWidth={2.25} className="text-brand" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold font-display text-ink truncate leading-none">
              {draft.name || (lang === 'en' ? 'New store' : 'Nueva tienda')}
            </h3>
            <p className="text-[11px] text-muted font-display mt-0.5">
              {lang === 'en' ? 'Customer storefront preview' : 'Vista previa de la tienda'}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {(['en', 'es'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onLangChange(l)}
                className={`px-2.5 py-1.5 text-[11px] font-semibold font-display flex items-center gap-1 ${
                  lang === l ? 'bg-ink text-card' : 'bg-card text-gray hover:bg-surface-linen'
                }`}
              >
                <Globe size={11} strokeWidth={2.25} /> {l.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onMinimize}
            className="h-9 px-3 rounded-lg text-xs font-semibold font-display text-gray border border-border hover:bg-surface-linen transition-colors flex items-center gap-1.5"
            title="Minimize (Esc closes)"
          >
            <Minimize2 size={13} strokeWidth={2} /> {lang === 'en' ? 'Minimize' : 'Minimizar'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3 rounded-lg text-xs font-semibold font-display text-card bg-ink hover:bg-charcoal transition-colors flex items-center gap-1.5"
            title="Close (Esc)"
          >
            <X size={13} strokeWidth={2} /> {lang === 'en' ? 'Close' : 'Cerrar'}
          </button>
        </div>
      </div>

      {/* Body — soft grey backdrop, two device-framed previews stacked */}
      <div className="flex-1 overflow-y-auto bg-gradient-to-b from-surface-cream to-surface-linen">
        <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-8 space-y-8">
          {/* Section 1 — card in the Top Shops rail */}
          <section>
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand text-white px-3 py-1 text-[11px] font-bold font-display uppercase tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
                {lang === 'en' ? '1 · On the home page' : '1 · En la página de inicio'}
              </span>
              <span className="text-xs text-muted">
                {lang === 'en'
                  ? 'How your store card slots into the Top Shops rail'
                  : 'Cómo se ve tu tarjeta en la sección Tiendas destacadas'}
              </span>
            </div>
            <CardInRail draft={draft} lang={lang} />
          </section>

          {/* Section 2 — storefront in context */}
          <section>
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand text-white px-3 py-1 text-[11px] font-bold font-display uppercase tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
                {lang === 'en' ? '2 · The storefront page' : '2 · La página de la tienda'}
              </span>
              <span className="text-xs text-muted">
                {lang === 'en'
                  ? 'What shoppers see when they open your store'
                  : 'Lo que ven los clientes al abrir tu tienda'}
              </span>
            </div>
            <StorefrontInContext draft={draft} lang={lang} />
          </section>
        </div>
      </div>
    </div>
  );
}
