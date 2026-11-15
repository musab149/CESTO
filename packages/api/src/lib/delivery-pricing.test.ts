import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import {
  normaliseBands,
  haversineKm,
  bandForDistance,
  bandLabel,
  resolveDeliveryFee,
  type DeliveryBand,
  type DeliveryPricing,
} from './delivery-pricing';
import { settingsSchema } from '../routes/admin/settings';

// Zero-dep test file, same shape as parentOrder.test.ts. Run with:
//
//   cd packages/api && npx ts-node src/lib/delivery-pricing.test.ts
//
// This one earns its keep more than most: it is the only thing standing
// between a malformed settings blob and every customer being charged the
// wrong delivery fee. The fallback cases matter as much as the happy path —
// a half-configured ladder must land on the flat fee, never on €0.

type Case = { name: string; run: () => void };
const cases: Case[] = [];
function test(name: string, run: () => void): void { cases.push({ name, run }); }

const D = (n: number) => new Prisma.Decimal(n);
const band = (upToKm: number | null, fee: number): DeliveryBand => ({ upToKm, fee });

/** A fully configured distance setup, unless a test overrides part of it. */
const pricing = (over: Partial<DeliveryPricing> = {}): DeliveryPricing => ({
  mode: 'distance',
  fee: D(3.5),
  origin: { lat: 40.4168, lng: -3.7038 }, // Puerta del Sol, Madrid
  bands: [band(5, 2.5), band(20, 4.5), band(null, 8)],
  ...over,
});

// ─── normaliseBands ────────────────────────────────────────

test('normaliseBands sorts ascending and puts the open band last', () => {
  const out = normaliseBands([
    { upToKm: null, fee: 8 },
    { upToKm: 20, fee: 4.5 },
    { upToKm: 5, fee: 2.5 },
  ]);
  assert.deepEqual(out.map((b) => b.upToKm), [5, 20, null]);
  assert.deepEqual(out.map((b) => b.fee), [2.5, 4.5, 8]);
});

test('normaliseBands promotes the farthest band when none is open-ended', () => {
  // Without this, a delivery past the last rung would fall through to the
  // flat fee — which is usually CHEAPER, so living further away would cost
  // less. The catch-all has to exist.
  const out = normaliseBands([{ upToKm: 5, fee: 2.5 }, { upToKm: 20, fee: 4.5 }]);
  assert.deepEqual(out.map((b) => b.upToKm), [5, null]);
  assert.equal(out[1].fee, 4.5);
});

