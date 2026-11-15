import { Prisma } from '@prisma/client';
import prisma from './prisma';

/**
 * Which clients a sales rep reaches, and which are THEIRS (2026-10-28).
 *
 * Until now the two were one list — the accounts a rep opened plus any they
 * had built an order for — and a rep could reach nobody else. The user then
 * asked: "the rep should be able to search any client or user by using their
 * email address... Only if they search via email... perform stuff for them...
 * Like create order for them... But this does not mean that that client will
 * become his client... then that client should show in the clients section
 * as the other users". So they are two things now:
 *
 *   THEIRS  the accounts they opened — users.created_by_sales_rep_id, and
 *           nothing else. Ordering for somebody never moves it; the office
 *           and the New client form (lib/createClient) are the only ways in.
 *   REACH   theirs, plus anyone they have built an order for, plus anyone
 *           they found by exact email (sales_rep_client_links). What they may
 *           open, price and order for.
 *
 * Nothing in production or staging was in a rep's list by an order alone
 * when this split (checked read-only, 2026-10-28), so no rep's own list
 * changed with it.
 *
 * THE CUSTOMER BASE STAYS SHUT. Finding someone takes their whole email,
 * matched exactly — a rep who knows it is talking to them — never a part of
 * one, a name or a phone, and it is rate-limited per rep. An id outside their
 * reach still answers 404 everywhere.
 */

/** Their own clients: the accounts they opened. Ownership is this alone. */
export function ownedBy(repId: string): Prisma.UserWhereInput {
  return { created_by_sales_rep_id: repId };
}

/** Everyone they may open and order for: theirs, anyone they have ordered for, anyone they found by email. */
export function reachOf(repId: string): Prisma.UserWhereInput {
  return {
    OR: [
      { created_by_sales_rep_id: repId },
      { orders: { some: { created_by_sales_rep_id: repId } } },
      { found_by_sales_reps: { some: { sales_rep_id: repId } } },
    ],
  };
}

/** In reach and not theirs: the list's "Otros clientes". */
export function othersOf(repId: string): Prisma.UserWhereInput {
  return {
    AND: [
      reachOf(repId),
      // Spelled out: a bare `not` would also drop accounts nobody opened,
      // since NULL <> x is not true in SQL.
      { OR: [{ created_by_sales_rep_id: null }, { created_by_sales_rep_id: { not: repId } }] },
    ],
  };
}

/** Whose an account is, in a word — never WHO. */
export type ClientOwner = 'rep' | 'office' | 'shop';

export function ownerOf(u: { created_by_sales_rep_id: string | null; created_by_admin_id: string | null }): ClientOwner {
  if (u.created_by_sales_rep_id) return 'rep';
  if (u.created_by_admin_id) return 'office';
  // Signed themselves up in the shop.
  return 'shop';
}

export const FIND_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  is_business: true,
  pricing_mode: true,
  status: true,
  created_by_sales_rep_id: true,
  created_by_admin_id: true,
  business_profile: { select: { company: true } },
  sales_rep_profile: { select: { is_active: true } },
  _count: { select: { addresses: true } },
} as const satisfies Prisma.UserSelect;

/**
 * The account on exactly this email, or null. Emails are written lowercase;
 * an older row may not be, so an exact lowercase match first and then the
 * same address in any case — never a part of one.
 */
export async function findClientByEmail(email: string) {
  const e = email.trim().toLowerCase();
  return (await prisma.user.findUnique({ where: { email: e }, select: FIND_SELECT }))
    ?? prisma.user.findFirst({
      where: { email: { equals: e, mode: 'insensitive' } },
      orderBy: { created_at: 'asc' },
      select: FIND_SELECT,
    });
}

/** Records (or refreshes) that this rep found this client, which puts them in reach. */
export async function linkFound(repId: string, userId: string) {
  const now = new Date();
  await prisma.salesRepClientLink.upsert({
    where: { sales_rep_id_user_id: { sales_rep_id: repId, user_id: userId } },
    create: { sales_rep_id: repId, user_id: userId, found_at: now, last_found_at: now },
    update: { last_found_at: now },
  });
}
