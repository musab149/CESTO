import { Prisma } from '@prisma/client';

/**
 * Who put the order together: us, or the customer.
 *
 * There are TWO creator columns, because there are two kinds of "us".
 * `created_by_admin_id` is staff working in the admin panel;
 * `created_by_sales_rep_id` is a sales rep, who is a User and not an Admin
 * (see model SalesRep). At most one is ever set.
 *
 * Every book, tab and dashboard card that splits "ours" from "theirs" has to
 * ask about both, and the day one of them forgets is the day a rep's orders
 * quietly stop being counted. So the rule lives here once and the callers
 * import it.
 *
 * COMPOSE THESE WITH `AND`, never by spreading. `BUILT_BY_US` is an `OR`, and
 * the buyer-type filter next to it in the dashboard is also an `OR` — spread
 * into one object, the second silently overwrites the first and the figures
 * are wrong without anything failing.
 */

/**
 * Built for the customer by staff or by a rep — or made by their Home Grocery
 * plan (2026-10-21). A plan delivery has neither creator column set, yet it is
 * ours in every sense the books mean: we plan it, staff confirm and prepare
 * it, and it belongs in Orders → Home Grocery (or Cesto Wholesale, for a
 * business account), not among the orders customers placed at checkout.
 */
export const BUILT_BY_US: Prisma.OrderWhereInput = {
  OR: [
    { created_by_admin_id: { not: null } },
    { created_by_sales_rep_id: { not: null } },
    { rashan_subscription_id: { not: null } },
  ],
};

/**
 * A SALES REP built it, specifically.
 *
 * A subset of BUILT_BY_US rather than an alternative to it. The admin order
 * books split on who the order is FOR (retail or wholesale) and that is where
 * an order belongs; this answers a different question — who made it — and the
 * Cesto Salesman tab asks it ACROSS those books. So a rep's retail order is
 * in Home Grocery and in Cesto Salesman, and a rep's wholesale order is in
 * Cesto Wholesale and in Cesto Salesman. Deliberately overlapping: the books
 * stopped being a partition the day a rep's work needed a view of its own.
 */
export const BUILT_BY_REP: Prisma.OrderWhereInput = {
  created_by_sales_rep_id: { not: null },
};

/** The customer placed it themselves at checkout — no creator, and no plan made it. */
export const PLACED_BY_CUSTOMER: Prisma.OrderWhereInput = {
  created_by_admin_id: null,
  created_by_sales_rep_id: null,
  rashan_subscription_id: null,
};

/** The same two rules for the raw-SQL list, which cannot take a Prisma where. */
export const BUILT_BY_US_SQL = Prisma.sql`(o.created_by_admin_id IS NOT NULL OR o.created_by_sales_rep_id IS NOT NULL OR o.rashan_subscription_id IS NOT NULL)`;
export const PLACED_BY_CUSTOMER_SQL = Prisma.sql`(o.created_by_admin_id IS NULL AND o.created_by_sales_rep_id IS NULL AND o.rashan_subscription_id IS NULL)`;
export const BUILT_BY_REP_SQL = Prisma.sql`o.created_by_sales_rep_id IS NOT NULL`;

// ─── The same question, asked of an account ────────────────────────────────
//
// `users` carries the identical pair of columns, for the identical reason: an
// account can be opened by staff in the admin panel, by a rep at someone's
// door, or by the person themselves on the website. The customer tabs split on
// exactly that, so they need the same two rules — a rep-opened client was
// missing from the rashan tab AND counted as a self-signup, in both places
// because only the staff column was consulted.

/** Opened for the customer by staff or by a rep. */
export const OPENED_BY_US: Prisma.UserWhereInput = {
  OR: [
    { created_by_admin_id: { not: null } },
    { created_by_sales_rep_id: { not: null } },
  ],
};

/** They signed themselves up — neither creator column is set. */
export const SELF_REGISTERED: Prisma.UserWhereInput = {
  created_by_admin_id: null,
  created_by_sales_rep_id: null,
};
