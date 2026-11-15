import type { Coords, UserLocation } from './types';

/**
 * Result of reverse-geocoding coords to a Spanish postal address.
 * Callers reshape this into a UserLocation via buildUserLocation().
 */
export interface ReverseGeocodeResult {
  city: string;
  postcode: string;
  province?: string;
  country?: string;
  formatted: string;
}

interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GoogleGeocodeResult {
  formatted_address: string;
  address_components: GoogleAddressComponent[];
}

interface GoogleGeocodeResponse {
  status: string;
  results: GoogleGeocodeResult[];
  error_message?: string;
}

export class GeocodeError extends Error {
  code: 'NO_KEY' | 'NO_RESULT' | 'NETWORK' | 'API_ERROR';
  constructor(message: string, code: 'NO_KEY' | 'NO_RESULT' | 'NETWORK' | 'API_ERROR') {
    super(message);
    this.name = 'GeocodeError';
    this.code = code;
  }
}

const pickComponent = (
  components: GoogleAddressComponent[],
  ...types: string[]
): GoogleAddressComponent | undefined =>
  components.find((c) => types.some((t) => c.types.includes(t)));

/**
 * Reverse-geocode coordinates to a structured address using Google
 * Maps Geocoding API. Requires the caller to supply an API key
 * (VITE_GOOGLE_MAPS_KEY on web, EXPO_PUBLIC_GOOGLE_MAPS_KEY on mobile).
 */
export async function reverseGeocode(
  coords: Coords,
  apiKey: string,
  opts: { language?: 'en' | 'es' } = {},
): Promise<ReverseGeocodeResult> {
  if (!apiKey) {
    throw new GeocodeError('Missing Google Maps API key', 'NO_KEY');
  }

  const lang = opts.language ?? 'es';
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json' +
    `?latlng=${coords.lat},${coords.lng}` +
    `&language=${lang}` +
    `&result_type=street_address|premise|postal_code|route|locality` +
    `&key=${encodeURIComponent(apiKey)}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new GeocodeError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
      'NETWORK',
    );
  }

  if (!res.ok) {
    throw new GeocodeError(`HTTP ${res.status}`, 'API_ERROR');
  }

  const data = (await res.json()) as GoogleGeocodeResponse;

  if (data.status !== 'OK') {
    if (data.status === 'ZERO_RESULTS') {
      throw new GeocodeError('No address for these coordinates', 'NO_RESULT');
    }
    throw new GeocodeError(
      data.error_message ?? `Google API status: ${data.status}`,
      'API_ERROR',
    );
  }

  const best = data.results[0];
  if (!best) {
    throw new GeocodeError('Empty results from geocoder', 'NO_RESULT');
  }

  const components = best.address_components;
  const postcode = pickComponent(components, 'postal_code')?.long_name ?? '';
  const city =
    pickComponent(components, 'locality')?.long_name ??
    pickComponent(components, 'administrative_area_level_2')?.long_name ??
    pickComponent(components, 'administrative_area_level_1')?.long_name ??
    '';
  const province = pickComponent(components, 'administrative_area_level_2')?.long_name;
  const country = pickComponent(components, 'country')?.long_name;

  return {
    city,
    postcode,
    province,
    country,
    formatted: best.formatted_address,
  };
}

/**
 * Fold a geocode result into a UserLocation.
 *
 * Took a zone-serviceability argument until coverage was removed. There is
 * nothing to check a detected position against any more — every live store
 * delivers everywhere — so this is now a pure reshape of the geocoder result.
 */
export function buildUserLocation(
  coords: Coords,
  geo: ReverseGeocodeResult,
  source: UserLocation['source'],
): UserLocation {
  return {
    coords,
    city: geo.city,
    postcode: geo.postcode,
    formatted: geo.formatted,
    source,
    detected_at: new Date().toISOString(),
  };
}
