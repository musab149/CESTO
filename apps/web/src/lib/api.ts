import {
  configureApi, configureConnectionProbe, createLocalStorageAdapter, setTokenStorage,
} from '@grocery-app/shared';

/**
 * Bootstraps the shared API client for the customer web app.
 * Called once from main.tsx before React renders.
 */
export function bootstrapApi(
  onUnauthorized: () => void,
  onAccountBlocked: (reason: string | null) => void,
): void {
  setTokenStorage(createLocalStorageAdapter({
    accessKey: 'cesto-access-token',
    refreshKey: 'cesto-refresh-token',
  }));
  configureApi({
    baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:3000',
    onUnauthorized,
    onAccountBlocked,
  });
  // When a request fails or drags, this is what tells "your internet is slow"
  // from "we are slow": the favicon comes from the CDN edge near the shopper,
  // never from the API. See packages/shared/src/api/connection.ts.
  configureConnectionProbe(`${window.location.origin}/favicon.svg`);
}
