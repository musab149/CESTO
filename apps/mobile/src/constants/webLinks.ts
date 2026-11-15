/**
 * Pages that live on the website rather than in the app.
 *
 * The production customer web domain. NOT cesto.es — that host does not
 * resolve at all, and it was the app's "Visit Website" link for a while.
 */
export const WEB_ORIGIN = 'https://www.cestoshop.com';

/**
 * Everything on web's Tier 0 "Cesto Business" strip, in its order: the two
 * trade links, then the join CTA that the strip parks at the right end. Web's
 * own side drawer leads with the CTA destination instead, since a full-width
 * row has no "right end" — the app follows the drawer.
 *
 * The 'suppliers' entry was REMOVED on 2026-09-09: /stores now exists in the
 * app (app/stores.tsx), so sending people to the website for it would be
 * bouncing them out of the app to see something they already have. The two
 * that remain are genuinely web-only — both are application forms.
 *
 * Neither of the two has a screen in this app. There used to be a cut-down
 * wholesale form at /business — one trading address, no multi-shop editor —
 * and it was removed once both entry points pointed at the site: a second,
 * lesser application form competing with the real one is worse than no form.
 *
 * Shared by the side drawer and the profile tab's support section, which
 * listed different things before this existed.
 */
/**
 * Support and legal pages, served from the site so there is one copy of the
 * help centre and the legal text rather than two that drift.
 *
 * There is deliberately no `about` entry: web has no /about route, so the
 * app's own About screen stays in-app. Adding one here would point at the
 * site's not-found.
 *
 * These have in-app equivalents that are still reachable from the side drawer
 * and the forbidden screen — only the profile tab's support section was asked
 * to leave for the site.
 */
export const SUPPORT_URLS = {
  help:    `${WEB_ORIGIN}/help`,
  contact: `${WEB_ORIGIN}/contact`,
  faq:     `${WEB_ORIGIN}/faq`,
  privacy: `${WEB_ORIGIN}/privacy`,
  terms:   `${WEB_ORIGIN}/terms`,
} as const;

export interface BusinessLink {
  /** Stable id — screens key their icon choice off this. */
  key: 'wholesale' | 'supplier';
  url: string;
  label_en: string;
  label_es: string;
  hint_en: string;
  hint_es: string;
}

export const BUSINESS_LINKS: readonly BusinessLink[] = [
  {
    key: 'wholesale',
    // The anchor is web's own: B2bDealsPage scrolls to #register-form on
    // mount, so the visitor lands on the application, not the top of the pitch.
    url: `${WEB_ORIGIN}/b2b-deals#register-form`,
    label_en: 'Wholesale prices', label_es: 'Precios al por mayor',
    hint_en: 'Trade rates for your business',
    hint_es: 'Precios mayoristas para tu negocio',
  },
  {
    key: 'supplier',
    url: `${WEB_ORIGIN}/partner-deals`,
    label_en: 'Become a supplier', label_es: 'Conviértete en proveedor',
    hint_en: 'Sell your products on Cesto',
    hint_es: 'Vende tus productos en Cesto',
  },
] as const;
