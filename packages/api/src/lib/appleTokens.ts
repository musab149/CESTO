// Sign in with Apple, the server-to-server half: trading the app's one-time
// authorization code for a refresh token at sign-in, and revoking that token
// when the customer deletes their account. App Review guideline 5.1.1(v)
// requires the revocation of any app that offers Sign in with Apple — it is
// what removes Cesto from the customer's "Apps using Apple ID" list.
//
// The code is only good for five minutes and only at sign-in, so the refresh
// token has to be fetched and kept then; there is no way to revoke later
// without it.
//
// Both calls authenticate with a "client secret": a short-lived ES256 JWT
// signed with the Sign in with Apple key (.p8) from the developer account.
//   APPLE_TEAM_ID           the developer team id
//   APPLE_KEY_ID            the key's id (10 characters)
//   APPLE_PRIVATE_KEY       the .p8 contents — production (\n escapes accepted)
//   APPLE_PRIVATE_KEY_PATH  or a path to the .p8 — local development
// Unconfigured, sign-in works exactly as before and nothing is stored or
// revoked.
import fs from 'fs';
import jwt from 'jsonwebtoken';
import prisma from './prisma';

const APPLE_AUDIENCE = 'https://appleid.apple.com';
const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const REQUEST_TIMEOUT_MS = 10_000;

export interface AppleSigningConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
}

export function appleSigningConfig(env: NodeJS.ProcessEnv = process.env): AppleSigningConfig | null {
  const teamId = env.APPLE_TEAM_ID?.trim();
  const keyId = env.APPLE_KEY_ID?.trim();
  let privateKey = env.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  if (!privateKey && env.APPLE_PRIVATE_KEY_PATH?.trim()) {
    try {
      privateKey = fs.readFileSync(env.APPLE_PRIVATE_KEY_PATH.trim(), 'utf8').trim();
    } catch {
      console.error('[apple] APPLE_PRIVATE_KEY_PATH is set but the file could not be read');
      return null;
    }
  }
  if (!teamId || !keyId || !privateKey) return null;
  return { teamId, keyId, privateKey };
}

/** Valid for five minutes. Each call signs a fresh one, so nothing is cached or rotated. */
export function appleClientSecret(clientId: string, cfg: AppleSigningConfig, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  return jwt.sign(
    { iss: cfg.teamId, iat, exp: iat + 300, aud: APPLE_AUDIENCE, sub: clientId },
    cfg.privateKey,
    { algorithm: 'ES256', keyid: cfg.keyId },
  );
}

type Fetch = typeof fetch;
interface CallOptions { config?: AppleSigningConfig | null; fetch?: Fetch }

type AppleTokenBody = { refresh_token?: unknown; error?: unknown };

async function postForm(url: string, form: Record<string, string>, fetchImpl: Fetch): Promise<{ status: number; body: AppleTokenBody | null }> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let body: AppleTokenBody | null = null;
  try {
    body = (await res.json()) as AppleTokenBody;
  } catch {
    // The revoke endpoint answers success with an empty body.
  }
  return { status: res.status, body };
}

/** The refresh token for a fresh authorization code. Null when unconfigured. */
export async function exchangeAppleAuthorizationCode(
  code: string,
  clientId: string,
  opts: CallOptions = {},
): Promise<string | null> {
  const cfg = opts.config === undefined ? appleSigningConfig() : opts.config;
  if (!cfg) return null;
  const { status, body } = await postForm(TOKEN_URL, {
    client_id: clientId,
    client_secret: appleClientSecret(clientId, cfg),
    code,
    grant_type: 'authorization_code',
  }, opts.fetch ?? fetch);
  if (status !== 200 || typeof body?.refresh_token !== 'string') {
    throw new Error(`Apple token exchange failed (${status} ${String(body?.error ?? 'no body')})`);
  }
  return body.refresh_token;
}

/** Ends the customer's authorization of the app. False when unconfigured. */
export async function revokeAppleToken(
  refreshToken: string,
  clientId: string,
  opts: CallOptions = {},
): Promise<boolean> {
  const cfg = opts.config === undefined ? appleSigningConfig() : opts.config;
  if (!cfg) return false;
  const { status, body } = await postForm(REVOKE_URL, {
    client_id: clientId,
    client_secret: appleClientSecret(clientId, cfg),
    token: refreshToken,
    token_type_hint: 'refresh_token',
  }, opts.fetch ?? fetch);
  if (status !== 200) {
    throw new Error(`Apple token revocation failed (${status} ${String(body?.error ?? 'no body')})`);
  }
  return true;
}

/**
 * At sign-in, once the account is known: trade the code and keep the token,
 * replacing any earlier one. Never throws — a failure here must not fail the
 * sign-in, it only means this sign-in cannot be revoked later (the next one
 * tries again).
 */
export async function rememberAppleToken(userId: string, code: string, clientId: string): Promise<void> {
  try {
    const refreshToken = await exchangeAppleAuthorizationCode(code, clientId);
    if (!refreshToken) return;
    await prisma.appleToken.upsert({
      where: { user_id: userId },
      create: { user_id: userId, refresh_token: refreshToken, client_id: clientId },
      update: { refresh_token: refreshToken, client_id: clientId },
    });
  } catch (err) {
    console.error(`[apple] could not keep a refresh token for user ${userId}:`, err instanceof Error ? err.message : err);
  }
}
