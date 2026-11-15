import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Archive, KeyRound,
  LayoutDashboard,
  ShoppingCart,
  Package,
  Grid3X3,
  Store as StoreIcon,
  Users,
  Image,
  LayoutTemplate,
  Smartphone,
  Building2,
  Settings,
  LogOut,
  Globe,
  Moon,
  Sun,
  Repeat,
  CalendarDays,
  Boxes,
  Inbox,
  LifeBuoy,
  MessageSquare,
  BookOpen,
  Megaphone,
  Menu,
  X,
  ArrowLeft,
  Award,
  UserPlus,
} from 'lucide-react';
import { useAdminAuthStore } from '@/stores/authStore';
import NotificationsBell from '@/components/NotificationsBell';
import { BackLinkSlotProvider, useBackLinkSlot } from '@/components/BackLinkSlot';
import i18n from '@/i18n';
import { useAdminTheme } from '@/lib/adminTheme';

interface NavItem {
  label: string;
  to: string;
  icon: React.ElementType;
  /**
   * Overrides NavLink's own matching for the highlight.
   *
   * NavLink matches on prefix, which is right for every row whose detail pages
   * live underneath it — /orders stays lit on /orders/123. It goes wrong the
   * moment one nav row sits underneath another: /customers would match
   * /customers/new and both rows would light up at once. Rows in that position
   * say here what counts as active instead.
   *
   * A tab of a page is never a row of its own: Home Grocery is a tab of
   * Users and a tab of Orders, and those rows are the only way in.
   */
  match?: (pathname: string) => boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAdminAuthStore();
  const { t } = useTranslation();

  const currentLang = i18n.language === 'es' ? 'ES' : 'EN';
  const toggleLang = () => i18n.changeLanguage(i18n.language === 'en' ? 'es' : 'en');
  const theme = useAdminTheme();

