/**
 * Whose delivery fee has not been set yet.
 *
 * WE NEVER TELL ANYONE DELIVERY IS FREE. Not on the storefront, not in the
 * admin panel, not in a receipt — and not for retail orders either. The fee is
 * a judgement about the parcel that the office makes once it can see the
 * order, so a zero on the screen means "nobody has put a number on this yet",
 * which is a different sentence from "you are not being charged".
 *
 * "Free" is a promise. Saying it and then adding a charge is the complaint
 * this is shaped to avoid, and it is worth avoiding even on the orders where
 * a fee happens to have been priced at checkout — because the office can
 * still change it, and the customer read a promise.
 *
 * So every screen asks this one question and renders one of three things:
 *
 *   a number                        the fee, once somebody set it
 *   "Added by us shortly"           nobody has yet — this function
 *   "Charged on the whole purchase" a part of a split, which never carries it
 *
 * A PART OF A SPLIT PURCHASE IS NEVER PENDING. Its zero is structural, not
 * missing: one delivery is charged once, on the purchase, and every part
 * carries nothing by design. Without that check a basket split across three
 * shops claimed the same single fee was outstanding in four places, three of
 * which could do nothing about it.
 *
 * THE ONE AMBIGUOUS CASE, stated rather than hidden: an admin who decides a
 * particular drop costs nothing sets the fee to zero, and this still reads as
 * "to come". The customer is told a fee is pending that never arrives — mild,
 * and the honest fix is a column recording that the fee has been SET rather
 * than inferring it from its value. Worth doing if anyone actually waives
 * one; not worth a migration before then.
 */
export function deliveryFeeIsPending(order: {
  delivery_fee: string | number;
  parent_order_id?: string | null;
}): boolean {
  if (order.parent_order_id) return false;
  return Number(order.delivery_fee) === 0;
}
