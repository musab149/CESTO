#!/usr/bin/env node
/*
 * Local-only catalogue wipe.
 *
 * Nukes: products (+ variants + images cascade), categories (+ subcategories
 * cascade), pending products, pending categories, curated brands + origins
 * (home_sections rows), and every table that FK-references products so the
 * delete doesn't fail (orders, order_items, rashan packs/subs/deliveries,
 * notifications, import jobs).
 *
 * Preserves: admins, users, addresses, stores, store_follows, delivery
 * zones/slots, riders, banners, app_settings, help center, support tickets.
 *
 * Usage:
 *   cd packages/api
 *   node prisma/reset-local-catalog.mjs --yes
 *
 * Safety:
 *   - Refuses to run unless DATABASE_URL points to localhost / 127.0.0.1.
 *   - Refuses to run without --yes.
 *   - Wraps all deletes in a single transaction; either everything succeeds
 *     or nothing changes.
 */

import { PrismaClient } from '@prisma/client';

const CONFIRMED = process.argv.includes('--yes');
if (!CONFIRMED) {
  console.error('✖ Refusing to run without --yes. Pass --yes to confirm the destructive reset.');
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL ?? '';
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl);
if (!isLocal) {
  console.error('✖ DATABASE_URL does NOT look like a local database. This script only runs against localhost.');
  console.error(`  Got: ${dbUrl.replace(/:[^@]*@/, ':***@')}`);
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  console.log('▸ Local catalogue reset — target:', dbUrl.replace(/:[^@]*@/, ':***@'));

  const counts = await prisma.$transaction(async (tx) => {
    // 1. FK collateral — anything that references products / product_variants
    //    directly, or that stores product references we want cleaned up.
    const subDeliveries = await tx.subscriptionDelivery.deleteMany({});
    const rashanSubs    = await tx.rashanSubscription.deleteMany({});
    const rashanPacks   = await tx.rashanPack.deleteMany({});
    const orderItems    = await tx.orderItem.deleteMany({});
    const orders        = await tx.order.deleteMany({});
    const notifications = await tx.notification.deleteMany({});
    const importJobs    = await tx.productImportJob.deleteMany({});

    // 2. Pending queues (independent tables — no FK to products/categories).
    const pendingProducts   = await tx.pendingProduct.deleteMany({});
    const pendingCategories = await tx.pendingCategory.deleteMany({});

    // 3. The catalogue itself. Product cascades variants + images.
    //    Category cascades subcategories. Order matters because Product FKs
    //    Category without ON DELETE CASCADE.
    const products      = await tx.product.deleteMany({});
    const subCategories = await tx.subCategory.deleteMany({});
    const categories    = await tx.category.deleteMany({});

    // 4. First-class Brand + Origin tables (promoted from home_sections JSON
    //    on 2026-07-13). Safe to delete AFTER products because the FKs are
    //    ON DELETE SET NULL — no cascade damage even if we had products.
    const brands  = await tx.brand.deleteMany({});
    const origins = await tx.origin.deleteMany({});

    // 5. Stores + follows. Added to the local wipe scope on 2026-07-14 to
    //    match the remote wipe script's behavior — a fresh reset now nukes
    //    the storefront domain too so re-imports can seed new stores.
    const storeFollows = await tx.storeFollow.deleteMany({});
    const stores       = await tx.store.deleteMany({});

    // 6. Legacy home_sections JSON blobs. These are no longer read by the
    //    app but might linger from before the promote-to-tables migration —
    //    wipe them so a fresh import starts from a truly clean slate.
    const homeSections = await tx.homeSection.deleteMany({
      where: { key: { in: ['top-brands', 'shop-by-origin'] } },
    });

    return {
      subDeliveries: subDeliveries.count,
      rashanSubs: rashanSubs.count,
      rashanPacks: rashanPacks.count,
      orderItems: orderItems.count,
      orders: orders.count,
      notifications: notifications.count,
      importJobs: importJobs.count,
      pendingProducts: pendingProducts.count,
      pendingCategories: pendingCategories.count,
      products: products.count,
      subCategories: subCategories.count,
      categories: categories.count,
      brands: brands.count,
      origins: origins.count,
      storeFollows: storeFollows.count,
      stores: stores.count,
      homeSections: homeSections.count,
    };
  });

  console.log('✓ Wipe complete. Rows deleted:');
  for (const [table, n] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(20)} ${n}`);
  }
}

main()
  .catch((e) => {
    console.error('✖ Reset failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
