import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Users, ShoppingCart, UserPlus, Plus, Home, Package, UserRound, ChevronDown,
  LogOut, Globe, ArrowLeft, ShieldOff, KeyRound, ChevronRight, Store, AlertTriangle, Wallet,
  Moon, Sun, SunMoon,
} from 'lucide-react';
import { repStoresOf, useSalesMe, type SalesRepStore } from '@grocery-app/shared';
import { assignedOf, listNames, sellingLine, splitShops } from './lib/shops';
import { useAuthStore } from '@/stores/authStore';
import { useLanguageStore } from '@/stores/languageStore';
import { useSalesT } from './lib/i18n';
import { BackLinkSlotProvider, useBackLinkSlot, type BackTarget } from './components/BackLinkSlot';
import { ToastProvider } from './components/Toast';
import NotificationBell from './components/NotificationBell';
import { Dialog } from './components/Dialog';
import { useApplySalesTheme, useSalesTheme } from './lib/theme';
import type { SalesThemeChoice } from '@/stores/salesThemeStore';

/**
 * Chrome for the rep surface — admin's layout, ported.
 *
 * Mirrors apps/admin/src/layouts/AdminLayout.tsx: the same 240px near-black
 * sidebar, the same titled nav sections, the same off-canvas drawer below lg,
 * the same h-14 white header carrying the language toggle and avatar, and the
 * same bottom user block. A rep and an admin should not have to learn two
 * products.
 *
 * `.sales-app` on the root is what makes the ported markup render correctly:
 * apps/web resolves `--color-surface-cream` to pure white and `--color-ink` to
 * slate, so admin's table headers and body text come out wrong without the
 * scoped palette in app.css.
 *
 * NOT ported: the notifications bell, because nothing notifies a rep yet. The
 * back-link slot IS here — a page's way back shows in the top bar, from one
 * call site per page.
 *
 * ON A PHONE IT IS AN APP, not the desktop squeezed (2026-10-26, user: "it will
 * be extensively used by reps on mobile so it should feel like a mobile app").
 * Below lg there is no sidebar and no hamburger: a bottom tab bar — Hoy,
 * Pedidos, the new-order button, Clientes, Catálogo — within reach of the thumb
 * holding the phone, and a slim top bar carrying the page's way back. What the
 * sidebar's footer held (language, earnings, sign out) is the Cuenta sheet,
 * behind the avatar at the top right — it had a tab of its own until the
 * catalogue needed the slot (2026-10-26). A task — building or editing an
 * order, opening a client — keeps the whole screen, and its own action bar, so
 * the tabs step aside.
 *
 * LIGHT OR DARK (2026-10-28): the rep's choice — or their device's, the
 * default — is put on <html> here for as long as the panel is open
 * (lib/theme). "Apariencia" in the Cuenta sheet chooses; on a desk a sun or a
 * moon beside the language switches straight across.
 */

interface NavItem {
  label: string;
  to: string;
  icon: React.ElementType;
  /** Overrides NavLink's prefix matching where one row sits under another —
   *  /sales/orders would otherwise light up on /sales/orders/new. */
  match?: (pathname: string) => boolean;
}

function getInitials(name: string): string {
  return name.split(' ').map((p) => p[0]).filter(Boolean).join('').toUpperCase().slice(0, 2);
}

