/**
 * How many distinct lines one ORDER may carry — a basket on its way to
 * becoming one, or one being built on the admin or rep screens.
 *
 * A monthly household shop, or a b2b buyer filling a pallet from the
 * storefront, genuinely reaches several hundred lines. The cap was 200, and
 * the web app pushes its WHOLE cart to the server before quoting — so a
 * 400-line basket was refused at the sync, before the checkout code ran, and
 * the customer was shown "Checkout failed" with nothing to act on.
 *
 * WHY 1000, and what it is bounded by. The API accepts a 256KB JSON body
 * (`express.json({ limit: '256kb' })` in server.ts). A cart line is about
 * 115 bytes of JSON — two uuids and a quantity — so the body limit is reached
 * somewhere around 2,200 lines. 1000 sits comfortably under that with room
 * for the limit to be lowered later without this becoming the thing that
 * breaks, and it is two and a half times the largest basket anyone has
 * actually brought us.
 *
 * Nothing downstream scales with it: setCart() writes any cart in three
 * statements, and the checkout decrements all the stock in one. The number is
 * a guard against an absurd payload, not a performance ceiling — which is why
 * it can be this generous.
 *
 * MIRRORED as MAX_ORDER_LINES in packages/api/src/lib/orderLimits.ts, which
 * the cart, create-order and edit paths all read, because the API imports
 * nothing from this package (its barrel re-exports a .tsx component and
 * ts-node-dev falls over on it — see lib/geocode.ts for the same note).
 * `npm run test:order-limit --workspace=packages/api` fails if the two drift.
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
 * MIRRORED in packages/api/src/lib/orderLimits.ts, like MAX_ORDER_LINES; `npm run test:order-limit` fails if
 * the two drift.
 */
export const MAX_LINE_QUANTITY = 10_000;
