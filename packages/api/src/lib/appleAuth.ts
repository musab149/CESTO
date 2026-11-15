// Verifies a Sign in with Apple identity token (sent by the iOS app via
// expo-apple-authentication) and returns the Apple account it belongs to.
//
// Unlike Google's flow there is no Apple endpoint to hand the token to: the
// identity token is a JWT the server checks itself —
//   · signature, against Apple's published keys (JWKS, fetched and cached),
//   · issuer https://appleid.apple.com,
//   · audience — our iOS bundle id (APPLE_BUNDLE_IDS, default com.cestoshop.app),
//   · expiry (jsonwebtoken checks `exp`),
//   · nonce — the app sends the raw nonce and gave Apple its SHA-256, which
//     Apple signed into the token. A token lifted from somebody else's
//     sign-in therefore cannot be replayed here.
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export interface AppleProfile {
  appleId: string;
  /** Real address, or an @privaterelay.appleid.com relay. Null if not shared. */
  email: string | null;
  emailVerified: boolean;
  isPrivateEmail: boolean;
  /** The bundle id the token was issued to — what Apple's token calls name as client_id. */
  clientId: string;
}

type AppleJwk = crypto.JsonWebKey & { kid: string };
export type AppleKeyFetcher = () => Promise<AppleJwk[]>;

interface AppleClaims {
  sub?: string;
  aud?: string | string[];
  nonce?: string;
  email?: string;
  // Apple has sent these both as booleans and as "true"/"false" strings.
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
}

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const KEYS_TTL_MS = 60 * 60 * 1000;
// An unknown `kid` refetches the key set (Apple rotates keys), but at most
// once a minute — a stream of made-up kids must not become a stream of
// requests to Apple.
const MIN_REFETCH_MS = 60 * 1000;

const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const invalid = () => httpError('Invalid Apple credential.', 401);

async function fetchAppleKeys(): Promise<AppleJwk[]> {
  let res: Response;
  try {
    res = await fetch(APPLE_KEYS_URL);
  } catch {
    throw httpError('Could not reach Apple to verify your sign-in.', 502);
  }
  if (!res.ok) throw httpError('Could not reach Apple to verify your sign-in.', 502);
  const body = (await res.json()) as { keys?: AppleJwk[] };
  return body.keys ?? [];
}

// Keyed by fetcher so tests with their own key set never share Apple's cache.
const caches = new WeakMap<AppleKeyFetcher, { keys: AppleJwk[]; at: number }>();

async function keyFor(kid: string, fetchKeys: AppleKeyFetcher): Promise<crypto.KeyObject> {
  const now = Date.now();
  let cache = caches.get(fetchKeys);
  const stale = !cache || now - cache.at > KEYS_TTL_MS;
  const unknownKid = !!cache && !cache.keys.some((k) => k.kid === kid);
  if (stale || (unknownKid && now - cache!.at > MIN_REFETCH_MS)) {
    cache = { keys: await fetchKeys(), at: now };
    caches.set(fetchKeys, cache);
  }
  const jwk = cache!.keys.find((k) => k.kid === kid);
  if (!jwk) throw invalid();
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

/**
 * iOS bundle ids whose tokens we accept. The iOS app is com.cestoshop.app —
 * es.cesto.app (still the Android package) was already registered to another
 * Apple developer account, so iOS could not use it.
 */
export function appleAudiences(): string[] {
  return (process.env.APPLE_BUNDLE_IDS ?? 'com.cestoshop.app')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const hashNonce = (rawNonce: string) => crypto.createHash('sha256').update(rawNonce).digest('hex');

const truthy = (v: boolean | string | undefined) => v === true || v === 'true';

export async function verifyAppleIdentityToken(
  identityToken: string,
  rawNonce: string,
  opts: { fetchKeys?: AppleKeyFetcher; audiences?: string[] } = {},
): Promise<AppleProfile> {
  const audiences = opts.audiences ?? appleAudiences();
  if (audiences.length === 0) {
    throw httpError('Sign in with Apple is not configured on the server.', 503);
  }

  const decoded = jwt.decode(identityToken, { complete: true });
  const kid = decoded && typeof decoded === 'object' ? decoded.header.kid : undefined;
  if (!kid) throw invalid();

  const key = await keyFor(kid, opts.fetchKeys ?? fetchAppleKeys);

  let claims: AppleClaims;
  try {
    claims = jwt.verify(identityToken, key, {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience: audiences as [string, ...string[]],
    }) as AppleClaims;
  } catch {
    throw invalid();
  }

  if (!claims.sub || !claims.nonce || claims.nonce !== hashNonce(rawNonce)) throw invalid();

  return {
    appleId: claims.sub,
    email: claims.email ?? null,
    emailVerified: truthy(claims.email_verified),
    isPrivateEmail: truthy(claims.is_private_email),
    // Verified above to be one of `audiences`.
    clientId: typeof claims.aud === 'string' ? claims.aud : audiences[0],
  };
}
