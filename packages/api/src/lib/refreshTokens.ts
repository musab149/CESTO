import crypto from 'crypto';
import prisma from './prisma';

// Refresh tokens are opaque random strings, SHA-256 hashed at rest.
// Rotation: every /refresh-token call revokes the presented token and
// issues a new one. If the client ever presents a token that's already
// been revoked, that's a theft signal — we revoke ALL of that subject's
// live tokens and force re-authentication.
//
// TTLs mirror the old JWT expiry values for continuity: user 30d, admin 7d.

const TOKEN_BYTES = 48;                         // 96 hex chars, ~384 bits entropy
const USER_TTL_MS    = 30 * 24 * 60 * 60 * 1000;  // 30 days
const ADMIN_TTL_MS   =  7 * 24 * 60 * 60 * 1000;  // 7 days
const PARTNER_TTL_MS =  7 * 24 * 60 * 60 * 1000;  // 7 days (mirrors admin)

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generatePlainToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

type Denied = { status: number; message: string };
const invalid = (): Denied => ({ status: 401, message: 'Invalid or expired refresh token.' });
const revoked = (): Denied => ({ status: 401, message: 'Session revoked. Please sign in again.' });

// ─── User ───────────────────────────────────────────────

export async function issueUserRefreshToken(userId: string): Promise<string> {
  const token = generatePlainToken();
  await prisma.userRefreshToken.create({
    data: {
      user_id: userId,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + USER_TTL_MS),
    },
  });
  return token;
}

/**
 * Validate the presented refresh token and rotate it. Returns the userId on
 * success, throws a `{ status, message }` shape on failure.
 *
 * Reuse detection: if the presented token was already revoked (either
 * because it was rotated before, or the user logged out), we treat that as
 * a stolen-token replay and revoke every live refresh row for the user.
 */
export async function rotateUserRefreshToken(oldToken: string): Promise<{ userId: string; newToken: string }> {
  const hash = hashToken(oldToken);

  return prisma.$transaction(async (tx) => {
    const row = await tx.userRefreshToken.findUnique({ where: { token_hash: hash } });
    if (!row) throw invalid();

    if (row.revoked_at) {
      // Reuse — nuke everything live for this user.
      await tx.userRefreshToken.updateMany({
        where: { user_id: row.user_id, revoked_at: null },
        data:  { revoked_at: new Date() },
      });
      throw revoked();
    }

    if (row.expires_at.getTime() < Date.now()) throw invalid();

    // Mark old row revoked so any future presentation trips the reuse branch.
    await tx.userRefreshToken.update({
      where: { id: row.id },
      data:  { revoked_at: new Date() },
    });

    const newToken = generatePlainToken();
    await tx.userRefreshToken.create({
      data: {
        user_id: row.user_id,
        token_hash: hashToken(newToken),
        expires_at: new Date(Date.now() + USER_TTL_MS),
      },
    });

    return { userId: row.user_id, newToken };
  });
}

/** Best-effort revoke on logout. Silently no-ops if the token is unknown. */
export async function revokeUserRefreshToken(token: string): Promise<void> {
  await prisma.userRefreshToken.updateMany({
    where: { token_hash: hashToken(token), revoked_at: null },
    data:  { revoked_at: new Date() },
  });
}

// ─── Admin ──────────────────────────────────────────────

export async function issueAdminRefreshToken(adminId: string): Promise<string> {
  const token = generatePlainToken();
  await prisma.adminRefreshToken.create({
    data: {
      admin_id: adminId,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + ADMIN_TTL_MS),
    },
  });
  return token;
}

export async function rotateAdminRefreshToken(oldToken: string): Promise<{ adminId: string; newToken: string }> {
  const hash = hashToken(oldToken);

  return prisma.$transaction(async (tx) => {
    const row = await tx.adminRefreshToken.findUnique({ where: { token_hash: hash } });
    if (!row) throw invalid();

    if (row.revoked_at) {
      await tx.adminRefreshToken.updateMany({
        where: { admin_id: row.admin_id, revoked_at: null },
        data:  { revoked_at: new Date() },
      });
      throw revoked();
    }

    if (row.expires_at.getTime() < Date.now()) throw invalid();

    await tx.adminRefreshToken.update({
      where: { id: row.id },
      data:  { revoked_at: new Date() },
    });

    const newToken = generatePlainToken();
    await tx.adminRefreshToken.create({
      data: {
        admin_id: row.admin_id,
        token_hash: hashToken(newToken),
        expires_at: new Date(Date.now() + ADMIN_TTL_MS),
      },
    });

    return { adminId: row.admin_id, newToken };
  });
}

export async function revokeAdminRefreshToken(token: string): Promise<void> {
  await prisma.adminRefreshToken.updateMany({
    where: { token_hash: hashToken(token), revoked_at: null },
    data:  { revoked_at: new Date() },
  });
}

// ─── Partner ────────────────────────────────────────────

export async function issuePartnerRefreshToken(partnerUserId: string): Promise<string> {
  const token = generatePlainToken();
  await prisma.partnerRefreshToken.create({
    data: {
      partner_user_id: partnerUserId,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + PARTNER_TTL_MS),
    },
  });
  return token;
}

export async function rotatePartnerRefreshToken(oldToken: string): Promise<{ partnerUserId: string; newToken: string }> {
  const hash = hashToken(oldToken);

  return prisma.$transaction(async (tx) => {
    const row = await tx.partnerRefreshToken.findUnique({ where: { token_hash: hash } });
    if (!row) throw invalid();

    if (row.revoked_at) {
      await tx.partnerRefreshToken.updateMany({
        where: { partner_user_id: row.partner_user_id, revoked_at: null },
        data:  { revoked_at: new Date() },
      });
      throw revoked();
    }

    if (row.expires_at.getTime() < Date.now()) throw invalid();

    await tx.partnerRefreshToken.update({
      where: { id: row.id },
      data:  { revoked_at: new Date() },
    });

    const newToken = generatePlainToken();
    await tx.partnerRefreshToken.create({
      data: {
        partner_user_id: row.partner_user_id,
        token_hash: hashToken(newToken),
        expires_at: new Date(Date.now() + PARTNER_TTL_MS),
      },
    });

    return { partnerUserId: row.partner_user_id, newToken };
  });
}

export async function revokePartnerRefreshToken(token: string): Promise<void> {
  await prisma.partnerRefreshToken.updateMany({
    where: { token_hash: hashToken(token), revoked_at: null },
    data:  { revoked_at: new Date() },
  });
}
