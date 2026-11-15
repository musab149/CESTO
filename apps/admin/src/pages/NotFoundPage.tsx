import { useNavigate, useLocation } from 'react-router-dom';
import { Compass, Home } from 'lucide-react';
import ErrorPage from './ErrorPage';

export default function NotFoundPage() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <ErrorPage
      icon={Compass}
      accent="brand"
      badge="ERROR 404"
      title="Page not found"
      body="The page you tried to open doesn't exist or has been moved."
      detail={
        <>
          <span className="font-display text-[11px] uppercase tracking-wider text-gray shrink-0">Path</span>
          <span className="truncate text-ink">{location.pathname}</span>
        </>
      }
      actions={[
        { label: 'Go to dashboard', icon: Home, onClick: () => navigate('/') },
      ]}
    />
  );
}
