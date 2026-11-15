import type { OrderStatus } from '@grocery-app/shared';
import { colors } from './colors';

/**
 * One source of truth for how an order status renders, shared by the orders
 * list and the order detail screen. They used to keep separate maps that both
 * predated MV Slice 4, so neither knew about `partially_completed` or `draft`
 * and both indexed straight into the map — rendering `undefined` into the
 * status pill the moment the API returned one of them.
 */
export type OrderStatusMeta = {
  label_en: string;
  label_es: string;
  desc_en: string;
  desc_es: string;
  /** Pill / hero background. */
  bg: string;
  /** Pill / hero foreground, and the dot on list rows. */
  text: string;
  /** Solid fill behind the hero icon and along the tracker rail. */
  accent: string;
};

export const orderStatusConfig: Record<OrderStatus, OrderStatusMeta> = {
  pending: {
    label_en: 'Pending', label_es: 'Pendiente',
    desc_en: 'Waiting for confirmation', desc_es: 'Esperando confirmación',
    bg: colors.surface.sand, text: colors.gray, accent: colors.muted,
  },
  confirmed: {
    label_en: 'Confirmed', label_es: 'Confirmado',
    desc_en: 'Your order is confirmed', desc_es: 'Tu pedido está confirmado',
    bg: colors.infoBg, text: colors.info, accent: colors.info,
  },
  preparing: {
    label_en: 'Preparing', label_es: 'Preparando',
    desc_en: 'We are packing your items', desc_es: 'Estamos preparando tu pedido',
    bg: colors.amber.mist, text: colors.amber.deep, accent: colors.amber.DEFAULT,
  },
  on_the_way: {
    label_en: 'On the way', label_es: 'En camino',
    desc_en: 'Your rider is on the way', desc_es: 'Tu repartidor va en camino',
    bg: '#FFF3E0', text: '#E65100', accent: '#E65100',
  },
  delivered: {
    label_en: 'Delivered', label_es: 'Entregado',
    desc_en: 'Your order was delivered', desc_es: 'Tu pedido fue entregado',
    bg: colors.brand.mist, text: colors.brand.deepest, accent: colors.brand.DEFAULT,
  },
  cancelled: {
    label_en: 'Cancelled', label_es: 'Cancelado',
    desc_en: 'This order was cancelled', desc_es: 'Este pedido fue cancelado',
    bg: colors.dangerBg, text: colors.danger, accent: colors.danger,
  },
  // A line the warehouse is short on is split into its own sub-order rather
  // than failing the whole checkout (MV_DRAFT_ORDERS, on by default). Nothing
  // is charged or reserved for it until someone confirms the stock, so the
  // copy has to read as "we'll get back to you", not as a failure.
  draft: {
    label_en: 'Awaiting stock', label_es: 'Esperando stock',
    desc_en: "Some items are short on stock — we'll confirm these with you",
    desc_es: 'Algunos artículos no tienen stock — te lo confirmaremos',
    bg: colors.warningBg, text: colors.warning, accent: colors.warning,
  },
  // Only reachable on a parent order: every sub finished, but some were
  // delivered and others cancelled.
  partially_completed: {
    label_en: 'Partially completed', label_es: 'Parcialmente completado',
    desc_en: 'Part of this order arrived; the rest was cancelled',
    desc_es: 'Parte de este pedido llegó; el resto se canceló',
    bg: colors.surface.dune, text: colors.charcoal, accent: colors.gray,
  },
};

/**
 * Never index `orderStatusConfig` directly — a shipped binary can outlive the
 * API's enum by weeks (the store build cannot be force-updated), so an unknown
 * status has to degrade into something readable instead of crashing the screen
 * on `config.bg` of undefined.
 */
export function orderStatusMeta(status: string | null | undefined): OrderStatusMeta {
  const known = status ? orderStatusConfig[status as OrderStatus] : undefined;
  if (known) return known;
  const pretty = (status ?? '').replace(/_/g, ' ').trim();
  const fallbackLabel = pretty ? pretty.charAt(0).toUpperCase() + pretty.slice(1) : '—';
  return {
    label_en: fallbackLabel, label_es: fallbackLabel,
    desc_en: 'Check back shortly for an update',
    desc_es: 'Vuelve en un momento para ver la actualización',
    bg: colors.surface.sand, text: colors.gray, accent: colors.muted,
  };
}

/**
 * What DELETE-by-status the API actually accepts on /api/orders/:id/cancel.
 * `draft` is included on purpose — web only offers pending/confirmed, but the
 * server allows it, and a draft is precisely the order a customer stuck
 * waiting on stock wants to walk away from. Cancelling a draft skips the
 * restock, since its items were never decremented.
 */
export const CANCELLABLE_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'draft'];

/** Statuses that are still moving, so the row offers "Track". */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'on_the_way'];

export const isActiveOrderStatus = (status: string): boolean =>
  ACTIVE_ORDER_STATUSES.includes(status as OrderStatus);

/**
 * The four-step rail only describes the happy path. `cancelled` stops short of
 * it, `draft` has not entered it, and `partially_completed` is several rails at
 * once — all three render the hero without a tracker.
 */
export const showsTracker = (status: string): boolean =>
  !['cancelled', 'draft', 'partially_completed'].includes(status);
