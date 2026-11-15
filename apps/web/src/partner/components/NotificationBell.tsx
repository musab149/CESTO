import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, CheckCheck, PencilLine, ShoppingBag, Timer, XCircle } from 'lucide-react';
import {
  PARTNER_ORDERS_KEY,
  usePartnerNotifications,
  usePartnerUnreadNotificationCount,
  useMarkPartnerNotificationRead,
  useMarkAllPartnerNotificationsRead,
  type AppNotification,
} from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { isSupported, currentPermission, subscribeToPush } from '@/lib/webPush';
import { usePartnerT } from '../lib/i18n';

/**
 * The dashboard bell: new orders for this shop, parts waiting on its stock,
 * and anything the customer or Cesto changed or cancelled. Each one also goes
 * out as a push (lib/notifications notifyPartnerOrder) — there is no email —
 * so this is where they are read back, not the only way they arrive.
 */

const TYPE_STYLE: Record<string, { Icon: typeof Bell; tone: string }> = {
  partner_new_order:       { Icon: ShoppingBag, tone: 'bg-brand-mist text-brand' },
  partner_draft_order:     { Icon: Timer,       tone: 'bg-warning-bg text-warning' },
  partner_order_edited:    { Icon: PencilLine,  tone: 'bg-brand-mist text-brand' },
  partner_order_cancelled: { Icon: XCircle,     tone: 'bg-danger-bg text-danger' },
};
const FALLBACK = { Icon: Bell, tone: 'bg-surface-cream text-ink/60' };

function timeAgo(iso: string, lang: 'es' | 'en'): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return lang === 'es' ? `hace ${mins} min` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return lang === 'es' ? `hace ${hours} h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return lang === 'es' ? `hace ${days} d` : `${days}d ago`;
}

export default function NotificationBell() {
  const t = usePartnerT();
  const lang = useLanguageStore((s) => s.lang) === 'en' ? 'en' : 'es';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data, isLoading } = usePartnerNotifications({ limit: 20 });
  const { data: unread } = usePartnerUnreadNotificationCount();
  const markRead = useMarkPartnerNotificationRead();
  const markAll = useMarkAllPartnerNotificationsRead();
  const items: AppNotification[] = data?.items ?? [];
  const unreadCount = unread?.count ?? 0;

  // A new notice almost always means a new or changed order, so the orders
  // table on screen is refreshed with it rather than waiting for its own poll.
  const lastCount = useRef(unreadCount);
  useEffect(() => {
    if (unreadCount > lastCount.current) qc.invalidateQueries({ queryKey: PARTNER_ORDERS_KEY });
    lastCount.current = unreadCount;
  }, [unreadCount, qc]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  // Browser push, offered once: hidden when unsupported or already decided.
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(() => currentPermission());
  const [enabling, setEnabling] = useState(false);
  const offerPush = isSupported() && perm === 'default';
  const enablePush = async () => {
    setEnabling(true);
    await subscribeToPush();
    setEnabling(false);
    setPerm(currentPermission());
  };

  const openOne = (n: AppNotification) => {
    if (!n.read) markRead.mutate(n.id);
    setOpen(false);
    if (n.deeplink) navigate(n.deeplink);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex items-center justify-center w-10 h-10 rounded-lg text-ink/70 hover:text-ink hover:bg-surface-cream transition-colors"
        aria-label={t('notifications.title')}
        aria-expanded={open}
      >
        <Bell size={20} strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold font-display flex items-center justify-center ring-2 ring-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('notifications.title')}
          // On a phone the bell is not the last thing in the header, so a
          // panel hung off it runs out of the screen — it spans the width
          // under the header instead.
          className="fixed inset-x-3 top-[60px] sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[360px] z-40 max-h-[480px] bg-white rounded-xl shadow-float border border-border flex flex-col overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
            <p className="text-sm font-semibold font-display text-ink">{t('notifications.title')}</p>
            <button
              type="button"
              onClick={() => markAll.mutate()}
              disabled={unreadCount === 0 || markAll.isPending}
              className="inline-flex items-center gap-1.5 text-xs font-semibold font-display text-brand hover:text-brand-deepest disabled:text-ink/30 disabled:cursor-default transition-colors"
            >
              <CheckCheck size={14} strokeWidth={2} />
              {t('notifications.markAll')}
            </button>
          </div>

          {offerPush && (
            <div className="px-4 py-3 border-b border-border bg-brand-mist/40 flex items-start gap-3">
              <span className="w-8 h-8 rounded-lg bg-brand/15 text-brand flex items-center justify-center shrink-0">
                <BellRing size={16} strokeWidth={1.75} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold font-display text-ink leading-tight">{t('notifications.enableTitle')}</p>
                <p className="text-xs text-ink/60 mt-0.5 leading-snug">{t('notifications.enableBody')}</p>
              </div>
              <button
                type="button"
                onClick={enablePush}
                disabled={enabling}
                className="shrink-0 h-8 px-3 rounded-lg bg-brand text-white text-xs font-semibold font-display hover:bg-brand-mid disabled:opacity-60 transition-colors"
              >
                {enabling ? t('notifications.enabling') : t('notifications.enable')}
              </button>
            </div>
          )}

          <div className="overflow-y-auto flex-1">
            {isLoading ? (
              <ul aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="flex gap-3 px-4 py-3 border-b border-border/60 last:border-b-0">
                    <div className="skeleton w-9 h-9 !rounded-lg shrink-0" />
                    <div className="flex-1 space-y-1.5 pt-0.5">
                      <div className="skeleton h-3.5 w-1/2" />
                      <div className="skeleton h-3 w-4/5" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : items.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <span className="mx-auto mb-3 w-12 h-12 rounded-full bg-surface-cream flex items-center justify-center">
                  <Bell size={22} strokeWidth={1.75} className="text-ink/40" />
                </span>
                <p className="text-sm font-semibold font-display text-ink">{t('notifications.empty')}</p>
                <p className="text-xs text-ink/60 mt-1 leading-relaxed">{t('notifications.emptyBody')}</p>
              </div>
            ) : (
              <ul>
                {items.map((n) => {
                  const { Icon, tone } = TYPE_STYLE[n.type] ?? FALLBACK;
                  return (
                    <li key={n.id} className={`border-b border-border/60 last:border-b-0 ${n.read ? '' : 'bg-brand-mist/30'}`}>
                      <button
                        type="button"
                        onClick={() => openOne(n)}
                        className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-surface-cream transition-colors"
                      >
                        <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
                          <Icon size={17} strokeWidth={1.75} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] font-semibold font-display text-ink leading-tight">
                            {lang === 'es' ? n.title_es : n.title_en}
                          </span>
                          <span className="block text-xs text-ink/70 mt-0.5 leading-snug">
                            {lang === 'es' ? n.body_es : n.body_en}
                          </span>
                          <span className="block text-[11px] text-ink/45 mt-1">{timeAgo(n.created_at, lang)}</span>
                        </span>
                        {!n.read && <span className="w-2 h-2 rounded-full bg-brand mt-1.5 shrink-0" aria-hidden="true" />}
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
