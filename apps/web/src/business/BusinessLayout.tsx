import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Home, Package, ShoppingCart, Receipt, Building2, UserRound, ChevronDown, ChevronRight, LogOut, Globe,
  ArrowLeft, ShieldOff, KeyRound, MapPin, LifeBuoy, Moon, Sun, SunMoon, Plus,
} from 'lucide-react';
import { useBusinessHome, useBusinessMe } from '@grocery-app/shared';
import { useAuthStore } from '@/stores/authStore';
import { useLanguageStore } from '@/stores/languageStore';
import { useCartStore } from '@/stores/cartStore';
import type { BusinessThemeChoice } from '@/stores/businessThemeStore';
import { useBusinessSeenStore } from '@/stores/businessSeenStore';
import { BackLinkSlotProvider, useBackLinkSlot, type BackTarget } from '@/sales/components/BackLinkSlot';
import { ToastProvider } from '@/sales/components/Toast';
import { Dialog } from '@/sales/components/Dialog';
import BusinessBell from './components/BusinessBell';
import { useBizT } from './lib/i18n';
import { useApplyBusinessTheme, useBusinessTheme } from './lib/theme';
import { unseenCount } from './lib/stories';

/**
 * Chrome for the business panel (2026-10-29, user: "When the user signs in as
 * a b2b user then they are going to see a dashboard just like the reps… use
 * the reps design vibes for it").
 *
 * The rep panel's layout (sales/SalesLayout), for a buyer: the same light
 * sidebar with the one act they open it for as its button — "Hacer un
 * pedido", into the catalogue — and their places below; on a phone, the same
 * floating tab bar with that act raised in the middle, and the account sheet
 * behind the pill at the top right. Drawn in the rep panel's tokens
 * (`.sales-app`), light or dark by the buyer's own choice (lib/theme).
 *
 * No Home Grocery anywhere: it is not for businesses (user, 2026-10-29).
 */

interface NavItem {
  key: string;
  label: string;
  /** The phone tab bar's name, where the full one doesn't fit a fifth of the screen. */
  short?: string;
  to: string;
  icon: React.ElementType;
  match: (pathname: string) => boolean;
  badge?: number;
  /** Something new waiting there that has no count — Cesto's unseen stories, on the home. */
  dot?: string;
}

function getInitials(name: string): string {
  return name.split(' ').map((p) => p[0]).filter(Boolean).join('').toUpperCase().slice(0, 2);
}

