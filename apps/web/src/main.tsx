import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryCache, MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { ApiError } from '@grocery-app/shared';
import App from './App';
import './app.css';
import { bootstrapApi } from './lib/api';
import { useAuthStore } from './stores/authStore';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

/**
 * 5xx responses are server outages — redirect to the 500 page once and stop
 * spamming a half-broken UI. We use a hard navigation so React Query, Zustand,
 * and any in-flight requests get torn down cleanly. Per-request error handling
 * still wins because the component-level onError fires before this.
 */
function redirectOnServerError(err: unknown) {
  if (err instanceof ApiError && err.status >= 500 && err.status < 600) {
    if (window.location.pathname !== '/500') {
      window.location.assign('/500');
    }
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({
    onError: (err, query) => {
      // Marked like the mutations below: the screen shows its own failure.
      if (query.meta?.inlineErrors) return;
      // A background refresh of something already on screen — the
      // notification poll, the Home Grocery status — failing for a moment
      // (the database waking, a session renewal answered 5xx) used to throw
      // the whole page away for the 500 page, taking whatever the shopper
      // was in the middle of with it: a household lost the plan list it was
      // building that way. What is on screen stays; the next refresh retries.
      if (query.state.data !== undefined) return;
      redirectOnServerError(err);
    },
  }),
  mutationCache: new MutationCache({
    // A mutation marked `inlineErrors` (checkout, the order quote) shows its
    // own failure where it happened, with a retry. Redirecting it as well
    // would throw the shopper off a half-placed order onto "Something broke
    // on our end" — for what is usually a slow moment, not a crash.
    onError: (err, _vars, _ctx, mutation) => {
      if (mutation.meta?.inlineErrors) return;
      redirectOnServerError(err);
    },
  }),
});

// Configure the shared API client before any component mounts.
// On 401 with no usable refresh token, kick the user out of authenticated state.
bootstrapApi(
  () => {
    useAuthStore.getState().forceLogout();
    queryClient.clear();
  },
  // Blocked mid-session: end it immediately, then leave the reason on the
  // store so the dialog can explain rather than the app simply going quiet.
  (reason) => {
    useAuthStore.getState().forceLogout();
    queryClient.clear();
    useAuthStore.getState().setBlockedNotice(reason ?? '');
  },
);

// Best-effort hydrate from a persisted token; non-blocking. Same-origin
// partner navigation replaced the cross-app /#session=<code> handoff, so
// no bootstrapSession() here any more.
void useAuthStore.getState().hydrate();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </GoogleOAuthProvider>
  </StrictMode>,
);
