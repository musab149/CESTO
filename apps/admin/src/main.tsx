import '@/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryCache, MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@grocery-app/shared';
import App from './App';
import './app.css';
import { bootstrapApi } from '@/lib/api';
import { useAdminAuthStore } from '@/stores/authStore';
import { ToastProvider } from '@/components/Toast';
import { notifyOutsideReact } from '@/lib/toastBridge';
import i18n from '@/i18n';
import ErrorBoundary from '@/components/ErrorBoundary';

/**
 * Where a 5xx goes, and what it has to carry with it.
 *
 * This is a FULL page load, not a router navigation, so every piece of React
 * state dies here — including the modal that was about to show the error
 * inline. The server's message is the only thing that makes the failure
 * diagnosable, and it was being dropped on the floor: /500 renders
 * <ServerErrorPage /> with no props, so the page told whoever hit it to
 * "send engineering the reference below" and then showed nothing below.
 *
 * It also clears the network log, so the failing request is gone from
 * DevTools by the time anyone looks unless they had "Preserve log" ticked.
 * Hence sessionStorage: it is the one channel that survives the navigation.
 */
function redirectOnServerError(err: unknown, hasDataOnScreen = false) {
  /**
   * EVERY FAILURE LEAVES A TRACE, even the ones this function does not act on.
   *
   * Only 5xx gets the redirect below. A 4xx is a refusal the server explained
   * — 403 from a role guard, 404, a 409 on a conflict — and those were falling
   * through here to nothing at all: any screen whose mutation had an
   * onSuccess and no onError showed the user a button that went busy and then
   * came back, with no message and no record. One line of console is not a
   * fix for that (the fix is an onError on the screen, where the words can be
   * useful), but it is the difference between "nothing happened" and
   * something to go on.
   */
  if (err instanceof ApiError && err.status < 500) {
    console.error(`[api] ${err.status} ${err.message}`, err.data ?? '');
  }
  if (err instanceof ApiError && err.status >= 500 && err.status < 600) {
    try {
      sessionStorage.setItem('admin:lastServerError', JSON.stringify({
        status: err.status,
        message: err.message,
        at: new Date().toISOString(),
        path: window.location.pathname,
        // Whatever the API put in the body — `error` usually names the
        // Prisma code, which is the single most useful token in a report.
        data: err.data ?? null,
      }));
    } catch { /* private mode, or storage full — the redirect still matters */ }

    /**
     * A REFRESH THAT FAILED IS NOT A PAGE THAT FAILED.
     *
     * The redirect below is a full page load: every piece of React state dies,
     * including a dialog mid-flow and a form half filled in. That is the right
     * trade when the screen has nothing to show — a query with no data renders
     * nothing, so the error page is strictly better than a blank one.
     *
     * It is the wrong trade for a query that already HAS data. Something is on
     * screen and still readable; the only news is that refreshing it failed.
     * On 2026-10-09 an admin hired a sales rep on production, the refetch that
     * followed hit a one-off P1001 (the connection to Neon, not the rep, which
     * was created fine), and the whole panel was replaced by ERROR 500 —
     * leaving them unable to tell whether their own action had worked.
     *
     * So: say so, keep the page. If no toast host is mounted the message would
     * vanish entirely, and then the error page IS the better answer.
     */
    if (hasDataOnScreen) {
      const told = notifyOutsideReact({
        variant: 'error',
        title: i18n.t('errors.refreshFailedTitle', 'Could not refresh'),
        body: `${err.message} ${i18n.t('errors.refreshFailedBody', 'What you are looking at may be out of date.')}`,
      });
      if (told) return;
    }

    if (window.location.pathname !== '/500') {
      window.location.assign('/500');
    }
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({
    // `query.state.data` is what the screen is currently rendering. Its
    // presence is the whole difference between "this page is broken" and
    // "this page is stale", which is why it is passed.
    onError: (err, query) => redirectOnServerError(err, query.state.data !== undefined),
  }),
  // A failed MUTATION keeps the old behaviour: nothing was refreshed, the
  // action itself failed, and the screen's own onError is where the words
  // belong. Arity pinned deliberately — this callback's second argument is
  // `variables`, not a flag.
  mutationCache: new MutationCache({
    // A mutation marked `inlineErrors` (building or editing an order) shows
    // its failure where it happened, with the button still there to retry.
    // Redirecting as well threw away the basket being built — for what is
    // often a slow moment, not a crash. Same rule as apps/web/src/main.tsx.
    onError: (err, _vars, _ctx, mutation) => {
      if (mutation.meta?.inlineErrors) return;
      redirectOnServerError(err);
    },
  }),
});

bootstrapApi(() => {
  useAdminAuthStore.getState().forceLogout();
  queryClient.clear();
});

void useAdminAuthStore.getState().hydrate();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
