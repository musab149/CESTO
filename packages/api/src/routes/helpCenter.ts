import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { success, error as errorResponse } from '../lib/response';

const router = Router();

/**
 * An article with nothing written under it is not shown to customers, in a list
 * or by its own link: production's help centre was 74 titles with no text, one
 * of them "Same-Day Delivery". Admin's routes still list them, so filling one in
 * is what publishes it.
 */
const hasBody = (a: { body_en?: string | null; body_es?: string | null }) => !!(a.body_es?.trim() || a.body_en?.trim());

/** The list's shape: titles, not bodies. */
const titlesOf = <T extends { body_en?: string | null; body_es?: string | null }>(articles: T[]) =>
  articles.filter(hasBody).map(({ body_en: _en, body_es: _es, ...a }) => a);

/* ─── GET /api/help-center ─────────────────────────────
   Returns active categories with their active articles
   for the landing page. Single roundtrip — the page
   renders a 3-column grid keyed by category. */

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await prisma.helpCategory.findMany({
      where: { is_active: true },
      orderBy: { sort_order: 'asc' },
      include: {
        articles: {
          where: { is_active: true },
          orderBy: { sort_order: 'asc' },
          select: { id: true, slug: true, title_en: true, title_es: true, body_en: true, body_es: true },
        },
      },
    });
    // A category with nothing to read goes too: it would be a heading over nothing.
    return success(res, categories
      .map((c) => ({ ...c, articles: titlesOf(c.articles) }))
      .filter((c) => c.articles.length > 0));
  } catch (err) { next(err); }
});

/* ─── GET /api/help-center/articles/:slug ───────────────
   Article detail view. Includes the parent category +
   the sibling articles in that category for the sidebar. */

router.get('/articles/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const article = await prisma.helpArticle.findUnique({
      where: { slug: req.params.slug },
      include: {
        category: {
          include: {
            articles: {
              where: { is_active: true },
              orderBy: { sort_order: 'asc' },
              select: { id: true, slug: true, title_en: true, title_es: true, body_en: true, body_es: true },
            },
          },
        },
      },
    });
    if (!article || !article.is_active || !hasBody(article)) {
      return errorResponse(res, 'Article not found.', 404);
    }
    return success(res, { ...article, category: { ...article.category, articles: titlesOf(article.category.articles) } });
  } catch (err) { next(err); }
});

export default router;
