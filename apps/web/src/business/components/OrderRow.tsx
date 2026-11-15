import { ChevronRight, Store } from 'lucide-react';
import type { OrderListItem } from '@grocery-app/shared';
import { money, shortDate } from '@/sales/lib/format';
import SalesStatusBadge from '@/sales/components/SalesStatusBadge';
import { useBizT } from '../lib/i18n';
import { useOrderSource } from '../lib/orders';

/**
 * One of the buyer's orders in a list — the dashboard's latest and the
 * Pedidos page (2026-10-29). The rep panel's order row (SalesTodayPage), with
 * where it came from in place of a client: the shop, Cesto's own, or — a
 * purchase split across shops — how many shops.
 */
export default function OrderRow({ order, lang, onOpen }: { order: OrderListItem; lang: 'es' | 'en'; onOpen: () => void }) {
  const t = useBizT();
  const source = useOrderSource()(order);
  const lines = order._count?.items ?? 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full min-h-[72px] px-4 sm:px-5 py-3 flex items-center gap-3 text-left hover:bg-surface-cream active:bg-surface-cream transition-colors"
    >
      <span className="w-10 h-10 rounded-xl bg-brand-whisper text-brand ring-1 ring-inset ring-brand-mist flex items-center justify-center shrink-0" aria-hidden="true">
        <Store size={18} strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold font-display text-ink truncate">
          <span className="font-mono text-[13.5px]">{order.order_number}</span>
        </span>
        <span className="block text-[12.5px] text-muted truncate mt-0.5">
          {shortDate(order.created_at, lang)}
          <span aria-hidden="true">{'  ·  '}</span>
          {source}
          <span aria-hidden="true">{'  ·  '}</span>
          {t(lines === 1 ? 'biz.orders.lines_one' : 'biz.orders.lines_other', { count: lines })}
        </span>
      </span>
      <span className="shrink-0 flex flex-col items-end gap-1">
        <span className="text-[15px] font-bold font-display text-ink tabular-nums">{money(order.total)}</span>
        <SalesStatusBadge status={order.status} />
      </span>
      <ChevronRight size={17} strokeWidth={1.75} className="text-muted shrink-0 hidden sm:block" aria-hidden="true" />
    </button>
  );
}
