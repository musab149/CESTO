// ─── Integration test · admin-created orders ───────────────────
//
// Run:  cd packages/api && npx ts-node src/routes/admin/createOrder.test.ts
//
// The dangerous parts of POST /api/admin/orders are the ones that touch
// money and stock: prices must come from the customer's pricing mode and
// never from the request, stock must be decremented exactly once, and a
// basket that cannot be filled must leave nothing behind.
//
// Builds its own category, store, products and customer; removes them in a
// finally block.

import '../../server';
import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { generateOrderNumber } from '../../lib/pagination';
import { effectiveUnitPrice, RETAIL_CONTEXT, type PricingContext } from '../../lib/pricing';
import { computeOrderTotals, lineTotal, buildProductSnapshot } from '../../lib/orderTotals';

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

async function main() {
  const productIds: string[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const storeIds: string[] = [];
  let categoryId = '';

  try {
    const category = await prisma.category.create({
      data: { name_es: `AO ${stamp}`, name_en: `AO ${stamp}`, sort_order: 9999 },
      select: { id: true },
    });
    categoryId = category.id;

    const product = await prisma.product.create({
      data: {
        name_es: `Aceite prueba ${stamp}`,
        name_en: `Test oil ${stamp}`,
        category_id: categoryId,
        is_active: true,
        variants: {
          create: [{
            name_es: '1 L', name_en: '1 L',
            price: new Prisma.Decimal('10.00'),
            b2b_price: new Prisma.Decimal('7.50'),
            stock_quantity: 5,
            is_default: true, is_active: true,
          }],
        },
      },
      include: { variants: true, images: true },
    });
    productIds.push(product.id);
    const variant = product.variants[0];

    async function makeCustomer(isBusiness: boolean) {
      const u = await prisma.user.create({
        data: {
          name: `AO customer ${isBusiness ? 'b2b' : 'retail'} ${stamp}`,
          email: `ao-${isBusiness ? 'b2b' : 'retail'}-${stamp}@cesto-test.invalid`,
          is_business: isBusiness,
          pricing_mode: isBusiness ? 'b2b' : 'retail',
        },
      });
      userIds.push(u.id);
      const a = await prisma.address.create({
        data: {
          user_id: u.id,
          contact_name: 'T', contact_phone: '600000000',
          street_line_1: 'Calle 1', postcode: '28001', city: 'Madrid', province: 'Madrid',
          is_default: true,
        },
      });
      return { user: u, address: a };
    }

    /** Mirrors the route's pricing + persistence. */
    async function createOrder(
      customer: { id: string; is_business: boolean; pricing_mode: string },
      address: { id: string; contact_name: string; contact_phone: string; street_line_1: string; postcode: string; city: string; province: string },
      qty: number,
      deliveryFee = new Prisma.Decimal('3.50'),
    ) {
      const ctx: PricingContext = customer.is_business
        ? { isBusiness: true, mode: customer.pricing_mode === 'b2b' ? 'b2b' : 'retail' }
        : RETAIL_CONTEXT;
      const withProduct = { ...variant, product };
      const unit = effectiveUnitPrice(withProduct, ctx, product);
      const lines = [{
        product_id: product.id,
        variant_id: variant.id,
        product_snapshot: buildProductSnapshot(withProduct),
        quantity: qty,
        unit_price: unit,
        line_total: lineTotal({ unit_price: unit, quantity: qty }),
      }];
      const totals = computeOrderTotals(lines, deliveryFee);

      const order = await prisma.$transaction(async (tx) => {
        await tx.productVariant.update({
          where: { id: variant.id },
          data: { stock_quantity: { decrement: qty } },
        });
        return tx.order.create({
          data: {
            order_number: generateOrderNumber(),
            user_id: customer.id,
            address_id: address.id,
            address_snapshot: {
              contact_name: address.contact_name, contact_phone: address.contact_phone,
              street_line_1: address.street_line_1, street_line_2: null,
              postcode: address.postcode, city: address.city, province: address.province,
              delivery_notes: null,
            },
            payment_method: 'cod',
            status: 'pending',
            subtotal: totals.subtotal,
            delivery_fee: totals.delivery_fee,
            total: totals.total,
            items: { createMany: { data: lines } },
          },
          include: { items: true },
        });
      });
      orderIds.push(order.id);
      return order;
    }

    // ─── Retail pricing ──────────────────────────────────────
    const retail = await makeCustomer(false);
    const o1 = await createOrder(retail.user, retail.address, 2);

    check('created at pending, never draft', o1.status === 'pending', o1.status);
    check('retail pays the list price', Number(o1.items[0].unit_price) === 10, o1.items[0].unit_price);
    check('line total = price x qty', Number(o1.items[0].line_total) === 20);
    check('subtotal from the lines', Number(o1.subtotal) === 20, o1.subtotal);
    check('total = subtotal + delivery', Number(o1.total) === 23.5, o1.total);
    check('address snapshotted, not just referenced',
      (o1.address_snapshot as Record<string, unknown>).postcode === '28001');
    check('snapshot captures the product name',
      (o1.items[0].product_snapshot as Record<string, unknown>).name_es === product.name_es);

    let v = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    check('stock decremented exactly once', v?.stock_quantity === 3, v?.stock_quantity);

    // ─── B2B pricing comes from the CUSTOMER ─────────────────
    const b2b = await makeCustomer(true);
    const o2 = await createOrder(b2b.user, b2b.address, 1);
    check('business customer gets b2b_price', Number(o2.items[0].unit_price) === 7.5, o2.items[0].unit_price);
    check('b2b total reflects the lower price', Number(o2.subtotal) === 7.5);

    v = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    check('stock decremented again', v?.stock_quantity === 2, v?.stock_quantity);

    // ─── Shortfall leaves nothing behind ─────────────────────
    const before = (await prisma.productVariant.findUnique({ where: { id: variant.id } }))!.stock_quantity;
    const ordersBefore = await prisma.order.count({ where: { user_id: retail.user.id } });
    let blocked = false;
    try {
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.productVariant.findUnique({ where: { id: variant.id } });
        if ((fresh?.stock_quantity ?? 0) < 99) throw new Error('shortfall');
        await tx.order.create({ data: {} as never });
      });
    } catch {
      blocked = true;
    }
    const after = (await prisma.productVariant.findUnique({ where: { id: variant.id } }))!.stock_quantity;
    const ordersAfter = await prisma.order.count({ where: { user_id: retail.user.id } });
    check('an unfillable basket is refused', blocked);
    check('...and no stock was taken', after === before, { before, after });
    check('...and no order row survives', ordersAfter === ordersBefore);

    // ─── Fee override ────────────────────────────────────────
    const o3 = await createOrder(retail.user, retail.address, 1, new Prisma.Decimal('0'));
    check('a waived delivery fee is honoured', Number(o3.delivery_fee) === 0);
    check('total equals subtotal when delivery is waived', Number(o3.total) === Number(o3.subtotal));

    // ─── Products from several shops, still ONE Cesto order ──
    //
    // A rep delivers what they sell, so there is no partner fulfilling any
    // part of it — no split, and the order belongs to Cesto.

    const partnerStore = await prisma.store.create({
      data: { slug: `ao-store-${stamp}`, name: `AO Store ${stamp}`, status: 'draft', is_active: true },
      select: { id: true, name: true },
    });
    storeIds.push(partnerStore.id);

    const partnerProduct = await prisma.product.create({
      data: {
        name_es: `Producto socio ${stamp}`,
        name_en: `Partner product ${stamp}`,
        category_id: categoryId,
        store_id: partnerStore.id,
        is_active: true,
        variants: {
          create: [{
            name_es: 'Ud', name_en: 'Unit',
            price: new Prisma.Decimal('4.00'),
            stock_quantity: 10, is_default: true, is_active: true,
          }],
        },
      },
      include: { variants: true },
    });
    productIds.push(partnerProduct.id);

    const mixedAdmin = await prisma.admin.findFirst({ select: { id: true } });

    const mixed = await prisma.$transaction(async (tx) => {
      await tx.productVariant.update({
        where: { id: variant.id }, data: { stock_quantity: { decrement: 1 } },
      });
      await tx.productVariant.update({
        where: { id: partnerProduct.variants[0].id }, data: { stock_quantity: { decrement: 1 } },
      });
      return tx.order.create({
        data: {
          order_number: generateOrderNumber(),
          user_id: retail.user.id,
          address_id: retail.address.id,
          address_snapshot: {},
          payment_method: 'cod',
          // The point of the whole scenario.
          store_id: null,
          created_by_admin_id: mixedAdmin?.id ?? null,
          status: 'pending',
          subtotal: new Prisma.Decimal('14.00'),
          delivery_fee: new Prisma.Decimal('0'),
          total: new Prisma.Decimal('14.00'),
          items: {
            createMany: {
              data: [
                {
                  product_id: product.id, variant_id: variant.id, product_snapshot: {},
                  quantity: 1,
                  unit_price: new Prisma.Decimal('10.00'), line_total: new Prisma.Decimal('10.00'),
                },
                {
                  product_id: partnerProduct.id, variant_id: partnerProduct.variants[0].id,
                  product_snapshot: {}, quantity: 1,
                  unit_price: new Prisma.Decimal('4.00'), line_total: new Prisma.Decimal('4.00'),
                },
              ],
            },
          },
        },
        include: { items: true },
      });
    });
    orderIds.push(mixed.id);

    check('a mixed-shop basket is ONE order', mixed.items.length === 2);
    check('...with no parent order', mixed.parent_order_id === null);
    check('...owned by Cesto, not the partner', mixed.store_id === null, mixed.store_id);
    check('...and attributed to the admin who built it',
      mixedAdmin ? mixed.created_by_admin_id === mixedAdmin.id : true);

    const siblings = await prisma.order.count({
      where: { user_id: retail.user.id, parent_order_id: { not: null } },
    });
    check('...and spawned no sub-orders', siblings === 0, siblings);

    // The leak this column exists to close: the partner visibility clause
    // treats store_id NULL + a matching item as a pre-mv row of theirs.
    const partnerVisible = await prisma.order.findMany({
      where: {
        OR: [
          { store_id: partnerStore.id },
          {
            store_id: null,
            created_by_admin_id: null,
            items: { some: { product: { store_id: partnerStore.id } } },
          },
        ],
      },
      select: { id: true },
    });
    check('the partner does NOT see a rep-built order holding their product',
      !partnerVisible.some((o) => o.id === mixed.id), partnerVisible.length);

    // Without the guard it WOULD be visible — proves the clause is what saves it.
    const withoutGuard = await prisma.order.findMany({
      where: {
        OR: [
          { store_id: partnerStore.id },
          { store_id: null, items: { some: { product: { store_id: partnerStore.id } } } },
        ],
      },
      select: { id: true },
    });
    check('...and it would have been visible without the guard',
      mixedAdmin ? withoutGuard.some((o) => o.id === mixed.id) : true);

    // ─── A big order ─────────────────────────────────────────
    //
    // A shop restocking is a genuinely large order. The decrement used to be
    // one sequential round-trip per distinct variant inside an 8-second
    // transaction, so this is the shape that used to time out and hand the
    // rep a failure after the rollback had already started.

    const BIG = 120;
    const bigVariantIds: string[] = [];
    for (let i = 0; i < BIG; i += 1) {
      const pr = await prisma.product.create({
        data: {
          name_es: `Bulk ${i} ${stamp}`,
          name_en: `Bulk ${i} ${stamp}`,
          category_id: categoryId,
          is_active: true,
          variants: {
            create: [{
              name_es: 'Ud', name_en: 'Unit',
              price: new Prisma.Decimal('1.00'),
              stock_quantity: 10, is_default: true, is_active: true,
            }],
          },
        },
        include: { variants: true },
      });
      productIds.push(pr.id);
      bigVariantIds.push(pr.variants[0].id);
    }

    // Quantities vary so the batched UPDATE cannot pass by coincidence of
    // every row getting the same number.
    const bigWanted = new Map<string, number>();
    bigVariantIds.forEach((id, i) => bigWanted.set(id, (i % 3) + 1));
    const expectedUnits = [...bigWanted.values()].reduce((a, b) => a + b, 0);

    const startedAt = Date.now();
    const bigOrder = await prisma.$transaction(async (tx) => {
      const decrements = [...bigWanted.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      await tx.$executeRaw`
        UPDATE product_variants AS v
           SET stock_quantity = v.stock_quantity - d.qty
          FROM (VALUES ${Prisma.join(
            decrements.map(([id, qty]) => Prisma.sql`(${id}::uuid, ${qty}::int)`),
          )}) AS d(id, qty)
         WHERE v.id = d.id
      `;
      return tx.order.create({
        data: {
          order_number: generateOrderNumber(),
          user_id: retail.user.id,
          address_id: retail.address.id,
          address_snapshot: {},
          payment_method: 'cod',
          store_id: null,
          status: 'pending',
          subtotal: new Prisma.Decimal(expectedUnits),
          delivery_fee: new Prisma.Decimal('0'),
          total: new Prisma.Decimal(expectedUnits),
          items: {
            createMany: {
              data: [...bigWanted.entries()].map(([variantId, qty], i) => ({
                product_id: productIds[productIds.length - BIG + i],
                variant_id: variantId,
                product_snapshot: {},
                quantity: qty,
                unit_price: new Prisma.Decimal('1.00'),
                line_total: new Prisma.Decimal(qty),
              })),
            },
          },
        },
        include: { items: true },
      });
    }, { maxWait: 5_000, timeout: 8_000 });
    const elapsed = Date.now() - startedAt;
    orderIds.push(bigOrder.id);

    check(`a ${BIG}-line order completes`, bigOrder.items.length === BIG, bigOrder.items.length);
    check('...inside the 8s transaction budget', elapsed < 8_000, `${elapsed}ms`);

    // The real risk of a batched UPDATE: the wrong quantity landing on the
    // wrong row. Verify every single one, not a sample.
    const afterBig = await prisma.productVariant.findMany({
      where: { id: { in: bigVariantIds } },
      select: { id: true, stock_quantity: true },
    });
    const wrong = afterBig.filter((v) => v.stock_quantity !== 10 - bigWanted.get(v.id)!);
    check('...and every variant lost exactly its own quantity', wrong.length === 0,
      wrong.slice(0, 3));

    const totalTaken = afterBig.reduce((sum, v) => sum + (10 - v.stock_quantity), 0);
    check('...with no double-decrement anywhere', totalTaken === expectedUnits,
      { totalTaken, expectedUnits });

    // ─── Deleting it puts the stock back ─────────────────────
    //
    // The mirror image, and the statement POST /:id/delete now runs. It used
    // to be a sequential update per line inside Prisma's DEFAULT 5s budget —
    // the only order transaction without one — so the largest order on
    // production (48 lines) could not be deleted at all while every small one
    // could. Restocking the wrong row is the risk a batched UPDATE carries,
    // so every variant is checked, not a sample.
    //
    // Netting matters here too: one variant on two lines of the same order
    // must come back once with the sum, not twice.
    const dupVariant = bigVariantIds[0];
    const restock = new Map(bigWanted);
    restock.set(dupVariant, restock.get(dupVariant)! + 2);   // as if a second line held 2 more

    const restockRows = [...restock.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const restockStarted = Date.now();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE product_variants AS v
           SET stock_quantity = v.stock_quantity + d.qty
          FROM (VALUES ${Prisma.join(
            restockRows.map(([id, qty]) => Prisma.sql`(${id}::uuid, ${qty}::int)`),
          )}) AS d(id, qty)
         WHERE v.id = d.id
      `;
    }, { maxWait: 5_000, timeout: 8_000 });
    const restockElapsed = Date.now() - restockStarted;

    const afterRestock = await prisma.productVariant.findMany({
      where: { id: { in: bigVariantIds } },
      select: { id: true, stock_quantity: true },
    });
    // Everything back to its starting 10, except the duplicated one which
    // gained the extra 2 its second line carried.
    const expectedAfter = (id: string) => (id === dupVariant ? 12 : 10);
    const badRestock = afterRestock.filter((v) => v.stock_quantity !== expectedAfter(v.id));
    check(`restocking ${BIG} lines returns every variant exactly`,
      badRestock.length === 0, badRestock.slice(0, 3));
    check('...including the one netted across two lines',
      afterRestock.find((v) => v.id === dupVariant)?.stock_quantity === 12);
    check('...in one statement, well inside the budget', restockElapsed < 8_000, `${restockElapsed}ms`);

    // ─── Totals helper is exact, not floaty ──────────────────
    const odd = computeOrderTotals(
      [{ unit_price: new Prisma.Decimal('0.10'), quantity: 3 }],
      new Prisma.Decimal('0.20'),
    );
    check('0.10 x 3 + 0.20 === 0.50 exactly', odd.total.toString() === '0.5', odd.total.toString());
  } finally {
    if (orderIds.length) {
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (userIds.length) {
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (productIds.length) {
      await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    if (storeIds.length) await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    await prisma.$disconnect();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
