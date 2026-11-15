// ─── Delivery pricing ──────────────────────────────────────
//
// What a customer pays to have an order brought to them, read from the
// AppSetting["store"] blob that backs the admin Settings page.
//
// There are two modes and the admin picks one:
//
//   flat      One fee for every order, waived above one subtotal. This is
//             what replaced per-zone pricing and it stays the default, so a
//             database that has never seen the Settings page prices exactly
//             as it did before.
//
//   distance  A ladder of bands measured in kilometres from one platform
//             origin to the delivery address. Each band carries its own fee
//             and its own free-delivery threshold, so a €30 order 40 km out
//             is not shipped at a loss to honour a threshold written for
//             the neighbourhood.
//
// Distance mode is NOT the zone system returning. A zone was an admin-typed
// list of postcodes that decided both the price and whether the customer
// could order at all; a band is a measured distance that only ever moves the
// price along a ladder. Nothing is ever refused — the last band is
// open-ended, so an address 300 km away is priced, not rejected.
//
// Every distance-mode input can be missing: the origin may be unset, the
// band list empty, the customer's address ungeocoded. Each of those falls
// back to the flat fee rather than throwing, because a half-configured
// settings row must degrade the price, never take checkout down.

import { Prisma } from '@prisma/client';
import prisma from './prisma';

// ─── Config shape ──────────────────────────────────────────

export type DeliveryPricingMode = 'flat' | 'distance';

/**
 * One rung of the distance ladder.
 *
 * `upToKm: null` marks the open-ended final band — "everything beyond the
 * rung below". Exactly one band carries it and it always sorts last.
 *
 * Free-delivery thresholds were removed on 2026-09-25 — the business does not
 * offer one, so a band is a distance and a fee and nothing else.
 */
export interface DeliveryBand {
  upToKm: number | null;
  fee: number;
}

export interface DeliveryPricing {
  mode: DeliveryPricingMode;
  /** Flat fee, and the fallback whenever distance pricing cannot be applied. */
  fee: Prisma.Decimal;
  origin: { lat: number; lng: number } | null;
  bands: DeliveryBand[];
}

/**
 * Defaults are the old DeliveryZone column defaults, so a database whose
 * settings row predates any of these fields prices exactly as it always has.
 * `flat` is the default mode for the same reason — distance pricing only
 * starts when an admin turns it on and configures it.
 */
const DEFAULT_FEE = 3.5;

// ─── Parsing ───────────────────────────────────────────────

/**
 * Coerce a JSON value to a non-negative number.
 *
 * The blob is untyped JSON that an older deploy may have written without
 * these keys, so anything unparseable falls back rather than throwing.
 */
function toNumber(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function toDecimal(raw: unknown, fallback: number): Prisma.Decimal {
  return new Prisma.Decimal(toNumber(raw, fallback));
}

/** A finite coordinate, or null. Rejects the 0/0 that an empty form submits. */
function toCoord(raw: unknown, limit: number): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
  return n;
}

/**
 * Sort a band list into the shape the rest of this file assumes: ascending
 * by distance, with exactly one open-ended band last.
 *
 * Tolerant on purpose. It runs on the read path too, where the input is
 * whatever JSON is in the database — possibly written by an older deploy,
 * possibly hand-edited. Rather than reject a malformed ladder mid-checkout
 * it repairs what it can:
 *
 *   · rows that are not objects, or have no usable fee, are dropped
 *   · several open-ended bands keep the first and the rest are dropped
 *   · no open-ended band at all promotes the farthest one, so the ladder
 *     always covers every distance and no order falls off the end
 *
 * Exported because the admin write path normalises with exactly these rules
 * before saving, so what an admin sees after a save is what pricing reads.
 */
