import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { normaliseBands } from '../../lib/delivery-pricing';
import { geocodeAddress, geocodingConfigured } from '../../lib/geocode';

const router = Router();

// The Settings page persists every field into one JSON blob under key
// "store". Adding a new field is a code change (schema + frontend), not a
// migration — mirrors the HomeSection pattern already in use.
const SETTINGS_KEY = 'store';

/**
 * A number that is allowed to be genuinely absent.
 *
 * Blank must survive as null. `z.coerce.number()` turns '' — and null, and
 * undefined — into 0, and 0 means something completely different from blank
 * in both places this is used:
 *
 *   · a blank free-delivery threshold means "never free at this distance";
 *     as 0 it means "free on every order, including an empty basket"
 *   · a blank origin coordinate means "no origin set, price flat"; as 0 it
 *     means the Gulf of Guinea, putting every Spanish address ~5,000 km away
 *     and therefore in the most expensive band
 *
 * `.nullable()` rather than `z.union([number, null])`: a union takes the
 * first branch that succeeds, and the coercing number branch SUCCEEDS on
 * null by turning it into 0, so the null branch was never reached. Both bugs
 * above were live until a parse of a real payload showed them.
 * `ZodNullable` intercepts null before the coercion can see it.
 */
const nullableNumber = (max: number) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : v),
    z.coerce.number().nonnegative().max(max).nullable(),
  );

/**
 * Same, but signed — a coordinate is not a money amount. Spain sits at a
 * positive latitude and a mostly NEGATIVE longitude (Madrid is -3.70), so
 * running these through the non-negative helper above would reject the
 * origin for the country this app delivers in.
 */
const nullableCoord = (limit: number) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : v),
    z.coerce.number().min(-limit).max(limit).nullable(),
  );

/**
 * One rung of the distance ladder. `upToKm: null` is the open-ended final
 * band. Order and duplicate-open-band repair happen in normaliseBands below —
 * validation only checks that each row is individually sane.
 */
const bandSchema = z.object({
  // `.nullable()` for the same reason as the helpers above — a blank here is
  // the open-ended final rung, and coercing it to 0 would instead produce a
  // band covering "up to 0 km", which nothing can ever fall into.
  upToKm:   z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : v),
    z.coerce.number().positive().max(10000).nullable(),
  ),
  fee:      z.coerce.number().nonnegative().max(100000),
  /**
   * Free-delivery thresholds were removed on 2026-09-25. Still ACCEPTED, and
   * discarded rather than stored: Vercel and Render deploy independently, so
   * an admin bundle that predates the removal will keep posting this key for
   * a while, and rejecting it would break Save on the settings page during
   * that window. Delete once nothing sends it.
   */
  freeFrom: nullableNumber(100000).optional(),
})
  // Dropped here rather than downstream: accepting the key keeps an older
  // admin bundle working, but letting it through would leave a threshold on
  // the parsed object for anything else to pick back up.
  .transform(({ upToKm, fee }) => ({ upToKm, fee }));

export const settingsSchema = z.object({
  storeName:          z.string().trim().min(1).max(200),
  logoUrl:            z.string().trim().max(2000).default(''),
  contactEmail:       z.string().trim().email().max(200),
  contactPhone:       z.string().trim().max(50),
  address:            z.string().trim().max(500),
  /** Coerced to number by zod so the frontend can send a string or number. */
  minOrderValue:      z.coerce.number().nonnegative().max(100000),
  /**
   * Flat delivery fee charged on every order, and the subtotal at which it
   * is waived. These used to live per-zone on `delivery_zones`, which meant
   * whichever zone an address happened to match decided what the customer
   * paid. With coverage removed there is one fee for the whole platform.
   *
   * Here rather than in a column because the surrounding blob is already
   * the home for order rules, so adding a field stays a code change instead
   * of a migration.
   */
  deliveryFee:        z.coerce.number().nonnegative().max(100000),
  /** Removed 2026-09-25 — accepted and discarded, see `freeFrom` above. */
  freeDeliveryMin:    z.coerce.number().nonnegative().max(100000).optional(),
  /**
   * Distance-based delivery. `flat` keeps the two numbers above as the only
   * pricing; `distance` prices from `deliveryBands` by how far the delivery
   * address is from the origin below, and falls back to the two numbers
   * above whenever that cannot be worked out (no origin, empty ladder, or an
   * address that has never been geocoded).
   *
   * Defaults to `flat`, so this shipping does not change any existing
   * price — distance pricing starts when an admin turns it on.
   */
  deliveryPricingMode:   z.enum(['flat', 'distance']).default('flat'),
  /**
   * Where deliveries set out from. Written as text by the admin and resolved
   * to coordinates by POST /settings/geocode, which is also what the "Locate"
   * button on the Settings page calls. Coordinates are what pricing reads;
   * the text is kept so the page can show what was geocoded and so a later
   * re-geocode has something to re-run.
   */
  deliveryOriginAddress: z.string().trim().max(500).default(''),
  deliveryOriginLat:     nullableCoord(90),
  deliveryOriginLng:     nullableCoord(180),
  deliveryBands:         z.array(bandSchema).max(20).default([]),
  /** Comma-separated list of admin notification recipients. Validated at the field level. */
  notificationEmails: z.string().trim().min(1).max(2000),
  privacyPolicy:      z.string().max(20000).default(''),
  termsConditions:    z.string().max(20000).default(''),
  maintenanceMode:    z.boolean().default(false),
});

