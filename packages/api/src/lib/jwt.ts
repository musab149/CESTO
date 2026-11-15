import jwt from 'jsonwebtoken';
import type { AdminRole } from '@prisma/client';
import crypto from 'crypto';

// Fail loudly at startup instead of silently accepting weak defaults.
// A forgotten JWT_SECRET in prod would let any attacker forge valid tokens
// for any user or admin. In non-production we fall back to a per-process
// random secret and warn — that keeps local dev unbroken but invalidates
// tokens on every restart, which is the correct dev behavior.
//
// Refresh tokens no longer use JWT — they're opaque strings tracked via
// user_refresh_tokens / admin_refresh_tokens (see lib/refreshTokens.ts).
// The JWT_REFRESH_SECRET / JWT_ADMIN_REFRESH_SECRET env vars are unused
// but kept in Render so a rollback to the old codepath still boots.

const IS_PROD = process.env.NODE_ENV === 'production';

function requireSecret(name: string): string {
  const value = process.env[name];
  if (value && value.trim().length >= 32) return value;

  if (IS_PROD) {
    throw new Error(
      `${name} must be set to a strong secret (>=32 chars) in production. Refusing to start.`,
    );
  }

  const generated = crypto.randomBytes(48).toString('hex');
  console.warn(
    `[jwt] WARNING: ${name} is missing or shorter than 32 chars. Generated a random per-process secret for dev. ` +
    `Tokens will be invalidated on every restart. Set ${name} in .env to persist sessions.`,
  );
  return generated;
}

const JWT_SECRET = requireSecret('JWT_SECRET');
const JWT_ADMIN_SECRET = requireSecret('JWT_ADMIN_SECRET');

// JWT_PARTNER_SECRET + generate/verifyPartnerAccessToken deleted in the
// Slice 2 unified-identity rework (2026-07-19) — a partner is now a
// customer User with a PartnerStoreRole, so /api/partner/* verifies the
// standard customer JWT via requireAccessToken → requirePartnerRole. The
// env var can be removed from Render; keeping it set is harmless.

export interface TokenPayload {
  userId: string;
  email?: string;
  phone?: string;
}

export interface AdminTokenPayload {
  adminId: string;
  email: string;
  role: AdminRole;
  /**
   * Signed in with a password somebody else chose (a new account, a reset, a
   * seeded row): nothing but changing it is allowed. Absent on a token from
   * before 2026-11-07, which therefore lasts out its hour as before.
   */
  mustChange?: boolean;
}

export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}

export function generateAdminAccessToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, JWT_ADMIN_SECRET, { expiresIn: '60m' });
}

export function verifyAdminAccessToken(token: string): AdminTokenPayload {
  return jwt.verify(token, JWT_ADMIN_SECRET) as AdminTokenPayload;
}