export default function BusinessLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);
  const hydrate = useAuthStore((s) => s.hydrate);
  const stillBusiness = useAuthStore((s) => !!s.user?.is_business);
  const signedIn = useAuthStore((s) => s.user);
  const { lang, setLang } = useLanguageStore();
  const t = useBizT();
  const theme = useBusinessTheme();
  useApplyBusinessTheme(theme.resolved);
  const { data: me, error } = useBusinessMe();
  const cartLines = useCartStore((s) => s.items.length);
  // Cesto's stories not opened yet: a dot on the home until they look (lib/stories).
  const { data: homeContent } = useBusinessHome();
  const unseen = unseenCount(homeContent, useBusinessSeenStore((s) => s.seen));
  const [accountOpen, setAccountOpen] = useState(false);

  /**
   * Approval can be withdrawn while the panel is open. /api/business/me is
   * the first call every screen makes, so its 403 is the earliest honest
   * signal; the User is then read again, and once it agrees they are not a
   * business any more the shop is theirs. Leaving on the 403 alone would loop
   * with the shop guard, which still reads the old flag (the rep panel's
   * lesson, sales/SalesLayout).
   */
  const revoked = (error as { status?: number } | null)?.status === 403;
  useEffect(() => {
    if (revoked && stillBusiness) hydrate();
  }, [revoked, stillBusiness, hydrate]);

  /** Checkout and editing an order are tasks with their own action bar: the tab bar steps aside. */
  const taskMode = location.pathname === '/business/checkout' || /^\/business\/orders\/[^/]+\/edit$/.test(location.pathname);
  /** The home floats on its blue sky (2026-10-31): the header turns to blue glass and the page runs full width. */
  const onSky = location.pathname === '/business';

  if (revoked && !stillBusiness) return <Navigate to="/" replace />;
  if (revoked) {
    return (
      <div className="sales-app min-h-screen bg-surface-linen flex items-center justify-center px-4">
        <div className="bg-card rounded-2xl shadow-float p-6 sm:p-8 w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-2xl bg-danger-bg text-danger grid place-items-center mx-auto mb-4">
            <ShieldOff size={26} strokeWidth={1.75} />
          </div>
          <h1 className="text-lg font-bold font-display text-ink">{t('biz.revoked.title')}</h1>
          <p className="text-sm font-body text-ink/60 mt-1.5">{t('biz.revoked.body')}</p>
          <button
            type="button"
            onClick={() => { hydrate(); navigate('/'); }}
            className="mt-5 w-full h-11 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display transition-colors"
          >
            {t('biz.revoked.toShop')}
          </button>
        </div>
      </div>
    );
  }

  const company = me?.business?.company ?? '';
  const person = signedIn?.name || me?.user.name || '';

  const navItems: NavItem[] = [
    { key: 'home', label: t('biz.nav.home'), to: '/business', icon: Home, match: (p) => p === '/business', dot: unseen > 0 ? t('biz.nav.homeNew') : undefined },
    { key: 'catalogue', label: t('biz.nav.catalogue'), to: '/business/catalogue', icon: Package, match: (p) => p.startsWith('/business/catalogue') || p.startsWith('/business/products') },
    { key: 'orders', label: t('biz.nav.orders'), to: '/business/orders', icon: Receipt, match: (p) => p.startsWith('/business/orders') },
    { key: 'cart', label: t('biz.nav.cart'), to: '/business/cart', icon: ShoppingCart, match: (p) => p === '/business/cart' || p === '/business/checkout', badge: cartLines },
    { key: 'account', label: t('biz.nav.account'), short: t('biz.nav.accountShort'), to: '/business/account', icon: Building2, match: (p) => p.startsWith('/business/account') },
  ];

  const signOut = async () => { setAccountOpen(false); await logout(); navigate('/login'); };

  return (
    <ToastProvider>
    <BackLinkSlotProvider>
    <div className="sales-app min-h-screen bg-surface-linen flex">
      <aside className="fixed left-0 top-0 bottom-0 w-[248px] bg-card border-r border-border/80 hidden lg:flex flex-col z-40">
        <div className="h-16 px-5 flex items-center gap-3 shrink-0">
          <img src="/cesto-icon.png" alt="" className="w-10 h-10 rounded-xl shadow-card" draggable={false} />
          <span className="text-[18px] font-bold font-display text-brand tracking-[-0.01em] whitespace-nowrap">{t('biz.brand')}</span>
        </div>

        <div className="px-4 pt-2 pb-4 shrink-0">
          {/* The action; "Catálogo" in the list below is the place (user, 2026-10-31: "Catalogue should be also a standalone tab on desktop"). */}
          <Link
            to="/business/catalogue"
            className="w-full h-12 rounded-xl bg-brand hover:bg-brand-mid text-white text-[15px] font-semibold font-display inline-flex items-center justify-center gap-2 shadow-[0_10px_22px_-10px_rgba(5,78,232,0.7)] transition-colors"
          >
            <Plus size={19} strokeWidth={2.25} />
            {t('biz.nav.startOrder')}
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label={t('biz.nav.menu')}>
          <ul className="space-y-1">
            {navItems.map((item) => {
              const active = item.match(location.pathname);
              return (
                <li key={item.key}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/business'}
                    aria-current={active ? 'page' : undefined}
                    className={`relative h-11 px-3 rounded-xl flex items-center gap-3 text-[14.5px] font-display transition-colors ${
                      active ? 'bg-brand-whisper text-brand font-semibold' : 'text-gray font-medium hover:bg-surface-cream hover:text-ink'
                    }`}
                  >
                    {active && <span className="absolute -left-3 top-2.5 bottom-2.5 w-1 rounded-r-full bg-brand" aria-hidden="true" />}
                    <item.icon size={20} strokeWidth={active ? 2 : 1.75} className="shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {item.dot && !item.badge && (
                      <span className="w-2.5 h-2.5 rounded-full bg-brand ring-2 ring-brand-mist" role="status" aria-label={item.dot} />
                    )}
                    {!!item.badge && (
                      <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-brand text-white text-[11.5px] font-bold leading-[22px] text-center tabular-nums" aria-label={t(item.badge === 1 ? 'biz.cartCount_one' : 'biz.cartCount_other', { count: item.badge })}>
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="p-3 shrink-0">
          <div className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 bg-surface-cream border border-border">
            <div className="w-9 h-9 rounded-full bg-brand-whisper text-brand ring-1 ring-inset ring-brand-mist flex items-center justify-center text-xs font-bold font-display shrink-0">
              {company || person ? getInitials(company || person) : 'C'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-ink text-[14px] font-semibold font-display truncate">{company || person || '—'}</p>
              <p className="text-muted text-[12px] truncate">{company ? person : signedIn?.email}</p>
            </div>
            <button
              onClick={signOut}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-muted hover:text-danger hover:bg-danger-bg transition-colors shrink-0"
              aria-label={t('biz.logout')}
            >
              <LogOut size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-screen min-w-0 lg:ml-[248px]">
        <header className={`h-14 sticky top-0 z-20 px-2 sm:px-6 lg:px-8 items-center justify-between shrink-0 gap-2 ${onSky ? 'hidden lg:flex biz-sky-glass' : 'flex bg-surface-linen'}`}>
          <HeaderBackLink onSky={onSky} />
          <div className="ml-auto flex items-center gap-2.5 pr-2 sm:pr-0">
            <button
              onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
              className="hidden lg:inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-border bg-card text-gray hover:text-ink hover:border-ink/30 text-xs font-semibold font-display transition-colors"
              aria-label={t('biz.language')}
            >
              <Globe size={14} strokeWidth={1.75} />
              {lang === 'es' ? 'ES' : 'EN'}
            </button>
            <button
              type="button"
              onClick={() => theme.setChoice(theme.resolved === 'dark' ? 'light' : 'dark')}
              className="hidden lg:inline-flex items-center justify-center w-9 h-9 rounded-full border border-border bg-card text-gray hover:text-ink hover:border-ink/30 transition-colors"
              aria-label={theme.resolved === 'dark' ? t('biz.theme.toLight') : t('biz.theme.toDark')}
              title={theme.resolved === 'dark' ? t('biz.theme.toLight') : t('biz.theme.toDark')}
            >
              {theme.resolved === 'dark' ? <Sun size={15} strokeWidth={1.9} /> : <Moon size={15} strokeWidth={1.9} />}
            </button>
            <BusinessBell />
            <AccountButton open={accountOpen} onOpen={() => setAccountOpen(true)} />
          </div>
        </header>

        <main className={`flex-1 bg-surface-linen px-4 pt-3 sm:px-6 sm:pt-4 lg:px-8 lg:pt-2 ${taskMode ? '' : 'pb-[calc(7.5rem+env(safe-area-inset-bottom))] lg:pb-10'}`}>
          <div className={onSky ? 'w-full' : 'w-full max-w-[1600px] mx-auto'}><Outlet /></div>
        </main>
      </div>

      {!taskMode && <TabBar pathname={location.pathname} items={navItems} orderLabel={t('biz.nav.order')} onSky={onSky} />}

      {accountOpen && (
        <AccountSheet
          name={company || person}
          detail={company ? `${person}${signedIn?.email ? ` · ${signedIn.email}` : ''}` : (signedIn?.email ?? '')}
          lang={lang}
          onLang={setLang}
          theme={theme.choice}
          onTheme={theme.setChoice}
          onClose={() => setAccountOpen(false)}
          go={(to) => { setAccountOpen(false); navigate(to, { state: { from: location.pathname } }); }}
          onLogout={signOut}
        />
      )}
    </div>
    </BackLinkSlotProvider>
    </ToastProvider>
  );
}

/** The page's way back with its title, or — on a phone with nowhere to go back to — whose panel this is. */
function HeaderBackLink({ onSky = false }: { onSky?: boolean }) {
  const { target } = useBackLinkSlot();
  const t = useBizT();
  if (!target) {
    // On the sky the page carries the big wordmark itself, so the bar stays quiet.
    if (onSky) return <div className="lg:hidden" />;
    return (
      <div className="lg:hidden flex items-center gap-2.5 pl-2 min-w-0">
        <img src="/cesto-icon.png" alt="" className="w-9 h-9 rounded-xl shadow-card shrink-0" draggable={false} />
        <span className="text-[17px] font-bold font-display tracking-[-0.01em] whitespace-nowrap shrink-0 text-brand">{t('biz.brand')}</span>
      </div>
    );
  }
  return (
    <>
      <div className="lg:hidden flex items-center gap-1 min-w-0">
        <button
          type="button"
          onClick={target.onClick}
          aria-label={target.label}
          className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center transition-colors text-ink hover:bg-surface-cream"
        >
          <ArrowLeft size={20} strokeWidth={2} />
        </button>
        <span className="text-[16px] font-bold font-display truncate text-ink">{target.title ?? target.label}</span>
      </div>
      <DesktopBackLink target={target} />
    </>
  );
}

function DesktopBackLink({ target }: { target: BackTarget }) {
  return (
    <div className="hidden lg:flex items-center gap-2.5 min-w-0">
      <button
        type="button"
        onClick={target.onClick}
        className="inline-flex items-center gap-1.5 min-w-0 max-w-[320px] h-9 -ml-1 px-2 rounded-lg text-[13px] font-semibold transition-colors text-muted hover:text-brand hover:bg-surface-cream"
      >
        <ArrowLeft size={16} strokeWidth={2} className="shrink-0" />
        <span className="truncate">{target.label}</span>
      </button>
      {target.title && (
        <>
          <span className="w-px h-5 bg-border" aria-hidden="true" />
          <h1 className="text-base font-bold font-display truncate text-ink">{target.title}</h1>
        </>
      )}
    </div>
  );
}

function AccountButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const t = useBizT();
  const { target } = useBackLinkSlot();
  // "Cesto Business" is longer than the rep panel's "Cesto Sales": below
  // 430px the label gives way so the bar's brand stays whole (SalesLayout).
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={t('biz.account.title')}
      className={`h-10 rounded-full flex items-center gap-2 pl-1 transition-colors ${target ? 'pr-1 lg:pr-3' : 'pr-3 max-[429px]:pr-1'} bg-card border border-brand-mist text-brand hover:border-brand/40 shadow-card`}
    >
      <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-brand text-white">
        <UserRound size={17} strokeWidth={1.75} />
      </span>
      <span className={`text-[13.5px] font-semibold font-display whitespace-nowrap ${target ? 'hidden lg:inline' : 'max-[429px]:hidden'}`}>
        {t('biz.account.pill')}
      </span>
      <ChevronDown size={15} strokeWidth={2} className={target ? 'hidden lg:block' : 'max-[429px]:hidden'} />
    </button>
  );
}

/**
 * The phone's way around (sales/SalesLayout's TabBar): Inicio, Pedidos, the
 * raised "Crear pedido" into the catalogue, Carrito with its count, Perfil (de empresa).
 */
function TabBar({ pathname, items, orderLabel, onSky = false }: { pathname: string; items: NavItem[]; orderLabel: string; onSky?: boolean }) {
  const byKey = Object.fromEntries(items.map((i) => [i.key, i])) as Record<string, NavItem>;
  const tab = (x: NavItem) => {
    const active = x.match(pathname);
    return (
      <NavLink
        key={x.key}
        to={x.to}
        end={x.to === '/business'}
        className="flex flex-col items-center justify-center gap-1 h-full min-w-0 active:opacity-70"
        aria-current={active ? 'page' : undefined}
      >
        <span className={`relative w-14 h-8 rounded-full flex items-center justify-center transition-colors ${active ? 'bg-brand-mist text-brand' : 'text-gray'}`}>
          <x.icon size={21} strokeWidth={active ? 2 : 1.75} />
          {x.dot && !x.badge && (
            <span className="absolute top-0.5 right-3 w-2.5 h-2.5 rounded-full bg-brand ring-2 ring-card" role="status" aria-label={x.dot} />
          )}
          {!!x.badge && (
            <span className="absolute top-0 right-2 min-w-[17px] h-[17px] px-1 rounded-full bg-brand text-white text-[10px] font-bold leading-[17px] text-center tabular-nums ring-2 ring-card">
              {x.badge > 99 ? '99+' : x.badge}
            </span>
          )}
        </span>
        <span className={`text-[11px] font-display leading-none whitespace-nowrap ${active ? 'font-semibold text-brand' : 'font-medium text-gray'}`}>{x.short ?? x.label}</span>
      </NavLink>
    );
  };
  const catalogueActive = byKey.catalogue.match(pathname);
  return (
    <nav aria-label="Cesto Business" className="lg:hidden fixed z-30 inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))]">
      {/* The raised middle is a little wider, for "Crear pedido" on a 360px phone. */}
      <div className="grid grid-cols-[1fr_1fr_1.3fr_1fr_1fr] items-center h-[68px] max-w-lg mx-auto px-1 rounded-[24px] bg-card border border-border shadow-[0_18px_40px_-16px_rgba(13,27,46,0.32)]">
        {tab(byKey.home)}
        {tab(byKey.orders)}
        <NavLink
          to="/business/catalogue"
          aria-current={catalogueActive ? 'page' : undefined}
          className="flex flex-col items-center justify-end h-full pb-[9px] gap-1 active:scale-95 transition-transform"
        >
          <span className={`w-14 h-14 -mt-7 rounded-full bg-gradient-to-br from-[#2F6EF0] to-brand text-white flex items-center justify-center shadow-[0_10px_20px_-6px_rgba(5,78,232,0.55)] ring-[5px] ${onSky ? 'ring-white/25' : 'ring-surface-linen'}`}>
            <Package size={25} strokeWidth={2} />
          </span>
          <span className="text-[11px] font-display font-semibold text-brand leading-none whitespace-nowrap">{orderLabel}</span>
        </NavLink>
        {tab(byKey.cart)}
        {tab(byKey.account)}
      </div>
    </nav>
  );
}

/** Who they are, and what a sidebar footer would hold: language, appearance, their business, addresses, password, help, signing out. */
function AccountSheet({ name, detail, lang, onLang, theme, onTheme, onClose, go, onLogout }: {
  name: string;
  detail: string;
  lang: 'es' | 'en';
  onLang: (l: 'es' | 'en') => void;
  theme: BusinessThemeChoice;
  onTheme: (c: BusinessThemeChoice) => void;
  onClose: () => void;
  go: (to: string) => void;
  onLogout: () => void;
}) {
  const t = useBizT();
  const row = (icon: React.ElementType, label: string, onClick: () => void, danger = false) => {
    const Icon = icon;
    return (
      <button
        type="button"
        onClick={onClick}
        className={`w-full min-h-[52px] px-4 flex items-center gap-3 text-left transition-colors hover:bg-surface-cream ${danger ? 'text-danger' : 'text-ink'}`}
      >
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-danger-bg text-danger' : 'bg-surface-cream text-gray'}`}>
          <Icon size={18} strokeWidth={1.75} />
        </span>
        <span className="flex-1 text-[15px] font-semibold font-display">{label}</span>
        {!danger && <ChevronRight size={17} strokeWidth={1.75} className="text-muted" />}
      </button>
    );
  };
  return (
    <Dialog
      variant="popover"
      onClose={onClose}
      ariaLabel={t('biz.account.title')}
      closeLabel={t('biz.closeMenu')}
      title={<span className="block truncate">{name || '—'}</span>}
      subtitle={detail}
      leading={(
        <span className="w-11 h-11 rounded-full bg-brand-whisper text-brand ring-1 ring-inset ring-brand-mist flex items-center justify-center text-sm font-bold font-display shrink-0">
          {name ? getInitials(name) : 'C'}
        </span>
      )}
      bodyClassName="p-0"
    >
      <div className="py-2">
        <div className="min-h-[52px] px-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-surface-cream text-gray flex items-center justify-center shrink-0"><Globe size={18} strokeWidth={1.75} /></span>
          <span className="flex-1 text-[15px] font-semibold font-display text-ink">{t('biz.account.language')}</span>
          <span className="inline-flex rounded-xl bg-surface-sand p-1 gap-0.5">
            {(['es', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onLang(l)}
                aria-pressed={lang === l}
                className={`h-7 px-3 rounded-lg text-xs font-bold font-display transition-colors ${lang === l ? 'bg-card text-ink shadow-card' : 'text-gray hover:text-ink'}`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </span>
        </div>
        <div className="min-h-[52px] px-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-surface-cream text-gray flex items-center justify-center shrink-0">
            {theme === 'dark' ? <Moon size={18} strokeWidth={1.75} /> : theme === 'light' ? <Sun size={18} strokeWidth={1.75} /> : <SunMoon size={18} strokeWidth={1.75} />}
          </span>
          <span className="flex-1 min-w-0 text-[15px] font-semibold font-display text-ink">{t('biz.account.theme')}</span>
          <span className="inline-flex rounded-xl bg-surface-sand p-1 gap-0.5 shrink-0" role="group" aria-label={t('biz.account.theme')}>
            {(['light', 'dark', 'system'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onTheme(c)}
                aria-pressed={theme === c}
                className={`h-7 px-2.5 rounded-lg text-xs font-bold font-display transition-colors ${theme === c ? 'bg-card text-ink shadow-card' : 'text-gray hover:text-ink'}`}
              >
                {t(`biz.theme.${c}`)}
              </button>
            ))}
          </span>
        </div>
        {row(Building2, t('biz.account.company'), () => go('/business/account'))}
        {row(MapPin, t('biz.account.addresses'), () => go('/business/account/addresses'))}
        {row(KeyRound, t('biz.account.changePassword'), () => go('/business/change-password'))}
        {row(LifeBuoy, t('biz.account.help'), () => { onClose(); window.open('/help', '_blank', 'noopener'); })}
      </div>
      <div className="border-t border-border py-2">
        {row(LogOut, t('biz.logout'), onLogout, true)}
      </div>
    </Dialog>
  );
}
