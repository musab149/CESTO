import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, Truck, ShoppingCart, Store as StoreIcon,
  LogOut, Menu, X, Eye, EyeOff, ShieldCheck, Grid3X3, Award, Globe,
} from 'lucide-react';
import { useCurrentPartner } from '@grocery-app/shared';
import { useAuthStore } from '@/stores/authStore';
import NotificationBell from './components/NotificationBell';

interface NavItem { label: string; to: string; icon: React.ElementType; disabled?: boolean; }
interface NavSection { title: string; items: NavItem[]; }

function getInitials(name: string): string {
  return name.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2);
}

export default function PartnerLayout() {
  const location = useLocation();
  // The partner panel has no dark mode: clear the shop's or the rep's, should
  // either have been set on <html> before this mounted (index.html, a redirect).
  useEffect(() => {
    const root = document.documentElement;
    delete root.dataset.shopTheme;
    delete root.dataset.salesTheme;
  }, []);
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  // useCurrentPartner hits /api/partner/me for the full store row (logo,
  // status, contact info) that the top-bar renders. Guard already
  // confirmed the customer JWT has a partner role, so this call succeeds.
  const { data } = useCurrentPartner();
  const partner = data?.user;
  const store = data?.store;

  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onEsc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onEsc);
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  // Sidebar mirrors admin's grouping pattern (see apps/admin AdminLayout).
  // Rendered as titled sections instead of one flat list so partners can
  // scan the surface faster.
  //
  //   · Principal     — the two things you look at every day.
  //   · Catalogue     — everything about products + the shared taxonomy
  //                     (Categories / Brands / Origins are READ-ONLY —
  //                     admin owns writes on those tables).
  //   · Operations    — delivery-side setup (rider roster).
  //
  // No Rashan section. Rashan became Home Grocery (2026-10-14): households
  // apply on the website, Cesto approves them and builds their orders, and
  // those orders are Cesto's — they never reach a partner. Customers can no
  // longer subscribe to a pack, so a partner's packs had nowhere to go.
  //   · Storefront    — the store profile that customers see.
  const navSections: NavSection[] = [
    {
      title: 'Principal',
      items: [
        { label: 'Dashboard', to: '/partner/dashboard', icon: LayoutDashboard },
        { label: 'Orders',    to: '/partner/orders',    icon: ShoppingCart },
      ],
    },
    {
      title: 'Catalogue',
      items: [
        { label: 'Products',   to: '/partner/products',   icon: Package },
        { label: 'Categories', to: '/partner/categories', icon: Grid3X3 },
        { label: 'Brands',     to: '/partner/brands',     icon: Award },
        { label: 'Origins',    to: '/partner/origins',    icon: Globe },
      ],
    },
    {
      title: 'Operations',
      items: [
        { label: 'Riders', to: '/partner/riders', icon: Truck },
      ],
    },
    {
      title: 'Storefront',
      items: [
        { label: 'Store', to: '/partner/store', icon: StoreIcon },
      ],
    },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  // Same-origin now — no SSO handoff needed. Just navigate to the customer
  // home; the partner IS a customer with a store attached.
  const enterCustomerMode = () => {
    navigate('/');
  };

  return (
    // `partner-app` scopes the app.css reset that restores admin-native
    // letter-spacing on DM Sans (customer web tightens tracking; admin
    // doesn't). Keeps the whole partner surface visually matched to
    // Cesto admin instead of the customer catalogue.
    <div className="partner-app flex min-h-screen">
      {drawerOpen && (
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] lg:hidden"
        />
      )}

      <aside
        className={`fixed left-0 top-0 bottom-0 w-60 bg-[#1A1A1A] flex flex-col z-40 transition-transform lg:translate-x-0 ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Logo area */}
        <div className="h-14 px-5 flex items-center gap-2.5 shrink-0">
          <img
            src="/cesto-icon.png"
            alt="Cesto"
            className="w-8 h-8 rounded-lg ring-1 ring-white/10"
            draggable={false}
          />
          <span className="text-white font-display font-semibold text-lg">Cesto</span>
          <span className="text-white/40 text-[10px] font-medium font-display ml-auto rounded bg-white/10 px-1.5 py-0.5 uppercase tracking-wide">
            Partner
          </span>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="lg:hidden ml-2 -mr-1 w-8 h-8 rounded-lg text-white/60 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
            aria-label="Close menu"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {navSections.map((section) => (
            <div key={section.title}>
              <p className="text-[10px] font-bold uppercase text-white/25 px-4 mt-6 mb-2 tracking-wider">
                {section.title}
              </p>
              {section.items.map((item) => (
                item.disabled ? (
                  <div
                    key={item.to}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-lg mx-2 text-white/25 cursor-not-allowed select-none"
                    aria-disabled="true"
                  >
                    <item.icon size={18} strokeWidth={1.75} />
                    <span className="text-sm font-medium font-display flex-1">{item.label}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wide bg-white/5 rounded px-1.5 py-0.5">Soon</span>
                  </div>
                ) : (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/partner/dashboard'}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-2.5 rounded-lg mx-2 transition-colors ${
                        isActive ? 'bg-brand text-white' : 'text-white/50 hover:text-white hover:bg-white/[0.08]'
                      }`
                    }
                  >
                    <item.icon size={18} strokeWidth={1.75} />
                    <span className="text-sm font-medium font-display">{item.label}</span>
                  </NavLink>
                )
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white text-xs font-bold font-display">
              {partner?.name ? getInitials(partner.name) : 'P'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium font-display truncate">
                {partner?.name ?? 'Partner'}
              </p>
              <p className="text-white/40 text-xs truncate">{partner?.email ?? ''}</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-white/40 hover:text-white transition-colors"
              aria-label="Log out"
            >
              <LogOut size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 lg:ml-60 flex flex-col min-h-screen min-w-0">
        <header className="h-14 bg-white border-b border-border sticky top-0 z-20 px-4 sm:px-6 flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="lg:hidden inline-flex items-center justify-center w-10 h-10 -ml-1 rounded-lg text-ink/70 hover:text-ink hover:bg-surface-cream transition-colors"
            aria-label="Open menu"
          >
            <Menu size={20} strokeWidth={1.75} />
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-surface-cream border border-border flex items-center justify-center shrink-0 overflow-hidden">
              {store?.logo_url
                ? <img src={store.logo_url} alt="" className="w-full h-full object-cover" />
                : <StoreIcon size={16} strokeWidth={1.75} className="text-ink/60" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-display font-semibold text-ink truncate leading-tight">
                {store?.name ?? 'Your store'}
              </p>
              <p className="text-[11px] text-ink/50 truncate leading-tight">
                {store?.is_verified
                  ? <>Verified · <span className="uppercase tracking-wide">{store.status}</span></>
                  : <span className="uppercase tracking-wide">{store?.status ?? ''}</span>}
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            {/* Store ↔ Customer mode toggle. Store side is a static current-state
                pill; Customer side is the action button that flips the flag +
                lands on customer web. */}
            <div className="inline-flex items-center h-9 rounded-full border border-border bg-white overflow-hidden p-0.5">
              <span className="inline-flex items-center gap-1.5 h-full px-3 rounded-full bg-brand text-white text-xs font-semibold font-display">
                <ShieldCheck size={13} strokeWidth={2} />
                Store
              </span>
              <button
                onClick={enterCustomerMode}
                className="inline-flex items-center gap-1.5 h-full px-3 rounded-full text-xs font-semibold font-display text-ink/70 hover:text-ink hover:bg-surface-cream transition-colors"
                title="Shop the customer site as yourself"
              >
                <Eye size={13} strokeWidth={2} />
                Customer
              </button>
            </div>
          </div>
        </header>

        {/* Store-paused banner. Sits above main content, sticky-adjacent to
            the header so the partner can't miss it. Click to jump to the
            Store visibility toggle. Only rendered when the partner has
            paused their store — 'draft'/'suspended' are admin states and
            get their own copy on the Store page rather than a top banner. */}
        {store?.status === 'paused' && (
          <div className="bg-warning-bg border-b border-warning/40 px-4 sm:px-6 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-warning text-white flex items-center justify-center shrink-0">
              <EyeOff size={16} strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold font-display text-ink leading-tight">
                Your store is paused
              </p>
              <p className="text-xs text-ink/70 font-body mt-0.5 leading-snug">
                Customers can't see or order from your store. Existing orders still work.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/partner/store')}
              className="shrink-0 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-white border border-warning/50 text-warning hover:bg-warning-bg text-xs font-semibold font-display transition-colors"
            >
              Publish store
            </button>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 bg-white">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
