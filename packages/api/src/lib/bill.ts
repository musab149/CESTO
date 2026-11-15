import { Prisma } from '@prisma/client';
import prisma from './prisma';

/**
 * The Bill: a plain priced list of what a customer bought, to download and
 * hand over — beside the albarán and the factura, not instead of either
 * (user, 2026-10-27: "along with albaran and facture we need an invoice that
 * can be downloaded and it will not have any information related to customer
 * other then his name and our company name that's it").
 *
 * And no Cesto either (user, 2026-11-04: "remove the information related to
 * cesto from that"): the company name it used to head the page with is gone,
 * so a Bill names nobody but the customer.
 *
 * So the payload is built HERE and holds nothing else: the customer's name,
 * the order's number and date, the lines and the totals. No address, phone,
 * email, tax id, payment method or company of ours reaches the browser for
 * it, whichever screen prints it — the PDF cannot show what it was never sent.
 *
 * Made on demand from the order, never stored or numbered: it is not a fiscal
 * document (no NIF, no series), so it never locks the order and always shows
 * the order as it stands. A split purchase gets one Bill for all of it, like
 * its albarán and factura (Invoice.parent_order_id).
 */

export interface BillLine {
  name_es: string;
  name_en: string | null;
  variant_es: string | null;
  variant_en: string | null;
  quantity: number;
  /** What one unit costs this customer — net of their discount, so quantity × this is the line. */
  unit_price: string;
  line_total: string;
}

export interface Bill {
  customer: string;
  order_number: string;
  date: Date;
  lines: BillLine[];
  subtotal: string;
  delivery_fee: string;
  /** No fee set yet (our team sets it per order, 2026-10-23): "to be confirmed", not "free". */
  delivery_pending: boolean;
  /** Recargo de equivalencia charged (2026-11-04); '0.00' for a customer not under it. */
  recargo: string;
  total: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ITEM_SELECT = {
  product_snapshot: true, quantity: true, unit_price: true, unit_discount: true, discount_amount: true, line_total: true,
} as const;

type ItemRow = Prisma.OrderItemGetPayload<{ select: typeof ITEM_SELECT }>;

function lineOf(i: ItemRow): BillLine {
  const snap = (i.product_snapshot ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);
  // Per-unit discount since 2026-10-25; an older line may carry a flat one,
  // which only the line total knows how to spread.
  const unit = i.unit_discount !== null
    ? i.unit_price.sub(i.unit_discount)
    : i.discount_amount !== null && !i.discount_amount.isZero()
      ? i.line_total.div(i.quantity)
      : i.unit_price;
  return {
    name_es: text(snap.name_es) ?? text(snap.name_en) ?? '—',
    name_en: text(snap.name_en),
    variant_es: text(snap.variant_name_es),
    variant_en: text(snap.variant_name_en),
    quantity: i.quantity,
    unit_price: unit.toFixed(2),
    line_total: i.line_total.toFixed(2),
  };
}

/**
 * The Bill for an order or a split purchase, by either id; a part of a split
 * purchase bills the whole of it. `where` narrows who may see the order (a
 * rep: only theirs). Null = not found for them.
 */
export async function billFor(id: string, where: Prisma.OrderWhereInput = {}): Promise<Bill | null> {
  if (!UUID.test(id)) return null;
  const order = await prisma.order.findFirst({
    where: { id, deleted_at: null, ...where },
    select: {
      order_number: true, created_at: true, subtotal: true, delivery_fee: true, recargo: true, total: true, parent_order_id: true,
      user: { select: { name: true } },
      items: { select: ITEM_SELECT, orderBy: { id: 'asc' } },
    },
  });
  const parentId = order ? order.parent_order_id : (Object.keys(where).length === 0 ? id : null);

  if (order && !parentId) {
    return {
      customer: order.user.name,
      order_number: order.order_number,
      date: order.created_at,
      lines: order.items.map(lineOf),
      subtotal: order.subtotal.toFixed(2),
      delivery_fee: order.delivery_fee.toFixed(2),
      delivery_pending: order.delivery_fee.isZero(),
      recargo: order.recargo.toFixed(2),
      total: order.total.toFixed(2),
    };
  }
  if (!parentId) return null;

  const parent = await prisma.parentOrder.findUnique({
    where: { id: parentId },
    select: {
      order_number: true, created_at: true, delivery_fee_total: true, recargo: true,
      user: { select: { name: true } },
      // Live parts only: a deleted shop is not part of the purchase any more.
      sub_orders: {
        where: { deleted_at: null },
        select: { subtotal: true, total: true, items: { select: ITEM_SELECT, orderBy: { id: 'asc' } } },
        orderBy: { created_at: 'asc' },
      },
    },
  });
  if (!parent) return null;
  // Summed from the parts printed, with the purchase's one delivery fee — the
  // arithmetic editOrder writes the parent's totals with — so the lines on the
  // page always add up to its total, whatever the stored row says.
  const sum = (pick: (o: { subtotal: Prisma.Decimal; total: Prisma.Decimal }) => Prisma.Decimal) =>
    parent.sub_orders.reduce((s, o) => s.plus(pick(o)), new Prisma.Decimal(0));
  return {
    customer: parent.user.name,
    order_number: parent.order_number,
    date: parent.created_at,
    lines: parent.sub_orders.flatMap((o) => o.items.map(lineOf)),
    subtotal: sum((o) => o.subtotal).toFixed(2),
    delivery_fee: parent.delivery_fee_total.toFixed(2),
    delivery_pending: parent.delivery_fee_total.isZero(),
    // Charged once on the whole purchase, never on its parts.
    recargo: parent.recargo.toFixed(2),
    total: sum((o) => o.total).plus(parent.delivery_fee_total).plus(parent.recargo).toFixed(2),
  };
}
