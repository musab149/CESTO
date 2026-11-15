import type { OrderListItem } from '@grocery-app/shared';
import { useBizT } from './i18n';

/** Where an order came from: its shop, Cesto's own, or — a purchase split
 * across shops — how many shops. The order rows and the dashboard read it. */
export function useOrderSource() {
  const t = useBizT();
  return (o: OrderListItem): string => {
    if (o.sub_orders?.length) return t('biz.orders.shops', { count: o.sub_orders.length });
    return o.store?.name ?? t('biz.house');
  };
}

