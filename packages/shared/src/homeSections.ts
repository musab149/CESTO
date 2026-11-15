/**
 * Home Sections — admin-configurable content blocks rendered on the customer
 * web home page (PromoGrid + AdsBanner).
 *
 * Storage: a real backend (Postgres via Prisma — see packages/api). Customer
 * apps read from `/api/home-sections/:key`, admin writes through
 * `/api/admin/home-sections/:key`. The customer endpoint always returns a
 * populated payload (the server falls back to baked-in defaults when no row
 * exists).
 *
 * Defaults are also exported below — the web HomePage uses them as the
 * loading-state fallback before the first network response lands.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  homeSectionsService,
  adminHomeSections,
} from './api/services/homeSections';

// ─── Types ────────────────────────────────────────────────────────────────

/** A single tile in the PromoGrid. The grid renders exactly four tiles. */
export interface PromoTile {
  id: string;
  /** `feature` = tall left panel · `wide` = full-width row · `compact` = small square */
  variant: 'feature' | 'wide' | 'compact';
  eyebrow_en: string;
  eyebrow_es: string;
  title_en: string;
  title_es: string;
  /** Optional second line of body copy. Only the feature tile uses it. */
  description_en: string | null;
  description_es: string | null;
  cta_en: string;
  cta_es: string;
  /** Internal route the tile navigates to. */
  link: string;
  /** Any valid CSS `background` value (solid colour, gradient, etc.). */
  background: string;
  /** Pasted URL or `data:` URL from a file pick. Rendered if present. */
  image_url: string | null;
  /** Decorative corner emoji. Retained for legacy payloads; no longer rendered. */
  emoji: string | null;
  /** Light text reads better on dark backgrounds, dark on light. */
  text_theme: 'light' | 'dark';
  /** Optional accent colour for the eyebrow + CTA (else falls back to brand). */
  accent_color: string | null;
  /** Hex colour of the left-side scrim drawn over an uploaded image_url. Defaults to black. */
  scrim_color: string | null;
  is_active: boolean;
  display_order: number;
}

export interface PromoGridConfig {
  tiles: PromoTile[];
  updated_at: string;
}

/** Hero (big sponsored block) + side (small "today only") card. */
export interface AdsBannerSection {
  eyebrow_en: string;
  eyebrow_es: string;
  title_en: string;
  title_es: string;
  description_en: string;
  description_es: string;
  cta_en: string;
  cta_es: string;
  link: string;
  background: string;
  image_url: string | null;
  /** Retained for legacy payloads; no longer rendered. */
  emoji: string | null;
  text_theme: 'light' | 'dark';
  /** Optional accent colour applied to the eyebrow + CTA. */
  accent_color: string | null;
  /** Hex colour of the left-side scrim drawn over an uploaded image_url. */
  scrim_color: string | null;
}

export interface AdsBannerConfig {
  hero: AdsBannerSection;
  side: AdsBannerSection;
  updated_at: string;
}

/** A single brand chip in the customer "Top Brands" row. The customer site
 *  renders only `image_url`; `name` is an admin-side label so the editor and
 *  the filter URL stay legible. Legacy visual fields (`bg_color`, etc.) are
 *  still accepted at the type level so old payloads don't error on read. */
export interface TopBrand {
  /** Display name — used by admin for identification and as the brand filter
   *  value in `link`. Not rendered on the customer site. */
  name: string;
  /** Logo image. URL, server path, or a `data:` blob from the file picker.
   *  This is the only visual the customer sees. */
  image_url: string | null;
  /** Customer-side link when the chip is clicked. */
  link: string;
  is_active: boolean;
  display_order: number;

  /** @deprecated Kept for backward compatibility with previously-saved
   *  payloads. Not rendered. New admin saves drop these fields. */
  bg_color?: string;
  /** @deprecated */
  text_color?: string;
  /** @deprecated */
  tagline?: string | null;
  /** @deprecated */
  border?: boolean;
}