export default function SalesLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);
  const { lang, setLang } = useLanguageStore();
  const t = useSalesT();
  const { data, error } = useSalesMe();
  const theme = useSalesTheme();
  useApplySalesTheme(theme.resolved);

  /**
   * The role can be revoked while a rep is standing in a shop with the app
   * open. The route guard reads a flag off the cached User and would keep
   * rendering these screens while every call behind them returned 403 — a
   * surface that looks like it works and does nothing.
   *
   * /sales/me is the first call any of these pages makes, so its refusal is the
   * earliest honest signal. 403 specifically: a 401 is handled by the client,
   * which refreshes the token or signs them out, and a network error is not a
   * revocation — bouncing on one would throw a rep out of the app because a
   * shop has bad reception.
   */
  const revoked = (error as { status?: number } | null)?.status === 403;

  /**
   * Refetch the User as well as leaving. The guard reads `is_sales_rep` off the
   * persisted store, so without this a rep bounced to `/` walks straight back
   * in on the next tap — the flag would still say they are one. hydrate() goes
   * to /api/users/me, which is now the authority on that.
   */
  const hydrate = useAuthStore((s) => s.hydrate);
  const stillFlaggedAsRep = useAuthStore((s) => !!s.user?.is_sales_rep);

  // The Cuenta sheet: who they are, their shops, language, their earnings,
  // password, sign out. Closed by its own buttons rather than an
  // effect on the pathname, for the reason the old drawer gave: a setState in
  // an effect is a second render on every navigation, and this app's lint
  // forbids it. Escape and the scroll lock are the Dialog's.
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    if (revoked && stillFlaggedAsRep) hydrate();
  }, [revoked, stillFlaggedAsRep, hydrate]);

  /**
   * Identity from the AUTH STORE; /sales/me only fills in the staff number.
   *
   * The store is already hydrated before this renders — the route guard read
   * `is_sales_rep` off the same object to let them in — so the sidebar says
   * who they are on first paint instead of an em-dash that resolves a moment
   * later, or stays an em-dash if the request is slow.
   */
  /**
   * Routes that take the whole window.
   *
   * Admin's own rule, for admin's own reason: building an order is a task, not
   * a place. The catalogue wants every pixel of width and there is nothing
   * useful to navigate to half way through one, so the sidebar slides out and
   * the content loses its offset.
   *
   * The page already assumes this — it is a copy of admin's, and it draws its
   * own gutters and hands its title to the bar. Without the mode here those
   * gutters sat inside the layout's padding and the sidebar stayed put, which
   * is the one way the ported screen did not match.
   */
  const focusMode = location.pathname === '/sales/orders/new'
    || /^\/sales\/orders\/[^/]+\/edit$/.test(location.pathname);
  /**
   * Screens that are a task with their own action bar fixed to the bottom of a
   * phone: the order builder and the new-client steps. The tab bar steps aside
   * for them rather than stacking a second bar on top of theirs.
   */
  const taskMode = focusMode || location.pathname === '/sales/clients/new';

  const signedIn = useAuthStore((st) => st.user);
  const me = {
    name: signedIn?.name || data?.user.name || '',
    email: signedIn?.email || data?.user.email || '',
  };

  // Below every hook: an early return above one changes the hook order between
  // renders, which is a crash rather than a style problem.
  //
  // LEAVING WAITS FOR THE FLAG, in two steps rather than one.
  //
  // A revoked rep is an ordinary customer again, so `/` is where they belong —
  // but CustomerOnlyRoute decides that from `is_sales_rep` on the persisted
  // User, which still says `true` until the hydrate() above lands. Redirecting
  // on `revoked` alone sent them to `/`, which sent them back to `/sales`,
  // which still held the cached 403: a tight loop between two redirects.
  //
  // So the exit is taken only once the store agrees they are not a rep. Until
  // then they are told why their screens stopped working, which also beats the
  // old behaviour of silently landing on the shop with no explanation.
  if (revoked && !stillFlaggedAsRep) return <Navigate to="/" replace />;

  if (revoked) {
    return (
      <div className="sales-app min-h-screen bg-surface-linen flex items-center justify-center px-4">
        <div className="bg-card rounded-2xl shadow-float p-6 sm:p-8 w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-2xl bg-danger-bg text-danger grid place-items-center mx-auto mb-4">
            <ShieldOff size={26} strokeWidth={1.75} />
          </div>
          <h1 className="text-lg font-bold font-display text-ink">
            {t('sales.revoked.title')}
          </h1>
          <p className="text-sm font-body text-ink/60 mt-1.5">
            {t('sales.revoked.body')}
          </p>
          {/* Always works, even if the refetch above cannot reach the API —
              otherwise a rep revoked while offline waits on a spinner. */}
          <button
            type="button"
            onClick={async () => { await logout(); navigate('/login'); }}
            className="mt-5 w-full h-11 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display transition-colors"
          >
            {t('sales.revoked.signOut')}
          </button>
        </div>
      </div>
    );
  }

  /**
   * The desktop's places, in the phone tab bar's order, so a rep who uses
   * both finds them where they left them. Creating is not a place: "Nuevo
   * pedido" is the button above them, "Nuevo cliente" a quieter row below.
   */
  const navItems: NavItem[] = [
    { label: t('sales.nav.today'), to: '/sales', icon: Home, match: (p) => p === '/sales' },
    {
      label: t('sales.nav.orders'),
      to: '/sales/orders',
      icon: ShoppingCart,
      // An order too, but not the builder — that is the button above.
      match: (p) => p === '/sales/orders' || (/^\/sales\/orders\/[^/]+$/.test(p) && p !== '/sales/orders/new'),
    },
    { label: t('sales.nav.catalogue'), to: '/sales/catalogue', icon: Package, match: (p) => p === '/sales/catalogue' || p.startsWith('/sales/catalogue/') },
    {
      label: t('sales.nav.myClients'),
      to: '/sales/clients',
      icon: Users,
      // A client's profile too — not the new-client form, its own row.
      match: (p) => p.startsWith('/sales/clients') && p !== '/sales/clients/new',
    },
    { label: t('sales.nav.earnings'), to: '/sales/earnings', icon: Wallet, match: (p) => p.startsWith('/sales/earnings') },
  ];

  // ToastProvider is scoped to this surface rather than mounted app-wide: the
  // customer storefront has its own notification chrome, and two toast stacks
  // on one page is worse than either.
  return (
    <ToastProvider>
    <BackLinkSlotProvider>
    <div className="sales-app min-h-screen bg-surface-linen flex">
      {/* The desktop's sidebar, in the panel's own style (2026-10-26): light,
          the brand on top, the one act a rep opens the app for as its button,
          their places as rows with the current one on a tinted pill — the
          phone tab bar's look. A phone has the tab bar instead. */}
      <aside
        className={`fixed left-0 top-0 bottom-0 w-[248px] bg-card border-r border-border/80 hidden flex-col z-40 ${focusMode ? '' : 'lg:flex'}`}
      >
        <div className="h-16 px-5 flex items-center gap-3 shrink-0">
          <img src="/cesto-icon.png" alt="" className="w-10 h-10 rounded-xl shadow-card" draggable={false} />
          <span className="text-[18px] font-bold font-display text-brand tracking-[-0.01em] whitespace-nowrap">{t('sales.brand')}</span>
        </div>

        <div className="px-4 pt-2 pb-4 shrink-0">
          <NavLink
            to="/sales/orders/new"
            className="w-full h-12 rounded-xl bg-brand hover:bg-brand-mid text-white text-[15px] font-semibold font-display inline-flex items-center justify-center gap-2 shadow-[0_10px_22px_-10px_rgba(5,78,232,0.7)] transition-colors"
          >
            <Plus size={19} strokeWidth={2.25} />
            {t('sales.nav.newOrder')}
          </NavLink>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label={t('sales.nav.menu')}>
          <ul className="space-y-1">
            {navItems.map((item) => {
              const active = item.match ? item.match(location.pathname) : location.pathname === item.to;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/sales'}
                    aria-current={active ? 'page' : undefined}
                    className={`relative h-11 px-3 rounded-xl flex items-center gap-3 text-[14.5px] font-display transition-colors ${
                      active ? 'bg-brand-whisper text-brand font-semibold' : 'text-gray font-medium hover:bg-surface-cream hover:text-ink'
                    }`}
                  >
                    {active && <span className="absolute -left-3 top-2.5 bottom-2.5 w-1 rounded-r-full bg-brand" aria-hidden="true" />}
                    <item.icon size={20} strokeWidth={active ? 2 : 1.75} className="shrink-0" />
                    {item.label}
                  </NavLink>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 pt-3 border-t border-border/70">
            <NavLink
              to="/sales/clients/new"
              className={({ isActive }) => `h-11 px-3 rounded-xl flex items-center gap-3 text-[14.5px] font-display transition-colors ${
                isActive ? 'bg-brand-whisper text-brand font-semibold' : 'text-gray font-medium hover:bg-surface-cream hover:text-ink'
              }`}
            >
              <UserPlus size={20} strokeWidth={1.75} className="shrink-0" />
              {t('sales.nav.newClient')}
            </NavLink>
          </div>
        </nav>

        <div className="p-3 shrink-0">
          <div className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 bg-surface-cream border border-border">
            <div className="w-9 h-9 rounded-full bg-brand-whisper text-brand ring-1 ring-inset ring-brand-mist flex items-center justify-center text-xs font-bold font-display shrink-0">
              {me.name ? getInitials(me.name) : 'C'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-ink text-[14px] font-semibold font-display truncate">{me.name || '—'}</p>
              <p className="text-muted text-[12px] truncate">{data?.rep.code ?? me.email}</p>
            </div>
            <button
              onClick={async () => { await logout(); navigate('/login'); }}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-muted hover:text-danger hover:bg-danger-bg transition-colors shrink-0"
              aria-label={t('sales.logout')}
            >
              <LogOut size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main area — no left offset on a phone, the sidebar's width from lg. */}
      <div className={`flex-1 flex flex-col min-h-screen min-w-0 ${focusMode ? '' : 'lg:ml-[248px]'}`}>
        {/* A focus route recolours THIS bar rather than drawing another one
            under it. The page has no chrome of its own on these routes, and a
            second bar just repeats the account that is already on the right of
            this one. */}
        {/* On a phone the bar sits on the page's own canvas, as an app's
            does; the desktop keeps admin's white bar with its rule. Solid,
            not frosted: a backdrop-filter makes the bar the containing block
            of anything fixed inside it, and the bell's inbox lives inside. */}
        <header className={`h-14 sticky top-0 z-20 px-2 sm:px-6 lg:px-8 flex items-center justify-between shrink-0 gap-2 ${
          focusMode ? 'bg-brand' : 'bg-surface-linen'
        }`}>
          {/* The page's way back, with its title — or, on a phone with nowhere
              to go back to, whose app this is. */}
          <HeaderBackLink onDark={focusMode} />

          <div className="ml-auto flex items-center gap-2.5 pr-2 sm:pr-0">
            {/* On a phone, language lives in the Cuenta sheet: this bar is the
                page's title and the way back, and a third control crowds it. */}
            <button
              onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
              className={`hidden lg:inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-xs font-semibold font-display transition-colors ${
                focusMode
                  ? 'border-white/30 bg-white/10 text-white hover:bg-white/20'
                  : 'border-border bg-card text-gray hover:text-ink hover:border-ink/30'
              }`}
              aria-label={t('sales.language')}
            >
              <Globe size={14} strokeWidth={1.75} />
              {lang === 'es' ? 'ES' : 'EN'}
            </button>
            <button
              type="button"
              onClick={() => theme.setChoice(theme.resolved === 'dark' ? 'light' : 'dark')}
              className={`hidden lg:inline-flex items-center justify-center w-9 h-9 rounded-full border transition-colors ${
                focusMode
                  ? 'border-white/30 bg-white/10 text-white hover:bg-white/20'
                  : 'border-border bg-card text-gray hover:text-ink hover:border-ink/30'
              }`}
              aria-label={theme.resolved === 'dark' ? t('sales.theme.toLight') : t('sales.theme.toDark')}
              title={theme.resolved === 'dark' ? t('sales.theme.toLight') : t('sales.theme.toDark')}
            >
              {theme.resolved === 'dark' ? <Sun size={15} strokeWidth={1.9} /> : <Moon size={15} strokeWidth={1.9} />}
            </button>
            <NotificationBell onDark={focusMode} />
            <AccountButton onDark={focusMode} open={accountOpen} onOpen={() => setAccountOpen(true)} />
          </div>
        </header>

        {/* A focus route manages its own gutters — it is laying out two full
            columns, not sitting in a page frame. Everywhere the page is the
            linen canvas with white cards on it, as the rest of Cesto is, in
            one frame: the same gutters, and a width that grows with the screen
            up to where a line of cards stops being readable. Below lg the tab
            bar is fixed over the bottom, so the page ends above it. */}
        <main className={`flex-1 bg-surface-linen ${
          focusMode ? '' : 'px-4 pt-3 sm:px-6 sm:pt-4 lg:px-8 lg:pt-2'
        } ${taskMode ? '' : 'pb-[calc(7.5rem+env(safe-area-inset-bottom))] lg:pb-10'}`}>
          {focusMode ? <Outlet /> : <div className="w-full max-w-[1600px] mx-auto"><Outlet /></div>}
        </main>
      </div>

      {!taskMode && (
        <TabBar
          pathname={location.pathname}
          labels={{
            today: t('sales.nav.today'),
            orders: t('sales.nav.orders'),
            newOrder: t('sales.nav.newOrder'),
            clients: t('sales.nav.myClients'),
            catalogue: t('sales.nav.catalogue'),
          }}
        />
      )}

      {accountOpen && (
        <AccountSheet
          name={me.name}
          detail={data?.rep.code ?? me.email}
          stores={repStoresOf(data)}
          assigned={assignedOf(data)}
          lang={lang}
          onLang={setLang}
          theme={theme.choice}
          onTheme={theme.setChoice}
          onClose={() => setAccountOpen(false)}
          onEarnings={() => { setAccountOpen(false); navigate('/sales/earnings'); }}
          onChangePassword={() => { setAccountOpen(false); navigate('/sales/change-password', { state: { from: location.pathname } }); }}
          onLogout={async () => { setAccountOpen(false); await logout(); navigate('/login'); }}
          t={t}
        />
      )}
    </div>
    </BackLinkSlotProvider>
    </ToastProvider>
  );
}

/**
 * Draws whatever the current page registered, or nothing.
 *
 * Its own component so that setting a back target re-renders this line rather
 * than the whole layout — the sidebar and the drawer have no stake in which
 * page is showing. Ported from AdminLayout's component of the same name.
 */
function HeaderBackLink({ onDark = false }: { onDark?: boolean }) {
  const { target } = useBackLinkSlot();
  const t = useSalesT();
  if (!target) {
    // A top-level screen on a phone: the tab bar is the way around, so the bar
    // says whose app this is instead of offering a way back.
    return (
      <div className="lg:hidden flex items-center gap-2.5 pl-2 min-w-0">
        <img src="/cesto-icon.png" alt="" className="w-9 h-9 rounded-xl shadow-card shrink-0" draggable={false} />
        {/* Whole, always: at the narrowest widths "Mi cuenta" gives way
            instead (AccountButton). */}
        <span className={`text-[17px] font-bold font-display tracking-[-0.01em] whitespace-nowrap shrink-0 ${onDark ? 'text-white' : 'text-brand'}`}>
          {t('sales.brand')}
        </span>
      </div>
    );
  }
  return (
    <>
      {/* A phone: the arrow and this screen's name, as an app's bar has. The
          destination is in the arrow's label for screen readers. */}
      <div className="lg:hidden flex items-center gap-1 min-w-0">
        <button
          type="button"
          onClick={target.onClick}
          aria-label={target.label}
          className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center transition-colors ${
            onDark ? 'text-white hover:bg-white/10' : 'text-ink hover:bg-surface-cream'
          }`}
        >
          <ArrowLeft size={20} strokeWidth={2} />
        </button>
        <span className={`text-[16px] font-bold font-display truncate ${onDark ? 'text-white' : 'text-ink'}`}>
          {target.title ?? target.label}
        </span>
      </div>
      <DesktopBackLink target={target} onDark={onDark} />
    </>
  );
}

function DesktopBackLink({ target, onDark }: { target: BackTarget; onDark: boolean }) {
  return (
    <div className="hidden lg:flex items-center gap-2.5 min-w-0">
      <button
        type="button"
        onClick={target.onClick}
        className={`inline-flex items-center gap-1.5 min-w-0 max-w-[320px] h-9 -ml-1 px-2 rounded-lg text-[13px] font-semibold transition-colors ${
          onDark
            ? 'text-white/85 hover:text-white hover:bg-white/10'
            : 'text-muted hover:text-brand hover:bg-surface-cream'
        }`}
      >
        <ArrowLeft size={16} strokeWidth={2} className="shrink-0" />
        <span className="truncate">{target.label}</span>
      </button>
      {/* The page's heading, in the bar the back link already occupies. */}
      {target.title && (
        <>
          <span className={`w-px h-5 ${onDark ? 'bg-white/25' : 'bg-border'}`} aria-hidden="true" />
          <h1 className={`text-base font-bold font-display truncate ${onDark ? 'text-white' : 'text-ink'}`}>
            {target.title}
          </h1>
        </>
      )}
    </div>
  );
}

/**
 * Their account: a "Mi cuenta" pill, as the mockup draws it (2026-10-26).
 * On a phone screen that has a title in the bar, only the avatar — the title
 * needs the width more than the word does.
 */
function AccountButton({ onDark, open, onOpen }: { onDark: boolean; open: boolean; onOpen: () => void }) {
  const t = useSalesT();
  const { target } = useBackLinkSlot();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={t('sales.account.title')}
      // Below 380px the pill is the avatar alone, so the wordmark beside it
      // stays whole ("My account" is the longer of the two languages).
      className={`h-10 rounded-full flex items-center gap-2 pl-1 transition-colors ${target ? 'pr-1 lg:pr-3' : 'pr-3 max-[379px]:pr-1'} ${
        onDark
          ? 'bg-white/15 border border-white/25 text-white hover:bg-white/20'
          : 'bg-card border border-brand-mist text-brand hover:border-brand/40 shadow-card'
      }`}
    >
      <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${onDark ? 'bg-white/20' : 'bg-brand text-white'}`}>
        <UserRound size={17} strokeWidth={1.75} />
      </span>
      <span className={`text-[13.5px] font-semibold font-display whitespace-nowrap ${target ? 'hidden lg:inline' : 'max-[379px]:hidden'}`}>
        {t('sales.account.pill')}
      </span>
      <ChevronDown size={15} strokeWidth={2} className={target ? 'hidden lg:block' : 'max-[379px]:hidden'} />
    </button>
  );
}

/**
 * The phone's way around: the four places a rep works from and the act the
 * job is, within reach of the thumb holding the phone. Their account is the
 * pill in the top bar.
 *
 * A floating card rather than a bar glued to the edge (the mockup's, 2026-10-26):
 * it reads as the app's own control, clear of the system's gesture area. The
 * new-order button sits in the middle, raised, because starting an order for
 * the client in front of them is what a rep opens the app to do. The active
 * tab sits on a tinted pill, icon and word together — legible in a shop's
 * light and to someone who does not see blue.
 */
function TabBar({ pathname, labels }: {
  pathname: string;
  labels: { today: string; orders: string; newOrder: string; clients: string; catalogue: string };
}) {
  const ordersActive = pathname === '/sales/orders' || (/^\/sales\/orders\/[^/]+$/.test(pathname) && pathname !== '/sales/orders/new');
  const tabs: Array<{ key: string; to: string; label: string; icon: React.ElementType; active: boolean }> = [
    { key: 'today', to: '/sales', label: labels.today, icon: Home, active: pathname === '/sales' },
    { key: 'orders', to: '/sales/orders', label: labels.orders, icon: ShoppingCart, active: ordersActive },
    { key: 'catalogue', to: '/sales/catalogue', label: labels.catalogue, icon: Package, active: pathname === '/sales/catalogue' || pathname.startsWith('/sales/catalogue/') },
    { key: 'clients', to: '/sales/clients', label: labels.clients, icon: Users, active: pathname.startsWith('/sales/clients') },
  ];
  // The active tab: a short pill behind the icon and the word in the brand's
  // colour — the place is marked without flooding the whole slot.
  const tab = (x: (typeof tabs)[number]) => (
    <NavLink
      key={x.key}
      to={x.to}
      end={x.to === '/sales'}
      className="flex flex-col items-center justify-center gap-1 h-full min-w-0 active:opacity-70"
      aria-current={x.active ? 'page' : undefined}
    >
      <span className={`w-14 h-8 rounded-full flex items-center justify-center transition-colors ${
        x.active ? 'bg-brand-mist text-brand' : 'text-gray'
      }`}>
        <x.icon size={21} strokeWidth={x.active ? 2 : 1.75} />
      </span>
      <span className={`text-[11px] font-display leading-none whitespace-nowrap ${x.active ? 'font-semibold text-brand' : 'font-medium text-gray'}`}>{x.label}</span>
    </NavLink>
  );
  return (
    <nav
      aria-label="Cesto"
      className="lg:hidden fixed z-30 inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="grid grid-cols-5 items-center h-[68px] max-w-lg mx-auto px-1 rounded-[24px] bg-card border border-border shadow-[0_18px_40px_-16px_rgba(13,27,46,0.32)]">
        {tab(tabs[0])}
        {tab(tabs[1])}
        <NavLink
          to="/sales/orders/new"
          aria-label={labels.newOrder}
          className="flex flex-col items-center justify-end h-full pb-[9px] gap-1 active:scale-95 transition-transform"
        >
          <span className="w-14 h-14 -mt-7 rounded-full bg-gradient-to-br from-[#2F6EF0] to-brand text-white flex items-center justify-center shadow-[0_10px_20px_-6px_rgba(5,78,232,0.55)] ring-[5px] ring-surface-linen">
            <Plus size={26} strokeWidth={2.25} />
          </span>
          <span className="text-[11px] font-display font-semibold text-brand leading-none whitespace-nowrap">{labels.newOrder}</span>
        </NavLink>
        {tab(tabs[2])}
        {tab(tabs[3])}
      </div>
    </nav>
  );
}

/**
 * Who they are and what they sell from, and the things a sidebar footer held:
 * language, their earnings, password, signing out — not their own customer
 * account: a rep has no need of the shop (user, 2026-10-26). A sheet from the
 * bottom on a phone; a panel under the avatar from lg.
 */
function AccountSheet({
  name, detail, stores, assigned, lang, onLang, theme, onTheme, onClose, onEarnings, onChangePassword, onLogout, t,
}: {
  name: string;
  detail: string;
  /** Undefined on an API from before shops — shown as nothing, not as none. */
  stores: SalesRepStore[] | undefined;
  /** Products assigned to them by hand, from any shop. */
  assigned: number;
  lang: 'es' | 'en';
  onLang: (l: 'es' | 'en') => void;
  /** Light, dark, or the device's. */
  theme: SalesThemeChoice;
  onTheme: (c: SalesThemeChoice) => void;
  onClose: () => void;
  onEarnings: () => void;
  onChangePassword: () => void;
  onLogout: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const { sellable, unavailable } = splitShops(stores);
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
      ariaLabel={t('sales.account.title')}
      closeLabel={t('sales.closeMenu')}
      title={<span className="block truncate">{name || '—'}</span>}
      subtitle={detail}
      leading={(
        <span className="w-11 h-11 rounded-full bg-brand-whisper text-brand ring-1 ring-inset ring-brand-mist flex items-center justify-center text-sm font-bold font-display shrink-0">
          {name ? getInitials(name) : 'C'}
        </span>
      )}
      bodyClassName="p-0"
    >
      {/* Their shops: what every order they build is made from. */}
      {stores !== undefined && (
        sellable.length > 0 || assigned > 0 ? (
          <div className="mx-4 mt-3 rounded-xl bg-brand-whisper ring-1 ring-inset ring-brand/15 px-3 py-2.5">
            <p className="flex items-start gap-2 text-[13px] font-semibold font-display text-brand">
              <Store size={15} strokeWidth={1.75} className="shrink-0 mt-px" />
              <span>{sellingLine(t, lang, sellable, assigned)}</span>
            </p>
            {unavailable.length > 0 && (
              <p className="mt-1 pl-[23px] text-[12px] text-gray">
                {t('sales.today.shopSomeUnavailable', { names: listNames(unavailable.map((s) => s.name), lang) })}
              </p>
            )}
          </div>
        ) : (
          <p className="mx-4 mt-3 flex items-start gap-2 rounded-xl bg-warning-bg px-3 py-2.5 text-[13px] font-semibold font-display text-warning">
            <AlertTriangle size={15} strokeWidth={2} className="shrink-0 mt-0.5" />
            <span>
              {unavailable.length === 0
                ? t('sales.today.shopNoneTitle')
                : unavailable.length === 1 ? t('sales.today.shopUnavailableTitle') : t('sales.today.shopsUnavailableTitle')}
            </span>
          </p>
        )
      )}

      <div className="py-2">
        {/* Language as two choices, both visible, rather than a toggle whose
            label says what it is now and does the opposite. */}
        <div className="min-h-[52px] px-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-surface-cream text-gray flex items-center justify-center shrink-0">
            <Globe size={18} strokeWidth={1.75} />
          </span>
          <span className="flex-1 text-[15px] font-semibold font-display text-ink">{t('sales.account.language')}</span>
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
        {/* Light, dark, or as the device is — three choices, all visible. */}
        <div className="min-h-[52px] px-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-surface-cream text-gray flex items-center justify-center shrink-0">
            {theme === 'dark' ? <Moon size={18} strokeWidth={1.75} /> : theme === 'light' ? <Sun size={18} strokeWidth={1.75} /> : <SunMoon size={18} strokeWidth={1.75} />}
          </span>
          <span className="flex-1 min-w-0 text-[15px] font-semibold font-display text-ink">{t('sales.account.theme')}</span>
          <span className="inline-flex rounded-xl bg-surface-sand p-1 gap-0.5 shrink-0" role="group" aria-label={t('sales.account.theme')}>
            {(['light', 'dark', 'system'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onTheme(c)}
                aria-pressed={theme === c}
                className={`h-7 px-2.5 rounded-lg text-xs font-bold font-display transition-colors ${theme === c ? 'bg-card text-ink shadow-card' : 'text-gray hover:text-ink'}`}
              >
                {t(`sales.theme.${c}`)}
              </button>
            ))}
          </span>
        </div>
        {row(Wallet, t('sales.account.earnings'), onEarnings)}
        {row(KeyRound, t('sales.account.changePassword'), onChangePassword)}
      </div>
      <div className="border-t border-border py-2">
        {row(LogOut, t('sales.logout'), onLogout, true)}
      </div>
    </Dialog>
  );
}
