import * as Location from 'expo-location';
import type { Coords } from '@grocery-app/shared';

export type MobileGeolocationErrorCode =
  | 'permission_denied'
  | 'services_disabled'
  | 'position_unavailable'
  | 'timeout';

export class MobileGeolocationError extends Error {
  constructor(public code: MobileGeolocationErrorCode, message: string) {
    super(message);
    this.name = 'MobileGeolocationError';
  }
}

/**
 * Ask (or read) the foreground-location permission. Returns the raw
 * status so the caller can distinguish "denied" from "never asked".
 */
export async function ensureLocationPermission(): Promise<Location.PermissionStatus> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.status === 'granted') return current.status;
  if (!current.canAskAgain) return current.status;
  const req = await Location.requestForegroundPermissionsAsync();
  return req.status;
}

/**
 * Fetch the device's current coordinates. Throws MobileGeolocationError
 * with a code the store can branch on.
 */
export async function getDeviceCoords(): Promise<Coords> {
  const servicesOn = await Location.hasServicesEnabledAsync();
  if (!servicesOn) {
    throw new MobileGeolocationError('services_disabled', 'Location services are disabled');
  }

  const status = await ensureLocationPermission();
  if (status !== 'granted') {
    throw new MobileGeolocationError('permission_denied', 'Location permission not granted');
  }

  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch (err) {
    throw new MobileGeolocationError(
      'position_unavailable',
      err instanceof Error ? err.message : 'Failed to get position',
    );
  }
}