export interface TopBrandsConfig {
  brands: TopBrand[];
  updated_at: string;
}

/** A single "Shop by Origin" card on the customer home. */
export interface OriginCard {
  /** Lowercase slug — matches Product.origin (case-insensitive). */
  key: string;
  label_en: string;
  label_es: string;
  bg_color: string;
  accent_color: string;
  /** Pasted URL, server path, or data URL from the image picker. Null = no image. */
  image_url: string | null;
  /** Where the card navigates to. Usually /categories?origin={key}. */
  link: string;
  is_active: boolean;
  display_order: number;
}

export interface ShopByOriginConfig {
  cards: OriginCard[];
  updated_at: string;
}

/** A single partner shop on the customer "Top Shops" row. */
export interface TopShop {
  id: string;
  name: string;
  /** Pasted URL, server path, or data URL from the image picker. Null = no logo. */
  logo_url: string | null;
  /** Background tint behind the logo on the card. */
  logo_bg: string;
  /** Banner cover image at the top of the card. Null = fall back to the
   *  default green gradient. */
  cover_url: string | null;
  rating: number;
  rating_count: number;
  product_count: number;
  fast_delivery: boolean;
  link: string;
  display_order: number;
  is_active: boolean;
}

export interface TopShopsConfig {
  shops: TopShop[];
  updated_at: string;
}

/**
 * Admin-editable hero panel at the top of the customer /stores page.
 * The customer web renders `background` as the CSS `background` on the panel,
 * layers `image_url` above it (cover), and prints the bilingual title/subtitle.
 */
export interface StoresHeroConfig {
  title_en: string;
  title_es: string;
  subtitle_en: string;
  subtitle_es: string;
  /** Any valid CSS `background` value — hex, gradient, url(), etc. */
  background: string;
  /** Optional overlay image layered above the background. */
  image_url: string | null;
  /** Whether the text is rendered light (over dark bg) or dark. */
  text_theme: 'light' | 'dark';
  updated_at: string;
}

// ─── Defaults — mirror the original hardcoded HomePage copy ───────────────

const ISO_DEFAULT = '2026-01-01T00:00:00Z';

export const defaultPromoGrid: PromoGridConfig = {
  // Every line here has to be something a customer can actually get: this is
  // what shows when nobody has configured the home page, or before the saved
  // grid has loaded. Rashan is Home Grocery now (no packs, no 12 %), delivery is
  // added by our team after the order arrives, and there is no first-order
  // discount or same-day cutoff anywhere in the code.
  tiles: [
    {
      id: 'tile-rashan',
      variant: 'feature',
      eyebrow_en: 'Home Grocery',
      eyebrow_es: 'Compra del hogar',
      title_en: 'Your household grocery, put together by us.',
      title_es: 'La compra de tu casa, preparada por nosotros.',
      description_en: 'Tell us your household and how often. You pay when it arrives.',
      description_es: 'Dinos cuántos sois y cada cuánto. La pagas al recibirla.',
      cta_en: 'Find out more',
      cta_es: 'Descubrir',
      link: '/rashan',
      background:
        'linear-gradient(135deg, #DCE6FD 0%, #F0F4FE 60%, #E9F4DC 100%)',
      image_url: null,
      emoji: null,
      text_theme: 'dark',
      accent_color: null,
      scrim_color: '#000000',
      is_active: true,
      display_order: 1,
    },
    {
      id: 'tile-delivery',
      variant: 'wide',
      eyebrow_en: 'Delivery',
      eyebrow_es: 'Envío',
      title_en: 'We add delivery to your order and let you know',
      title_es: 'Añadimos el envío a tu pedido y te avisamos',
      description_en: null,
      description_es: null,
      cta_en: 'Start shopping',
      cta_es: 'Empezar',
      link: '/categories',
      background: 'linear-gradient(135deg, #FFFFFF 0%, #DCE6FD 100%)',
      image_url: null,
      emoji: null,
      text_theme: 'dark',
      accent_color: null,
      scrim_color: '#000000',
      is_active: true,
      display_order: 2,
    },
    {
      id: 'tile-pay-on-delivery',
      variant: 'compact',
      eyebrow_en: 'Payment',
      eyebrow_es: 'Pago',
      title_en: 'Pay when it arrives: cash or card',
      title_es: 'Paga al recibir: efectivo o tarjeta',
      description_en: null,
      description_es: null,
      cta_en: 'Shop now',
      cta_es: 'Comprar',
      link: '/categories',
      background: 'linear-gradient(135deg, #E9F4DC 0%, #FFFFFF 100%)',
      image_url: null,
      emoji: null,
      text_theme: 'dark',
      accent_color: '#5FA133',
      scrim_color: '#000000',
      is_active: true,
      display_order: 3,
    },
    {
      id: 'tile-track',
      variant: 'compact',
      eyebrow_en: 'Your order',
      eyebrow_es: 'Tu pedido',
      title_en: 'Follow it at every step',
      title_es: 'Síguelo en cada paso',
      description_en: null,
      description_es: null,
      cta_en: 'Shop now',
      cta_es: 'Comprar',
      link: '/categories',
      background: '#0F172A',
      image_url: null,
      emoji: null,
      text_theme: 'light',
      accent_color: '#7FC646',
      scrim_color: '#000000',
      is_active: true,
      display_order: 4,
    },
  ],
  updated_at: ISO_DEFAULT,
};

