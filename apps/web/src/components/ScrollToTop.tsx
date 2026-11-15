import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Resets the scroll position to the top whenever the route changes, and on
// first mount disables the browser's automatic scroll restoration so a hard
// refresh always starts from the top instead of wherever the user last was
// (e.g. landing in the footer after refreshing a long page).
export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);

  return null;
}
