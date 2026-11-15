import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { salesRouteAccess } from '@grocery-app/shared';
import { useAuthStore } from '@/stores/authStore';

/**
 * Gate for /sales/* routes, built the same way as PartnerProtectedRoute.
 *
 * `is_sales_rep` rides on the User from /api/users/me, so deciding whether to
 * render costs no extra request. The API filters on is_active, so a revoked rep
 * reads as false here — there is no "rep, but inactive" state for this
 * component to interpret.
 *
 * THIS IS NOT THE SECURITY BOUNDARY. It decides what to render; what a rep may
 * actually do is decided by /api/sales/* not exposing anything else. A rep who
 * reached these screens with a stale flag would find every call refused by
 * requireSalesRep, which is the shape that matters — the admin panel's problem
 * is the opposite one, 177 endpoints behind 11 guards and a sidebar that hides
 * menu items.
 *
 * THE RULES ARE NOT HERE. They are salesRouteAccess() in packages/shared,
 * where routeAccess.test.ts can put every (user, path) pair through them —
 * including the pair that gave a rep a blank page on their first ever login.
 * Nothing in this repo can render a component in a test, so a rule written
 * inline here is a rule nobody can check. This file reads the stores, asks,
 * and does as it is told.
 */
export default function SalesProtectedRoute() {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hydrating = useAuthStore((s) => s.hydrating);

  const decision = salesRouteAccess({
    hydrating,
    isAuthenticated,
    user,
    pathname: location.pathname,
  });

  // Waiting for the auth store, so a refresh does not briefly bounce a
  // signed-in rep to /login.
  if (decision.kind === 'wait') {
    return (
      <div className="sales-app min-h-screen flex items-center justify-center bg-surface-linen">
        <div className="w-8 h-8 rounded-full border-2 border-brand/20 border-t-brand animate-spin" />
      </div>
    );
  }

  if (decision.kind === 'redirect') {
    // `carryFrom` means the destination can send them back where they were
    // headed, rather than dropping them on the Today page to find their way
    // again. /login and the rotate screen both read this state.
    const state = decision.carryFrom
      ? { from: `${location.pathname}${location.search}` }
      : undefined;
    return <Navigate to={decision.to} replace state={state} />;
  }

  return <Outlet />;
}
