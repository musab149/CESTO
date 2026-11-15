// ─── B2B pricing entitlement ───────────────────────────────
//
// Wholesale (`ProductVariant.b2b_price`) is visible to approved business
// customers only. Before this module existed b2b_price was selected into the
// PUBLIC product payload and served to every anonymous visitor — every
// partner's wholesale margin was readable from devtools on the home page.
//
// Two rules, both enforced server-side:
//   1. b2b_price is scrubbed from responses unless the viewer is a business.
//   2. Order totals are recomputed from the viewer's stored pricing_mode,
//      never from anything the client sends. See buildPricedItems callers.

import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from './prisma';
import {
  addVatCents, centsToEuros, effectiveVatCategory, eurosToCents, VAT_RATES, type VatCategory,
} from './tax';

// ─── IVA on top of the stored price ────────────────────────
//
// Since 2026-11-01 the prices typed in admin, retail and B2B alike, are BASE
// prices without IVA (user: "Once we select the iva then it will be added to
// the product price"). Everything a customer is shown or charged is that
// base plus its product's IVA. Two places do it and nothing else should:
// effectiveUnitPrice (every charge) and the catalogue walk below (every
// customer catalogue response). A product select feeding either must carry
// `vat_category` and `vat_category_reviewed`.

/** What decides a product's IVA: its band, and whether anybody chose it. */
export interface VatSource {
  vat_category: VatCategory;
  vat_category_reviewed: boolean;
}

/** The select fragment that makes a product a VatSource. */
export const VAT_FIELDS = { vat_category: true, vat_category_reviewed: true } as const;

/** The IVA rate a product's prices carry, in percent (0 until a band is chosen). */
export function vatRateOf(product: VatSource): number {
  return VAT_RATES[effectiveVatCategory(product)];
}

/**
 * A stored base price as a customer sees and pays it: plus IVA, to the cent.
 * One rounding, lib/tax's, which the screens' previews use too, so the price
 * shown is the price charged.
 */
export function withVat(base: Prisma.Decimal.Value, ratePct: number): Prisma.Decimal {
  const net = new Prisma.Decimal(base);
  if (ratePct === 0) return net;
  return new Prisma.Decimal(centsToEuros(addVatCents(eurosToCents(net.toFixed(2)), ratePct)));
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `b2bPricingGuard`. Read it instead of re-querying. */
      pricingContext?: PricingContext;
    }
  }
}

export interface PricingContext {
  /** Approved business customer (User.is_business). */
  isBusiness: boolean;
  /** Effective view. Forced to 'retail' for non-business users even if a
   *  stale 'b2b' is sitting on the row (e.g. business status was revoked). */
  mode: 'retail' | 'b2b';
  /**
   * The signed-in customer's agreed prices: variant id → euros off one unit
   * (lib/customerDiscounts). Only on a context resolved for a catalogue
   * request; absent or empty for nearly everyone.
   */
  unitDiscounts?: Map<string, Prisma.Decimal>;
}

export const RETAIL_CONTEXT: PricingContext = { isBusiness: false, mode: 'retail' };

/**
 * The customer's OWN view: the storefront price toggle they hold. For
 * anything the customer does themselves — browsing, their checkout, editing
 * their own order. A stale `b2b` on a non-business row reads as retail.
 */
export function pricingForViewer(
  account: { is_business: boolean; pricing_mode: 'retail' | 'b2b' } | null | undefined,
): PricingContext {
  if (!account?.is_business) return RETAIL_CONTEXT;
  return { isBusiness: true, mode: account.pricing_mode === 'b2b' ? 'b2b' : 'retail' };
}

/**
 * Pricing for an order somebody builds or changes ON A CUSTOMER'S BEHALF —
 * staff in the admin panel, a sales rep, a partner. Decided by the ACCOUNT:
 * a business is sold to at wholesale.
 *
 * Not `pricing_mode`, which is the storefront toggle and belongs to the
 * customer. Business accounts can no longer switch themselves to retail, and
 * /api/users/me repairs a leftover `retail` — but only when the customer
 * loads it, which a client whose orders are all placed by a rep never does.
 * Reading the toggle here priced those clients at retail on every order
 * built for them, with nothing on screen to say so.
 */
