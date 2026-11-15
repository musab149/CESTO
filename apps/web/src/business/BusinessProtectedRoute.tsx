import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { businessRouteAccess } from '@grocery-app/shared';
import { useAuthStore } from '@/stores/authStore';

/**
 * Gate for /business/* — SalesProtectedRoute's twin (2026-10-29).
 *
 * `is_business` rides on the User from /api/users/me, so deciding costs no
 * request. The rules are businessRouteAccess() in packages/shared, where
 * routeAccess.test.ts runs every (user, path) pair through them; this reads
 * the stores, asks, and does as it is told.
 *
 * Not the security boundary: /api/business/* checks the approval on every
 * request, and the customer routes behind the rest price by the account.
 */
export default function BusinessProtectedRoute() {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hydrating = useAuthStore((s) => s.hydrating);

  const decision = businessRouteAccess({ hydrating, isAuthenticated, user, pathname: location.pathname });

  if (decision.kind === 'wait') {
    return (
      <div className="sales-app min-h-screen flex items-center justify-center bg-surface-linen">
        <div className="w-8 h-8 rounded-full border-2 border-brand/20 border-t-brand animate-spin" />
      </div>
    );
  }
  if (decision.kind === 'redirect') {
    const state = decision.carryFrom ? { from: `${location.pathname}${location.search}` } : undefined;
    return <Navigate to={decision.to} replace state={state} />;
  }
  return <Outlet />;
}