export const defaultAdsBanner: AdsBannerConfig = {
  hero: {
    eyebrow_en: 'Sponsored',
    eyebrow_es: 'Patrocinado',
    title_en: 'Big brands, small prices.',
    title_es: 'Grandes marcas, precios bajos.',
    description_en:
      'Discover handpicked partner products at exclusive Cesto prices.',
    description_es:
      'Descubre productos seleccionados de socios a precios exclusivos en Cesto.',
    cta_en: 'Shop sponsored',
    cta_es: 'Ver patrocinados',
    link: '/categories?sponsored=1',
    background:
      'linear-gradient(120deg, #022B91 0%, #054EE8 55%, #2A6AEF 100%)',
    image_url: null,
    emoji: null,
    text_theme: 'light',
    accent_color: null,
    scrim_color: '#000000',
  },
  side: {
    eyebrow_en: 'Featured',
    eyebrow_es: 'Destacado',
    title_en: 'Today only',
    title_es: 'Solo hoy',
    description_en: 'A handpicked deal refreshed every 24 hours.',
    description_es: 'Una oferta seleccionada que cambia cada 24 horas.',
    cta_en: 'Shop now',
    cta_es: 'Comprar ahora',
    link: '/categories',
    background: 'linear-gradient(135deg, #FAE4E0 0%, #F2D4CC 100%)',
    image_url: null,
    emoji: null,
    text_theme: 'dark',
    accent_color: null,
    scrim_color: '#000000',
  },
  updated_at: ISO_DEFAULT,
};

/** Rotating background/accent palette for newly-discovered origins that
 *  don't have admin-saved visual config yet. Picked deterministically by
 *  index so the colours stay stable across reloads. */
export const ORIGIN_DEFAULT_PALETTES: { bg: string; accent: string }[] = [
  { bg: '#DDEEC5', accent: '#7BB962' },
  { bg: '#FFE0B6', accent: '#F19543' },
  { bg: '#E5DEFE', accent: '#7E68DF' },
  { bg: '#D5E4FA', accent: '#5588E0' },
  { bg: '#FFD9A5', accent: '#ED9028' },
  { bg: '#FCE3E8', accent: '#D04772' },
  { bg: '#E1F1E1', accent: '#3F9C57' },
];

