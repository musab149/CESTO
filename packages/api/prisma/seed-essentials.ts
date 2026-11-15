/**
 * Essentials-only seed — runs on the staging API.
 *
 * The full seed (`seed.ts`) populates a representative dataset for local dev:
 * categories, products, demo orders, Rashan packs, home sections, a demo
 * customer with order history, etc. That's great for working locally but
 * the wrong default for staging — testers want a *fresh* sandbox they can
 * fill via the admin panel.
 *
 * This script creates only what's required for an admin to log in. Once the
 * admin is in, they can build the catalogue from scratch through the panel.
 *
 * Credentials are sourced from env:
 *   - ADMIN_SEED_EMAIL     (default: admin@groceryapp.es)
 *   - ADMIN_SEED_PASSWORD  (required — no fallback, refuses to seed otherwise)
 *
 * Idempotent — uses upsert on the admin email so repeated deploys are no-ops
 * unless ADMIN_SEED_PASSWORD is set, in which case the hash is rotated to
 * match. Setting `password_changed_at` means the account is treated as
 * production-managed and future logic can force a rotation when the field
 * matches the seed epoch.
 *
 * Run with: ts-node prisma/seed-essentials.ts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Essentials seed (staging mode)…');

  const adminEmail = process.env.ADMIN_SEED_EMAIL?.trim() || 'admin@groceryapp.es';
  const adminPassword = process.env.ADMIN_SEED_PASSWORD?.trim();

  if (!adminPassword || adminPassword.length < 10) {
    console.warn(
      '⚠  ADMIN_SEED_PASSWORD not set (or shorter than 10 chars) — skipping admin ' +
      'upsert. Set it in the Render dashboard to (re)seed the admin account.',
    );
    return;
  }

  const password_hash = await bcrypt.hash(adminPassword, 12);

  await prisma.admin.upsert({
    where: { email: adminEmail },
    create: {
      name: 'Super Admin',
      email: adminEmail,
      password_hash,
      role: 'super_admin',
    },
    // Re-hash on every deploy so a rotated env-var password takes effect.
    // If ADMIN_SEED_PASSWORD isn't changed, this is a no-op in practice.
    update: {
      password_hash,
    },
  });

  console.log(`   ✔ Admin: ${adminEmail} (password from ADMIN_SEED_PASSWORD)`);
  console.log('✨ Done. Catalogue is empty — populate via the admin panel.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
