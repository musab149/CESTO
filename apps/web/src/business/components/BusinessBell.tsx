import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, PackageCheck, PackageX, Truck, BadgeCheck, Receipt } from 'lucide-react';
import {
  businessPathFor, useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications,
  useUnreadNotificationCount, type AppNotification,
} from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useBizT } from '../lib/i18n';
import EmptyState from '@/sales/components/EmptyState';
import { Skeleton } from '@/sales/components/Skeleton';
import { Dialog } from '@/sales/components/Dialog';

/**
 * The buyer's bell (2026-10-29): their order notifications — the customer
 * inbox, in the rep bell's shell (sales/components/NotificationBell). A
 * notification points at a shop page; opening one goes to the panel's own
 * (routeAccess businessPathFor), so "your order is on its way" opens the
 * order here rather than bouncing through the shop.
 */

/** A tile for the kinds a buyer gets most; anything else, a plain bell. */
function kindOf(type: string): { icon: React.ElementType; tile: string } {
  if (/deliver/.test(type)) return { icon: PackageCheck, tile: 'bg-success-bg text-success' };
  if (/cancel|reject/.test(type)) return { icon: PackageX, tile: 'bg-danger-bg text-danger' };
  if (/way|dispatch|ship|rider/.test(type)) return { icon: Truck, tile: 'bg-brand-whisper text-brand' };
  if (/confirm|accept|ready/.test(type)) return { icon: BadgeCheck, tile: 'bg-success-bg text-success' };
  if (/order|fee|invoice/.test(type)) return { icon: Receipt, tile: 'bg-brand-whisper text-brand' };
  return { icon: Bell, tile: 'bg-surface-sand text-gray' };
}

function whenLabel(iso: string, lang: 'es' | 'en', yesterday: string): string {
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(lang === 'en' ? 'en-GB' : 'es-ES', { numeric: 'auto', style: 'short' });
  if (mins < 60) return rtf.format(-Math.max(mins, 0), 'minute');
  if (mins < 24 * 60) return rtf.format(-Math.round(mins / 60), 'hour');
  if (mins < 48 * 60) return yesterday;
  return then.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' });
}

/** Where a notification's link goes inside the panel. */
function panelLink(deeplink: string | null | undefined): string | null {
  if (!deeplink) return null;
  if (deeplink.startsWith('/business')) return deeplink;
  if (!deeplink.startsWith('/')) return null;
  return businessPathFor(deeplink.split('?')[0]);
}

export default function BusinessBell({ onDark = false }: { onDark?: boolean }) {
  const t = useBizT();
  const [open, setOpen] = useState(false);
  const { data: unread } = useUnreadNotificationCount({ refetchInterval: 30_000 });
  const count = unread?.count ?? 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count > 0 ? `${t('biz.notif.title')}, ${t(count === 1 ? 'biz.notif.unread_one' : 'biz.notif.unread_other', { count })}` : t('biz.notif.title')}
        className={`relative w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
          onDark ? 'text-white hover:bg-white/10' : 'bg-card border border-brand-mist text-ink hover:border-brand/40 shadow-card'
        }`}
      >
        <Bell size={19} strokeWidth={1.75} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold font-display leading-[18px] text-center ring-2 ring-card tabular-nums">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && <Inbox onClose={() => setOpen(false)} />}
    </>
  );
}

function Inbox({ onClose }: { onClose: () => void }) {
  const t = useBizT();
  const lang = useLanguageStore((s) => s.lang) as 'es' | 'en';
  const navigate = useNavigate();
  const { data, isLoading } = useNotifications({ limit: 30 });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const items = data?.items ?? [];
  const unread = items.filter((n) => !n.read).length;

  const openOne = (n: AppNotification) => {
    if (!n.read) markRead.mutate(n.id);
    onClose();
    const to = panelLink(n.deeplink);
    if (to) navigate(to);
  };

  return (
    <Dialog
      variant="popover"
      onClose={onClose}
      title={t('biz.notif.title')}
      subtitle={unread > 0 ? t(unread === 1 ? 'biz.notif.unread_one' : 'biz.notif.unread_other', { count: unread }) : undefined}
      icon={Bell}
      bodyClassName="p-0"
      headerAction={unread > 0 ? (
        <button
          type="button"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending}
          title={t('biz.notif.markAll')}
          aria-label={t('biz.notif.markAll')}
          className="w-9 h-9 rounded-full text-brand hover:bg-brand-whisper disabled:opacity-60 flex items-center justify-center shrink-0 transition-colors"
        >
          <CheckCheck size={18} strokeWidth={1.75} />
        </button>
      ) : undefined}
    >
      {isLoading ? (
        <div className="divide-y divide-border">
          {[0, 1, 2].map((i) => (
            <div key={i} className="px-5 py-3.5 flex gap-3">
              <Skeleton className="w-10 h-10 rounded-xl" />
              <div className="flex-1 space-y-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-full" /></div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Bell size={28} strokeWidth={1.75} className="text-muted" />}
          title={t('biz.notif.emptyTitle')}
          description={t('biz.notif.emptyBody')}
          action={{ label: t('biz.notif.emptyCta'), onClick: () => { onClose(); navigate('/business/orders'); } }}
        />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((n) => {
            const k = kindOf(n.type);
            const Icon = k.icon;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openOne(n)}
                  className={`w-full text-left px-5 py-3.5 flex items-start gap-3 hover:bg-surface-cream active:bg-surface-cream transition-colors ${n.read ? '' : 'bg-brand-whisper/50'}`}
                >
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${k.tile}`}>
                    <Icon size={19} strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={`flex-1 min-w-0 truncate text-[14.5px] font-display text-ink ${n.read ? 'font-medium' : 'font-semibold'}`}>
                        {lang === 'en' ? n.title_en : n.title_es}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-muted">{whenLabel(n.created_at, lang, t('biz.notif.yesterday'))}</span>
                    </span>
                    <span className="block mt-0.5 text-[13px] text-gray leading-snug line-clamp-2">
                      {lang === 'en' ? n.body_en : n.body_es}
                    </span>
                  </span>
                  {!n.read && <span className="mt-2 w-2 h-2 rounded-full bg-brand shrink-0" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
