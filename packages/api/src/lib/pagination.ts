import { randomInt } from 'crypto';
export interface PageParams {
  page: number;
  limit: number;
  skip: number;
}

export function parsePage(query: Record<string, unknown>, defaultLimit = 20, maxLimit = 100): PageParams {
  const page = Math.max(parseInt(String(query.page ?? '1'), 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(String(query.limit ?? defaultLimit), 10) || defaultLimit, 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
}

export function paged<T>(items: T[], total: number, params: PageParams) {
  return {
    items,
    total,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(total / params.limit),
  };
}

/**
 * Short, human-readable order number: e.g. "ORD-2604-K3M9X7QA".
 *
 * `order_number` is UNIQUE, so a collision is not a cosmetic problem — the
 * insert fails and the customer's checkout errors out.
 *
 * The random part was 4 base-36 characters (~1.7M values). By the birthday
 * bound that is a 25% chance of at least one collision per 1,000 orders, and
 * ~100% by 5,000. Worse, the DDMM prefix repeats every year, so a bucket keeps
 * accumulating candidates across years rather than resetting daily.
 *
 * 8 characters (~2.8e12 values) puts a day-bucket holding 100k orders at under
 * one in a million. Sourced from crypto rather than Math.random(), which is
 * neither uniform across implementations nor seeded independently per process
 * — two workers starting together could otherwise draw correlated sequences.
 */
export function generateOrderNumber(): string {
  return `ORD-${dayMonth()}-${randomCode()}`;
}

/** DDMM for the current date. */
export function dayMonth(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${dd}${mm}`;
}

/**
 * `length` uppercase base-36 characters from crypto.
 *
 * randomInt is rejection-sampled internally, so the distribution stays uniform
 * — taking `randomBytes % 36` would bias the first four letters, which over
 * millions of orders is exactly the sort of skew that makes collisions more
 * likely than the maths above predicts.
 */
export function randomCode(length = 8): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
