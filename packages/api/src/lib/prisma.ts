import { Prisma, PrismaClient } from '@prisma/client';


// Serialize Decimal columns (price, totals, fees) as JSON numbers instead of
// strings. Frontends call .toFixed() / arithmetic directly on these fields and
// Prisma's default string output crashes them. EUR prices fit comfortably in
// IEEE-754 — no precision loss in practice.
(Prisma.Decimal.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this);
};

/**
 * Plain client, deliberately.
 *
 * A `$extends({ query: { product: … } })` hook that dropped the catalogue
 * count cache on every product write would be tidier than invalidating at each
 * call site — but `$extends` rewrites the client's type, and `lib/cartStore.ts`
 * pins an explicit `Prisma.TransactionClient`, which the extended type is no
 * longer assignable to. Nine type errors for one cache line is a bad trade, so
 * the write paths call `invalidateCountCache()` themselves.
 */
/**
 * `PRISMA_LOG_QUERIES=1` emits one event per statement.
 *
 * Off by default and absent from every deployed environment. It exists because
 * the question that matters for an order path is not how long it takes on
 * localhost — a round trip here is a tenth of a millisecond — but HOW MANY
 * STATEMENTS it issues, since on Neon each one is a network round trip against
 * an 8-second transaction budget. A path whose count grows with the size of
 * the order is the one that fails on a big order and passes every local test.
 */
/**
 * FIELDS NO QUERY RETURNS UNLESS IT ASKS FOR THEM BY NAME.
 *
 * `ProductVariant.cost_price` is what Cesto pays for a unit (2026-10-27). It
 * is for the admin only — never a shopper, a rep or a partner shop. Dozens of
 * routes read variants with `include: { variants: true }` or no `select`, and
 * every one of those would serve it. Omitting it here makes leaving it out
 * the default everywhere; the admin product routes ask for it back
 * (`select: { cost_price: true }` / `omit: { cost_price: false }`).
 *
 * `OrderItem.unit_cost` is the same figure on an order line, and the same
 * rule: rep, customer and partner order pages read lines with no select. The
 * admin order read asks for it, and the lines that are written copy it from
 * cost_price, which they ask for by name.
 *
 * `password_hash` (User, Admin, PartnerUser) leaves this process for nobody
 * (2026-11-06). GET /api/admin/users/:id returned the whole row, so a customer's
 * bcrypt hash went to the admin's browser, and any `include: { user: true }`
 * would do the same. Only the code that checks a password asks for it, by name:
 * sign-in, change password, and lib/clientCredentials' ACCESS_SELECT.
 *
 * THE COMPILER DOES NOT SEE THIS LIST. Prisma's types narrow a global omit only
 * when it names a single model (checked on 6.19), so with several the field
 * still type-checks and is `undefined` at runtime. A read that forgets to ask
 * compiles and then fails: `user.password_hash` is simply missing, and that
 * would be every sign-in refused. routes/passwordHashStaysIn.test.ts holds both
 * sides: sign-in works, and no response carries a hash.
 */
const prisma = new PrismaClient({
  omit: {
    productVariant: { cost_price: true },
    orderItem: { unit_cost: true },
    user: { password_hash: true },
    admin: { password_hash: true },
    partnerUser: { password_hash: true },
  },
  ...(process.env.PRISMA_LOG_QUERIES === '1' ? { log: [{ emit: 'event' as const, level: 'query' as const }] } : {}),
});

export default prisma;
