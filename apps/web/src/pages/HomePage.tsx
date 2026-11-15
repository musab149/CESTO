import { useNavigate } from 'react-router-dom';
import { EMAIL_INPUT_PROPS, lowercaseEmail } from '@/lib/emailField';
import {
  ArrowRight, ChevronLeft, ChevronRight, Star,
  Sparkles, Truck, ShieldCheck, Tag, Megaphone, Flame, LayoutGrid, Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  useBanners, useCategories, useSponsoredProducts, useProducts, resolveImageUrl,
  usePromoGrid, useAdsBanner, useStores, useInfiniteProducts,
  useOriginCounts, useOriginsList, useBrandsList,
  defaultPromoGrid, defaultAdsBanner,
  OriginCardArt,
  useSubmitSupportTicket,
} from '@grocery-app/shared';
import type {
  Banner, Category, Product,
  PromoTile, AdsBannerSection, TopBrand,
  OriginCard as OriginCardType,
  Origin as OriginType,
} from '@grocery-app/shared';
import { Skeleton, ProductCardSkeleton } from '@/components/Skeleton';
import ProductCard from '@/components/ProductCard';
import InfiniteScroll from '@/components/InfiniteScroll';
import StoreCard from '@/components/StoreCard';
import { useToast } from '@/components/Toast';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLanguageStore } from '@/stores/languageStore';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';
import { logoPlate, paintedTile } from '@/lib/logoPlate';

/* ───────────────────────────────────────────────────────
   Hero — Walmart-style carousel
   ─────────────────────────────────────────────────────── */
interface Slide {
  /** Alt text for the artwork, not a rendered heading — see HeroCarousel. */
  title: string;
  cta: string;
  link: string; bg: string;
  /** Admin uploads one image per viewport; the carousel picks per breakpoint. */
  image: string | null;
  imageMobile?: string | null;
  theme?: 'light' | 'dark';
}


