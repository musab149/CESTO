import { z } from 'zod';

const trimmedString = (min: number, max: number) =>
  z.string().trim().min(min).max(max);

/**
 * What the applicant is:
 *   business      — wholesale BUYER (/b2b-deals). Approval creates a User +
 *                   BusinessProfile with b2b pricing. No store.
 *   partner_store — SELLER (/partner-deals). Approval creates a Store +
 *                   PartnerStoreRole.
 *   contact       — sales-modal enquiry, no approval path.
 *   quotation     — product quotation request from the product detail page.
 *                   No approval path, like 'contact'.
 *
 * Renamed 2026-07-27 from 'partner'/'supplier', which were inverted relative
 * to the approval logic. Migration 20260727120000_b2b_business_accounts
 * remapped stored rows.
 */
export const leadTypeEnum = z.enum(['business', 'partner_store', 'contact', 'quotation']);
export const leadStatusEnum = z.enum(['new', 'contacted', 'qualified', 'closed', 'archived']);
export const leadIntentEnum = z.enum(['supplier', 'partner', 'general']);

/**
 * A single shop location picked from Google Places on the supplier/partner
 * form. name + address are what the user sees; lat/lng keeps the pin stable
 * without re-geocoding on the admin side. place_id + parsed components are
 * best-effort — Google occasionally omits them.
 */
export const b2bShopSchema = z.object({
  name:     trimmedString(1, 120),
  address:  trimmedString(1, 300),
  // lat/lng nullable so the form still submits when Places API is
  // unavailable on the customer side (address typed manually, admin
  // verifies later).
  lat:      z.number().min(-90).max(90).nullable().optional(),
  lng:      z.number().min(-180).max(180).nullable().optional(),
  place_id: trimmedString(1, 200).nullable().optional(),
  city:     trimmedString(1, 120).nullable().optional(),
  postcode: trimmedString(1, 20).nullable().optional(),
  country:  trimmedString(1, 120).nullable().optional(),
});

/**
 * Public submission. Required fields are the four contact basics + a type +
 * a source. Application-shape fields (location, business_type, …) are
 * optional at the validator level because the contact-sales modal doesn't
 * collect them; the customer-side forms enforce their own required set
 * before submitting.
 */
export const submitLeadSchema = z.object({
  type:            leadTypeEnum,
  source:          trimmedString(1, 32),
  name:            trimmedString(1, 120),
  company:         trimmedString(1, 160),
  email:           z.string().trim().email().max(160),
  phone:           trimmedString(4, 32),
  location:        trimmedString(1, 160).nullable().optional(),
  business_type:   trimmedString(1, 80).nullable().optional(),
  website:         trimmedString(1, 240).nullable().optional(),
  registration_no: trimmedString(1, 80).nullable().optional(),
  shops:           z.array(b2bShopSchema).max(50).nullable().optional(),
  message:         z.string().trim().max(4000).nullable().optional(),
  intent:          leadIntentEnum.nullable().optional(),
  quote_product_id:   z.string().uuid().nullable().optional(),
  quote_product_name: trimmedString(1, 200).nullable().optional(),
  quote_quantity:     z.number().int().min(1).max(100000).nullable().optional(),
  language:        z.enum(['en', 'es']).nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.type !== 'quotation') return;
  if (!data.quote_product_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quote_product_id'], message: 'Required for quotation requests.' });
  }
  if (!data.quote_product_name) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quote_product_name'], message: 'Required for quotation requests.' });
  }
  if (!data.quote_quantity) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quote_quantity'], message: 'Required for quotation requests.' });
  }
});

/** Admin patch — currently only status + notes are editable. */
export const patchLeadSchema = z.object({
  status: leadStatusEnum.optional(),
  notes:  z.string().trim().max(4000).nullable().optional(),
});

export type SubmitLeadPayload = z.infer<typeof submitLeadSchema>;
export type PatchLeadPayload  = z.infer<typeof patchLeadSchema>;
