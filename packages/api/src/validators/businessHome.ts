import { z } from 'zod';
import { ANNOUNCEMENT_TAGS, BUSINESS_HOME_TONES, LOGISTICS_ICONS } from '../lib/businessHomeDefaults';

/**
 * Validation for Admin → Business home.
 *
 * The caps are for the layouts this copy is drawn into (see validators/
 * appContent): a promotion title that runs to four lines does not fail, it
 * just breaks its card on a phone. Both languages are required wherever one
 * is, since a missing translation shows as an empty line to whoever reads the
 * other one.
 */

const line = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) => z.string().trim().max(max);

/** Where a tap goes: a path inside the site, or a web address. Empty for nowhere. */
const link = z.string().trim().max(500).refine(
  (s) => s === '' || s.startsWith('/') || /^https?:\/\//.test(s),
  { message: 'must start with / (a page of the site) or https://' },
);

/** An uploaded image's URL or path. Never a data: blob — the row would balloon. */
const image = z.string().trim().max(1000).refine(
  (s) => s.startsWith('/') || /^https?:\/\//.test(s),
  { message: 'must be an uploaded image or an https:// address' },
).nullable();

/** The same, but there must be one — said plainly when it is missing. */
const imageRequired = z.string().trim().max(1000).nullable().refine(
  (s) => !!s && (s.startsWith('/') || /^https?:\/\//.test(s)),
  { message: 'add the banner image (upload it, or paste an https:// address)' },
);

const tone = z.enum(BUSINESS_HOME_TONES);

const introSchema = z.object({
  title_es: line(80),
  title_en: line(80),
  body_es: optional(300),
  body_en: optional(300),
  cta_es: optional(30),
  cta_en: optional(30),
  link,
  image_url: image,
});

const promotionSchema = z.object({
  id: line(40),
  title_es: line(60),
  title_en: line(60),
  body_es: optional(160),
  body_en: optional(160),
  badge_es: optional(16),
  badge_en: optional(16),
  image_url: image,
  tone,
  link,
  is_active: z.boolean(),
});

const pointSchema = z.object({
  id: line(40),
  icon: z.enum(LOGISTICS_ICONS),
  title_es: line(50),
  title_en: line(50),
  body_es: line(200),
  body_en: line(200),
});

const logisticsSchema = z.object({
  is_active: z.boolean(),
  title_es: line(60),
  title_en: line(60),
  body_es: optional(240),
  body_en: optional(240),
  points: z.array(pointSchema).max(6),
});

// A banner ad is only its image (user, 2026-10-31: "we will only have the
// images… that will be uploaded by the admin"), and where a tap goes.
const bannerSchema = z.object({
  id: line(40),
  is_active: z.boolean(),
  link,
  image_url: imageRequired,
  image_mobile_url: image,
});

const announcementSchema = z.object({
  id: line(40),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use a date (YYYY-MM-DD)').nullable(),
  tag: z.enum(ANNOUNCEMENT_TAGS),
  title_es: line(80),
  title_en: line(80),
  body_es: optional(300),
  body_en: optional(300),
  is_active: z.boolean(),
});

export const businessHomeSchema = z.object({
  intro: introSchema,
  promotions: z.array(promotionSchema).max(8),
  logistics: logisticsSchema,
  banners: z.array(bannerSchema).max(6),
  announcements: z.array(announcementSchema).max(20),
});

export type BusinessHomeInput = z.infer<typeof businessHomeSchema>;
