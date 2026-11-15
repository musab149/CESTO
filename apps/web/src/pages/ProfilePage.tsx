import { useNavigate } from 'react-router-dom';
import { User, MapPin, Package, Globe, Bell, HelpCircle, MessageCircle, FileText, Shield, LogOut, Trash2, ChevronRight, Mail, Phone, Edit3, KeyRound, Heart, Moon, Sun, SunMoon } from 'lucide-react';
import { useShopTheme } from '@/lib/shopTheme';
import { useOrders, useAddresses, useMyHomeGrocery, resolveImageUrl, HOME_GROCERY_PROFILE_PATH } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import HopBasket from '@/components/home-grocery/HopBasket';

interface MenuItemProps {
  icon: React.ElementType;
  label: string;
  description?: string;
  onClick?: () => void;
  danger?: boolean;
}

/** Home Grocery's basket, green, in a menu row's icon slot. */
const HomeGroceryIcon = ({ size }: { size: number }) => <HopBasket size={size} className="text-success" />;

function MenuItem({ icon: Icon, label, description, onClick, danger }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-4 w-full px-5 py-4 transition-colors text-left ${danger ? 'hover:bg-danger-bg' : 'hover:bg-surface-linen'}`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-danger-bg' : 'bg-surface-linen'}`}>
        <Icon size={18} strokeWidth={1.75} className={danger ? 'text-danger' : 'text-gray'} />
      </div>
      <div className="flex-1 min-w-0">
        <span className={`text-sm font-semibold font-display block ${danger ? 'text-danger' : 'text-ink'}`}>
          {label}
        </span>
        {description && <span className="text-xs text-muted font-body">{description}</span>}
      </div>
      {!danger && <ChevronRight size={16} strokeWidth={1.75} className="text-muted shrink-0" />}
    </button>
  );
}

/**
 * Light, dark or the device's (lib/shopTheme), chosen in place — the rep
 * panel's "Apariencia", in the shop's own row.
 */
