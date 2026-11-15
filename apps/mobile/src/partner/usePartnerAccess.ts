import { useAuthStore } from '@/stores/authStore';

/**
 * Who may enter partner mode, and what to do when they may not.
 *
 * A partner is not a separate account. It is a customer whose `User` carries
 * `partner_roles`, exactly as on web — so there is no partner login, no second
 * token and no cross-app SSO. Entering partner mode is a navigation decision
 * about someone who is already signed in.
 *
 * Mirrors apps/web/src/partner/PartnerProtectedRoute.tsx. Keep the two in step:
 * a rule that exists on only one platform is a rule a partner can walk around
 * by switching device.
 */
export type PartnerAccess =
  /** Auth store still rehydrating from storage — decide nothing yet. */
  | { state: 'loading' }
  /** Signed out. Send to login. */
  | { state: 'unauthenticated' }
  /** Signed in, but this account has no store. */
  | { state: 'not-a-partner' }
  /** Admin-issued temporary password must be rotated before anything renders. */
  | { state: 'must-rotate-password' }
  | { state: 'ok' };

export function usePartnerAccess(): PartnerAccess {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hydrating = useAuthStore((s) => s.hydrating);

  // Deciding while the store is still hydrating bounces a signed-in partner
  // out to login for a frame on every cold start.
  if (hydrating) return { state: 'loading' };
  if (!isAuthenticated || !user) return { state: 'unauthenticated' };
  if ((user.partner_roles?.length ?? 0) === 0) return { state: 'not-a-partner' };
  if (user.password_is_temp) return { state: 'must-rotate-password' };
  return { state: 'ok' };
}

/**
 * Whether to offer the partner entry point at all.
 *
 * Separate from the gate above because the profile screen asks a narrower
 * question: should this row exist? A partner mid-password-rotation still has a
 * store, so the row shows and the gate handles the rotation — hiding it would
 * strand them with no way back in.
 */
export function useIsPartner(): boolean {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated && (user?.partner_roles?.length ?? 0) > 0;
}

/**
 * The store this partner manages, for chrome that needs to name it.
 *
 * Takes the first role. A user with roles at two stores is possible in the
 * schema but has no UI anywhere yet — web picks the first too, and the API
 * scopes every partner request by the store on the JWT, so a store switcher
 * would need server work before it would mean anything here.
 */
export function usePartnerStore(): { id: string; name: string; role: 'owner' | 'manager' } | null {
  const user = useAuthStore((s) => s.user);
  const role = user?.partner_roles?.[0];
  if (!role) return null;
  return { id: role.store_id, name: role.store_name, role: role.role };
}
