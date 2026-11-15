// ─── Lazily giving a saved address a position ──────────────
//
// Distance pricing needs the delivery address's coordinates. They are filled
// in when an address is saved, but that only covers addresses saved after
// this shipped — every address already in the database has none, and so does
// any address saved while GOOGLE_MAPS_KEY was unset or Google was down.
//
// Rather than a one-off backfill script that has to be remembered and re-run,
// addresses heal themselves: the first delivery quote for an address with no
// coordinates resolves and stores them, and every quote after that is a plain
// column read. The cost is one geocode per address, ever.

import prisma from './prisma';
import { geocodeAddress, addressToQuery } from './geocode';

/**
 * How long to leave a failed address alone.
 *
 * Without this, an address the geocoder cannot resolve — a typo'd street, a
 * new development Google has not indexed — would hit the API again on every
 * single quote, which for a customer who reloads checkout means a burst of
 * billed calls that all fail the same way. One attempt a day is enough to
 * pick up a genuine fix on Google's side.
 */
const RETRY_FAILED_AFTER_MS = 24 * 60 * 60 * 1000;

/** The address columns this needs. Matches what routes already select. */
export interface GeocodableAddress {
  id: string;
  street_line_1: string;
  postcode: string;
  city: string;
  province: string | null;
  latitude: number | null;
  longitude: number | null;
  geocode_failed_at: Date | null;
}

/**
 * Coordinates for an address, geocoding and persisting them if this is the
 * first time they have been needed.
 *
 * Returns null when there are none and none could be obtained — no key, a
 * geocoder failure, an address Google cannot place, or a recent failure still
 * inside its retry window. Callers price null as the flat fee.
 *
 * Never throws and never rejects. A geocoding problem must not fail a
 * checkout: the worst it may do is make delivery cost what it cost before
 * distance pricing existed.
 */
export async function ensureAddressCoords(
  address: GeocodableAddress,
): Promise<{ lat: number; lng: number } | null> {
  if (address.latitude !== null && address.longitude !== null) {
    return { lat: address.latitude, lng: address.longitude };
  }

  if (
    address.geocode_failed_at &&
    Date.now() - address.geocode_failed_at.getTime() < RETRY_FAILED_AFTER_MS
  ) {
    return null;
  }

  let point: Awaited<ReturnType<typeof geocodeAddress>> = null;
  try {
    point = await geocodeAddress(addressToQuery(address));
  } catch {
    // geocodeAddress swallows its own failures, so reaching here means
    // something genuinely unexpected. Still not a reason to fail checkout.
    point = null;
  }

  // Persisting is best-effort in both directions. If the write loses a race
  // with an address edit, or the row was deleted between the quote and now,
  // the price we already computed still stands — we just geocode again next
  // time. `updateMany` rather than `update` so a missing row is a no-op
  // instead of a throw.
  try {
    if (point) {
      await prisma.address.updateMany({
        where: { id: address.id },
        data: {
          latitude: point.lat,
          longitude: point.lng,
          geocoded_at: new Date(),
          geocode_failed_at: null,
        },
      });
    } else {
      await prisma.address.updateMany({
        where: { id: address.id },
        data: { geocode_failed_at: new Date() },
      });
    }
  } catch {
    /* nothing to do — pricing does not depend on the write succeeding */
  }

  return point ? { lat: point.lat, lng: point.lng } : null;
}
