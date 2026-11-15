import { Prisma } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import prisma from './prisma';
import { generateTempPassword, storefrontLoginUrl } from './credentials';
import { ACCESS_SELECT, accessOf } from './clientCredentials';
import { sendClientWelcomeEmail, resolveEmailLang, mailerDelivers } from './mailer';
import { slugifyStoreName, makeUniqueStoreSlug } from './storeSlug';

/**
 * Opening a client account on someone's behalf.
 *
 * Two callers, one implementation: staff in the admin panel
 * (POST /api/admin/users) and a sales rep in the field
 * (POST /api/sales/clients). The flow is the same because the situation is
 * the same — somebody standing in a shop, entering details for a person who
 * is not at a keyboard — and the hard parts are the ones you only get right
 * once: not clobbering an existing customer's name, hashing the one temp
 * password that also goes out by email, making only a first address the
 * default, and reporting a failed email without pretending the account does
 * not exist.
 *
 * Duplicating that for the rep route would have meant two copies of all of
 * it, drifting from the first bug fixed in only one.
 *
 * What the two callers do NOT share is their SCHEMA. A rep cannot create a
 * vendor store — that is staff work, and the field is simply absent from the
 * rep's schema rather than guarded inside this function. Validation is where
 * a permission like that belongs: unreachable input cannot be smuggled in.
 */

export const clientAddressSchema = z.object({
  label: z.string().trim().max(60).optional(),
  contact_name: z.string().trim().min(1).max(120),
  contact_phone: z.string().trim().min(1).max(20),
  street_line_1: z.string().trim().min(1).max(200),
  street_line_2: z.string().trim().max(200).optional(),
  postcode: z.string().trim().min(1).max(10),
  city: z.string().trim().min(1).max(100),
  province: z.string().trim().min(1).max(100),
  delivery_notes: z.string().trim().max(200).optional(),
});

/** The fields both callers collect. */
export const clientCoreShape = {
  name: z.string().trim().min(1).max(120),
  // Required even though User.email is nullable in general: the credentials
  // have nowhere else to go.
  email: z.string().email().transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(20).optional(),
  phone_country_code: z.string().trim().max(6).default('+34'),
  preferred_language: z.enum(['es', 'en']).default('es'),
  client_type: z.enum(['retail', 'business']),
  sales_manager_name: z.string().trim().max(120).optional(),
  business: z.object({
    company: z.string().trim().min(1).max(200),
    business_type: z.string().trim().max(120).optional(),
    location: z.string().trim().max(200).optional(),
    website: z.string().trim().max(200).optional(),
    registration_no: z.string().trim().max(60).optional(),
    contact_phone: z.string().trim().max(20).optional(),
  }).optional(),
  // Mandatory. An Order cannot exist without an address (Order.address_id is
  // NOT NULL and Address.user_id is an FK, so there is no placeholder row to
  // borrow), and the rep is standing in the shop: this is the one moment the
  // answer is easy to get.
  address: clientAddressSchema,
  send_credentials: z.boolean().default(true),
};

/** Staff only: the same client can also SELL on Cesto. */
export const clientVendorSchema = z.object({
  store_name: z.string().trim().min(2).max(120),
  tagline_es: z.string().trim().max(160).optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().trim().max(20).optional(),
  origin: z.string().trim().max(80).optional(),
});

export const requireCompanyForBusiness = {
  check: (v: { client_type: string; business?: { company?: string } }) =>
    v.client_type !== 'business' || !!v.business?.company,
  message: 'Company name is required for a business client',
  path: ['business', 'company'] as const,
};

export type CreateClientInput = {
  name: string;
  email: string;
  phone?: string;
  phone_country_code: string;
  preferred_language: 'es' | 'en';
  client_type: 'retail' | 'business';
  sales_manager_name?: string;
  business?: z.infer<NonNullable<typeof clientCoreShape.business>>;
  address: z.infer<typeof clientAddressSchema>;
  send_credentials: boolean;
  vendor?: z.infer<typeof clientVendorSchema>;
};

/**
 * Who is opening the account. Exactly one side is set — `lib/orderSource`
 * explains why there are two columns rather than one.
 */
export type ClientCreator = {
  adminId?: string | null;
  salesRepId?: string | null;
};

/** A duplicate the caller should render as 409, with the field named. */
export class ClientConflictError extends Error {
  /** For a refusal a screen has to branch on, not only display. */
  code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = 'ClientConflictError';
    this.code = code;
  }
}

