import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function NetworkBoundary() {
  const navigate = useNavigate();
  const location = useLocation();
  const lastOnlinePath = useRef<string>(location.pathname + location.search);

  useEffect(() => {
    if (location.pathname !== '/offline') {
      lastOnlinePath.current = location.pathname + location.search;
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onOffline = () => {
      if (window.location.pathname !== '/offline') {
        navigate('/offline', { replace: true });
      }
    };
    const onOnline = () => {
      if (window.location.pathname === '/offline') {
        navigate(lastOnlinePath.current || '/', { replace: true });
      }
    };

    window.addEventListener('offline', onOffline);
    window.addEventListener('online',  onOnline);

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      onOffline();
    }

    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online',  onOnline);
    };
  }, [navigate]);

  return null;
}