export function normaliseBands(raw: unknown): DeliveryBand[] {
  if (!Array.isArray(raw)) return [];

  const parsed: DeliveryBand[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;

    const fee = toNumber(r.fee, NaN);
    if (!Number.isFinite(fee)) continue;

    const upToRaw = r.upToKm;
    const upTo =
      upToRaw === null || upToRaw === undefined || upToRaw === ''
        ? null
        : toNumber(upToRaw, NaN);
    if (upTo !== null && (!Number.isFinite(upTo) || upTo <= 0)) continue;

    // A stored band may still carry `freeFrom` from before thresholds were
    // removed. It is read and dropped rather than mapped, so an old settings
    // blob keeps loading instead of failing on an unexpected shape.
    parsed.push({ upToKm: upTo, fee });
  }

  if (parsed.length === 0) return [];

  const finite = parsed
    .filter((b) => b.upToKm !== null)
    .sort((a, b) => (a.upToKm as number) - (b.upToKm as number));
  const open = parsed.find((b) => b.upToKm === null);

  if (open) return [...finite, open];

  // No open band: the farthest rung becomes the catch-all so that a long
  // delivery is priced at the top of the ladder instead of falling through
  // to the flat fee, which would be cheaper the further away you live.
  const tail = finite.pop();
  if (!tail) return [];
  return [...finite, { ...tail, upToKm: null }];
}

/**
 * Read the platform delivery pricing.
 *
 * Pass the transaction client when called inside one, so checkout prices
 * against the same snapshot it writes the order in.
 */
export async function getDeliveryPricing(
  db: { appSetting: { findUnique: (args: unknown) => Promise<{ config: unknown } | null> } } =
    prisma as never,
): Promise<DeliveryPricing> {
  const row = await db.appSetting.findUnique({ where: { key: 'store' } });
  const cfg = (row?.config ?? {}) as Record<string, unknown>;

  const lat = toCoord(cfg.deliveryOriginLat, 90);
  const lng = toCoord(cfg.deliveryOriginLng, 180);

  return {
    mode: cfg.deliveryPricingMode === 'distance' ? 'distance' : 'flat',
    fee: toDecimal(cfg.deliveryFee, DEFAULT_FEE),
    origin: lat !== null && lng !== null ? { lat, lng } : null,
    bands: normaliseBands(cfg.deliveryBands),
  };
}

// ─── Distance ──────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Great-circle distance in kilometres.
 *
 * Straight line, not driving distance. It reads low against a real route —
 * roughly 20-30% in a city — which is a deliberate trade: it is free, it is
 * instant, it cannot fail mid-checkout, and it is stable, so the same
 * address always lands in the same band. Set the band fees against the
 * straight-line numbers you actually observe rather than against road
 * distance, and if that stops being good enough the honest upgrade is
 * Google's Distance Matrix with a cache, not a fudge factor here.
 */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The band a distance falls into, or null when the ladder is empty. */
export function bandForDistance(km: number, bands: DeliveryBand[]): DeliveryBand | null {
  // normaliseBands guarantees ascending order with the open band last, so
  // the first band whose ceiling clears the distance is the right one, and
  // the open band's null ceiling clears everything.
  return bands.find((b) => b.upToKm === null || km <= b.upToKm) ?? null;
}

/**
 * Human label for a band, for the customer's order summary and the admin
 * table. Spanish per the project default; the web layer translates.
 */
export function bandLabel(band: DeliveryBand, bands: DeliveryBand[]): string {
  const i = bands.indexOf(band);
  const floor = i > 0 ? bands[i - 1].upToKm : 0;
  if (band.upToKm === null) return `Más de ${floor ?? 0} km`;
  return floor ? `${floor}–${band.upToKm} km` : `Hasta ${band.upToKm} km`;
}

// ─── Resolution ────────────────────────────────────────────

/**
 * Why an order was priced the way it was. Surfaced on the quote so the
 * checkout screen can explain the number, and so "why was this customer
 * charged the flat fee" is answerable without reproducing their cart.
 */
