import { z } from 'zod';
import { RIBBON_ICONS } from '../lib/appContentDefaults';

/**
 * Validation for Admin → App content.
 *
 * Caps exist because this copy is rendered into fixed layouts: an onboarding
 * headline that runs to four lines does not fail validation, it just looks
 * broken on a phone, and nobody finds out until a customer sees it. The array
 * limits are the same idea — the ribbon draws three or four tiles, not twenty.
 */

const line = (max: number) => z.string().trim().min(1).max(max);
const para = (max: number) => z.string().trim().min(1).max(max);

const slideSchema = z.object({
  key: z.string().trim().min(1).max(40),
  eyebrow_es: line(40),
  eyebrow_en: line(40),
  // Two display lines separated by a newline, so a little longer than one line.
  title_es: line(80),
  title_en: line(80),
  body_es: para(220),
  body_en: para(220),
});

const aboutValueSchema = z.object({
  title_es: line(60),
  title_en: line(60),
  body_es: para(240),
  body_en: para(240),
});

const rashanStepSchema = z.object({
  title_es: line(60),
  title_en: line(60),
  body_es: para(240),
  body_en: para(240),
});

const rashanFaqSchema = z.object({
  q_es: line(120),
  q_en: line(120),
  a_es: para(600),
  a_en: para(600),
});

const ribbonItemSchema = z.object({
  icon: z.enum(RIBBON_ICONS),
  label_es: line(30),
  label_en: line(30),
  sub_es: line(40),
  sub_en: line(40),
});

export const appContentSchema = z.object({
  onboarding: z.object({
    slides: z.array(slideSchema).min(1).max(5),
  }),
  about: z.object({
    mission_es: para(600),
    mission_en: para(600),
    values: z.array(aboutValueSchema).max(8),
  }),
  rashan: z.object({
    hero_title_es: line(80),
    hero_title_en: line(80),
    hero_body_es: para(300),
    hero_body_en: para(300),
    steps: z.array(rashanStepSchema).max(6),
    faq: z.array(rashanFaqSchema).max(12),
  }),
  ribbon: z.object({
    items: z.array(ribbonItemSchema).max(4),
  }),
});

export type AppContentInput = z.infer<typeof appContentSchema>;
