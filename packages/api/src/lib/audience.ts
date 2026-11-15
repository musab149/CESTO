import type { ProductAudience, Prisma } from '@prisma/client';
import type { Request } from 'express';
import prisma from './prisma';

/**
 * Which kind of customer a product is shown to (2026-10-25, user request):
 * "whether we want to show this product for b2c only, b2b only or both of
 * them… by default it shows to both kinds of users with the respective
 * prices."
 *
 * A viewer is B2B when their account is a business (`is_business`) — the
 * same fact that prices them at wholesale (lib/pricing). Everyone else is
 * B2C: a signed-in shopper and a visitor alike, since both see retail prices.
 *
 * Enforced wherever the shop lists, shows, counts or sells a product to a
 * customer. Orders staff and reps build are not refused — their catalogue
 * panels follow the customer's kind (`shownTo` in lib/product-filters), but a
 * deliberate exception stays possible.
 */
export type ViewerAudience = 'b2c' | 'b2b';

export function audienceOf(viewer: { isBusiness: boolean } | { is_business: boolean } | null | undefined): ViewerAudience {
  if (!viewer) return 'b2c';
  return ('isBusiness' in viewer ? viewer.isBusiness : viewer.is_business) ? 'b2b' : 'b2c';
}

/** The audiences a viewer of this kind is shown: both, and their own. */
export function audiencesFor(kind: ViewerAudience): ProductAudience[] {
  return ['all', kind];
}

/** A product where-fragment: only what this kind of viewer is shown. A plain field, so it never collides with an `OR`. */
export function shownToWhere(kind: ViewerAudience): Prisma.ProductWhereInput {
  return { audience: { in: audiencesFor(kind) } };
}

export function isShownTo(audience: ProductAudience | null | undefined, kind: ViewerAudience): boolean {
  return !audience || audience === 'all' || audience === kind;
}

/**
 * The viewer's kind on a customer catalogue route. `b2bPricingGuard` has
 * already resolved their account (req.pricingContext); anywhere it has not,
 * the signed-in user is read once.
 */
export async function viewerAudience(req: Request): Promise<ViewerAudience> {
  if (req.pricingContext) return audienceOf(req.pricingContext);
  const userId = req.user?.userId;
  if (!userId) return 'b2c';
  return audienceOfUser(userId);
}

export async function audienceOfUser(userId: string): Promise<ViewerAudience> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { is_business: true } });
  return audienceOf(user);
}

/** `shownToWhere` for the viewer of this request. */
export async function shownToViewer(req: Request): Promise<Prisma.ProductWhereInput> {
  return shownToWhere(await viewerAudience(req));
}

/**
 * B2B only needs a B2B price on every size it sells (2026-10-25, user
 * request: "if a product does not have b2b price then the admin sets it to
 * show to b2b then it should ask them to set b2b price first"). Without one a
 * business pays the shop price — lib/pricing falls back to `price`. All
 * customers keeps that fallback: it is the default, and most products have
 * no B2B price.
 */
export const B2B_PRICE_REQUIRED = 'b2b_price_required';

/** A size (active variant) with no B2B price — a variant where-fragment. */
export const NO_B2B_PRICE: Prisma.ProductVariantWhereInput = {
  is_active: true,
  OR: [{ b2b_price: null }, { b2b_price: { lte: 0 } }],
};

export interface UnpricedSize { id: string | null; name_es: string; name_en: string; price: number }

/** A B2B-only product was asked to sell a size with no B2B price. */
export class B2bPriceRequired extends Error {
  constructor(readonly sizes: UnpricedSize[]) {
    super('Set a B2B price on every size before showing it to B2B only.');
  }
}

/** This product's sizes with no B2B price. */
export async function sizesWithoutB2bPrice(db: Prisma.TransactionClient, productId: string): Promise<UnpricedSize[]> {
  const rows = await db.productVariant.findMany({
    where: { product_id: productId, ...NO_B2B_PRICE },
    select: { id: true, name_es: true, name_en: true, price: true },
    orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
  });
  return rows.map((v) => ({ ...v, price: Number(v.price) }));
}

/** Refuses, inside the transaction, a B2B-only product with a size the business would pay the shop price for. */
export async function assertB2bPriced(db: Prisma.TransactionClient, productId: string): Promise<void> {
  const product = await db.product.findUnique({ where: { id: productId }, select: { audience: true } });
  if (product?.audience !== 'b2b') return;
  const sizes = await sizesWithoutB2bPrice(db, productId);
  if (sizes.length > 0) throw new B2bPriceRequired(sizes);
}

/** The 422 the admin panel reads to ask for the prices. */
export function b2bPriceRequiredBody(err: B2bPriceRequired) {
  return { code: B2B_PRICE_REQUIRED, sizes: err.sizes };
}
