import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

/**
 * Gate for /partner/* routes. Same-origin now that partner lives inside
 * apps/web — no cross-app SSO, no separate /partner/me fetch just to
 * decide whether to render. We read the customer authStore, which
 * already carries `partner_roles` on the User (populated by
 * /api/users/me).
 *
 * Behaviour:
 *   · Not authenticated → redirect to /login with returnTo so post-login
 *     bounces back to the intended partner page.
 *   · Authenticated but no partner role → 404-ish redirect to /. A
 *     customer without a store shouldn't see partner chrome.
 *   · password_is_temp → send them to /profile/change-password to rotate
 *     the admin-issued temp password before any partner page renders.
 *   · Otherwise → render children.
 */
export default function PartnerProtectedRoute() {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hydrating = useAuthStore((s) => s.hydrating);

  // Wait for the auth store to finish hydrating so we don't briefly bounce
  // an authenticated partner to /login on a page refresh.
  if (hydrating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-linen">
        <div className="w-8 h-8 rounded-full border-2 border-brand/20 border-t-brand animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from: returnTo }} />;
  }

  const hasPartnerRole = (user.partner_roles?.length ?? 0) > 0;
  if (!hasPartnerRole) {
    return <Navigate to="/" replace />;
  }

  if (user.password_is_temp) {
    // Carry the intended destination so the rotate screen can send them back
    // here afterwards. Without it a partner finished rotating and landed on
    // /profile, then had to find "Manage store" again.
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to="/profile/change-password" replace state={{ from: returnTo }} />;
  }

  return <Outlet />;
}
