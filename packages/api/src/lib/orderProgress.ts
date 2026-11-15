import type { Request, Response } from 'express';

/**
 * What a big order operation is doing right now, for the page waiting on it.
 *
 * Placing a 1,000-product order took about 20 seconds on production
 * (2026-10-19), and all the shopper saw was a spinner. The work happens in one
 * request, so the page cannot see it — unless the request says where it is.
 * Each tracked operation records the step it has reached under a key the
 * client chose (X-Progress-Key, or the Idempotency-Key it already sends), and
 * GET …/progress/:key reads it back while the request is still running.
 *
 * In memory, on purpose: a progress record is worth something for a minute
 * and only to the one page that asked. If a poll lands on a different
 * instance (Render runs one today), it finds nothing and the page falls back
 * to "still working" — nothing breaks.
 *
 * It also answers a question the outside could not: how long the transaction
 * itself takes. A slow or failed operation logs every step's duration and the
 * time spent inside the transaction against its budget.
 *
 * Step ids are MIRRORED in packages/shared/src/orderProgress.ts, which the
 * pages draw from; test:order-progress fails if the two drift.
 */

export type ProgressKind = 'checkout' | 'create' | 'edit' | 'cancel';
export type ProgressStep = 'checking' | 'reserving' | 'creating' | 'saving' | 'cancelling' | 'confirming';

/** The steps each kind passes through, in order. */
export const PROGRESS_STEPS: Record<ProgressKind, ProgressStep[]> = {
  checkout: ['checking', 'reserving', 'creating', 'confirming'],
  create: ['checking', 'reserving', 'creating', 'confirming'],
  edit: ['checking', 'saving', 'confirming'],
  cancel: ['cancelling', 'confirming'],
};

export interface ProgressDetail {
  /** Lines in the order (or touched by the edit). */
  lines?: number;
  /** Shops the order splits across. */
  shops?: number;
}

export interface ProgressView {
  kind: ProgressKind;
  step: ProgressStep;
  /** Every step reached so far, with ms from the start. */
  steps: Array<{ step: ProgressStep; ms: number }>;
  detail: ProgressDetail;
  elapsedMs: number;
  done: boolean;
  failed: boolean;
}

export interface ProgressTracker {
  step(step: ProgressStep, detail?: ProgressDetail): void;
  detail(detail: ProgressDetail): void;
  /** Mark the transaction's start and its commit, for the timing log. */
  txStart(): void;
  txEnd(): void;
  finish(ok: boolean): void;
}

interface ProgressRecord {
  owner: string;
  kind: ProgressKind;
  startedAt: number;
  steps: Array<{ step: ProgressStep; at: number }>;
  detail: ProgressDetail;
  finishedAt: number | null;
  failed: boolean;
}

/** How long a record stays readable after it was started. */
const KEEP_MS = 10 * 60 * 1000;
/** A runaway client cannot grow this without bound. */
const MAX_RECORDS = 5_000;
/** Operations at least this slow log their step timings. */
export const SLOW_LOG_MS = 3_000;

const records = new Map<string, ProgressRecord>();

/** The key a request asked to be tracked under, if a usable one. */
export function progressKeyFrom(req: Request): string | null {
  const raw = (req.header('X-Progress-Key') ?? req.header('Idempotency-Key') ?? '').trim();
  return /^[A-Za-z0-9_-]{8,100}$/.test(raw) ? raw : null;
}

function sweep(now: number) {
  for (const [key, r] of records) {
    if (now - r.startedAt > KEEP_MS) records.delete(key);
  }
  // Still too many: drop the oldest. Map keeps insertion order.
  while (records.size >= MAX_RECORDS) {
    const oldest = records.keys().next().value;
    if (oldest === undefined) break;
    records.delete(oldest);
  }
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * Start tracking one operation. Always returns a tracker: without a key it
 * stores nothing but still times the steps, so slow operations are logged
 * whether or not a page is watching.
 *
 * It finishes itself when the response goes out — ok when the status is below
 * 400 — so every exit of a handler, errors included, closes the record.
 */
export function trackProgress(
  req: Request,
  res: Response | null,
  owner: string,
  kind: ProgressKind,
  opts: { detail?: ProgressDetail; txBudgetMs?: number; now?: () => number } = {},
): ProgressTracker {
  const now = opts.now ?? Date.now;
  const key = progressKeyFrom(req);
  const startedAt = now();
  const first = PROGRESS_STEPS[kind][0];
  const record: ProgressRecord = {
    owner, kind, startedAt,
    steps: [{ step: first, at: startedAt }],
    detail: { ...opts.detail },
    finishedAt: null,
    failed: false,
  };
  if (key) {
    sweep(startedAt);
    records.set(key, record);
  }
  let txStartedAt: number | null = null;
  let txEndedAt: number | null = null;

  const tracker: ProgressTracker = {
    step(step, detail) {
      if (record.finishedAt !== null) return;
      if (detail) Object.assign(record.detail, detail);
      if (record.steps[record.steps.length - 1].step !== step) record.steps.push({ step, at: now() });
    },
    detail(detail) {
      Object.assign(record.detail, detail);
    },
    txStart() { txStartedAt = now(); },
    txEnd() { txEndedAt = now(); },
    finish(ok) {
      if (record.finishedAt !== null) return;
      record.finishedAt = now();
      record.failed = !ok;
      const total = record.finishedAt - record.startedAt;
      if (total < SLOW_LOG_MS && ok) return;
      const parts = record.steps.map((s, i) => {
        const end = record.steps[i + 1]?.at ?? record.finishedAt!;
        return `${s.step} ${secs(end - s.at)}`;
      });
      const tx = txStartedAt !== null
        ? ` · in transaction ${secs((txEndedAt ?? record.finishedAt) - txStartedAt)}${opts.txBudgetMs ? ` of ${secs(opts.txBudgetMs)}` : ''}`
        : '';
      const size = [
        record.detail.lines !== undefined ? `${record.detail.lines} lines` : null,
        record.detail.shops !== undefined ? `${record.detail.shops} shops` : null,
      ].filter(Boolean).join(', ');
      console.log(`[progress] ${kind}${size ? ` (${size})` : ''} ${ok ? 'done' : 'FAILED'} in ${secs(total)} — ${parts.join(' · ')}${tx}`);
    },
  };
  res?.once('finish', () => tracker.finish(res.statusCode < 400));
  return tracker;
}

/** What a page may see of its own operation; null for anyone else's. */
export function readProgress(key: string, owner: string, now: () => number = Date.now): ProgressView | null {
  const r = records.get(key);
  if (!r || r.owner !== owner) return null;
  const end = r.finishedAt ?? now();
  return {
    kind: r.kind,
    step: r.steps[r.steps.length - 1].step,
    steps: r.steps.map((s) => ({ step: s.step, ms: s.at - r.startedAt })),
    detail: { ...r.detail },
    elapsedMs: end - r.startedAt,
    done: r.finishedAt !== null && !r.failed,
    failed: r.failed,
  };
}

/** For tests. */
export function clearProgress(): void {
  records.clear();
}
