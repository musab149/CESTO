import { getTokenStorage } from './storage';

export class ApiError extends Error {
  status: number;
  data?: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export interface ApiClientConfig {
  baseUrl: string;
  /** Called when the refresh token is rejected — apps wire this to logout. */
  onUnauthorized?: () => void;
  /**
   * Called when the API refuses because the account has been blocked, with
   * the reason an admin gave. Apps wire this to "end the session and say
   * why" — without it a blocked customer just sees requests failing.
   *
   * Fires on any request, not only auth ones: requireAuth rejects every
   * authenticated call the moment the block lands.
   */
  onAccountBlocked?: (reason: string | null) => void;
  /**
   * Where an expired access token is renewed. Defaults to the customer route.
   *
   * The admin panel's refresh tokens live in their own table, so they must go
   * to /api/admin/auth/refresh-token. Sent to the customer route they were
   * refused every time, and every admin was signed out an hour after signing
   * in — losing any order they were building (found 2026-10-19).
   */
  refreshPath?: string;
  /** Override the default fetch (useful for testing). */
  fetch?: typeof fetch;
}

let config: ApiClientConfig = { baseUrl: '' };

export function configureApi(cfg: ApiClientConfig): void {
  config = { ...config, ...cfg };
}

export function getApiBaseUrl(): string {
  return config.baseUrl;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skip Authorization header (login, refresh, public endpoints). */
  skipAuth?: boolean;
  /** Skip the auto-refresh on 401 (used by the refresh call itself). */
  skipRefresh?: boolean;
  /** Send body as FormData (multipart). Browser sets Content-Type with boundary. */
  multipart?: boolean;
  /** Extra request headers (e.g. Idempotency-Key). Merged after the built-ins so callers can't accidentally drop auth. */
  headers?: Record<string, string>;
  /**
   * Per-request timeout in milliseconds. Defaults to 10_000. Bump for
   * long-running endpoints like the Excel importer, where the request can take
   * a minute or more on slower connections and the default timeout would abort
   * client-side while the server keeps processing.
   */
  timeoutMs?: number;
  /** The answer is a file rather than the JSON envelope. Errors are still JSON. */
  bytes?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Errors thrown by fetch itself — no response arrived at all.
 *
 * Kept as they are (callers such as cartService.replace() read "not an
 * ApiError" as "transient"), but remembered, so isNetworkFailure() can tell
 * a dropped connection from an ordinary bug that happens to be a TypeError
 * too. Every browser words the network one differently ("Failed to fetch",
 * "NetworkError when attempting…", "Load failed"), so the message is no use.
 */
const networkFailures = new WeakSet<object>();

/** True when `err` is fetch failing to get any response, not a bug or an HTTP error. */
export function isNetworkFailure(err: unknown): boolean {
  return typeof err === 'object' && err !== null && networkFailures.has(err);
}

/**
 * Does this failure of "who am I?" mean the person is no longer signed in?
 *
 * Only an answer ABOUT the session does: refused (401 — which is also what a
 * guest with no token gets), blocked (403), or no such account (404). A
 * dropped connection, a timeout, a rate limit or a server fault says nothing
 * about the session — and treating those as "signed out" put "Sign in" in the
 * header of a perfectly signed-in shopper whenever the API hiccuped at page
 * load (seen on staging 2026-10-18). The admin panel did the same.
 */
export function endsSession(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 404);
}

/**
 * Did a record fail to load because it is not there, or because the request
 * failed?
 *
 * Only the server saying so (404, or 403 for someone else's order) means "not
 * there"; so does no error at all (nothing was asked for). The store, product
 * and order pages used to show "not found" for any failure — a dropped
 * connection or a slow API told a shopper that a shop, or their own order, did
 * not exist (seen on staging 2026-10-18).
 */
export function isNotFound(error: unknown): boolean {
  return !error || (error instanceof ApiError && (error.status === 404 || error.status === 403));
}

interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

const DEFAULT_REFRESH_PATH = '/api/auth/refresh-token';

/**
 * How an attempt to renew the session went.
 *
 * Only `refused` ends the session. It used to end on ANY failure — a dropped
 * connection, a rate limit, a server restart — none of which says anything
 * about the session itself, and each of which signed the person out and threw
 * away whatever they were in the middle of.
 */
type Renewal =
  | { kind: 'renewed'; token: string }
  /** The server looked at the refresh token and said no. */
  | { kind: 'refused' }
  /** No verdict on the token: offline, too slow, rate limited or a server
   *  fault. `error` is what the caller should see instead. */
  | { kind: 'unavailable'; error: unknown };

let refreshPromise: Promise<Renewal> | null = null;

async function refreshAccessToken(): Promise<Renewal> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async (): Promise<Renewal> => {
    const storage = getTokenStorage();
    const refreshToken = await storage.getRefreshToken();
    if (!refreshToken) return { kind: 'refused' };

    // It had no time limit of its own: a renewal that hung left every request
    // waiting behind it hanging too.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      // Direct fetch — we don't go through request() to avoid recursion.
      let res: Response;
      try {
        res = await (config.fetch ?? fetch)(`${config.baseUrl}${config.refreshPath ?? DEFAULT_REFRESH_PATH}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
          signal: controller.signal,
        });
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError') && typeof err === 'object' && err !== null) {
          networkFailures.add(err);
        }
        return { kind: 'unavailable', error: err };
      }
      if (res.status === 429 || res.status >= 500) {
        let message = `Could not renew the session (${res.status})`;
        try {
          const body = (await res.json()) as Envelope<unknown>;
          if (body.error) message = body.error;
        } catch { /* not JSON — keep the generic words */ }
        return { kind: 'unavailable', error: new ApiError(res.status, message) };
      }
      if (!res.ok) return { kind: 'refused' };
      const json = (await res.json()) as Envelope<{ accessToken: string; refreshToken: string }>;
      if (!json.success || !json.data) return { kind: 'refused' };
      await storage.setTokens(json.data.accessToken, json.data.refreshToken);
      return { kind: 'renewed', token: json.data.accessToken };
    } catch (err) {
      return { kind: 'unavailable', error: err };
    } finally {
      clearTimeout(timer);
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = `${config.baseUrl}${path}`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

// There is no browse-scope header. `X-Browse-Postcode` scoped the catalogue
// to stores that delivered to the viewer, and `X-Browse-Country` scoped it to
// a market; both are gone. Every customer sees the whole catalogue, so a
// request carries no scope of its own.

// Cache-partitioning signal only — never trusted for pricing itself, which
// the server always resolves from the viewer's own DB row
// (see resolvePricingContext). Without this, the browser's HTTP cache for
// GET /api/products can't tell a retail response from a wholesale one apart
// (same Authorization, same postcode/country), so a request made right after
// switching Regular <-> Business can be served the pre-switch body straight
// out of cache. Sent on every request, mirroring browseLocation/browseCountry.
let pricingModeHeader: string | null = null;

export function setPricingModeHeader(mode: string | null): void {
  pricingModeHeader = mode;
}

export function getPricingModeHeader(): string | null {
  return pricingModeHeader;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (!config.baseUrl) throw new Error('API not configured. Call configureApi({ baseUrl }) at app startup.');

  const headers: Record<string, string> = {};
  if (!opts.multipart) headers['Content-Type'] = 'application/json';

  let hadToken = false;
  if (!opts.skipAuth) {
    const token = await getTokenStorage().getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      hadToken = true;
    }
  }

  // X-Browse-Postcode / X-Browse-Country used to be set here to scope the
  // catalogue to the customer's location. Both are gone with the zone system —
  // nothing filters on location any more, and the server ignores them.
  //
  // X-Pricing-Mode is unrelated and stays: it keeps a business customer's
  // wholesale view out of the retail cache.
  if (pricingModeHeader) headers['X-Pricing-Mode'] = pricingModeHeader;


  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) headers[k] = v;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const doFetch = async (): Promise<Response> => {
    try {
      return await (config.fetch ?? fetch)(buildUrl(path, opts.query), {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body == null
          ? undefined
          : opts.multipart
            ? (opts.body as BodyInit)   // FormData / Blob — pass through
            : JSON.stringify(opts.body),
        signal: controller.signal,
      });
    } catch (err) {
      // Our own timeout is reported as a 408 below; anything else fetch
      // throws means no response came back.
      if (!(err instanceof Error && err.name === 'AbortError') && typeof err === 'object' && err !== null) {
        networkFailures.add(err);
      }
      throw err;
    }
  };

  try {
    let res = await doFetch();

    // Auto-refresh on 401 (once) — only when we actually had a token.
    // A 401 on a request without a token just means the endpoint needs auth;
    // it isn't a session expiry, so we shouldn't tear down the auth state.
    if (res.status === 401 && hadToken && !opts.skipAuth && !opts.skipRefresh) {
      const renewal = await refreshAccessToken();
      if (renewal.kind === 'renewed') {
        headers.Authorization = `Bearer ${renewal.token}`;
        res = await doFetch();
      } else if (renewal.kind === 'unavailable') {
        // No verdict on the session, so it is kept. This request fails the
        // way the underlying problem would have failed it — offline, timeout,
        // 429, 5xx — and each screen's usual handling for that applies. The
        // 401 means the request itself was never acted on.
        throw renewal.error;
      }
      if (res.status === 401) {
        await getTokenStorage().clear();
        config.onUnauthorized?.();
      }
    }

    if (opts.bytes && res.ok) return new Uint8Array(await res.arrayBuffer()) as T;

    let json: Envelope<T>;
    try {
      json = (await res.json()) as Envelope<T>;
    } catch {
      throw new ApiError(res.status, `Server returned non-JSON response (${res.status})`);
    }

    if (!res.ok || !json.success) {
      // A blocked account is the one failure the caller cannot usefully
      // handle on its own — the whole session has to end. Notify the app
      // before throwing, so it can log out no matter which call tripped it.
      const payload = json.data as { code?: string; reason?: string | null } | null;
      if (res.status === 403 && payload?.code === 'account_blocked') {
        config.onAccountBlocked?.(payload.reason ?? null);
      }
      throw new ApiError(res.status, json.error || `Request failed (${res.status})`, json.data);
    }
    return json.data as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(408, 'Request timeout — API server unreachable or too slow');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// Sugar
export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'GET', query }),
  getBytes: (path: string, opts?: RequestOptions) =>
    request<Uint8Array>(path, { ...opts, method: 'GET', bytes: true }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
};
