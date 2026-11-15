import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { validate } from '../../middleware/validate';
import {
  sendPartnerWelcomeEmail,
  sendBusinessWelcomeEmail,
  sendPartnerRequestInfoEmail,
  sendPartnerRejectedEmail,
  resolveEmailLang,
} from '../../lib/mailer';
import { patchLeadSchema, leadStatusEnum, leadTypeEnum } from '../../validators/leads';
import { generateTempPassword } from '../../lib/credentials';
import { slugifyStoreName as slugify, makeUniqueStoreSlug } from '../../lib/storeSlug';

const router = Router();

// ─── MV Slice 1 · partner approval helpers ────────────────

/** Base64url token + SHA-256 hash pair for magic-link resubmit. Only the
 *  hash is stored; the raw token lives only in the outbound email. */
function generateMagicLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

/** URL builders. WEB_URL / ADMIN_URL fall back to local dev defaults so
 *  local runs don't need env config — production sets both.
 *
 *  Partner login was moved to the customer web `/login` after the unified-
 *  identity rework — partners are just Users with a role. After login the
 *  customer web surfaces a "Manage store" pill that jumps to admin
 *  `/partner/dashboard` (via the /api/auth/handoff SSO). */
function buildPartnerLoginUrl(): string {
  const base = process.env.WEB_URL?.trim() || 'http://localhost:5173';
  return `${base.replace(/\/$/, '')}/login`;
}
function buildApplicationStatusUrl(rawToken: string): string {
  const base = process.env.WEB_URL?.trim() || 'http://localhost:5173';
  return `${base.replace(/\/$/, '')}/apply/status/${rawToken}`;
}

/**
 * GET /api/admin/leads
 * Paginated list with filters. Defaults: 50 per page, sorted newest first.
 *
 *   ?status=new|contacted|qualified|closed|archived
 *   ?type=supplier|partner|contact
 *   ?q=substring  (matches name, company, email)
 *   ?page=1
 *   ?limit=50
 */
router.get('/', asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
  const skip  = (page - 1) * limit;

  const where: Prisma.B2bLeadWhereInput = {};
  const status = req.query.status;
  if (typeof status === 'string' && leadStatusEnum.safeParse(status).success) {
    where.status = status;
  }
  const type = req.query.type;
  if (typeof type === 'string' && leadTypeEnum.safeParse(type).success) {
    where.type = type;
  }
  /**
   * Only leads still waiting on somebody.
   *
   * Done here rather than by fetching a page and filtering in the browser:
   * that silently truncates. Production has 118 business leads and the client
   * asked for 100, so 15 open ones were never sent — invisible, with no
   * pagination to reveal them, because the filtering happened after the cut.
   *
   * `approval_status` decides, not `status`: an approved lead sits at
   * `qualified` for ever. approved_user_id / approved_store_id are checked
   * too, because older partner approvals recorded a store and no user.
   */
  if (req.query.open === 'true') {
    where.approval_status = { notIn: ['approved', 'rejected'] };
    where.approved_user_id = null;
    where.approved_store_id = null;
    where.status = { in: ['new', 'contacted', 'qualified'] };
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q) {
    where.OR = [
      { name:    { contains: q, mode: 'insensitive' } },
      { company: { contains: q, mode: 'insensitive' } },
      { email:   { contains: q, mode: 'insensitive' } },
    ];
  }

  const [items, total, statusCounts] = await Promise.all([
    prisma.b2bLead.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
    prisma.b2bLead.count({ where }),
    // Per-status counts across the whole table (ignores active filter) so the
    // tab badges in the UI always reflect the global queue.
    prisma.b2bLead.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ]);

  const counts = statusCounts.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});

  const totalPages = Math.max(1, Math.ceil(total / limit));
  return success(res, { items, total, page, limit, totalPages, counts });
}));

