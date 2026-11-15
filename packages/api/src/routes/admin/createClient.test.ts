// ─── Integration test · rep-led client onboarding ──────────────
//
// Run:  cd packages/api && npx ts-node src/routes/admin/createClient.test.ts
//
// Exercises the row-level contract of POST /api/admin/users by calling the
// same primitives the route does, against the real database. The route body
// itself is Express-bound, so what is asserted here is the part that can
// silently go wrong: which columns end up set, that the password is hashed
// rather than stored, that the first address becomes the default and a later
// one does not, and that re-running against an existing email upgrades the
// account without clobbering the name they chose.
//
// Creates its own throwaway users and removes them in a finally block.
// Touches nothing seeded.

import '../../server';
import prisma from '../../lib/prisma';
import bcrypt from 'bcryptjs';
import { generateTempPassword } from '../../lib/credentials';
import { slugifyStoreName, makeUniqueStoreSlug } from '../../lib/storeSlug';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

const stamp = Date.now();
const businessEmail = `rep-business-${stamp}@cesto-test.invalid`;
const retailEmail = `rep-retail-${stamp}@cesto-test.invalid`;
const existingEmail = `rep-existing-${stamp}@cesto-test.invalid`;

const address = {
  contact_name: 'Test Contact',
  contact_phone: '600111222',
  street_line_1: 'Calle de Prueba 1',
  postcode: '28001',
  city: 'Madrid',
  province: 'Madrid',
};

/** Mirrors the route's transaction. Kept in step with routes/admin/users.ts. */
async function createClient(opts: {
  email: string;
  name: string;
  isBusiness: boolean;
  company?: string;
  salesManager?: string;
  /** Set to also make them a vendor. */
  storeName?: string;
}) {
  const tempPassword = generateTempPassword(12);
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { email: opts.email },
      select: { id: true, name: true },
    });

    const user = existing
      ? await tx.user.update({
        where: { id: existing.id },
        data: {
          name: existing.name && existing.name.trim() ? existing.name : opts.name,
          password_hash: passwordHash,
          password_is_temp: true,
          ...(opts.isBusiness ? { is_business: true, pricing_mode: 'b2b' as const } : {}),
          sales_manager_name: opts.salesManager ?? null,
        },
      })
      : await tx.user.create({
        data: {
          name: opts.name,
          email: opts.email,
          password_hash: passwordHash,
          password_is_temp: true,
          is_business: opts.isBusiness,
          pricing_mode: opts.isBusiness ? 'b2b' : 'retail',
          sales_manager_name: opts.salesManager ?? null,
        },
      });

    if (opts.isBusiness && opts.company) {
      const profile = { company: opts.company };
      await tx.businessProfile.upsert({
        where: { user_id: user.id },
        create: { user_id: user.id, ...profile },
        update: profile,
      });
    }

    const addressCount = await tx.address.count({ where: { user_id: user.id } });
    await tx.address.create({
      data: { user_id: user.id, ...address, is_default: addressCount === 0 },
    });

    let storeId: string | null = null;
    if (opts.storeName) {
      const existingRole = await tx.partnerStoreRole.findFirst({
        where: { user_id: user.id },
        select: { store_id: true },
      });
      if (existingRole) {
        storeId = existingRole.store_id;
      } else {
        const store = await tx.store.create({
          data: {
            slug: await makeUniqueStoreSlug(slugifyStoreName(opts.storeName)),
            name: opts.storeName,
            status: 'draft',
            is_active: true,
            created_via: 'partner_approval',
          },
          select: { id: true },
        });
        storeId = store.id;
        await tx.partnerStoreRole.upsert({
          where: { user_id_store_id: { user_id: user.id, store_id: store.id } },
          create: { user_id: user.id, store_id: store.id, role: 'owner', is_active: true },
          update: { role: 'owner', is_active: true },
        });
        await tx.partnerProfile.upsert({
          where: { user_id: user.id },
          create: { user_id: user.id, company: opts.storeName, linked_store_id: store.id },
          update: { company: opts.storeName, linked_store_id: store.id },
        });
      }
    }

    return { id: user.id, wasExisting: !!existing, tempPassword, storeId };
  });

  return result;
}

