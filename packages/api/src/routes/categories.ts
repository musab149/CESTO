import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { VAT_FIELDS } from '../lib/pricing';
import { customerStoreVisibleProductFilter } from '../lib/store-scope';
import { shownToViewer } from '../lib/audience';
import { stableProductOrder } from '../lib/stable-order';
import { success, error } from '../lib/response';
import { withShopCompat } from './products';

const router = Router();

// ─── GET /api/categories ────────────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Only what this customer's kind is shown: B2C, B2B or both (lib/audience).
    const shown = await shownToViewer(req);
    const categories = await prisma.category.findMany({
      where: { is_active: true, approval_status: 'approved' },
      select: {
        id: true, name_es: true, name_en: true, icon_url: true,
        bg_color: true, accent_color: true, sort_order: true,
        // Only count products the customer can actually see — active AND from
        // a customer-visible store. Otherwise the sidebar pill overcounts by
        // the number of products sitting in pending-deletion or tombstoned stores.
        _count: {
          select: {
            subcategories: true,
            products: { where: { is_active: true, ...customerStoreVisibleProductFilter, ...shown } },
          },
        },
      },
      orderBy: { sort_order: 'asc' },
    });

    return success(res, categories);
  } catch (err) { next(err); }
});

// ─── GET /api/categories/:id/subcategories ──────────────

router.get('/:id/subcategories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const subcategories = await prisma.subCategory.findMany({
      where: { category_id: req.params.id, is_active: true },
      select: { id: true, name_es: true, name_en: true, sort_order: true },
      orderBy: { sort_order: 'asc' },
    });

    return success(res, subcategories);
  } catch (err) { next(err); }
});

// ─── GET /api/categories/:id/products ───────────────────

router.get('/:id/products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Only what this customer's kind is shown: B2C, B2B or both (lib/audience).
    const shown = await shownToViewer(req);
    const { subcat, productType, sort, page, limit: lim } = req.query;
    const page_ = Math.max(parseInt(page as string) || 1, 1);
    const limit_ = Math.min(parseInt(lim as string) || 20, 50);
    const skip = (page_ - 1) * limit_;

    const where: any = { category_id: req.params.id, is_active: true, ...customerStoreVisibleProductFilter, ...shown };
    if (subcat) where.subcategory_id = subcat as string;
    // Only applied when subcat is also set — a stray productType without a
    // subcategory can't happen through the UI and would cross-filter unexpectedly.
    if (productType && subcat) where.product_type_id = productType as string;

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
        take: limit_,
      }),
      prisma.product.count({ where }),
    ]);

    return success(res, { products: products.map(withShopCompat), total, page: page_, totalPages: Math.ceil(total / limit_) });
  } catch (err) { next(err); }
});

export default router;
