/**
 * Server-side defaults for admin-managed home sections.
 *
 * Mirrors `defaultPromoGrid` / `defaultAdsBanner` in @grocery-app/shared.
 * Used by the route handlers to return a sane payload before an admin has
 * saved anything for a given key, and by the seed script to populate a
 * fresh database.
 *
 * Keep in sync with `packages/shared/src/homeSections.ts`. (Duplicated here
 * because the API package cannot import from the shared client bundle.)
 */

export const HOME_SECTION_KEYS = ['promo-grid', 'ads-banner', 'top-brands', 'shop-by-origin', 'top-shops', 'stores-hero'] as const;
export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number];

const ISO_DEFAULT = '2026-01-01T00:00:00Z';

export const defaultPromoGrid = {
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
      background: 'linear-gradient(135deg, #DCE6FD 0%, #F0F4FE 60%, #E9F4DC 100%)',
      image_url: null,
      emoji: null,
      text_theme: 'dark',
      accent_color: null,
      scrim_color: '#000000',
      is_active: true,
      display_order: 1,
    },
    {
      // Was a "Free delivery / on every order over €30" tile, then "the cost
      // shown before you confirm". Neither is true since 2026-10-23: our team
      // sets the fee on each order afterwards and tells the customer.
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

export const defaultAdsBanner = {
  hero: {
    eyebrow_en: 'Sponsored',
    eyebrow_es: 'Patrocinado',
    title_en: 'Big brands, small prices.',
    title_es: 'Grandes marcas, precios bajos.',
    description_en: 'Discover handpicked partner products at exclusive Cesto prices.',
    description_es: 'Descubre productos seleccionados de socios a precios exclusivos en Cesto.',
    cta_en: 'Shop sponsored',
    cta_es: 'Ver patrocinados',
    link: '/categories?sponsored=1',
    background: 'linear-gradient(120deg, #022B91 0%, #054EE8 55%, #2A6AEF 100%)',
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

export const defaultShopByOrigin = {
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

export const defaultTopBrands = {
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

export const defaultTopShops = {
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

export const defaultStoresHero = {
  title_en: 'Stores',
  title_es: 'Tiendas',
  subtitle_en: 'Your favourite local and ethnic stores, just a tap away.',
  subtitle_es: 'Tus tiendas locales y étnicas favoritas, a un toque de distancia.',
  // CSS background — hex, gradient, or any valid CSS `background` value.
  background: 'linear-gradient(135deg, #F0F4FE 0%, #FFFFFF 55%, #DCE6FD 100%)',
  // Optional image layered above the background (cover).
  image_url: null as string | null,
  text_theme: 'dark' as 'dark' | 'light',
  updated_at: ISO_DEFAULT,
};

export function defaultFor(key: HomeSectionKey): Record<string, unknown> {
  if (key === 'promo-grid') return defaultPromoGrid as unknown as Record<string, unknown>;
  if (key === 'ads-banner') return defaultAdsBanner as unknown as Record<string, unknown>;
  if (key === 'top-brands') return defaultTopBrands as unknown as Record<string, unknown>;
  if (key === 'shop-by-origin') return defaultShopByOrigin as unknown as Record<string, unknown>;
  if (key === 'top-shops') return defaultTopShops as unknown as Record<string, unknown>;
  if (key === 'stores-hero') return defaultStoresHero as unknown as Record<string, unknown>;
  throw new Error(`Unknown home section key: ${key}`);
}