function AppearanceRow() {
  const { t } = useLanguageStore();
  const { choice, setChoice } = useShopTheme();
  const options = [
    { value: 'light' as const, label: t('theme.light'), icon: Sun },
    { value: 'dark' as const, label: t('theme.dark'), icon: Moon },
    { value: 'system' as const, label: t('theme.system'), icon: SunMoon },
  ];
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 w-full px-5 py-4">
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-surface-linen">
          <SunMoon size={18} strokeWidth={1.75} className="text-gray" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold font-display block text-ink">{t('profile.appearance')}</span>
          <span className="text-xs text-muted font-body">{t('theme.systemHint')}</span>
        </div>
      </div>
      <div role="group" aria-label={t('profile.appearance')} className="inline-flex items-center gap-0.5 p-1 rounded-xl bg-surface-sand self-start sm:self-auto">
        {options.map((o) => {
          const on = choice === o.value;
          const Icon = o.icon;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setChoice(o.value)}
              aria-pressed={on}
              className={`h-9 px-3 rounded-lg inline-flex items-center gap-1.5 text-[13px] font-semibold font-display transition-colors ${
                on ? 'bg-card text-ink shadow-card' : 'text-gray hover:text-ink'
              }`}
            >
              <Icon size={14} strokeWidth={2} />
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const { lang, t } = useLanguageStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const { data: ordersPage } = useOrders({ limit: 100 });
  const { data: addresses } = useAddresses();
  const favoritesCount = useFavoritesStore((s) => s.productIds.length);
  const { data: myHomeGrocery } = useMyHomeGrocery();

  const orderCount = ordersPage?.total ?? ordersPage?.items?.length ?? 0;
  const addressCount = addresses?.length ?? 0;
  const totalSaved = (ordersPage?.items ?? []).reduce((sum, o) => sum + Number((o as any).total ?? 0), 0);

  const initials = (user?.name || '').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?';
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { month: 'long', year: 'numeric' })
    : null;

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm font-body text-muted mb-6">
        <button onClick={() => navigate('/')} className="hover:text-brand transition-colors">{t('common.home')}</button>
        <ChevronRight size={14} />
        <span className="text-ink font-semibold">{t('profile.title')}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-8">
        {/* ─── Left: Profile Card ─── */}
        <div>
          <div className="sticky top-[120px]">
            <div className="bg-gradient-to-br from-brand to-brand-mid rounded-lg p-6 text-white mb-4">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border-2 border-white/30 overflow-hidden">
                  {user?.avatar_url ? (
                    <img src={resolveImageUrl(user.avatar_url, 'logo')} alt={user.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xl font-bold font-display">{initials}</span>
                  )}
                </div>
                <div>
                  <h2 className="text-lg font-bold font-display">{user?.name || '—'}</h2>
                  <p className="text-sm text-white/70 font-body">
                    {memberSince ? `${t('profile.member_since')} ${memberSince}` : t('profile.member_since')}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 text-sm text-white/80 font-body">
                {user?.phone && <span className="flex items-center gap-2"><Phone size={14} /> {user.phone}</span>}
                {user?.email && <span className="flex items-center gap-2"><Mail size={14} /> {user.email}</span>}
              </div>
              <button
                onClick={() => navigate('/profile/edit')}
                className="mt-4 w-full h-10 bg-white/20 backdrop-blur-sm rounded-xl text-sm font-semibold font-display flex items-center justify-center gap-2 hover:bg-white/30 transition-colors border border-white/20"
              >
                <Edit3 size={14} /> {t('profile.edit')}
              </button>
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: String(orderCount), label: t('profile.orders') },
                { value: String(addressCount), label: t('profile.addresses') },
                { value: `€${totalSaved.toFixed(0)}`, label: t('profile.saved') },
              ].map((stat) => (
                <div key={stat.label} className="bg-surface-linen/50 rounded-xl p-3 text-center border border-border/40">
                  <p className="text-lg font-extrabold text-ink font-display">{stat.value}</p>
                  <p className="text-[10px] text-muted font-body">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ─── Right: Menu Sections ─── */}
        <div className="flex flex-col gap-4">
          {/* Partner application — approved sellers only. Read-only for the
              same reason as the business panel below: an admin verified these
              details at approval.

              Shown independently of business_profile. A partner is a seller
              and a business is a wholesale buyer; one person could in
              principle be both, and neither panel should suppress the other. */}
          {user?.partner_profile && (
            <div className="bg-surface-white rounded-lg border border-border/60 overflow-hidden">
              <div className="px-5 pt-5 pb-2 flex items-center justify-between gap-3">
                <h3 className="text-xs font-bold text-muted font-display uppercase tracking-wider">
                  {lang === 'en' ? 'Partner application' : 'Solicitud de socio'}
                </h3>
                {user.partner_profile.linked_store && (
                  <a
                    href="/partner/dashboard"
                    className="inline-flex items-center px-2 py-0.5 rounded-full bg-brand-mist text-brand text-[10px] font-bold font-display uppercase tracking-wide"
                  >
                    {lang === 'en' ? 'Manage store' : 'Gestionar tienda'}
                  </a>
                )}
              </div>
              <div className="px-5 pb-5 pt-1">
                <dl className="divide-y divide-border/50">
                  {([
                    [lang === 'en' ? 'Company' : 'Empresa',          user.partner_profile.company],
                    [lang === 'en' ? 'Business type' : 'Tipo',       user.partner_profile.business_type ?? null],
                    [lang === 'en' ? 'Location' : 'Ubicación',       user.partner_profile.location ?? null],
                    [lang === 'en' ? 'Phone' : 'Teléfono',           user.partner_profile.contact_phone ?? null],
                    [lang === 'en' ? 'Website' : 'Sitio web',        user.partner_profile.website ?? null],
                    [lang === 'en' ? 'Registration no.' : 'CIF/NIF', user.partner_profile.registration_no ?? null],
                    [lang === 'en' ? 'Store' : 'Tienda',             user.partner_profile.linked_store?.name ?? null],
                  ] as [string, string | null][])
                    .filter(([, value]) => !!value)
                    .map(([label, value]) => (
                      <div key={label} className="py-2 flex items-baseline justify-between gap-4">
                        <dt className="text-[12px] text-muted font-body shrink-0">{label}</dt>
                        <dd className="text-[13px] text-ink font-display font-semibold text-right break-words min-w-0">{value}</dd>
                      </div>
                    ))}
                </dl>
                <p className="mt-3 text-[11.5px] text-muted font-body">
                  {user.partner_profile.linked_store
                    ? (lang === 'en'
                        ? 'These are the details you submitted. Contact support to update them.'
                        : 'Estos son los datos que enviaste. Contacta con soporte para actualizarlos.')
                    : (lang === 'en'
                        ? 'These are the details you submitted. No store is currently linked to your account — contact support.'
                        : 'Estos son los datos que enviaste. No hay ninguna tienda vinculada a tu cuenta — contacta con soporte.')}
                </p>
              </div>
            </div>
          )}

          {/* Business account — approved B2B buyers only. Read-only: these
              details were verified by an admin at approval, so changing them
              is a support conversation rather than a self-serve edit. */}
          {user?.is_business && user.business_profile && (
            <div className="bg-surface-white rounded-lg border border-border/60 overflow-hidden">
              <div className="px-5 pt-5 pb-2 flex items-center justify-between gap-3">
                <h3 className="text-xs font-bold text-muted font-display uppercase tracking-wider">
                  {lang === 'en' ? 'Business account' : 'Cuenta de empresa'}
                </h3>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-brand-mist text-brand text-[10px] font-bold font-display uppercase tracking-wide">
                  {(user.pricing_mode ?? 'retail') === 'b2b'
                    ? (lang === 'en' ? 'B2B prices on' : 'Precios B2B')
                    : (lang === 'en' ? 'Regular prices' : 'Precios normales')}
                </span>
              </div>
              <div className="px-5 pb-5 pt-1">
                <dl className="divide-y divide-border/50">
                  {([
                    [lang === 'en' ? 'Company' : 'Empresa',          user.business_profile.company],
                    [lang === 'en' ? 'Business type' : 'Tipo',       user.business_profile.business_type],
                    [lang === 'en' ? 'Location' : 'Ubicación',       user.business_profile.location],
                    [lang === 'en' ? 'Phone' : 'Teléfono',           user.business_profile.contact_phone],
                    [lang === 'en' ? 'Website' : 'Sitio web',        user.business_profile.website],
                    [lang === 'en' ? 'Registration no.' : 'CIF/NIF', user.business_profile.registration_no],
                  ] as [string, string | null][])
                    .filter(([, value]) => !!value)
                    .map(([label, value]) => (
                      <div key={label} className="py-2 flex items-baseline justify-between gap-4">
                        <dt className="text-[12px] text-muted font-body shrink-0">{label}</dt>
                        <dd className="text-[13px] text-ink font-display font-semibold text-right break-words min-w-0">{value}</dd>
                      </div>
                    ))}
                </dl>
                <p className="mt-3 text-[11.5px] text-muted font-body">
                  {lang === 'en'
                    ? 'Switch between business and regular prices from the top bar. Contact support to update these details.'
                    : 'Cambia entre precios de empresa y normales desde la barra superior. Contacta con soporte para actualizar estos datos.'}
                </p>
              </div>
            </div>
          )}

          {/* Home Grocery — an approved household. Every order it places is
              a Home Grocery one; its page holds those orders and its
              delivery information. */}
          {myHomeGrocery?.subscriber && (
            <div className="bg-surface-white rounded-lg border border-border/60 overflow-hidden">
              <div className="px-5 pt-5 pb-2">
                <h3 className="text-xs font-bold text-muted font-display uppercase tracking-wider">
                  {lang === 'en' ? 'Home Grocery' : 'Compra del hogar'}
                </h3>
              </div>
              <MenuItem
                icon={HomeGroceryIcon}
                label={lang === 'en' ? 'My Home Grocery' : 'Mi compra del hogar'}
                description={lang === 'en'
                  ? 'Your Home Grocery orders and your delivery information'
                  : 'Tus pedidos de la compra del hogar y tus datos de entrega'}
                onClick={() => navigate(HOME_GROCERY_PROFILE_PATH)}
              />
            </div>
          )}

          {/* Account */}
          <div className="bg-surface-white rounded-lg border border-border/60 overflow-hidden">
            <div className="px-5 pt-5 pb-2">
              <h3 className="text-xs font-bold text-muted font-display uppercase tracking-wider">{t('profile.section.account')}</h3>
            </div>
            <MenuItem icon={User} label={t('profile.edit_profile')} description={t('profile.edit_profile_desc')} onClick={() => navigate('/profile/edit')} />
            <MenuItem icon={KeyRound} label={t('profile.change_password')} description={t('profile.change_password_desc')} onClick={() => navigate('/profile/change-password')} />
            <MenuItem icon={MapPin} label={t('profile.my_addresses')} description={t('profile.my_addresses_desc')} onClick={() => navigate('/addresses')} />
          </div>

          {/* Orders */}
          <div className="bg-surface-white rounded-lg border border-border/60 overflow-hidden">
            <div className="px-5 pt-5 pb-2">
              <h3 className="text-xs font-bold text-muted font-display uppercase tracking-wider">{t('profile.section.purchases')}</h3>
            </div>
            <MenuItem icon={Package} label={t('profile.my_orders')} description={t('profile.my_orders_desc')} onClick={() => navigate('/orders')} />
            <MenuItem
              icon={Heart}
              label={lang === 'en' ? 'My favourites' : 'Mis favoritos'}
              description={
                favoritesCount > 0
                  ? `${favoritesCount} ${
                      favoritesCount === 1
                        ? (lang === 'en' ? 'saved product' : 'producto guardado')
                        : (lang === 'en' ? 'saved products' : 'productos guardados')
                    }`
                  : (lang === 'en' ? 'Products you have saved' : 'Productos que has guardado')
              }
              onClick={() => navigate('/favorites')}
            />
          </div>

          {/* Preferences */}
          <div className="bg-surface-white rounded-lg border border-border/60 overflow-hidden">
            <div className="px-5 pt-5 pb-2">
              <h3 className="text-xs font-bold text-muted font-display uppercase tracking-wider">{t('profile.section.preferences')}</h3>
            </div>
            <MenuItem icon={Globe} label={t('profile.language')} description={lang === 'en' ? 'English' : 'Español'} onClick={() => navigate('/profile/language')} />
            <AppearanceRow />
            <MenuItem icon={Bell} label={t('profile.notifications')} description={t('profile.notifications_desc')} onClick={() => navigate('/profile/notifications')} />
          </div>

          {/* Support */}
          <div className="bg-surface-white rounded-lg border border-border/60 overflow-hidden">
            <div className="px-5 pt-5 pb-2">
              <h3 className="text-xs font-bold text-muted font-display uppercase tracking-wider">{t('profile.section.support')}</h3>
            </div>
            <MenuItem icon={HelpCircle} label={t('profile.faq')} onClick={() => navigate('/faq')} />
            <MenuItem icon={MessageCircle} label={t('profile.contact')} onClick={() => navigate('/contact')} />
            <MenuItem icon={FileText} label={t('profile.privacy')} onClick={() => navigate('/privacy')} />
            <MenuItem icon={Shield} label={t('profile.terms')} onClick={() => navigate('/terms')} />
          </div>

          {/* Danger zone */}
          <div className="bg-surface-white rounded-lg border border-border/60 overflow-hidden">
            <MenuItem icon={LogOut} label={t('profile.logout')} danger onClick={handleLogout} />
            <MenuItem icon={Trash2} label={t('profile.delete')} danger onClick={() => navigate('/profile/edit')} />
          </div>
        </div>
      </div>
    </div>
  );
}
