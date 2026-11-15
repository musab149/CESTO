import { z } from 'zod';

/**
 * Background can be any valid CSS background string (solid hex, named colour,
 * linear-gradient, etc.). We just require non-empty.
 */
const cssValue = z.string().min(1);

/**
 * image_url: pasted URL, server path, or `data:` blob from the file picker.
 * Null when no image is set.
 */
const imageValue = z
  .string()
  .min(1)
  .refine(
    (s) => /^(https?:\/\/|\/|data:|blob:)/.test(s),
    { message: 'Must be a URL, /-path, or data: URL.' },
  )
  .nullable();

const textTheme = z.enum(['light', 'dark']);

const promoTileSchema = z.object({
  id: z.string().min(1),
  variant: z.enum(['feature', 'wide', 'compact']),
  eyebrow_en: z.string(),
  eyebrow_es: z.string(),
  title_en: z.string(),
  title_es: z.string(),
  description_en: z.string().nullable(),
  description_es: z.string().nullable(),
  cta_en: z.string(),
  cta_es: z.string(),
  link: z.string(),
  background: cssValue,
  image_url: imageValue,
  emoji: z.string().max(8).nullable(),
  text_theme: textTheme,
  accent_color: z.string().nullable(),
  scrim_color: z.string().nullable().optional().default(null),
  is_active: z.boolean(),
  display_order: z.number().int(),
});

export const promoGridSchema = z.object({
  tiles: z.array(promoTileSchema).min(1).max(8),
  // Server overrides updated_at with `now()`, but accept whatever the client sends.
  updated_at: z.string().optional(),
});

const adsSectionSchema = z.object({
  eyebrow_en: z.string(),
  eyebrow_es: z.string(),
  title_en: z.string(),
  title_es: z.string(),
  description_en: z.string(),
  description_es: z.string(),
  cta_en: z.string(),
  cta_es: z.string(),
  link: z.string(),
  background: cssValue,
  image_url: imageValue,
  emoji: z.string().max(8).nullable(),
  text_theme: textTheme,
  accent_color: z.string().nullable().optional().default(null),
  scrim_color: z.string().nullable().optional().default(null),
});

export const adsBannerSchema = z.object({
  hero: adsSectionSchema,
  side: adsSectionSchema,
  updated_at: z.string().optional(),
});

const topBrandSchema = z.object({
  name: z.string().min(1).max(64),
  image_url: imageValue,
  link: z.string(),
  is_active: z.boolean(),
  display_order: z.number().int(),
  // Legacy visual fields — accepted for forward compatibility with old saved
  // payloads, but the customer site doesn't render them.
  bg_color: z.string().optional(),
  text_color: z.string().optional(),
  tagline: z.string().max(32).nullable().optional(),
  border: z.boolean().optional(),
});

export const topBrandsSchema = z.object({
  brands: z.array(topBrandSchema).min(0).max(24),
  updated_at: z.string().optional(),
});

const originCardSchema = z.object({
  key: z.string().min(1).max(48),
  label_en: z.string().min(1),
  label_es: z.string().min(1),
  bg_color: z.string().min(1),
  accent_color: z.string().min(1),
  image_url: imageValue,
  link: z.string(),
  is_active: z.boolean(),
  display_order: z.number().int(),
});

export const shopByOriginSchema = z.object({
  cards: z.array(originCardSchema).min(0).max(24),
  updated_at: z.string().optional(),
});

const topShopSchema = z.object({
  id: z.string().min(1).max(48),
  name: z.string().min(1).max(64),
  logo_url: imageValue,
  logo_bg: z.string().min(1),
  // Optional so old saved payloads (pre-cover) still validate.
  cover_url: imageValue.optional().default(null),
  rating: z.number().min(0).max(5),
  rating_count: z.number().int().min(0),
  product_count: z.number().int().min(0),
  fast_delivery: z.boolean(),
  link: z.string(),
  display_order: z.number().int(),
  is_active: z.boolean(),
});

export const topShopsSchema = z.object({
  shops: z.array(topShopSchema).min(0).max(24),
  updated_at: z.string().optional(),
});

export const storesHeroSchema = z.object({
  title_en: z.string().min(1).max(80),
  title_es: z.string().min(1).max(80),
  subtitle_en: z.string().max(240),
  subtitle_es: z.string().max(240),
  background: cssValue,
  image_url: imageValue.optional().default(null),
  text_theme: textTheme.optional().default('dark'),
  updated_at: z.string().optional(),
});

export type PromoGridPayload = z.infer<typeof promoGridSchema>;
export type AdsBannerPayload = z.infer<typeof adsBannerSchema>;
export type TopBrandsPayload = z.infer<typeof topBrandsSchema>;
export type ShopByOriginPayload = z.infer<typeof shopByOriginSchema>;
export type TopShopsPayload = z.infer<typeof topShopsSchema>;
export type StoresHeroPayload = z.infer<typeof storesHeroSchema>;