/** Build a fallback OriginCard for a slug that doesn't yet have saved
 *  visual config. Reuses Cesto's original defaults when the slug matches
 *  (`pakistan`, `india`, etc.) so canonical origins keep familiar colours;
 *  otherwise picks deterministically from ORIGIN_DEFAULT_PALETTES.
 *  Exported so both the customer site and admin editor produce identical
 *  fallbacks. */
export function buildDefaultOriginCard(slug: string, idx: number): OriginCard {
  const lower = slug.toLowerCase();
  const fromDefaults = defaultShopByOrigin?.cards?.find?.(
    (c: OriginCard) => c.key.toLowerCase() === lower,
  );
  if (fromDefaults) {
    return { ...fromDefaults, key: lower, display_order: idx + 1 };
  }
  const palette = ORIGIN_DEFAULT_PALETTES[idx % ORIGIN_DEFAULT_PALETTES.length];
  const label = slug.charAt(0).toUpperCase() + slug.slice(1);
  return {
    key: lower,
    label_en: label,
    label_es: label,
    bg_color: palette.bg,
    accent_color: palette.accent,
    image_url: null,
    link: `/categories?origin=${lower}`,
    is_active: true,
    display_order: idx + 1,
  };
}

export const defaultShopByOrigin: ShopByOriginConfig = {
  cards: [
    { key: 'pakistan',   label_en: 'Pakistan',   label_es: 'Pakistán',  bg_color: '#DDEEC5', accent_color: '#7BB962', image_url: null, link: '/categories?origin=pakistan',   is_active: true, display_order: 1 },
    { key: 'india',      label_en: 'India',      label_es: 'India',     bg_color: '#FFE0B6', accent_color: '#F19543', image_url: null, link: '/categories?origin=india',      is_active: true, display_order: 2 },
    { key: 'bangladesh', label_en: 'Bangladesh', label_es: 'Bangladés', bg_color: '#DDEEC5', accent_color: '#7BB962', image_url: null, link: '/categories?origin=bangladesh', is_active: true, display_order: 3 },
    { key: 'arabic',     label_en: 'Arabic',     label_es: 'Árabe',     bg_color: '#E5DEFE', accent_color: '#7E68DF', image_url: null, link: '/categories?origin=arabic',     is_active: true, display_order: 4 },
    { key: 'latino',     label_en: 'Latino',     label_es: 'Latino',    bg_color: '#D5E4FA', accent_color: '#5588E0', image_url: null, link: '/categories?origin=latino',     is_active: true, display_order: 5 },
    { key: 'africa',     label_en: 'Africa',     label_es: 'África',    bg_color: '#FFD9A5', accent_color: '#ED9028', image_url: null, link: '/categories?origin=africa',     is_active: true, display_order: 6 },
  ],
  updated_at: ISO_DEFAULT,
};

export const defaultTopBrands: TopBrandsConfig = {
  brands: [
    { name: 'Shan',     image_url: null, link: '/categories?brand=Shan',     is_active: true, display_order: 1 },
    { name: 'National', image_url: null, link: '/categories?brand=National', is_active: true, display_order: 2 },
    { name: 'Laziza',   image_url: null, link: '/categories?brand=Laziza',   is_active: true, display_order: 3 },
    { name: 'TRS',      image_url: null, link: '/categories?brand=TRS',      is_active: true, display_order: 4 },
    { name: 'MDH',      image_url: null, link: '/categories?brand=MDH',      is_active: true, display_order: 5 },
    { name: 'Eastern',  image_url: null, link: '/categories?brand=Eastern',  is_active: true, display_order: 6 },
  ],
  updated_at: ISO_DEFAULT,
};

export const defaultTopShops: TopShopsConfig = {
  shops: [
    {
      id: 'wahed-mart',
      name: 'Wahed Mart',
      logo_url: null,
      logo_bg: '#E2ECFE',
      cover_url: null,
      rating: 4.8,
      rating_count: 12500,
      product_count: 15000,
      fast_delivery: true,
      link: '/categories?shop=wahed-mart',
      display_order: 1,
      is_active: true,
    },
  ],
  updated_at: ISO_DEFAULT,
};

