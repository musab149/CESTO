import crypto from 'crypto';
import prisma from './prisma';

const TOKEN_BYTES = 32;            // 256 bits → 64 hex chars
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes — high-risk flow, keep the window tight

/** SHA-256 the token before storing — we never persist the plaintext. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Issue a fresh reset token for `userId`. Any prior tokens for the same user
 * are deleted so only the newest link is valid. Returns the plaintext token —
 * the caller is responsible for delivering it (email, log, etc.).
 */
export async function issueResetToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const token_hash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { user_id: userId } }),
    prisma.passwordResetToken.create({
      data: { user_id: userId, token_hash, expires_at: expiresAt },
    }),
  ]);

  return { token, expiresAt };
}

/**
 * Look up an unconsumed, unexpired token. Returns the row (with user) on hit,
 * null otherwise. Does NOT consume — call `consumeResetToken` after the new
 * password is committed.
 */
export async function findValidResetToken(token: string) {
  const record = await prisma.passwordResetToken.findUnique({
    where: { token_hash: hashToken(token) },
    include: { user: true },
  });
  if (!record) return null;
  if (record.used_at) return null;
  if (record.expires_at.getTime() < Date.now()) return null;
  return record;
}

/** Mark a token used. Intended to be called inside the same tx that updates the password. */
export async function consumeResetToken(tokenId: string, tx: typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0] = prisma) {
  await tx.passwordResetToken.update({
    where: { id: tokenId },
    data: { used_at: new Date() },
  });
}

// ─── Rate limiting (in-memory, MVP) ─────────────────────
// Caps how often a single email or IP can request a reset link.
// Replace the Maps with Redis when scaling out.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_WINDOW = 3;

interface Counter { count: number; windowStart: number; }
const emailCounters = new Map<string, Counter>();
const ipCounters = new Map<string, Counter>();

function bump(map: Map<string, Counter>, key: string): boolean {
  const now = Date.now();
  const c = map.get(key);
  if (!c || now - c.windowStart > WINDOW_MS) {
    map.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (c.count >= MAX_PER_WINDOW) return false;
  c.count++;
  return true;
}

export function checkResetRateLimit(email: string, ip: string): { allowed: boolean } {
  const emailOk = bump(emailCounters, email.toLowerCase());
  const ipOk = bump(ipCounters, ip);
  return { allowed: emailOk && ipOk };
}