export function pricingForAccount(
  account: { is_business: boolean } | null | undefined,
): PricingContext {
  return account?.is_business ? { isBusiness: true, mode: 'b2b' } : RETAIL_CONTEXT;
}

/**
 * Resolve the viewer's pricing entitlement. Requires `optionalAuth` (or
 * `requireAuth`) to have run so req.user is populated.
 *
 * Anonymous requests short-circuit without touching the DB — the overwhelming
 * majority of catalogue traffic — so the extra read only lands on
 * authenticated requests, and it's a single indexed PK lookup.
 */
export async function resolvePricingContext(req: Request): Promise<PricingContext> {
  const userId = req.user?.userId;
  if (!userId) return RETAIL_CONTEXT;

  // One round trip for both: the price view and the agreed discounts.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      is_business: true, pricing_mode: true,
      product_discounts: { select: { variant_id: true, amount: true } },
    },
  });
  const ctx = pricingForViewer(user);
  if (!user?.product_discounts.length) return ctx;
  return { ...ctx, unitDiscounts: new Map(user.product_discounts.map((d) => [d.variant_id, d.amount])) };
}

/**
 * Price a customer catalogue response for its viewer: IVA on every size,
 * then the wholesale swap or `b2b_price` stripped, then any agreed discount.
 *
 * Deliberately a deep walk over the already-built payload rather than a
 * conditional Prisma `select`: the four customer-facing route files build
 * product shapes in a dozen places, and a scrub that runs at the boundary
 * cannot be defeated by someone adding a thirteenth. Cost is a single pass
 * over a page of products.
 *
 * Mutates in place and returns the same reference — payloads here are
 * freshly built from Prisma and not shared. A size reached twice (one object
 * placed in two lists) still gets its IVA once.
 */
export function scrubB2bPrice<T>(payload: T, ctx: PricingContext): T {
  walk(payload, 0, ctx, new WeakSet());
  return payload;
}

// Depth cap guards against a pathological cyclic structure; real payloads
// nest ~4 deep (page → items → variants → fields).
const MAX_DEPTH = 12;

/** A size's prices, with its product's IVA added. Each size once per payload. */
function addVatInPlace(variant: unknown, ratePct: number, priced: WeakSet<object>): void {
  if (variant === null || typeof variant !== 'object' || priced.has(variant)) return;
  priced.add(variant);
  if (ratePct === 0) return;
  const v = variant as Record<string, unknown>;
  for (const key of ['price', 'b2b_price', 'compare_at_price'] as const) {
    if (v[key] != null) v[key] = withVat(v[key] as Prisma.Decimal.Value, ratePct);
  }
}

function walk(node: unknown, depth: number, ctx: PricingContext, priced: WeakSet<object>): void {
  if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const entry of node) walk(entry, depth + 1, ctx, priced);
    return;
  }

  const obj = node as Record<string, unknown>;

  // IVA FIRST, on the product, before its sizes are visited: the wholesale
  // swap and an agreed discount below both work on what the customer pays,
  // which includes it. A product whose select left out `vat_category` is
  // served without IVA, which checkout would then contradict — so every
  // customer product select carries VAT_FIELDS.
  if (Array.isArray(obj.variants) && 'vat_category' in obj) {
    const rate = VAT_RATES[effectiveVatCategory(obj as Partial<VatSource>)];
    for (const v of obj.variants) addVatInPlace(v, rate, priced);
  }

  if ('b2b_price' in obj) {
    if (!ctx.isBusiness) {
      // Not entitled — wholesale margin never leaves the process.
      delete obj.b2b_price;
    } else if (ctx.mode === 'b2b') {
      // Entitled AND viewing wholesale: rewrite `price` in place so every
      // existing render site — grids, rails, product detail, cart, search —
      // shows the wholesale price without each one needing to know this
      // feature exists. Critically, it's the same effectiveUnitPrice rule
      // the order builder uses, so displayed price always equals charged
      // price. The retail price is not passed along beside it: a business
      // is never shown one (user, 2026-10-30: "in b2b we do not need to
      // show retail prices at all throughout the platform").
      const b2b = obj.b2b_price;
      if (b2b != null) {
        obj.price = b2b;
        // A retail RRP strikethrough next to a wholesale price is
        // meaningless (and often shows a fake discount), so drop it.
        if ('compare_at_price' in obj) obj.compare_at_price = null;
      }
    }
  }

  /**
   * A price agreed with this customer for this product size (2026-10-25):
   * euros off one unit, set by staff or a rep. Comes off whatever they would
   * otherwise pay — wholesale included, rewritten just above — and the price
   * it came off goes in `compare_at_price`, so every render site that already
   * strikes through a "was" price shows it without knowing this exists. Same
   * rule checkout applies, so the price shown is the price charged.
   *
   * Matched by variant id, which no other object in these payloads carries.
   */
  const off = ctx.unitDiscounts?.size && typeof obj.id === 'string' ? ctx.unitDiscounts.get(obj.id) : undefined;
  if (off && 'price' in obj && obj.price != null) {
    const base = new Prisma.Decimal(obj.price as Prisma.Decimal.Value);
    obj.compare_at_price = base;
    obj.price = off.gte(base) ? new Prisma.Decimal(0) : base.minus(off);
    obj.customer_discount = off;
  }

  for (const key of Object.keys(obj)) walk(obj[key], depth + 1, ctx, priced);
}

