/**
 * How many distinct lines ONE order may carry, wherever it is built.
 *
 * The same question has four askers — the customer's cart, the admin and rep
 * create-order screens, and every edit that rewrites an order's lines — and
 * for a while they disagreed. The cart was raised to 1000 after a 400-line
 * basket could not be placed; creating an order through the admin or the rep
 * screen stayed at 300, and editing one stayed at 300 operations. A shop
 * restocking is the single most likely source of a genuinely large order, so
 * the rep was left with the tightest ceiling of anyone.
 *
 * None of these is a performance limit. Every path is a fixed number of
 * queries whatever the line count: setCart() writes a basket in three
 * statements, the checkout and createOrder() each decrement all their stock
 * in one, and editOrder() batches its writes. Measured at 400 lines, a
 * customer checkout is 37 statements in 151ms. The number is here to keep one
 * REQUEST bounded, which is a different and much weaker claim.
 *
 * WHAT BOUNDS IT: the API accepts a 256KB JSON body (`express.json` in
 * server.ts) and a cart line is about 115 bytes of JSON, so the body gives out
 * somewhere around 2,200. 1000 leaves room under that and is well past the
 * largest order anyone has brought us.
 *
 * MIRRORED as `MAX_ORDER_LINES` in packages/shared/src/cartLimits.ts, which
 * the web app checks before sending so a shopper gets a sentence instead of a
 * 422. This package imports nothing from that one — see lib/geocode.ts — so
 * `npm run test:order-limit` reads both files and fails if they drift.
 */
export const MAX_ORDER_LINES = 1000;

/**
 * How many UNITS one line may carry — the most of one product in one order.
 *
 * A wholesale buyer ordering 5,000 units across a few hundred lines is a real
 * order, and some of those lines are big: a shop takes a thousand of one
 * thing. The limits used to be scattered and small — 99 a line when a
 * customer edited an order, 999 when an admin or a rep created one, nothing
 * at all on the cart — so a big line could be placed one way and then not
 * edited, or not created by staff at all.
 *
 * STOCK is the real limit, and every path already checks it. This is only a
 * sanity ceiling against a typo (an extra zero) or an absurd request; none of
 * the work grows with it, because a quantity is one number on one row.
 *
 * MIRRORED in packages/shared/src/cartLimits.ts, like MAX_ORDER_LINES; `npm run test:order-limit` fails if
 * the two drift.
 */
export const MAX_LINE_QUANTITY = 10_000;
