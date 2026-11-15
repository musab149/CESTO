import { z } from 'zod';
import { clientAddressSchema } from '../lib/createClient';

const trimmedString = (min: number, max: number) =>
  z.string().trim().min(min).max(max);

/**
 * Plain-weeks cadence as the customer form asks it. Wider than the
 * subscription-side `RashanFrequency` — see lib/rashanLeads.ts for the map.
 */
export const rashanLeadFrequencyEnum = z.enum([
  'weekly',
  'biweekly',
  'every_3_weeks',
  'monthly',
]);

export const rashanLeadStatusEnum = z.enum([
  'new',
  'contacted',
  'qualified',
  'converted',
  'closed',
  'archived',
]);

export const rashanLeadContactPrefEnum = z.enum(['whatsapp', 'call', 'sms', 'email']);

/**
 * Public submission. The required set is deliberately tiny — name, phone,
 * household size, frequency. Everything else is a bonus: this form exists to
 * catch people who would otherwise bounce, so every extra required field is a
 * lost lead. Ops can fill the gaps on the follow-up call.
 */
export const submitRashanLeadSchema = z.object({
  name:  trimmedString(1, 120),
  phone: trimmedString(4, 32),
  email: z.string().trim().email().max(160).nullable().optional(),

  household_size: z.number().int().min(1).max(30),
  adults:         z.number().int().min(0).max(30).nullable().optional(),
  children:       z.number().int().min(0).max(30).nullable().optional(),

  frequency:            rashanLeadFrequencyEnum,
  /** ISO date string. Rejected if it doesn't parse — a bad date is worse
   *  than no date, since ops schedule the callback around it. */
  preferred_start_date: z.string().datetime().nullable().optional(),
  interested_pack_slug: trimmedString(1, 80).nullable().optional(),
  budget_per_cycle:     z.number().min(0).max(100000).nullable().optional(),
  dietary_notes:        z.string().trim().max(2000).nullable().optional(),

  address_line:   trimmedString(1, 300).nullable().optional(),
  city:           trimmedString(1, 120).nullable().optional(),
  postcode:       trimmedString(1, 20).nullable().optional(),
  preferred_slot: trimmedString(1, 120).nullable().optional(),

  contact_pref: rashanLeadContactPrefEnum.optional(),
  source:       trimmedString(1, 32).optional(),
  language:     z.enum(['en', 'es']).nullable().optional(),
});

/** Admin patch — triage fields plus the conversion stamp. */
export const patchRashanLeadSchema = z.object({
  status: rashanLeadStatusEnum.optional(),
  notes:  z.string().trim().max(4000).nullable().optional(),
});

/**
 * Approve a Home Grocery request.
 *
 * Everything is prefilled by the admin dialog from the request and editable
 * before it is sent, so a typo in the form is corrected once rather than
 * chased afterwards — the same posture as approve-business.
 *
 * `email` is required here even though the public form tolerates its absence
 * from older clients: a new account's credentials have nowhere else to go,
 * and it is how an existing account is found. `address` is required only
 * when a NEW account is opened (an order cannot exist without one); the
 * route enforces that, because which case applies is only known server-side.
 */
export const approveRashanLeadSchema = z.object({
  user: z.object({
    name:  trimmedString(1, 120),
    email: z.string().trim().email().max(160).transform((v) => v.toLowerCase()),
    phone: z.string().trim().max(20).optional(),
    preferred_language: z.enum(['es', 'en']).default('es'),
  }),
  address: clientAddressSchema.optional(),
  profile: z.object({
    household_size:   z.number().int().min(1).max(30),
    adults:           z.number().int().min(0).max(30).nullable().optional(),
    children:         z.number().int().min(0).max(30).nullable().optional(),
    frequency:        rashanLeadFrequencyEnum,
    preferred_slot:   trimmedString(1, 120).nullable().optional(),
    dietary_notes:    z.string().trim().max(2000).nullable().optional(),
    budget_per_cycle: z.number().min(0).max(100000).nullable().optional(),
    contact_phone:    z.string().trim().max(32).nullable().optional(),
  }),
});

/**
 * Reject with a reason the CUSTOMER reads — in their notification, their
 * email and on /rashan. Ten characters minimum, as for partner rejections,
 * so "no" is not a reason.
 */
export const rejectRashanLeadSchema = z.object({
  reason: z.string().trim().min(10).max(2000),
});

export type SubmitRashanLeadPayload  = z.infer<typeof submitRashanLeadSchema>;
export type PatchRashanLeadPayload   = z.infer<typeof patchRashanLeadSchema>;
export type ApproveRashanLeadPayload = z.infer<typeof approveRashanLeadSchema>;
export type RejectRashanLeadPayload  = z.infer<typeof rejectRashanLeadSchema>;