async function main() {
  const createdIds: string[] = [];
  const createdStoreIds: string[] = [];

  try {
    // ─── 1. Business client ──────────────────────────────────
    const biz = await createClient({
      email: businessEmail,
      name: 'Business Owner',
      isBusiness: true,
      company: 'Tienda de Prueba SL',
      salesManager: 'Rep One',
    });
    createdIds.push(biz.id);

    const bizUser = await prisma.user.findUnique({
      where: { id: biz.id },
      omit: { password_hash: false },
      include: { business_profile: true, addresses: true },
    });

    check('business: is_business true', bizUser?.is_business === true);
    check('business: pricing_mode b2b', bizUser?.pricing_mode === 'b2b', bizUser?.pricing_mode);
    check('business: password_is_temp true', bizUser?.password_is_temp === true);
    check('business: sales_manager_name stored', bizUser?.sales_manager_name === 'Rep One', bizUser?.sales_manager_name);
    check('business: BusinessProfile created', bizUser?.business_profile?.company === 'Tienda de Prueba SL');
    check('business: one address, is_default true',
      bizUser?.addresses.length === 1 && bizUser.addresses[0].is_default === true);

    // The whole point of hashing: the plaintext must not be recoverable from
    // the row, and the hash must still verify.
    check('business: password stored hashed, not plaintext',
      !!bizUser?.password_hash && bizUser.password_hash !== biz.tempPassword);
    check('business: hash verifies against the temp password',
      await bcrypt.compare(biz.tempPassword, bizUser!.password_hash!));

    // ─── 2. Retail client ────────────────────────────────────
    const retail = await createClient({
      email: retailEmail,
      name: 'Retail Person',
      isBusiness: false,
    });
    createdIds.push(retail.id);

    const retailUser = await prisma.user.findUnique({
      where: { id: retail.id },
      include: { business_profile: true },
    });

    check('retail: is_business false', retailUser?.is_business === false);
    check('retail: pricing_mode retail', retailUser?.pricing_mode === 'retail');
    check('retail: no BusinessProfile', retailUser?.business_profile === null);
    check('retail: sales_manager_name null when not given', retailUser?.sales_manager_name === null);

    // ─── 3. Existing customer is upgraded, name preserved ────
    const preexisting = await prisma.user.create({
      data: { name: 'Chosen Display Name', email: existingEmail, is_business: false },
    });
    createdIds.push(preexisting.id);

    const upgraded = await createClient({
      email: existingEmail,
      name: 'Name From The Rep Form',
      isBusiness: true,
      company: 'Upgraded SL',
    });

    check('existing: same row reused, not duplicated', upgraded.id === preexisting.id);
    check('existing: reported as existing', upgraded.wasExisting === true);

    const upgradedUser = await prisma.user.findUnique({
      where: { id: preexisting.id },
      include: { business_profile: true },
    });

    // The rule approve-business follows, and the one most likely to be broken
    // by a later refactor: a customer who already chose a display name keeps
    // it, even though the rep typed something else into the form.
    check('existing: chosen name NOT clobbered',
      upgradedUser?.name === 'Chosen Display Name', upgradedUser?.name);
    check('existing: upgraded to business', upgradedUser?.is_business === true);
    check('existing: BusinessProfile attached', upgradedUser?.business_profile?.company === 'Upgraded SL');

    // ─── 4. A second address does not steal the default ──────
    const before = await prisma.address.findFirst({
      where: { user_id: biz.id, is_default: true },
      select: { id: true },
    });
    const count = await prisma.address.count({ where: { user_id: biz.id } });
    await prisma.address.create({
      data: { user_id: biz.id, ...address, street_line_1: 'Calle Segunda 2', is_default: count === 0 },
    });
    const defaults = await prisma.address.findMany({
      where: { user_id: biz.id, is_default: true },
      select: { id: true },
    });
    check('addresses: still exactly one default', defaults.length === 1, defaults.length);
    check('addresses: the original is still the default', defaults[0]?.id === before?.id);

    // ─── 5. Vendor: a client who also sells ──────────────────
    const vendorEmail = `rep-vendor-${stamp}@cesto-test.invalid`;
    const vendor = await createClient({
      email: vendorEmail,
      name: 'Vendor Owner',
      isBusiness: true,
      company: 'Compra y Vende SL',
      storeName: 'Tienda Vendor Test',
    });
    createdIds.push(vendor.id);
    if (vendor.storeId) createdStoreIds.push(vendor.storeId);

    const vendorUser = await prisma.user.findUnique({
      where: { id: vendor.id },
      include: {
        business_profile: true,
        partner_profile: true,
        partner_roles: { include: { store: true } },
      },
    });

    check('vendor: store created', !!vendor.storeId);
    check('vendor: exactly one owner role', vendorUser?.partner_roles.length === 1);
    check('vendor: role is owner', vendorUser?.partner_roles[0]?.role === 'owner');
    // Draft, not live: a store cannot publish without a delivery zone, and a
    // rep in a shop is in no position to draw one.
    check('vendor: store is a DRAFT', vendorUser?.partner_roles[0]?.store.status === 'draft',
      vendorUser?.partner_roles[0]?.store.status);
    // Must stay out of the "link an unclaimed store" picker in leads.ts,
    // which keys on created_via === 'admin'.
    check('vendor: store not linkable by a future application',
      vendorUser?.partner_roles[0]?.store.created_via === 'partner_approval',
      vendorUser?.partner_roles[0]?.store.created_via);
    check('vendor: PartnerProfile attached', !!vendorUser?.partner_profile);
    // The whole point of the feature: buyer AND seller on one account.
    check('vendor: is ALSO a B2B buyer', vendorUser?.is_business === true && !!vendorUser?.business_profile);

    // Running it again must not hand them a second shop.
    const again = await createClient({
      email: vendorEmail,
      name: 'Vendor Owner',
      isBusiness: true,
      company: 'Compra y Vende SL',
      storeName: 'Tienda Vendor Test',
    });
    const roleCount = await prisma.partnerStoreRole.count({ where: { user_id: vendor.id } });
    check('vendor: re-running does not create a second shop', roleCount === 1, roleCount);
    check('vendor: re-run returns the same store', again.storeId === vendor.storeId);

    // ─── 6. Slug uniqueness ──────────────────────────────────
    const slug = slugifyStoreName('  Tienda  Ñandú & Co.  ');
    check('slug: accent-folded, lowercased, hyphenated', slug === 'tienda-nandu-co', slug);
    const taken = await makeUniqueStoreSlug(slugifyStoreName('Tienda Vendor Test'));
    check('slug: avoids an existing one', taken !== 'tienda-vendor-test', taken);

    // ─── 7. Availability lookup ──────────────────────────────
    //
    // The two results mean different things, and conflating them is what
    // produced "email or phone already in use" for a brand-new email.

    const lookupEmail = await prisma.user.findUnique({
      where: { email: businessEmail },
      select: { id: true, name: true },
    });
    check('lookup finds an existing email', lookupEmail?.id === biz.id);

    const freshEmail = await prisma.user.findUnique({
      where: { email: `nobody-${stamp}@cesto-test.invalid` },
      select: { id: true },
    });
    check('lookup returns null for an unused email', freshEmail === null);

    // An email match is NOT a failure: the create upgrades that account. Prove
    // it by running the create against the same address again.
    const reRun = await createClient({
      email: businessEmail,
      name: 'Ignored Name',
      isBusiness: true,
      company: 'Tienda de Prueba SL',
    });
    check('an existing email upgrades rather than erroring', reRun.id === biz.id);

    // A phone, by contrast, cannot be moved between accounts.
    const phoneOwner = await prisma.user.create({
      data: {
        name: 'Phone Owner',
        email: `phone-owner-${stamp}@cesto-test.invalid`,
        phone: `6000${String(stamp).slice(-5)}`,
      },
    });
    createdIds.push(phoneOwner.id);

    const byPhone = await prisma.user.findUnique({
      where: { phone: phoneOwner.phone! },
      select: { id: true },
    });
    check('lookup finds an existing phone', byPhone?.id === phoneOwner.id);

    let phoneRejected = false;
    let rejectedOnPhone = false;
    try {
      await prisma.user.create({
        data: {
          name: 'Someone Else',
          email: `someone-else-${stamp}@cesto-test.invalid`,
          phone: phoneOwner.phone,
        },
      });
    } catch (err) {
      phoneRejected = true;
      const meta = (err as { meta?: { target?: unknown } }).meta;
      const target = Array.isArray(meta?.target) ? meta!.target.map(String).join(',') : String(meta?.target ?? '');
      rejectedOnPhone = target.includes('phone');
    }
    check('a second account cannot take the same phone', phoneRejected);
    // This is what the error message has to read off. Blaming the email when
    // the constraint says phone is the bug being fixed.
    check('...and the constraint names PHONE, not email', rejectedOnPhone);

    // ─── 8. Temp password shape ──────────────────────────────
    const pw = generateTempPassword(12);
    check('temp password: 12 chars', pw.length === 12, pw.length);
    check('temp password: no ambiguous 0/O/1/l/I', !/[0O1lI]/.test(pw), pw);
  } finally {
    // Addresses and BusinessProfile cascade from the user.
    if (createdIds.length) {
      await prisma.address.deleteMany({ where: { user_id: { in: createdIds } } });
      await prisma.businessProfile.deleteMany({ where: { user_id: { in: createdIds } } });
      await prisma.partnerProfile.deleteMany({ where: { user_id: { in: createdIds } } });
      // Roles cascade from either side, but delete them first so the store
      // delete below is not blocked by a lingering FK.
      await prisma.partnerStoreRole.deleteMany({ where: { user_id: { in: createdIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
    }
    if (createdStoreIds.length) {
      await prisma.store.deleteMany({ where: { id: { in: createdStoreIds } } });
    }
    await prisma.$disconnect();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
