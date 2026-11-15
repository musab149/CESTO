import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { configureApi, setTokenStorage, createAsyncStorageAdapter } from '@grocery-app/shared';

/**
 * Private-network addresses, plus localhost. These are the hosts that only
 * mean anything on the machine that wrote them.
 */
const LAN_HOST = /^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

/**
 * Resolve the API base URL, repairing a stale LAN address in development.
 *
 * EXPO_PUBLIC_API_URL is checked into a developer's .env as something like
 * http://192.168.0.100:3000. That address belongs to whichever machine was
 * serving the API the day it was written, and DHCP reassigns it — after which
 * the phone calls an address that is either dead or another device entirely,
 * and every request fails as "Network request failed" with nothing to say the
 * app is fine and the address is not. That is exactly what happened on the
 * first Expo Go run of partner mode.
 *
 * In development the device already knows the right host: it is downloading
 * the JS bundle from it. Constants.expoConfig.hostUri is that host, so a LAN
 * address gets its host swapped for the dev server's while keeping the API's
 * own port.
 *
 * Deliberately narrow:
 *  - __DEV__ only, so a release build never rewrites anything.
 *  - Only when the configured host is private or localhost. A real hostname
 *    (cesto.onrender.com, a staging URL) is left exactly as written.
 *  - Falls back to the configured value whenever hostUri is missing, which is
 *    the case in any build not served by a dev server.
 */
function resolveBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
  if (!__DEV__) return configured;

  // "192.168.0.104:8081" — the machine serving this bundle.
  const hostUri = Constants.expoConfig?.hostUri ?? '';
  const devHost = hostUri.split(':')[0];
  if (!devHost) return configured;

  try {
    const url = new URL(configured);
    if (!LAN_HOST.test(url.hostname)) return configured;
    if (url.hostname === devHost) return configured;

    url.hostname = devHost;
    // eslint-disable-next-line no-console
    console.log(`[api] dev host ${configured} -> ${url.toString().replace(/\/$/, '')}`);
    return url.toString().replace(/\/$/, '');
  } catch {
    // A malformed EXPO_PUBLIC_API_URL should surface as a failed request
    // against what the developer actually wrote, not be silently replaced.
    return configured;
  }
}

export function bootstrapApi(
  onUnauthorized: () => void,
  onAccountBlocked: (reason: string | null) => void,
): void {
  setTokenStorage(
    createAsyncStorageAdapter(AsyncStorage, {
      accessKey: 'cesto-access-token',
      refreshKey: 'cesto-refresh-token',
    }),
  );
  configureApi({
    baseUrl: resolveBaseUrl(),
    onUnauthorized,
    onAccountBlocked,
  });
}
