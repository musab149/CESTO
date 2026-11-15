import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Bell,
  BellOff,
  ShoppingCart,
  AlertCircle,
  UserPlus,
  PauseCircle,
  CheckCheck,
  Megaphone,
  FileText,
  HeartHandshake,
  CalendarClock,
} from 'lucide-react';
import {
  currentPermission,
  isSupported as isPushSupported,
  subscribeToPush,
  registerServiceWorker,
} from '@/lib/webPush';
import {
  useAdminNotifications,
  useAdminUnreadNotificationCount,
  useMarkAdminNotificationRead,
  useMarkAllAdminNotificationsRead,
  type AppNotification,
  type NotificationType,
} from '@grocery-app/shared';
import { setFaviconBadge, resetFaviconBadge, playOrderPing } from '@/lib/favicon';

function timeAgo(iso: string, lang: 'es' | 'en'): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(diffMs / 60_000));
  if (mins < 60)   return lang === 'es' ? `hace ${mins} min` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24)  return lang === 'es' ? `hace ${hours} h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return lang === 'es' ? `hace ${days} d` : `${days}d ago`;
}

const ICON_MAP: Record<NotificationType, typeof ShoppingCart> = {
  admin_new_order: ShoppingCart,
  admin_low_stock: AlertCircle,
  admin_new_customer: UserPlus,
  admin_subscription_paused: PauseCircle,
  admin_broadcast: Megaphone,
  admin_quotation_request: FileText,
  admin_home_grocery_request: HeartHandshake,
  admin_home_grocery_plan: CalendarClock,
  home_grocery_delivery_planned: Bell,
  // Customer types (shouldn't appear in admin feed but keep type-exhaustive)
  order_confirmed: ShoppingCart,
  order_preparing: ShoppingCart,
  order_on_the_way: ShoppingCart,
  order_delivered: ShoppingCart,
  order_cancelled: ShoppingCart,
  promo_banner: Bell,
  home_grocery_approved: Bell,
  home_grocery_rejected: Bell,
  order_placed: ShoppingCart,
  // Partner dashboard types — not in the admin feed either.
  partner_new_order: ShoppingCart,
  partner_draft_order: ShoppingCart,
  partner_order_edited: ShoppingCart,
  partner_order_cancelled: ShoppingCart,
  // The rep panel's types — not in the admin feed either.
  rep_statement_published: Bell,
  rep_statement_paid: Bell,
  rep_order_delivered: ShoppingCart,
  rep_order_cancelled: ShoppingCart,
  // A rep's bell only — listed because the map is exhaustive.
  rep_earning_approved: Bell,
  rep_earning_reversed: Bell,
  rep_earning_adjusted: Bell,
  rep_payout_recorded: Bell,
};

const TONE_MAP: Record<NotificationType, string> = {
  admin_new_order: 'bg-brand-mist text-brand',
  admin_low_stock: 'bg-amber-mist text-amber-deep',
  admin_new_customer: 'bg-info-bg text-info',
  admin_subscription_paused: 'bg-surface-linen text-muted',
  admin_broadcast: 'bg-brand-mist text-brand',
  admin_quotation_request: 'bg-success-bg text-success',
  admin_home_grocery_request: 'bg-brand-mist text-brand',
  admin_home_grocery_plan: 'bg-brand-mist text-brand',
  home_grocery_delivery_planned: 'bg-brand-mist text-brand',
  home_grocery_approved: 'bg-brand-mist text-brand',
  home_grocery_rejected: 'bg-surface-linen text-muted',
  order_confirmed: 'bg-brand-mist text-brand',
  order_preparing: 'bg-brand-mist text-brand',
  order_on_the_way: 'bg-amber-mist text-amber-deep',
  order_delivered: 'bg-brand-mist text-brand',
  order_cancelled: 'bg-danger-bg text-danger',
  promo_banner: 'bg-brand-mist text-brand',
  order_placed: 'bg-brand-mist text-brand',
  partner_new_order: 'bg-brand-mist text-brand',
  partner_draft_order: 'bg-amber-mist text-amber-deep',
  partner_order_edited: 'bg-brand-mist text-brand',
  partner_order_cancelled: 'bg-danger-bg text-danger',
  rep_statement_published: 'bg-brand-mist text-brand',
  rep_statement_paid: 'bg-success-bg text-success',
  rep_order_delivered: 'bg-brand-mist text-brand',
  rep_order_cancelled: 'bg-danger-bg text-danger',
  rep_earning_approved: 'bg-success-bg text-success',
  rep_earning_reversed: 'bg-danger-bg text-danger',
  rep_earning_adjusted: 'bg-brand-mist text-brand',
  rep_payout_recorded: 'bg-success-bg text-success',
};

interface Props {
  className?: string;
}

export default function NotificationsBell({ className }: Props) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language === 'es' ? 'es' : 'en') as 'es' | 'en';
  const [open, setOpen] = useState(false);
  const lastSeenCountRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Web push permission state, tracked locally so the "Enable notifications"
  // footer reflects real browser state without a full re-render pass.
  const [pushPerm, setPushPerm] = useState<NotificationPermission | 'unsupported'>(currentPermission);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  // Best-effort service worker mount on first render so a page reload with
  // already-granted permission stays live.
  useEffect(() => {
    if (isPushSupported() && Notification.permission === 'granted') {
      void registerServiceWorker();
    }
  }, []);

  async function handleEnablePush() {
    setPushBusy(true);
    setPushError(null);
    const res = await subscribeToPush();
    setPushBusy(false);
    setPushPerm(currentPermission());
    if (res.status === 'permission_denied') {
      setPushError(lang === 'es'
        ? 'Permiso denegado en el navegador. Actívalo desde el candado en la URL.'
        : 'Permission denied in the browser. Enable it via the URL lock icon.');
    } else if (res.status === 'server_not_configured') {
      setPushError(lang === 'es'
        ? 'Push aún no está configurado en el servidor.'
        : 'Push is not configured on the server yet.');
    } else if (res.status === 'error') {
      setPushError(res.message);
    }
  }

  // Poll the unread count so the badge updates while ops keeps the dashboard
  // open. The list itself is fetched on demand when the dropdown opens.
  const { data: unread } = useAdminUnreadNotificationCount({ refetchInterval: 30_000 });
  const { data, isLoading } = useAdminNotifications({ limit: 30 });
  const markRead = useMarkAdminNotificationRead();
  const markAllRead = useMarkAllAdminNotificationsRead();

  const items: AppNotification[] = data?.items ?? [];
  const unreadCount = unread?.count ?? items.filter((n) => !n.read).length;

  // Favicon badge tracks unread count.
  useEffect(() => {
    if (unreadCount > 0) void setFaviconBadge(unreadCount);
    else resetFaviconBadge();
  }, [unreadCount]);

  // Sound ping on rising edge — skip the initial mount so a refresh with
  // unread items doesn't blast a chime.
  useEffect(() => {
    if (unreadCount > lastSeenCountRef.current && lastSeenCountRef.current !== 0) {
      playOrderPing();
    }
    lastSeenCountRef.current = unreadCount;
  }, [unreadCount]);

  // Close dropdown on outside click
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

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative w-9 h-9 rounded-full border border-border bg-card text-gray hover:text-ink hover:border-ink/30 flex items-center justify-center transition-colors"
        aria-label={t('layout.notifications')}
        aria-expanded={open}
      >
        <Bell size={16} strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold font-display flex items-center justify-center leading-none ring-2 ring-card"
            aria-label={lang === 'es' ? `${unreadCount} notificaciones sin leer` : `${unreadCount} unread notifications`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('layout.notifications')}
          // On a phone it spans the screen under the top bar (2026-11-05):
          // a 360px panel hung from the bell's right edge ran off the left
          // side of a 390px screen. From sm, the dropdown it was.
          className="fixed left-2 right-2 top-[3.75rem] max-h-[calc(100dvh-5rem)] sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[360px] sm:max-h-[480px] bg-card rounded-2xl shadow-float border border-border z-50 flex flex-col overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <p className="text-sm font-extrabold text-ink font-display">
              {t('layout.notifications')}
            </p>
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={unreadCount === 0 || markAllRead.isPending}
              className="flex items-center gap-1.5 text-xs font-semibold font-display text-brand hover:text-brand-mid disabled:text-muted disabled:cursor-default transition-colors"
            >
              <CheckCheck size={14} strokeWidth={1.75} />
              {lang === 'es' ? 'Marcar todas como leídas' : 'Mark all as read'}
            </button>
          </div>

          {/* Push-permission footer strip — sits between the header and
              the list. Shows a subscribe button when permission is
              missing, a subtle "on" indicator when granted, or a
              browser-settings hint when the user blocked it. */}
          {pushPerm !== 'unsupported' && (
            <div className="px-4 py-2 border-b border-border bg-surface-linen/50">
              {pushPerm === 'granted' ? (
                <p className="text-[11px] text-success font-body flex items-center gap-1.5">
                  <Bell size={11} strokeWidth={2} />
                  {lang === 'es' ? 'Notificaciones activadas' : 'Push notifications enabled'}
                </p>
              ) : pushPerm === 'denied' ? (
                <p className="text-[11px] text-muted font-body flex items-center gap-1.5">
                  <BellOff size={11} strokeWidth={2} />
                  {lang === 'es'
                    ? 'Bloqueado. Actívalo en los ajustes del navegador.'
                    : 'Blocked. Enable it in browser settings.'}
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleEnablePush}
                    disabled={pushBusy}
                    className="w-full text-left text-[11px] font-semibold font-display text-brand hover:text-brand-mid disabled:text-muted disabled:cursor-default transition-colors flex items-center gap-1.5"
                  >
                    <Bell size={11} strokeWidth={2} />
                    {pushBusy
                      ? (lang === 'es' ? 'Solicitando permiso…' : 'Requesting permission…')
                      : (lang === 'es' ? 'Activar notificaciones del navegador' : 'Enable browser notifications')}
                  </button>
                  {pushError && (
                    <p className="text-[10px] text-danger font-body mt-1 leading-snug">{pushError}</p>
                  )}
                </>
              )}
            </div>
          )}

          <div className="overflow-y-auto flex-1">
            {isLoading ? (
              <div className="px-4 py-12 text-center">
                <p className="text-xs text-muted font-body">
                  {lang === 'es' ? 'Cargando…' : 'Loading…'}
                </p>
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <Bell size={28} strokeWidth={1.75} className="text-muted mx-auto mb-3" />
                <p className="text-sm font-display text-muted">
                  {lang === 'es' ? 'Sin notificaciones' : 'No notifications'}
                </p>
              </div>
            ) : (
              <ul>
                {items.map((n) => {
                  const Icon = ICON_MAP[n.type] ?? Bell;
                  const tone = TONE_MAP[n.type] ?? 'bg-surface-linen text-muted';
                  return (
                    <li key={n.id} className={`border-b border-border last:border-b-0 ${n.read ? '' : 'bg-brand-mist/30'}`}>
                      <Link
                        to={n.deeplink ?? '#'}
                        onClick={() => {
                          if (!n.read) markRead.mutate(n.id);
                          setOpen(false);
                        }}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-surface-linen transition-colors"
                      >
                        <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
                          <Icon size={18} strokeWidth={1.75} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-ink font-display leading-tight">
                            {lang === 'es' ? n.title_es : n.title_en}
                          </p>
                          <p className="text-xs text-gray font-body mt-0.5 leading-snug">
                            {lang === 'es' ? n.body_es : n.body_en}
                          </p>
                          <p className="text-[11px] text-muted font-body mt-1">{timeAgo(n.created_at, lang)}</p>
                        </div>
                        {!n.read && <span className="w-2 h-2 rounded-full bg-brand mt-2 shrink-0" />}
                      </Link>
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
