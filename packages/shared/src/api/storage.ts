/**
 * Pluggable token storage. Each app provides its own implementation
 * (web → localStorage, mobile → AsyncStorage, admin → its own keys).
 *
 * Async signatures throughout so the same client works in both
 * synchronous (browser) and asynchronous (RN AsyncStorage) environments.
 */

export interface TokenStorage {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  setTokens(access: string, refresh: string): Promise<void>;
  clear(): Promise<void>;
}

let active: TokenStorage | null = null;

export function setTokenStorage(storage: TokenStorage): void {
  active = storage;
}

export function getTokenStorage(): TokenStorage {
  if (!active) throw new Error('Token storage not configured. Call setTokenStorage() during app bootstrap.');
  return active;
}
