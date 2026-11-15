import { ApiError, isNetworkFailure } from './client';

/**
 * Whose side is a slow or failed request on — the shopper's connection, or ours?
 *
 * The failure alone cannot say. A request that runs out of time looks the same
 * whether the shopper is on one bar of mobile data or our API is crawling, and
 * a dropped connection looks the same whether their wifi went or the proxy in
 * front of the API hung up. So we take a second, independent measurement:
 * fetch one tiny file from a host that is NOT the API — the website's own
 * static files, served from a CDN edge close to the shopper. If that is slow
 * or fails as well, it is their connection. If it comes straight back, their
 * connection is fine and the slowness is ours.
 *
 * This only ever runs after something has already failed or dragged on, so it
 * costs nothing on the happy path.
 *
 * It came out of a 600-line order on production (2026-10-16): the shopper was
 * shown "That took too long to process" and then "Something broke on our
 * end", and nothing on screen said whether to move closer to the wifi or to
 * wait for us.
 */

/** What the probe found out about the shopper's own connection. */
export type ConnectionVerdict =
  | 'offline'
  | 'slow'
  | 'fine'
  /** No probe configured and the browser offers no hint. */
  | 'unknown';

/** Why a request failed, in the terms a shopper can act on. */
export type FailureKind =
  /** The device has no connection at all. */
  | 'offline'
  /** It has one, but too slow to get the request through in time. */
  | 'slow_connection'
  /** Their connection is fine; our server was slow or briefly unreachable. */
  | 'server_busy'
  /** Our server answered with a fault. */
  | 'server_error'
  /** No answer in time, and nothing to say whose side that was on. */
  | 'no_answer'
  /** The server answered and said no (a 4xx). Its message is the answer. */
  | 'rejected';

/**
 * A ~500-byte file from the web's own static files takes well under half a
 * second on any usable connection, even over a fresh connection. Past 1.5s the
 * connection itself is struggling — and a request carrying a big basket, which
 * is far larger than this file, has no chance.
 */
const SLOW_PROBE_MS = 1_500;
/** Not here after 5s: the connection is unusable for now, whatever its bars say. */
const PROBE_BUDGET_MS = 5_000;

let probeUrl: string | null = null;

/**
 * Point the probe at a small static file that is NOT served by the API.
 *
 * The web passes its own favicon: same origin as the page, served by the CDN.
 * Pointing it at the API would defeat the purpose — the API being slow is one
 * of the two answers it has to tell apart.
 */
export function configureConnectionProbe(url: string | null): void {
  probeUrl = url;
}

function reportsOffline(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  // React Native has a navigator without onLine — undefined is not "offline".
  return nav?.onLine === false;
}

/**
 * The browser's own estimate, where it gives one (Chromium on desktop and
 * Android; Safari and Firefox do not). Only consulted when there is no probe,
 * because it is an estimate of the network type, not a measurement.
 */
function browserHint(): ConnectionVerdict {
  const conn = (globalThis as {
    navigator?: { connection?: { effectiveType?: string; rtt?: number } };
  }).navigator?.connection;
  if (!conn?.effectiveType) return 'unknown';
  if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') return 'slow';
  if (typeof conn.rtt === 'number' && conn.rtt >= 1_000) return 'slow';
  return 'fine';
}

/** Measure the shopper's connection against the CDN, not the API. */
export async function probeConnection(): Promise<ConnectionVerdict> {
  if (reportsOffline()) return 'offline';
  if (!probeUrl) return browserHint();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_BUDGET_MS);
  const started = Date.now();
  try {
    // no-store skips the browser's cache, so this is a real trip over the
    // network. No cache-busting query string: the CDN edge should answer
    // from ITS cache, or we would be timing our origin instead of the line.
    const res = await fetch(probeUrl, { cache: 'no-store', signal: controller.signal });
    await res.arrayBuffer();
    return Date.now() - started > SLOW_PROBE_MS ? 'slow' : 'fine';
  } catch {
    // Ran out of time: connected, but too slow to use. Failed outright: could
    // not even reach the CDN, which is as good as no connection.
    return controller.signal.aborted ? 'slow' : 'offline';
  } finally {
    clearTimeout(timer);
  }
}

function fromVerdict(verdict: ConnectionVerdict): FailureKind {
  switch (verdict) {
    case 'offline': return 'offline';
    case 'slow': return 'slow_connection';
    case 'fine': return 'server_busy';
    default: return 'no_answer';
  }
}

/**
 * True when a failed WRITE may have happened anyway.
 *
 * No answer at all (our own timeout, fetch failing) or a 5xx: the server may
 * have committed before the failure reached us. A 4xx is a refusal, and a
 * refused write did not happen. Screens that build orders use this to say
 * "it may already exist, pressing again is safe" instead of "it failed".
 */
export function isUncertainOutcome(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 408 || err.status >= 500;
  return isNetworkFailure(err);
}

/**
 * Turn a failed request into whose side it was on.
 *
 * Only failures with NO answer need the probe: a timeout (our client gave up
 * waiting) or fetch rejecting outright. A response with a status already says
 * where it came from — though a 502/503/504 is "busy, try again", not broken,
 * and is reported that way.
 */
export async function diagnoseFailure(err: unknown): Promise<FailureKind> {
  if (err instanceof ApiError) {
    if (err.status === 408) return fromVerdict(await probeConnection());
    if (err.status === 502 || err.status === 503 || err.status === 504) return 'server_busy';
    if (err.status >= 500) return 'server_error';
    return 'rejected';
  }
  // fetch got no response at all: offline, DNS, a reset connection — or a
  // gateway error page sent without CORS headers, which the browser reports
  // the same way. The probe tells them apart.
  if (isNetworkFailure(err)) return fromVerdict(await probeConnection());
  // Anything else is a bug in our own code — a TypeError included. Blaming
  // the shopper's connection for it would send them looking for wifi.
  return 'server_error';
}
