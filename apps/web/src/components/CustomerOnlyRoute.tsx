import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { customerRouteAccess } from '@grocery-app/shared';
import { useAuthStore } from '@/stores/authStore';

/**
 * The storefront is for shoppers. A sales rep is sent to their own surface.
 *
 * A rep is a User with a role, which is what makes one login and one JWT
 * work across both surfaces — but it also meant a rep landed on the homepage
 * after signing in and reached their job through a "Sell" pill in the navbar,
 * as if selling for Cesto were a thing they might do on the way to buying
 * rice. They are staff. The shop is not their surface at all.
 *
 * THIS IS NOT A SECURITY BOUNDARY, and it is the mirror of the note in
 * SalesProtectedRoute: that one keeps shoppers out of /sales, this one keeps
 * staff out of the shop, and neither decides what anyone may DO. A rep's token
 * is an ordinary customer token and /api/orders would still accept it.
 *
 * That is a DECISION, not a gap left to close: a rep is trusted staff. There
 * was a way back in — "Mi cuenta de cliente", a mode for a rep to use the
 * shop as themselves — and it went on 2026-10-26: "sales rep has no need to
 * visit there customer account".
 *
 * Reads the PERSISTED user rather than waiting for `hydrating`, deliberately:
 *   · `user` is restored from localStorage synchronously, so a rep who types
 *     `/` is redirected on the first render with no flash of the storefront.
 *   · The storefront is the public site. Holding first paint behind
 *     /api/users/me to answer a question that matters to a handful of staff
 *     would be the wrong trade for every other visitor.
 * A stale flag is self-correcting: hydrate() replaces the user a moment later,
 * and a rep whose role was revoked stops being redirected. That is also why
 * this guard passes no `hydrating` — it has nothing to wait for.
 *
 * THE RULES ARE NOT HERE. customerRouteAccess() in packages/shared holds them,
 * next to the sales guard's, because the two have to agree: each one's
 * destination is the other one's territory, and when both claimed a path the
 * rep bounced between them until the page gave up. routeAccess.test.ts walks
 * that. The list of customer paths a rep may still open — the cookie banner's
 * /privacy link, the error screens — is STAFF_MAY_OPEN there, with the reasons.
 */
export default function CustomerOnlyRoute() {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const decision = customerRouteAccess({
    isAuthenticated,
    user,
    pathname: location.pathname,
  });

  if (decision.kind === 'redirect') {
    return <Navigate to={decision.to} replace />;
  }

  return <Outlet />;
}
