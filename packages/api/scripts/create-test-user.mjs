// ─── Create (or reset) a test customer / business / partner account ───
//
// Upserts a User row with an email/password login, matching the
// register-email flow in src/routes/auth.ts (same bcrypt cost).
// Safe to re-run: an existing account with the same email just gets
// its password reset instead of failing on the unique constraint.
//
//   cd packages/api
//   node scripts/create-test-user.mjs [email] [password] [name]
//
// --business  additionally sets is_business=true, pricing_mode='b2b' and
//             upserts a BusinessProfile — mirrors POST /admin/leads/:id/
//             approve-business (src/routes/admin/leads.ts). This is a
//             wholesale BUYER account: it gets the Regular <-> Business
//             pricing toggle, nothing else. It is NOT a vendor/partner.
//
//   node scripts/create-test-user.mjs biz@cesto.es Test1234! "Biz User" --business [company]
//
// --partner   creates a draft Store + PartnerStoreRole(owner) + PartnerProfile
//             for the user — mirrors POST /admin/leads/:id/approve
//             (partner_store lead approval). This is a vendor/seller
//             account: log in normally at /login, then it can reach
//             /partner/* (apps/web/src/partner) and do vendor things,
//             e.g. submit a category for review. Store starts in `draft`
//             status (same as a real approval) — fine for hitting partner
//             endpoints, but it won't appear on the storefront until
//             zones are drawn and it's published.
//
//   node scripts/create-test-user.mjs vendor@cesto.es Test1234! "Vendor User" --partner [store name]
//
// Business and partner are separate, unrelated roles (wholesale buyer vs.
// seller) — pass at most one flag. Login is unified either way: both use
// the same /api/auth/login-email as a normal customer.
//
// Defaults: test@cesto.es / Test1234! / "Test User"

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const rawArgs = process.argv.slice(2);
const isBusiness = rawArgs.includes('--business');
const isPartner = rawArgs.includes('--partner');
const positional = rawArgs.filter((a) => a !== '--business' && a !== '--partner');

const defaultEmail = isPartner ? 'test-partner@cesto.es' : isBusiness ? 'test-business@cesto.es' : 'test@cesto.es';
const defaultName = isPartner ? 'Test Partner User' : isBusiness ? 'Test Business User' : 'Test User';

const email = positional[0] ?? defaultEmail;
const password = positional[1] ?? 'Test1234!';
const name = positional[2] ?? defaultName;
const company = positional[3] ?? (isPartner ? 'Test Store' : 'Test Business SL');

function slugify(s) {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function makeUniqueStoreSlug(base) {
  let slug = base || 'store';
  let n = 1;
  while (await prisma.store.findUnique({ where: { slug } })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

async function main() {
  const password_hash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      password_hash,
      password_is_temp: false,
      ...(isBusiness ? { is_business: true, pricing_mode: 'b2b' } : {}),
    },
    create: {
      name,
      email,
      password_hash,
      ...(isBusiness ? { is_business: true, pricing_mode: 'b2b' } : {}),
    },
  });

  if (isBusiness) {
    await prisma.businessProfile.upsert({
      where: { user_id: user.id },
      update: { company },
      create: {
        user_id: user.id,
        company,
        business_type: 'Wholesale',
        location: 'Madrid',
      },
    });
  }

  let store = null;
  if (isPartner) {
    // Reuse an existing store for this user if they already have a role
    // (re-running the script shouldn't spawn a second store every time).
    const existingRole = await prisma.partnerStoreRole.findFirst({
      where: { user_id: user.id },
      select: { store_id: true },
    });

    if (existingRole) {
      store = await prisma.store.update({
        where: { id: existingRole.store_id },
        data: { name: company },
      });
    } else {
      const slug = await makeUniqueStoreSlug(slugify(company));
      store = await prisma.store.create({
        data: {
          slug,
          name: company,
          created_via: 'partner_approval',
          status: 'draft',
          is_active: true,
        },
      });
      await prisma.partnerStoreRole.create({
        data: { user_id: user.id, store_id: store.id, role: 'owner', is_active: true },
      });
    }

    await prisma.partnerProfile.upsert({
      where: { user_id: user.id },
      update: { company, linked_store_id: store.id },
      create: {
        user_id: user.id,
        company,
        business_type: 'Retail',
        location: 'Madrid',
        linked_store_id: store.id,
      },
    });
  }

  console.log(`Test ${isPartner ? 'partner ' : isBusiness ? 'business ' : ''}user ready:`);
  console.log(`  id:       ${user.id}`);
  console.log(`  name:     ${user.name}`);
  console.log(`  email:    ${user.email}`);
  console.log(`  password: ${password}`);
  if (isBusiness) {
    console.log(`  company:  ${company}`);
    console.log('  is_business: true, pricing_mode: b2b');
  }
  if (isPartner) {
    console.log(`  store:    ${store.name} (${store.slug}), status=${store.status}`);
    console.log('  role:     owner');
    console.log('  Log in at /login, then visit /partner/categories to submit one.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