  // Mobile sidebar drawer state. On <lg viewports the sidebar slides in from
  // the left as an overlay; on lg+ it's always visible in its original slot.
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onEsc);
    // Lock body scroll while the drawer is open so the page beneath doesn't
    // scroll under it — matches native drawer UX on mobile.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onEsc);
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  const isLawyer = user?.role === 'lawyer';
  const navSections: NavSection[] = isLawyer ? [
    {
      title: t('nav.sections.principal'),
      items: [{ label: t('nav.documents', 'Documents'), to: '/documents', icon: Archive }],
    },
  ] : [
    {
      title: t('nav.sections.principal'),
      items: [
        { label: t('nav.dashboard'), to: '/', icon: LayoutDashboard },
        // Every order book, Home Grocery included: the books are tabs of
        // this one page, and this is the only row that leads to them.
        { label: t('nav.orders'), to: '/orders', icon: ShoppingCart },
        // Every factura, albarán and bill, for whoever has to answer for them.
        { label: t('nav.documents', 'Documents'), to: '/documents', icon: Archive },
        {
          label: t('nav.users', 'Users'),
          to: '/users',
          icon: Users,
          // A customer's own page still lives at /customers/:id, so this row
          // lights for that too — but NOT for /customers/new, which is its own
          // row in CLIENTS and would otherwise light both. Every tab is this
          // row, Home Grocery included, and so is the Home Grocery request
          // history that tab links to.
          match: (p) => p === '/users' || p === '/rashan-leads'
            || (p.startsWith('/customers/') && p !== '/customers/new'),
        },
      ],
    },
    {
      // Its own section rather than a sixth row under OPERATIONS: this is the
      // one thing in the sidebar that CREATES something rather than listing it,
      // and a rep opening an account with the client in front of them should
      // not have to find it inside a list of queues. High up for the same
      // reason — it is an errand done with someone waiting, not a queue to
      // work through, so it sits with the dashboard rather than below four
      // sections of them.
      title: t('nav.sections.clients'),
      items: [
        { label: t('nav.newClient', 'New client'), to: '/customers/new', icon: UserPlus },
      ],
    },
    {
      title: t('nav.sections.catalog'),
      items: [
        { label: t('nav.products'), to: '/products', icon: Package },
        { label: t('nav.categories'), to: '/categories', icon: Grid3X3 },
        { label: t('nav.stores'), to: '/stores', icon: StoreIcon },
      ],
    },
    {
      title: t('nav.sections.operations'),
      items: [
        { label: t('nav.leads'), to: '/leads', icon: Inbox },
        { label: t('nav.support'), to: '/support', icon: LifeBuoy },
        { label: t('nav.reviews'), to: '/reviews', icon: MessageSquare },
      ],
    },
    {
      title: t('nav.sections.rashanLegacy', 'RASHAN — LEGACY'),
      items: [
        { label: t('nav.subscriptions'), to: '/subscriptions', icon: Repeat },
        { label: t('nav.rashanDeliveries'), to: '/rashan-deliveries', icon: CalendarDays },
        { label: t('nav.rashanPacks'), to: '/rashan-packs', icon: Boxes },
      ],
    },
    {
      title: t('nav.sections.content'),
      items: [
        { label: t('nav.banners'), to: '/banners', icon: Image },
        { label: t('nav.homeSections'), to: '/home-sections', icon: LayoutTemplate },
        { label: t('nav.appContent', 'App content'), to: '/app-content', icon: Smartphone },
        { label: t('nav.businessHome', 'Business home'), to: '/business-home', icon: Building2 },
        { label: t('nav.brands', 'Brands'), to: '/brands', icon: Award },
        { label: t('nav.origins', 'Origins'), to: '/origins', icon: Globe },
        { label: t('nav.helpCenter'), to: '/help-center', icon: BookOpen },
        { label: t('nav.broadcast', 'Broadcast'), to: '/broadcast', icon: Megaphone },
        { label: t('nav.settings'), to: '/settings', icon: Settings },
      ],
    },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  /**
   * Routes that take the whole window.
   *
   * Building an order is a task, not a place: the catalogue wants every pixel
   * of width, and there is nothing useful to navigate to half way through one.
   * The sidebar slides out and the content loses its offset, so the page gets
   * the full screen without a second layout existing to drift from this one.
   */
  const focusMode = /^\/customers\/[^/]+\/orders\/new$/.test(location.pathname)
    || /^\/orders\/[^/]+\/edit$/.test(location.pathname)
    // A rep's products: the same two columns, a list and the catalogue.
    || /^\/sales-reps\/[^/]+\/products$/.test(location.pathname);

  return (
    <BackLinkSlotProvider>
    <div className="flex min-h-screen">
      {/* Backdrop — mobile drawer overlay. Fades in when drawerOpen; hidden on lg+. */}
      {drawerOpen && (
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] lg:hidden"
        />
      )}

      {/* Sidebar. On mobile it's off-canvas (translate-x-[-100%]) until the
          drawer opens; on lg+ it sits statically in its slot as before. */}
      <aside
        className={`fixed left-0 top-0 bottom-0 w-60 bg-night flex flex-col z-40 transition-transform ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        } ${focusMode ? 'lg:-translate-x-full' : 'lg:translate-x-0'}`}
      >
        {/* Logo area */}
        <div className="h-14 px-5 flex items-center gap-2.5 shrink-0">
          <img
            src="/cesto-icon.png"
            alt="Cesto"
            className="w-8 h-8 rounded-lg ring-1 ring-white/10"
            draggable={false}
          />
          <span className="text-white font-display font-semibold text-lg">
            Cesto
          </span>
          <span className="text-white/40 text-xs font-medium font-display ml-auto rounded bg-white/10 px-1.5 py-0.5">
            {t('layout.admin')}
          </span>
          {/* Close-drawer button — mobile only */}
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="lg:hidden ml-2 -mr-1 w-8 h-8 rounded-lg text-white/60 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
            aria-label="Close menu"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2">
          {navSections.map((section) => (
            <div key={section.title}>
              <p className="text-[10px] font-bold uppercase text-white/25 px-4 mt-6 mb-2 tracking-wider">
                {section.title}
              </p>
              {section.items.map((item) => {
                const overridden = item.match?.(location.pathname);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-2.5 rounded-lg mx-2 transition-colors ${
                        (overridden ?? isActive)
                          ? 'bg-brand text-white'
                          : 'text-white/50 hover:text-white hover:bg-white/[0.08]'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon
                          size={18}
                          strokeWidth={1.75}
                          className={(overridden ?? isActive) ? 'text-white' : ''}
                        />
                        <span className="text-sm font-medium font-display">
                          {item.label}
                        </span>
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Bottom user area */}
        <div className="border-t border-white/10 p-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white text-xs font-bold font-display">
              {user?.name ? getInitials(user.name) : 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium font-display truncate">
                {user?.name ?? 'Admin'}
              </p>
              <p className="text-white/40 text-xs truncate">
                {user?.email ?? ''}
              </p>
            </div>
            <NavLink
              to="/account/password"
              className="w-9 h-9 -mr-1 rounded-lg inline-flex items-center justify-center text-white/40 hover:text-white transition-colors"
              aria-label={t('layout.changePassword', 'Change password')}
              title={t('layout.changePassword', 'Change password')}
            >
              <KeyRound size={17} strokeWidth={1.75} />
            </NavLink>
            <button
              onClick={handleLogout}
              className="w-9 h-9 -mr-1.5 rounded-lg inline-flex items-center justify-center text-white/40 hover:text-white transition-colors"
              aria-label={t('layout.logout')}
            >
              <LogOut size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main area — no left offset on mobile (sidebar is off-canvas), ml-60 at lg+. */}
      <div className={`flex-1 flex flex-col min-h-screen min-w-0 ${focusMode ? '' : 'lg:ml-60'}`}>
        {/* Header */}
        {/* A focus route recolours THIS bar rather than drawing another one
            under it. The page has no chrome of its own on these routes, and a
            second bar just repeats the account that is already on the right of
            this one. */}
        <header className={`h-14 sticky top-0 z-20 px-4 sm:px-6 flex items-center justify-between shrink-0 gap-2 ${
          focusMode ? 'bg-brand-bar' : 'bg-card border-b border-border'
        }`}>
          {/* Left: hamburger (mobile only) — opens the sidebar drawer */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className={`lg:hidden inline-flex items-center justify-center w-10 h-10 -ml-1 rounded-lg transition-colors ${
              focusMode
                ? 'text-white/80 hover:text-white hover:bg-white/10'
                : 'text-ink/70 hover:text-ink hover:bg-surface-cream'
            }`}
            aria-label="Open menu"
          >
            <Menu size={20} strokeWidth={1.75} />
          </button>

          {/* The page's way back, from lg up. Below that the page draws it
              itself, above its own title — this bar is already carrying a
              hamburger, a language toggle, a bell and an avatar across 360px. */}
          <HeaderBackLink onDark={focusMode} />

          {/* Right: language toggle + bell + avatar. `ml-auto` pushes them to
              the far right on desktop where the hamburger button is hidden
              (`justify-between` alone would collapse them against the sidebar
              edge when there's nothing on the left). */}
          <div className="ml-auto flex items-center gap-2.5">
            {/* Light or dark, one tap; from Auto it picks the opposite of what
                shows now (lib/adminTheme). */}
            <button
              onClick={() => theme.setChoice(theme.resolved === 'dark' ? 'light' : 'dark')}
              className={`inline-flex items-center justify-center w-9 h-9 rounded-full border transition-colors ${
                focusMode
                  ? 'border-white/30 bg-white/10 text-white hover:bg-white/20'
                  : 'border-border bg-card text-gray hover:text-ink hover:border-ink/30'
              }`}
              aria-label={theme.resolved === 'dark' ? t('layout.toLight', 'Switch to light mode') : t('layout.toDark', 'Switch to dark mode')}
              title={theme.resolved === 'dark' ? t('layout.toLight', 'Switch to light mode') : t('layout.toDark', 'Switch to dark mode')}
            >
              {theme.resolved === 'dark' ? <Sun size={15} strokeWidth={1.75} /> : <Moon size={15} strokeWidth={1.75} />}
            </button>
            <button
              onClick={toggleLang}
              className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-xs font-semibold font-display transition-colors ${
                focusMode
                  ? 'border-white/30 bg-white/10 text-white hover:bg-white/20'
                  : 'border-border bg-card text-gray hover:text-ink hover:border-ink/30'
              }`}
              aria-label={t('layout.language')}
            >
              <Globe size={14} strokeWidth={1.75} />
              {currentLang}
            </button>
            {!isLawyer && <NotificationsBell />}
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-[11px] font-bold font-display ring-1 ${
                focusMode ? 'bg-white/20 ring-white/30' : 'bg-brand ring-brand/40'
              }`}
              aria-label={user?.name ?? 'Admin'}
            >
              {user?.name ? getInitials(user.name) : 'A'}
            </div>
          </div>
        </header>

        {/* Content */}
        {/* A focus route manages its own gutters — it is laying out two full
            columns, not sitting in a page frame. The background stays white
            either way: that is the panel's, and a focus route is not a reason
            to repaint every other screen. */}
        <main className={`flex-1 bg-canvas ${focusMode ? '' : 'p-4 sm:p-6'}`}>
          <Outlet />
        </main>
      </div>
    </div>
    </BackLinkSlotProvider>
  );
}

/**
 * Draws whatever the current page registered, or nothing.
 *
 * Its own component so that setting a back target re-renders this line rather
 * than the whole layout — the sidebar, the bell and the drawer have no stake
 * in which page is showing.
 */
function HeaderBackLink({ onDark = false }: { onDark?: boolean }) {
  const { target } = useBackLinkSlot();
  if (!target) return null;
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
