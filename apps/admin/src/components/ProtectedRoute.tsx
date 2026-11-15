import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAdminAuthStore } from '@/stores/authStore';

export default function ProtectedRoute() {
  const isAuthenticated = useAdminAuthStore((s) => s.isAuthenticated);
  const role = useAdminAuthStore((s) => s.user?.role);
  const mustChange = useAdminAuthStore((s) => !!s.user?.must_change_password);
  const { pathname } = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // A password somebody else chose is replaced before anything else. The API
  // refuses the rest until then (requireOwnPassword).
  if (mustChange && pathname !== '/account/password') {
    return <Navigate to="/account/password" replace />;
  }

  // A lawyer has the archive and nothing else. The API refuses everything else
  // too (confineLawyers); this is so they land somewhere rather than on errors.
  if (role === 'lawyer' && pathname !== '/account/password'
    && pathname !== '/documents' && !pathname.startsWith('/documents/')) {
    return <Navigate to="/documents" replace />;
  }

  return <Outlet />;
}