/**
 * Router-level guard: resolves the viewer's entitlement, stashes it on the
 * request, and — for anyone who isn't a business — wraps res.json so
 * b2b_price can never leave the process.
 *
 * Why a response wrapper instead of scrubbing at each `success(res, …)`
 * call: the four customer-facing product routers return product shapes from
 * roughly fifteen places, and the set grows. Scrubbing per call site means
 * the leak comes back the first time someone adds a sixteenth and forgets.
 * Enforcing at the boundary makes the safe behaviour the default.
 *
 * Mount AFTER `optionalAuth` so req.user is populated.
 */
export function b2bPricingGuard(req: Request, res: Response, next: NextFunction): void {
  resolvePricingContext(req)
    .then((ctx) => {
      req.pricingContext = ctx;
      // Every viewer gets IVA on every price. Retail viewers also get
      // b2b_price stripped; business viewers in b2b mode get `price`
      // rewritten to the wholesale value; anyone with agreed prices gets
      // them shown.
      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => originalJson(scrubB2bPrice(body, ctx));
      next();
    })
    .catch(next);
}

/**
 * The unit price a variant actually trades at for this viewer.
 *
 * Falls back to the retail price when the variant has no wholesale price set,
 * so a partially-priced catalogue stays fully purchasable rather than having
 * items silently drop out or land at zero.
 *
 * Returns Prisma.Decimal, not Number — money must not round-trip through
 * float on the way to an order row.
 *
 * This is the ONLY thing that decides what a customer is charged. It reads
 * the context resolved from the DB, never anything client-supplied.
 *
 * WITH IVA (2026-11-01): the stored prices are bases, so the product is
 * required — leaving it out would charge without IVA, and a required argument
 * is how every caller was found.
 */
export function effectiveUnitPrice(
  variant: { price: Prisma.Decimal; b2b_price?: Prisma.Decimal | null },
  ctx: PricingContext,
  product: VatSource,
): Prisma.Decimal {
  const base = ctx.isBusiness && ctx.mode === 'b2b' && variant.b2b_price != null
    ? variant.b2b_price
    : variant.price;
  return withVat(base, vatRateOf(product));
}

/**
 * The IVA a line is charged with, for its snapshot: the rate effectiveUnitPrice
 * applied. Written on every new order line, so a band changed on the product
 * later never re-splits this order.
 *
 * THE RATE ONLY, not `vat_category`. Most lines carry 0 %, and writing the
 * enum value `zero` before a deploy's migration has added it would fail the
 * insert — every checkout, for as long as the API runs ahead of its schema.
 * The rate column is an int that has existed since 2026-08, and the band is
 * read back from it where a screen wants one.
 */
export function lineVatSnapshot(product: VatSource): { tax_rate_pct: number } {
  return { tax_rate_pct: vatRateOf(product) };
}
