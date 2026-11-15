import { Router, Request, Response, NextFunction } from 'express';
import { audienceOfUser, isShownTo } from '../lib/audience';
import { MAX_ORDER_LINES, MAX_LINE_QUANTITY } from '../lib/orderLimits';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { VAT_FIELDS, vatRateOf, withVat } from '../lib/pricing';
import { success, error } from '../lib/response';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  getCart, setCart, clearCart, addToCart, setCartItemQuantity, removeCartItem,
  type CartItem,
} from '../lib/cartStore';

const router = Router();
router.use(requireAuth);

// ─── GET /api/cart ──────────────────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await getCart(req.user!.userId);

    if (items.length === 0) return success(res, { items: [], total: 0 });

    const variantIds = items.map((i) => i.variantId);
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: {
        product: {
          select: {
            id: true, name_es: true, name_en: true,
            ...VAT_FIELDS,
            images: { where: { is_primary: true }, select: { url: true }, take: 1 },
          },
        },
      },
    });

    const enriched = items.map((item) => {
      const variant = variants.find((v) => v.id === item.variantId);
      return {
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        variant: variant ? {
          name_es: variant.name_es,
          name_en: variant.name_en,
          // With its IVA, as the catalogue shows it (lib/pricing).
          price: withVat(variant.price, vatRateOf(variant.product)),
          stock_quantity: variant.stock_quantity,
        } : null,
        product: variant?.product || null,
      };
    });

    return success(res, { items: enriched });
  } catch (err) { next(err); }
});

// ─── POST /api/cart/items ───────────────────────────────

const addItemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});

router.post('/items', validate(addItemSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productId, variantId, quantity } = req.body;
    const userId = req.user!.userId;

    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { audience: true } } },
    });
    if (!variant || variant.product_id !== productId) return error(res, 'Invalid product or variant.', 400);
    // Shown to B2C, B2B or both (lib/audience): what this account is not
    // shown, it cannot put in its cart either.
    if (!isShownTo(variant.product.audience, await audienceOfUser(userId))) {
      return error(res, 'This product is not available for your account.', 404);
    }
    if (variant.stock_quantity < quantity) return error(res, 'Insufficient stock.', 400);

    // Atomic increment rather than read-modify-write: two tabs adding the
    // same variant used to be able to lose one of the increments.
    await addToCart(userId, { productId, variantId, quantity });

    // Re-read so the stock clamp below sees the true post-increment total.
    let cart = await getCart(userId);
    const line = cart.find((i) => i.variantId === variantId);
    if (line && line.quantity > variant.stock_quantity) {
      await setCartItemQuantity(userId, variantId, variant.stock_quantity);
      cart = await getCart(userId);
    }

    return success(res, { items: cart }, 201);
  } catch (err) { next(err); }
});

// ─── PUT /api/cart/items/:itemId ────────────────────────

const updateQtySchema = z.object({ quantity: z.number().int().min(0).max(MAX_LINE_QUANTITY) });

router.put('/items/:itemId', validate(updateQtySchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { quantity } = req.body;
    const userId = req.user!.userId;
    const cart = await getCart(userId);
    const existing = cart.find((i) => i.variantId === req.params.itemId);

    if (!existing) return error(res, 'Item not in cart.', 404);

    if (quantity > 0) {
      const variant = await prisma.productVariant.findUnique({ where: { id: req.params.itemId } });
      if (variant && quantity > variant.stock_quantity) return error(res, 'Insufficient stock.', 400);
    }
    // quantity === 0 removes the line (handled inside the helper).
    await setCartItemQuantity(userId, req.params.itemId, quantity);

    return success(res, { items: await getCart(userId) });
  } catch (err) { next(err); }
});

// ─── DELETE /api/cart/items/:itemId ─────────────────────

router.delete('/items/:itemId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    await removeCartItem(userId, req.params.itemId);
    return success(res, { items: await getCart(userId) });
  } catch (err) { next(err); }
});

// ─── DELETE /api/cart ───────────────────────────────────

router.delete('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await clearCart(req.user!.userId);
    return success(res, { items: [] });
  } catch (err) { next(err); }
});

// ─── POST /api/cart/merge ───────────────────────────────

const mergeSchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    variantId: z.string().uuid(),
    quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  })),
});

router.post('/merge', validate(mergeSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const serverCart = await getCart(userId);
    const guestItems: CartItem[] = req.body.items;

    // Server cart takes precedence on conflicts — this endpoint exists for
    // the guest→account handoff, where the account's own saved cart should
    // survive. Use PUT /api/cart when the CLIENT is authoritative (i.e.
    // pushing the cart the user is actually looking at before checkout).
    const merged = [...serverCart];
    for (const item of guestItems) {
      if (!merged.some((i) => i.variantId === item.variantId)) merged.push(item);
    }
    await setCart(userId, merged);

    return success(res, { items: await getCart(userId) });
  } catch (err) { next(err); }
});

// ─── PUT /api/cart ──────────────────────────────────────
// Replace the server cart wholesale with the client's.
//
// The counterpart to /merge: use this when the CLIENT is authoritative — the
// browser cart is what the user is looking at, so before quoting or placing
// an order it must win. /merge deliberately resolves conflicts the other way
// for the guest→account handoff, and using it for pre-checkout sync meant a
// quantity the user had just changed got silently reverted to the older
// server value.

// How many lines one basket may carry — see lib/orderLimits.ts, which the
// create-order and edit paths read too, so every way of building an order
// agrees about its ceiling.

const replaceSchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    variantId: z.string().uuid(),
    quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  })).max(MAX_ORDER_LINES),
});

router.put('/', validate(replaceSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    await setCart(userId, req.body.items as CartItem[]);
    return success(res, { items: await getCart(userId) });
  } catch (err) { next(err); }
});

export default router;