/**
 * Virtual "house" shop used as the fallback identity for any product that has
 * no shop_id. Not part of the Top Shops carousel — surfaces only on product
 * cards and the product detail page as "Sold by Cesto Shop".
 */
export const CESTO_SHOP: TopShop = {
  id: 'cesto',
  name: 'Cesto Shop',
  /** Ships as a static asset in the web app's public folder. */
  logo_url: '/cesto-shop-logo.png',
  logo_bg: '#FFFFFF',
  cover_url: null,
  rating: 5.0,
  rating_count: 0,
  product_count: 0,
  fast_delivery: true,
  link: '/categories',
  display_order: 0,
  is_active: true,
};

export const defaultStoresHero: StoresHeroConfig = {
  title_en: 'Stores',
  title_es: 'Tiendas',
  subtitle_en: 'Your favourite local and ethnic stores, just a tap away.',
  subtitle_es: 'Tus tiendas locales y étnicas favoritas, a un toque de distancia.',
  background: 'linear-gradient(135deg, #F0F4FE 0%, #FFFFFF 55%, #DCE6FD 100%)',
  image_url: null,
  text_theme: 'dark',
  updated_at: ISO_DEFAULT,
};

/**
 * Resolve a product's shop_id against the active Top Shops list, falling back
 * to the Cesto Shop virtual identity when the id is null or unknown.
 */
export function resolveShop(shopId: string | null | undefined, shops: TopShop[]): TopShop {
  if (!shopId || shopId === CESTO_SHOP.id) return CESTO_SHOP;
  const match = shops.find((s) => s.id === shopId);
  return match ?? CESTO_SHOP;
}

// ─── React Query hooks ───────────────────────────────────────────────────
//
// Two surfaces:
//   - Customer (`usePromoGrid` / `useAdsBanner`) hits the public endpoint.
//   - Admin write hooks (`useUpdatePromoGrid` / `useResetPromoGrid`, plus the
//     ads-banner equivalents) hit the JWT-guarded admin endpoint and refresh
//     BOTH cache keys so the admin page's preview and any open customer tab
//     stay in sync within the same React Query client.

const PROMO_GRID_KEY = ['home-sections', 'promo-grid'] as const;
const ADS_BANNER_KEY = ['home-sections', 'ads-banner'] as const;
const TOP_BRANDS_KEY = ['home-sections', 'top-brands'] as const;
const SHOP_BY_ORIGIN_KEY = ['home-sections', 'shop-by-origin'] as const;
const ORIGIN_COUNTS_KEY = ['home-sections', 'origin-counts'] as const;
const BRAND_COUNTS_KEY = ['home-sections', 'brand-counts'] as const;
const TOP_SHOPS_KEY = ['home-sections', 'top-shops'] as const;
const STORES_HERO_KEY = ['home-sections', 'stores-hero'] as const;
const ADMIN_PROMO_GRID_KEY = ['admin-home-sections', 'promo-grid'] as const;
const ADMIN_ADS_BANNER_KEY = ['admin-home-sections', 'ads-banner'] as const;
const ADMIN_TOP_BRANDS_KEY = ['admin-home-sections', 'top-brands'] as const;
const ADMIN_SHOP_BY_ORIGIN_KEY = ['admin-home-sections', 'shop-by-origin'] as const;
const ADMIN_TOP_SHOPS_KEY = ['admin-home-sections', 'top-shops'] as const;
const ADMIN_STORES_HERO_KEY = ['admin-home-sections', 'stores-hero'] as const;
const ADMIN_DISCOVERED_BRANDS_KEY = ['admin-discovered-brands'] as const;
const ADMIN_DISCOVERED_ORIGINS_KEY = ['admin-discovered-origins'] as const;

