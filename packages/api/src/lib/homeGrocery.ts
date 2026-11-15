import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { createClient, ClientConflictError } from './createClient';
import { notifyHomeGroceryApproved, notifyHomeGroceryRejected } from './notifications';
import {
  sendHomeGroceryApprovedEmail,
  sendHomeGroceryRejectedEmail,
  resolveEmailLang,
  mailerDelivers,
} from './mailer';
import type { ApproveRashanLeadPayload } from '../validators/rashanLeads';

/**
 * HOME GROCERY — what a rashan request turns into.
 *
 * A household asks on /rashan (a RashanLead). An admin approves it, which
 * makes them a subscriber (a HomeGroceryProfile on their account, opening the
 * account if they had none), or rejects it with a reason they are told.
 * Subscribers then get orders an admin builds for them, which land in the
 * Home Grocery book by the rule that already defines it (lib/orderSource):
 * built by us, for a retail buyer. Nothing here touches orders.
 *
 * Kept out of the route file, like createClient, so the integration test can
 * drive exactly what the route drives.
 */

/** A request still waiting on somebody. */
export const OPEN_REQUEST: Prisma.RashanLeadWhereInput = {
  approval_status: 'pending_review',
  // closed / archived are ops saying "nothing to do here" — a duplicate, a
  // wrong number — without a decision the customer should hear about.
  status: { notIn: ['closed', 'archived'] },
};

/** The customer page that shows a requester where they stand. */
export function homeGroceryPageUrl(): string {
  return `${(process.env.WEB_URL ?? 'http://localhost:5199').replace(/\/$/, '')}/rashan`;
}

/** Thrown with the HTTP status the route should answer with. */
export class HomeGroceryError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'HomeGroceryError';
  }
}

const accountSelect = {
  id: true, name: true, email: true, status: true, is_business: true,
  preferred_language: true,
  _count: { select: { addresses: true } },
} satisfies Prisma.UserSelect;

export type RequestAccount = Prisma.UserGetPayload<{ select: typeof accountSelect }>;

/**
 * Which account a request belongs to, most specific first: the account that
 * was signed in when it was submitted; else an exact email match; else a
 * case-insensitive one, because accounts from before emails were lowercased
 * still exist and a household should not get a second account for a capital
 * letter.
 */
export async function resolveRequestAccount(
  userId: string | null,
  email: string | null,
  // The cast is only the global `omit` (lib/prisma) changing the client's
  // type: TransactionClient still lists cost_price, which this never reads.
  db: Prisma.TransactionClient = prisma as unknown as Prisma.TransactionClient,
): Promise<RequestAccount | null> {
  if (userId) {
    const byId = await db.user.findUnique({ where: { id: userId }, select: accountSelect });
    if (byId) return byId;
  }
  const e = email?.trim();
  if (!e) return null;
  return (await db.user.findUnique({ where: { email: e }, select: accountSelect }))
    ?? (await db.user.findFirst({
      where: { email: { equals: e, mode: 'insensitive' } },
      orderBy: { created_at: 'asc' },
      select: accountSelect,
    }));
}

/**
 * The account each request maps to, for a list. One query per distinct
 * account rather than per row — the open queue is small, but the history
 * page lists up to 200.
 */
export async function matchAccounts(
  leads: Array<{ id: string; user_id: string | null; email: string | null }>,
): Promise<Map<string, RequestAccount | null>> {
  const ids = [...new Set(leads.map((l) => l.user_id).filter((v): v is string => !!v))];
  const emails = [...new Set(leads.map((l) => l.email?.trim().toLowerCase()).filter((v): v is string => !!v))];
  const users = (ids.length || emails.length)
    ? await prisma.user.findMany({
      where: {
        OR: [
          ...(ids.length ? [{ id: { in: ids } }] : []),
          ...emails.map((e) => ({ email: { equals: e, mode: 'insensitive' as const } })),
        ],
      },
      select: { ...accountSelect, created_at: true },
      orderBy: { created_at: 'asc' },
    })
    : [];
  const out = new Map<string, RequestAccount | null>();
  for (const l of leads) {
    const e = l.email?.trim().toLowerCase();
    const hit = (l.user_id && users.find((u) => u.id === l.user_id))
      || (e && (users.find((u) => u.email === e) ?? users.find((u) => u.email?.toLowerCase() === e)))
      || null;
    out.set(l.id, hit);
  }
  return out;
}

