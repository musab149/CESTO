import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Auto-redirects to /offline when the browser goes offline, and back to
 * the previous URL when it comes online. Mounted once inside the router.
 *
 * Pages where the user is in the middle of typing/uploading aren't bounced —
 * the listener fires on the browser's `offline` event, which only triggers
 * when the OS reports the connection is actually gone.
 */
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

    // Cover the initial-mount case: tab opened while already offline.
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
