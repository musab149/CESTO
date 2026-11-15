import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Back that returns where you came from.
 *
 * The back buttons here used to navigate to a computed route — `/orders`, or
 * a sub-order's parent. That is right when the page was opened cold, from a
 * link or a refresh, and wrong the rest of the time: opening an order from a
 * customer's page and pressing back dropped you in the orders list, several
 * clicks from the customer you were looking at.
 *
 * So pop the history entry when there is one of ours to pop, and fall back to
 * the route otherwise.
 *
 * `window.history.state.idx` is React Router's own cursor into the session's
 * history. Zero means this is the first entry we created — a fresh tab, a
 * pasted link, a hard refresh — and `navigate(-1)` there would leave the app
 * entirely, landing the user wherever they were before, or on a blank tab.
 * Anything above zero has one of our own entries behind it.
 *
 * The fallback replaces rather than pushes: arriving cold and pressing back
 * should not leave a dead entry pointing at the page you just left.
 */
export function useGoBack(): (fallback: string) => void {
  const navigate = useNavigate();

  return useCallback((fallback: string) => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate]);
}