export type ApproveResult = {
  user_id: string;
  /** `created`: a new account was opened and its credentials emailed.
   *  `linked`: they already had one; it was left exactly as it was. */
  account: 'created' | 'linked';
  /** Whether a real provider accepted the mail — a console log is not a send. */
  email_sent: boolean;
};

export async function approveRequest(
  leadId: string,
  payload: ApproveRashanLeadPayload,
  adminId: string | null,
): Promise<ApproveResult> {
  const lead = await prisma.rashanLead.findUnique({ where: { id: leadId } });
  if (!lead) throw new HomeGroceryError('Request not found.', 404);
  if (lead.approval_status === 'approved') {
    throw new HomeGroceryError('This request has already been approved.', 409);
  }
  if (lead.approval_status === 'rejected') {
    throw new HomeGroceryError('This request was rejected. The household can send a new one from the website.', 409);
  }

  const now = new Date();
  const profile = {
    household_size:   payload.profile.household_size,
    adults:           payload.profile.adults ?? null,
    children:         payload.profile.children ?? null,
    frequency:        payload.profile.frequency,
    preferred_slot:   payload.profile.preferred_slot ?? null,
    dietary_notes:    payload.profile.dietary_notes ?? null,
    budget_per_cycle: payload.profile.budget_per_cycle == null
      ? null
      : new Prisma.Decimal(payload.profile.budget_per_cycle),
    contact_phone:    payload.profile.contact_phone ?? null,
    source_lead_id:   lead.id,
    approved_at:      now,
    approved_by_admin_id: adminId,
  };

  /** The profile and the request flip commit together, in either path. */
  const record = async (tx: Prisma.TransactionClient, userId: string) => {
    // Upsert: approving a second request from someone who is already a
    // subscriber refreshes their details rather than failing on user_id.
    await tx.homeGroceryProfile.upsert({
      where: { user_id: userId },
      create: { user_id: userId, ...profile },
      update: profile,
    });
    await tx.rashanLead.update({
      where: { id: lead.id },
      data: {
        approval_status:      'approved',
        approved_at:          now,
        approved_user_id:     userId,
        approved_by_admin_id: adminId,
        // The ops funnel follows the decision, so the old status filters
        // still tell the truth.
        status:               'converted',
        converted_at:         lead.converted_at ?? now,
      },
    });
  };

  const existing = await resolveRequestAccount(lead.user_id, payload.user.email);

  if (existing) {
    if (existing.status === 'blocked') {
      throw new HomeGroceryError('That account is blocked. Unblock it before approving its request.', 409);
    }
    // Linking, not onboarding: their password, name and pricing stay as they
    // are. The address is added only when one was given — the dialog asks
    // for it only when the account has none, since an order needs one.
    await prisma.$transaction(async (tx) => {
      if (payload.address) {
        await tx.address.create({
          data: {
            user_id: existing.id,
            ...payload.address,
            street_line_2: payload.address.street_line_2 ?? null,
            delivery_notes: payload.address.delivery_notes ?? null,
            is_default: existing._count.addresses === 0,
          },
        });
      }
      await record(tx, existing.id);
    });

    void notifyHomeGroceryApproved({ userId: existing.id });

    let emailSent = false;
    const to = existing.email ?? lead.email;
    if (to) {
      try {
        await sendHomeGroceryApprovedEmail({
          to,
          name: existing.name,
          pageUrl: homeGroceryPageUrl(),
          lang: resolveEmailLang(existing.preferred_language ?? lead.language),
        });
        emailSent = mailerDelivers;
      } catch (e) {
        console.error(`[home-grocery:approve] email failed for lead=${lead.id} — approval is committed`, e);
      }
    }
    return { user_id: existing.id, account: 'linked', email_sent: emailSent };
  }

  if (!payload.address) {
    throw new HomeGroceryError('A delivery address is needed to open their account.', 422);
  }

  try {
    const created = await createClient(
      {
        name: payload.user.name,
        email: payload.user.email,
        phone: payload.user.phone || undefined,
        phone_country_code: '+34',
        preferred_language: payload.user.preferred_language,
        client_type: 'retail',
        address: payload.address,
        send_credentials: true,
      },
      { adminId },
      { requireNew: true, homeGrocery: true, inTransaction: record },
    );
    // In their inbox for when they first sign in with the emailed password.
    void notifyHomeGroceryApproved({ userId: created.userId });
    return { user_id: created.userId, account: 'created', email_sent: created.emailSent };
  } catch (e) {
    if (e instanceof ClientConflictError) throw new HomeGroceryError(e.message, 409);
    throw e;
  }
}

