import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Package,
  CheckCircle2,
  Truck,
  XCircle,
  CheckCheck,
  Tag,
  Megaphone,
  BellRing,
  CalendarClock,
} from 'lucide-react';
import {
  useNotifications,
  useUnreadNotificationCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  type AppNotification,
  type NotificationType,
} from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import { isSupported, currentPermission, subscribeToPush } from '@/lib/webPush';

function timeAgo(iso: string, lang: 'es' | 'en'): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(diffMs / 60_000));
  if (mins < 60)  return lang === 'es' ? `hace ${mins} min` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return lang === 'es' ? `hace ${hours} h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return lang === 'es' ? `hace ${days} d` : `${days}d ago`;
}

// Icon + colour for each notification type. Customer-facing only — admin
// types fall through to a sensible default if they ever leak through.
const TYPE_STYLE: Record<NotificationType, { Icon: typeof Bell; tone: string }> = {
  order_confirmed:  { Icon: CheckCircle2, tone: 'bg-brand-mist text-brand' },
  order_preparing:  { Icon: Package,      tone: 'bg-brand-mist text-brand' },
  order_on_the_way: { Icon: Truck,        tone: 'bg-amber-mist text-amber-deep' },
  order_delivered:  { Icon: CheckCircle2, tone: 'bg-brand-mist text-brand' },
  order_cancelled:  { Icon: XCircle,      tone: 'bg-danger-bg text-danger' },
  promo_banner:     { Icon: Tag,          tone: 'bg-amber-mist text-amber-deep' },
  admin_new_order:        { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  admin_low_stock:        { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  admin_new_customer:     { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  admin_subscription_paused: { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  admin_broadcast:        { Icon: Megaphone, tone: 'bg-brand-mist text-brand' },
  admin_quotation_request: { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  admin_home_grocery_request: { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  // A "no" is information, not an error — muted rather than red.
  home_grocery_approved: { Icon: CheckCircle2, tone: 'bg-brand-mist text-brand' },
  home_grocery_rejected: { Icon: XCircle,      tone: 'bg-surface-sand text-muted' },
  // Our team built an order for them.
  order_placed:     { Icon: Package,      tone: 'bg-brand-mist text-brand' },
  // Their Home Grocery plan: next delivery planned, or being prepared.
  home_grocery_delivery_planned: { Icon: CalendarClock, tone: 'bg-brand-mist text-brand' },
  admin_home_grocery_plan:       { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  // The partner dashboard's own types — never in this bell, typed for completeness.
  partner_new_order:       { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  partner_draft_order:     { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  partner_order_edited:    { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  partner_order_cancelled: { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  // The rep panel's own types — never in this bell, typed for completeness.
  rep_statement_published: { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  rep_statement_paid:      { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  rep_order_delivered:     { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  rep_order_cancelled:     { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  rep_earning_approved:    { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  rep_earning_reversed:    { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  rep_earning_adjusted:    { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
  rep_payout_recorded:     { Icon: Megaphone, tone: 'bg-surface-sand text-muted' },
};

export default function NotificationInbox() {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // List = the bell dropdown. unread-count = the badge — separate query so
  // closing the dropdown still keeps the badge fresh on a refetch interval.
  const { data, isLoading } = useNotifications({ limit: 20 });
  const { data: unread } = useUnreadNotificationCount({ refetchInterval: 60_000 });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const items: AppNotification[] = data?.items ?? [];
  const unreadCount = unread?.count ?? items.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleClick = (n: AppNotification) => {
    if (!n.read) markRead.mutate(n.id);
    setOpen(false);
    if (n.deeplink) navigate(n.deeplink);
  };

  const labels = {
    title: lang === 'es' ? 'Notificaciones' : 'Notifications',
    markAll: lang === 'es' ? 'Marcar todas como leídas' : 'Mark all as read',
    empty: lang === 'es' ? 'Sin notificaciones' : 'No notifications',
    emptyDesc: lang === 'es'
      ? 'Aquí verás las actualizaciones de tus pedidos.'
      : 'Order updates will show up here.',
    loading: lang === 'es' ? 'Cargando…' : 'Loading…',
    enableTitle: lang === 'es' ? 'Activa las notificaciones del navegador' : 'Turn on browser notifications',
    enableDesc: lang === 'es'
      ? 'Recibe avisos aunque cierres esta pestaña.'
      : "We'll notify you even when this tab is closed.",
    enableCta: lang === 'es' ? 'Activar' : 'Enable',
    enabling: lang === 'es' ? 'Activando…' : 'Enabling…',
  };

  // Browser-push opt-in row — only visible when the browser supports it,
  // the user is signed in, and we haven't already asked/granted. Once the
  // permission API returns anything other than 'default' the row hides.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [pushPerm, setPushPerm] = useState<NotificationPermission | 'unsupported'>(() => currentPermission());
  const [pushBusy, setPushBusy] = useState(false);
  const showEnablePush = isAuthenticated && isSupported() && pushPerm === 'default';

  const handleEnablePush = async () => {
    setPushBusy(true);
    const res = await subscribeToPush();
    setPushBusy(false);
    setPushPerm(currentPermission());
    if (res.status !== 'subscribed' && res.status !== 'permission_denied') {
      console.warn('[webpush] subscribe result', res);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-9 h-9 sm:w-11 sm:h-11 rounded-full border border-white/15 bg-white/5 hover:bg-white/15 hover:border-white/25 flex items-center justify-center transition-colors"
        aria-label={labels.title}
        aria-expanded={open}
      >
        <Bell size={18} strokeWidth={2} className="text-white sm:hidden" />
        <Bell size={20} strokeWidth={2} className="text-white hidden sm:block" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 sm:top-1.5 sm:right-1.5 min-w-[16px] h-[16px] sm:min-w-[18px] sm:h-[18px] rounded-full bg-amber text-on-accent text-[10px] font-extrabold flex items-center justify-center px-1 font-ui ring-2 ring-brand-bar">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={labels.title}
          className="absolute right-0 top-12 z-50 w-[360px] max-h-[480px] bg-surface-cream rounded-lg shadow-float border border-border flex flex-col overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-border/70 flex items-center justify-between">
            <p className="text-[14px] font-semibold text-ink font-ui tracking-tight">{labels.title}</p>
            <button
              onClick={() => markAllRead.mutate()}
              disabled={unreadCount === 0 || markAllRead.isPending}
              className="flex items-center gap-1.5 text-[12px] font-semibold font-ui text-brand hover:text-brand-ink disabled:text-muted disabled:cursor-default transition-colors"
            >
              <CheckCheck size={13} strokeWidth={2} />
              {labels.markAll}
            </button>
          </div>

          {showEnablePush && (
            <div className="px-4 py-3 border-b border-border/70 bg-brand-mist/40 flex items-start gap-3">
              <span className="w-8 h-8 rounded-lg bg-brand/15 text-brand flex items-center justify-center shrink-0">
                <BellRing size={16} strokeWidth={2} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-semibold text-ink font-ui leading-tight">
                  {labels.enableTitle}
                </p>
                <p className="text-[11.5px] text-gray font-body mt-0.5 leading-snug">
                  {labels.enableDesc}
                </p>
              </div>
              <button
                onClick={handleEnablePush}
                disabled={pushBusy}
                className="shrink-0 h-8 px-3 rounded-full bg-brand text-white text-[12px] font-bold font-ui hover:bg-brand-deepest disabled:opacity-60 transition-colors"
              >
                {pushBusy ? labels.enabling : labels.enableCta}
              </button>
            </div>
          )}

          <div className="overflow-y-auto flex-1">
            {isLoading ? (
              <div className="px-6 py-12 text-center">
                <p className="text-[12px] text-muted font-body">{labels.loading}</p>
              </div>
            ) : items.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <Bell size={30} strokeWidth={1.5} className="text-muted mx-auto mb-3" />
                <p className="text-[13px] font-semibold text-ink font-ui">{labels.empty}</p>
                <p className="text-[11.5px] text-muted font-body mt-1">{labels.emptyDesc}</p>
              </div>
            ) : (
              <ul>
                {items.map((n) => {
                  const { Icon, tone } = TYPE_STYLE[n.type] ?? TYPE_STYLE.promo_banner;
                  return (
                    <li key={n.id} className={`border-b border-border/60 last:border-b-0 ${n.read ? '' : 'bg-brand-mist/30'}`}>
                      <button
                        onClick={() => handleClick(n)}
                        className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-surface-linen transition-colors"
                      >
                        <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
                          <Icon size={17} strokeWidth={1.75} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-ink font-ui leading-tight tracking-tight">
                            {lang === 'es' ? n.title_es : n.title_en}
                          </p>
                          <p className="text-[12px] text-gray font-body mt-0.5 leading-snug">
                            {lang === 'es' ? n.body_es : n.body_en}
                          </p>
                          <p className="text-[11px] text-muted font-body mt-1">{timeAgo(n.created_at, lang)}</p>
                        </div>
                        {!n.read && <span className="w-2 h-2 rounded-full bg-brand mt-1.5 shrink-0" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