/** A rep opening a client whose email is already somebody else's client. */
export const CLIENT_BELONGS_ELSEWHERE = 'client_belongs_elsewhere';

/**
 * Where an existing account stands for a rep who is about to open it as a
 * client (2026-10-26):
 *
 *   mine      — they opened it.
 *   unclaimed — nobody opened it (it signed itself up) and no other rep has
 *               served it. Opening it makes it theirs: `created_by_sales_rep_id`
 *               is set, so it is theirs and counts as opened by us.
 *   elsewhere — the office opened it, or another rep did or has served it.
 *               Refused: a rep does not take over a colleague's client on
 *               their own. They can still find it by its email and order for
 *               it, and it stays whoever's it was (lib/repClients).
 *
 * Since 2026-10-28 an order a rep built no longer makes the account theirs
 * here — ordering for somebody found by email must not hand the client over
 * (user: "this does not mean that that client will become his client"). No
 * account was theirs by an order alone when that changed.
 *
 * Before this, opening any existing email "worked" but left the account out
 * of the rep's book — their list did not show it and the order screen they
 * were sent to answered 404 — and quietly rewrote another rep's client's
 * sales manager to them.
 */
export type RepStanding = 'mine' | 'unclaimed' | 'elsewhere';

export async function repStandingOf(
  db: Prisma.TransactionClient | typeof prisma,
  user: { id: string; created_by_sales_rep_id: string | null; created_by_admin_id: string | null },
  repId: string,
): Promise<RepStanding> {
  if (user.created_by_sales_rep_id === repId) return 'mine';
  if (user.created_by_sales_rep_id || user.created_by_admin_id) return 'elsewhere';
  // Served by another rep — found by email, say, and ordered for — is theirs
  // to keep serving, not this rep's to claim. Their own orders claim nothing.
  const servedByOthers = await db.order.count({
    where: { user_id: user.id, AND: [{ created_by_sales_rep_id: { not: null } }, { created_by_sales_rep_id: { not: repId } }] },
  });
  return servedByOthers > 0 ? 'elsewhere' : 'unclaimed';
}

export type CreateClientResult = {
  userId: string;
  wasExisting: boolean;
  store: { id: string; name: string } | null;
  /** False when the rows committed but the welcome email did not go out. */
  emailSent: boolean;
  /**
   * An existing account that already had its own way in — a password the
   * person chose, or Google/Apple — which was left alone: no new password,
   * and so no credentials email. See the upgrade below.
   */
  keptPassword: boolean;
};

/** Where the credentials email tells them to go (lib/credentials). */
export { storefrontLoginUrl };

/**
 * What a third caller — Home Grocery approval — needs on top of the other two.
 * All optional, so staff and rep onboarding are unchanged.
 */
export type CreateClientExtras = {
  /**
   * Runs inside the account transaction once the user and address exist, so
   * whatever the caller records about WHY the account exists commits or rolls
   * back with it. Approval writes the subscriber profile and flips the
   * request here; doing it afterwards left a window where the account was
   * real and the request still read as pending.
   */
  inTransaction?: (tx: Prisma.TransactionClient, userId: string) => Promise<void>;
  /**
   * Refuse rather than upgrade an existing account. Staff onboarding upgrades
   * on purpose, and gives a new password only to an account without one of
   * its own (see the upgrade below). Approval must not upgrade at all: it
   * links existing accounts WITHOUT touching their password, and only reaches
   * here for an email it found no account for — an account appearing in
   * between is a race to report, not a password to overwrite.
   */
  requireNew?: boolean;
  /** Tells the welcome email the account exists because of Home Grocery. */
  homeGrocery?: boolean;
};

