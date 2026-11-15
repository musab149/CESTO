import { useParams, useNavigate, Link } from 'react-router-dom';
import { EMAIL_INPUT_PROPS, lowercaseEmail } from '@/lib/emailField';
import {
  ChevronRight, Truck, ShieldCheck, RotateCcw, Star, Check, Heart, Share2,
  Minus, Plus, ChevronDown, Trash2, ArrowRight, Store, FileText,
  Flag, Loader2,
} from 'lucide-react';
import {
  useProduct, useCategories, resolveImageUrl,
  useTopShops, defaultTopShops, resolveShop, CESTO_SHOP,
  useRelatedProducts,
} from '@grocery-app/shared';
import type { Product, TopShop } from '@grocery-app/shared';
import ProductCard from '@/components/ProductCard';
import { Skeleton } from '@/components/Skeleton';
import { useState, useMemo } from 'react';
import { useLanguageStore } from '@/stores/languageStore';
import { useCartWords } from '@/lib/homeGroceryShopper';
import { useCartStore } from '@/stores/cartStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import {
  useReviewsFor, useWriteReview, useDeleteMyReview, useReportReview,
  type Review, type ReviewReportReason,
} from '@/lib/reviews';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/components/Toast';
import QuantityField from '@/components/QuantityField';
import LoadFailed from '@/components/LoadFailed';
import { isNotFound } from '@grocery-app/shared';
import { cappedMessage } from '@/lib/quantityMessages';
import { usePreviewModeStore } from '@/stores/previewModeStore';
import { X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';
import { usePriceTone, useIsB2bPricing } from '@/lib/priceTone';
import QuotationRequestModal from '@/components/QuotationRequestModal';
import { logoPlate } from '@/lib/logoPlate';

/* ───────────────────────────────────────────────────────
   Reusable atoms
   ─────────────────────────────────────────────────────── */

function formatShopCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K+`;
  }
  return `${n}+`;
}

function isHexBgDark(hex: string): boolean {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return false;
  // perceived luminance — darker than ~0.5 needs a light icon
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
}

function ProductShopCard({ shop, lang }: { shop: TopShop; lang: 'en' | 'es' }) {
  // Cesto's logo is a web-app static asset, not an API-hosted upload, so it
  // bypasses resolveImageUrl (which would prefix it with the API base URL).
  const logoSrc = shop.logo_url
    ? shop.id === CESTO_SHOP.id ? shop.logo_url : resolveImageUrl(shop.logo_url, 'logo')
    : null;
  const iconColor = isHexBgDark(shop.logo_bg) ? 'text-white/85' : 'text-ink/55';

  // Non-Cesto partner shops become clickable and route to their storefront.
  const isPartner = shop.id !== CESTO_SHOP.id;
  const Wrapper = isPartner ? Link : 'div';
  const wrapperProps = isPartner
    ? { to: `/stores/${shop.id}`, 'aria-label': lang === 'en' ? `Visit ${shop.name}` : `Ir a ${shop.name}` }
    : {};
  const interactive = isPartner
    ? 'hover:border-brand/50 hover:shadow-card transition-all'
    : '';

  return (
    <Wrapper
      {...(wrapperProps as any)}
      className={`flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-3 ${interactive}`}
    >
      <div
        className={`${logoPlate(shop.logo_bg).className} w-[64px] h-[64px] rounded-xl flex items-center justify-center overflow-hidden shrink-0`}
        style={logoPlate(shop.logo_bg).style}
      >
        {logoSrc ? (
          <img
            src={logoSrc}
            alt={shop.name}
            className="w-full h-full object-contain scale-[1.35]"
            draggable={false}
          />
        ) : (
          <Store size={26} strokeWidth={1.75} className={iconColor} />
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <h3 className="font-ui text-[14px] font-bold text-ink leading-tight tracking-tight line-clamp-1">
          {shop.name}
        </h3>

        {shop.rating_count > 0 && (
          <div className="flex items-center gap-1.5 text-[12px] font-ui leading-none">
            <Star size={12} strokeWidth={2} className="text-warning fill-warning" />
            <span className="font-bold text-ink tabular-nums">{shop.rating.toFixed(1)}</span>
            <span className="text-muted tabular-nums">({formatShopCount(shop.rating_count)})</span>
          </div>
        )}

        {shop.fast_delivery && (
          <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-success font-ui">
            <Truck size={12} strokeWidth={2} />
            {lang === 'en' ? 'Fast Delivery' : 'Envío rápido'}
          </p>
        )}
      </div>

      {isPartner && (
        <ChevronRight size={18} strokeWidth={2} className="text-muted shrink-0" />
      )}
    </Wrapper>
  );
}

function PriceTag({ value, color }: { value: number; color: string }) {
  const [whole, cents] = value.toFixed(2).split('.');
  return (
    <span className={`${color} font-extrabold font-ui leading-none`}>
      <span className="text-[16px] align-top mr-0.5">€</span>
      <span className="text-[34px]">{whole}</span>
      <span className="text-[16px] align-top">.{cents}</span>
    </span>
  );
}

function StarRow({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => {
        const filled = i + 1 <= Math.round(rating);
        return (
          <Star
            key={i}
            size={size}
            strokeWidth={1.5}
            className={filled ? 'text-amber-deep fill-amber-deep' : 'text-border'}
          />
        );
      })}
    </div>
  );
}

/* ───────────────────────────────────────────────────────
   PAGE
   ─────────────────────────────────────────────────────── */
export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const { lang, t } = useLanguageStore();

  const priceTone = usePriceTone();
  const isB2b = useIsB2bPricing();
  // "Añadir a la lista" for a Home Grocery household — see useCartWords.
  const cartWords = useCartWords();

  const { data: product, isLoading, error: productError, refetch: refetchProduct, isFetching: fetchingProduct } = useProduct(productId);
  const { data: categories } = useCategories();
  const { data: shopsData } = useTopShops();
  const category = categories?.find((c) => c.id === product?.category_id);
  const shops = (shopsData ?? defaultTopShops).shops;
  // Prefer the store relation surfaced by the API (real Store table). Fall
  // back to the legacy TopShops JSON lookup so pre-migration payloads still
  // resolve during the deploy window. See feedback_deploy-shape-skew.
  const productShop: TopShop | null = product
    ? product.store
      ? {
          id: product.store.slug,
          name: product.store.name,
          logo_url: product.store.logo_url,
          logo_bg: product.store.logo_bg,
          cover_url: null,
          rating: 0,
          rating_count: 0,
          product_count: 0,
          fast_delivery: false,
          link: `/stores/${product.store.slug}`,
          display_order: 0,
          is_active: true,
        }
      : resolveShop(product.shop_id, shops)
    : null;

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [qty, setQty] = useState(1);
  const [openSpecs, setOpenSpecs] = useState(true);
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);

  const addItem = useCartStore((s) => s.addItem);
  const removeItem = useCartStore((s) => s.removeItem);
  const isFavorite = useFavoritesStore((s) => productId ? s.productIds.includes(productId) : false);
  const toggleFavorite = useFavoritesStore((s) => s.toggle);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isPreview = usePreviewModeStore((s) => s.isPartnerPreview);
  const pageToast = useToast();
  const cartQty = useCartStore((s) => s.getQuantity(selectedVariantId
    ?? product?.variants?.find((v) => v.is_default)?.id
    ?? product?.variants?.[0]?.id
    ?? ''));
  const inCart = cartQty > 0;

  const variant = product?.variants?.find((v) => v.id === selectedVariantId)
    ?? product?.variants?.find((v) => v.is_default)
    ?? product?.variants?.[0];
  const images = product?.images ?? [];
  const hasDiscount = variant?.compare_at_price != null;
  const discountPct = hasDiscount
    ? Math.round((1 - variant!.price / variant!.compare_at_price!) * 100)
    : 0;
  const isLowStock = !!variant && variant.stock_quantity > 0 && variant.stock_quantity <= variant.low_stock_threshold;
  const isOutOfStock = variant?.stock_quantity === 0;
  // A Home Grocery household's order is never parked as a draft — short stock
  // refuses it — so for them there is no "order it, ships when restocked".
  const hgSoldOut = isOutOfStock && cartWords.shopper;
  // Backorder quantity cap — there's no live stock number to bound against
  // while out of stock, so use a modest fixed default instead of leaving
  // the stepper unbounded.
  const BACKORDER_QTY_CAP = 10;
  const qtyStepperMax = isOutOfStock ? BACKORDER_QTY_CAP : (variant?.stock_quantity ?? 1);

  const productName = product ? (lang === 'en' ? product.name_en : product.name_es) : '';

  /** The browser's share sheet where there is one, else the link on the clipboard. */
  async function shareProduct() {
    const url = window.location.href;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: productName, url });
      } catch {
        // Closing the sheet is an answer, not a failure.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      pageToast.success(lang === 'en' ? 'Link copied' : 'Enlace copiado');
    } catch {
      pageToast.error(lang === 'en' ? 'Unable to share right now' : 'No se pudo compartir');
    }
  }
  const description = product ? (lang === 'en' ? product.description_en : product.description_es) : '';
  const variantName = (v: { name_en: string; name_es: string }) => (lang === 'en' ? v.name_en : v.name_es);
  const catName = (c: { name_en: string; name_es: string }) => (lang === 'en' ? c.name_en : c.name_es);

  // Verified-purchase reviews from the API. Stats come from the server so they
  // cover every visible review, not just the page that has loaded.
  const { reviews, stats: ratingMeta } = useReviewsFor(product?.id);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  /**
   * Genuinely related products, from the server.
   *
   * This used to be the FEATURED list with the current product filtered out —
   * the same six items under every product in the catalogue. The endpoint
   * ranks properly: the same product in another shop first (on a multi-vendor
   * catalogue that is the most useful row on the page), then the nearest
   * taxonomy. See api/src/lib/relatedProducts.ts.
   */
  const { data: relatedData } = useRelatedProducts(product?.id, 12);
  const related = relatedData?.items ?? [];
  // Twelve are fetched so the second row can hold DIFFERENT products. It used
  // to show the same six reversed, which is padding rather than content.
  const relatedProducts = related.slice(0, 6);
  const moreRelated = related.slice(6, 12);

  /* ── Loading ── */
  if (isLoading) {
    return (
      <div className="bg-surface-linen min-h-full">
        <div className="max-w-[1500px] mx-auto px-4 lg:px-6 py-6">
          <Skeleton className="h-5 w-64 mb-6" />
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
            <div className="grid grid-cols-[80px_1fr] gap-3">
              <div className="flex flex-col gap-2">
                {Array.from({ length: 4 }).map((_, i) => (<Skeleton key={i} className="aspect-square !rounded-lg" />))}
              </div>
              <Skeleton className="aspect-square !rounded-lg" />
            </div>
            <Skeleton className="h-[520px] !rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  /* ── Could not load (not the same as not found) ── */
  if (!product && !isNotFound(productError)) {
    return (
      <LoadFailed
        lang={lang}
        title={lang === 'en' ? "We couldn't load this product" : 'No hemos podido cargar este producto'}
        onRetry={() => { void refetchProduct(); }}
        retrying={fetchingProduct}
        secondary={
          <button type="button" onClick={() => navigate('/')} className="min-h-[52px] px-6 rounded-xl border-2 border-border bg-surface-white text-ink font-display font-semibold text-sm inline-flex items-center hover:border-brand transition-colors">
            {t('detail.back_home')}
          </button>
        }
      />
    );
  }

  /* ── Not found ── */
  if (!product) {
    return (
      <div className="bg-surface-linen min-h-full">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-20 flex flex-col items-center">
          <span className="text-6xl mb-6">😕</span>
          <h2 className="text-2xl font-bold text-ink font-display mb-2">{t('detail.not_found')}</h2>
          <p className="text-sm text-gray font-body mb-6">{t('detail.not_found_desc')}</p>
          <button onClick={() => navigate('/')} className="h-11 px-6 bg-brand text-white rounded-full font-bold font-ui hover:bg-brand-deepest transition-colors">
            {t('detail.back_home')}
          </button>
        </div>
      </div>
    );
  }

  function handleAddToCart() {
    if (!variant) return;
    addItem(product!.id, variant.id, qty);
  }

  return (
    <div className="bg-surface-linen min-h-full">
      <div className="max-w-[1500px] mx-auto px-4 lg:px-6 py-5 flex flex-col gap-8">

        {/* ── Breadcrumb ────────────────────────────── */}
        <nav className="flex items-center gap-1.5 text-[12px] font-ui tracking-tight text-muted">
          <button onClick={() => navigate('/')} className="hover:text-ink transition-colors">{t('common.home')}</button>
          <ChevronRight size={12} strokeWidth={2} className="text-border" />
          <button onClick={() => navigate('/categories')} className="hover:text-ink transition-colors">{t('common.categories')}</button>
          {category && (
            <>
              <ChevronRight size={12} strokeWidth={2} className="text-border" />
              <button onClick={() => navigate(`/categories?cat=${category.id}`)} className="hover:text-ink transition-colors">{catName(category)}</button>
            </>
          )}
          <ChevronRight size={12} strokeWidth={2} className="text-border" />
          <span className="text-ink font-semibold truncate max-w-[300px]">{productName}</span>
        </nav>

        {/* ════════════════════════════════════════════
            HERO — 3 columns: gallery | info | buy box
            ════════════════════════════════════════════ */}
        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)_minmax(0,320px)] gap-6 items-start">

          {/* ───── LEFT COLUMN: Gallery (sticky).
              Mobile: main image on top, horizontal thumb strip below (users
              expect the big image first). md+: vertical thumb strip left of
              main image. ───── */}
          <div className="flex flex-col-reverse gap-3 md:grid md:grid-cols-[72px_minmax(0,1fr)] lg:sticky lg:top-[88px] self-start">

            {/* Thumbnail strip — horizontal on mobile, vertical on md+ */}
            <div className="flex flex-row md:flex-col gap-2 max-h-[420px] overflow-x-auto md:overflow-x-visible md:overflow-y-auto hide-scrollbar">
              {images.length > 0
                ? images.map((img, i) => (
                    <button
                      key={i}
                      onMouseEnter={() => setActiveImage(i)}
                      onClick={() => setActiveImage(i)}
                      className={`photo-well aspect-square w-16 md:w-full shrink-0 rounded-md border-2 overflow-hidden bg-card transition-all ${
                        i === activeImage ? 'border-brand' : 'border-border/60 hover:border-brand/40'
                      }`}
                    >
                      <img src={resolveImageUrl(img.url, 'thumb')} alt="" className="w-full h-full object-contain p-1" />
                    </button>
                  ))
                : (
                  <div className="aspect-square w-16 md:w-full rounded-md bg-card border border-border/60 flex items-center justify-center text-[22px] opacity-30">🛒</div>
                )}
            </div>

            {/* Main image */}
            <div className="photo-well relative aspect-square w-full bg-card rounded-lg overflow-hidden border border-border/60 self-start">
              {hasDiscount && (
                <span className="absolute top-3 left-3 z-10 bg-danger text-white text-[11px] font-extrabold font-ui px-2 py-1 rounded uppercase tracking-wider">
                  −{discountPct}%
                </span>
              )}
              <button
                onClick={() => {
                  if (!product) return;
                  if (!isAuthenticated) {
                    pageToast.info(
                      lang === 'en' ? 'Sign in required' : 'Inicia sesión',
                      lang === 'en' ? 'Log in to save items to your favourites.' : 'Inicia sesión para guardar artículos en tus favoritos.',
                    );
                    navigate('/login', { state: { from: `/products/${product.id}` } });
                    return;
                  }
                  toggleFavorite(product.id);
                }}
                aria-pressed={isFavorite}
                className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-card border border-border/60 shadow-card flex items-center justify-center hover:bg-surface-cream"
                aria-label={
                  isFavorite
                    ? (lang === 'en' ? 'Remove from favourites' : 'Quitar de favoritos')
                    : (lang === 'en' ? 'Add to favourites' : 'Añadir a favoritos')
                }
              >
                <Heart
                  size={15}
                  strokeWidth={1.75}
                  className={`${isFavorite ? 'text-danger fill-danger' : 'text-ink/55 hover:text-danger'} transition-colors`}
                />
              </button>
              {images[activeImage] ? (
                <img
                  src={resolveImageUrl(images[activeImage].url, 'hero')}
                  alt={productName}
                  className="absolute inset-0 w-full h-full object-contain p-6"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-[64px] opacity-20">🛒</div>
              )}
            </div>
          </div>

          {/* ───── MIDDLE COLUMN: Product info ───── */}
          <div className="flex flex-col gap-4">
            {product.brand && (
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand">
                {product.brand}
              </span>
            )}
            <h1 className="font-display text-[19px] md:text-[22px] text-ink leading-[1.2] tracking-tight" style={{ fontWeight: 600 }}>
              {productName}
            </h1>

            {/* Rating + share */}
            <div className="flex items-center gap-2 flex-wrap">
              <StarRow rating={ratingMeta.count > 0 ? ratingMeta.rating : 0} size={15} />
              {ratingMeta.count > 0 ? (
                <>
                  <span className="text-[13px] font-bold text-ink">{ratingMeta.rating.toFixed(1)}</span>
                  <a href="#reviews" className="text-[12.5px] text-brand font-ui hover:underline underline-offset-2">
                    ({ratingMeta.count} {t('detail.reviews')})
                  </a>
                </>
              ) : (
                <button
                  onClick={() => setReviewModalOpen(true)}
                  className="text-[12.5px] text-brand font-ui hover:underline underline-offset-2"
                >
                  {lang === 'en' ? 'Be the first to review' : 'Sé el primero en opinar'}
                </button>
              )}
              <span className="text-[12.5px] text-muted">·</span>
              <button type="button" onClick={() => void shareProduct()} className="inline-flex items-center gap-1 text-[12.5px] text-muted font-ui hover:text-brand">
                <Share2 size={12} strokeWidth={2} />
                {lang === 'en' ? 'Share' : 'Compartir'}
              </button>
            </div>

            {/* Hassle-free returns + bestseller chips */}
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-success-bg text-success text-[11.5px] font-bold font-ui">
                <Check size={12} strokeWidth={2.5} />
                {lang === 'en' ? 'Hassle-free returns' : 'Devoluciones fáciles'}
              </span>
              {product.is_featured && (
                <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-brand text-white text-[11px] font-bold font-ui uppercase tracking-wide">
                  {lang === 'en' ? 'Bestseller' : 'Top'}
                </span>
              )}
              {product.origin && (
                <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-card border border-border/60 text-[11.5px] font-semibold font-ui text-ink/70">
                  🌍 {product.origin}
                </span>
              )}
            </div>

            {/* Item type + details meta */}
            {category && (
              <p className="text-[12.5px] text-ink/70 font-ui leading-relaxed">
                <span className="font-bold text-ink">{lang === 'en' ? 'Category' : 'Categoría'}: </span>
                {catName(category)}
                {variant && (
                  <>
                    {' · '}
                    <span className="font-bold text-ink">{lang === 'en' ? 'Item type' : 'Tipo'}: </span>
                    {variantName(variant)}
                  </>
                )}
                {variant?.sku && (
                  <>
                    {' · '}
                    <span className="font-bold text-ink">SKU: </span>
                    <span className="font-mono">{variant.sku}</span>
                  </>
                )}
              </p>
            )}

            {/* Variant selector */}
            {product.variants && product.variants.length > 1 && (
              <div className="pt-1">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[12px] font-bold font-ui text-ink">
                    {t('detail.size_variant')}:{' '}
                    <span className="font-semibold text-ink/70">{variant ? variantName(variant) : ''}</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {product.variants.map((v) => {
                    const selected = v.id === variant?.id;
                    // Out-of-stock variants stay selectable — a backorder is
                    // still a valid purchase, it just ends up as a draft
                    // order. Muted styling signals it, disabling doesn't.
                    const out = v.stock_quantity === 0;
                    return (
                      <button
                        key={v.id}
                        onClick={() => setSelectedVariantId(v.id)}
                        className={`relative inline-flex flex-col items-start gap-0.5 px-3.5 py-2 rounded-xl border-2 transition-all text-left min-w-[110px] ${
                          selected
                            ? 'border-brand bg-brand-mist/40'
                            : out
                              ? 'border-border/40 bg-card opacity-70 hover:border-brand/40'
                              : 'border-border bg-card hover:border-brand/40'
                        }`}
                      >
                        <span className="text-[12.5px] font-bold font-ui text-ink leading-none">
                          {variantName(v)}
                        </span>
                        <span className={`text-[11.5px] font-semibold font-ui ${priceTone} leading-none`}>
                          €{v.price.toFixed(2)}
                        </span>
                        {out && (
                          <span className="text-[10px] font-bold font-ui text-muted leading-none mt-0.5">
                            {t('product.out_of_stock')}
                          </span>
                        )}
                        {selected && (
                          <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-brand text-white flex items-center justify-center">
                            <Check size={10} strokeWidth={3} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Description */}
            <div className="pt-3 border-t border-border/60">
              <h3 className="font-display text-[15px] text-ink tracking-tight mb-2" style={{ fontWeight: 700 }}>
                {t('detail.description')}
              </h3>
              <p className="text-[13.5px] text-ink/80 font-body leading-relaxed">
                {description || (lang === 'en' ? 'No description available for this product.' : 'No hay descripción disponible para este producto.')}
              </p>
            </div>

            {/* Specifications — sits right under description */}
            <div className="pt-3 border-t border-border/60">
              <button
                onClick={() => setOpenSpecs(!openSpecs)}
                className="w-full flex items-center justify-between text-left mb-3"
              >
                <h3 className="font-display text-[15px] text-ink tracking-tight" style={{ fontWeight: 700 }}>
                  {lang === 'en' ? 'Specifications' : 'Especificaciones'}
                </h3>
                <ChevronDown size={15} className={`text-ink/60 transition-transform ${openSpecs ? 'rotate-180' : ''}`} />
              </button>
              {openSpecs && (
                <dl className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-8 text-[13px] font-ui">
                  {product.brand && (
                    <div className="flex justify-between gap-4 border-b border-border/40 py-1.5">
                      <dt className="text-muted">{lang === 'en' ? 'Brand' : 'Marca'}</dt>
                      <dd className="text-ink font-semibold">{product.brand}</dd>
                    </div>
                  )}
                  {product.origin && (
                    <div className="flex justify-between gap-4 border-b border-border/40 py-1.5">
                      <dt className="text-muted">{t('detail.origin')}</dt>
                      <dd className="text-ink font-semibold">{product.origin}</dd>
                    </div>
                  )}
                  {category && (
                    <div className="flex justify-between gap-4 border-b border-border/40 py-1.5">
                      <dt className="text-muted">{lang === 'en' ? 'Category' : 'Categoría'}</dt>
                      <dd className="text-ink font-semibold">{catName(category)}</dd>
                    </div>
                  )}
                  {variant && (
                    <div className="flex justify-between gap-4 border-b border-border/40 py-1.5">
                      <dt className="text-muted">{lang === 'en' ? 'Selected size' : 'Tamaño seleccionado'}</dt>
                      <dd className="text-ink font-semibold">{variantName(variant)}</dd>
                    </div>
                  )}
                  {variant?.sku && (
                    <div className="flex justify-between gap-4 border-b border-border/40 py-1.5">
                      <dt className="text-muted">SKU</dt>
                      <dd className="text-ink font-semibold font-mono">{variant.sku}</dd>
                    </div>
                  )}
                  {product.variants && (
                    <div className="flex justify-between gap-4 border-b border-border/40 py-1.5">
                      <dt className="text-muted">{lang === 'en' ? 'Variants' : 'Variantes'}</dt>
                      <dd className="text-ink font-semibold">{product.variants.length}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
          </div>

          {/* RIGHT — Sticky buy box */}
          <aside className="lg:sticky lg:top-[88px] lg:self-start">
            <div className="bg-card border border-border/60 rounded-lg p-5 flex flex-col gap-4">

              {/* Price — swapped for a neutral placeholder in Partner Preview
                  so the buy box still has a top row but reads as "no price". */}
              {isPreview ? (
                <div className="flex flex-col gap-1">
                  <span className="text-muted/60 font-ui font-bold text-[28px] leading-none">— — —</span>
                  <span className="text-[11px] font-body text-muted uppercase tracking-[0.14em]">
                    Price hidden in preview
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    {hasDiscount && (
                      <span className={`text-[13px] font-extrabold ${priceTone} font-ui leading-none`}>
                        {lang === 'en' ? 'Now' : 'Ahora'}
                      </span>
                    )}
                    {/* Retail keeps its rule that only a discounted price is
                        coloured. Wholesale always colours: the point of the
                        blue is to say which catalogue this number came from,
                        which is true whether or not it is also on offer. */}
                    <PriceTag
                      value={variant?.price ?? 0}
                      color={isB2b ? priceTone : hasDiscount ? 'text-success' : 'text-ink'}
                    />
                  </div>
                  {hasDiscount && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] text-muted line-through font-ui">€{variant!.compare_at_price!.toFixed(2)}</span>
                      <span className="text-[11px] font-bold text-danger font-ui">
                        −{discountPct}%
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Stock status — out of stock is still orderable (backorder /
                  draft order), so this pairs the label with an explanation
                  rather than reading like a dead end. */}
              {isOutOfStock ? (
                <div className="flex flex-col gap-1">
                  <span className="inline-flex items-center gap-2 text-[12px] font-bold text-muted font-ui">
                    {t('product.out_of_stock')}
                  </span>
                  <p className="text-[12px] text-ink/70 font-body leading-snug bg-surface-cream rounded-lg px-2.5 py-1.5">
                    {t('product.out_of_stock_note')}
                  </p>
                </div>
              ) : isLowStock ? (
                <span className="inline-flex items-center gap-2 text-[12px] font-bold text-amber-deep font-ui">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-deep" />
                  {t('product.low_stock')} — {variant?.stock_quantity} {t('detail.low_stock_left')}
                </span>
              ) : variant ? (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-success font-ui">
                  <Check size={12} strokeWidth={3} />
                  {t('detail.in_stock')}
                </span>
              ) : null}

              {/* Currently selected variant — compact summary */}
              {variant && product.variants && product.variants.length > 1 && (
                <div className="flex items-center justify-between bg-surface-cream rounded-lg px-3 py-2">
                  <span className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink/60">
                    {t('detail.size_variant')}
                  </span>
                  <span className="text-[13px] font-bold font-ui text-ink">{variantName(variant)}</span>
                </div>
              )}

              {/* Quantity + Add to cart — suppressed in Partner Preview.
                  Stays visible when out of stock: the item is still
                  orderable, it just lands as a draft order until restocked.
                  Quantity is capped at a modest default (not live stock,
                  since there isn't any) rather than left unbounded. */}
              {variant && !isPreview && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink/65">
                      {lang === 'en' ? 'Quantity' : 'Cantidad'}
                    </p>
                    <div className="inline-flex items-center h-9 rounded-full border border-border bg-card overflow-hidden">
                      <button
                        onClick={() => setQty((q) => Math.max(1, q - 1))}
                        className="w-9 h-full flex items-center justify-center hover:bg-surface-cream"
                        aria-label="decrease"
                      >
                        <Minus size={13} strokeWidth={2.5} />
                      </button>
                      <QuantityField
                        value={qty}
                        max={qtyStepperMax}
                        onChange={setQty}
                        onCapped={(n) => { const m = cappedMessage(lang, n); pageToast.warning(m.title, m.body); }}
                        label={lang === 'en' ? 'Quantity' : 'Cantidad'}
                        className="px-2 text-[13px] font-bold font-mono min-w-[36px]"
                      />
                      <button
                        onClick={() => setQty((q) => Math.min(qtyStepperMax, q + 1))}
                        disabled={qty >= qtyStepperMax}
                        className={`w-9 h-full flex items-center justify-center ${qty >= qtyStepperMax ? 'opacity-30 cursor-not-allowed' : 'hover:bg-surface-cream'}`}
                        aria-label="increase"
                      >
                        <Plus size={13} strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>
                  {inCart ? (
                    <button
                      onClick={() => variant && removeItem(variant.id)}
                      className="h-12 w-full rounded-full bg-danger-bg border border-danger text-danger text-[14px] font-bold font-ui hover:bg-danger hover:text-white transition-colors inline-flex items-center justify-center gap-2"
                    >
                      <Trash2 size={15} strokeWidth={2.25} />
                      {cartWords.shopper
                        ? (lang === 'en' ? `Remove from list · ${cartQty}` : `Quitar de la lista · ${cartQty}`)
                        : lang === 'en'
                          ? `Remove from cart · ${cartQty}`
                          : `Quitar del carrito · ${cartQty}`}
                    </button>
                  ) : (
                    <button
                      onClick={handleAddToCart}
                      disabled={hgSoldOut}
                      className="h-12 w-full rounded-full bg-brand text-white text-[14px] font-bold font-ui hover:bg-brand-deepest transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Plus size={16} strokeWidth={2.5} />
                      {hgSoldOut
                        ? (lang === 'en' ? 'Out of stock' : 'Agotado')
                        : isOutOfStock ? t('product.preorder') : cartWords.add}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (!inCart && variant && !hgSoldOut) addItem(product!.id, variant.id, qty);
                      navigate('/cart');
                    }}
                    className={`h-11 w-full rounded-full text-[13px] font-bold font-ui transition-colors inline-flex items-center justify-center gap-2 ${
                      inCart
                        ? 'bg-brand text-white hover:bg-brand-deepest'
                        : 'bg-card border border-brand text-brand hover:bg-brand hover:text-white'
                    }`}
                  >
                    {lang === 'en' ? 'Buy now' : 'Comprar ahora'}
                    {inCart && <ArrowRight size={14} strokeWidth={2.5} />}
                  </button>
                </div>
              )}

              {/* Request quotation — admin-curated per product, no auth
                  required. Same visitor gets the same flow whether logged
                  in or not. */}
              {product.is_quotation_enabled && (
                <button
                  onClick={() => setQuoteModalOpen(true)}
                  className="h-11 w-full rounded-full border border-brand text-brand bg-card text-[13px] font-bold font-ui hover:bg-brand hover:text-white transition-colors inline-flex items-center justify-center gap-2"
                >
                  <FileText size={15} strokeWidth={2} />
                  Get Quotation
                </button>
              )}

              {/* How it reaches them. There was a Delivery / Pickup switch here,
                  with "ready in 2 hours" and a fixed Madrid postcode: nothing in
                  the checkout or the API offers pickup, so it chose nothing. */}
              <div className="pt-3 border-t border-border/60">
                <div className="text-[12px] font-ui text-ink/75 flex items-start gap-2">
                  <Truck size={13} strokeWidth={1.75} className="text-brand mt-0.5 shrink-0" />
                  <span>{lang === 'en' ? 'Delivered to your address' : 'Entrega en tu dirección'}</span>
                </div>
              </div>

              {/* Trust strip */}
              <div className="grid grid-cols-3 gap-1.5 pt-3 border-t border-border/60">
                {[
                  // "Secure pay" implied an online payment this app has never
                  // taken; every order is paid at the door. The free-delivery
                  // tile went on 2026-09-25 with the feature.
                  { icon: RotateCcw, label_en: 'Easy returns', label_es: 'Devoluciones' },
                  { icon: ShieldCheck, label_en: 'Pay on delivery', label_es: 'Pago al recibir' },
                ].map((it, i) => (
                  <div key={i} className="flex flex-col items-center gap-1 text-center">
                    <it.icon size={15} strokeWidth={1.75} className="text-ink/55" />
                    <span className="text-[10px] font-bold font-ui text-ink/65 uppercase tracking-wide leading-tight">
                      {lang === 'en' ? it.label_en : it.label_es}
                    </span>
                  </div>
                ))}
              </div>

              {/* Shop card — who sells this product */}
              {productShop && (
                <ProductShopCard shop={productShop} lang={lang} />
              )}
            </div>
          </aside>
        </section>


        {/* ════════════════════════════════════════════
            YOU MIGHT ALSO LIKE
            ════════════════════════════════════════════ */}
        {relatedProducts.length > 0 && (
          <RelatedRow
            title={lang === 'en' ? 'You might also like' : 'Quizás también te guste'}
            products={relatedProducts}
          />
        )}

        {/* ════════════════════════════════════════════
            CUSTOMER REVIEWS
            ════════════════════════════════════════════ */}
        <section id="reviews">
          <h2 className="font-display text-[22px] md:text-[26px] text-ink tracking-tight mb-5" style={{ fontWeight: 600 }}>
            {lang === 'en' ? 'Customer ratings & reviews' : 'Valoraciones y opiniones'}
          </h2>
          <ReviewsSection
            meta={ratingMeta}
            reviews={reviews}
            onWrite={() => setReviewModalOpen(true)}
          />
        </section>

        {/* ════════════════════════════════════════════
            RELATED — second row of products
            ════════════════════════════════════════════ */}
        {moreRelated.length > 0 && (
          <RelatedRow
            title={lang === 'en' ? 'Products related to this item' : 'Productos relacionados'}
            products={moreRelated}
          />
        )}

      </div>

      {/* ════════════════════════════════════════════
          REVIEW FORM — modal
          ════════════════════════════════════════════ */}
      {reviewModalOpen && (
        <ReviewFormModal
          productId={product.id}
          productName={productName}
          onClose={() => setReviewModalOpen(false)}
        />
      )}

      {/* ════════════════════════════════════════════
          QUOTATION REQUEST — modal
          ════════════════════════════════════════════ */}
      <QuotationRequestModal
        open={quoteModalOpen}
        onClose={() => setQuoteModalOpen(false)}
        product={{ id: product.id, name: productName }}
        initialQuantity={qty}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */
function RelatedRow({ title, products }: { title: string; products: Product[] }) {
  return (
    <section>
      <h2 className="font-display text-[22px] md:text-[26px] text-ink tracking-tight mb-3" style={{ fontWeight: 600 }}>
        {title}
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {products.slice(0, 6).map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────── */
/** Reasons offered when reporting a review. Mirrors the API enum and the
 *  mobile list — a customer who reports on one surface and then the other
 *  should not be asked a different question. */
const REPORT_REASONS: { key: ReviewReportReason; en: string; es: string }[] = [
  { key: 'spam',                en: 'Spam or advertising',       es: 'Spam o publicidad' },
  { key: 'offensive',           en: 'Offensive or hateful',      es: 'Ofensiva o de odio' },
  { key: 'off_topic',           en: 'Not about this product',    es: 'No trata de este producto' },
  { key: 'personal_info',       en: 'Contains personal details', es: 'Contiene datos personales' },
  { key: 'not_a_real_purchase', en: 'Looks fake',                es: 'Parece falsa' },
];

function ReviewsSection({
  meta, reviews, onWrite,
}: {
  meta: { rating: number; count: number; dist: number[] };
  reviews: Review[];
  onWrite: () => void;
}) {
  const { lang } = useLanguageStore();
  const deleteMine = useDeleteMyReview();
  const reportReview = useReportReview();
  const toast = useToast();
  const [showAll, setShowAll] = useState(false);
  const [reportTarget, setReportTarget] = useState<Review | null>(null);

  const distMax = Math.max(...meta.dist, 1);
  const visible = showAll ? reviews : reviews.slice(0, 3);

  function formatDate(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return iso.slice(0, 10);
    }
  }

  function onReport(reason: ReviewReportReason) {
    const r = reportTarget;
    if (!r || !reason) return;
    reportReview.mutate(
      { productId: r.productId, reviewId: r.id, payload: { reason } },
      {
        onSuccess: () => {
          setReportTarget(null);
          toast.success(
            lang === 'en' ? 'Report sent' : 'Reporte enviado',
            lang === 'en'
              ? 'Thanks — we will take a look. Nothing is hidden automatically.'
              : 'Gracias, lo revisaremos. Nada se oculta automáticamente.',
          );
        },
        onError: () => {
          setReportTarget(null);
          toast.error(
            lang === 'en' ? 'Could not send the report' : 'No se pudo enviar el reporte',
          );
        },
      },
    );
  }

  function onDelete(r: Review) {
    deleteMine.mutate(r.productId);
    toast.success(
      lang === 'en' ? 'Review deleted' : 'Reseña eliminada',
      lang === 'en' ? 'Your review has been removed.' : 'Tu reseña ha sido eliminada.'
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-6">

      {/* Left — summary */}
      <div className="bg-card border border-border/60 rounded-lg p-5">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted">
          {lang === 'en' ? 'Overall' : 'En conjunto'}
        </p>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="font-display text-[44px] text-ink leading-none" style={{ fontWeight: 600 }}>
            {meta.count > 0 ? meta.rating.toFixed(1) : '—'}
          </span>
          <span className="text-[14px] text-muted font-ui">/ 5</span>
        </div>
        <StarRow rating={meta.count > 0 ? meta.rating : 0} size={16} />
        <p className="text-[12px] text-muted font-ui mt-1">
          {meta.count > 0
            ? `${meta.count} ${lang === 'en' ? (meta.count === 1 ? 'review' : 'reviews') : (meta.count === 1 ? 'reseña' : 'reseñas')}`
            : (lang === 'en' ? 'No reviews yet' : 'Aún sin reseñas')}
        </p>

        <div className="flex flex-col gap-1.5 mt-5">
          {[5, 4, 3, 2, 1].map((stars) => {
            const value = meta.dist[stars - 1] ?? 0;
            const pct = meta.count > 0 ? Math.round((value / distMax) * 100) : 0;
            return (
              <div key={stars} className="flex items-center gap-2">
                <span className="text-[11px] font-mono tabular-nums text-ink/70 w-7">{stars}★</span>
                <div className="flex-1 h-2 rounded-full bg-surface-sand overflow-hidden">
                  <div className="h-full bg-amber-deep transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[11px] font-mono tabular-nums text-muted w-9 text-right">{value}</span>
              </div>
            );
          })}
        </div>

        <button
          onClick={onWrite}
          className="mt-5 w-full h-10 rounded-full bg-brand text-white text-[12.5px] font-bold font-ui hover:bg-brand-deepest transition-colors"
        >
          {lang === 'en' ? 'Write a review' : 'Escribir una reseña'}
        </button>
      </div>

      {/* Right — review list / empty state */}
      <div className="flex flex-col gap-3">
        {reviews.length === 0 ? (
          <div className="bg-card border border-border/60 rounded-lg p-10 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-surface-cream border border-border/60 flex items-center justify-center mb-4 text-[28px]">
              ✍️
            </div>
            <h3 className="font-display text-[18px] text-ink tracking-tight mb-1" style={{ fontWeight: 600 }}>
              {lang === 'en' ? 'No reviews yet' : 'Aún no hay reseñas'}
            </h3>
            <p className="text-[13px] text-muted font-ui mb-5 max-w-sm">
              {lang === 'en'
                ? 'Be the first to share what you think — your review helps other shoppers find what they love.'
                : 'Sé el primero en compartir tu opinión — tu reseña ayuda a otros compradores.'}
            </p>
            <button
              onClick={onWrite}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-brand text-white text-[12.5px] font-bold font-ui hover:bg-brand-deepest transition-colors"
            >
              {lang === 'en' ? 'Write the first review' : 'Escribir la primera reseña'}
              <ArrowRight size={13} strokeWidth={2.5} />
            </button>
          </div>
        ) : (
          <>
            {visible.map((r) => (
              <div key={r.id} className="bg-card border border-border/60 rounded-lg p-5 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-brand-mist flex items-center justify-center text-[13px] font-bold text-brand-ink font-ui shrink-0">
                    {r.initials}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold text-ink font-ui leading-none inline-flex items-center gap-2">
                      {r.name}
                      {r.owned && (
                        <span className="inline-flex items-center text-[9.5px] font-extrabold tracking-wide uppercase bg-brand-mist text-brand-ink px-1.5 py-0.5 rounded">
                          {lang === 'en' ? 'You' : 'Tú'}
                        </span>
                      )}
                    </p>
                    <p className="text-[11.5px] text-muted font-ui mt-1">
                      {formatDate(r.createdAt)}
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    <StarRow rating={r.rating} size={12} />
                    {r.owned ? (
                      <button
                        onClick={() => onDelete(r)}
                        className="text-[11px] font-ui font-bold text-muted hover:text-danger transition-colors"
                      >
                        {lang === 'en' ? 'Delete' : 'Eliminar'}
                      </button>
                    ) : (
                      <button
                        onClick={() => setReportTarget(r)}
                        title={lang === 'en' ? 'Report this review' : 'Reportar esta reseña'}
                        className="inline-flex items-center gap-1 text-[11px] font-ui font-bold text-muted hover:text-danger transition-colors"
                      >
                        <Flag size={11} strokeWidth={2} />
                        {lang === 'en' ? 'Report' : 'Reportar'}
                      </button>
                    )}
                  </div>
                </div>
                {r.title && (
                  <h4 className="font-display text-[15px] text-ink leading-snug tracking-tight" style={{ fontWeight: 600 }}>
                    {r.title}
                  </h4>
                )}
                <p className="text-[13px] text-ink/80 font-body leading-relaxed whitespace-pre-line">
                  {r.body}
                </p>
              </div>
            ))}
            {reviews.length > 3 && (
              <button
                onClick={() => setShowAll(!showAll)}
                className="self-start inline-flex items-center gap-2 h-10 px-5 rounded-full bg-card border border-border text-ink text-[12.5px] font-bold font-ui hover:border-brand/40 transition-colors"
              >
                {showAll
                  ? (lang === 'en' ? 'Show less' : 'Mostrar menos')
                  : (lang === 'en' ? `View all ${reviews.length} reviews` : `Ver las ${reviews.length} reseñas`)}
                <ChevronRight size={13} strokeWidth={2.5} className={showAll ? 'rotate-180' : ''} />
              </button>
            )}
          </>
        )}
      </div>

      {reportTarget && (
        <ReportReviewModal
          review={reportTarget}
          lang={lang}
          busy={reportReview.isPending}
          onClose={() => setReportTarget(null)}
          onPick={onReport}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */
/**
 * Asks for a reason rather than firing on the click. A bare Report leaves a
 * moderator with a flagged row and no idea what to look for, and the extra
 * step catches a misclick.
 */
function ReportReviewModal({
  review, lang, busy, onClose, onPick,
}: {
  review: Review;
  lang: string;
  busy: boolean;
  onClose: () => void;
  onPick: (reason: ReviewReportReason) => void;
}) {
  const [reason, setReason] = useState<ReviewReportReason | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-modal w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold font-display text-ink">
          {lang === 'en' ? 'Report this review' : 'Reportar esta reseña'}
        </h2>
        <p className="text-sm text-muted font-body mt-1">
          {lang === 'en'
            ? `Tell us what is wrong with ${review.name}'s review. Someone will read it — nothing is hidden automatically.`
            : `Cuéntanos qué le pasa a la reseña de ${review.name}. Alguien la revisará; nada se oculta automáticamente.`}
        </p>
        {/* Pick first, send second — matching the app. Firing on the click
            left no way back from a mis-click and nowhere to show progress. */}
        <div className="mt-4 space-y-2">
          {REPORT_REASONS.map((r) => {
            const on = reason === r.key;
            return (
              <button
                key={r.key}
                type="button"
                disabled={busy}
                onClick={() => setReason(r.key)}
                className={`w-full flex items-center gap-2 text-left min-h-[52px] px-4 rounded-xl border text-sm font-semibold transition disabled:opacity-50 ${
                  on
                    ? 'bg-brand-mist border-brand text-brand-ink'
                    : 'bg-surface-cream border-border text-ink hover:border-brand hover:bg-brand-mist/30'
                }`}
              >
                <span className="flex-1">{lang === 'en' ? r.en : r.es}</span>
                {on && <Check size={16} strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-3 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-11 px-5 rounded-xl text-sm font-semibold border-2 border-border text-gray hover:bg-surface-linen disabled:opacity-50"
          >
            {lang === 'en' ? 'Cancel' : 'Cancelar'}
          </button>
          <button
            type="button"
            onClick={() => reason && onPick(reason)}
            disabled={!reason || busy}
            className="h-11 px-5 rounded-xl text-sm font-semibold bg-danger text-white hover:bg-danger/90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {lang === 'en' ? 'Send report' : 'Enviar reporte'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewFormModal({
  productId, productName, onClose,
}: {
  productId: string;
  productName: string;
  onClose: () => void;
}) {
  const { lang } = useLanguageStore();
  const writeReview = useWriteReview();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const messages = useValidationMessages();

  const [hoverRating, setHoverRating] = useState(0);

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      rating: z.number().min(1, messages.required).max(5),
      name:   r.name({ min: 2, max: 80 }),
      // Email + city are optional on a product review.
      email:  z.string().trim().refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: messages.email }).optional().or(z.literal('')),
      city:   z.string().trim().max(80, messages.tooLong(80)).optional().or(z.literal('')),
      title:  z.string().trim().max(80, messages.tooLong(80)).optional().or(z.literal('')),
      body:   z.string().trim().min(10, messages.tooShort(10)).max(1000, messages.tooLong(1000)),
    });
  }, [messages]);

  type ReviewFormData = z.infer<typeof schema>;

  const {
    register, handleSubmit, watch, setValue,
    formState: { errors, isSubmitting },
  } = useForm<ReviewFormData>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: {
      rating: 0,
      name: user?.name ?? '',
      email: user?.email ?? '',
      city: '',
      title: '',
      body: '',
    },
  });

  const rating = watch('rating');
  const setRating = (v: number) => setValue('rating', v, { shouldValidate: true });

  const onSubmit = async (values: ReviewFormData) => {
    // The server upserts on (product, user), so posting again edits in place.
    await writeReview.mutateAsync({
      productId,
      payload: {
        rating: values.rating,
        title: values.title?.trim() || null,
        body: values.body,
      },
    });
    toast.success(
      lang === 'en' ? 'Review posted' : 'Reseña publicada',
      lang === 'en' ? 'Thanks for sharing your thoughts.' : 'Gracias por compartir tu opinión.',
    );
    onClose();
  };

  const inputCls = 'w-full h-11 px-3.5 rounded-xl border border-border bg-card text-[13px] font-ui text-ink placeholder:text-muted focus:outline-none focus:border-brand transition-colors';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-veil/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card rounded-lg border border-border/60 shadow-modal w-full max-w-[560px] max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
          <div>
            <h3 className="font-display text-[20px] text-ink tracking-tight" style={{ fontWeight: 600 }}>
              {lang === 'en' ? 'Write a review' : 'Escribir una reseña'}
            </h3>
            <p className="text-[12.5px] text-muted font-ui mt-1 line-clamp-1">
              {productName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-linen transition-colors shrink-0"
            aria-label={lang === 'en' ? 'Close' : 'Cerrar'}
          >
            <X size={16} strokeWidth={2} className="text-ink/55" />
          </button>
        </div>

        <div className="h-px bg-border/60" />

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="px-6 py-5 flex flex-col gap-4">

          {/* Rating */}
          <div className="flex flex-col gap-2">
            <label className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink/65">
              {lang === 'en' ? 'Your rating' : 'Tu valoración'}
              <span className="text-danger ml-0.5">*</span>
            </label>
            <div className="flex items-center gap-2" onMouseLeave={() => setHoverRating(0)}>
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
                      size={24}
                      strokeWidth={1.5}
                      className={filled ? 'text-amber-deep fill-amber-deep' : 'text-border'}
                    />
                  </button>
                );
              })}
              {rating > 0 && (
                <span className="ml-2 text-[12.5px] font-bold text-ink font-ui">
                  {rating} / 5
                </span>
              )}
            </div>
          </div>

          {/* Rating error */}
          {errors.rating?.message && (
            <p role="alert" className="-mt-2 text-[11.5px] text-danger font-ui font-medium">
              {lang === 'en' ? 'Please pick a rating from 1 to 5 stars.' : 'Elige una valoración de 1 a 5 estrellas.'}
            </p>
          )}

          {/* Name + City */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink/65 mb-1.5">
                {lang === 'en' ? 'Your name' : 'Tu nombre'}
                <span className="text-danger ml-0.5">*</span>
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
              <label className="block text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink/65 mb-1.5">
                {lang === 'en' ? 'City' : 'Ciudad'}
              </label>
              <input
                type="text"
                placeholder={lang === 'en' ? 'e.g. Madrid' : 'p. ej. Madrid'}
                aria-invalid={errors.city ? true : undefined}
                className={`${inputCls} ${errors.city ? 'border-danger focus:border-danger' : ''}`}
                {...register('city')}
              />
              {errors.city?.message && (
                <p role="alert" className="mt-1 text-[11.5px] text-danger font-ui font-medium">{errors.city.message}</p>
              )}
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink/65 mb-1.5">
              {lang === 'en' ? 'Email' : 'Correo'}{' '}
              <span className="text-muted font-medium normal-case tracking-normal">{lang === 'en' ? '(kept private)' : '(privado)'}</span>
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

          {/* Title */}
          <div>
            <label className="block text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink/65 mb-1.5">
              {lang === 'en' ? 'Headline' : 'Título'}
            </label>
            <input
              type="text"
              placeholder={lang === 'en' ? 'Sum it up in a few words' : 'Resúmelo en pocas palabras'}
              maxLength={80}
              aria-invalid={errors.title ? true : undefined}
              className={`${inputCls} ${errors.title ? 'border-danger focus:border-danger' : ''}`}
              {...register('title')}
            />
            {errors.title?.message && (
              <p role="alert" className="mt-1 text-[11.5px] text-danger font-ui font-medium">{errors.title.message}</p>
            )}
          </div>

          {/* Body */}
          <div>
            <label className="block text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink/65 mb-1.5">
              {lang === 'en' ? 'Your review' : 'Tu reseña'}
              <span className="text-danger ml-0.5">*</span>
            </label>
            <textarea
              rows={5}
              maxLength={1000}
              placeholder={lang === 'en'
                ? 'What did you like? What could be better?'
                : '¿Qué te gustó? ¿Qué podría ser mejor?'}
              aria-invalid={errors.body ? true : undefined}
              className={`w-full p-3 rounded-xl border bg-card text-[13px] font-ui text-ink placeholder:text-muted focus:outline-none transition-colors resize-none ${
                errors.body ? 'border-danger focus:border-danger' : 'border-border focus:border-brand'
              }`}
              {...register('body')}
            />
            <div className="flex items-center justify-between mt-1">
              {errors.body?.message ? (
                <p role="alert" className="text-[11.5px] text-danger font-ui font-medium">{errors.body.message}</p>
              ) : <span />}
              <p className="text-[10.5px] text-muted font-ui">
                {(watch('body') ?? '').length}/1000
              </p>
            </div>
          </div>

          {/* Submit row */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-muted font-ui max-w-[280px] leading-snug">
              {lang === 'en'
                ? 'By submitting you agree to our review guidelines. Inappropriate content will be removed.'
                : 'Al enviar aceptas nuestras normas. El contenido inapropiado será eliminado.'}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="h-10 px-4 rounded-full text-[12.5px] font-bold font-ui text-ink hover:bg-surface-linen transition-colors"
              >
                {lang === 'en' ? 'Cancel' : 'Cancelar'}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="h-10 px-5 rounded-full bg-brand text-white text-[12.5px] font-bold font-ui hover:bg-brand-deepest transition-colors inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting
                  ? (lang === 'en' ? 'Posting…' : 'Publicando…')
                  : (lang === 'en' ? 'Post review' : 'Publicar reseña')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
