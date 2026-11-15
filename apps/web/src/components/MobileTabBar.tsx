import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Store, Handbag, ClipboardList, Tag, LayoutDashboard } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';

/** Focused funnels get the screen to themselves — same list the floating
 *  cart bar hides on, for the same reason: once you are paying or signing
 *  in, a row of five ways to leave is a way to lose the order. */
const HIDDEN_PATHS = ['/cart', '/checkout', '/login', '/register', '/verify-otp'];

/** The bar's own height, without the safe-area inset. Shared by the bar and
 *  the in-flow spacer that keeps the footer out from under it. */
const TAB_BAR_HEIGHT = 58;

interface Tab {
  to: string;
  icon: typeof Home;
  label_en: string;
  label_es: string;
  /** Longer text for screen readers where the visible label is clipped
   *  to fit a fifth of a phone. */
  aria_en?: string;
  aria_es?: string;
}

const BASE_TABS: Tab[] = [
  { to: '/stores',  icon: Store,         label_en: 'Stores',  label_es: 'Tiendas' },
  // Short in Spanish: tab labels are 10px and truncate, and "Compra del
  // hogar" would not fit.
  { to: '/rashan',  icon: Handbag,       label_en: 'Home Grocery', label_es: 'Hogar' },
  { to: '/',        icon: Home,          label_en: 'Home',    label_es: 'Inicio' },
  { to: '/orders',  icon: ClipboardList, label_en: 'Orders',  label_es: 'Pedidos' },
];

/** Fifth tab, by who is looking. A partner has already joined, so pitching
 *  them the join funnel wastes the slot — hand it to the thing they open the
 *  app for. Everyone else gets the wholesale funnel. */
const JOIN_TAB: Tab = {
  to: '/b2b-deals#register-form',
  icon: Tag,
  label_en: 'Join us', label_es: 'Únete',
  aria_en: 'Join us — wholesale prices', aria_es: 'Únete — precios al por mayor',
};

/** LayoutDashboard rather than the Store icon the header's Manage store
 *  button uses: the Stores tab two slots over already owns that shape, and
 *  two identical glyphs in a five-icon row is worse than one that differs
 *  from a button on another surface.
 *
 *  This tab never shows as active. /partner/* renders under PartnerLayout,
 *  outside CustomerLayout, so the bar is gone by the time you arrive — it is
 *  an exit from the customer app, not a tab within it. Same as the drawer's
 *  Manage store card and the header button. */
const MANAGE_STORE_TAB: Tab = {
  to: '/partner/dashboard',
  icon: LayoutDashboard,
  label_en: 'My store', label_es: 'Mi tienda',
  aria_en: 'Manage your store', aria_es: 'Gestiona tu tienda',
};

/**
 * Mobile bottom tab bar (<lg). Desktop reaches all five of these from the
 * category bar and the header, so it only exists where those are collapsed.
 *
 * Home sits in the middle rather than at the left end: on a phone the bar is
 * thumb-driven, and the centre is the easiest reach, so the destination
 * people hit most often gets it.
 */
export default function MobileTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const isPartner = isAuthenticated && (user?.partner_roles?.length ?? 0) > 0;

  /**
   * One slot, two candidates. A partner has already joined, so pitching them
   * the join funnel wastes the slot; everyone else gets the wholesale funnel.
   *
   * No "Sell" candidate, though a rep is signed in on the same kind of
   * account: CustomerOnlyRoute redirects a rep to /sales before the storefront
   * renders, so this bar is not a surface they see. Their own bottom tabs live
   * in SalesLayout.
   */
  const fifthTab = isPartner ? MANAGE_STORE_TAB : JOIN_TAB;
  const tabs = [...BASE_TABS, fifthTab];

  if (HIDDEN_PATHS.some((p) => location.pathname.startsWith(p))) return null;

  const current = location.pathname + location.hash;

  return (
    <>
      {/* In-flow spacer, not padding on the layout root: the bar is
          lg:hidden, and a responsive height is something a class can express
          and an inline style on the root cannot. Sits after the footer, so
          the footer's last row clears the bar instead of hiding under it. */}
      <div
        aria-hidden
        className="lg:hidden shrink-0"
        style={{ height: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))` }}
      />
    <nav
      aria-label={lang === 'en' ? 'Main' : 'Principal'}
      className="lg:hidden fixed inset-x-0 bottom-0 z-40 bg-surface-cream border-t border-border shadow-[0_-4px_16px_rgba(0,0,0,0.06)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-stretch">
        {tabs.map((tab) => {
          // Home would otherwise match every route via startsWith.
          const active = tab.to === '/'
            ? location.pathname === '/'
            : current === tab.to || location.pathname.startsWith(tab.to.split('#')[0]);
          const Icon = tab.icon;
          const label = lang === 'en' ? tab.label_en : tab.label_es;
          const aria = lang === 'en' ? tab.aria_en : tab.aria_es;
          return (
            <button
              key={tab.to}
              type="button"
              onClick={() => navigate(tab.to)}
              aria-current={active ? 'page' : undefined}
              aria-label={aria ?? label}
              className="relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 h-[58px] px-1 active:bg-surface-linen transition-colors focus-visible:outline-none focus-visible:bg-surface-linen"
            >
              {/* Top marker — hover does not exist on a phone, so the active
                  tab needs a cue that colour alone does not carry at 10px. */}
              <span
                aria-hidden
                className={`absolute top-0 left-1/2 -translate-x-1/2 h-[3px] w-8 rounded-b-full bg-brand transition-opacity ${
                  active ? 'opacity-100' : 'opacity-0'
                }`}
              />
              <Icon
                size={20}
                strokeWidth={1.75}
                className={active ? 'text-brand' : 'text-ink/55'}
              />
              <span
                className={`text-[10px] font-ui leading-none truncate max-w-full ${
                  active ? 'text-brand font-bold' : 'text-ink/60 font-semibold'
                }`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
    </>
  );
}
