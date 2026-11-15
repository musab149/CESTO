import prisma from './prisma';
import type { Prisma } from '@prisma/client';

/**
 * Email addresses, as an account is found by one.
 *
 * `users.email` is a plain unique column, so `Omar@gmail.com` and
 * `omar@gmail.com` are two different accounts to Postgres and two different
 * people to Prisma. Nothing in the customer auth routes ever normalised one,
 * while `createClient.ts`, `salesReps.ts` and the b2b approval all lowercase
 * before writing. Half the codebase stored one thing and the other half
 * looked up another.
 *
 * On 2026-10-10 that reached a customer: b2b clients could not sign in with
 * the address in their welcome email. Three people on production had TWO
 * accounts each, differing only in capitals — they had signed up with a
 * capital first letter, which is what a phone keyboard offers, and the b2b
 * approval then created a second, lowercased account holding the temp
 * password that was emailed to them. Typing the address they were used to
 * reached the account whose password was not the one they had been sent.
 *
 * ONE RULE NOW: an address is lower case. It is normalised going in, it is
 * normalised going out, and nothing downstream has to think about capitals.
 *
 * It was briefly two rules. While those three pairs existed, a read had to
 * prefer an EXACT match, because lowercasing the input would have moved each
 * person onto whichever of their two accounts was lowercase and locked them
 * out of the one whose password they knew. The pairs were merged by hand on
 * 2026-10-10 — production, staging and local now hold zero case-duplicates —
 * so that reason is gone, and with it the subtlety.
 *
 * The insensitive lookup below is kept as a net, not as a rule: a row stored
 * with capitals before any of this (local still has one) must not become
 * unreachable. With no duplicates left it can only ever match one row.
 */

/** The form an address is STORED in. Trimmed, because a pasted one carries spaces. */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Case-insensitive, for asking whether an address is taken. */
export function sameEmail(email: string): Prisma.UserWhereInput {
  return { email: { equals: normaliseEmail(email), mode: 'insensitive' } };
}

/**
 * The account for an address, whatever was typed.
 *
 * Normalised first, so the common path is the indexed unique lookup on the
 * form every row is stored in. The insensitive query is the net described
 * above, for a row written before any of this existed. Returns the row without
 * its password hash (lib/prisma.ts); signing in asks for it below.
 */
export async function findUserByEmail(raw: string) {
  const email = normaliseEmail(raw);
  const exact = await prisma.user.findUnique({ where: { email } });
  if (exact) return exact;
  return prisma.user.findFirst({ where: sameEmail(email) });
}

/** The same lookup WITH the password hash: for checking a password, nothing else. */
export async function findUserByEmailToCheckPassword(raw: string) {
  const email = normaliseEmail(raw);
  const exact = await prisma.user.findUnique({ where: { email }, omit: { password_hash: false } });
  if (exact) return exact;
  return prisma.user.findFirst({ where: sameEmail(email), omit: { password_hash: false } });
}
