import type { TokenStorage } from './storage';

/** localStorage-backed storage. Use in web + admin (with distinct keys). */
export function createLocalStorageAdapter(opts: { accessKey: string; refreshKey: string }): TokenStorage {
  const { accessKey, refreshKey } = opts;
  const ls = (): Storage | null => (typeof window !== 'undefined' ? window.localStorage : null);
  return {
    async getAccessToken() { return ls()?.getItem(accessKey) ?? null; },
    async getRefreshToken() { return ls()?.getItem(refreshKey) ?? null; },
    async setTokens(access, refresh) {
      ls()?.setItem(accessKey, access);
      ls()?.setItem(refreshKey, refresh);
    },
    async clear() {
      ls()?.removeItem(accessKey);
      ls()?.removeItem(refreshKey);
    },
  };
}

/** AsyncStorage-backed storage for React Native. Pass in the AsyncStorage module. */
export function createAsyncStorageAdapter(
  asyncStorage: { getItem: (k: string) => Promise<string | null>; setItem: (k: string, v: string) => Promise<void>; removeItem: (k: string) => Promise<void> },
  opts: { accessKey: string; refreshKey: string },
): TokenStorage {
  const { accessKey, refreshKey } = opts;
  return {
    getAccessToken: () => asyncStorage.getItem(accessKey),
    getRefreshToken: () => asyncStorage.getItem(refreshKey),
    async setTokens(access, refresh) {
      await asyncStorage.setItem(accessKey, access);
      await asyncStorage.setItem(refreshKey, refresh);
    },
    async clear() {
      await asyncStorage.removeItem(accessKey);
      await asyncStorage.removeItem(refreshKey);
    },
  };
}