/** GET /api/admin/leads/:id */
router.get('/:id', asyncHandler(async (req, res) => {
  const row = await prisma.b2bLead.findUnique({ where: { id: req.params.id } });
  if (!row) return error(res, 'Lead not found', 404);
  return success(res, row);
}));

/** PATCH /api/admin/leads/:id  — update status and/or notes. */
router.patch('/:id', validate(patchLeadSchema), asyncHandler(async (req, res) => {
  const exists = await prisma.b2bLead.findUnique({ where: { id: req.params.id } });
  if (!exists) return error(res, 'Lead not found', 404);
  const row = await prisma.b2bLead.update({
    where: { id: req.params.id },
    data: req.body as { status?: string; notes?: string | null },
  });
  return success(res, row);
}));

// ─── MV Slice 1 · partner approval endpoints ─────────────
// Server-side MV_PARTNER_APPROVAL gate REMOVED (2026-07-20). The Render
// env var kept failing to bake in on staging redeploys, blocking the
// approve flow the admin needed to test. `requireAdmin` (mounted on the
// whole /api/admin router in server.ts) still gates auth; the client
// flag mirror is also gone from LeadsPage.tsx. If we ever want partner
// approval dark again, restore requireMvFlag('partnerApproval') here.

const approveSchema = z.object({
  partner_user: z.object({
    name:  z.string().min(1).max(200),
    email: z.string().email().max(255),
  }),
  /** Choose ONE: link to existing store by id, OR create a new one with
   *  these fields. Not both. */
  store_id: z.string().uuid().optional(),
  store: z.object({
    name:           z.string().min(1).max(200),
    tagline_es:     z.string().max(200).optional(),
    tagline_en:     z.string().max(200).optional(),
    description_es: z.string().max(2000).optional(),
    description_en: z.string().max(2000).optional(),
    contact_email:  z.string().email().max(255).optional(),
    contact_phone:  z.string().max(50).optional(),
    origin:         z.string().max(100).optional(),
  }).optional(),
}).refine(
  (d) => (d.store_id && !d.store) || (!d.store_id && !!d.store),
  { message: 'Provide exactly one of store_id (link existing) or store (create new).' },
);

