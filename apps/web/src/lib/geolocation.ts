import type { Coords } from '@grocery-app/shared';

export type BrowserGeolocationErrorCode =
  | 'unsupported'
  | 'permission_denied'
  | 'position_unavailable'
  | 'timeout';

export class BrowserGeolocationError extends Error {
  code: BrowserGeolocationErrorCode;
  constructor(code: BrowserGeolocationErrorCode, message: string) {
    super(message);
    this.name = 'BrowserGeolocationError';
    this.code = code;
  }
}

/**
 * Promise wrapper around navigator.geolocation.getCurrentPosition.
 * Rejects with a typed BrowserGeolocationError so callers can branch
 * on permission_denied vs. transient failures.
 */
export function getBrowserPosition(
  opts: PositionOptions = { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new BrowserGeolocationError('unsupported', 'Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        const code: BrowserGeolocationErrorCode =
          err.code === err.PERMISSION_DENIED
            ? 'permission_denied'
            : err.code === err.POSITION_UNAVAILABLE
              ? 'position_unavailable'
              : 'timeout';
        reject(new BrowserGeolocationError(code, err.message));
      },
      opts,
    );
  });
}

/**
 * Peek at the current permission state without triggering a prompt.
 * Returns null when the browser doesn't expose the Permissions API.
 */
export async function queryGeoPermission(): Promise<PermissionState | null> {
  if (typeof navigator === 'undefined' || !navigator.permissions) return null;
  try {
    const res = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return res.state;
  } catch {
    return null;
  }
}
