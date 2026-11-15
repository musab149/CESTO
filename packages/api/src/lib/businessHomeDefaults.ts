/**
 * What a business sees on its panel's home (2026-10-31, user: "on homepage of
 * b2b we will have the Intro, Promotion, Cesto logistics, Ads banner,
 * Profiles, Upcoming etc. informative content", content "B2B's own, edited
 * in admin", Upcoming = "Announcements from Cesto"). The business's own
 * profile card is drawn from its account, so it has no content here.
 *
 * Stored like App content: one row of `AppSetting` under `business_home`, a
 * generic key/JSON table, so it needs no migration. A read never 404s — an
 * unset key returns these defaults, and a stored value is merged over them
 * section by section, so a section added later cannot break a row saved
 * before it existed.
 *
 * The defaults are deliberately conservative (see appContentDefaults): every
 * sentence below is something the code does today. Delivery days, zones and
 * cut-off times are the team's to write in the admin — none is invented here.
 * Promotions, banners and announcements start empty: an offer nobody made is
 * worse than no offer.
 */

export const BUSINESS_HOME_KEY = 'business_home';

/** The icons a logistics point can carry — the panel knows how to draw each. */
export const LOGISTICS_ICONS = ['truck', 'clock', 'calendar', 'package', 'store', 'map', 'euro', 'receipt', 'phone', 'shield'] as const;
export type LogisticsIcon = (typeof LOGISTICS_ICONS)[number];

/** A tint from the panel's palette, for a tile with no photo — never a raw colour, which dark mode could not repaint. */
export const BUSINESS_HOME_TONES = ['blue', 'green', 'orange', 'violet', 'amber', 'sky'] as const;
export type BusinessHomeTone = (typeof BUSINESS_HOME_TONES)[number];

export const ANNOUNCEMENT_TAGS = ['offer', 'new', 'delivery', 'news'] as const;
export type AnnouncementTag = (typeof ANNOUNCEMENT_TAGS)[number];

export interface BusinessHomeIntro {
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
  cta_es: string;
  cta_en: string;
  /** A panel path (/business/…), a shop path the panel maps (/products/…), or https://… */
  link: string;
  image_url: string | null;
}

export interface BusinessPromotion {
  id: string;
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
  /** A few characters on the photo: "-10%", "Nuevo". */
  badge_es: string;
  badge_en: string;
  image_url: string | null;
  tone: BusinessHomeTone;
  link: string;
  is_active: boolean;
}

export interface LogisticsPoint {
  id: string;
  icon: LogisticsIcon;
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
}

export interface BusinessLogistics {
  is_active: boolean;
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
  points: LogisticsPoint[];
}

/**
 * One banner ad on the home's carousel (2026-10-31): only the image the team
 * uploads (user: "in these banners we will only have the images… that will be
 * uploaded by the admin") — no words of ours over it — and where a tap goes.
 */
export interface BusinessBanner {
  id: string;
  is_active: boolean;
  link: string;
  /** Wide (4:1), for a computer. */
  image_url: string | null;
  /** 16:9, for a phone; the wide one is used when there is none. */
  image_mobile_url: string | null;
}

export interface BusinessAnnouncement {
  id: string;
  /** The day it is about (YYYY-MM-DD) — it leaves the home the day after. Null for one with no date. */
  date: string | null;
  tag: AnnouncementTag;
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
  is_active: boolean;
}

export interface BusinessHomeContent {
  intro: BusinessHomeIntro;
  promotions: BusinessPromotion[];
  logistics: BusinessLogistics;
  banners: BusinessBanner[];
  announcements: BusinessAnnouncement[];
}

export const DEFAULT_BUSINESS_HOME: BusinessHomeContent = {
  intro: {
    title_es: 'Tu proveedor mayorista, en un solo sitio',
    title_en: 'Your wholesale supplier, all in one place',
    body_es: 'Compra a precio de empresa a Cesto y a las tiendas con las que trabajamos, sigue cada pedido y cámbialo mientras se prepara.',
    body_en: 'Buy at business prices from Cesto and the shops we work with, follow every order and change it while it is being prepared.',
    cta_es: 'Crear pedido',
    cta_en: 'Create order',
    link: '/business/catalogue',
    image_url: null,
  },
  promotions: [],
  logistics: {
    is_active: true,
    title_es: 'Logística Cesto',
    title_en: 'Cesto logistics',
    body_es: 'Qué pasa con tu pedido desde que lo creas hasta que llega a tu negocio.',
    body_en: 'What happens to your order from the moment you create it until it reaches your business.',
    points: [
      {
        id: 'shops',
        icon: 'store',
        title_es: 'Una tienda o varias',
        title_en: 'One shop or several',
        body_es: 'Si tu pedido lleva productos de varias tiendas, cada una prepara su parte. Lo sigues todo desde Pedidos.',
        body_en: 'If your order has products from several shops, each one prepares its part. You follow it all from Orders.',
      },
      {
        id: 'changes',
        icon: 'clock',
        title_es: 'Cambios mientras se prepara',
        title_en: 'Changes while it is prepared',
        body_es: 'Puedes cambiar productos, cantidades y la nota mientras el pedido esté pendiente, confirmado o en preparación.',
        body_en: 'You can change products, quantities and the note while the order is pending, confirmed or being prepared.',
      },
      {
        id: 'delivery',
        icon: 'truck',
        title_es: 'Envío',
        title_en: 'Delivery',
        body_es: 'Nuestro equipo fija el coste del envío de cada pedido y te avisamos.',
        body_en: 'Our team sets the delivery cost of each order and lets you know.',
      },
      {
        id: 'prices',
        icon: 'receipt',
        title_es: 'Precio de empresa',
        title_en: 'Business prices',
        body_es: 'Cada precio de tu catálogo es el que pagas por ese producto.',
        body_en: 'Every price in your catalogue is what you pay for that product.',
      },
    ],
  },
  banners: [],
  announcements: [],
};
