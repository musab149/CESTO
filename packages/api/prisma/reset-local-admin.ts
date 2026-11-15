/**
 * Local-only helper: force-reset the dev admin to admin@groceryapp.es / admin1234.
 * Safe to re-run; upserts by email.
 *
 * Usage:
 *   npm --workspace @grocery-app/api exec ts-node prisma/reset-local-admin.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@groceryapp.es';
  const password = 'admin1234';
  const hash = await bcrypt.hash(password, 12);

  const row = await prisma.admin.upsert({
    where: { email },
    update: { password_hash: hash },
    create: {
      name: 'Super Admin',
      email,
      password_hash: hash,
      role: 'super_admin',
    },
  });

  console.log(`✔ Admin ready: ${row.email} / ${password}  (id=${row.id}, role=${row.role})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
