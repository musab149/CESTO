import type { SalesClientOwner, SalesClientRelation } from '@grocery-app/shared';

/**
 * Whose a client is, as a tag's colours (2026-10-28, API lib/repClients):
 * the rep's own, another rep's, the office's, or the shop's (they signed
 * themselves up). From the panel's one tint family (components/SalesStatusBadge),
 * each its own hue so a list of "other" clients reads at a glance.
 */
export type ClientOwnerKey = 'own' | SalesClientOwner;

export const CLIENT_OWNER_TONE: Record<ClientOwnerKey, { bg: string; text: string; dot: string }> = {
  own: { bg: 'bg-st-emerald-bg', text: 'text-st-emerald-fg', dot: 'bg-st-emerald-dot' },
  rep: { bg: 'bg-st-violet-bg', text: 'text-st-violet-fg', dot: 'bg-st-violet-dot' },
  office: { bg: 'bg-st-sky-bg', text: 'text-st-sky-fg', dot: 'bg-st-sky-dot' },
  shop: { bg: 'bg-st-slate-bg', text: 'text-st-slate-fg', dot: 'bg-st-slate-dot' },
};

/** The key for a client: their own when `relation` says so — or an older API that says nothing. */
export function ownerKeyOf(relation: SalesClientRelation | undefined, owner: SalesClientOwner | null | undefined): ClientOwnerKey {
  return !relation || relation === 'own' ? 'own' : owner ?? 'shop';
}

/** A whole, plausible email — what the finder will look up. */
export const FULL_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
