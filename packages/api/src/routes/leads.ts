import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { asyncHandler } from '../lib/async';
import { validate } from '../middleware/validate';
import { submitLeadSchema } from '../validators/leads';
import {
  sendAdminAlert,
  resolveAdminNotifyEmail,
  sendPartnerInfoReceivedEmail,
  resolveEmailLang,
} from '../lib/mailer';
import { notifyAdminQuotationRequest } from '../lib/notifications';

const router = Router();

/**
 * POST /api/leads
 * Public — submits a new B2B lead from the customer /b2b-deals page.
 * Returns just an ack so we don't leak internal id shapes externally.
 */
router.post('/', validate(submitLeadSchema), asyncHandler(async (req, res) => {
  const data = req.body as Record<string, unknown>;
  const shops = Array.isArray(data.shops) && data.shops.length > 0
    ? (data.shops as unknown[] as Prisma.InputJsonValue)
    : Prisma.JsonNull;
  const lead = await prisma.b2bLead.create({
    data: {
      type:            data.type as string,
      source:          data.source as string,
      name:            data.name as string,
      company:         data.company as string,
      email:           data.email as string,
      phone:           data.phone as string,
      location:        (data.location as string | null) ?? null,
      business_type:   (data.business_type as string | null) ?? null,
      website:         (data.website as string | null) ?? null,
      registration_no: (data.registration_no as string | null) ?? null,
      shops,
      message:         (data.message as string | null) ?? null,
      intent:          (data.intent as string | null) ?? null,
      quote_product_id:   (data.quote_product_id as string | null) ?? null,
      quote_product_name: (data.quote_product_name as string | null) ?? null,
      quote_quantity:     (data.quote_quantity as number | null) ?? null,
      language:        (data.language as string | null) ?? null,
    },
  });

  // Admin bell/feed entry for quotation requests. Best-effort — the lead is
  // already persisted, so a failed notification doesn't fail the request.
  if (lead.type === 'quotation' && lead.quote_product_name && lead.quote_quantity) {
    void notifyAdminQuotationRequest({
      leadId: lead.id,
      customerName: lead.name,
      productName: lead.quote_product_name,
      quantity: lead.quote_quantity,
    }).catch((err) => console.error('[notifications] admin quotation-request notify failed', err));
  }

  // Best-effort admin ping — the lead is already persisted, so a failed
  // email doesn't fail the request.
  const inbox = resolveAdminNotifyEmail();
  if (inbox) {
    const adminBase = process.env.ADMIN_URL?.trim() || 'http://localhost:5173';
    const shopsCount = Array.isArray(data.shops) ? data.shops.length : 0;
    void sendAdminAlert({
      to: inbox,
      subject: `New B2B lead — ${lead.company || lead.name} (${lead.type})`,
      replyTo: lead.email,
      rows: [
        { label: 'Type',      value: lead.type },
        { label: 'Source',    value: lead.source },
        { label: 'Name',      value: lead.name },
        { label: 'Company',   value: lead.company },
        { label: 'Email',     value: lead.email },
        { label: 'Phone',     value: lead.phone },
        ...(lead.location        ? [{ label: 'Location',       value: lead.location }]        : []),
        ...(lead.business_type   ? [{ label: 'Business type',  value: lead.business_type }]   : []),
        ...(lead.website         ? [{ label: 'Website',        value: lead.website }]         : []),
        ...(lead.registration_no ? [{ label: 'Reg. no.',       value: lead.registration_no }] : []),
        ...(shopsCount > 0       ? [{ label: 'Shops',          value: String(shopsCount) }]   : []),
        ...(lead.intent          ? [{ label: 'Intent',         value: lead.intent }]          : []),
        ...(lead.quote_product_name ? [{ label: 'Product',     value: lead.quote_product_name }] : []),
        ...(lead.quote_quantity  ? [{ label: 'Quantity',       value: String(lead.quote_quantity) }] : []),
        ...(lead.message         ? [{ label: 'Message',        value: lead.message }]         : []),
      ],
      ctaLabel: 'Open in admin',
      ctaUrl: `${adminBase.replace(/\/$/, '')}/leads?id=${lead.id}`,
    }).catch((err) => console.error('[mail:admin-alert] lead send failed', err));
  }

  return success(res, { ok: true }, 201);
}));

// ─── MV Slice 1 · public magic-link resubmit ─────────────
// Unauthenticated — the token itself is the authentication. Rate-limiting
// happens at the platform edge (Render's per-IP throttle) and via the fact
// that only one valid token exists per lead at any time (issuing a new one
// invalidates the previous). NO flag gate on these two: even after the
// MV_PARTNER_APPROVAL flag is turned off (rollback), applicants clicking
// the link should be able to see status or resubmit — they didn't cause the
// rollback and deserve a working link. Server-side auth is the token itself.

