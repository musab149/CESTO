import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { success } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';

const router = Router();

// ─── Schemas ────────────────────────────────────────────

const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, hyphens');

const categorySchema = z.object({
  slug: slugSchema,
  title_en: z.string().min(1),
  title_es: z.string().min(1),
  icon: z.string().nullable().optional(),
  sort_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
});

const articleSchema = z.object({
  category_id: z.string().uuid(),
  slug: slugSchema,
  title_en: z.string().min(1),
  title_es: z.string().min(1),
  body_en: z.string().default(''),
  body_es: z.string().default(''),
  sort_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
});

// ─── Categories ─────────────────────────────────────────

router.get('/categories', asyncHandler(async (_req, res) => {
  const categories = await prisma.helpCategory.findMany({
    orderBy: { sort_order: 'asc' },
    include: { _count: { select: { articles: true } } },
  });
  return success(res, categories);
}));

router.post('/categories', validate(categorySchema), asyncHandler(async (req, res) => {
  const created = await prisma.helpCategory.create({ data: req.body });
  return success(res, created, 201);
}));

router.put('/categories/:id', validate(categorySchema), asyncHandler(async (req, res) => {
  const updated = await prisma.helpCategory.update({
    where: { id: req.params.id },
    data: req.body,
  });
  return success(res, updated);
}));

router.delete('/categories/:id', asyncHandler(async (req, res) => {
  await prisma.helpCategory.delete({ where: { id: req.params.id } });
  return success(res, { message: 'Category deleted.' });
}));

// ─── Articles ───────────────────────────────────────────

router.get('/articles', asyncHandler(async (req, res) => {
  const { categoryId } = req.query as { categoryId?: string };
  const articles = await prisma.helpArticle.findMany({
    where: categoryId ? { category_id: categoryId } : undefined,
    orderBy: [{ category_id: 'asc' }, { sort_order: 'asc' }],
    include: { category: { select: { id: true, slug: true, title_en: true, title_es: true } } },
  });
  return success(res, articles);
}));

router.get('/articles/:id', asyncHandler(async (req, res) => {
  const article = await prisma.helpArticle.findUnique({
    where: { id: req.params.id },
    include: { category: true },
  });
  if (!article) return success(res, null, 404);
  return success(res, article);
}));

router.post('/articles', validate(articleSchema), asyncHandler(async (req, res) => {
  const created = await prisma.helpArticle.create({ data: req.body });
  return success(res, created, 201);
}));

router.put('/articles/:id', validate(articleSchema), asyncHandler(async (req, res) => {
  const updated = await prisma.helpArticle.update({
    where: { id: req.params.id },
    data: req.body,
  });
  return success(res, updated);
}));

router.delete('/articles/:id', asyncHandler(async (req, res) => {
  await prisma.helpArticle.delete({ where: { id: req.params.id } });
  return success(res, { message: 'Article deleted.' });
}));

export default router;