test('normaliseBands keeps only the first open band', () => {
  const out = normaliseBands([
    { upToKm: null, fee: 8 },
    { upToKm: null, fee: 99 },
    { upToKm: 5, fee: 2.5 },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out.filter((b) => b.upToKm === null).length, 1);
  assert.equal(out[1].fee, 8);
});

test('normaliseBands drops rows with no usable fee', () => {
  const out = normaliseBands([
    { upToKm: 5 },                    // no fee at all
    { upToKm: 10, fee: 'abc' },       // unparseable
    { upToKm: 20, fee: '4.50' },      // numeric string is fine
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].fee, 4.5);
});

test('normaliseBands distinguishes a blank threshold from a zero one', () => {
  // Thresholds were removed on 2026-09-25. A stored band may still carry
  // `freeFrom` from before that; it has to be dropped, not carried through.
  const out = normaliseBands([
    { upToKm: 5, fee: 2.5, freeFrom: '' },
    { upToKm: 10, fee: 3, freeFrom: 0 },
    { upToKm: null, fee: 8 },
  ]);
  assert.deepEqual(out, [
    { upToKm: 5, fee: 2.5 },
    { upToKm: 10, fee: 3 },
    { upToKm: null, fee: 8 },
  ]);
});

test('normaliseBands survives junk instead of an array', () => {
  for (const junk of [null, undefined, 'nope', 42, {}]) {
    assert.deepEqual(normaliseBands(junk), []);
  }
});

// ─── haversineKm ───────────────────────────────────────────

test('haversineKm matches known distances within 1%', () => {
  const madrid = { lat: 40.4168, lng: -3.7038 };
  const barcelona = { lat: 41.3874, lng: 2.1686 };
  // Great-circle Madrid–Barcelona is ~504 km.
  const km = haversineKm(madrid, barcelona);
  assert.ok(Math.abs(km - 504) < 5, `expected ~504 km, got ${km.toFixed(1)}`);
});

test('haversineKm handles negative longitudes and is symmetric', () => {
  // Spain is west of Greenwich, so every real origin here has a negative
  // longitude. A sign bug would be invisible in a test that only used
  // positive coordinates.
  const a = { lat: 40.4168, lng: -3.7038 };
  const b = { lat: 40.4168, lng: -3.6038 };
  const km = haversineKm(a, b);
  assert.ok(km > 8 && km < 9, `expected ~8.5 km, got ${km.toFixed(2)}`);
  assert.equal(haversineKm(a, b).toFixed(6), haversineKm(b, a).toFixed(6));
});

test('haversineKm is zero for the same point', () => {
  const p = { lat: 40.4168, lng: -3.7038 };
  assert.equal(haversineKm(p, p), 0);
});

// ─── bandForDistance ───────────────────────────────────────

test('bandForDistance picks the first rung that clears the distance', () => {
  const bands = normaliseBands([band(5, 2.5), band(20, 4.5), band(null, 8)]);
  assert.equal(bandForDistance(0, bands)!.fee, 2.5);
  assert.equal(bandForDistance(4.9, bands)!.fee, 2.5);
  assert.equal(bandForDistance(5, bands)!.fee, 2.5);   // inclusive upper edge
  assert.equal(bandForDistance(5.1, bands)!.fee, 4.5);
  assert.equal(bandForDistance(20, bands)!.fee, 4.5);
  assert.equal(bandForDistance(20.1, bands)!.fee, 8);
  assert.equal(bandForDistance(9999, bands)!.fee, 8);  // nothing falls off
});

test('bandLabel reads correctly at each rung', () => {
  const bands = normaliseBands([band(5, 2.5), band(20, 4.5), band(null, 8)]);
  assert.equal(bandLabel(bands[0], bands), 'Hasta 5 km');
  assert.equal(bandLabel(bands[1], bands), '5–20 km');
  assert.equal(bandLabel(bands[2], bands), 'Más de 20 km');
});

// ─── resolveDeliveryFee: distance mode ─────────────────────

test('prices a nearby address from the first band', () => {
  // ~1.5 km from Sol.
  const q = resolveDeliveryFee({
    subtotal: D(20),
    pricing: pricing(),
    destination: { lat: 40.4300, lng: -3.7038 },
  });
  assert.equal(q.reason, 'banded');
  assert.equal(q.mode, 'distance');
  assert.equal(q.fee.toString(), '2.5');
  assert.equal(q.bandLabel, 'Hasta 5 km');
  assert.ok(q.distanceKm !== null && q.distanceKm < 5);
});

test('the same order costs more from further away', () => {
  const near = resolveDeliveryFee({
    subtotal: D(20),
    pricing: pricing(),
    destination: { lat: 40.4300, lng: -3.7038 },
  });
  const far = resolveDeliveryFee({
    subtotal: D(20),
    pricing: pricing(),
    destination: { lat: 41.3874, lng: 2.1686 }, // Barcelona
  });
  assert.ok(far.fee.gt(near.fee), 'a further delivery must not be cheaper');
  assert.equal(far.fee.toString(), '8');
  assert.equal(far.bandLabel, 'Más de 20 km');
});

test('the band fee stands whatever the order is worth', () => {
  // Thresholds are gone: €35 and €10,000 pay the same fee in the same band.
  // Before 2026-09-25 the first of these was free.
  const small = resolveDeliveryFee({
    subtotal: D(35),
    pricing: pricing(),
    destination: { lat: 40.4300, lng: -3.7038 },       // ~1.5 km
  });
  const huge = resolveDeliveryFee({
    subtotal: D(10_000),
    pricing: pricing(),
    destination: { lat: 40.4300, lng: -3.7038 },
  });
  assert.equal(small.fee.toString(), '2.5');
  assert.equal(huge.fee.toString(), '2.5');
});

test('no order size makes the far band free either', () => {
  const q = resolveDeliveryFee({
    subtotal: D(10_000),
    pricing: pricing(),
    destination: { lat: 41.3874, lng: 2.1686 },
  });
  assert.equal(q.fee.toString(), '8');
});

test('baseFee tracks fee now that nothing discounts it', () => {
  const q = resolveDeliveryFee({
    subtotal: D(35),
    pricing: pricing(),
    destination: { lat: 40.4300, lng: -3.7038 },
  });
  assert.equal(q.fee.toString(), q.baseFee.toString());
  assert.equal(q.baseFee.toString(), '2.5');
});

// ─── resolveDeliveryFee: falling back ──────────────────────

test('flat mode ignores the ladder entirely', () => {
  const q = resolveDeliveryFee({
    subtotal: D(20),
    pricing: pricing({ mode: 'flat' }),
    destination: { lat: 41.3874, lng: 2.1686 },
  });
  assert.equal(q.reason, 'flat_mode');
  assert.equal(q.fee.toString(), '3.5');
  assert.equal(q.distanceKm, null);
});

test('distance mode with no origin falls back to the flat fee', () => {
  const q = resolveDeliveryFee({
    subtotal: D(20),
    pricing: pricing({ origin: null }),
    destination: { lat: 40.4300, lng: -3.7038 },
  });
  assert.equal(q.reason, 'no_origin');
  assert.equal(q.fee.toString(), '3.5');
});

test('distance mode with an empty ladder falls back to the flat fee', () => {
  const q = resolveDeliveryFee({
    subtotal: D(20),
    pricing: pricing({ bands: [] }),
    destination: { lat: 40.4300, lng: -3.7038 },
  });
  assert.equal(q.reason, 'no_bands');
  assert.equal(q.fee.toString(), '3.5');
});

test('an ungeocoded address falls back to the flat fee, not to free', () => {
  // Every address that predates this feature is in exactly this state, so
  // this is the single most-travelled fallback. Charging €0 here would have
  // given free delivery to the entire existing customer base.
  const q = resolveDeliveryFee({
    subtotal: D(20),
    pricing: pricing(),
    destination: null,
  });
  assert.equal(q.reason, 'no_coords');
  assert.equal(q.fee.toString(), '3.5');
});

test('the flat fallback charges the flat fee, whatever the order is worth', () => {
  // This used to be free at €50. The flat path had its own threshold and it
  // went with the rest on 2026-09-25.
  const q = resolveDeliveryFee({
    subtotal: D(50),
    pricing: pricing(),
    destination: null,
  });
  assert.equal(q.fee.toString(), '3.5');
  assert.equal(q.baseFee.toString(), '3.5');
});

// ─── The admin write path ──────────────────────────────────
//
// These parse real payloads through the actual settings schema. They are here
// rather than alongside the route because they caught two live money bugs
// that no amount of type-checking would have: `z.coerce.number()` succeeds on
// null by turning it into 0, so in a `z.union([number, null])` the null branch
// was unreachable. That silently turned a blank free-delivery threshold
// ("never free") into 0 ("always free"), and an absent origin into 0,0 — the
// Gulf of Guinea, which would have put every Spanish address ~5,000 km out
// and therefore in the most expensive band.

/** As the admin form sends it — every scalar a string. */
const adminBase = {
  storeName: 'Cesto',
  logoUrl: '',
  contactEmail: 'a@b.com',
  contactPhone: '+34910000000',
  address: '',
  minOrderValue: 15,
  deliveryFee: 3.5,
  notificationEmails: 'a@b.com',
  privacyPolicy: '',
  termsConditions: '',
  maintenanceMode: false,
};

test('settings: an admin bundle still posting thresholds is accepted', () => {
  // Vercel and Render deploy independently, so an admin build that predates
  // the removal keeps sending these. Parsing must not reject it, or Save
  // breaks for the length of the deploy window.
  const out = settingsSchema.parse({
    ...adminBase,
    freeDeliveryMin: 30,
    deliveryPricingMode: 'distance',
    deliveryOriginAddress: 'Calle Gran Vía 1, Madrid',
    deliveryOriginLat: '40.4168',
    deliveryOriginLng: '-3.7038',
    deliveryBands: [
      { upToKm: '5', fee: '2.50', freeFrom: '30' },
      { upToKm: '', fee: '8', freeFrom: '' },
    ],
  });
  assert.equal(out.deliveryBands.length, 2);
  assert.equal(out.deliveryBands[0].fee, 2.5);
});

test('settings: a blank distance saves as the open-ended band', () => {
  const out = settingsSchema.parse({
    ...adminBase,
    deliveryPricingMode: 'distance',
    deliveryOriginAddress: 'x',
    deliveryOriginLat: '40.4',
    deliveryOriginLng: '-3.7',
    deliveryBands: [{ upToKm: '5', fee: '2.5' }, { upToKm: '', fee: '8' }],
  });
  assert.equal(out.deliveryBands[1].upToKm, null);
});

test("settings: Spain's negative longitude survives", () => {
  const out = settingsSchema.parse({
    ...adminBase,
    deliveryPricingMode: 'flat',
    deliveryOriginAddress: '',
    deliveryOriginLat: '40.4168',
    deliveryOriginLng: '-3.7038',
    deliveryBands: [],
  });
  assert.equal(out.deliveryOriginLng, -3.7038);
});

test('settings: an old admin bundle omitting the new keys leaves no origin', () => {
  // Not 0,0. See the note above.
  const out = settingsSchema.parse(adminBase);
  assert.equal(out.deliveryPricingMode, 'flat');
  assert.equal(out.deliveryOriginLat, null);
  assert.equal(out.deliveryOriginLng, null);
  assert.deepEqual(out.deliveryBands, []);
});

test('settings: a posted threshold never reaches the parsed band', () => {
  const out = settingsSchema.parse({
    ...adminBase,
    deliveryPricingMode: 'flat',
    deliveryOriginAddress: '',
    deliveryOriginLat: null,
    deliveryOriginLng: null,
    deliveryBands: [{ upToKm: 5, fee: 2, freeFrom: 0 }],
  });
  assert.equal((out.deliveryBands[0] as Record<string, unknown>).freeFrom, undefined);
});

// ─── Wholesale delivery is not priced here ─────────────────
//
// Added 2026-10-10. Note the header above: "a half-configured ladder must
// land on the flat fee, NEVER on €0". That still holds — €0 from a broken
// configuration is a bug, and these cases are the one place €0 is correct.
// The two are told apart by `reason`, which is why it exists.
//
// A b2b drop is a pallet on a route, not a consumer parcel, and no band
// ladder describes what it costs. The storefront charges nothing at checkout
// and the OFFICE adds the real fee afterwards, which recomputes the total.
//
// So the zero below is "not decided yet", not "free" — the distinction the
// screens turn on, via deliveryFeeIsPending(). Naming it here too, because a
// test that reads "pays no delivery" is how the policy gets misremembered.

test('b2b: nothing is charged at checkout in flat mode', () => {
  const q = resolveDeliveryFee({
    subtotal: D(24), pricing: pricing({ mode: 'flat' }), destination: null,
    buyerIsBusiness: true,
  });
  assert.equal(q.fee.toString(), '0');
  assert.equal(q.reason, 'b2b');
});

test('b2b: the exemption outranks a fully configured distance ladder', () => {
  // 10km from the Madrid origin — a retail customer lands in the 20km band.
  const nearby = { lat: 40.5, lng: -3.7038 };
  const retail = resolveDeliveryFee({ subtotal: D(24), pricing: pricing(), destination: nearby });
  assert.equal(retail.fee.toString(), '4.5', 'the retail case must still be priced by band');

  const trade = resolveDeliveryFee({
    subtotal: D(24), pricing: pricing(), destination: nearby, buyerIsBusiness: true,
  });
  assert.equal(trade.fee.toString(), '0');
  assert.equal(trade.reason, 'b2b');
});

test('b2b: and holds far outside every band, where retail pays the top one', () => {
  // Bizkaia — roughly 320km out, past the open-ended band. Two of the real
  // wholesale accounts are up there, which is what makes this the case worth
  // writing down.
  const faraway = { lat: 43.1667, lng: -2.6333 };
  assert.equal(
    resolveDeliveryFee({ subtotal: D(24), pricing: pricing(), destination: faraway }).fee.toString(),
    '8', 'retail should be on the open-ended band');
  assert.equal(
    resolveDeliveryFee({ subtotal: D(24), pricing: pricing(), destination: faraway, buyerIsBusiness: true }).fee.toString(),
    '0');
});

test('b2b: baseFee still says what was waived', () => {
  // So a screen can show "delivery €3.50 — waived" rather than pretending
  // there was never a charge.
  const q = resolveDeliveryFee({
    subtotal: D(24), pricing: pricing({ mode: 'flat', fee: D(3.5) }), destination: null,
    buyerIsBusiness: true,
  });
  assert.equal(q.baseFee.toString(), '3.5');
  assert.equal(q.fee.toString(), '0');
});

test('b2b: a retail buyer is untouched by any of it', () => {
  for (const flag of [false, undefined]) {
    const q = resolveDeliveryFee({
      subtotal: D(24), pricing: pricing({ mode: 'flat' }), destination: null,
      buyerIsBusiness: flag,
    });
    assert.equal(q.fee.toString(), '3.5', `flag=${String(flag)} must still pay`);
    assert.equal(q.reason, 'flat_mode');
  }
});

// ─── Runner ────────────────────────────────────────────────

let failures = 0;
for (const { name, run } of cases) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    console.error(`  FAIL ${name}\n      ${msg.replace(/\n/g, '\n      ')}`);
  }
}
console.log(`\n${cases.length - failures}/${cases.length} passed`);
if (failures > 0) process.exit(1);