router.post(
  '/:id/approve',
  validate(approveSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof approveSchema>;
    const lead = await prisma.b2bLead.findUnique({ where: { id: req.params.id } });
    if (!lead) return error(res, 'Lead not found.', 404);
    if (lead.type !== 'partner_store') {
      return error(
        res,
        lead.type === 'business'
          ? 'This is a business (wholesale buyer) lead — use the business approval endpoint. It creates an account with B2B pricing, not a store.'
          : 'Only partner_store leads can be approved here.',
        422,
      );
    }
    // Cast through unknown until Prisma client is regenerated with Slice 0 fields.
    const leadMeta = lead as unknown as { approval_status: string };
    if (leadMeta.approval_status === 'approved') {
      return error(res, 'This lead has already been approved.', 409);
    }
    if (leadMeta.approval_status === 'rejected') {
      return error(res, 'This lead was rejected. Reject → approve is not supported; create a new application.', 409);
    }

    // Reserve the temp password before the tx so the same value goes into both
    // the DB (hashed) and the outbound email (plaintext).
    const tempPassword = generateTempPassword(12);
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const lang = resolveEmailLang(lead.language);

    let createdStoreId: string;
    let createdUserId: string;
    let storeName: string;
    let isNewUser: boolean;
    /** True when an existing admin-created store was adopted rather than a new
     *  one created. Changes the welcome email's wording and is recorded on the
     *  partner's profile, because the two cases are operationally different —
     *  a linked store may arrive with products and orders already on it. */
    let linkedExisting = false;

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Resolve store — reuse existing or create draft.
        if (payload.store_id) {
          // Re-check eligibility INSIDE the transaction rather than trusting
          // the picker. Two admins approving two applications onto the same
          // store would otherwise both pass a UI-level check and produce a
          // store with two owners; the role upsert below would not catch it
          // because the users differ.
          const existing = await tx.store.findUnique({
            where: { id: payload.store_id },
            select: {
              id: true, name: true, status: true, deleted_at: true,
              deletion_scheduled_at: true, created_via: true,
              _count: { select: { partner_roles: true } },
            },
          });
          if (!existing) throw new Error('E_STORE_NOT_FOUND');
          if (existing.deleted_at) throw new Error('E_STORE_DELETED');
          if (existing.deletion_scheduled_at) throw new Error('E_STORE_PENDING_DELETION');
          // A store created BY an approval already belongs to a partner.
          if (existing.created_via !== 'admin') throw new Error('E_STORE_NOT_LINKABLE');
          // Any role, not just active ones — a deactivated role still means
          // the store was somebody's.
          if (existing._count.partner_roles > 0) throw new Error('E_STORE_ALREADY_LINKED');
          createdStoreId = existing.id;
          storeName = existing.name;
          linkedExisting = true;
        } else {
          const storePayload = payload.store!;
          const slug = await makeUniqueStoreSlug(slugify(storePayload.name));
          const created = await tx.store.create({
            data: {
              slug,
              name:           storePayload.name,
              tagline_es:     storePayload.tagline_es,
              tagline_en:     storePayload.tagline_en,
              description_es: storePayload.description_es,
              description_en: storePayload.description_en,
              contact_email:  storePayload.contact_email,
              contact_phone:  storePayload.contact_phone,
              origin:         storePayload.origin,
              // This store exists because of this approval, so it is never
              // unclaimed inventory — keep it out of the link picker for
              // every future application.
              created_via: 'partner_approval',
              // MV Slice 5: approved stores start in DRAFT, not live.
              //
              // A store may not go live without at least one delivery zone
              // (lib/store-publish.ts), and the admin approving a lead is in
              // no position to invent the partner's delivery area for them.
              // Draft gives the partner the natural onboarding arc — log in,
              // add products, draw zones, publish — and means a
              // half-configured store is never briefly customer-visible.
              status: 'draft',
              is_active: true,
            },
            select: { id: true, name: true },
          });
          createdStoreId = created.id;
          storeName = created.name;
        }

        // 2. Upsert the customer User. Post-unified-identity, a partner is
        //    just a regular User with a PartnerStoreRole attached. If a User
        //    already exists at this email (they were a customer first), we
        //    overwrite the password with the temp value + flag password_is_temp
        //    so the forced first-change gate fires on next login. This is a
        //    deliberate admin action — the admin is granting them partner
        //    access + issuing a fresh temp password to reach them out-of-band.
        const emailLower = payload.partner_user.email.toLowerCase();
        const existingUser = await tx.user.findUnique({
          where: { email: emailLower },
          select: { id: true, name: true },
        });
        if (existingUser) {
          isNewUser = false;
          await tx.user.update({
            where: { id: existingUser.id },
            data: {
              // Only overwrite the name if the existing row's is empty — don't
              // clobber a real customer's chosen display name.
              ...(existingUser.name ? {} : { name: payload.partner_user.name }),
              password_hash:    passwordHash,
              password_is_temp: true,
            },
          });
          createdUserId = existingUser.id;
        } else {
          try {
            const created = await tx.user.create({
              data: {
                name:              payload.partner_user.name,
                email:             emailLower,
                password_hash:     passwordHash,
                password_is_temp:  true,
                preferred_language: lang === 'en' ? 'en' : 'es',
              },
              select: { id: true },
            });
            createdUserId = created.id;
            isNewUser = true;
          } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
              // Race — someone signed up with the same email between the
              // findUnique and the create above. Surface as EMAIL_TAKEN so
              // the admin can retry linking to the now-existing user.
              throw new Error('E_EMAIL_TAKEN');
            }
            throw e;
          }
        }

        // 3. Create the PartnerStoreRole. If a row already exists for
        //    (user, store) — e.g. re-approve after a rejection — we upsert
        //    to keep the flow idempotent (role=owner, is_active=true).
        await tx.partnerStoreRole.upsert({
          where: {
            user_id_store_id: { user_id: createdUserId, store_id: createdStoreId },
          },
          create: {
            user_id:   createdUserId,
            store_id:  createdStoreId,
            role:      'owner',
            is_active: true,
          },
          update: {
            role:      'owner',
            is_active: true,
          },
        });

        // 3b. Keep the application. Everything the applicant typed —
        //     company, trading location, registration number — used to be
        //     discarded at approval, leaving support with no record of who
        //     was onboarded and the partner unable to see their own
        //     submission.
        //
        //     Upsert rather than create: re-approving after a rejection, or
        //     approving a second application from the same person, must not
        //     collide on the unique user_id. The newer application wins,
        //     which is what an admin re-approving would expect.
        await tx.partnerProfile.upsert({
          where: { user_id: createdUserId },
          create: {
            user_id:         createdUserId,
            company:         lead.company || lead.name,
            business_type:   lead.business_type,
            location:        lead.location,
            website:         lead.website,
            registration_no: lead.registration_no,
            contact_phone:   lead.phone,
            source_lead_id:  lead.id,
            linked_store_id: createdStoreId,
            linked_existing: linkedExisting,
            approved_by_admin_id: req.admin?.adminId ?? null,
          },
          update: {
            company:         lead.company || lead.name,
            business_type:   lead.business_type,
            location:        lead.location,
            website:         lead.website,
            registration_no: lead.registration_no,
            contact_phone:   lead.phone,
            source_lead_id:  lead.id,
            linked_store_id: createdStoreId,
            linked_existing: linkedExisting,
            approved_at:     new Date(),
            approved_by_admin_id: req.admin?.adminId ?? null,
          },
        });

        // 4. Flip the lead. Legacy `approved_partner_user_id` (FK to the
        //    now-deprecated PartnerUser table) intentionally left NULL for
        //    new approvals — a follow-up migration renames it to
        //    approved_user_id. Existing rejected/pending leads keep any
        //    prior value untouched via the update mask.
        await tx.b2bLead.update({
          where: { id: lead.id },
          data: {
            approval_status:          'approved',
            approved_at:              new Date(),
            approved_store_id:        createdStoreId,
            approved_partner_user_id: null,
            approved_user_id:         createdUserId,
            // Clear any outstanding magic link — approval supersedes.
            magic_link_token_hash:    null,
            magic_link_expires_at:    null,
            // Best-effort: also nudge the legacy `status` field forward.
            status: 'qualified',
          } as unknown as Prisma.B2bLeadUpdateInput,
        });
      });
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === 'E_STORE_NOT_FOUND') return error(res, 'Selected store no longer exists.', 404);
        if (e.message === 'E_STORE_DELETED') return error(res, 'Selected store is tombstoned — restore it first.', 409);
        if (e.message === 'E_STORE_PENDING_DELETION') return error(res, 'Selected store is scheduled for deletion. Cancel the deletion before linking a partner to it.', 409);
        if (e.message === 'E_STORE_NOT_LINKABLE') return error(res, 'That store was created for another partner application, so it already belongs to a partner. Only stores Cesto created can be linked.', 409);
        if (e.message === 'E_STORE_ALREADY_LINKED') return error(res, 'That store already has a partner attached. Unlink the current partner first, or choose another store.', 409);
        if (e.message === 'E_EMAIL_TAKEN') {
          return error(res, `A user account with email "${payload.partner_user.email}" already exists but couldn't be linked to this store. Try again.`, 409);
        }
      }
      throw e;
    }

    // 4. Send welcome email OUTSIDE the transaction. If it fails, we log
    //    but do NOT roll back — the rows exist, the admin can trigger a
    //    manual resend (out of scope for Slice 1). Applicant gets contacted
    //    via their existing lead email in the worst case.
    //
    // In non-production also log the temp password to the API console so
    // local testers can copy it even when the outbound email bounces or
    // the Resend key is wrong. NEVER logged in prod — that would leak
    // credentials into hosting logs.
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `[leads:approve] partner credentials — email=${payload.partner_user.email.toLowerCase()} tempPassword=${tempPassword} loginUrl=${buildPartnerLoginUrl()}`,
      );
    }
    try {
      await sendPartnerWelcomeEmail({
        to:           payload.partner_user.email,
        name:         payload.partner_user.name,
        storeName:    storeName!,
        loginUrl:     buildPartnerLoginUrl(),
        loginEmail:   payload.partner_user.email.toLowerCase(),
        tempPassword,
        lang,
      });
    } catch (e) {
      console.error(`[leads:approve] welcome email failed for lead=${lead.id} — DB rows exist, retry send manually.`, e);
    }

    return success(res, {
      approved_store_id: createdStoreId!,
      approved_user_id:  createdUserId!,
      user_was_created:  isNewUser!,
      message: isNewUser!
        ? `Approved. New user created + welcome email sent to ${payload.partner_user.email}.`
        : `Approved. Existing user linked to store; welcome email sent to ${payload.partner_user.email}.`,
    });
  }),
);

