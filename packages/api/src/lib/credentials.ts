import { randomBytes } from 'crypto';

/**
 * A one-shot password for an account someone else created.
 *
 * 12 characters from this alphabet is ~71 bits, which is plenty for a secret
 * that MUST be rotated at first login — every caller sets
 * `User.password_is_temp = true`, and the login response surfaces that as
 * `must_change_password`.
 *
 * The alphabet deliberately omits 0/O/1/l/I. These passwords get read down a
 * phone or copied off a screen in a shop, and an ambiguous character there
 * costs a support call.
 *
 * Extracted from routes/admin/leads.ts, which had the only copy. Two
 * generators would eventually disagree about that alphabet, and the whole
 * point of the exclusions is that they are consistent.
 */
/**
 * Where a credentials email or message tells a client to go. Here rather than
 * in lib/createClient so lib/clientCredentials can use it without the two
 * importing each other.
 */
export function storefrontLoginUrl(): string {
  return `${process.env.WEB_URL ?? 'http://localhost:5199'}/login`;
}

export function generateTempPassword(len = 12): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
