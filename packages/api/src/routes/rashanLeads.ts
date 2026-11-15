import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { asyncHandler } from '../lib/async';
import { validate } from '../middleware/validate';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { submitRashanLeadSchema, type SubmitRashanLeadPayload } from '../validators/rashanLeads';
import { sendAdminAlert, resolveAdminNotifyEmail } from '../lib/mailer';
import { notifyAdminHomeGroceryRequest } from '../lib/notifications';
import { myHomeGrocery, submitBlockedReason } from '../lib/homeGrocery';

const router = Router();

const FREQUENCY_LABELS: Record<SubmitRashanLeadPayload['frequency'], string> = {
  weekly:        'Every week',
  biweekly:      'Every 2 weeks',
  every_3_weeks: 'Every 3 weeks',
  monthly:       'Every 4 weeks',
};

/**
 * POST /api/rashan-leads
 * Public — the Home Grocery request form on /rashan. An admin approves it
 * (the household becomes a subscriber) or rejects it with a reason; see
 * lib/homeGrocery.ts.
 *
 * optionalAuth rather than requireAuth: the whole point of this form is to
 * catch visitors who don't have (or don't want) an account yet. When a token
 * IS present we stamp user_id so ops can tie the lead to the customer record.
 * Returns just an ack + the id — the id lets the frontend reference the lead
 * if the household goes straight on to build a pack.
 */
router.post(
  '/',
  optionalAuth,
  validate(submitRashanLeadSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as SubmitRashanLeadPayload;

    // A subscriber, or someone already waiting on an answer, gets told so
    // instead of queueing a second request. The page shows them their status
    // rather than the form, so this is reached only by a stale tab.
    if (req.user?.userId) {
      const blocked = await submitBlockedReason(req.user.userId);
      if (blocked) return error(res, blocked, 409);
    }

    const lead = await prisma.rashanLead.create({
      data: {
        name:  data.name,
        phone: data.phone,
        email: data.email ?? null,
        language: data.language ?? null,

        household_size: data.household_size,
        adults:         data.adults ?? null,
        children:       data.children ?? null,

        frequency:            data.frequency,
        preferred_start_date: data.preferred_start_date ? new Date(data.preferred_start_date) : null,
        interested_pack_slug: data.interested_pack_slug ?? null,
        budget_per_cycle:
          data.budget_per_cycle == null ? null : new Prisma.Decimal(data.budget_per_cycle),
        dietary_notes:        data.dietary_notes ?? null,

        address_line:   data.address_line ?? null,
        city:           data.city ?? null,
        postcode:       data.postcode ?? null,
        preferred_slot: data.preferred_slot ?? null,

        contact_pref: data.contact_pref ?? 'whatsapp',
        source:       data.source ?? 'rashan_form',
        user_id:      req.user?.userId ?? null,
      },
    });

    // Bell row for whoever is in the admin panel; the email below is for
    // whoever is not. Both best-effort — the request is already saved.
    void notifyAdminHomeGroceryRequest({
      leadId: lead.id,
      name: lead.name,
      householdSize: lead.household_size,
    }).catch((err) => console.error('[notifications] home grocery request notify failed', err));

    // Best-effort admin ping. The lead is already persisted, so a mail
    // failure must not fail the request — same contract as /api/leads.
    const inbox = resolveAdminNotifyEmail();
    if (inbox) {
      const adminBase = process.env.ADMIN_URL?.trim() || 'http://localhost:5173';
      void sendAdminAlert({
        to: inbox,
        subject: `New Home Grocery request — ${lead.name} (household of ${lead.household_size})`,
        replyTo: lead.email ?? undefined,
        rows: [
          { label: 'Name',       value: lead.name },
          { label: 'Phone',      value: lead.phone },
          ...(lead.email          ? [{ label: 'Email',           value: lead.email }] : []),
          { label: 'Household',  value: String(lead.household_size) },
          ...(lead.adults != null || lead.children != null
            ? [{ label: 'Split', value: `${lead.adults ?? '?'} adults · ${lead.children ?? '?'} children` }]
            : []),
          { label: 'Frequency',  value: FREQUENCY_LABELS[lead.frequency] },
          { label: 'Contact via', value: lead.contact_pref },
          ...(lead.preferred_start_date
            ? [{ label: 'Start around', value: lead.preferred_start_date.toISOString().slice(0, 10) }]
            : []),
          ...(lead.postcode       ? [{ label: 'Postcode',        value: lead.postcode }] : []),
          ...(lead.city           ? [{ label: 'City',            value: lead.city }] : []),
          ...(lead.address_line   ? [{ label: 'Address',         value: lead.address_line }] : []),
          ...(lead.preferred_slot ? [{ label: 'Preferred slot',  value: lead.preferred_slot }] : []),
          ...(lead.budget_per_cycle
            ? [{ label: 'Budget / cycle', value: `€${lead.budget_per_cycle.toFixed(2)}` }]
            : []),
          ...(lead.interested_pack_slug ? [{ label: 'Looking at', value: lead.interested_pack_slug }] : []),
          ...(lead.dietary_notes  ? [{ label: 'Notes',           value: lead.dietary_notes }] : []),
        ],
        ctaLabel: 'Open in admin',
        ctaUrl: `${adminBase.replace(/\/$/, '')}/users?tab=rashan&request=${lead.id}`,
      }).catch((err) => console.error('[mail:admin-alert] rashan lead send failed', err));
    }

    return success(res, { ok: true, id: lead.id }, 201);
  }),
);

/**
 * GET /api/rashan-leads/mine
 * Where the signed-in customer stands: subscriber, waiting, or the last
 * decision (with the reason, if it was a no). Drives /rashan.
 */
router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const mine = await myHomeGrocery(req.user!.userId);
  if (!mine) return error(res, 'Account not found.', 404);
  return success(res, mine);
}));

export default router;
