import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { VAT_FIELDS } from '../lib/pricing';
import { success } from '../lib/response';
import { customerStoreVisibleProductFilter } from '../lib/store-scope';
import { shownToViewer } from '../lib/audience';
import { stableProductOrder } from '../lib/stable-order';
import { withShopCompat } from './products';

const router = Router();

// ─── GET /api/search/suggestions ────────────────────────

router.get('/suggestions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Only what this customer's kind is shown: B2C, B2B or both (lib/audience).
    const shown = await shownToViewer(req);
    const q = (req.query.q as string || '').trim();
    if (q.length < 2) return success(res, []);

    const products = await prisma.product.findMany({
      where: {
        is_active: true,
        AND: [
          {
            OR: [
              { name_es: { contains: q, mode: 'insensitive' } },
              { name_en: { contains: q, mode: 'insensitive' } },
              { brand: { contains: q, mode: 'insensitive' } },
            ],
          },
          customerStoreVisibleProductFilter,
          shown,
        ],
      },
      select: {
        id: true, name_es: true, name_en: true,
        // Its IVA, which b2bPricingGuard adds to the price below (lib/pricing).
        ...VAT_FIELDS,
        category: { select: { name_es: true, name_en: true } },
        variants: {
          where: { is_default: true, is_active: true },
          select: { price: true },
          take: 1,
        },
      },
      take: 8,
    });

    return success(res, products);
  } catch (err) { next(err); }
});

// ─── GET /api/search ────────────────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Only what this customer's kind is shown: B2C, B2B or both (lib/audience).
    const shown = await shownToViewer(req);
    const q = (req.query.q as string || '').trim();
    const sort = req.query.sort as string;
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const skip = (page - 1) * limit;

    const where: any = {
      is_active: true,
      AND: [
        {
          OR: [
            { name_es: { contains: q, mode: 'insensitive' } },
            { name_en: { contains: q, mode: 'insensitive' } },
            { brand: { contains: q, mode: 'insensitive' } },
            { description_es: { contains: q, mode: 'insensitive' } },
          ],
        },
        customerStoreVisibleProductFilter,
        shown,
      ],
    };

    let orderBy: any = { created_at: 'desc' };
    switch (sort) {
      case 'price_asc': orderBy = { variants: { _min: { price: 'asc' } } }; break;
      case 'price_desc': orderBy = { variants: { _min: { price: 'desc' } } }; break;
      case 'name_asc': orderBy = { name_es: 'asc' }; break;
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: {
          id: true, name_es: true, name_en: true, brand: true, brand_id: true, is_featured: true,
          is_quotation_enabled: true,
          // Its IVA, which b2bPricingGuard adds to every price below (lib/pricing).
          ...VAT_FIELDS,
          brand_ref: { select: { id: true, name: true, slug: true, logo_url: true, logo_bg: true, link: true } },
          store_id: true,
          store: {
            select: {
              id: true, slug: true, name: true,
              logo_url: true, logo_bg: true, is_verified: true,
            },
          },
          variants: {
            where: { is_active: true },
            select: {
              id: true, name_es: true, name_en: true, price: true,
              compare_at_price: true, b2b_price: true, stock_quantity: true, low_stock_threshold: true, is_default: true,
            },
            orderBy: { is_default: 'desc' },
          },
          images: {
            where: { is_primary: true },
            select: { url: true, alt_text: true },
            take: 1,
          },
        },
        orderBy: stableProductOrder(orderBy),
        skip,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    return success(res, { products: products.map(withShopCompat), total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

export default router;
