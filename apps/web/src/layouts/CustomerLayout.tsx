import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Search, MapPin, User, Globe, Check, LogOut, Moon, Sun,
  ShoppingCart, ShoppingBasket, ClipboardList, HelpCircle, MessageCircle, Heart,
  Menu, X, Home, Store, Tag, Package, ChevronRight, ChevronDown, AlertTriangle, Award, Plus,
} from 'lucide-react';
import NotificationInbox from '@/components/NotificationInbox';
import HopBasket from '@/components/home-grocery/HopBasket';
import { useCartStore } from '@/stores/cartStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { useLanguageStore, type Language } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import Footer from '@/components/Footer';
import FloatingActions from '@/components/FloatingActions';
import MobileTabBar from '@/components/MobileTabBar';
import PricingModeDialog, { type PricingModeSwitch } from '@/components/PricingModeDialog';
import RetailPriceLoginModal from '@/components/RetailPriceLoginModal';
import CartDrawer from '@/components/CartDrawer';
import PartnerPreviewBanner from '@/components/PartnerPreviewBanner';
import AnnouncementModal from '@/components/AnnouncementModal';
import { Skeleton } from '@/components/Skeleton';
import { usePreviewModeStore } from '@/stores/previewModeStore';
import { useCartWords } from '@/lib/homeGroceryShopper';
import { useApplyShopTheme, useShopTheme } from '@/lib/shopTheme';
import type { ShopThemeChoice } from '@/stores/shopThemeStore';
import { useCartUiStore } from '@/stores/cartUiStore';
import { useLocationStore } from '@/stores/locationStore';
import { useState, useRef, useEffect } from 'react';
import {
  useCategories, useSubcategories, useCategoryProducts, resolveImageUrl,
  useStoreSettings, useSetPricingMode, useMyHomeGrocery, HOME_GROCERY_PATH, HOME_GROCERY_PROFILE_PATH,
} from '@grocery-app/shared';

/**
 * Street line out of a geocoded address.
 *
 * Google returns "Calle Mayor 12, 28013 Madrid, España" — everything from the
 * postcode onward is already captured in its own fields, so keeping it would
 * put the postcode and city in the street line as well. Cuts at the postcode
 * and falls back to the whole string when the shape is unexpected, since a
 * prefilled field the customer can edit beats an empty one.
 */
function streetFromFormatted(formatted: string | undefined, postcode: string): string {
  if (!formatted) return '';
  const at = formatted.indexOf(postcode);
  // at === 0 means the geocoder resolved no street — a rooftop-less result
  // reads "28013 Madrid, España". Leave the field empty rather than seeding
  // it with the postcode and city the form collects separately.
  if (at === 0) return '';
  const head = at > 0 ? formatted.slice(0, at) : formatted;
  return head.replace(/[,\s]+$/, '').trim();
}

const languages: { code: Language; label: string; flag: string }[] = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
];

/* ───────────────────────────────────────────────────────
   Walmart-style two-tier blue navbar
   - Tier 1 (brand): logo · location · search · account · cart
   - Tier 2 (brand-mid): departments + quick category links
   ─────────────────────────────────────────────────────── */
