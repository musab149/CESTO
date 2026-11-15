import { Router } from 'express';
import prisma from '../lib/prisma';
import { success } from '../lib/response';
import { asyncHandler } from '../lib/async';
import { validate } from '../middleware/validate';
import { submitTicketSchema } from '../validators/support';
import {
  sendSupportTicketNotification,
  sendSupportTicketReceipt,
  resolveEmailLang,
  resolveAdminNotifyEmail,
} from '../lib/mailer';

const router = Router();

/**
 * POST /api/support
 * Public — submits a new customer support ticket from /contact or the
 * Help Center "Talk to a human" CTAs. No auth required (guest-friendly).
 *
 * Behaviour:
 *   1. Persists the row immediately.
 *   2. Best-effort email ping to SUPPORT_INBOX_EMAIL (defaults to RESEND_FROM
 *      so we always have at least one inbox during local dev). Failure does
 *      NOT fail the request — the ticket lives in the DB and the admin can
 *      triage from /support anyway.
 *   3. Returns { ok: true } only, so we don't leak the internal uuid.
 */
router.post('/', validate(submitTicketSchema), asyncHandler(async (req, res) => {
  const data = req.body as Record<string, unknown>;

  const ticket = await prisma.supportTicket.create({
    data: {
      // user_id is intentionally not read from the body — we'll wire that
      // in once the customer site sends an auth header on this route. Today
      // every submission is anonymous-from-the-API's-perspective.
      user_id:  null,
      name:     data.name as string,
      email:    data.email as string,
      phone:    (data.phone as string | null) ?? null,
      subject:  data.subject as string,
      body:     data.body as string,
      source:   (data.source as string) ?? 'contact_form',
      order_id: (data.order_id as string | null) ?? null,
      language: (data.language as string | null) ?? null,
    },
  });

  // Notify the ops inbox. Prefer ADMIN_NOTIFY_EMAIL (the unified admin
  // inbox), fall back to SUPPORT_INBOX_EMAIL then RESEND_FROM so dev still
  // gets a console log. Inner implementation swallows non-fatal errors.
  const inbox = resolveAdminNotifyEmail() ?? 'support.cesto@gmail.com';
  const adminBase = process.env.ADMIN_URL?.trim() || 'http://localhost:5173';

  await sendSupportTicketNotification({
    to: inbox,
    ticketId: ticket.id,
    name: ticket.name,
    email: ticket.email,
    phone: ticket.phone,
    subject: ticket.subject,
    body: ticket.body,
    source: ticket.source,
    language: ticket.language,
    adminUrl: `${adminBase.replace(/\/$/, '')}/support?ticket=${ticket.id}`,
  });

  // Auto-reply to the customer confirming we got their message. Best-effort —
  // failure just gets logged; the ticket is already persisted.
  void sendSupportTicketReceipt({
    to: ticket.email,
    name: ticket.name,
    lang: resolveEmailLang(ticket.language),
    ticketId: ticket.id,
    subject: ticket.subject,
  }).catch((err) => console.error('[mail:support-receipt] send failed', err));

  return success(res, { ok: true }, 201);
}));

export default router;
