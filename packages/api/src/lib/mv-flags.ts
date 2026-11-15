// ─── Multi-vendor feature flags ────────────────────────────
// Read once at process start (env vars don't change at runtime). See
// docs/MULTIVENDOR_ROADMAP.md for the full inventory and the slice each
// flag gates. Trunk-based-with-flags is the mv shipping strategy per
// project_multivendor-strategy memory — every mv code path lives behind
// one of these until the slice is verified in production.
//
// Convention:
//   · Every flag defaults to `false` (safe: mv code paths are invisible)
//   · Admin-side frontend reads a mirror VITE_MV_* var and hides UI when
//     off. The server-side check here is the AUTHORITATIVE gate — a stale
//     admin bundle that shows a button would still 404 against the API.
//   · Slice 7 (contract phase) removes the flag reads from code but keeps
//     the env vars set to `true` in prod for a deploy cycle as rollback
//     insurance. Remove from render.yaml only after that soak.
//   · Exception: `draftOrders` defaults to `true` (see below) — deploy
//     environments this needs to reach don't have MV_DRAFT_ORDERS set yet,
//     so defaulting off would silently ship the feature dark everywhere
//     that matters. Flip the default back to `false` here once
//     MV_DRAFT_ORDERS is set explicitly wherever this runs.

import type { Request, Response, NextFunction } from 'express';
import { error } from './response';

function readBool(name: string, defaultValue = false): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === '') return defaultValue;
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/** Flag values captured once at boot. Restart the process to re-read. */
export const mvFlags = {
  /** Slice 1: admin can approve partner B2bLeads → creates Store + PartnerUser. */
  partnerApproval: readBool('MV_PARTNER_APPROVAL'),
  /** Slice 2/3: /api/partner/* auth + dashboard endpoints. */
  partnerLogin: readBool('MV_PARTNER_LOGIN'),
  /** Slice 4: checkout may create ParentOrder + sub-Orders when cart spans stores. */
  orderSplit: readBool('MV_ORDER_SPLIT'),
  /** Slice 6: rider auth + assignment endpoints; rider app is publishable. */
  riderApp: readBool('MV_RIDER_APP'),
  /**
   * Draft orders for out-of-stock items. Checkout routes an item short on
   * stock into a `draft` sub-order instead of hard-blocking the whole
   * transaction. Reuses the Slice 4 ParentOrder grouping mechanism
   * independent of `orderSplit` — a single store with mixed stock still
   * needs a ParentOrder to hold its (normal, draft) sub-order pair.
   *
   * Defaults to ON (unlike every other mv flag) — set MV_DRAFT_ORDERS=false
   * explicitly to turn it off once that's wired into every deploy env.
   */
  draftOrders: readBool('MV_DRAFT_ORDERS', true),
} as const;

type MvFlag = keyof typeof mvFlags;

/**
 * Express middleware that 404s a route when the given flag is off. Use as
 * the first middleware on any mv-gated endpoint so a stale admin bundle
 * hitting the URL sees a legible not-found instead of a partial response.
 *
 * Example:
 *   router.post('/leads/:id/approve', requireMvFlag('partnerApproval'), ...)
 */
export function requireMvFlag(flag: MvFlag) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!mvFlags[flag]) {
      error(res, 'Not found.', 404);
      return;
    }
    next();
  };
}

/**
 * Log the flag state at boot. Called from server.ts so `ps` output on Render
 * makes it obvious which slice(s) are enabled without SSHing to check env.
 */
export function logMvFlags(): void {
  const on = Object.entries(mvFlags).filter(([, v]) => v).map(([k]) => k);
  const off = Object.entries(mvFlags).filter(([, v]) => !v).map(([k]) => k);
  if (on.length === 0) {
    console.log('[mv-flags] all off — mv code paths dark');
  } else {
    console.log(`[mv-flags] on: ${on.join(', ')} · off: ${off.join(', ')}`);
  }
}