// Customer reads ----------------------------------------------------------

export function usePromoGrid() {
  return useQuery({
    queryKey: PROMO_GRID_KEY,
    queryFn: () => homeSectionsService.promoGrid(),
  });
}

export function useAdsBanner() {
  return useQuery({
    queryKey: ADS_BANNER_KEY,
    queryFn: () => homeSectionsService.adsBanner(),
  });
}

// Admin reads + writes -----------------------------------------------------

export function useAdminPromoGrid() {
  return useQuery({
    queryKey: ADMIN_PROMO_GRID_KEY,
    queryFn: () => adminHomeSections.getPromoGrid(),
  });
}

export function useUpdatePromoGrid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cfg: PromoGridConfig) => adminHomeSections.updatePromoGrid(cfg),
    onSuccess: (cfg) => {
      qc.setQueryData(ADMIN_PROMO_GRID_KEY, cfg);
      qc.setQueryData(PROMO_GRID_KEY, cfg);
    },
  });
}

export function useResetPromoGrid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminHomeSections.resetPromoGrid(),
    onSuccess: (cfg) => {
      qc.setQueryData(ADMIN_PROMO_GRID_KEY, cfg);
      qc.setQueryData(PROMO_GRID_KEY, cfg);
    },
  });
}

export function useAdminAdsBanner() {
  return useQuery({
    queryKey: ADMIN_ADS_BANNER_KEY,
    queryFn: () => adminHomeSections.getAdsBanner(),
  });
}

export function useUpdateAdsBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cfg: AdsBannerConfig) => adminHomeSections.updateAdsBanner(cfg),
    onSuccess: (cfg) => {
      qc.setQueryData(ADMIN_ADS_BANNER_KEY, cfg);
      qc.setQueryData(ADS_BANNER_KEY, cfg);
    },
  });
}

export function useResetAdsBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminHomeSections.resetAdsBanner(),
    onSuccess: (cfg) => {
      qc.setQueryData(ADMIN_ADS_BANNER_KEY, cfg);
      qc.setQueryData(ADS_BANNER_KEY, cfg);
    },
  });
}

// Top Brands --------------------------------------------------------------

export function useTopBrands() {
  return useQuery({
    queryKey: TOP_BRANDS_KEY,
    queryFn: () => homeSectionsService.topBrands(),
  });
}

export function useAdminTopBrands() {
  return useQuery({
    queryKey: ADMIN_TOP_BRANDS_KEY,
    queryFn: () => adminHomeSections.getTopBrands(),
  });
}

export function useUpdateTopBrands() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cfg: TopBrandsConfig) => adminHomeSections.updateTopBrands(cfg),
    onSuccess: (cfg) => {
      qc.setQueryData(ADMIN_TOP_BRANDS_KEY, cfg);
      qc.setQueryData(TOP_BRANDS_KEY, cfg);
    },
  });
}

export function useResetTopBrands() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminHomeSections.resetTopBrands(),
    onSuccess: (cfg) => {
      qc.setQueryData(ADMIN_TOP_BRANDS_KEY, cfg);
      qc.setQueryData(TOP_BRANDS_KEY, cfg);
    },
  });
}

/**
 * Distinct brand names sourced from existing products. Powers the picker in
 * the admin Top Brands editor so admins choose from real catalogue brands.
 */
export function useDiscoveredBrands() {
  return useQuery({
    queryKey: ADMIN_DISCOVERED_BRANDS_KEY,
    queryFn: () => adminHomeSections.discoveredBrands(),
  });
}

// Shop by Origin -----------------------------------------------------------

export function useShopByOrigin() {
  return useQuery({
    queryKey: SHOP_BY_ORIGIN_KEY,
    queryFn: () => homeSectionsService.shopByOrigin(),
  });
}

