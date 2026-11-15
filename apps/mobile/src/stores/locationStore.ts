import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  buildUserLocation,
  reverseGeocode,
  GeocodeError,
} from '@grocery-app/shared';
import type { UserLocation, LocationStatus, Coords } from '@grocery-app/shared';
import {
  MobileGeolocationError,
  getDeviceCoords,
} from '@/lib/geolocation';

type ErrorCode =
  | 'permission_denied'
  | 'services_disabled'
  | 'position_unavailable'
  | 'timeout'
  | 'geocode_no_key'
  | 'geocode_no_result'
  | 'geocode_api'
  | 'network'
  | 'unknown';

/**
 * Where the device says the customer is.
 *
 * This used to answer "can we deliver here" — it called `zonesService.check`
 * and stored a zone id plus a `serviceable` flag. Delivery coverage is no
 * longer modelled: every live store delivers everywhere. What is left is a
 * display value for the home-screen pill and a source for pre-filling the
 * address form, and it restricts nothing.
 */
interface LocationState {
  location: UserLocation | null;
  status: LocationStatus;
  errorCode: ErrorCode | null;
  errorMessage: string | null;

  requestLocation: (opts?: { force?: boolean }) => Promise<void>;
  /** Type a postcode instead of detecting one. Nothing is checked against it. */
  setManualPostcode: (postcode: string, city?: string) => void;
  setFromAddress: (addr: { postcode: string; city: string; street_line_1?: string }) => void;
  clear: () => void;
}

const GOOGLE_KEY: string = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY as string | undefined) ?? '';

export const useLocationStore = create<LocationState>()(
  persist(
    (set, get) => ({
      location: null,
      status: 'idle',
      errorCode: null,
      errorMessage: null,

      async requestLocation({ force = false } = {}) {
        const state = get();
        if (!force && state.location && state.location.source !== 'default') return;
        if (state.status === 'requesting') return;

        set({ status: 'requesting', errorCode: null, errorMessage: null });

        let coords: Coords;
        try {
          coords = await getDeviceCoords();
        } catch (err) {
          if (err instanceof MobileGeolocationError) {
            set({
              status:
                err.code === 'permission_denied'
                  ? 'denied'
                  : err.code === 'services_disabled'
                    ? 'unavailable'
                    : 'unavailable',
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

      setManualPostcode(postcode, city) {
        const next: UserLocation = {
          city: city ?? 'Madrid',
          postcode,
          source: 'manual',
          detected_at: new Date().toISOString(),
        };
        set({ location: next, status: 'granted', errorCode: null, errorMessage: null });
      },

      setFromAddress(addr) {
        const next: UserLocation = {
          city: addr.city,
          postcode: addr.postcode,
          formatted: addr.street_line_1
            ? `${addr.street_line_1}, ${addr.postcode} ${addr.city}`
            : undefined,
          source: 'manual',
          detected_at: new Date().toISOString(),
        };
        set({ location: next, status: 'granted', errorCode: null, errorMessage: null });
      },

      clear() {
        set({
          location: null,
          status: 'idle',
          errorCode: null,
          errorMessage: null,
        });
      },
    }),
    {
      name: 'cesto-location-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ location: s.location }),
    },
  ),
);