export async function createClient(
  body: CreateClientInput,
  creator: ClientCreator,
  extras: CreateClientExtras = {},
): Promise<CreateClientResult> {
  const adminId = creator.adminId ?? null;
  const salesRepId = creator.salesRepId ?? null;
  const isBusiness = body.client_type === 'business';

  // Reserved out here so the same string reaches the DB hashed and the email
  // in plaintext. Generating it inside the transaction would mean deriving it
  // twice, which is how those two drift apart.
  const tempPassword = generateTempPassword(12);
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  let created: { id: string; wasExisting: boolean; keptPassword: boolean; storeId: string | null; storeName: string | null };
  try {
    created = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { email: body.email },
        select: { id: true, name: true, created_by_sales_rep_id: true, created_by_admin_id: true, ...ACCESS_SELECT },
      });
      if (existing && extras.requireNew) {
        throw new ClientConflictError(
          'An account with that email was created a moment ago. Reload and approve again — it will be linked rather than replaced.',
        );
      }

      // A rep opening an existing account: theirs already, theirs from now
      // on, or somebody else's client and refused — see repStandingOf.
      const standing = existing && salesRepId ? await repStandingOf(tx, existing, salesRepId) : null;
      if (standing === 'elsewhere') {
        throw new ClientConflictError(
          'This email belongs to a client of the office or another rep. Ask the office to pass them to you.',
          CLIENT_BELONGS_ELSEWHERE,
        );
      }

      /**
       * AN EXISTING CUSTOMER KEEPS THE LOGIN THEY CHOSE (2026-10-26).
       *
       * This used to give every existing account a new temporary password. A
       * customer who had signed up and set their own was then locked out —
       * their password silently stopped working — while the screen told the
       * rep "they keep the password they have". Now only an account with
       * nothing of its own (no password, or a temporary one somebody issued)
       * gets a new one; a chosen password or Google/Apple is left alone, and
       * no credentials email goes out because there are none to send.
       */
      const keepPassword = !!existing && accessOf(existing) === 'own';

      const user = existing
        ? await tx.user.update({
          where: { id: existing.id },
          data: {
            // Do not clobber a real customer's chosen display name. Same rule
            // approve-business follows.
            name: existing.name && existing.name.trim() ? existing.name : body.name,
            ...(keepPassword ? {} : { password_hash: passwordHash, password_is_temp: true }),
            // Signed itself up and nobody's client: the rep who opens it now
            // holds it, in their book as if they had opened it new.
            ...(standing === 'unclaimed' ? { created_by_sales_rep_id: salesRepId } : {}),
            ...(isBusiness ? { is_business: true, pricing_mode: 'b2b' as const } : {}),
            ...(body.phone ? { phone: body.phone, phone_country_code: body.phone_country_code } : {}),
            preferred_language: body.preferred_language,
            sales_manager_name: body.sales_manager_name ?? null,
          },
        })
        : await tx.user.create({
          data: {
            name: body.name,
            email: body.email,
            ...(body.phone ? { phone: body.phone, phone_country_code: body.phone_country_code } : {}),
            password_hash: passwordHash,
            password_is_temp: true,
            preferred_language: body.preferred_language,
            is_business: isBusiness,
            pricing_mode: isBusiness ? 'b2b' : 'retail',
            sales_manager_name: body.sales_manager_name ?? null,
            created_by_admin_id: adminId,
            created_by_sales_rep_id: salesRepId,
          },
        });

      if (isBusiness && body.business) {
        const profile = {
          company: body.business.company,
          business_type: body.business.business_type ?? null,
          location: body.business.location ?? null,
          website: body.business.website ?? null,
          registration_no: body.business.registration_no ?? null,
          contact_phone: body.business.contact_phone ?? null,
        };
        await tx.businessProfile.upsert({
          where: { user_id: user.id },
          create: { user_id: user.id, ...profile, approved_by_admin_id: adminId },
          update: profile,
        });
      }

      // Only the first address becomes the default. An existing customer
      // already has one, and silently re-pointing their default delivery
      // address would be a surprising side-effect of a rep signing them up.
      const addressCount = await tx.address.count({ where: { user_id: user.id } });
      await tx.address.create({
        data: {
          user_id: user.id,
          ...body.address,
          street_line_2: body.address.street_line_2 ?? null,
          delivery_notes: body.address.delivery_notes ?? null,
          is_default: addressCount === 0,
        },
      });

      // ─── Vendor: give them a shop as well ───────────────
      let storeId: string | null = null;
      let storeName: string | null = null;
      if (body.vendor) {
        // Already a partner somewhere? Don't quietly hand them a second shop
        // — that is almost always a rep filling the form twice.
        const existingRole = await tx.partnerStoreRole.findFirst({
          where: { user_id: user.id },
          select: { store: { select: { id: true, name: true } } },
        });

        if (existingRole) {
          storeId = existingRole.store.id;
          storeName = existingRole.store.name;
        } else {
          const store = await tx.store.create({
            data: {
              slug: await makeUniqueStoreSlug(slugifyStoreName(body.vendor.store_name)),
              name: body.vendor.store_name,
              tagline_es: body.vendor.tagline_es ?? null,
              contact_email: body.vendor.contact_email ?? body.email,
              contact_phone: body.vendor.contact_phone ?? body.phone ?? null,
              origin: body.vendor.origin ?? null,
              // Same reasoning as partner approval: a store cannot go live
              // without a delivery zone, and a rep in a shop is in no
              // position to draw one. Draft keeps a half-configured shop off
              // the storefront and gives the vendor the natural arc — log
              // in, add products, draw zones, publish.
              status: 'draft',
              is_active: true,
              // `partner_approval`, not `admin`, despite no lead being
              // involved. The enum has only those two values and the
              // distinction that matters is linkability: leads.ts treats
              // `admin` stores as unclaimed inventory a future application
              // can be attached to. This shop already has an owner from the
              // moment it exists, so it must stay out of that picker.
              created_via: 'partner_approval',
            },
            select: { id: true, name: true },
          });
          storeId = store.id;
          storeName = store.name;

          await tx.partnerStoreRole.upsert({
            where: { user_id_store_id: { user_id: user.id, store_id: store.id } },
            create: { user_id: user.id, store_id: store.id, role: 'owner', is_active: true },
            update: { role: 'owner', is_active: true },
          });

          const partnerProfile = {
            company: body.vendor.store_name,
            location: body.business?.location ?? null,
            registration_no: body.business?.registration_no ?? null,
            contact_phone: body.vendor.contact_phone ?? body.phone ?? null,
            linked_store_id: store.id,
          };
          await tx.partnerProfile.upsert({
            where: { user_id: user.id },
            create: { user_id: user.id, ...partnerProfile, approved_by_admin_id: adminId },
            update: partnerProfile,
          });
        }
      }

      if (extras.inTransaction) await extras.inTransaction(tx, user.id);

      return { id: user.id, wasExisting: !!existing, keptPassword: keepPassword, storeId, storeName };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Name the field that actually collided. Blaming both is what made
      // this confusing: an email collision cannot reach here at all, because
      // the transaction upgrades an existing account rather than inserting a
      // second one — so in practice this is always the phone.
      const target = err.meta?.target;
      const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
      const hit = fields.join(',');
      if (hit.includes('phone')) {
        throw new ClientConflictError(
          'That phone number already belongs to another account. Use a different number, or leave it blank.',
        );
      }
      if (hit.includes('email')) {
        throw new ClientConflictError('That email already belongs to another account.');
      }
      throw new ClientConflictError('Those details are already in use by another account.');
    }
    throw err;
  }

  if (process.env.NODE_ENV !== 'production' && !created.keptPassword) {
    console.log(`[client-created] email=${body.email} tempPassword=${tempPassword} loginUrl=${storefrontLoginUrl()}`);
  }

  let emailSent = false;
  // Kept their own password: the temporary one above was never written, so a
  // welcome email carrying it would hand them a password that does not work.
  if (body.send_credentials && !created.keptPassword) {
    try {
      await sendClientWelcomeEmail({
        to: body.email,
        name: body.name,
        companyName: isBusiness ? (body.business?.company ?? null) : null,
        storeName: created.storeName,
        salesManagerName: body.sales_manager_name ?? null,
        homeGrocery: extras.homeGrocery ?? false,
        loginUrl: storefrontLoginUrl(),
        loginEmail: body.email,
        tempPassword,
        lang: resolveEmailLang(body.preferred_language),
      });
      // Only a real provider counts. The console mailer resolves too, and
      // claiming a send it only logged is how an admin ends up waiting for an
      // email that is sitting in a server log. See mailerDelivers.
      emailSent = mailerDelivers;
    } catch (mailErr) {
      // The rows are committed and the account is real. Report the failure in
      // the response instead of throwing, so the rep sees "created, but the
      // email did not send" rather than an error about a client that now
      // exists. Recovery is the resend-credentials route.
      console.error('[client-created] welcome email failed; rows exist, resend manually', mailErr);
    }
  }

  return {
    userId: created.id,
    wasExisting: created.wasExisting,
    store: created.storeId ? { id: created.storeId, name: created.storeName! } : null,
    emailSent,
    keptPassword: created.keptPassword,
  };
}
