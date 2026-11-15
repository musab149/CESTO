// ─── Server-side forward geocoding ─────────────────────────
//
// Turns a written address into coordinates, so delivery can be priced by
// distance. Used in two places: a customer address on save (and lazily at
// quote time for addresses that predate this), and the platform delivery
// origin from the admin Settings page.
//
// Deliberately NOT imported from @grocery-app/shared. That package's barrel
// re-exports a .tsx component, which ts-node-dev in this package blows up on
// at runtime — so the API keeps its own copy. The shared one is also the
// wrong direction anyway: it reverse-geocodes coords → address for the
// browser's "Use my location" pill, and runs on a browser-restricted key.
//
// This needs its own server key, GOOGLE_MAPS_KEY, restricted by IP rather
// than by HTTP referrer. Without it every function here returns null and
// callers fall back to the flat delivery fee — an unset key must never take
// checkout down, only make it price the old way.

/** Timeout for a single Google call. */
const TIMEOUT_MS = 3_000;

export interface GeocodedPoint {
  lat: number;
  lng: number;
  /**
   * Google's `location_type` for the match: ROOFTOP, RANGE_INTERPOLATED,
   * GEOMETRIC_CENTER or APPROXIMATE. Stored nowhere — callers log it or use
   * it to decide whether a result is worth trusting. An APPROXIMATE hit is
   * usually the centre of a town, which is still fine for a band ladder
   * measured in kilometres.
   */
  precision: string;
  /** Google's normalised one-line rendering of what it matched. */
  formatted: string;
}

interface GoogleGeocodeResponse {
  status: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
    geometry?: {
      location?: { lat?: number; lng?: number };
      location_type?: string;
    };
  }>;
}

/** True when the server has a key and geocoding can be attempted at all. */
export function geocodingConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_KEY?.trim();
}

/**
 * Resolve a one-line address to coordinates.
 *
 * Returns null for every failure — no key, network error, HTTP error, a
 * status Google does not like, or a result with no usable position. Callers
 * treat null as "price this the flat way", so a geocoder outage degrades
 * pricing instead of blocking a save or a checkout.
 */
export async function geocodeAddress(
  query: string,
  opts: { region?: string } = {},
): Promise<GeocodedPoint | null> {
  const key = process.env.GOOGLE_MAPS_KEY?.trim();
  if (!key || !query.trim()) return null;

  // `region` biases ambiguous names to a country — "Toledo" resolves to the
  // Spanish one rather than Ohio. It is a bias, not a filter.
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json' +
    `?address=${encodeURIComponent(query.trim())}` +
    `&region=${opts.region ?? 'es'}` +
    '&language=es' +
    `&key=${encodeURIComponent(key)}`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    // Network failure or the 3s timeout firing. Nothing to distinguish here:
    // both mean "no coordinates this time".
    return null;
  }

  if (!res.ok) return null;

  let data: GoogleGeocodeResponse;
  try {
    data = (await res.json()) as GoogleGeocodeResponse;
  } catch {
    return null;
  }

  // ZERO_RESULTS is an ordinary outcome for a typo'd or invented street, not
  // an incident. OVER_QUERY_LIMIT / REQUEST_DENIED are worth seeing in the
  // logs because they mean the key itself is wrong or exhausted.
  if (data.status !== 'OK') {
    if (data.status !== 'ZERO_RESULTS') {
      console.warn(
        `[geocode] Google returned ${data.status}${
          data.error_message ? `: ${data.error_message}` : ''
        }`,
      );
    }
    return null;
  }

  const best = data.results?.[0];
  const lat = best?.geometry?.location?.lat;
  const lng = best?.geometry?.location?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  return {
    lat,
    lng,
    precision: best?.geometry?.location_type ?? 'UNKNOWN',
    formatted: best?.formatted_address ?? query.trim(),
  };
}

/**
 * Build the query string for a saved customer address.
 *
 * Street line 2 is left out on purpose — it holds "3º B", "Escalera
 * izquierda" and similar, which is precise for a rider and pure noise for a
 * geocoder. Country is appended because the postcode alone is ambiguous
 * worldwide.
 */
export function addressToQuery(a: {
  street_line_1: string;
  postcode: string;
  city: string;
  province?: string | null;
}): string {
  return [a.street_line_1, a.postcode, a.city, a.province, 'España']
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(', ');
}
