import { Router } from 'express';
import prisma from '../lib/prisma';
import { success } from '../lib/response';
import { asyncHandler } from '../lib/async';
import { normaliseBands, type DeliveryBand } from '../lib/delivery-pricing';

const router = Router();

/**
 * Public projection of the admin AppSetting["store"] blob. Only the fields
 * a shopper actually needs on the customer site — the notification-emails
 * list stays admin-only.
 */
export interface PublicStoreSettings {
  storeName: string;
  logoUrl: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  minOrderValue: number;
  privacyPolicy: string;
  termsConditions: string;
  maintenanceMode: boolean;
  /**
   * Enough of the delivery pricing for the cart to quote a fee before an
   * address has been chosen, and for a "delivery costs from €X" line to be
   * honest about varying by distance.
   *
   * The bands are published, the ORIGIN IS NOT. Where the platform dispatches
   * from is operational detail; a shopper only needs to know the ladder they
   * are priced against. The authoritative number for a specific address is
   * still POST /api/orders/quote — this is for display before one is picked.
   */
  deliveryPricingMode: 'flat' | 'distance';
  deliveryFee: number;
  deliveryBands: DeliveryBand[];
}

const DEFAULTS: PublicStoreSettings = {
  storeName: 'Cesto',
  logoUrl: '',
  contactEmail: 'hola@cestoshop.com',
  contactPhone: '+34 000 000 000',
  address: '',
  minOrderValue: 15,
  privacyPolicy: '',
  termsConditions: '',
  maintenanceMode: false,
  deliveryPricingMode: 'flat',
  deliveryFee: 3.5,
  deliveryBands: [],
};

/** Same coercion the admin blob gets — the JSON is untyped either way. */
const num = (raw: unknown, fallback: number): number => {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// GET /api/settings — public, safe fields only.
router.get('/', asyncHandler(async (_req, res) => {
  const row = await prisma.appSetting.findUnique({ where: { key: 'store' } });
  if (!row) return success(res, DEFAULTS);
  const stored = row.config as unknown as Partial<PublicStoreSettings> & Record<string, unknown>;
  return success(res, {
    storeName:       stored.storeName       ?? DEFAULTS.storeName,
    logoUrl:         stored.logoUrl         ?? DEFAULTS.logoUrl,
    contactEmail:    stored.contactEmail    ?? DEFAULTS.contactEmail,
    contactPhone:    stored.contactPhone    ?? DEFAULTS.contactPhone,
    address:         stored.address         ?? DEFAULTS.address,
    minOrderValue:   stored.minOrderValue   ?? DEFAULTS.minOrderValue,
    privacyPolicy:   stored.privacyPolicy   ?? DEFAULTS.privacyPolicy,
    termsConditions: stored.termsConditions ?? DEFAULTS.termsConditions,
    maintenanceMode: stored.maintenanceMode ?? DEFAULTS.maintenanceMode,
    deliveryPricingMode:
      stored.deliveryPricingMode === 'distance' ? 'distance' : 'flat',
    deliveryFee:     num(stored.deliveryFee,     DEFAULTS.deliveryFee),
    deliveryBands:   normaliseBands(stored.deliveryBands),
  } satisfies PublicStoreSettings);
}));

export default router;