// ─── B2B business approval ───────────────────────────────
// The wholesale-BUYER counterpart to /:id/approve. Deliberately a separate
// endpoint rather than a branch inside the partner one: they share only the
// user-creation step, and conflating them is exactly how the original
// inverted 'partner'/'supplier' mixup survived as long as it did.
//
// What this does NOT do, by design: no Store, no PartnerStoreRole, no
// partner dashboard access. A business customer is an ordinary User with
// is_business=true and a BusinessProfile hanging off it.

const approveBusinessSchema = z.object({
  user: z.object({
    name:  z.string().min(1).max(200),
    email: z.string().email().max(255),
  }),
  /** Trading details. Prefilled by the admin UI from the lead, but editable
   *  before approving so typos in the application can be corrected once
   *  rather than chased afterwards. */
  business: z.object({
    company:         z.string().min(1).max(200),
    business_type:   z.string().max(100).nullable().optional(),
    location:        z.string().max(200).nullable().optional(),
    website:         z.string().max(300).nullable().optional(),
    registration_no: z.string().max(100).nullable().optional(),
    contact_phone:   z.string().max(50).nullable().optional(),
  }),
});

router.post(
  '/:id/approve-business',
  validate(approveBusinessSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof approveBusinessSchema>;
    const lead = await prisma.b2bLead.findUnique({ where: { id: req.params.id } });
    if (!lead) return error(res, 'Lead not found.', 404);
    if (lead.type !== 'business') {
      return error(
        res,
        lead.type === 'partner_store'
          ? 'This is a partner store application — use the partner approval endpoint. It creates a Store and dashboard access.'
          : 'Only business leads can be approved here.',
        422,
      );
    }
    if (lead.approval_status === 'approved') {
      return error(res, 'This lead has already been approved.', 409);
    }
    if (lead.approval_status === 'rejected') {
      return error(res, 'This lead was rejected. Reject → approve is not supported; create a new application.', 409);
    }

    // Reserve the temp password before the tx so the same value reaches both
    // the DB (hashed) and the outbound email (plaintext).
    const tempPassword = generateTempPassword(12);
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const lang = resolveEmailLang(lead.language);
    const emailLower = payload.user.email.toLowerCase();
    const adminId = req.admin?.adminId ?? null;

    let createdUserId: string;
    let isNewUser: boolean;

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Upsert the User. Same posture as partner approval: if they were
        //    already a customer we grant business status and reset them to a
        //    temp password, because the admin needs a credential to send.
        const existingUser = await tx.user.findUnique({
          where: { email: emailLower },
          select: { id: true, name: true },
        });

        if (existingUser) {
          isNewUser = false;
          await tx.user.update({
            where: { id: existingUser.id },
            data: {
              // Don't clobber a real customer's chosen display name.
              ...(existingUser.name ? {} : { name: payload.user.name }),
              password_hash:    passwordHash,
              password_is_temp: true,
              is_business:      true,
              // Land them in b2b view so the approval is visible the moment
              // they log in. They can toggle back to retail whenever.
              pricing_mode:     'b2b',
            },
          });
          createdUserId = existingUser.id;
        } else {
          try {
            const created = await tx.user.create({
              data: {
                name:               payload.user.name,
                email:              emailLower,
                password_hash:      passwordHash,
                password_is_temp:   true,
                is_business:        true,
                pricing_mode:       'b2b',
                preferred_language: lang === 'en' ? 'en' : 'es',
              },
              select: { id: true },
            });
            createdUserId = created.id;
            isNewUser = true;
          } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
              // Race — signup landed between the findUnique and the create.
              throw new Error('E_EMAIL_TAKEN');
            }
            throw e;
          }
        }

        // 2. Upsert the BusinessProfile. Upsert rather than create so
        //    re-approving after a rejected/needs_info round refreshes the
        //    trading details instead of colliding on the unique user_id.
        await tx.businessProfile.upsert({
          where:  { user_id: createdUserId },
          create: {
            user_id:              createdUserId,
            company:              payload.business.company,
            business_type:        payload.business.business_type ?? null,
            location:             payload.business.location ?? null,
            website:              payload.business.website ?? null,
            registration_no:      payload.business.registration_no ?? null,
            contact_phone:        payload.business.contact_phone ?? null,
            source_lead_id:       lead.id,
            approved_by_admin_id: adminId,
          },
          update: {
            company:              payload.business.company,
            business_type:        payload.business.business_type ?? null,
            location:             payload.business.location ?? null,
            website:              payload.business.website ?? null,
            registration_no:      payload.business.registration_no ?? null,
            contact_phone:        payload.business.contact_phone ?? null,
            source_lead_id:       lead.id,
            approved_by_admin_id: adminId,
          },
        });

        // 3. Flip the lead. No approved_store_id — that's the whole point.
        await tx.b2bLead.update({
          where: { id: lead.id },
          data: {
            approval_status:       'approved',
            approved_at:           new Date(),
            approved_user_id:      createdUserId,
            magic_link_token_hash: null,
            magic_link_expires_at: null,
            status:                'qualified',
          },
        });
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'E_EMAIL_TAKEN') {
        return error(res, `A user account with email "${payload.user.email}" already exists but couldn't be linked. Try again.`, 409);
      }
      throw e;
    }

    // Email OUTSIDE the transaction — rows are committed, so a send failure
    // is recoverable by the admin rather than a reason to roll back.
    // Non-prod logs the credential so local testers aren't blocked by a
    // bouncing Resend key. NEVER in prod — that leaks into hosting logs.
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `[leads:approve-business] credentials — email=${emailLower} tempPassword=${tempPassword} loginUrl=${buildPartnerLoginUrl()}`,
      );
    }
    try {
      await sendBusinessWelcomeEmail({
        to:          payload.user.email,
        name:        payload.user.name,
        companyName: payload.business.company,
        loginUrl:    buildPartnerLoginUrl(),
        loginEmail:  emailLower,
        tempPassword,
        lang,
      });
    } catch (e) {
      console.error(`[leads:approve-business] welcome email failed for lead=${lead.id} — DB rows exist, resend manually.`, e);
    }

    return success(res, {
      approved_user_id: createdUserId!,
      user_was_created: isNewUser!,
      message: isNewUser!
        ? `Approved. Business account created + credentials emailed to ${emailLower}.`
        : `Approved. Existing customer upgraded to a business account; credentials emailed to ${emailLower}.`,
    });
  }),
);