/** Common lookup — resolves a raw token to a lead if the hash matches AND
 *  the token hasn't expired. Nulls out on any failure (avoids leaking WHICH
 *  step failed to a caller trying to enumerate tokens). */
async function findLeadByMagicToken(rawToken: string) {
  if (!rawToken || rawToken.length < 20 || rawToken.length > 256) return null;
  const hash = createHash('sha256').update(rawToken).digest('hex');
  const lead = await prisma.b2bLead.findFirst({
    where: { magic_link_token_hash: hash } as unknown as Prisma.B2bLeadWhereInput,
  });
  if (!lead) return null;
  const meta = lead as unknown as { magic_link_expires_at: Date | null };
  if (!meta.magic_link_expires_at || meta.magic_link_expires_at.getTime() < Date.now()) {
    return null;
  }
  return lead;
}

/**
 * GET /api/leads/status/:token
 * Returns the applicant-facing view of their lead: current approval_status,
 * expiry, and (redacted) contact info. Deliberately omits `notes` and other
 * admin-only fields.
 */
router.get('/status/:token', asyncHandler(async (req, res) => {
  const lead = await findLeadByMagicToken(req.params.token);
  if (!lead) return error(res, 'This link is invalid or has expired.', 404);
  const meta = lead as unknown as {
    approval_status: string;
    magic_link_expires_at: Date | null;
  };
  return success(res, {
    id:               lead.id,
    company:          lead.company,
    name:             lead.name,
    email:            lead.email,
    approval_status:  meta.approval_status,
    expires_at:       meta.magic_link_expires_at,
    // Echo back the applicant-provided fields so the resubmit form can
    // pre-populate — admins usually ask them to update ONE thing, not
    // re-enter everything.
    location:        lead.location,
    business_type:   lead.business_type,
    website:         lead.website,
    registration_no: lead.registration_no,
    shops:           lead.shops,
  });
}));

const resubmitSchema = z.object({
  location:        z.string().max(200).optional(),
  business_type:   z.string().max(100).optional(),
  website:         z.string().max(500).optional(),
  registration_no: z.string().max(100).optional(),
  /** Same JSON shape as the original submit — array of shops. Kept flexible;
   *  the admin flow doesn't validate individual entries here. */
  shops:           z.array(z.record(z.unknown())).max(20).optional(),
  /** Optional note back to the admin about what was updated. Appended to
   *  lead.notes for context in the triage view. */
  note:            z.string().max(2000).optional(),
});

/**
 * POST /api/leads/status/:token/resubmit
 * Updates the lead with additional information, resets approval_status to
 * pending_review, invalidates the magic link (single-use per issuance), and
 * fires an ack email to the applicant. Admin sees the updated lead in their
 * queue and can approve / re-request info.
 */
router.post('/status/:token/resubmit', validate(resubmitSchema), asyncHandler(async (req, res) => {
  const lead = await findLeadByMagicToken(req.params.token);
  if (!lead) return error(res, 'This link is invalid or has expired.', 404);
  const payload = req.body as z.infer<typeof resubmitSchema>;

  const { note, shops, ...scalarUpdates } = payload;
  // Merge: only overwrite fields the applicant actually filled in. Keeps
  // pre-existing values intact if they skipped one.
  const data: Prisma.B2bLeadUpdateInput = {};
  if (scalarUpdates.location        !== undefined) data.location        = scalarUpdates.location;
  if (scalarUpdates.business_type   !== undefined) data.business_type   = scalarUpdates.business_type;
  if (scalarUpdates.website         !== undefined) data.website         = scalarUpdates.website;
  if (scalarUpdates.registration_no !== undefined) data.registration_no = scalarUpdates.registration_no;
  if (shops !== undefined) {
    data.shops = (shops as unknown as Prisma.InputJsonValue);
  }
  if (note && note.trim()) {
    const stamp = new Date().toISOString().slice(0, 10);
    data.notes = [lead.notes, `[${stamp}] Applicant resubmitted: ${note.trim()}`]
      .filter(Boolean)
      .join('\n\n');
  }
  // Reset approval flow: back to pending, invalidate the magic link.
  Object.assign(data, {
    approval_status:       'pending_review',
    magic_link_token_hash: null,
    magic_link_expires_at: null,
  } as unknown as Prisma.B2bLeadUpdateInput);

  await prisma.b2bLead.update({ where: { id: lead.id }, data });

  // Best-effort ack — DB is the source of truth.
  try {
    await sendPartnerInfoReceivedEmail({
      to:   lead.email,
      name: lead.name,
      lang: resolveEmailLang(lead.language),
    });
  } catch (e) {
    console.error(`[leads:resubmit] ack email failed for lead=${lead.id}`, e);
  }

  return success(res, { ok: true, message: 'Thanks — we\'ve received your updated application.' });
}));

export default router;