export type DeliveryFeeReason =
  | 'flat_mode'    // distance pricing is switched off
  | 'no_origin'    // switched on, but no platform origin is set
  | 'no_bands'     // switched on, but the ladder is empty
  | 'no_coords'    // switched on and configured, but this address has none
  | 'banded'       // priced by distance
  | 'b2b'          // a wholesale buyer — we do not charge them delivery
  | 'set_later';   // a customer's own order: the office sets it afterwards (2026-10-23)

export interface DeliveryQuote {
  /** What the customer is charged, after any free-delivery threshold. */
  fee: Prisma.Decimal;
  /**
   * Always equal to `fee` now that thresholds are gone — it used to be the
   * price before one was applied. Kept because callers still read it, and
   * dropping a field from a live response shape is how the in-flight window
   * between the API and a frontend deploy breaks.
   */
  baseFee: Prisma.Decimal;
  mode: DeliveryPricingMode;
  reason: DeliveryFeeReason;
  /** Rounded to one decimal — the precision the ladder is written in. */
  distanceKm: number | null;
  bandLabel: string | null;
}

/**
 * Price one delivery.
 *
 * `destination` is the geocoded delivery address, or null when it has never
 * been geocoded — an address saved before distance pricing landed, one the
 * geocoder could not resolve, or any address at all while GOOGLE_MAPS_KEY is
 * unset. All three fall back to the flat fee.
 */
export function resolveDeliveryFee(args: {
  subtotal: Prisma.Decimal;
  pricing: DeliveryPricing;
  destination: { lat: number; lng: number } | null;
  /**
   * Is the buyer a wholesale account? Taken from the stored `is_business`,
   * never from anything the client sends — the same rule the item prices
   * already follow.
   */
  buyerIsBusiness?: boolean;
}): DeliveryQuote {
  const { subtotal, pricing, destination, buyerIsBusiness } = args;

  const flat = (reason: DeliveryFeeReason): DeliveryQuote => ({
    fee: pricing.fee,
    baseFee: pricing.fee,
    mode: 'flat',
    reason,
    distanceKm: null,
    bandLabel: null,
  });

  /**
   * WHOLESALE DELIVERY IS NOT PRICED HERE. It is not free either.
   *
   * A b2b drop is a pallet on a route, not a consumer parcel, and no band
   * ladder describes what it costs. So the storefront charges nothing at
   * checkout and the office puts the real fee on the order afterwards
   * (PUT /api/admin/orders/:id/delivery-fee), which recomputes the total —
   * the customer sees the final figure on the same screen.
   *
   * Decided before the mode, the origin and the bands, because none of those
   * should be able to put a RETAIL fee on a trade sale whatever the platform
   * is configured to do.
   *
   * The screens must not render this zero as "Free": see
   * deliveryFeeIsPending() in the shared package, which every one of them
   * reads. Promising free delivery and then adding a charge is the failure
   * this is shaped to avoid.
   *
   * `baseFee` keeps what a retail customer would have paid. It is NOT a
   * discount anyone was given — it is only there so a screen can show what
   * the consumer rate would have been.
   */
  if (buyerIsBusiness) {
    return {
      fee: new Prisma.Decimal(0),
      baseFee: pricing.fee,
      mode: pricing.mode,
      reason: 'b2b',
      distanceKm: null,
      bandLabel: null,
    };
  }

  if (pricing.mode !== 'distance') return flat('flat_mode');
  if (!pricing.origin) return flat('no_origin');
  if (pricing.bands.length === 0) return flat('no_bands');
  if (!destination) return flat('no_coords');

  const km = haversineKm(pricing.origin, destination);
  const band = bandForDistance(km, pricing.bands);
  if (!band) return flat('no_bands');

  const baseFee = new Prisma.Decimal(band.fee);

  return {
    fee: baseFee,
    baseFee,
    mode: 'distance',
    reason: 'banded',
    distanceKm: Math.round(km * 10) / 10,
    bandLabel: bandLabel(band, pricing.bands),
  };
}