const requestInfoSchema = z.object({
  message: z.string().min(10).max(2000),
});

router.post(
  '/:id/request-info',
  validate(requestInfoSchema),
  asyncHandler(async (req, res) => {
    const { message } = req.body as z.infer<typeof requestInfoSchema>;
    const lead = await prisma.b2bLead.findUnique({ where: { id: req.params.id } });
    if (!lead) return error(res, 'Lead not found.', 404);
    if (lead.type !== 'partner_store') return error(res, 'Only partner_store leads use this flow.', 422);
    const leadMeta = lead as unknown as { approval_status: string };
    if (leadMeta.approval_status === 'approved') return error(res, 'This lead has already been approved.', 409);
    if (leadMeta.approval_status === 'rejected') return error(res, 'This lead was rejected — cannot request more info.', 409);

    const { token, hash } = generateMagicLinkToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const lang = resolveEmailLang(lead.language);

    // Persist the hash + expiry first so a duplicate submit invalidates the
    // previous token immediately (single valid token per lead at any time).
    await prisma.b2bLead.update({
      where: { id: lead.id },
      data: {
        approval_status:       'needs_info',
        magic_link_token_hash: hash,
        magic_link_expires_at: expiresAt,
      } as unknown as Prisma.B2bLeadUpdateInput,
    });

    try {
      await sendPartnerRequestInfoEmail({
        to:        lead.email,
        name:      lead.name,
        message,
        statusUrl: buildApplicationStatusUrl(token),
        expiresAt,
        lang,
      });
    } catch (e) {
      // Email is critical here — without it the applicant never sees the
      // link. Roll back the DB update so the admin can retry.
      await prisma.b2bLead.update({
        where: { id: lead.id },
        data: {
          approval_status:       leadMeta.approval_status,
          magic_link_token_hash: null,
          magic_link_expires_at: null,
        } as unknown as Prisma.B2bLeadUpdateInput,
      });
      throw e;
    }

    return success(res, { message: `Request-info email sent to ${lead.email}. Link valid until ${expiresAt.toISOString()}.` });
  }),
);