export type RejectResult = {
  /** True when they have an account, so the reason is in their inbox. */
  notified_in_app: boolean;
  email_sent: boolean;
};

export async function rejectRequest(
  leadId: string,
  reason: string,
  adminId: string | null,
): Promise<RejectResult> {
  const lead = await prisma.rashanLead.findUnique({ where: { id: leadId } });
  if (!lead) throw new HomeGroceryError('Request not found.', 404);
  if (lead.approval_status === 'approved') {
    throw new HomeGroceryError('This request has already been approved — it cannot be rejected now.', 409);
  }
  if (lead.approval_status === 'rejected') {
    throw new HomeGroceryError('This request is already rejected.', 409);
  }

  await prisma.rashanLead.update({
    where: { id: lead.id },
    data: {
      approval_status:      'rejected',
      rejected_at:          new Date(),
      rejection_reason:     reason,
      // Who decided, in the same column as an approval — there is one
      // decision per request, so one column for who made it.
      approved_by_admin_id: adminId,
      status:               'closed',
    },
  });

  const account = await resolveRequestAccount(lead.user_id, lead.email);
  if (account) void notifyHomeGroceryRejected({ userId: account.id, reason });

  let emailSent = false;
  const to = lead.email ?? account?.email ?? null;
  if (to) {
    try {
      await sendHomeGroceryRejectedEmail({
        to,
        name: lead.name,
        reason,
        pageUrl: homeGroceryPageUrl(),
        lang: resolveEmailLang(lead.language ?? account?.preferred_language),
      });
      emailSent = mailerDelivers;
    } catch (e) {
      console.error(`[home-grocery:reject] email failed for lead=${lead.id} — rejection is committed`, e);
    }
  }
  return { notified_in_app: !!account, email_sent: emailSent };
}

/**
 * A signed-in customer's own requests, found the same three ways approval
 * finds an account, in reverse: submitted while signed in, approved onto this
 * account, or sent from this account's email while signed out.
 */
function mineWhere(userId: string, email: string | null): Prisma.RashanLeadWhereInput {
  return {
    OR: [
      { user_id: userId },
      { approved_user_id: userId },
      ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []),
    ],
  };
}

const myRequestSelect = {
  id: true, approval_status: true, created_at: true,
  approved_at: true, rejected_at: true, rejection_reason: true,
} satisfies Prisma.RashanLeadSelect;

/**
 * Where a signed-in customer stands, for /rashan.
 *
 * The open request and the last DECISION are looked up separately rather
 * than taking the newest row. A request ops closed without deciding — a
 * duplicate, a wrong number — has no outcome to report, and as the newest
 * row it would have shown the customer "pending" for ever.
 */
export async function myHomeGrocery(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      home_grocery_profile: {
        select: { household_size: true, frequency: true, approved_at: true },
      },
    },
  });
  if (!user) return null;

  const mine = mineWhere(userId, user.email);
  const [openRequest, lastDecision] = await Promise.all([
    prisma.rashanLead.findFirst({
      where: { AND: [mine, OPEN_REQUEST] },
      orderBy: { created_at: 'desc' },
      select: myRequestSelect,
    }),
    prisma.rashanLead.findFirst({
      where: { AND: [mine, { approval_status: { in: ['approved', 'rejected'] } }] },
      orderBy: { updated_at: 'desc' },
      select: myRequestSelect,
    }),
  ]);

  return {
    subscriber: user.home_grocery_profile,
    open_request: openRequest,
    last_decision: lastDecision,
  };
}

/**
 * Why a SIGNED-IN customer may not send the form again, or null if they may.
 *
 * Signed-in only, and matched on their own account's email — never on the
 * email typed into the form. Anyone can type anyone's address, and refusing
 * (or worse, merging into) a request by a typed email would let a stranger
 * interfere with somebody else's application. Signed-out duplicates are
 * cheaper to close by hand than to defend against.
 */
export async function submitBlockedReason(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, home_grocery_profile: { select: { id: true } } },
  });
  if (!user) return null;
  if (user.home_grocery_profile) return "You're already a Home Grocery subscriber.";
  const open = await prisma.rashanLead.findFirst({
    where: { AND: [mineWhere(userId, user.email), OPEN_REQUEST] },
    select: { id: true },
  });
  return open ? "We already have your request — we'll be in touch soon." : null;
}