function HeroCarousel({ banners }: { banners: Banner[] }) {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const [current, setCurrent] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  /**
   * No banners configured -> render nothing (see below).
   *
   * There used to be three hard-coded fallback slides here carrying marketing
   * copy. The banner is now artwork plus a CTA, and the fallbacks had no
   * artwork — so they degraded to a bare cream box with a lone button, which
   * says less than an empty space does. Only the background colour they
   * supplied is still needed, for a real banner saved without one.
   */
  const DEFAULT_BG = 'var(--color-surface-cream)';

  function bannerLinkPath(b: Banner): string {
    if (!b.link_type || !b.link_target) return '/categories';
    const t = b.link_type.toLowerCase();
    if (t === 'category') return `/categories/${b.link_target}`;
    if (t === 'product') return `/products/${b.link_target}`;
    if (t === 'url') return b.link_target;
    return '/categories';
  }

  const pickLang = (en: string | null | undefined, es: string | null | undefined) =>
    lang === 'en' ? (en?.trim() || es?.trim() || '') : (es?.trim() || en?.trim() || '');

  const slides: Slide[] = banners.map((b) => ({
    // Kept only as the image's alt text — no longer rendered as a heading.
    title: pickLang(b.title_en, b.title_es),
    cta: pickLang(b.cta_en, b.cta_es) || (lang === 'en' ? 'Shop now' : 'Comprar ahora'),
    link: bannerLinkPath(b),
    // Admin uploads both; the carousel was rendering image_desktop at every
    // width and throwing the mobile upload away.
    image: resolveImageUrl(b.image_desktop, 'banner'),
    // `banner`, not `hero`. The mobile art is drawn edge to edge, and `hero`
    // resolves to the 800 px variant — on a 3× phone that is upscaled half
    // again before it is painted. `banner` serves the master.
    imageMobile: b.image_mobile?.trim() ? resolveImageUrl(b.image_mobile, 'banner') : null,
    bg: b.background?.trim() || DEFAULT_BG,
    theme: b.text_theme ?? 'dark',
  }));

  const startTimer = useCallback(() => {
    clearInterval(timerRef.current);
    // 7s was a long wait to see a second banner, and with the arrows gone
    // there is no way to skip ahead — the interval is the only thing moving
    // the carousel now.
    timerRef.current = setInterval(() => setCurrent((c) => (c + 1) % slides.length), 4000);
  }, [slides.length]);

  useEffect(() => { startTimer(); return () => clearInterval(timerRef.current); }, [startTimer]);

  // Nothing configured, nothing to show. Placed after every hook so the hook
  // order stays stable between renders, and before `slides[current]` below,
  // which would be undefined on an empty list.
  if (slides.length === 0) return null;

  // goTo restarts the timer, so tapping a dot gives you the full interval on
  // the slide you chose rather than whatever was left of the previous one.
  const goTo = (i: number) => { setCurrent(i); startTimer(); };
  const slide = slides[current];

  function go(link: string) {
    // Banner link URLs come from the API. Constrain to two shapes:
    //   - external: http(s)://... → new tab
    //   - internal: starts with '/' (a router path) → navigate
    // Anything else (javascript:, data:, mailto:, protocol-relative //) is
    // dropped rather than opened as an escape hatch.
    if (/^https?:\/\//i.test(link)) {
      window.open(link, '_blank', 'noopener,noreferrer');
    } else if (link.startsWith('/') && !link.startsWith('//')) {
      navigate(link);
    }
  }

  // The slide's copy (eyebrow / title / subtitle) is no longer rendered — the
  // banner is the artwork plus a single CTA. The fields are still read from
  // the API and still drive the image's alt text, so admin-entered copy is not
  // lost and screen readers still get a description of the artwork.
  const isLight = slide.theme === 'light';

  return (
    <div className={`relative rounded-lg overflow-hidden ${isLight ? 'text-white' : 'text-ink'} border border-border`} style={{ background: slide.bg }}>
      {(slide.image || slide.imageMobile) && (
        // <picture> rather than two <img>s toggled with hidden/block: the
        // browser resolves the source before fetching, so only the matching
        // image is downloaded. Two toggled <img>s would pull both on every
        // load and spend a phone's data on the desktop artwork.
        // 768px is md, matching the breakpoint the slide's own padding and
        // type scale switch at.
        <picture key={`img-${current}`}>
          {slide.image && <source media="(min-width: 768px)" srcSet={slide.image} />}
          <img
            // Falls back either way round, so a banner with only one upload
            // still renders at both sizes rather than showing blank.
            src={slide.imageMobile || slide.image || ''}
            /* Empty on purpose, not an oversight. Banners no longer carry a
               title — the admin form stopped collecting one — so there is no
               human-written description to use, and inventing one ("Banner 1")
               would make a screen reader announce noise. The CTA beside it is
               a real labelled control pointing at the same destination, which
               makes the artwork decorative; an empty alt is the correct
               pattern for that, and lets assistive tech skip straight to the
               thing you can actually act on. */
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            /* Above the fold and almost always the LCP element — stays eager
               and asks for priority, unlike every other image on this page. */
            fetchPriority="high"
            decoding="async"
          />
        </picture>
      )}
      {/* Fixed height, not min-height. With min-h the box grew to whatever the
          current slide's copy needed, so a banner with an eyebrow and a
          two-line title was taller than one without — the carousel jumped as
          it advanced and everything below it moved. Every slide now occupies
          the same box and the copy centres inside it. */}
      {/* Padding was pl-14/pr-14 to keep the copy clear of the arrow buttons.
          With those gone the text can start where the card does. */}
      {/* Copy removed — the CTA is the only thing over the artwork now, pinned
          bottom-left. The height stays FIXED rather than shrinking to fit the
          button: it is what stops the carousel jumping as it advances, and the
          artwork behind it is sized for this box. `justify-start items-end` does
          the positioning; `pb-9` lifts the button clear of the dots, which sit
          at bottom-3 in the centre and would otherwise sit level with it. */}
      <div className="relative px-6 md:px-10 py-4 md:py-6 pb-9 md:pb-9 flex items-end justify-start h-[190px] md:h-[230px]">
        {slide.cta && (
          <button
            key={current}
            onClick={() => go(slide.link)}
            className="rise-in inline-flex items-center gap-2 h-9 px-4 rounded-full bg-brand text-white text-[12.5px] font-bold font-ui hover:bg-brand-deepest transition-all"
          >
            {slide.cta}
            <ArrowRight size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>
      {/* Dots are the only control now — the prev/next arrows are gone, so
          they carry the whole job of moving between slides and of showing
          where you are. White with a shadow rather than ink: they sit on
          admin-uploaded artwork whose brightness is unknown, and a dark dot
          disappears on a dark photograph. */}
      {slides.length > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === current}
              className={`rounded-full transition-all duration-300 drop-shadow-[0_1px_2px_rgba(15,23,42,0.5)] ${
                i === current ? 'w-6 h-2 bg-card' : 'w-2 h-2 bg-white/55 hover:bg-white/80'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────
   Shared — section header with optional "See more"
   ─────────────────────────────────────────────────────── */
function SectionHeader({ title, subtitle, seeMore, onSeeMore }: {
  title: string; subtitle?: string; seeMore?: string; onSeeMore?: () => void;
}) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3 md:mb-5">
      <div>
        <h2 className="font-display text-[22px] md:text-[26px] text-ink tracking-tight" style={{ fontWeight: 600 }}>
          {title}
        </h2>
        {subtitle && <p className="text-[13px] text-gray font-ui mt-1">{subtitle}</p>}
      </div>
      {seeMore && (
        <button
          onClick={onSeeMore}
          className="shrink-0 inline-flex items-center gap-2 h-10 px-4 rounded-full border border-border bg-card text-[13px] font-bold text-ink hover:border-brand hover:text-brand transition-colors font-ui"
        >
          {seeMore}
          <ArrowRight size={14} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────
   1 · NEW PRODUCTS
   ─────────────────────────────────────────────────────── */
/**
 * One row, scrolling sideways — the Price drops rail's shape, which is the
 * page's existing single-row pattern (arrows from md, snap-scroll on touch).
 *
 * Deliberately not `MobileScrollGrid`: that splits its children into two rows,
 * which is right for a section meant to read as a block but wrong here. A
 * single row keeps the section one screen-height tall while still carrying
 * twelve products, because the ones past the fold cost scrolling rather than
 * page space.
 */
function ProductScrollRow({ products }: { products: Product[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { lang } = useLanguageStore();

  function scroll(dir: 'left' | 'right') {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: dir === 'left' ? -400 : 400, behavior: 'smooth' });
  }

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto hide-scrollbar snap-x scroll-pl-4 -mx-4 px-4 lg:-mx-6 lg:px-6 pb-1 scroll-smooth"
      >
        {products.map((p) => (
          <div key={p.id} className="shrink-0 w-[46%] md:w-[200px] snap-start">
            <ProductCard product={p} />
          </div>
        ))}
      </div>
      <button
        onClick={() => scroll('left')}
        className="hidden md:flex absolute left-0 top-[38%] -translate-y-1/2 w-10 h-10 rounded-full bg-card shadow-float border border-border items-center justify-center text-ink hover:bg-brand hover:text-white hover:border-brand transition-colors z-10"
        aria-label={lang === 'en' ? 'Scroll left' : 'Desplazar a la izquierda'}
      >
        <ChevronLeft size={18} strokeWidth={2} />
      </button>
      <button
        onClick={() => scroll('right')}
        className="hidden md:flex absolute right-0 top-[38%] -translate-y-1/2 w-10 h-10 rounded-full bg-card shadow-float border border-border items-center justify-center text-ink hover:bg-brand hover:text-white hover:border-brand transition-colors z-10"
        aria-label={lang === 'en' ? 'Scroll right' : 'Desplazar a la derecha'}
      >
        <ChevronRight size={18} strokeWidth={2} />
      </button>
    </div>
  );
}

function NewProducts({ products }: { products: Product[] }) {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  return (
    <section>
      <SectionHeader
        title={lang === 'en' ? 'New products' : 'Nuevos productos'}
        subtitle={lang === 'en' ? 'Just landed in store' : 'Recién llegados a la tienda'}
        seeMore={lang === 'en' ? 'See all' : 'Ver todo'}
        onSeeMore={() => navigate('/categories')}
      />
      <ProductScrollRow products={products.slice(0, 12)} />
    </section>
  );
}

/* Wraps product tiles in TWO independently-scrolling rows on mobile, then
   restores the desktop 3/6-col grid at md+. Children are interleaved so the
   even-indexed items sit in row 1 and odd-indexed sit in row 2 — this keeps
   the visual pairing of the old grid-rows-2 grid-flow-col layout, while
   letting each row slide on its own. */
function MobileScrollGrid({ children }: { children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  const rowOne = items.filter((_, i) => i % 2 === 0);
  const rowTwo = items.filter((_, i) => i % 2 === 1);
  const rowCls =
    'flex gap-3 overflow-x-auto hide-scrollbar snap-x scroll-pl-4 -mx-4 px-4 pb-1';
  const itemCls = 'shrink-0 w-[46%] snap-start';
  return (
    <>
      {/* Mobile: two independent horizontal-scroll rows */}
      <div className="md:hidden flex flex-col gap-2">
        <div className={rowCls}>
          {rowOne.map((child, i) => (
            <div key={`r1-${i}`} className={itemCls}>{child}</div>
          ))}
        </div>
        {rowTwo.length > 0 && (
          <div className={rowCls}>
            {rowTwo.map((child, i) => (
              <div key={`r2-${i}`} className={itemCls}>{child}</div>
            ))}
          </div>
        )}
      </div>
      {/* Desktop: 3/6-col grid */}
      <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-6 gap-3">
        {children}
      </div>
    </>
  );
}

/* ───────────────────────────────────────────────────────
   Popular products — grid slotted between Top Brands and
   Ethnic Section. Different data source (general list) so
   it doesn't feel like a rerun of New / Sponsored / Price
   Drops (which all lean on the "featured" bucket).
   ─────────────────────────────────────────────────────── */
function PopularProducts({ products }: { products: Product[] }) {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  if (products.length === 0) return null;
  return (
    <section>
      <SectionHeader
        title={lang === 'en' ? 'Popular products' : 'Productos populares'}
        subtitle={lang === 'en' ? 'What shoppers are picking up right now' : 'Lo que los clientes eligen ahora'}
        seeMore={lang === 'en' ? 'See all' : 'Ver todo'}
        onSeeMore={() => navigate('/categories')}
      />
      <MobileScrollGrid>
        {products.slice(0, 12).map((p) => <ProductCard key={p.id} product={p} />)}
      </MobileScrollGrid>
    </section>
  );
}

/* ───────────────────────────────────────────────────────
   2 · PROMO GRID — data-driven, edited from admin
   ─────────────────────────────────────────────────────── */
function tileText(tile: PromoTile, field: 'eyebrow' | 'title' | 'description' | 'cta', lang: 'en' | 'es') {
  const key = `${field}_${lang}` as const;
  return (tile[key] as string | null) ?? '';
}


function PromoGridFeatureTile({ tile, lang }: { tile: PromoTile; lang: 'en' | 'es' }) {
  const navigate = useNavigate();
  const hasImage = !!tile.image_url;
  const textCls = tile.text_theme === 'light' ? 'text-white' : 'text-ink';
  const mutedCls = tile.text_theme === 'light' ? 'text-white/85' : 'text-gray';
  const textShadow = hasImage && tile.text_theme === 'light'
    ? { textShadow: '0 1px 12px rgba(0,0,0,0.55)' }
    : undefined;
  return (
    <button
      onClick={() => navigate(tile.link)}
      className={`relative overflow-hidden rounded-lg text-left p-5 md:p-10 min-h-[200px] md:min-h-[360px] flex flex-col justify-between ${paintedTile(tile.text_theme, hasImage)}`}
      style={{ background: tile.background }}
    >
      {tile.image_url && (
        <img
          src={resolveImageUrl(tile.image_url, 'tile')}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          decoding="async"
        />
      )}
      <div className="relative">
        {tileText(tile, 'eyebrow', lang) && (
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] bg-card/90 px-3 py-1 rounded-full text-brand-ink">
            <Sparkles size={11} strokeWidth={2.5} /> {tileText(tile, 'eyebrow', lang)}
          </span>
        )}
        {tileText(tile, 'title', lang) && (
          <h3 className={`font-display text-[22px] md:text-[40px] mt-3 md:mt-4 leading-[1.05] tracking-tight ${textCls}`} style={{ fontWeight: 500, ...textShadow }}>
            {tileText(tile, 'title', lang)}
          </h3>
        )}
        {tileText(tile, 'description', lang) && (
          <p className={`text-[12.5px] md:text-[14px] font-body mt-2 md:mt-3 max-w-md leading-relaxed ${mutedCls}`} style={textShadow}>
            {tileText(tile, 'description', lang)}
          </p>
        )}
      </div>
      <span className={`relative inline-flex w-fit items-center gap-2 mt-4 md:mt-6 text-[12.5px] md:text-[13.5px] font-bold font-ui ${textCls}`}>
        {tileText(tile, 'cta', lang)}
        <ArrowRight size={20} strokeWidth={2.5} />
      </span>
    </button>
  );
}

function PromoGridWideTile({ tile, lang }: { tile: PromoTile; lang: 'en' | 'es' }) {
  const navigate = useNavigate();
  const hasImage = !!tile.image_url;
  const textCls = tile.text_theme === 'light' ? 'text-white' : 'text-ink';
  const textShadow = hasImage && tile.text_theme === 'light'
    ? { textShadow: '0 1px 10px rgba(0,0,0,0.55)' }
    : undefined;
  return (
    <button
      onClick={() => navigate(tile.link)}
      className={`relative overflow-hidden rounded-lg text-left p-6 flex items-center justify-between min-h-[170px] ${paintedTile(tile.text_theme, hasImage)}`}
      style={{ background: tile.background }}
    >
      {tile.image_url && (
        <img
          src={resolveImageUrl(tile.image_url, 'tile')}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          decoding="async"
        />
      )}
      <div className="relative flex-1 min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink" style={textShadow}>
          {tileText(tile, 'eyebrow', lang)}
        </p>
        <h4 className={`font-display text-[22px] md:text-[24px] mt-2 leading-tight tracking-tight ${textCls}`} style={{ fontWeight: 500, ...textShadow }}>
          {tileText(tile, 'title', lang)}
        </h4>
        <span className="text-[13px] font-bold mt-3 inline-flex items-center gap-1.5 text-brand" style={textShadow}>
          {tileText(tile, 'cta', lang)}
          <ArrowRight size={13} strokeWidth={2.5} />
        </span>
      </div>
      {!tile.image_url && (
        <Truck size={56} strokeWidth={1.4} className="relative text-brand opacity-50 ml-3 shrink-0" />
      )}
    </button>
  );
}

function PromoGridCompactTile({ tile, lang }: { tile: PromoTile; lang: 'en' | 'es' }) {
  const navigate = useNavigate();
  const hasImage = !!tile.image_url;
  const textCls = tile.text_theme === 'light' ? 'text-white' : 'text-ink';
  const textShadow = hasImage && tile.text_theme === 'light'
    ? { textShadow: '0 1px 10px rgba(0,0,0,0.55)' }
    : undefined;
  return (
    <button
      onClick={() => navigate(tile.link)}
      className={`relative overflow-hidden rounded-lg text-left p-5 flex flex-col justify-between min-h-[170px] ${paintedTile(tile.text_theme, hasImage)}`}
      style={{ background: tile.background }}
    >
      {tile.image_url && (
        <img
          src={resolveImageUrl(tile.image_url, 'tile')}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          decoding="async"
        />
      )}
      <div className="relative">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand" style={textShadow}>
          {tileText(tile, 'eyebrow', lang)}
        </p>
        <h4 className={`font-display text-[18px] mt-1.5 leading-tight tracking-tight whitespace-pre-line ${textCls}`} style={{ fontWeight: 500, ...textShadow }}>
          {tileText(tile, 'title', lang)}
        </h4>
      </div>
      <span className="relative text-[12px] font-bold inline-flex items-center gap-1 text-brand" style={textShadow}>
        {tileText(tile, 'cta', lang)}
        <ArrowRight size={12} strokeWidth={2.5} />
      </span>
    </button>
  );
}

function PromoGrid() {
  const { lang } = useLanguageStore();
  const { data } = usePromoGrid();
  const config = data ?? defaultPromoGrid;
  const tiles = [...config.tiles]
    .filter((t) => t.is_active)
    .sort((a, b) => a.display_order - b.display_order);

  const feature = tiles.find((t) => t.variant === 'feature') ?? tiles[0];
  const wide = tiles.find((t) => t.variant === 'wide') ?? tiles[1];
  const compacts = tiles.filter((t) => t.variant === 'compact').slice(0, 2);
  if (!feature) return null;

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <PromoGridFeatureTile tile={feature} lang={lang} />
      <div className="grid grid-rows-[1fr_1fr] gap-4">
        {wide && <PromoGridWideTile tile={wide} lang={lang} />}
        {compacts.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            {compacts.map((c) => <PromoGridCompactTile key={c.id} tile={c} lang={lang} />)}
          </div>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────
   3 · FEATURED CATEGORIES — compact image-forward tiles.
   White rounded square holds the product photo; the category name
   sits beneath in two-line cap. No per-category background colour —
   the photo carries the visual weight.
   ─────────────────────────────────────────────────────── */
function CategoryOriginTile({
  cat, lang, onClick,
}: { cat: Category; lang: 'en' | 'es'; onClick: () => void }) {
  const image = resolveImageUrl(cat.icon_url, 'tile');
  const label = lang === 'en' ? cat.name_en : cat.name_es;
  const initial = label.slice(0, 1);

  return (
    <button
      onClick={onClick}
      className="group flex flex-col text-center w-full"
      aria-label={label}
    >
      <div className="photo-well relative aspect-square rounded-xl overflow-hidden bg-surface-cream border border-border/70 group-hover:border-border group-hover:shadow-card transition-all flex items-center justify-center">
        {image ? (
          <img
            src={image}
            alt=""
            className="max-w-full max-h-full object-contain group-hover:scale-[1.04] transition-transform duration-500 ease-out"
            draggable={false}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span
            className="font-display tracking-tight leading-none text-ink/25"
            style={{ fontWeight: 900, fontSize: 32 }}
          >
            {initial}
          </span>
        )}
      </div>
      <h3
        className="mt-2 -mx-1.5 text-[13.5px] font-semibold text-ink font-ui leading-snug line-clamp-2"
      >
        {/* 6px past the tile on each side, into the 15px gap: "Condimentos"
            is 88px in DM Sans and the tile 78px at a 360px phone, and no
            smaller size fits it — without the room it lost its last letter.
            The text is centred, so neighbouring labels still do not meet. */}
        {label}
      </h3>
    </button>
  );
}

/* ───────────────────────────────────────────────────────
   Mobile category rail — sits directly under the hero.

   No heading and no See-all button: on a phone this is the first thing
   under the banner, and a heading plus a link would cost two rows of
   chrome above the actual categories. The "see all" affordance is the
   last card in the row instead — same shape and size as the categories
   before it, so the row ends with something to tap rather than trailing
   off, and finding it is the same gesture as browsing the rest.
   ─────────────────────────────────────────────────────── */
function MobileCategoryRail({ categories }: { categories: Category[] }) {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  // 15 before the all-categories card. Past that the swipe is longer than
  // opening the full page would have been.
  const cats = categories.slice(0, 15);
  if (cats.length === 0) return null;

  return (
    <section className="lg:hidden">
      <div className="flex gap-3.5 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1 pt-1 scroll-smooth">
        {cats.map((cat) => (
          <div key={cat.id} className="shrink-0 w-[78px]">
            <CategoryOriginTile
              cat={cat}
              lang={lang}
              onClick={() => navigate(`/categories?cat=${cat.id}`)}
            />
          </div>
        ))}

        {/* Built from the same box as CategoryOriginTile rather than reusing
            the component: it needs a grid icon and a brand-tinted ground
            instead of a category image, but every dimension matches so it
            reads as the last card in the row. */}
        <div className="shrink-0 w-[78px]">
          <button
            onClick={() => navigate('/categories')}
            className="group flex flex-col text-center w-full"
            aria-label={lang === 'en' ? 'All categories' : 'Todas las categorías'}
          >
            <div className="relative aspect-square rounded-xl overflow-hidden bg-brand-whisper border border-brand-mist group-hover:border-brand transition-all flex items-center justify-center">
              <LayoutGrid size={26} strokeWidth={1.75} className="text-brand" />
            </div>
            <h3 className="mt-2 text-[13.5px] font-semibold text-brand font-ui leading-snug line-clamp-2">
              {lang === 'en' ? 'See all' : 'Ver todas'}
            </h3>
          </button>
        </div>
      </div>
    </section>
  );
}

function FeaturedCategories({ categories }: { categories: Category[] }) {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const cats = categories.slice(0, 12);
  if (cats.length === 0) return null;

  return (
    <section>
      <SectionHeader
        title={lang === 'en' ? 'Featured Categories' : 'Categorías destacadas'}
        subtitle={lang === 'en' ? 'Shop from our most popular categories' : 'Compra de nuestras categorías más populares'}
        seeMore={lang === 'en' ? 'View all categories' : 'Ver todas'}
        onSeeMore={() => navigate('/categories')}
      />

      <div
        className="flex gap-5 overflow-x-auto hide-scrollbar -mx-4 px-4 lg:-mx-6 lg:px-6 pb-1 pt-1 scroll-smooth"
      >
        {cats.map((cat) => (
          <div key={cat.id} className="shrink-0 w-[96px]">
            <CategoryOriginTile
              cat={cat}
              lang={lang}
              onClick={() => navigate(`/categories?cat=${cat.id}`)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────
   4 · SHOP BY ORIGIN — full-card illustrated tiles
   Art is auto-generated per slug from the shared OriginCardArt module;
   admin can override by uploading their own image.
   ─────────────────────────────────────────────────────── */
function formatOriginCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K+`;
  }
  return `${n}+`;
}

function OriginCardTile({
  card, count, lang, onClick,
}: { card: OriginCardType; count: number; lang: 'en' | 'es'; onClick: () => void }) {
  const image = card.image_url ? resolveImageUrl(card.image_url, 'tile') : null;
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-2xl flex flex-col text-left w-full transition-transform hover:-translate-y-0.5 aspect-[10/11]"
      style={{ background: card.bg_color }}
    >
      {/* Background art — admin-uploaded image takes priority, otherwise
          the auto-generated origin art fills the whole card. */}
      {image ? (
        <img
          src={image}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-transform group-hover:scale-[1.04]"
          draggable={false}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <OriginCardArt
          slug={card.key}
          bg={card.bg_color}
          accent={card.accent_color}
          className="absolute inset-0 w-full h-full transition-transform group-hover:scale-[1.04]"
        />
      )}

      {/* Bottom scrim — keeps title + count readable over whichever art
          fills the card. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[40%] pointer-events-none"
        style={{ background: `linear-gradient(to top, ${card.bg_color} 0%, ${card.bg_color}E6 45%, transparent 100%)` }}
      />

      {/* Title + count overlay. Sits on top of the scrim. */}
      <div className="relative mt-auto p-2.5 md:p-4 pt-2 md:pt-3 flex items-end justify-between gap-1.5 md:gap-2 w-full">
        <div className="min-w-0">
          <h3 className="font-display text-[11.5px] md:text-[14px] text-ink leading-tight tracking-tight" style={{ fontWeight: 700 }}>
            {lang === 'en' ? card.label_en : card.label_es}
          </h3>
          <p className="text-[9.5px] md:text-[11.5px] text-ink/55 font-ui mt-0.5">
            {formatOriginCount(count)} {lang === 'en' ? 'products' : 'productos'}
          </p>
        </div>
        <ArrowRight size={13} strokeWidth={2.5} className="md:hidden text-ink/80 shrink-0" />
        <ArrowRight size={18} strokeWidth={2.5} className="hidden md:inline text-ink/80 shrink-0" />
      </div>
    </button>
  );
}

function EthnicSection() {
  const { lang } = useLanguageStore();
  const navigate = useNavigate();
  // Origins were promoted from a home_sections JSON blob to their own table
  // on 2026-07-13. The public /api/origins endpoint returns active rows in
  // sort_order, ready to render.
  const { data: originsData } = useOriginsList();
  const { data: countsData } = useOriginCounts();

  const counts = countsData ?? [];
  const countByOrigin = new Map<string, number>(
    counts.map((c) => [c.key.toLowerCase(), c.product_count]),
  );
  // Adapt the new Origin row shape to what OriginCardTile expects (backfill
  // null colours with the design-system defaults; the tile is still keyed
  // by the string origin key, matching Product.origin).
  const cards: OriginCardType[] = (originsData ?? [])
    .map((o) => ({
      key: o.key.toLowerCase(),
      label_es: o.label_es,
      label_en: o.label_en,
      bg_color: o.bg_color ?? '#F5F0E8',
      accent_color: o.accent_color ?? '#7A7A7A',
      image_url: o.image_url,
      link: o.link ?? `/categories?origin=${o.key}`,
      is_active: true,
      display_order: o.sort_order,
    }))
    .filter((c) => (countByOrigin.get(c.key) ?? 0) > 0);
  if (cards.length === 0) return null;

  return (
    <section>
      <SectionHeader
        title={lang === 'en' ? 'Shop by origin' : 'Compra por origen'}
        seeMore={lang === 'en' ? 'See more' : 'Ver más'}
        onSeeMore={() => navigate('/origins')}
      />
      <div className="relative">
        {/* Mobile: single horizontal-scroll row of origin tiles.
            Desktop: 4-col at md, 8-col at lg (one row cap on the home page). */}
        <div className="flex md:hidden gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1 snap-x scroll-pl-4">
          {cards.slice(0, 8).map((card) => (
            <div key={card.key} className="shrink-0 w-[120px] snap-start">
              <OriginCardTile
                card={card}
                count={countByOrigin.get(card.key.toLowerCase()) ?? 0}
                lang={lang}
                onClick={() => navigate(card.link || `/categories?origin=${card.key}`)}
              />
            </div>
          ))}
        </div>
        <div className="hidden md:grid md:grid-cols-4 lg:grid-cols-8 gap-3">
          {cards.slice(0, 8).map((card) => (
            <div key={card.key}>
              <OriginCardTile
                card={card}
                count={countByOrigin.get(card.key.toLowerCase()) ?? 0}
                lang={lang}
                onClick={() => navigate(card.link || `/categories?origin=${card.key}`)}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────
   5 · SPONSORED PRODUCTS (with See more)
   ─────────────────────────────────────────────────────── */
function SponsoredProducts({ products }: { products: Product[] }) {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const sponsored = products.slice(0, 6);
  if (sponsored.length === 0) return null;
  return (
    <section>
      <SectionHeader
        title={lang === 'en' ? 'Sponsored picks' : 'Patrocinados'}
        subtitle={lang === 'en' ? 'Brands we partner with' : 'Marcas con las que colaboramos'}
        seeMore={lang === 'en' ? 'See more' : 'Ver más'}
        onSeeMore={() => navigate('/categories?sponsored=1')}
      />
      {/* No per-card "Patrocinado" label — the section heading carries the
          paid-placement disclosure for every card under it, and the pt-4 the
          label needed made these cards sit lower than every other rail. */}
      <MobileScrollGrid>
        {sponsored.map((p) => <ProductCard key={p.id} product={p} />)}
      </MobileScrollGrid>
    </section>
  );
}

/* ───────────────────────────────────────────────────────
   6 · ADS BANNER — data-driven, edited from admin
   ─────────────────────────────────────────────────────── */
function sectionText(section: AdsBannerSection, field: 'eyebrow' | 'title' | 'description' | 'cta', lang: 'en' | 'es') {
  return (section as unknown as Record<string, string>)[`${field}_${lang}`] ?? '';
}

function AdsBannerHero({ hero, lang, fallbackLink }: { hero: AdsBannerSection; lang: 'en' | 'es'; fallbackLink: string }) {
  const navigate = useNavigate();
  const hasImage = !!hero.image_url;
  const textCls = hero.text_theme === 'light' ? 'text-white' : 'text-ink';
  const mutedCls = hero.text_theme === 'light' ? 'text-white/80' : 'text-gray';
  const eyebrowBg = hero.text_theme === 'light' ? 'bg-white/15' : 'bg-white/80';
  const eyebrowColor = hero.text_theme === 'light' ? '#FFFFFF' : '#022B91';
  const ctaBg = hero.text_theme === 'light' ? '#FFFFFF' : '#054EE8';
  const ctaText = hero.text_theme === 'light' ? '#022B91' : '#FFFFFF';
  const textShadow = hasImage && hero.text_theme === 'light'
    ? { textShadow: '0 1px 12px rgba(0,0,0,0.55)' }
    : undefined;
  return (
    <button
      onClick={() => navigate(hero.link || fallbackLink)}
      className={`md:col-span-2 relative overflow-hidden rounded-lg text-left p-7 md:p-9 flex items-center gap-6 min-h-[180px] ${paintedTile(hero.text_theme, hasImage)}`}
      style={{ background: hero.background }}
    >
      {/* Full-bleed cover art, so it takes the master rather than the 800 px
          `hero` variant — same reason as the banner carousel. */}
      {hero.image_url && (
        <img
          src={resolveImageUrl(hero.image_url, 'banner')}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          decoding="async"
        />
      )}
      <div className={`relative flex-1 ${textCls}`}>
        <span
          className={`inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] backdrop-blur px-3 py-1 rounded-full ${eyebrowBg}`}
          style={{ color: eyebrowColor }}
        >
          <Megaphone size={11} strokeWidth={2.5} />
          {sectionText(hero, 'eyebrow', lang)}
        </span>
        <h3 className="font-display text-[26px] md:text-[32px] mt-3 leading-tight tracking-tight" style={{ fontWeight: 500, ...textShadow }}>
          {sectionText(hero, 'title', lang)}
        </h3>
        {sectionText(hero, 'description', lang) && (
          <p className={`text-[13.5px] font-body mt-2 max-w-md leading-relaxed ${mutedCls}`} style={textShadow}>
            {sectionText(hero, 'description', lang)}
          </p>
        )}
        <span
          className="inline-flex w-fit items-center gap-2 mt-4 h-11 px-6 rounded-full text-[13px] font-bold font-ui"
          style={{ background: ctaBg, color: ctaText }}
        >
          {sectionText(hero, 'cta', lang)}
          <ArrowRight size={14} strokeWidth={2.5} />
        </span>
      </div>
    </button>
  );
}

function AdsBannerSide({ side, lang, fallbackProduct }: { side: AdsBannerSection; lang: 'en' | 'es'; fallbackProduct?: Product }) {
  const navigate = useNavigate();
  const hasImage = !!side.image_url;
  const textCls = side.text_theme === 'light' ? 'text-white' : 'text-ink';
  const mutedCls = side.text_theme === 'light' ? 'text-white/75' : 'text-ink/70';
  const eyebrowColor = '#E11D48';
  const ctaColor = '#5FA133';
  const textShadow = hasImage && side.text_theme === 'light'
    ? { textShadow: '0 1px 10px rgba(0,0,0,0.55)' }
    : undefined;
  const target = side.link || (fallbackProduct ? `/products/${fallbackProduct.id}` : '/categories');
  return (
    <button
      onClick={() => navigate(target)}
      className={`relative overflow-hidden rounded-lg text-left p-6 flex flex-col justify-between min-h-[180px] ${paintedTile(side.text_theme, hasImage)}`}
      style={{ background: side.background }}
    >
      {side.image_url && (
        <img
          src={resolveImageUrl(side.image_url, 'tile')}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          decoding="async"
        />
      )}
      <div className={`relative ${textCls}`}>
        <span
          className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] bg-white/80 px-2.5 py-1 rounded-full"
          style={{ color: eyebrowColor }}
        >
          <Tag size={10} strokeWidth={2.5} />
          {sectionText(side, 'eyebrow', lang)}
        </span>
        <h4 className="font-display text-[20px] mt-3 leading-tight tracking-tight" style={{ fontWeight: 600, ...textShadow }}>
          {sectionText(side, 'title', lang)}
        </h4>
        <p className={`text-[12.5px] mt-1 line-clamp-2 ${mutedCls}`} style={textShadow}>
          {sectionText(side, 'description', lang) ||
            (fallbackProduct ? (lang === 'en' ? fallbackProduct.name_en : fallbackProduct.name_es) : '')}
        </p>
      </div>
      <span
        className="relative text-[12px] font-bold inline-flex items-center gap-1 mt-3"
        style={{ color: ctaColor, ...textShadow }}
      >
        {sectionText(side, 'cta', lang)}
        <ArrowRight size={12} strokeWidth={2.5} />
      </span>
    </button>
  );
}

function AdsBanner({ products }: { products: Product[] }) {
  const { lang } = useLanguageStore();
  const { data } = useAdsBanner();
  const config = data ?? defaultAdsBanner;
  const adProduct = products[2] ?? products[0];
  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <AdsBannerHero hero={config.hero} lang={lang} fallbackLink="/categories?sponsored=1" />
      <AdsBannerSide side={config.side} lang={lang} fallbackProduct={adProduct} />
    </section>
  );
}

/* ───────────────────────────────────────────────────────
   6b · TOP BRANDS — admin-managed logo row + three static promo cards
   ─────────────────────────────────────────────────────── */
type BrandPromo = {
  title_en: string; title_es: string;
  subtitle_en: string; subtitle_es: string;
  bg: string;
  accent: string;
  haloTint: string;
  Icon: LucideIcon;
  link: string;
};

const BRAND_PROMOS: BrandPromo[] = [
  {
    title_en: 'Taste the Tradition',
    title_es: 'Saborea la tradición',
    subtitle_en: 'Authentic spices from trusted brands',
    subtitle_es: 'Especias auténticas de marcas de confianza',
    bg: '#EEF7DC',
    accent: '#4F9A2E',
    haloTint: '#D6ECB1',
    Icon: Flame,
    link: '/categories?tag=spices',
  },
  {
    title_en: 'Special Offers On Bestsellers',
    title_es: 'Ofertas en los más vendidos',
    subtitle_en: 'Up to 30% off on premium products',
    subtitle_es: 'Hasta 30% en productos premium',
    bg: '#FFF1E1',
    accent: '#E27226',
    haloTint: '#FCD9B0',
    Icon: Tag,
    link: '/categories?sale=1',
  },
  {
    title_en: 'Quality You Can Trust',
    title_es: 'Calidad en la que confiar',
    subtitle_en: '100% original products from top brands',
    subtitle_es: 'Productos 100% originales de marcas top',
    bg: '#E5F0FB',
    accent: '#2479C9',
    haloTint: '#C2DBF4',
    Icon: ShieldCheck,
    link: '/categories',
  },
];

function BrandLogoCard({ brand, onClick }: { brand: TopBrand; onClick: () => void }) {
  const logo = brand.image_url ? resolveImageUrl(brand.image_url, 'logo') : null;
  const plate = logoPlate(brand.bg_color);
  return (
    <button
      onClick={onClick}
      // No padding: the logo runs to the card's edges.
      className={`${plate.className} group w-full h-16 md:h-20 rounded-lg md:rounded-xl border border-border/60 hover:border-brand hover:shadow-sm transition-all flex items-center justify-center overflow-hidden`}
      style={plate.style}
      aria-label={brand.name}
    >
      {logo ? (
        <img
          src={logo}
          alt={brand.name}
          // object-cover, so the logo spans the full card width. Under
          // contain it scaled to whichever side ran out first and left bars
          // down the sides of any logo wider than the card's ratio — the
          // scale-[1.1] here was papering over exactly that.
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          draggable={false}
          loading="lazy"
          decoding="async"
        />
      ) : (
        // Fallback if admin hasn't uploaded the logo yet — show a muted
        // monogram so the card isn't an empty box.
        <span className="text-[11px] font-display text-muted/70 uppercase tracking-wider">
          {brand.name}
        </span>
      )}
    </button>
  );
}

function BrandPromoCard({ promo, lang, onClick }: { promo: BrandPromo; lang: 'en' | 'es'; onClick: () => void }) {
  const { Icon } = promo;
  return (
    <button
      onClick={onClick}
      className="relative overflow-hidden rounded-2xl p-6 text-left flex items-center gap-4 min-h-[150px]"
      style={{ background: promo.bg }}
    >
      <div className="relative flex-1 min-w-0">
        <h3
          className="font-display text-[20px] md:text-[22px] text-ink leading-tight tracking-tight"
          style={{ fontWeight: 700 }}
        >
          {lang === 'en' ? promo.title_en : promo.title_es}
        </h3>
        <p className="text-[12.5px] font-ui text-gray mt-1.5 leading-snug">
          {lang === 'en' ? promo.subtitle_en : promo.subtitle_es}
        </p>
        <span
          className="inline-flex w-fit items-center gap-1.5 mt-4 h-9 px-4 rounded-full text-white text-[12px] font-bold font-ui"
          style={{ background: promo.accent }}
        >
          {lang === 'en' ? 'Shop Now' : 'Comprar'}
          <ArrowRight size={12} strokeWidth={2.5} />
        </span>
      </div>
      <div
        className="shrink-0 w-[88px] h-[88px] rounded-full flex items-center justify-center"
        style={{ background: promo.haloTint }}
      >
        <Icon size={40} strokeWidth={1.75} style={{ color: promo.accent }} />
      </div>
    </button>
  );
}

function TopBrands() {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  // Brands were promoted from a home_sections JSON blob to their own table
  // on 2026-07-13. The public /api/brands endpoint returns active rows in
  // sort_order — we still adapt them to the existing TopBrand shape so the
  // BrandLogoCard component doesn't need touching.
  const { data: brandsData } = useBrandsList();
  const brands: TopBrand[] = (brandsData ?? [])
    .slice(0, 16)
    .map((b) => ({
      name: b.name,
      image_url: b.logo_url,
      link: b.link ?? `/categories?brand=${encodeURIComponent(b.name)}`,
      is_active: true,
      display_order: b.sort_order,
    }));
  if (brands.length === 0) return null;

  return (
    <section>
      <SectionHeader
        title={lang === 'en' ? 'Top Brands' : 'Marcas top'}
        seeMore={lang === 'en' ? 'See more' : 'Ver más'}
        onSeeMore={() => navigate('/brands')}
      />

      {/* Mobile: exactly two rows, each sliding independently */}
      <div className="md:hidden flex flex-col gap-2 mb-4">
        {[
          brands.filter((_, i) => i % 2 === 0),
          brands.filter((_, i) => i % 2 === 1),
        ].map((row, r) =>
          row.length > 0 ? (
            <div
              key={r}
              className="flex gap-2 overflow-x-auto hide-scrollbar snap-x scroll-pl-4 -mx-4 px-4 pb-1"
            >
              {row.map((brand) => (
                <div key={brand.name} className="shrink-0 w-[23%] snap-start">
                  <BrandLogoCard
                    brand={brand}
                    onClick={() => navigate(brand.link)}
                  />
                </div>
              ))}
            </div>
          ) : null,
        )}
      </div>

      {/* Desktop: 8-col grid unchanged */}
      <div className="hidden md:grid md:grid-cols-8 gap-3 mb-5">
        {brands.map((brand) => (
          <BrandLogoCard
            key={brand.name}
            brand={brand}
            onClick={() => navigate(brand.link)}
          />
        ))}
      </div>

      {/* HIDDEN 2026-07-30 — the three hardcoded brand promo cards. Restore by
          uncommenting this block; BRAND_PROMOS and BrandPromoCard are both left
          in place above, so nothing else has to change. The admin-managed brand
          logo row above is unaffected.
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {BRAND_PROMOS.map((promo) => (
          <BrandPromoCard
            key={promo.title_en}
            promo={promo}
            lang={lang}
            onClick={() => navigate(promo.link)}
          />
        ))}
      </div>
      */}
    </section>
  );
}

/* ───────────────────────────────────────────────────────
   6c · TOP SHOPS — partner shop cards
   Backed by the real Store table now; card design lives in
   apps/web/src/components/StoreCard.tsx and is shared with /stores.
   ─────────────────────────────────────────────────────── */

function TopShops() {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  // Real Store table now drives this rail. The old useTopShops JSON blob
  // stays as an admin-side curated overlay hook (not read here anymore) —
  // deprecating it entirely can wait for a follow-up.
  const { data } = useStores({ sort: 'popular', limit: 6 });
  const stores = data?.items ?? [];
  if (stores.length === 0) return null;
  return (
    <section>
      <SectionHeader
        title={lang === 'en' ? 'Top Shops' : 'Tiendas destacadas'}
        seeMore={lang === 'en' ? 'See more' : 'Ver más'}
        onSeeMore={() => navigate('/stores')}
      />
      {/* Mobile: two independently-scrolling rows */}
      <div className="sm:hidden flex flex-col gap-3">
        {[
          stores.slice(0, 6).filter((_, i) => i % 2 === 0),
          stores.slice(0, 6).filter((_, i) => i % 2 === 1),
        ].map((row, r) =>
          row.length > 0 ? (
            <div
              key={r}
              className="flex gap-3 overflow-x-auto hide-scrollbar snap-x scroll-pl-4 -mx-4 px-4 pb-1"
            >
              {row.map((store) => (
                <div key={store.id} className="shrink-0 w-[46%] snap-start">
                  <StoreCard store={store} lang={lang} />
                </div>
              ))}
            </div>
          ) : null,
        )}
      </div>

      {/* Desktop: unchanged grid — 6 shop cards in one row on lg. Full list at /stores. */}
      <div className="hidden sm:grid sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {stores.slice(0, 6).map((store) => (
          <StoreCard
            key={store.id}
            store={store}
            lang={lang}
          />
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────
   7 · PRICE DROPS
   ─────────────────────────────────────────────────────── */
function PriceDrops({ products }: { products: Product[] }) {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  let deals = products.filter((p) => p.variants?.some((v) => v.compare_at_price));
  if (deals.length === 0) deals = products.slice(0, 10);
  deals = deals.slice(0, 10);

  function scroll(dir: 'left' | 'right') {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: dir === 'left' ? -400 : 400, behavior: 'smooth' });
  }

  return (
    <section>
      <div className="flex items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="font-display text-[22px] md:text-[26px] text-ink tracking-tight" style={{ fontWeight: 600 }}>
            {lang === 'en' ? 'Price drops' : 'Bajadas de precio'}
          </h2>
          <p className="text-[12.5px] text-gray font-ui">{lang === 'en' ? 'Lower than last week' : 'Más barato que la semana pasada'}</p>
        </div>
        <button onClick={() => navigate('/categories?deals=1')} className="text-[13px] font-bold text-brand hover:underline font-ui underline-offset-2 inline-flex items-center gap-1.5">
          {lang === 'en' ? 'See all' : 'Ver todo'}
          <ArrowRight size={13} strokeWidth={2.5} />
        </button>
      </div>
      <div className="relative">
        <div ref={scrollRef} className="flex gap-3 overflow-x-auto hide-scrollbar snap-x scroll-pl-4 -mx-4 px-4 lg:-mx-6 lg:px-6 pb-1 scroll-smooth">
          {deals.map((p) => (
            <div key={p.id} className="shrink-0 w-[46%] md:w-[200px] snap-start"><ProductCard product={p} /></div>
          ))}
        </div>
        <button onClick={() => scroll('left')} className="hidden md:flex absolute left-0 top-[38%] -translate-y-1/2 w-10 h-10 rounded-full bg-card shadow-float border border-border items-center justify-center text-ink hover:bg-brand hover:text-white hover:border-brand transition-colors z-10" aria-label="prev">
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <button onClick={() => scroll('right')} className="hidden md:flex absolute right-0 top-[38%] -translate-y-1/2 w-10 h-10 rounded-full bg-card shadow-float border border-border items-center justify-center text-ink hover:bg-brand hover:text-white hover:border-brand transition-colors z-10" aria-label="next">
          <ChevronRight size={18} strokeWidth={2} />
        </button>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────
   8 · SHOP BY CATEGORY — per-category product rows
   ─────────────────────────────────────────────────────── */
function CategoryRow({ category }: { category: Category }) {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const { data, isLoading } = useProducts({ categoryId: category.id, limit: 6 });
  const products = data?.items ?? [];
  if (!isLoading && products.length === 0) return null;

  return (
    <section>
      <SectionHeader
        title={lang === 'en' ? category.name_en : category.name_es}
        seeMore={lang === 'en' ? 'See all' : 'Ver todo'}
        onSeeMore={() => navigate(`/categories?cat=${category.id}`)}
      />
      {/* Mobile: single-row horizontal scroll. Desktop: 3/6-col grid. */}
      <div className="flex gap-3 overflow-x-auto hide-scrollbar snap-x scroll-pl-4 -mx-4 px-4 pb-1 md:hidden">
        {(isLoading
          ? Array.from({ length: 6 }).map((_, i) => <ProductCardSkeleton key={i} />)
          : products.slice(0, 6).map((p) => <ProductCard key={p.id} product={p} />)
        ).map((child, i) => (
          <div key={i} className="shrink-0 w-[46%] snap-start">{child}</div>
        ))}
      </div>
      <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-6 gap-3">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => <ProductCardSkeleton key={i} />)
          : products.slice(0, 6).map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </section>
  );
}

function ShopByCategory({ categories }: { categories: Category[] }) {
  const withProducts = categories.filter((c) => (c._count?.products ?? 0) > 0);
  const featured = (withProducts.length > 0 ? withProducts : categories).slice(0, 3);
  if (featured.length === 0) return null;
  return (
    <div className="flex flex-col gap-8">
      {featured.map((c) => <CategoryRow key={c.id} category={c} />)}
    </div>
  );
}

/* ───────────────────────────────────────────────────────
   9 · FEEDBACK (the form; the invented reviews beside it are gone)
   ─────────────────────────────────────────────────────── */
interface FeedbackFormData {
  name: string;
  email: string;
  rating: number;
  message: string;
}

function Feedback() {
  const { lang } = useLanguageStore();
  const toast = useToast();
  const messages = useValidationMessages();
  const submit = useSubmitSupportTicket();
  const [hoverRating, setHoverRating] = useState(0);

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      name:    r.name({ min: 2, max: 80 }),
      email:   r.email(),
      rating:  z.number().min(1, messages.required).max(5),
      message: z.string().trim().min(10, messages.tooShort(10)).max(1000, messages.tooLong(1000)),
    });
  }, [messages]);

  const {
    register, handleSubmit, watch, setValue, reset,
    formState: { errors, isSubmitting },
  } = useForm<FeedbackFormData>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { name: '', email: '', rating: 0, message: '' },
  });

  const rating = watch('rating');
  const setRating = (v: number) => setValue('rating', v, { shouldValidate: true });

  const onSubmit = async (values: FeedbackFormData) => {
    try {
      await submit.mutateAsync({
        name:    values.name,
        email:   values.email,
        phone:   null,
        subject: `Homepage feedback — ${values.rating}★`,
        body:    `Rating: ${values.rating}/5\n\n${values.message}`,
        source:  'home_feedback',
        language: lang,
      });
      toast.success(
        lang === 'en' ? 'Thanks for your feedback!' : '¡Gracias por tu opinión!',
        lang === 'en' ? 'We have received your message and will review it shortly.' : 'Hemos recibido tu mensaje y lo revisaremos pronto.',
      );
      reset({ name: '', email: '', rating: 0, message: '' });
    } catch (err) {
      toast.error(
        lang === 'en' ? "We couldn't send your feedback" : 'No pudimos enviar tu opinión',
        err instanceof Error ? err.message : (lang === 'en' ? 'Please try again in a moment.' : 'Inténtalo de nuevo en un momento.'),
      );
    }
  };

  const inputCls = 'w-full h-11 px-3.5 rounded-xl border border-border bg-card text-[13px] font-ui text-ink placeholder:text-muted focus:outline-none focus:border-brand transition-colors';

  return (
    <section>
      <SectionHeader
        title={lang === 'en' ? 'Share your feedback' : 'Comparte tu opinión'}
        subtitle={lang === 'en' ? 'Tell us what we got right — or what we can improve' : 'Cuéntanos qué hicimos bien — o qué podemos mejorar'}
      />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">

        {/* LEFT — feedback form */}
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="lg:col-span-3 bg-card rounded-lg border border-border/60 p-6 md:p-8 flex flex-col gap-4"
        >
          <div>
            <h3 className="font-display text-[20px] md:text-[22px] text-ink tracking-tight" style={{ fontWeight: 600 }}>
              {lang === 'en' ? 'Have your say' : 'Danos tu opinión'}
            </h3>
            <p className="text-[12.5px] text-gray font-ui mt-1">
              {lang === 'en'
                ? 'Real customer feedback shapes everything we ship. Drop us a note.'
                : 'La opinión de los clientes da forma a lo que hacemos. Déjanos un mensaje.'}
            </p>
          </div>

          {/* Rating */}
          <div className="flex items-center gap-3">
            <span className="text-[12px] font-bold font-ui uppercase tracking-wider text-ink/70 w-[110px]">
              {lang === 'en' ? 'Your rating' : 'Tu valoración'}
            </span>
            <div className="flex items-center gap-1.5" onMouseLeave={() => setHoverRating(0)}>
              {Array.from({ length: 5 }).map((_, i) => {
                const v = i + 1;
                const filled = (hoverRating || rating) >= v;
                return (
                  <button
                    key={v}
                    type="button"
                    aria-label={`${v} ${lang === 'en' ? 'stars' : 'estrellas'}`}
                    onMouseEnter={() => setHoverRating(v)}
                    onClick={() => setRating(v)}
                    className="p-0.5 transition-transform hover:scale-110"
                  >
                    <Star
                      size={22}
                      strokeWidth={1.75}
                      className={filled ? 'text-amber-deep fill-amber-deep' : 'text-border'}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Name + Email */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-bold font-ui uppercase tracking-wider text-ink/70 mb-1.5">
                {lang === 'en' ? 'Your name' : 'Tu nombre'}
              </label>
              <input
                type="text"
                placeholder={lang === 'en' ? 'e.g. Priya' : 'p. ej. Priya'}
                aria-invalid={errors.name ? true : undefined}
                className={`${inputCls} ${errors.name ? 'border-danger focus:border-danger' : ''}`}
                {...register('name')}
              />
              {errors.name?.message && (
                <p role="alert" className="mt-1 text-[11.5px] text-danger font-ui font-medium">{errors.name.message}</p>
              )}
            </div>
            <div>
              <label className="block text-[12px] font-bold font-ui uppercase tracking-wider text-ink/70 mb-1.5">
                {lang === 'en' ? 'Email' : 'Correo'}
              </label>
              <input
                type="email"
                placeholder="you@example.com"
                aria-invalid={errors.email ? true : undefined}
                className={`${inputCls} ${errors.email ? 'border-danger focus:border-danger' : ''}`}
                {...EMAIL_INPUT_PROPS}
                {...lowercaseEmail(register('email'))}
              />
              {errors.email?.message && (
                <p role="alert" className="mt-1 text-[11.5px] text-danger font-ui font-medium">{errors.email.message}</p>
              )}
            </div>
          </div>

          {/* Rating error (rating control is above this) */}
          {errors.rating?.message && (
            <p role="alert" className="-mt-2 text-[11.5px] text-danger font-ui font-medium">
              {lang === 'en' ? 'Please pick a rating from 1 to 5 stars.' : 'Elige una valoración de 1 a 5 estrellas.'}
            </p>
          )}

          {/* Message */}
          <div>
            <label className="block text-[12px] font-bold font-ui uppercase tracking-wider text-ink/70 mb-1.5">
              {lang === 'en' ? 'Your message' : 'Tu mensaje'}
            </label>
            <textarea
              rows={4}
              placeholder={lang === 'en'
                ? 'What did we get right? Anything we should fix?'
                : '¿Qué hicimos bien? ¿Algo que debamos mejorar?'}
              aria-invalid={errors.message ? true : undefined}
              className={`w-full p-3 rounded-xl border bg-card text-[13px] font-ui text-ink placeholder:text-muted focus:outline-none transition-colors resize-none ${
                errors.message ? 'border-danger focus:border-danger' : 'border-border focus:border-brand'
              }`}
              {...register('message')}
            />
            {errors.message?.message && (
              <p role="alert" className="mt-1 text-[11.5px] text-danger font-ui font-medium">{errors.message.message}</p>
            )}
          </div>

          {/* Submit */}
          <div className="flex items-center justify-between gap-3 flex-wrap mt-1">
            <p className="text-[11.5px] text-muted font-ui max-w-sm">
              {lang === 'en'
                ? 'We never share your details. By submitting you agree to our feedback policy.'
                : 'Nunca compartimos tus datos. Al enviar aceptas nuestra política de opiniones.'}
            </p>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-full bg-brand text-white text-[13px] font-bold font-ui hover:bg-brand-deepest transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting
                ? (lang === 'en' ? 'Sending…' : 'Enviando…')
                : (lang === 'en' ? 'Send feedback' : 'Enviar opinión')}
              {!isSubmitting && <ArrowRight size={14} strokeWidth={2.5} />}
            </button>
          </div>
        </form>

      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────
   10 · VALUE RIBBON (kept)
   ─────────────────────────────────────────────────────── */
function ValueRibbon() {
  const { lang } = useLanguageStore();
  // Three of the four claims that used to sit here were invented. "Delivery
  // in 60 min / Madrid Centro" is a promise the app never made good on and
  // the terms explicitly contradict. "Rated 4.8/5 · Thousands of customers"
  // was a rating with no reviews behind it. The free-delivery tile went on
  // 2026-09-25 with the feature itself.
  const items = [
    { icon: Wallet, label_es: 'Paga al recibir', label_en: 'Pay on delivery', sub_es: 'Efectivo o tarjeta', sub_en: 'Cash or card' },
    { icon: Sparkles, label_es: 'Sabores del sur de Asia', label_en: 'South Asian groceries', sub_es: 'Las marcas que conoces', sub_en: 'The brands you know' },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-3 p-4 bg-card rounded-lg border border-border/60">
          <div className="w-11 h-11 rounded-xl bg-brand-mist flex items-center justify-center shrink-0">
            <it.icon size={18} strokeWidth={1.75} className="text-brand" />
          </div>
          <div>
            <p className="text-[13px] font-bold text-ink font-ui">{lang === 'en' ? it.label_en : it.label_es}</p>
            <p className="text-[11px] text-muted font-ui mt-0.5">{lang === 'en' ? it.sub_en : it.sub_es}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────────────────────────────────
   CATEGORY SPOTLIGHT — one category's own shelf.

   Every existing rail except Popular draws from the same featured or
   sponsored bucket, so they can show the same products in three places.
   This one is scoped to a single category, which makes it genuinely
   different stock rather than a re-sort of the same twenty rows.
   ─────────────────────────────────────────────────────── */
function CategorySpotlight({ category }: { category: Category }) {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const { data, isLoading } = useProducts({ categoryId: category.id, limit: 12 });
  const products = data?.items ?? [];
  const catName = lang === 'en' ? category.name_en : category.name_es;

  if (isLoading) {
    return (
      <section>
        <Skeleton className="h-7 w-64 mb-3" />
        <MobileScrollGrid>
          {Array.from({ length: 12 }).map((_, i) => <ProductCardSkeleton key={i} />)}
        </MobileScrollGrid>
      </section>
    );
  }
  // A category with nothing in it renders nothing at all rather than an
  // empty shelf with a heading over it.
  if (products.length === 0) return null;

  return (
    <section>
      <SectionHeader
        title={lang === 'en' ? `Best in ${catName}` : `Lo mejor en ${catName}`}
        subtitle={lang === 'en'
          ? `Everything stocked under ${catName}`
          : `Todo lo que tenemos en ${catName}`}
        seeMore={lang === 'en' ? 'See all' : 'Ver todo'}
        onSeeMore={() => navigate(`/categories?cat=${category.id}`)}
      />
      <MobileScrollGrid>
        {products.slice(0, 12).map((p) => <ProductCard key={p.id} product={p} />)}
      </MobileScrollGrid>
    </section>
  );
}

/* ───────────────────────────────────────────────────────
   ORIGIN SHELF — products filtered by where they come from.

   The origin rail that used to live here was a grid of region cards
   linking away. This shows the actual products, which is the thing a
   shopper came for, and the origin filter is a real server-side query.
   ─────────────────────────────────────────────────────── */
function OriginShelf({ origin }: { origin: OriginType }) {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const { data, isLoading } = useProducts({ origin: origin.key, limit: 12 });
  const products = data?.items ?? [];
  const label = lang === 'en' ? origin.label_en : origin.label_es;

  if (isLoading) {
    return (
      <section>
        <Skeleton className="h-7 w-56 mb-3" />
        <MobileScrollGrid>
          {Array.from({ length: 12 }).map((_, i) => <ProductCardSkeleton key={i} />)}
        </MobileScrollGrid>
      </section>
    );
  }
  if (products.length === 0) return null;

  return (
    <section>
      <SectionHeader
        title={lang === 'en' ? `Flavours of ${label}` : `Sabores de ${label}`}
        subtitle={lang === 'en'
          ? `Products from ${label}`
          : `Productos de ${label}`}
        seeMore={lang === 'en' ? 'See all' : 'Ver todo'}
        onSeeMore={() => navigate(origin.link || `/categories?origin=${origin.key}`)}
      />
      <MobileScrollGrid>
        {products.slice(0, 12).map((p) => <ProductCard key={p.id} product={p} />)}
      </MobileScrollGrid>
    </section>
  );
}

/* ───────────────────────────────────────────────────────
   ALL PRODUCTS — the catalogue, loading as you scroll.

   Closes the homepage: every rail above is a curated slice, this is
   everything. Pages arrive as the sentinel below the grid comes into
   view, so there is no button to hunt for.
   ─────────────────────────────────────────────────────── */
function AllProducts() {
  const { lang } = useLanguageStore();
  const {
    data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteProducts({ limit: 24 });

  // The observer that used to live here moved into <InfiniteScroll/> when the
  // rest of the site dropped its Load-more buttons — this grid was the only
  // list that already scroll-loaded, so it became the shared implementation
  // rather than keeping a second copy of it.
  const products = data?.pages.flatMap((p) => p.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;
  // Six across from lg, matching the New products rail above it and the
  // storefront grid. Was five, which left the two blocks on this page
  // sitting on different column counts.
  const gridCls = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3';

  return (
    <section>
      <SectionHeader
        title={lang === 'en' ? 'All products' : 'Todos los productos'}
        subtitle={
          total > 0
            ? (lang === 'en'
                ? `${total} products in the catalogue`
                : `${total} productos en el catálogo`)
            : undefined
        }
      />

      {isLoading ? (
        <div className={gridCls}>
          {Array.from({ length: 12 }).map((_, i) => <ProductCardSkeleton key={i} />)}
        </div>
      ) : products.length === 0 ? (
        <p className="text-[13px] text-muted font-ui py-6">
          {lang === 'en' ? 'No products yet' : 'Todavía no hay productos'}
        </p>
      ) : (
        <>
          <div className={gridCls}>
            {products.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>

          <InfiniteScroll
            hasMore={!!hasNextPage}
            isLoading={isFetchingNextPage}
            onLoadMore={fetchNextPage}
            // Skeletons rather than a spinner: the next row appears where it
            // will actually land, so the page does not jump.
            skeleton={
              <div className={`${gridCls} mt-3`}>
                {Array.from({ length: 6 }).map((_, i) => <ProductCardSkeleton key={i} />)}
              </div>
            }
          />
        </>
      )}
    </section>
  );
}

/* ───────────────────────────────────────────────────────
   Hidden-section keepalive.

   The four blocks hidden on 2026-07-30 have their render calls commented
   out below, but this project builds with noUnusedLocals, so an orphaned
   component is a hard error rather than a warning. This statement is the
   only thing keeping them compiling. Delete the matching entry if a
   section is ever removed for good, and delete the whole line once every
   commented block is restored.
   ─────────────────────────────────────────────────────── */
void [
  AdsBanner, BRAND_PROMOS, BrandPromoCard, ValueRibbon, EthnicSection, TopShops,
  PriceDrops, CategorySpotlight, OriginShelf, ShopByCategory, Feedback,
];

/* ───────────────────────────────────────────────────────
   HOME PAGE
   ─────────────────────────────────────────────────────── */
export default function HomePage() {
  const { data: categories } = useCategories();
  const { data: sponsoredData } = useSponsoredProducts(12);
  const { data: bannersData } = useBanners();
  // Curated, not inferred. The rail used to read created_at desc, so every
  // product added or imported walked straight onto the home page; an admin
  // now ticks "New product" to put one here.
  const { data: newestData } = useProducts({ newArrival: '1', limit: 12 });
  // Popular has to ask for a sort now. Both rails defaulted to created_at
  // desc, so without this they would be the same twelve products twice.
  const { data: popularData } = useProducts({ limit: 12, sort: 'popular' });

  const banners: Banner[] = bannersData ?? [];
  const sponsored: Product[] = sponsoredData ?? [];
  const cats: Category[] = categories ?? [];
  const newest: Product[] = newestData?.items ?? [];
  const popular: Product[] = popularData?.items ?? [];

  // useFeaturedProducts, useOriginsList and the shelf slices went with the
  // sections hidden on 2026-07-31 — every remaining section reads from the
  // four queries above, so keeping them would have been four requests per
  // page load feeding nothing.

  return (
    <div className="bg-surface-linen">
      <div className="max-w-[1500px] mx-auto px-4 lg:px-6 py-4 flex flex-col gap-3 md:gap-4">

        <HeroCarousel banners={banners} />

        {/* Categories ride directly under the banner on a phone. Desktop keeps
            them in their original slot below, as a titled section. */}
        {cats.length > 0 && <MobileCategoryRail categories={cats} />}

        {/* One row that scrolls sideways, twelve products deep. */}
        {newest.length > 0 && <NewProducts products={newest} />}

        {/* Desktop only — the mobile rail above replaces it, without the
            heading and See-all that a titled section carries. */}
        {cats.length > 0 && (
          <div className="hidden lg:block">
            <FeaturedCategories categories={cats} />
          </div>
        )}

        {/* Promo tiles, admin-editable from Home Sections. Restored above
            Sponsored picks rather than in its old slot under New products, so
            the two paid-placement blocks sit together instead of bracketing
            the categories. */}
        <PromoGrid />

        {/* Was gated on the featured query's loading flag, which no longer
            exists — sponsored has always had its own data. */}
        {sponsored.length > 0 && <SponsoredProducts products={sponsored} />}

        {/* HIDDEN 2026-07-30 — ads banner (wide hero ad + side ad). Restore by
            uncommenting. useAdsBanner and both section components stay defined.
        {!productsLoading && featured.length > 0 && <AdsBanner products={featured} />}
        */}

        {/* Admin-managed brand logo row. Its three hardcoded promo cards stay
            hidden — they were removed separately on 2026-07-30 and are still
            commented out inside the component. */}
        <TopBrands />

        {popular.length > 0 && <PopularProducts products={popular} />}

        {/* HIDDEN 2026-07-30 — "Compra por origen" / "Shop by origin". The
            same content now has its own page at /origins, reachable from the
            Orígenes entry in the category bar, so the homepage rail was a
            second route to one destination. Restore by uncommenting.
        <EthnicSection />
        */}

        {/* HIDDEN 2026-07-30 — Top Shops. Stores have their own page at
            /stores, linked from the category bar. Restore by uncommenting.
        <TopShops />
        */}

        {/* HIDDEN 2026-07-31 — Price drops, the category and origin shelves,
            and the second Shop-by-category block. Restore by uncommenting.
        {!productsLoading && featured.length > 0 && <PriceDrops products={featured} />}
        {spotlightCats.map((c) => <CategorySpotlight key={c.id} category={c} />)}
        {shelfOrigins.map((o) => <OriginShelf key={o.id} origin={o} />)}
        {cats.length > 0 && <ShopByCategory categories={cats} />}
        */}

        {/* Last, and deliberately so — it never stops growing, so anything
            below it would be unreachable in practice. */}
        <AllProducts />

        {/* HIDDEN 2026-07-31 — feedback form. Restore by uncommenting.
        <Feedback />
        */}

        {/* HIDDEN 2026-07-30 — value ribbon (free shipping / 60 min / authentic
            / 4.8 rating). Restore by uncommenting; ValueRibbon stays defined.
        <ValueRibbon />
        */}
      </div>
    </div>
  );
}