const rejectSchema = z.object({
  reason: z.string().min(10).max(2000),
});

router.post(
  '/:id/reject',
  validate(rejectSchema),
  asyncHandler(async (req, res) => {
    const { reason } = req.body as z.infer<typeof rejectSchema>;
    const lead = await prisma.b2bLead.findUnique({ where: { id: req.params.id } });
    if (!lead) return error(res, 'Lead not found.', 404);
    if (lead.type !== 'partner_store') return error(res, 'Only partner_store leads use this flow.', 422);
    const leadMeta = lead as unknown as { approval_status: string };
    if (leadMeta.approval_status === 'approved') return error(res, 'This lead has already been approved — cannot reject.', 409);
    if (leadMeta.approval_status === 'rejected') return error(res, 'This lead is already rejected.', 409);

    await prisma.b2bLead.update({
      where: { id: lead.id },
      data: {
        approval_status: 'rejected',
        // Clear any outstanding magic link — rejection supersedes.
        magic_link_token_hash: null,
        magic_link_expires_at: null,
        // Best-effort: also close the legacy triage row.
        status: 'closed',
        notes: [lead.notes, `Rejected: ${reason}`].filter(Boolean).join('\n\n'),
      } as unknown as Prisma.B2bLeadUpdateInput,
    });

    // Rejection email is best-effort — the DB is the source of truth. If
    // send fails the admin can follow up manually via the lead's contact.
    try {
      await sendPartnerRejectedEmail({
        to:   lead.email,
        name: lead.name,
        reason,
        lang: resolveEmailLang(lead.language),
      });
    } catch (e) {
      console.error(`[leads:reject] rejection email failed for lead=${lead.id} — status is 'rejected' in DB, follow up manually.`, e);
    }

    return success(res, { message: `Rejection recorded. Email dispatched to ${lead.email}.` });
  }),
);

export default router;
