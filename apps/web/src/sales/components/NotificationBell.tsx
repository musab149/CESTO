import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Wallet, BadgeCheck, PackageCheck, PackageX, CheckCheck, Undo2, HandCoins } from 'lucide-react';
import {
  useSalesNotifications, useSalesUnreadNotificationCount, useMarkSalesNotificationRead,
  useMarkAllSalesNotificationsRead, type AppNotification,
} from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useSalesT } from '../lib/i18n';
import EmptyState from './EmptyState';
import { Skeleton } from './Skeleton';
import { Dialog } from './Dialog';

/**
 * The rep's bell (2026-10-26, user: "Build rep notifications"): what happened
 * to their money and to the orders they built — a period published or paid,
 * an order delivered or cancelled by somebody else (API lib/notifications,
 * audience `sales_rep`).
 *
 * The badge polls every half minute. The list loads when the bell is opened,
 * in the panel's dialog shell (components/Dialog): a sheet from the bottom on
 * a phone, hanging under the bell from lg. Opening one marks it read and goes
 * where it points.
 */

const KIND: Record<string, { icon: React.ElementType; tile: string }> = {
  rep_statement_published: { icon: Wallet, tile: 'bg-brand-whisper text-brand' },
  rep_statement_paid: { icon: BadgeCheck, tile: 'bg-success-bg text-success' },
  rep_order_delivered: { icon: PackageCheck, tile: 'bg-success-bg text-success' },
  rep_order_cancelled: { icon: PackageX, tile: 'bg-danger-bg text-danger' },
  // Earnings order by order (2026-10-28).
  rep_earning_approved: { icon: BadgeCheck, tile: 'bg-success-bg text-success' },
  rep_earning_reversed: { icon: Undo2, tile: 'bg-danger-bg text-danger' },
  rep_earning_adjusted: { icon: Wallet, tile: 'bg-brand-whisper text-brand' },
  rep_payout_recorded: { icon: HandCoins, tile: 'bg-success-bg text-success' },
};

function whenLabel(iso: string, lang: 'es' | 'en', yesterday: string): string {
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(lang === 'en' ? 'en-GB' : 'es-ES', { numeric: 'auto', style: 'short' });
  if (mins < 60) return rtf.format(-Math.max(mins, 0), 'minute');
  if (mins < 24 * 60) return rtf.format(-Math.round(mins / 60), 'hour');
  if (mins < 48 * 60) return yesterday;
  return then.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' });
}

export default function NotificationBell({ onDark = false }: { onDark?: boolean }) {
  const t = useSalesT();
  const [open, setOpen] = useState(false);
  const { data: unread } = useSalesUnreadNotificationCount();
  const count = unread?.count ?? 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count > 0 ? `${t('sales.notif.title')}, ${t(count === 1 ? 'sales.notif.unread_one' : 'sales.notif.unread_other', { count })}` : t('sales.notif.title')}
        className={`relative w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
          onDark ? 'text-white hover:bg-white/10' : 'bg-card border border-brand-mist text-ink hover:border-brand/40 shadow-card'
        }`}
      >
        <Bell size={19} strokeWidth={1.75} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold font-display leading-[18px] text-center ring-2 ring-white tabular-nums">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {/* The dialog shell renders into the body: the sticky header is a
          stacking context of its own, below the floating tab bar. */}
      {open && <Inbox onClose={() => setOpen(false)} />}
    </>
  );
}

function Inbox({ onClose }: { onClose: () => void }) {
  const t = useSalesT();
  const lang = useLanguageStore((s) => s.lang) as 'es' | 'en';
  const navigate = useNavigate();
  const { data, isLoading } = useSalesNotifications({ limit: 30 });
  const markRead = useMarkSalesNotificationRead();
  const markAll = useMarkAllSalesNotificationsRead();
  const items = data?.items ?? [];
  const unread = items.filter((n) => !n.read).length;

  const openOne = (n: AppNotification) => {
    if (!n.read) markRead.mutate(n.id);
    onClose();
    if (n.deeplink) navigate(n.deeplink);
  };

  return (
    <Dialog
      variant="popover"
      onClose={onClose}
      title={t('sales.notif.title')}
      subtitle={unread > 0 ? t(unread === 1 ? 'sales.notif.unread_one' : 'sales.notif.unread_other', { count: unread }) : undefined}
      icon={Bell}
      bodyClassName="p-0"
      headerAction={unread > 0 ? (
        <button
          type="button"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending}
          title={t('sales.notif.markAll')}
          aria-label={t('sales.notif.markAll')}
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
          title={t('sales.notif.emptyTitle')}
          description={t('sales.notif.emptyBody')}
          action={{ label: t('sales.notif.emptyCta'), onClick: () => { onClose(); navigate('/sales/orders'); } }}
        />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((n) => {
            const k = KIND[n.type] ?? { icon: Bell, tile: 'bg-surface-sand text-gray' };
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
                      <span className="shrink-0 text-[11.5px] text-muted">{whenLabel(n.created_at, lang, t('sales.notif.yesterday'))}</span>
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
