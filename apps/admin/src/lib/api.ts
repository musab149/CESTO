import { configureApi, setTokenStorage, createLocalStorageAdapter } from '@grocery-app/shared';

/**
 * Admin auth bootstrap. Post the partner-moves-to-web rework, this is
 * plain admin-only: one token bucket, one hydrate call. The URL-aware
 * `isPartnerContext()` branching that used to live here is gone — the
 * admin app never serves /partner/* routes any more.
 */
export function bootstrapApi(onUnauthorized: () => void): void {
  setTokenStorage(
    createLocalStorageAdapter({
      accessKey:  'cesto-admin-access',
      refreshKey: 'cesto-admin-refresh',
    }),
  );
  configureApi({
    baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:3000',
    onUnauthorized,
    // Admin refresh tokens are not customer ones. Without this the renewal
    // went to the customer route, was always refused, and every admin was
    // signed out an hour after signing in.
    refreshPath: '/api/admin/auth/refresh-token',
  });
}