/**
 * Real-time product counts grouped by origin slug. The Shop by Origin cards
 * use this to show actual stock numbers instead of static placeholders.
 */
export function useOriginCounts() {
  return useQuery({
    queryKey: ORIGIN_COUNTS_KEY,
    queryFn: () => homeSectionsService.originCounts(),
  });
}

/**
 * Real-time product counts grouped by exact brand name. Powers the per-brand
 * count badge on the Brands discovery page.
 */
export function useBrandCounts() {
  return useQuery({
    queryKey: BRAND_COUNTS_KEY,
    queryFn: () => homeSectionsService.brandCounts(),
  });
}

export function useAdminShopByOrigin() {
  return useQuery({
    queryKey: ADMIN_SHOP_BY_ORIGIN_KEY,
    queryFn: () => adminHomeSections.getShopByOrigin(),
  });
}

export function useUpdateShopByOrigin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cfg: ShopByOriginConfig) => adminHomeSections.updateShopByOrigin(cfg),
    onSuccess: (cfg) => {
      qc.setQueryData(ADMIN_SHOP_BY_ORIGIN_KEY, cfg);
      qc.setQueryData(SHOP_BY_ORIGIN_KEY, cfg);
    },
  });
}

export function useResetShopByOrigin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminHomeSections.resetShopByOrigin(),
    onSuccess: (cfg) => {
      qc.setQueryData(ADMIN_SHOP_BY_ORIGIN_KEY, cfg);
      qc.setQueryData(SHOP_BY_ORIGIN_KEY, cfg);
    },
  });
}

/**
 * Distinct origin slugs sourced from existing products — picker source for the
 * admin Shop by Origin editor.
 */
export function useDiscoveredOrigins() {
  return useQuery({
    queryKey: ADMIN_DISCOVERED_ORIGINS_KEY,
    queryFn: () => adminHomeSections.discoveredOrigins(),
  });
}

// Top Shops ----------------------------------------------------------------

export function useTopShops() {
  return useQuery({
    queryKey: TOP_SHOPS_KEY,
    queryFn: () => homeSectionsService.topShops(),
  });
}

export function useAdminTopShops() {
  return useQuery({
    queryKey: ADMIN_TOP_SHOPS_KEY,
    queryFn: () => adminHomeSections.getTopShops(),
  });
}

export function useUpdateTopShops() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cfg: TopShopsConfig) => adminHomeSections.updateTopShops(cfg),
    onSuccess: (cfg) => {
      qc.setQueryData(ADMIN_TOP_SHOPS_KEY, cfg);
      qc.setQueryData(TOP_SHOPS_KEY, cfg);
    },
  });
}

export function useResetTopShops() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminHomeSections.resetTopShops(),
    onSuccess: (cfg) => {
      qc.setQueryData(ADMIN_TOP_SHOPS_KEY, cfg);
      qc.setQueryData(TOP_SHOPS_KEY, cfg);
    },
  });
}

// Stores hero -------------------------------------------------------------

export function useStoresHero() {
  return useQuery({
    queryKey: STORES_HERO_KEY,
    queryFn: () => homeSectionsService.storesHero(),
  });
}

export function useAdminStoresHero() {
  return useQuery({
    queryKey: ADMIN_STORES_HERO_KEY,
    queryFn: () => adminHomeSections.getStoresHero(),
  });
}

export function useUpdateStoresHero() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cfg: StoresHeroConfig) => adminHomeSections.updateStoresHero(cfg),
    onSuccess: (cfg) => {
      qc.setQueryData(ADMIN_STORES_HERO_KEY, cfg);
      qc.setQueryData(STORES_HERO_KEY, cfg);
    },
  });
}

export function useResetStoresHero() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminHomeSections.resetStoresHero(),
    onSuccess: (cfg) => {
      qc.setQueryData(ADMIN_STORES_HERO_KEY, cfg);
      qc.setQueryData(STORES_HERO_KEY, cfg);
    },
  });
}