export type StoreSettings = z.infer<typeof settingsSchema>;

const DEFAULT_SETTINGS: StoreSettings = {
  storeName: 'Cesto',
  logoUrl: '',
  contactEmail: 'hola@cestoshop.com',
  contactPhone: '+34 000 000 000',
  address: '',
  minOrderValue: 15,
  // Carried over from the old DeliveryZone column defaults so behaviour is
  // unchanged for anyone who never opens the Settings page.
  deliveryFee: 3.5,
  // Distance pricing ships switched off and unconfigured. An admin turns it
  // on deliberately, after setting an origin and a ladder — until then the
  // two numbers above are the whole of delivery pricing, unchanged.
  deliveryPricingMode: 'flat',
  deliveryOriginAddress: '',
  deliveryOriginLat: null,
  deliveryOriginLng: null,
  deliveryBands: [],
  notificationEmails: 'admin@cestoshop.com',
  privacyPolicy: '',
  termsConditions: '',
  maintenanceMode: false,
};

// ─── GET /api/admin/settings ────────────────────────────
// Returns the current settings blob. Lazily creates a defaults row on
// the first read so the admin sees sensible values instead of nulls
// immediately after a fresh DB.
router.get('/', asyncHandler(async (_req, res) => {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row) {
    await prisma.appSetting.create({
      data: {
        key: SETTINGS_KEY,
        config: DEFAULT_SETTINGS as unknown as Prisma.InputJsonValue,
      },
    });
    return success(res, DEFAULT_SETTINGS);
  }
  // Merge with defaults so a config that predates a newly-added field
  // still returns something for the frontend to render.
  const stored = row.config as unknown as Partial<StoreSettings>;
  return success(res, { ...DEFAULT_SETTINGS, ...stored });
}));

// ─── PUT /api/admin/settings ────────────────────────────
router.put('/', validate(settingsSchema), asyncHandler(async (req, res) => {
  const body = req.body as StoreSettings;

  // Store the ladder sorted, with exactly one open-ended band last. Doing it
  // on the way in means the admin sees the same order back after a save that
  // pricing will read, instead of the two drifting apart.
  // `freeDeliveryMin` and each band's `freeFrom` are accepted above for the
  // deploy window but never persisted, so the stored blob stops carrying a
  // threshold the moment anything saves.
  const { freeDeliveryMin: _dropped, ...rest } = body;
  const normalised: StoreSettings = {
    ...rest,
    deliveryBands: normaliseBands(body.deliveryBands).map(
      ({ upToKm, fee }) => ({ upToKm, fee }),
    ) as StoreSettings['deliveryBands'],
  };

  // Turning distance pricing on without the pieces it needs would look saved
  // while quietly charging everyone the flat fee, so it is refused here
  // rather than debugged later from an order that was priced wrong.
  if (normalised.deliveryPricingMode === 'distance') {
    if (normalised.deliveryOriginLat === null || normalised.deliveryOriginLng === null) {
      return error(res, 'Set a delivery origin before switching on distance pricing.', 422);
    }
    if (normalised.deliveryBands.length === 0) {
      return error(res, 'Add at least one distance band before switching on distance pricing.', 422);
    }
  }

  const saved = await prisma.appSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: {
      key: SETTINGS_KEY,
      config: normalised as unknown as Prisma.InputJsonValue,
    },
    update: {
      config: normalised as unknown as Prisma.InputJsonValue,
    },
  });
  return success(res, saved.config);
}));

// ─── POST /api/admin/settings/geocode ───────────────────
// Resolves the delivery-origin address to coordinates. Server-side because
// the geocoding key is an IP-restricted server key — the admin panel has no
// Google key of its own, and giving it one would mean a second, weaker
// referrer-restricted key in a browser bundle.
//
// It only returns the coordinates. Saving them is the ordinary PUT above, so
// an admin can see what was found and reject it before it prices anything.

const geocodeSchema = z.object({
  address: z.string().trim().min(3).max(500),
});

router.post('/geocode', validate(geocodeSchema), asyncHandler(async (req, res) => {
  if (!geocodingConfigured()) {
    return error(res, 'Geocoding is not configured on the server (GOOGLE_MAPS_KEY).', 503);
  }

  const point = await geocodeAddress(req.body.address as string);
  if (!point) {
    return error(res, 'Could not find that address. Try adding the city and postcode.', 422);
  }

  return success(res, point);
}));

export default router;
