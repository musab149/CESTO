import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildUserLocation, reverseGeocode, GeocodeError } from '@grocery-app/shared';
import type { UserLocation, LocationStatus, Coords } from '@grocery-app/shared';
import {
  BrowserGeolocationError,
  getBrowserPosition,
  queryGeoPermission,
} from '@/lib/geolocation';

type ErrorCode =
  | 'permission_denied'
  | 'unsupported'
  | 'position_unavailable'
  | 'timeout'
  | 'geocode_no_key'
  | 'geocode_no_result'
  | 'geocode_api'
  | 'network'
  | 'unknown';

/**
 * Where the browser says the customer is.
 *
 * This store used to scope the catalogue. It held a postcode plus a "browse
 * everywhere" toggle that narrowed results to stores whose delivery zones
 * reached the customer, and later a country that narrowed them to one market.
 * Both are gone: every customer sees every live store.
 *
 * What is left filters nothing. It exists so the address form can be
 * pre-filled from a detected position instead of retyped, and so the header
 * can show where we think you are.
 */
interface LocationState {
  location: UserLocation | null;
  status: LocationStatus;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  /** Latest permission state the browser reported (null when unknown). */
  permission: PermissionState | null;

  requestLocation: (opts?: { force?: boolean }) => Promise<void>;
  clear: () => void;
}

const GOOGLE_KEY = (import.meta.env.VITE_GOOGLE_MAPS_KEY ?? '') as string;

export const useLocationStore = create<LocationState>()(
  persist(
    (set, get) => ({
      location: null,
      status: 'idle',
      errorCode: null,
      errorMessage: null,
      permission: null,

      async requestLocation({ force = false } = {}) {
        const state = get();
        // If we already have a fresh GPS/manual value and caller isn't forcing,
        // don't re-prompt the user.
        if (!force && state.location && state.location.source !== 'default') return;
        if (state.status === 'requesting') return;

        set({ status: 'requesting', errorCode: null, errorMessage: null });

        const permission = await queryGeoPermission();
        set({ permission });

        let coords: Coords;
        try {
          coords = await getBrowserPosition();
        } catch (err) {
          if (err instanceof BrowserGeolocationError) {
            set({
              status: err.code === 'permission_denied' ? 'denied' : 'unavailable',
              errorCode: err.code,
              errorMessage: err.message,
            });
          } else {
            set({
              status: 'error',
              errorCode: 'unknown',
              errorMessage: err instanceof Error ? err.message : String(err),
            });
          }
          return;
        }

        try {
          const geo = await reverseGeocode(coords, GOOGLE_KEY, { language: 'es' });
          set({
            location: buildUserLocation(coords, geo, 'gps'),
            status: 'granted',
            errorCode: null,
            errorMessage: null,
          });
        } catch (err) {
          const code: ErrorCode =
            err instanceof GeocodeError
              ? err.code === 'NO_KEY'
                ? 'geocode_no_key'
                : err.code === 'NO_RESULT'
                  ? 'geocode_no_result'
                  : err.code === 'NETWORK'
                    ? 'network'
                    : 'geocode_api'
              : 'unknown';
          set({
            status: 'error',
            errorCode: code,
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
      },

      clear() {
        set({ location: null, status: 'idle', errorCode: null, errorMessage: null });
      },
    }),
    {
      name: 'cesto-location-v1',
      partialize: (s) => ({ location: s.location }),
      // No onRehydrateStorage: nothing outside this store needs re-arming.
      // It used to push the persisted scope back into the API client's
      // module-level headers, which no longer exist.
    },
  ),
);