export default function CustomerLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  // Light, dark or the device's, on <html> while the shop is open (lib/shopTheme).
  const theme = useShopTheme();
  useApplyShopTheme(theme.resolved);
  const itemCount = useCartStore((s) => s.getItemCount());
  const favoritesCount = useFavoritesStore((s) => s.productIds.length);
  const { lang, setLang, t } = useLanguageStore();
  const { data: settings } = useStoreSettings();
  const maintenance = settings?.maintenanceMode === true;
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useAuthStore((s) => s.logout);
  const hydrateAuth = useAuthStore((s) => s.hydrate);

  // Price-mode toggle. Three things have to finish before the switch is real:
  // the POST, the catalogue caches refetching (awaited inside the mutation),
  // and re-hydrating auth so `user.pricing_mode` flips the toggle's own active
  // state (authStore is separate from React Query). Driven through a dialog
  // because the whole sequence takes seconds, and a disabled toggle is not a
  // way to tell someone their catalogue is being repriced.
  const pricingModeMut = useSetPricingMode();
  const [priceSwitch, setPriceSwitch] = useState<PricingModeSwitch | null>(null);
  const setPricingMode = async (mode: 'retail' | 'b2b') => {
    setPriceSwitch({ mode, phase: 'working' });
    try {
      await pricingModeMut.mutateAsync(mode);
      await hydrateAuth();
      setPriceSwitch({ mode, phase: 'done' });
    } catch {
      setPriceSwitch({ mode, phase: 'error' });
    }
  };

  // Regular prices only exist on a separate customer account, so a business
  // account can't switch to them in place — "Regular" opens a prompt to log
  // out and sign in as a customer instead of flipping pricing_mode.
  const [retailLoginPromptOpen, setRetailLoginPromptOpen] = useState(false);
  const handlePricingModeSelect = (mode: 'retail' | 'b2b') => {
    if (mode === 'retail') { setRetailLoginPromptOpen(true); return; }
    void setPricingMode(mode);
  };
  const confirmRetailLogin = () => {
    setRetailLoginPromptOpen(false);
    logout();
    navigate('/login');
  };

  const [langOpen, setLangOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
      // Attribute rather than ref: the picker renders in two places (desktop
      // navbar, mobile category bar) and a ref can only point at one of them.
      if (!(e.target as HTMLElement).closest?.('[data-loc-picker]')) setLocOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close drawer whenever the route changes, and lock body scroll while open.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname, location.search]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  const handleLogout = () => {
    logout();
    setUserOpen(false);
    navigate('/');
  };

  const location$ = useLocationStore((s) => s.location);
  const locationStatus = useLocationStore((s) => s.status);
  const requestLocation = useLocationStore((s) => s.requestLocation);
  // No browse scope any more. The catalogue used to be narrowed by delivery
  // area and then by country, and changing either had to invalidate every
  // catalogue query by hand — the scope travelled as a request header, so it
  // changed no React Query key and nothing refetched on its own. Both scopes
  // are gone: every customer sees every live store, so there is nothing to
  // invalidate and no picker to drive it.

  // Header picker. Two unrelated things share this dropdown, which is why
  // it still exists after delivery areas were removed:
  //   · the country scope, the only thing that still filters the catalogue
  //   · detecting the customer's position to pre-fill the address form
  // Neither one restricts what can be ordered.
  const [locOpen, setLocOpen] = useState(false);

  const chooseDetected = async () => {
    await requestLocation({ force: true }).catch(() => { /* store records the error */ });
    setLocOpen(false);
  };

  // Partner Preview — hides prices/checkout/cart across the customer chrome.
  // See stores/previewModeStore.ts + components/PartnerPreviewBanner.tsx.
  const isPreview = usePreviewModeStore((s) => s.isPartnerPreview);
  // An approved Home Grocery household gets a door to its plan in the
  // account menus ("Mi compra del hogar").
  const { data: myHomeGrocery } = useMyHomeGrocery({ enabled: isAuthenticated && !isPreview });
  const isHomeGrocery = !!myHomeGrocery?.subscriber;

  // Kick off geolocation once when the layout mounts. requestLocation()
  // itself no-ops if a value is already persisted, so it's safe on refresh.
  useEffect(() => {
    requestLocation().catch(() => {
      /* store already recorded the error; ignore here */
    });
  }, [requestLocation]);

  // "Your area", not "Deliver to". The pill names where we think the customer
  // is so they can turn it into a saved address in one tap — it does not scope
  // the catalogue and must not imply a delivery boundary, because there is
  // none: every live store delivers everywhere.
  const locationPillLine1 = lang === 'en' ? 'Your area' : 'Tu zona';
  const locationPillLine2 = location$
    ? `${location$.city ?? 'Madrid'} · ${location$.postcode || '—'}`
    : locationStatus === 'requesting'
      ? (lang === 'en' ? 'Locating…' : 'Localizando…')
      : (lang === 'en' ? 'Set your location' : 'Elegir ubicación');

  const openCart = useCartUiStore((s) => s.open);
  // A Home Grocery household's cart is its grocery list — see useCartWords.
  const cartWords = useCartWords();
  const handleCartClick = () => {
    // Cart contents are local state, so the drawer can render for guests too.
    // Authentication is only enforced at checkout (inside the drawer).
    openCart();
  };

  const initials = user?.name.split(' ').map((n) => n[0]).join('').toUpperCase() ?? '';
  const currentLang = languages.find((l) => l.code === lang)!;

  // Clicking the logo on the homepage used to do nothing: navigate('/') from
  // '/' is a no-op, and ScrollToTop only fires on a pathname change. With the
  // infinite All-products grid at the foot, "back to the top" is now the whole
  // point of that click — scroll it ourselves when the route will not change.
  const goHome = () => {
    if (location.pathname === '/') {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    } else {
      navigate('/');
    }
  };

  // Secondary nav — anchor links + the first N live categories from the API
  const { data: categories } = useCategories();
  /** `hop`: lead with the hopping basket (HopBasket) instead of an emoji. */
  type NavLink = { label_es: string; label_en: string; to: string; emoji?: string; highlight?: boolean; hop?: boolean };
  const fixedNav: NavLink[] = [
    { label_es: 'Categorías',         label_en: 'Categories',     to: '/categories' },
    { label_es: 'Tiendas',            label_en: 'Stores',         to: '/stores' },
    { label_es: 'Orígenes',           label_en: 'Origins',        to: '/origins' },
    { label_es: 'Marcas',             label_en: 'Brands',         to: '/brands' },
    { label_es: 'Compra del hogar',   label_en: 'Home Grocery',   to: '/rashan', hop: true, highlight: true },
    { label_es: 'Producto Bio',       label_en: 'Bio Product',    to: '/bio', highlight: true },
    // Account shortcuts. Both routes are behind auth — a signed-out visitor
    // gets the login screen rather than a dead end, which is the same
    // behaviour as reaching them from the account menu.
    { label_es: 'Añadir dirección',   label_en: 'Add Address',    to: '/addresses' },
    { label_es: 'Mis Pedidos',        label_en: 'My Orders',      to: '/orders' },
    { label_es: 'Favoritos',          label_en: 'Favourites',     to: '/favorites' },
  ];
  // Tier 0 — the dark B2B utility strip above the blue navbar. Separate from
  // fixedNav because these are the trade-side funnels, not shopping links:
  // two of them lead to lead-capture forms rather than catalogue pages.
  // "Cesto Business" is NOT in this list: it labels the strip rather than
  // linking anywhere. The destinations share one class set; the join CTA is
  // deliberately separate too, sitting at the right end as a filled button.
  const tradeNav: { label_es: string; label_en: string; to: string }[] = [
    { label_es: 'Conviértete en proveedor',       label_en: 'Become a supplier',     to: '/partner-deals' },
    { label_es: 'Explora proveedores destacados', label_en: 'Explore top suppliers', to: '/stores' },
  ];

  // Every category, not a top-N slice. The row is already an overflow-x
  // scroller, so the cap only decided which categories were reachable from
  // the bar at all — and the five it kept were whichever the API happened to
  // sort first, which is not a shortlist anyone chose.
  const categoryNavCats = categories ?? [];
  // My Orders moved up beside Bio Product, so the tail is empty. Kept as a
  // list rather than deleted — the render below still maps it, and something
  // else may want to sit after the category pills.
  const tailNav: NavLink[] = [];

  // Two variants:
  //   labelled — pill with "Deliver to / Madrid · 28001" in the blue top bar
  //              (desktop, md+)
  //   row      — full-width band under that bar (mobile). The pin used to be
  //              a 36px icon squeezed into the top row beside hamburger, logo,
  //              search, cart and account, where it read as another icon
  //              button and said nothing about the address it held. As its own
  //              row it has space for the question and the answer.
  const renderLocationPicker = (variant: 'labelled' | 'row') => {
    const isRow = variant === 'row';
    return (
    <div className={`relative ${isRow ? '' : 'shrink-0'}`} data-loc-picker>
          <button
            onClick={() => setLocOpen((v) => !v)}
            aria-expanded={locOpen}
            aria-haspopup="dialog"
            className={`flex items-center transition-colors ${
              isRow
                ? 'w-full gap-2.5 h-[44px] px-3 sm:px-4 active:bg-white/10'
                : 'gap-2 h-11 px-3 rounded-full bg-white/10 hover:bg-white/15 max-w-[220px]'
            }`}
            title={`${locationPillLine1} ${locationPillLine2}`}
            aria-label={`${lang === 'en' ? 'Choose where you are shopping' : 'Elegir dónde estás comprando'} — ${locationPillLine2}`}
          >
            <div className={`rounded-full bg-white/15 flex items-center justify-center shrink-0 ${isRow ? 'w-8 h-8' : 'w-7 h-7'}`}>
              <MapPin size={isRow ? 16 : 13} strokeWidth={2.25} className="text-white" />
            </div>

            {isRow ? (
              <>
                {/* Question on the left, current answer on the right — the
                    label stops being a caption stacked over the value and
                    becomes the prompt it actually is. */}
                <span className="text-[13.5px] font-bold text-white font-ui whitespace-nowrap">
                  {locationPillLine1}
                </span>
                <span className="ml-auto flex items-center gap-1 min-w-0">
                  <span className="text-[13px] font-semibold text-white/90 truncate font-ui">
                    {locationPillLine2}
                  </span>
                  <ChevronDown
                    size={16}
                    strokeWidth={2.25}
                    className={`text-white shrink-0 transition-transform ${locOpen ? 'rotate-180' : ''}`}
                  />
                </span>
              </>
            ) : (
              <div className="flex flex-col items-start min-w-0 leading-tight">
                <span className="text-[10.5px] font-bold text-white/85 font-ui">
                  {locationPillLine1}
                </span>
                <span className="text-[12px] font-semibold text-white truncate font-ui">
                  {locationPillLine2}
                </span>
              </div>
            )}
          </button>

          {locOpen && (
            <div
              role="dialog"
              aria-label={lang === 'en' ? 'Shopping location' : 'Ubicación de compra'}
              // Mobile pins the panel to the viewport rather than the trigger:
              // the row spans the full width, so an absolutely-positioned panel
              // would inherit that width and its own inset would fight the
              // page gutter. Fixed, inset 12px both sides, clearing the sticky
              // header — 60px search row plus the 44px location row it hangs
              // from, 72px from sm.
              className={`z-50 rounded-xl bg-surface-cream border border-border shadow-modal p-3 ${
                isRow
                  ? 'fixed inset-x-3 top-[112px] sm:top-[124px]'
                  : 'absolute left-0 top-[calc(100%+8px)] w-[calc(100vw-24px)] max-w-[300px]'
              }`}
            >
              {/* One control. This panel used to carry a delivery area
                  (postcode, "all areas", a postcode field) and then a country
                  scope, both of which narrowed the catalogue. Neither exists:
                  every customer sees every live store. What is left only
                  pre-fills the address form, so the copy says "address" and
                  never "delivery area" — it must not read as a coverage
                  check. */}
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted font-ui px-1 mb-2">
                {lang === 'en' ? 'Your address' : 'Tu dirección'}
              </p>

              <button
                type="button"
                onClick={chooseDetected}
                className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-surface-linen transition-colors"
              >
                <span className="flex items-center gap-2 text-[13px] font-semibold font-ui text-ink">
                  <MapPin size={14} strokeWidth={2} className="text-brand shrink-0" />
                  {lang === 'en' ? 'Use my location' : 'Usar mi ubicación'}
                </span>
                <span className="block text-[11.5px] text-muted font-body mt-0.5 pl-[22px]">
                  {locationStatus === 'requesting'
                    ? (lang === 'en' ? 'Locating…' : 'Localizando…')
                    : location$
                      ? `${location$.city ?? ''} ${location$.postcode ?? ''}`.trim()
                      : (lang === 'en' ? 'Detect where I am' : 'Detectar dónde estoy')}
                </span>
              </button>

              {/* Prefill, not silent create: an address also needs a contact
                  name and phone, which geolocation cannot supply. */}
              {location$?.postcode && (
                <button
                  type="button"
                  onClick={() => {
                    setLocOpen(false);
                    navigate('/addresses', {
                      state: {
                        prefill: {
                          street_line_1: streetFromFormatted(location$.formatted, location$.postcode),
                          postcode: location$.postcode,
                          city: location$.city ?? '',
                        },
                      },
                    });
                  }}
                  className="w-full text-left px-2.5 py-2 rounded-lg mt-1 hover:bg-surface-linen transition-colors"
                >
                  <span className="flex items-center gap-2 text-[13px] font-semibold font-ui text-brand">
                    <Plus size={14} strokeWidth={2.5} className="shrink-0" />
                    {lang === 'en' ? 'Save as delivery address' : 'Guardar como dirección de entrega'}
                  </span>
                  <span className="block text-[11.5px] text-muted font-body mt-0.5 pl-[22px] truncate">
                    {location$.formatted ?? `${location$.postcode} ${location$.city ?? ''}`.trim()}
                  </span>
                </button>
              )}
            </div>
          )}
    </div>
    );
  };

  return (
    <div className="min-h-screen bg-surface-linen flex flex-col">
      <PartnerPreviewBanner />
      {/* Beside partner preview because it is the same kind of thing: a
          signed-in member of staff using the customer app on purpose, who
          needs to be told which hat they have on and handed the other one. */}

      <header className="sticky top-0 z-40">
        {/* ════════════════════════════════════════════════
            TIER 0 — B2B / trade strip. "Colour field" direction.
            INSIDE the sticky header, so it stays pinned with Tier 1 + 2
            rather than scrolling away. Costs 42px of permanent viewport on
            top of the 72 + 42 the tiers below already hold.

            lg AND UP ONLY. On a phone the sticky header already spends 60 +
            42px before a single product is visible, and this row squeezed a
            label, two links and a CTA into 32px of that — the label was
            dropped and the links scrolled, which is the shape of a row that
            does not fit. The trade funnels now live in the side drawer under
            their own "Cesto Business" block (see SideNavDrawer), where they
            get full-width rows, the section name, and the join CTA as a real
            button instead of a 22px pill.

            The ground carries the design, not the type: two navy lifts over
            brand-deepest, under a hairline that fades green into blue. That
            hairline is the point — it hands the eye off to the brighter blue
            Tier 1 below, and the shared hue makes the two tiers read as one
            header that lightens downward. The links stay quiet so the field
            reads first; the join CTA is the one filled element, parked at the
            right end.
            ════════════════════════════════════════════════ */}
        <div
          className="relative hidden lg:block"
          // Three stacked layers, so inline rather than Tailwind arbitrary
          // values. Ground is brand-deepest (#022B91) — the same blue family
          // as Tier 1 below, two steps darker, so the header reads as one
          // object that lightens downward rather than a black slab parked on
          // top of a blue one. The two pools are lifts of that navy, not a
          // second hue: they give the field depth without introducing a
          // colour the palette does not already own.
          style={{
            background:
              'radial-gradient(120% 260% at 8% 0%, var(--color-strip-a) 0%, transparent 58%),' +
              'radial-gradient(90% 200% at 92% 100%, var(--color-strip-b) 0%, transparent 60%),' +
              'var(--color-strip)',
          }}
        >
          {/* Green-to-blue hairline — the handoff to Tier 1. */}
          <div
            aria-hidden
            className="absolute top-0 inset-x-0 h-px pointer-events-none"
            style={{
              background:
                'linear-gradient(90deg, transparent, rgba(127,198,70,0.55) 30%, rgba(5,78,232,0.55) 70%, transparent)',
            }}
          />
          {/* The row itself does not scroll — only the links inside it do.
              Scrolling the whole row would carry the CTA off the right edge
              on a phone, which is the one item that has to stay put. */}
          <div className="relative max-w-[1500px] mx-auto px-3 sm:px-4 lg:px-6 h-[32px] lg:h-[42px] flex items-center gap-2">
            {/* Section label, not a link. It says who the row is for; the
                items after it are the navigation. Deliberately quiet — small,
                letterspaced, amber, no hover — so it reads as a caption
                rather than a wordmark, and nobody tries to click it. The
                amber rule after it separates label from links without the
                full-height divider that would cut the colour field. */}
            {/* Desktop only. On a 360px row the label costs about a third of
                the width to say something the links already imply, and it is
                the one item here that is not a destination — so it is what
                gives way when space runs out. */}
            <span className="shrink-0 hidden lg:flex items-center gap-2 lg:gap-2.5 pr-2 lg:pr-4 lg:mr-1 select-none">
              <span className="text-[10px] lg:text-[11px] font-ui font-bold uppercase tracking-[0.12em] lg:tracking-[0.14em] text-amber-mid whitespace-nowrap">
                Cesto Business
              </span>
              <span aria-hidden className="w-[10px] lg:w-[14px] h-px bg-amber/45" />
            </span>

            {/* Links get their own scroll region and absorb the leftover
                width, which is what pins the CTA to the right edge without
                ml-auto and keeps it out of the scrolling area. */}
            <div className="flex items-center min-w-0 flex-1 overflow-x-auto hide-scrollbar">
            {tradeNav.map((link, i) => {
              // Two entries share /b2b-deals and differ only by the hash, so
              // pathname alone would light both. Compare the full target.
              const active = location.pathname + location.hash === link.to;
              return (
                <button
                  key={link.label_en}
                  onClick={() => navigate(link.to)}
                  aria-current={active ? 'page' : undefined}
                  className="group relative shrink-0 flex items-center h-[26px] px-3 lg:px-5 first:pl-0 lg:first:pl-5 focus-visible:outline-none"
                >
                  {/* Separator dot, not a divider rule — a full-height rule
                      would cut the colour field the design is built on. */}
                  {i > 0 && (
                    <span aria-hidden className="absolute left-0 top-1/2 -mt-[1.5px] w-[3px] h-[3px] rounded-full bg-amber/50" />
                  )}
                  <span
                    className={`text-[10px] lg:text-[11px] font-ui font-semibold uppercase tracking-[0.04em] lg:tracking-[0.05em] whitespace-nowrap transition-colors duration-200 motion-reduce:transition-none ${
                      active ? 'text-amber-mid' : 'text-white/70 group-hover:text-amber-mid group-focus-visible:text-amber-mid'
                    }`}
                  >
                    {lang === 'en' ? link.label_en : link.label_es}
                  </span>
                  {/* Active only — hover is a colour shift, so the current
                      route needs a marker hover does not also produce. */}
                  <span
                    className={`absolute bottom-0 left-3 right-3 lg:left-5 lg:right-5 h-[1.5px] rounded-full bg-amber-mid transition-opacity duration-200 motion-reduce:transition-none ${
                      active ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                </button>
              );
            })}
            </div>

            {/* Join CTA — apart from the links by design, at the right end
                where the field's green pool is strongest, so the fill sits in
                colour that already belongs there. Outside the scroll region,
                so it holds that edge at every width.
                Deep-links past the pitch to the application form;
                B2bDealsPage scrolls to #register-form on mount, because
                React Router does not perform the fragment scroll itself. */}
            <button
              onClick={() => navigate('/b2b-deals#register-form')}
              aria-current={location.pathname + location.hash === '/b2b-deals#register-form' ? 'page' : undefined}
              className="shrink-0 flex items-center h-[22px] lg:h-[28px] px-3 lg:px-4 rounded-full bg-amber hover:bg-amber-mid transition-colors duration-200 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 shadow-[0_1px_10px_rgba(127,198,70,0.35)]"
            >
              <span className="text-[9.5px] lg:text-[11px] font-ui font-bold uppercase tracking-[0.04em] lg:tracking-[0.05em] text-ink whitespace-nowrap leading-none">
                {lang === 'en' ? 'Join us — Wholesale prices (B2B)' : 'Únete — Precios al por mayor (B2B)'}
              </span>
            </button>
          </div>
        </div>

        {/* ════════════════════════════════════════════════
            TIER 1 — Primary blue navbar
            ════════════════════════════════════════════════ */}
        <div className="bg-brand-bar">
          <div className="max-w-[1500px] mx-auto px-3 sm:px-4 lg:px-6 h-[60px] sm:h-[72px] flex items-center gap-2 sm:gap-3 lg:gap-4">
            {/* Hamburger — mobile only. Opens full-height side drawer. */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="lg:hidden w-9 h-9 rounded-full border border-white/15 bg-white/5 hover:bg-white/15 hover:border-white/25 flex items-center justify-center transition-colors shrink-0"
              aria-label={lang === 'en' ? 'Open menu' : 'Abrir menú'}
            >
              <Menu size={18} strokeWidth={2.25} className="text-white" />
            </button>

            {/* Logo */}
            <button
              onClick={goHome}
              className="flex items-center gap-2 shrink-0 group"
              aria-label="Cesto"
            >
              <img
                src="/cesto-icon.png"
                alt=""
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.2)] group-hover:scale-[1.04] transition-transform"
                draggable={false}
              />
              <span className="hidden md:block text-white font-display text-[24px] tracking-tight leading-none" style={{ fontWeight: 600 }}>
                Cesto
              </span>
            </button>

            {/* Location picker — MV Slice 5.
                Was a shortcut to /addresses; now it chooses the browse
                scope, which is what actually filters the catalogue. */}
            <div className="hidden md:block">{renderLocationPicker('labelled')}</div>

            {/* Big search bar — Walmart-style centered.
                Shortened placeholder + smaller height at mobile so it doesn't
                dominate the cramped mobile header. */}
            <form
              role="search"
              onSubmit={(e) => { e.preventDefault(); navigate('/search'); }}
              className="flex-1 max-w-[760px] mx-auto min-w-0"
            >
              <div className="relative flex items-center h-10 sm:h-12 bg-card rounded-full overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.12)] focus-within:ring-2 focus-within:ring-amber">
                <input
                  type="text"
                  placeholder={lang === 'en' ? 'Search Cesto' : 'Buscar en Cesto'}
                  onClick={() => navigate('/search')}
                  readOnly
                  className="flex-1 min-w-0 h-full pl-4 sm:pl-5 pr-2 bg-transparent text-[13px] sm:text-[13.5px] font-ui text-ink placeholder:text-muted focus:outline-none cursor-pointer"
                />
                <button
                  type="submit"
                  className="h-8 w-8 sm:h-10 sm:w-10 mr-1 rounded-full bg-brand hover:bg-brand-deepest flex items-center justify-center transition-colors shrink-0"
                  aria-label={lang === 'en' ? 'Search' : 'Buscar'}
                >
                  <Search size={16} strokeWidth={2.25} className="text-white" />
                </button>
              </div>
            </form>

            {/* Right cluster — Account · Cart.
                On mobile: shrink icon buttons + hide non-essentials (favorites
                goes to profile menu; language collapses to globe-only). */}
            <div className="flex items-center gap-1 lg:gap-1.5 shrink-0">
              {/* Light or dark, one tap (sm and up; the drawer's Appearance on a
                  phone). From Auto it picks the opposite of what shows now. */}
              <button
                onClick={() => theme.setChoice(theme.resolved === 'dark' ? 'light' : 'dark')}
                className="hidden sm:flex w-11 h-11 rounded-full border border-white/15 bg-white/5 hover:bg-white/15 hover:border-white/25 items-center justify-center transition-colors"
                aria-label={theme.resolved === 'dark' ? t('theme.toLight') : t('theme.toDark')}
                title={theme.resolved === 'dark' ? t('theme.toLight') : t('theme.toDark')}
              >
                {theme.resolved === 'dark'
                  ? <Sun size={18} strokeWidth={2} className="text-white" />
                  : <Moon size={18} strokeWidth={2} className="text-white" />}
              </button>

              {/* Language switcher — hidden on mobile (available in the side drawer); pill from sm up */}
              <div className="relative hidden sm:block" ref={langRef}>
                <button
                  onClick={() => setLangOpen(!langOpen)}
                  className="flex items-center gap-1.5 h-11 px-3.5 justify-center rounded-full border border-white/15 bg-white/5 hover:bg-white/15 hover:border-white/25 transition-colors"
                  title={currentLang.label}
                  aria-label={lang === 'en' ? 'Language' : 'Idioma'}
                >
                  <Globe size={14} strokeWidth={2.25} className="text-white" />
                  <span className="text-[12.5px] font-semibold text-white font-ui">{lang.toUpperCase()}</span>
                </button>
                {langOpen && (
                  <div className="absolute right-0 top-12 z-50 bg-card rounded-lg shadow-float border border-border py-2 min-w-[190px]">
                    {languages.map((l) => (
                      <button
                        key={l.code}
                        onClick={() => { setLang(l.code); setLangOpen(false); }}
                        className={`w-full text-left px-4 py-2.5 text-[13px] font-ui tracking-tight flex items-center gap-3 transition-colors ${
                          lang === l.code ? 'text-brand font-semibold bg-brand-mist/60' : 'text-ink hover:bg-surface-linen'
                        }`}
                      >
                        <span className="text-lg">{l.flag}</span>
                        <span className="flex-1">{l.label}</span>
                        {lang === l.code && <Check size={14} strokeWidth={2.5} className="text-brand" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* B2B price toggle — approved business customers only.
                  Writes through to the server (User.pricing_mode) rather
                  than living in client state, because checkout recomputes
                  order totals from it. The catalogue caches are invalidated
                  by the mutation, so prices re-render after the round trip. */}
              {isAuthenticated && !isPreview && user?.is_business && (
                <div
                  // lg, not sm: the drawer is `lg:hidden` and now carries this
                  // switch, so anything below lg would render it twice.
                  className="hidden lg:inline-flex items-center h-11 p-1 rounded-full bg-white/15 border border-white/25"
                  role="group"
                  aria-label={lang === 'en' ? 'Price mode' : 'Modo de precios'}
                >
                  {(['retail', 'b2b'] as const).map((m) => {
                    const active = (user.pricing_mode ?? 'retail') === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={pricingModeMut.isPending}
                        aria-pressed={active}
                        onClick={() => { if (!active) handlePricingModeSelect(m); }}
                        className={`h-9 px-3 rounded-full text-[12px] font-display font-bold transition-colors disabled:opacity-60 ${
                          active ? 'bg-card text-brand shadow-sm' : 'text-white/85 hover:text-white'
                        }`}
                        title={m === 'b2b'
                          ? (lang === 'en' ? 'Show wholesale (B2B) prices' : 'Ver precios mayoristas (B2B)')
                          : (lang === 'en' ? 'Show regular prices' : 'Ver precios normales')}
                      >
                        {m === 'b2b'
                          ? (lang === 'en' ? 'Business' : 'Empresa')
                          : (lang === 'en' ? 'Regular' : 'Normal')}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Manage store — shown when the logged-in user has a
                  partner role. Same-origin now (partner dashboard lives
                  inside this same app under /partner/*), so just a plain
                  router navigation — no cross-app SSO handoff. */}
              {isAuthenticated && !isPreview && (user?.partner_roles?.length ?? 0) > 0 && (
                <button
                  onClick={() => navigate('/partner/dashboard')}
                  className="hidden sm:inline-flex items-center gap-1.5 h-11 px-3.5 rounded-full bg-card hover:bg-surface-linen border border-card text-ink text-[12.5px] font-display font-semibold transition-colors shadow-sm"
                  title={lang === 'en' ? 'Manage your store on Cesto' : 'Gestiona tu tienda en Cesto'}
                >
                  <Store size={14} strokeWidth={2} className="text-brand" />
                  {lang === 'en' ? 'Manage store' : 'Gestionar tienda'}
                </button>
              )}

              {/* NO "Sell" pill here, and none in the drawer or the tab bar.
                  A rep does not reach this header: CustomerOnlyRoute sends
                  them to /sales before the storefront renders, so a pill
                  offering them their own app is both unreachable and the wrong
                  idea — it framed selling for Cesto as an errand on the way to
                  buying rice. The partner pill above stays, because a partner
                  IS a shopper who also runs a shop. */}

              {/* Notifications */}
              {isAuthenticated && (
                <div className="text-white">
                  <NotificationInbox />
                </div>
              )}

              {/* Favourites — hidden on mobile (also lives in the profile menu) */}
              <button
                onClick={() => navigate('/favorites')}
                className="hidden sm:flex relative w-11 h-11 rounded-full border border-white/15 bg-white/5 hover:bg-white/15 hover:border-white/25 items-center justify-center transition-colors"
                aria-label={lang === 'en' ? 'Favourites' : 'Favoritos'}
                title={lang === 'en' ? 'Saved' : 'Guardados'}
              >
                <Heart size={19} strokeWidth={2} className="text-white" />
                {favoritesCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] rounded-full bg-amber text-on-accent text-[10px] font-extrabold flex items-center justify-center px-1 font-ui ring-2 ring-brand-bar">
                    {favoritesCount}
                  </span>
                )}
              </button>

              {/* Cart — always visible; smaller at mobile. Hidden in Partner
                  Preview so partners don't stumble into a checkout flow. */}
              {!isPreview && (
                <button
                  onClick={handleCartClick}
                  className="relative w-9 h-9 sm:w-11 sm:h-11 rounded-full border border-white/15 bg-white/5 hover:bg-white/15 hover:border-white/25 flex items-center justify-center transition-colors"
                  aria-label={cartWords.name}
                  title={cartWords.name}
                >
                  {cartWords.shopper
                    ? <ClipboardList size={18} strokeWidth={2} className="text-white" />
                    : <ShoppingCart size={18} strokeWidth={2} className="text-white" />}
                  {itemCount > 0 && (
                    <span className="absolute top-1 right-1 sm:top-1.5 sm:right-1.5 min-w-[16px] h-[16px] sm:min-w-[18px] sm:h-[18px] rounded-full bg-amber text-on-accent text-[10px] font-extrabold flex items-center justify-center px-1 font-ui ring-2 ring-brand-bar">
                      {itemCount}
                    </span>
                  )}
                </button>
              )}

              {/* Sign in / Profile avatar — hidden on mobile (drawer covers
                  sign-in for guests and logout for authed users; the
                  notification bell handles the "top-right icon" role). */}
              {isAuthenticated ? (
                <div className="relative hidden sm:block" ref={userRef}>
                  <button
                    onClick={() => setUserOpen(!userOpen)}
                    className="w-11 h-11 rounded-full border border-white/15 bg-white/5 hover:bg-white/15 hover:border-white/25 flex items-center justify-center overflow-hidden transition-colors"
                    aria-label={lang === 'en' ? 'Account' : 'Cuenta'}
                    title={user?.name}
                  >
                    {user?.avatar_url ? (
                      <img src={resolveImageUrl(user.avatar_url, 'logo')} alt={user.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[12px] font-bold text-white font-ui">{initials}</span>
                    )}
                  </button>
                  {userOpen && (
                    <div className="absolute right-0 top-12 z-50 bg-card rounded-lg shadow-float border border-border min-w-[280px] overflow-hidden">
                      {/* Header — name + delivery zip */}
                      <div className="px-5 pt-4 pb-3">
                        <p className="text-[15px] font-bold text-ink font-ui truncate">{user?.name}</p>
                        <p className="text-[12px] font-semibold text-success font-ui mt-0.5">
                          {lang === 'en' ? 'Delivery in 28004' : 'Entrega en 28004'}
                        </p>
                      </div>

                      <div className="h-px bg-border/60 mx-5" />

                      {/* Group 1 — orders + account */}
                      <div className="py-2">
                        <button onClick={() => { setUserOpen(false); navigate('/orders'); }} className="w-full text-left px-5 py-2.5 text-[13.5px] font-ui font-medium text-ink hover:bg-surface-linen flex items-center gap-3.5 transition-colors">
                          <ClipboardList size={17} strokeWidth={1.75} className="text-ink/55" />
                          {lang === 'en' ? 'My orders' : 'Mis pedidos'}
                        </button>
                        <button onClick={() => { setUserOpen(false); navigate('/favorites'); }} className="w-full text-left px-5 py-2.5 text-[13.5px] font-ui font-medium text-ink hover:bg-surface-linen flex items-center gap-3.5 transition-colors">
                          <Heart size={17} strokeWidth={1.75} className="text-ink/55" />
                          <span className="flex-1">{lang === 'en' ? 'My favourites' : 'Mis favoritos'}</span>
                          {favoritesCount > 0 && (
                            <span className="text-[11px] font-bold font-ui text-brand bg-brand-mist px-2 py-0.5 rounded-full">
                              {favoritesCount}
                            </span>
                          )}
                        </button>
                        {isHomeGrocery && (
                          <button onClick={() => { setUserOpen(false); navigate(HOME_GROCERY_PROFILE_PATH); }} className="w-full text-left px-5 py-2.5 text-[13.5px] font-ui font-medium text-ink hover:bg-surface-linen flex items-center gap-3.5 transition-colors">
                            <HopBasket size={17} className="text-success" />
                            {lang === 'en' ? 'My Home Grocery' : 'Mi compra del hogar'}
                          </button>
                        )}
                        <button onClick={() => { setUserOpen(false); navigate('/profile'); }} className="w-full text-left px-5 py-2.5 text-[13.5px] font-ui font-medium text-ink hover:bg-surface-linen flex items-center gap-3.5 transition-colors">
                          <User size={17} strokeWidth={1.75} className="text-ink/55" />
                          {lang === 'en' ? 'Account' : 'Cuenta'}
                        </button>
                      </div>

                      <div className="h-px bg-border/60 mx-5" />

                      {/* Group 2 — help + logout */}
                      <div className="py-2">
                        <button onClick={() => { setUserOpen(false); navigate('/faq'); }} className="w-full text-left px-5 py-2.5 text-[13.5px] font-ui font-medium text-ink hover:bg-surface-linen flex items-center gap-3.5 transition-colors">
                          <HelpCircle size={17} strokeWidth={1.75} className="text-ink/55" />
                          {lang === 'en' ? 'FAQ' : 'Preguntas frecuentes'}
                        </button>
                        <button onClick={() => { setUserOpen(false); navigate('/contact'); }} className="w-full text-left px-5 py-2.5 text-[13.5px] font-ui font-medium text-ink hover:bg-surface-linen flex items-center gap-3.5 transition-colors">
                          <MessageCircle size={17} strokeWidth={1.75} className="text-ink/55" />
                          {lang === 'en' ? 'Help' : 'Ayuda'}
                        </button>
                        <button onClick={handleLogout} className="w-full text-left px-5 py-2.5 text-[13.5px] font-ui font-medium text-ink hover:bg-surface-linen flex items-center gap-3.5 transition-colors">
                          <LogOut size={17} strokeWidth={1.75} className="text-ink/55" />
                          {lang === 'en' ? 'Logout' : 'Cerrar sesión'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => navigate('/login')}
                  className="hidden sm:flex items-center justify-center h-11 px-4 rounded-full border border-white/15 bg-white/5 hover:bg-white/15 hover:border-white/25 transition-colors"
                  aria-label={lang === 'en' ? 'Sign in' : 'Iniciar sesión'}
                >
                  <span className="text-[12.5px] font-semibold text-white font-ui leading-none whitespace-nowrap">
                    {lang === 'en' ? 'Sign in' : 'Iniciar sesión'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Location row — mobile only, its own band under the search row and
              still on the blue. A delivery address is the thing that decides
              what the whole catalogue shows, so it gets a row rather than a
              36px pin competing with five other icon buttons. */}
          <div className="md:hidden border-t border-white/15">
            <div className="max-w-[1500px] mx-auto">
              {renderLocationPicker('row')}
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════
            TIER 2 — Secondary category nav (light surface — calm
            contrast against the blue Tier 1 above).
            Hidden on /categories — sidebar takes its role there.
            ════════════════════════════════════════════════ */}
        {!location.pathname.startsWith('/categories') && (
        <div className="bg-surface-cream border-b border-border shadow-nav">
          <div className="max-w-[1500px] mx-auto px-4 lg:px-6 h-[42px] flex items-center gap-1 overflow-x-auto hide-scrollbar">
            {/* Quick links */}
            {fixedNav.map((link) => (
              <NavPill key={link.label_en} link={link} lang={lang} navigate={navigate} location={location} />
            ))}
            {categoryNavCats.map((cat) => (
              <CategoryHoverPill
                key={cat.id}
                cat={cat}
                lang={lang}
                navigate={navigate}
                location={location}
              />
            ))}
            {tailNav.map((link) => (
              <NavPill key={link.label_en} link={link} lang={lang} navigate={navigate} location={location} />
            ))}

          </div>
        </div>
        )}
      </header>

      {/* ─── Side navigation drawer (mobile) ──────────── */}
      <SideNavDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onNavigate={(to) => { setDrawerOpen(false); navigate(to); }}
        onLogout={() => { setDrawerOpen(false); logout(); navigate('/'); }}
        onSelectLang={(code) => setLang(code)}
        lang={lang}
        themeChoice={theme.choice}
        onSelectTheme={theme.setChoice}
        isAuthenticated={isAuthenticated}
        user={user}
        favoritesCount={favoritesCount}
        fixedNav={fixedNav}
        // The trade funnels left the category bar, and the Tier 0 strip that
        // carries them is lg-and-up. Without this they would be unreachable
        // on a phone. The drawer renders them as their own "Cesto Business"
        // section with its own join CTA, so the same list the strip uses is
        // passed straight through — /b2b-deals is the CTA's destination in
        // both places rather than a synthetic extra row here.
        tradeNav={tradeNav}
        isBusiness={!!(isAuthenticated && !isPreview && user?.is_business)}
        pricingMode={user?.pricing_mode ?? 'retail'}
        onSetPricingMode={handlePricingModeSelect}
        pricingPending={pricingModeMut.isPending}
        isPartner={!!(isAuthenticated && !isPreview && (user?.partner_roles?.length ?? 0) > 0)}
        isHomeGrocery={isHomeGrocery}
      />



      {/* ─── Maintenance banner ───────────────────────
          Surfaces the admin's "Maintenance mode" toggle. Non-blocking —
          the site remains functional so support can still test flows. */}
      {maintenance && (
        <div className="bg-amber-mist text-ink border-b border-amber-deep/30">
          <div className="max-w-[1500px] mx-auto px-4 lg:px-6 py-2.5 flex items-center gap-3">
            <AlertTriangle size={16} strokeWidth={2} className="text-amber-deep shrink-0" />
            <p className="text-[13px] font-ui font-semibold">
              {lang === 'en'
                ? 'We are performing maintenance right now. Some features may be temporarily unavailable.'
                : 'Estamos realizando tareas de mantenimiento. Algunas funciones pueden no estar disponibles.'}
            </p>
          </div>
        </div>
      )}

      {/* ─── Page content ─────────────────────────────── */}
      <main className="flex-1">
        <Outlet />
      </main>

      <Footer />
      {/* WhatsApp on every page, with the cart pill under it. */}
      {!isPreview && <FloatingActions />}
      {!isPreview && <CartDrawer />}
      {/* Mounted on the layout, not on HomePage, so it greets a visitor
          arriving on any customer page — a shared product link is as much a
          landing as "/" is, and the pricing caveat matters most to someone
          looking at a product. Suppressed in partner preview, which is a
          partner inspecting their own storefront, not a shopper. */}
      {!isPreview && <AnnouncementModal />}
      {/* Partner Preview has no shopping session to navigate, and the bar's
          five destinations are all customer-side. */}
      {!isPreview && <MobileTabBar />}

      {priceSwitch && (
        <PricingModeDialog
          state={priceSwitch}
          onClose={() => setPriceSwitch(null)}
          onRetry={() => void setPricingMode(priceSwitch.mode)}
        />
      )}

      <RetailPriceLoginModal
        open={retailLoginPromptOpen}
        onCancel={() => setRetailLoginPromptOpen(false)}
        onLogin={confirmRetailLogin}
      />
    </div>
  );
}

/* ───────────────────────────────────────────────────────
   Mobile side-nav drawer — full nav for signed-in and
   guest states. On desktop the tier-2 nav covers this.
   ─────────────────────────────────────────────────────── */
type SideNavUser = { name: string; avatar_url?: string | null } | null;

function SideNavDrawer({
  open, onClose, onNavigate, onLogout, onSelectLang, lang, themeChoice, onSelectTheme,
  isAuthenticated, user, favoritesCount, fixedNav, tradeNav,
  isBusiness, pricingMode, onSetPricingMode, pricingPending, isPartner, isHomeGrocery,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (to: string) => void;
  onLogout: () => void;
  onSelectLang: (code: Language) => void;
  lang: Language;
  /** Light, dark or the device's (lib/shopTheme). */
  themeChoice: ShopThemeChoice;
  onSelectTheme: (choice: ShopThemeChoice) => void;
  isAuthenticated: boolean;
  user: SideNavUser;
  favoritesCount: number;
  fixedNav: { label_es: string; label_en: string; to: string; emoji?: string; highlight?: boolean; hop?: boolean }[];
  /** Tier 0 trade links. Desktop-only up there, so the drawer carries them. */
  tradeNav: { label_es: string; label_en: string; to: string }[];
  /** Approved business customers only — drives the price-mode switch. */
  isBusiness: boolean;
  pricingMode: 'retail' | 'b2b';
  onSetPricingMode: (mode: 'retail' | 'b2b') => void;
  pricingPending: boolean;
  /** Has at least one partner store role — surfaces the Manage store card. */
  isPartner: boolean;
  /** An approved Home Grocery household — its plan gets a row under "You". */
  isHomeGrocery: boolean;
}) {
  const initials = user?.name.split(' ').map((n) => n[0]).join('').toUpperCase() ?? '';
  const label = (en: string, es: string) => (lang === 'en' ? en : es);

  const primaryNav: { icon: typeof Home; to: string; label_en: string; label_es: string; highlight?: boolean; emoji?: string; hop?: boolean }[] = [
    { icon: Home, to: '/', label_en: 'Home', label_es: 'Inicio' },
    { icon: Store, to: '/categories', label_en: 'Categories', label_es: 'Categorías' },
    // The account routes are skipped: they joined the category bar, but this
    // drawer already lists all three in its account block below, and a
    // duplicate in the browse section reads as a second, different link.
    ...fixedNav
      .slice(1)
      .filter((n) => !['/orders', '/addresses', '/favorites'].includes(n.to))
      .map((n) => ({
      icon: n.to === '/rashan' ? ShoppingBasket
          : n.to === '/origins' ? Globe
          : n.to === '/brands' ? Award
          : n.to.includes('deals') ? Tag
          : Store,
      to: n.to,
      label_en: n.label_en,
      label_es: n.label_es,
      highlight: n.highlight,
      emoji: n.emoji,
      hop: n.hop,
    })),
  ];

  // Wholesale prices leads the section: it is the buy-side funnel, the
  // larger audience, and the one entry tradeNav does not carry — on the
  // Tier 0 strip that destination is the join CTA rather than a link.
  // Distinct icons because the two funnels are opposite sides of the
  // marketplace (buy at trade prices vs open a store), and matching rows
  // read as the same errand.
  const businessNav = tradeNav
    // /partner-deals is the apply-to-open-a-store funnel. A partner already
    // has one, so for them it is an application form for something they have
    // — the Manage store card above is where they actually want to go.
    // Wholesale prices stays: selling on Cesto does not stop you buying.
    .filter((n) => !(isPartner && n.to === '/partner-deals'))
    .map((n) => ({
      ...n,
      icon: n.to === '/partner-deals' ? Package : Store,
    }));

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-50 bg-veil/50 backdrop-blur-[2px] transition-opacity duration-200 lg:hidden ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-label={label('Navigation', 'Navegación')}
        aria-modal="true"
        className={`fixed top-0 left-0 bottom-0 z-50 w-[86%] max-w-[340px] bg-surface-linen shadow-float flex flex-col transition-transform duration-250 lg:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header — brand block */}
        <div className="bg-brand-bar px-4 pt-4 pb-5 text-white">
          <div className="flex items-center justify-between">
            <button onClick={() => onNavigate('/')} className="flex items-center gap-2.5">
              <img src="/cesto-icon.png" alt="" className="w-10 h-10 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.2)]" draggable={false} />
              <span className="font-display text-[22px] tracking-tight" style={{ fontWeight: 600 }}>Cesto</span>
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              aria-label={label('Close', 'Cerrar')}
            >
              <X size={17} strokeWidth={2.25} className="text-white" />
            </button>
          </div>

          {/* Account block — signed in vs guest */}
          <div className="mt-5">
            {isAuthenticated && user ? (
              <button
                onClick={() => onNavigate('/profile')}
                className="w-full flex items-center gap-3 rounded-xl bg-white/10 hover:bg-white/15 px-3 py-2.5 transition-colors text-left"
              >
                <span className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center overflow-hidden shrink-0">
                  {user.avatar_url ? (
                    <img src={resolveImageUrl(user.avatar_url, 'logo') ?? undefined} alt={user.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[13px] font-bold font-ui">{initials}</span>
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-bold font-ui truncate leading-tight">{user.name}</p>
                  <p className="text-[11.5px] text-white/70 font-ui mt-0.5">{label('View profile', 'Ver perfil')}</p>
                </span>
                <ChevronRight size={16} strokeWidth={2} className="text-white/80" />
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onNavigate('/login')}
                  className="flex-1 h-11 rounded-full bg-card text-brand text-[13px] font-bold font-ui hover:bg-white/90 transition-colors"
                >
                  {label('Sign in', 'Iniciar sesión')}
                </button>
                <button
                  onClick={() => onNavigate('/register')}
                  className="flex-1 h-11 rounded-full border border-white/40 text-white text-[13px] font-bold font-ui hover:bg-white/10 transition-colors"
                >
                  {label('Sign up', 'Registrarse')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Body — nav list */}
        <nav className="flex-1 overflow-y-auto py-2">
          {/* Manage store — the header button that carries this is `sm:` and
              up, so on a phone a partner had no way into their dashboard at
              all. A full-width card rather than a list row: switching from
              shopping to running your store is a different mode, not another
              destination alongside Orders and Favourites. */}
          {isPartner && (
            <div className="px-4 pt-1 pb-3">
              <button
                type="button"
                onClick={() => onNavigate('/partner/dashboard')}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-brand text-white shadow-card active:bg-brand-mid transition-colors"
              >
                <span className="w-9 h-9 rounded-lg bg-white/15 grid place-items-center shrink-0">
                  <Store size={18} strokeWidth={2} className="text-white" />
                </span>
                <span className="min-w-0 text-left">
                  <span className="block text-[14px] font-bold font-display leading-tight">
                    {label('Manage store', 'Gestionar tienda')}
                  </span>
                  <span className="block text-[11.5px] text-white/75 font-body leading-tight mt-0.5">
                    {label('Orders, products and settings', 'Pedidos, productos y ajustes')}
                  </span>
                </span>
                <ChevronRight size={18} strokeWidth={2} className="ml-auto shrink-0 text-white/70" />
              </button>
            </div>
          )}

          {/* Price mode — businesses only. Above Shop deliberately: it changes
              every price in the catalogue, so it is a mode, not a destination.
              Lives here rather than in a floating button because the cart bar
              already occupies the bottom-right corner on mobile. */}
          {isBusiness && (
            <DrawerSection title={label('Prices', 'Precios')}>
              <div className="px-4 pb-1">
                <div
                  className="flex items-center p-1 rounded-full bg-surface-cream border border-border"
                  role="group"
                  aria-label={label('Price mode', 'Modo de precios')}
                >
                  {(['retail', 'b2b'] as const).map((m) => {
                    const active = pricingMode === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={pricingPending}
                        aria-pressed={active}
                        onClick={() => { if (!active) onSetPricingMode(m); }}
                        className={`flex-1 h-9 rounded-full text-[12.5px] font-display font-bold transition-colors disabled:opacity-60 ${
                          active ? 'bg-brand text-white shadow-sm' : 'text-ink/70 hover:text-ink'
                        }`}
                      >
                        {m === 'b2b' ? label('Business', 'Empresa') : label('Regular', 'Normal')}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11.5px] text-muted font-body mt-1.5 px-1">
                  {pricingMode === 'b2b'
                    ? label('Showing wholesale prices.', 'Mostrando precios mayoristas.')
                    : label('Showing regular prices.', 'Mostrando precios normales.')}
                </p>
              </div>
            </DrawerSection>
          )}

          {/* Section order — Cesto Business, You, then Shop. Shop is the
              longest list here and the one the visitor least needs a drawer
              for: every one of its destinations is already a tap away in the
              category bar and the bottom of the header. Business and You are
              the opposite — the drawer is their only route on a phone, so
              they take the top of the scroll where they are reachable
              without one. */}

          {/* Cesto Business — the mobile home of the Tier 0 trade strip,
              which is lg-and-up. Same row vocabulary as every other section
              here; the section title is what marks it as trade. */}
          <DrawerSection title="Cesto Business">
            <DrawerItem
              icon={<Tag size={17} strokeWidth={1.75} className="text-ink/60" />}
              label={label('Wholesale prices', 'Precios al por mayor')}
              onClick={() => onNavigate('/b2b-deals#register-form')}
            />
            {businessNav.map((n) => (
              <DrawerItem
                key={n.to}
                icon={<n.icon size={17} strokeWidth={1.75} className="text-ink/60" />}
                label={label(n.label_en, n.label_es)}
                onClick={() => onNavigate(n.to)}
              />
            ))}
          </DrawerSection>

          {isAuthenticated && (
            <DrawerSection title={label('You', 'Tú')}>
              <DrawerItem
                icon={<ClipboardList size={17} strokeWidth={1.75} className="text-ink/60" />}
                label={label('My orders', 'Mis pedidos')}
                onClick={() => onNavigate('/orders')}
              />
              <DrawerItem
                icon={<Heart size={17} strokeWidth={1.75} className="text-ink/60" />}
                label={label('My favourites', 'Mis favoritos')}
                onClick={() => onNavigate('/favorites')}
                badge={favoritesCount > 0 ? String(favoritesCount) : undefined}
              />
              {isHomeGrocery && (
                <DrawerItem
                  icon={<HopBasket size={17} className="text-success" />}
                  label={label('My Home Grocery', 'Mi compra del hogar')}
                  onClick={() => onNavigate(HOME_GROCERY_PROFILE_PATH)}
                />
              )}
              <DrawerItem
                icon={<MapPin size={17} strokeWidth={1.75} className="text-ink/60" />}
                label={label('Addresses', 'Direcciones')}
                onClick={() => onNavigate('/addresses')}
              />
              <DrawerItem
                icon={<User size={17} strokeWidth={1.75} className="text-ink/60" />}
                label={label('Account', 'Cuenta')}
                onClick={() => onNavigate('/profile')}
              />
            </DrawerSection>
          )}

          <DrawerSection title={label('Shop', 'Comprar')}>
            {primaryNav.map((n) => (
              <DrawerItem
                key={n.to}
                icon={n.hop
                  ? <HopBasket size={17} className="text-amber-deep" />
                  : <n.icon size={17} strokeWidth={1.75} className="text-ink/60" />}
                label={label(n.label_en, n.label_es)}
                highlight={n.highlight}
                emoji={n.emoji}
                onClick={() => onNavigate(n.to)}
              />
            ))}
          </DrawerSection>

          <DrawerSection title={label('Help', 'Ayuda')}>
            <DrawerItem
              icon={<HelpCircle size={17} strokeWidth={1.75} className="text-ink/60" />}
              label={label('FAQ', 'Preguntas frecuentes')}
              onClick={() => onNavigate('/faq')}
            />
            <DrawerItem
              icon={<MessageCircle size={17} strokeWidth={1.75} className="text-ink/60" />}
              label={label('Contact support', 'Contactar soporte')}
              onClick={() => onNavigate('/contact')}
            />
          </DrawerSection>

          {/* Language switcher */}
          <DrawerSection title={label('Language', 'Idioma')}>
            <div className="px-2 flex items-center gap-2">
              {languages.map((l) => (
                <button
                  key={l.code}
                  onClick={() => onSelectLang(l.code)}
                  className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-full text-[12.5px] font-ui font-semibold transition-colors ${
                    lang === l.code
                      ? 'bg-brand text-white'
                      : 'bg-card border border-border text-ink hover:border-brand/40'
                  }`}
                >
                  <span className="text-[15px] leading-none">{l.flag}</span>
                  {l.label}
                  {lang === l.code && <Check size={12} strokeWidth={2.5} />}
                </button>
              ))}
            </div>
          </DrawerSection>

          {/* Light, dark or the device's */}
          <DrawerSection title={label('Appearance', 'Apariencia')}>
            <div className="px-2 flex items-center gap-2" role="group" aria-label={label('Appearance', 'Apariencia')}>
              {([
                ['light', label('Light', 'Claro'), Sun],
                ['dark', label('Dark', 'Oscuro'), Moon],
                ['system', 'Auto', null],
              ] as const).map(([value, name, Icon]) => (
                <button
                  key={value}
                  onClick={() => onSelectTheme(value)}
                  aria-pressed={themeChoice === value}
                  className={`flex-1 flex items-center justify-center gap-1.5 h-10 rounded-full text-[12.5px] font-ui font-semibold transition-colors ${
                    themeChoice === value
                      ? 'bg-brand text-white'
                      : 'bg-card border border-border text-ink hover:border-brand/40'
                  }`}
                >
                  {Icon && <Icon size={14} strokeWidth={2.25} />}
                  {name}
                </button>
              ))}
            </div>
          </DrawerSection>

          {isAuthenticated && (
            <div className="px-2 pt-2 pb-4">
              <button
                onClick={onLogout}
                className="w-full flex items-center gap-3 h-11 px-3 rounded-xl text-left text-[13px] font-ui font-semibold text-danger hover:bg-danger-bg/60 transition-colors"
              >
                <LogOut size={17} strokeWidth={1.75} />
                {label('Logout', 'Cerrar sesión')}
              </button>
            </div>
          )}

        </nav>
      </aside>
    </>
  );
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-3 pb-1">
      <p className="px-5 pb-1.5 text-[10.5px] font-ui font-bold uppercase tracking-[0.18em] text-muted">
        {title}
      </p>
      <div className="flex flex-col gap-0.5 px-2">{children}</div>
    </div>
  );
}

function DrawerItem({
  icon, label, onClick, badge, emoji, highlight,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  badge?: string;
  emoji?: string;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 h-11 px-3 rounded-xl text-left hover:bg-card transition-colors"
    >
      <span className="w-7 h-7 rounded-lg bg-card border border-border/60 flex items-center justify-center shrink-0">
        {emoji ? <span className="text-[15px] leading-none">{emoji}</span> : icon}
      </span>
      <span className="flex-1 text-[13.5px] font-ui font-semibold text-ink tracking-tight truncate">
        {label}
      </span>
      {highlight && (
        <span className="text-[9px] font-extrabold font-ui tracking-widest px-1.5 py-0.5 rounded-md bg-amber text-on-accent">
          NEW
        </span>
      )}
      {badge && (
        <span className="text-[10.5px] font-bold font-ui text-brand bg-brand-mist px-2 py-0.5 rounded-full">
          {badge}
        </span>
      )}
      <ChevronRight size={14} strokeWidth={2} className="text-ink/30" />
    </button>
  );
}

/* ───────────────────────────────────────────────────────
   Secondary nav pills
   ─────────────────────────────────────────────────────── */
type NavPillLink = { label_es: string; label_en: string; to: string; emoji?: string; highlight?: boolean; hop?: boolean };

function pillClassName(active: boolean) {
  return `flex items-center gap-1.5 h-[34px] px-3 rounded-full text-[12.5px] font-ui font-medium tracking-tight transition-colors shrink-0 ${
    active
      ? 'bg-brand text-white font-semibold'
      : 'text-charcoal hover:bg-brand-mist/60 hover:text-brand-ink'
  }`;
}

function NavPill({
  link, lang, navigate, location,
}: {
  link: NavPillLink;
  lang: Language;
  navigate: (to: string) => void;
  location: { pathname: string; search: string };
}) {
  // Home Grocery stays lit on the household's page: that is where /rashan takes a subscriber.
  const active = link.to === HOME_GROCERY_PATH
    ? location.pathname === HOME_GROCERY_PATH || location.pathname.startsWith(`${HOME_GROCERY_PATH}/`)
      || location.pathname === HOME_GROCERY_PROFILE_PATH
    : `${location.pathname}${location.search}` === link.to;
  return (
    <button onClick={() => navigate(link.to)} className={pillClassName(active)}>
      {link.hop && <HopBasket size={15} className={active ? 'text-white' : 'text-amber-deep'} />}
      {link.emoji && <span className="text-[13px] leading-none">{link.emoji}</span>}
      {lang === 'en' ? link.label_en : link.label_es}
      {link.highlight && (
        <span className="text-[9px] font-extrabold font-ui tracking-widest px-1.5 py-0.5 rounded-md leading-none bg-amber text-on-accent">
          NEW
        </span>
      )}
    </button>
  );
}

function CategoryHoverPill({
  cat, lang, navigate, location,
}: {
  cat: { id: string; name_es: string; name_en: string };
  lang: Language;
  navigate: (to: string) => void;
  location: { pathname: string; search: string };
}) {
  const to = `/categories?cat=${cat.id}`;
  const active = `${location.pathname}${location.search}` === to;
  const [open, setOpen] = useState(false);
  const [panelTop, setPanelTop] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const { data: subs, isLoading: subsLoading } = useSubcategories(open ? cat.id : undefined);
  const { data: prodPage, isLoading: prodLoading } = useCategoryProducts(open ? cat.id : undefined, { limit: 50 });

  const brands = (() => {
    const byKey = new Map<string, string>();
    prodPage?.products?.forEach((p) => {
      const b = p.brand?.trim();
      if (b) {
        const key = b.toLowerCase();
        if (!byKey.has(key)) byKey.set(key, b);
      }
    });
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
  })();

  // Click, not hover. A hover panel opens on the way past — crossing the bar
  // to reach something else covered the page with a menu nobody asked for,
  // which is what the complaints were about.
  const wrapRef = useRef<HTMLDivElement>(null);

  const handlePillClick = () => {
    // Below lg the panel does not render at all, so the pill has to keep
    // doing what it always did there and navigate.
    if (!window.matchMedia('(min-width: 1024px)').matches) {
      navigate(to);
      return;
    }
    if (!open && btnRef.current) {
      // Align dropdown with the bottom of the tier-2 navbar row, not the pill button.
      const navRow = btnRef.current.parentElement?.parentElement;
      const base = navRow ?? btnRef.current;
      setPanelTop(base.getBoundingClientRect().bottom);
    }
    setOpen((v) => !v);
  };

  // An open panel closes on Escape or a click anywhere outside it. Without
  // this a click-opened menu has no way out except picking something.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const goToSub = (subId: string) => {
    setOpen(false);
    navigate(`${to}&sub=${subId}`);
  };
  const goToBrand = (brand: string) => {
    setOpen(false);
    navigate(`${to}&brand=${encodeURIComponent(brand)}`);
  };
  const goToCategory = () => {
    setOpen(false);
    navigate(to);
  };

  const loading = subsLoading || prodLoading;
  const hasContent = (subs && subs.length > 0) || brands.length > 0;
  const catName = lang === 'en' ? cat.name_en : cat.name_es;

  // Both lists live in one scroll-height budget. Fixed rather than
  // content-driven: a category with 30 subcategories used to open a panel
  // three times the height of one with two, and nothing capped it against
  // the viewport, so long lists ran off the bottom of the screen with no
  // way to reach them.
  const BODY_H = 240;

  return (
    <div className="shrink-0" ref={wrapRef}>
      <button
        ref={btnRef}
        onClick={handlePillClick}
        aria-expanded={open}
        aria-haspopup="true"
        className={pillClassName(active)}
      >
        {catName}
      </button>
      {open && (hasContent || loading) && (
        <div
          // Light again. The near-black panel read as a different product
          // dropping over the page and tested badly, so this goes back to the
          // page's own surface: linen ground, a brand wash from the top-left
          // corner, content in cards on top of it.
          // maxHeight keeps the panel inside the viewport no matter how tall
          // the lists get; the body below shrinks into whatever is left.
          style={{
            position: 'fixed',
            top: panelTop,
            left: 0,
            right: 0,
            maxHeight: `calc(100vh - ${panelTop}px)`,
            background:
              'radial-gradient(80% 180% at 0% 0%, rgba(5,78,232,0.05) 0%, transparent 60%),' +
              'var(--color-surface-linen)',
          }}
          // hidden below lg as a second line of defence: even if something
          // sets open on a touch device, there is nothing to paint. The
          // three-column template needs the width anyway.
          className="z-50 shadow-float hidden lg:flex flex-col"
        >
          <div className="relative w-full max-w-[1500px] mx-auto px-4 lg:px-6 py-5 flex flex-col min-h-0">
            {/* basis + grow-0 gives the row its fixed height, while leaving
                shrink at its default so a short viewport still fits.
                Fixed template rather than col-spans: the identity block wants
                a stable width, and the brand chips want a floor so they never
                collapse to one chip per line.
                gridTemplateRows is load-bearing: a grid's implicit row track
                is `auto`, so it sizes to its tallest child regardless of the
                container's own height. A long subcategory list therefore grew
                the card straight out through the bottom of the panel instead
                of scrolling inside it — flexBasis capped the grid, not the
                track. minmax(0, 1fr) pins the track to the container so the
                cards inherit a real height and their overflow-y-auto bites. */}
            <div
              className="grid gap-6 grow-0 min-h-0"
              style={{
                flexBasis: BODY_H,
                gridTemplateColumns: '220px minmax(0, 1fr) minmax(240px, 340px)',
                gridTemplateRows: 'minmax(0, 1fr)',
              }}
            >
              {/* Identity card. On a light ground a bordered card reads as an
                  object; the divider rule it replaced only worked on dark. */}
              <div className="flex flex-col justify-between min-h-0 rounded-xl border border-brand-mist bg-gradient-to-br from-brand-whisper via-card to-brand-mist/60 p-4">
                <div className="min-h-0">
                  <span className="inline-flex items-center bg-brand-mist text-brand text-[9px] font-bold tracking-[0.16em] uppercase px-2.5 py-1 rounded-full font-ui">
                    {lang === 'en' ? 'Category' : 'Categoría'}
                  </span>
                  <h3 className="font-display text-[21px] text-ink tracking-tight leading-[1.15] mt-2.5" style={{ fontWeight: 700 }}>
                    {catName}
                  </h3>
                  {typeof prodPage?.total === 'number' && (
                    <p className="font-body text-[12.5px] text-gray mt-1.5">
                      <span className="font-bold text-ink tabular-nums">{prodPage.total}</span>{' '}
                      {lang === 'en' ? 'products' : 'productos'}
                    </p>
                  )}
                </div>
                <button
                  onClick={goToCategory}
                  className="shrink-0 h-9 rounded-lg bg-brand hover:bg-brand-mid text-white text-[12.5px] font-ui font-bold transition-colors mt-3"
                >
                  {lang === 'en' ? 'See all' : 'Ver todo'}
                </button>
              </div>

              {/* Both lists are cards per design rule 5, and each scrolls
                  under its own heading, so the labels stay put and a long
                  subcategory list cannot drag the brands out of view. */}
              <div className="flex flex-col min-h-0 rounded-lg border border-border/70 bg-surface-cream shadow-card overflow-hidden">
                <div className="shrink-0 flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5 border-b border-border/60">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-gray font-ui">
                    {lang === 'en' ? 'Subcategories' : 'Subcategorías'}
                  </p>
                  {!loading && subs && subs.length > 0 && (
                    <span className="text-[10.5px] font-ui font-bold text-brand bg-brand-whisper px-1.5 py-0.5 rounded tabular-nums">
                      {subs.length}
                    </span>
                  )}
                </div>
                <div className="min-h-0 overflow-y-auto px-2 py-2">
                  {loading ? (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-[28px] rounded-md" />
                      ))}
                    </div>
                  ) : subs && subs.length > 0 ? (
                    <div className="grid grid-cols-2 gap-x-3">
                      {subs.map((sub) => (
                        <button
                          key={sub.id}
                          onClick={() => goToSub(sub.id)}
                          className="group/row text-left flex items-center gap-2 px-2 py-[7px] rounded-md text-[13px] font-ui font-medium text-charcoal hover:bg-brand-whisper hover:text-brand-ink transition-colors"
                        >
                          <span className="w-[2px] h-3.5 rounded-full bg-transparent group-hover/row:bg-brand shrink-0 transition-colors" />
                          <span className="truncate">{lang === 'en' ? sub.name_en : sub.name_es}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px] text-muted font-ui px-2 py-1">
                      {lang === 'en' ? 'No subcategories yet' : 'Sin subcategorías'}
                    </p>
                  )}
                </div>
              </div>

              {/* Brands render as chips, not rows: they are filters applied to
                  a category rather than places in the taxonomy, and the
                  difference in form says so without a caption. */}
              <div className="flex flex-col min-h-0 rounded-lg border border-border/70 bg-surface-cream shadow-card overflow-hidden">
                <div className="shrink-0 flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5 border-b border-border/60">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-gray font-ui">
                    {lang === 'en' ? 'Popular brands' : 'Marcas populares'}
                  </p>
                  {!loading && brands.length > 0 && (
                    <span className="text-[10.5px] font-ui font-bold text-brand bg-brand-whisper px-1.5 py-0.5 rounded tabular-nums">
                      {brands.length}
                    </span>
                  )}
                </div>
                <div className="min-h-0 overflow-y-auto px-4 py-3">
                  {loading ? (
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <Skeleton key={i} className="h-[26px] w-[84px] rounded-full" />
                      ))}
                    </div>
                  ) : brands.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {brands.map((brand) => (
                        <button
                          key={brand}
                          onClick={() => goToBrand(brand)}
                          className="max-w-full truncate px-2.5 py-1 rounded-full border border-border bg-card text-[12.5px] font-ui font-medium text-charcoal hover:border-brand hover:bg-brand-whisper hover:text-brand-ink transition-colors"
                        >
                          {brand}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px] text-muted font-ui">
                      {lang === 'en' ? 'No brands yet' : 'Sin marcas'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
