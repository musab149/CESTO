import { z } from 'zod';

const trimmedString = (min: number, max: number) =>
  z.string().trim().min(min).max(max);

export const ticketStatusEnum = z.enum(['new', 'in_progress', 'resolved', 'archived']);

/**
 * Public submission. Works for guests + logged-in users.
 * - name/email are required (logged-in users have them pre-filled).
 * - phone is optional (callback only).
 * - source tags where the form lives (contact_form, help_center, …).
 */
export const submitTicketSchema = z.object({
  name:     trimmedString(1, 120),
  email:    z.string().trim().email().max(160),
  phone:    trimmedString(4, 32).nullable().optional(),
  subject:  trimmedString(1, 200),
  body:     trimmedString(1, 4000),
  source:   trimmedString(1, 40).default('contact_form'),
  order_id: z.string().uuid().nullable().optional(),
  language: z.enum(['en', 'es']).nullable().optional(),
});

/** Admin patch — status + free-form notes. */
export const patchTicketSchema = z.object({
  status:      ticketStatusEnum.optional(),
  admin_notes: z.string().trim().max(4000).nullable().optional(),
});

export type SubmitTicketPayload = z.infer<typeof submitTicketSchema>;
export type PatchTicketPayload  = z.infer<typeof patchTicketSchema>;
