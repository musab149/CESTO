import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { success } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';

const router = Router();

// Accept absolute URL or server-relative path (matches our upload endpoint).
const imageUrlSchema = z
  .string()
  .min(1)
  .refine(
    (s) => /^(https?:\/\/|\/|data:|blob:)/.test(s),
    { message: 'Must be a URL or a server path starting with /' },
  );

const hexColor = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'Must be a hex color');

const bannerSchema = z.object({
  eyebrow_en: z.string().nullable().optional(),
  eyebrow_es: z.string().nullable().optional(),
  title_en: z.string().default(''),
  title_es: z.string().default(''),
  subtitle_en: z.string().nullable().optional(),
  subtitle_es: z.string().nullable().optional(),
  cta_en: z.string().nullable().optional(),
  cta_es: z.string().nullable().optional(),

  background: z.string().nullable().optional(),
  text_theme: z.enum(['light', 'dark']).default('dark'),
  accent_color: hexColor.nullable().optional(),
  scrim_color: hexColor.nullable().optional(),
  show_eyebrow: z.boolean().default(false),

  image_desktop: imageUrlSchema,
  image_mobile: imageUrlSchema,
  link_type: z.enum(['category', 'product', 'url']).nullable().optional(),
  link_target: z.string().nullable().optional(),
  target_zone: z.string().uuid().nullable().optional(),
  display_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
  active_from: z.string().datetime().nullable().optional(),
  active_until: z.string().datetime().nullable().optional(),
});

router.get('/', asyncHandler(async (_req, res) => {
  const banners = await prisma.banner.findMany({ orderBy: { display_order: 'asc' } });
  return success(res, banners);
}));

router.post('/', validate(bannerSchema), asyncHandler(async (req, res) => {
  const data = {
    ...req.body,
    active_from: req.body.active_from ? new Date(req.body.active_from) : null,
    active_until: req.body.active_until ? new Date(req.body.active_until) : null,
  };
  const created = await prisma.banner.create({ data });
  return success(res, created, 201);
}));

router.put('/:id', validate(bannerSchema), asyncHandler(async (req, res) => {
  const data = {
    ...req.body,
    active_from: req.body.active_from ? new Date(req.body.active_from) : null,
    active_until: req.body.active_until ? new Date(req.body.active_until) : null,
  };
  const updated = await prisma.banner.update({ where: { id: req.params.id }, data });
  return success(res, updated);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.banner.delete({ where: { id: req.params.id } });
  return success(res, { message: 'Banner deleted.' });
}));

export default router;
