// ─── Integration test · editOrder() totals + cross-store split ──
//
// Run:  cd packages/api && npx ts-node src/lib/editOrder.test.ts
//
// Covers the two things an admin/partner edit must get right: every mutation
// kind (quantity change, remove, add, replace) lands on the item rows, and
// the order's subtotal/total are recomputed from the post-edit item set
// rather than left stale. Scenario 2 additionally checks that a cross-store
// replace retrofits the order onto a ParentOrder with its own sub-order.
//
// Creates its own throwaway category/store/products/order and removes them
// in a finally block. Touches the real seeded "Test User" + their
// serviceable address only to read their ids — never mutates either.

// Side-effect import only — pulls in the whole compiled program so the
// Express Request.user global augmentation (declared in middleware/auth.ts)
// resolves the same way it does for every other entrypoint. Mirrors
// routes/admin/storeZones.test.ts's own `import app from '../../server'`.
import '../server';
import prisma from './prisma';
import { editOrder } from './editOrder';
import { getDeliveryPricing, resolveDeliveryFee } from './delivery-pricing';
import { generateOrderNumber } from './pagination';
import { Prisma } from '@prisma/client';

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

async function main() {
  const categoryId = (await prisma.category.create({
    data: { name_es: 'Test Edit Category', name_en: 'Test Edit Category' },
  })).id;
  const foreignStoreId = (await prisma.store.create({
    data: { slug: `test-edit-store-${Date.now()}`, name: 'Test Edit Foreign Store' },
  })).id;

  const productIds: string[] = [];
  const variantIds: Record<string, string> = {};

  async function makeProduct(nameSuffix: string, price: string, storeId: string | null) {
    const product = await prisma.product.create({
      data: {
        name_es: `Test ${nameSuffix}`, name_en: `Test ${nameSuffix}`,
        category_id: categoryId,
        store_id: storeId,
        variants: { create: [{ name_es: 'Default', name_en: 'Default', price: new Prisma.Decimal(price), stock_quantity: 100, is_default: true }] },
      },
      include: { variants: true },
    });
    productIds.push(product.id);
    variantIds[nameSuffix] = product.variants[0].id;
    return product;
  }

  const cheapProduct = await makeProduct('cheap', '10.00', null);
  const midProduct = await makeProduct('mid', '11.00', null);
  const priceyProduct = await makeProduct('pricey', '12.10', null);
  const foreignProduct = await makeProduct('foreign', '20.00', foreignStoreId);

  // Any saved address will do. This used to require one bound to a delivery
  // zone, because the zone decided the fee; with coverage removed every
  // address is deliverable and the fee comes from platform settings.
  const user = await prisma.user.findFirst({ where: { addresses: { some: {} } }, select: { id: true } });
  const address = user
    ? await prisma.address.findFirst({
        where: { user_id: user.id },
        select: { id: true, latitude: true, longitude: true },
      })
    : null;
  if (!user || !address) throw new Error('No seeded user with an address found — cannot run this test.');

  // Priced through the same resolver the code under test uses, so this test
  // asserts consistency rather than re-implementing the pricing rules — and
  // so it keeps passing whether the environment is in flat or distance mode.
  const deliveryPricing = await getDeliveryPricing();
  const destination =
    address.latitude !== null && address.longitude !== null
      ? { lat: address.latitude, lng: address.longitude }
      : null;

  let orderId = '';
  let parentOrderId = '';

  try {
    // ─── Scenario 1: single-store order, mixed edit (update_qty + remove + add) ───
    const cheapVariant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds.cheap } });
    const midVariant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIds.mid } });

    const cheapLineTotal = cheapVariant.price.mul(1);
    const midLineTotal = midVariant.price.mul(1);
    const initialSubtotal = cheapLineTotal.plus(midLineTotal);
    const initialDeliveryFee = resolveDeliveryFee({
      subtotal: initialSubtotal,
      pricing: deliveryPricing,
      destination,
    }).fee;
    const order = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(),
        user_id: user.id,
        address_id: address.id,
        address_snapshot: {} as Prisma.InputJsonValue,
        payment_method: 'cod',
        subtotal: initialSubtotal,
        delivery_fee: initialDeliveryFee,
        total: initialSubtotal.plus(initialDeliveryFee),
        items: {
          create: [
            {
              product_id: cheapProduct.id, variant_id: cheapVariant.id, quantity: 1,
              unit_price: cheapVariant.price, line_total: cheapLineTotal,
              product_snapshot: {} as Prisma.InputJsonValue,
            },
            {
              product_id: midProduct.id, variant_id: midVariant.id, quantity: 1,
              unit_price: midVariant.price, line_total: midLineTotal,
              product_snapshot: {} as Prisma.InputJsonValue,
            },
          ],
        },
      },
      include: { items: true },
    });
    orderId = order.id;

    const cheapItemId = order.items.find((i) => i.variant_id === cheapVariant.id)!.id;
    const midItemId = order.items.find((i) => i.variant_id === midVariant.id)!.id;

    const result = await editOrder(
      order.id,
      [
        { action: 'update_qty', order_item_id: cheapItemId, new_quantity: 3 },
        { action: 'remove', order_item_id: midItemId },
        { action: 'add', new_variant_id: variantIds.pricey, new_quantity: 2 },
      ],
      { type: 'partner', partnerUserId: user.id }
    );

    check('edit succeeded', result.status === 'edited', result);
    if (result.status !== 'edited') throw new Error('Edit did not succeed, aborting scenario 1 assertions.');

    const editedOrder = result.order;
    const editedItems = editedOrder.items;

    check('mid-priced item actually removed', !editedItems.some((i) => i.id === midItemId), editedItems);
    check('exactly 2 items remain (cheap qty-updated + pricey added)', editedItems.length === 2, editedItems);

    const editedCheapItem = editedItems.find((i) => i.variant_id === cheapVariant.id);
    const editedPriceyItem = editedItems.find((i) => i.variant_id === variantIds.pricey);

    check('cheap item quantity updated to 3', editedCheapItem?.quantity === 3, editedCheapItem);
    const expectedCheapLineTotal = cheapVariant.price.mul(3);
    check('cheap item line_total recomputed for new qty', editedCheapItem?.line_total.equals(expectedCheapLineTotal) ?? false, editedCheapItem);
    const expectedSubtotal = expectedCheapLineTotal.plus(priceyProduct.variants[0].price.mul(2));
    check('subtotal recomputed from the post-edit item set', editedOrder.subtotal.equals(expectedSubtotal), editedOrder.subtotal);
    check(
      'total = recomputed subtotal + unchanged delivery fee',
      editedOrder.total.equals(expectedSubtotal.plus(editedOrder.delivery_fee)),
      { total: editedOrder.total, subtotal: editedOrder.subtotal, fee: editedOrder.delivery_fee }
    );

    // ─── Scenario 1b: a quantity AND a discount on ONE line ─────
    //
    // Admin's edit modal sends exactly this pair — deliberately, with a
    // comment saying so — because changing how many and changing the price
    // off are two separate facts about one line.
    //
    // It was refused outright for a while: a guard written against a real
    // stock-loss bug counted OPERATIONS per line when the thing that actually
    // has to be unique is stock MOVES, and a discount moves none. The refusal
    // was a working admin screen being told its own request was invalid.
    //
    // The arithmetic is the other half. Each branch used to read the row as it
    // arrived, so update_qty computed the line total from the OLD discount and
    // set_discount from the OLD quantity. Whichever ran second won, with one
    // stale input, and the order subtotal is summed from these — so the whole
    // order was wrong by the difference. Both now read the shared patch.
    const DISCOUNT = 2;
    const bothResult = await editOrder(
      order.id,
      [
        { action: 'update_qty', order_item_id: cheapItemId, new_quantity: 5 },
        { action: 'set_discount', order_item_id: cheapItemId, discount_amount: DISCOUNT },
      ],
      { type: 'partner', partnerUserId: user.id }
    );
    check('a quantity change and a discount on one line is ACCEPTED',
      bothResult.status === 'edited', bothResult);

    if (bothResult.status === 'edited') {
      const line = bothResult.order.items.find((i) => i.id === cheapItemId);
      check('...the quantity is the new one', line?.quantity === 5, line?.quantity);
      check('...the discount is recorded',
        Number(line?.discount_amount ?? 0) === DISCOUNT, line?.discount_amount);
      // The assertion that would have failed: price x NEW qty, less the NEW
      // discount. Reading either input off the original row gets this wrong.
      const want = cheapVariant.price.mul(5).minus(DISCOUNT);
      check('...and line_total is new qty AND new discount, not one of each',
        line?.line_total.equals(want) ?? false,
        { got: line?.line_total?.toString(), want: want.toString() });

      const sumOfLines = bothResult.order.items.reduce(
        (acc, i) => acc.plus(i.line_total), new Prisma.Decimal(0),
      );
      check('...so the order subtotal still equals the sum of its lines',
        bothResult.order.subtotal.equals(sumOfLines),
        { subtotal: bothResult.order.subtotal.toString(), lines: sumOfLines.toString() });
    }

    // Two STOCK MOVES on one line stay refused — that was the real bug, and
    // narrowing the guard must not have reopened it.
    const twoMoves = await editOrder(
      order.id,
      [
        { action: 'update_qty', order_item_id: cheapItemId, new_quantity: 9 },
        { action: 'remove', order_item_id: cheapItemId },
      ],
      { type: 'partner', partnerUserId: user.id }
    );
    check('two stock moves on one line are still refused',
      twoMoves.status === 'invalid_operation', twoMoves);

    // And two discounts on one line: a client bug either way, and the second
    // would silently win.
    const twoDiscounts = await editOrder(
      order.id,
      [
        { action: 'set_discount', order_item_id: cheapItemId, discount_amount: 1 },
        { action: 'set_discount', order_item_id: cheapItemId, discount_amount: 3 },
      ],
      { type: 'partner', partnerUserId: user.id }
    );
    check('two discounts on one line are refused',
      twoDiscounts.status === 'invalid_operation', twoDiscounts);

    // ─── Scenario 2: cross-store replace → retrofit ParentOrder, verify
    // the new sub-order and the parent aggregate are both totalled ───
    const crossResult = await editOrder(
      order.id,
      [{ action: 'replace', order_item_id: editedPriceyItem!.id, new_variant_id: variantIds.foreign, new_quantity: 1 }],
      { type: 'partner', partnerUserId: user.id }
    );
    check('cross-store replace succeeded', crossResult.status === 'edited', crossResult);
    if (crossResult.status === 'edited') {
      check('cross-store replace created exactly one new sub-order', crossResult.newOrders.length === 1, crossResult.newOrders);
      const refreshedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      parentOrderId = refreshedOrder.parent_order_id ?? '';
      check('original order retrofit onto a new ParentOrder', !!parentOrderId, refreshedOrder);

      if (crossResult.newOrders.length === 1) {
        const subOrder = await prisma.order.findUniqueOrThrow({ where: { id: crossResult.newOrders[0].id } });
        const foreignLineTotal = foreignProduct.variants[0].price.mul(1);
        check('new sub-order subtotal is its own single line', subOrder.subtotal.equals(foreignLineTotal), subOrder.subtotal);
        check('new sub-order carries no delivery fee (parent holds it)', subOrder.delivery_fee.isZero(), subOrder.delivery_fee);
        check('new sub-order total equals its subtotal', subOrder.total.equals(foreignLineTotal), subOrder.total);

        const parent = await prisma.parentOrder.findUniqueOrThrow({ where: { id: parentOrderId } });
        const subs = await prisma.order.findMany({
          where: { parent_order_id: parentOrderId, deleted_at: null },
          select: { subtotal: true, total: true },
        });
        const subSubtotalSum = subs.reduce((acc, x) => acc.plus(x.subtotal), new Prisma.Decimal(0));
        const subTotalSum = subs.reduce((acc, x) => acc.plus(x.total), new Prisma.Decimal(0));
        check('ParentOrder.subtotal equals sum of sub-order subtotals', parent.subtotal.equals(subSubtotalSum), {
          parent: parent.subtotal, subs: subSubtotalSum,
        });
        // The PARTS plus the one delivery, not the parts alone.
        //
        // This asserted `parent.total === subTotalSum` and passed, because
        // Pass 5 re-derived delivery_fee_total by summing the parts' fees —
        // all zero — and wrote 0 over the fee the retrofit had just carried
        // across. The assertion was describing the bug: the split silently
        // dropped what this order's delivery had been priced at.
        check('ParentOrder keeps the fee the retrofit moved onto it',
          parent.delivery_fee_total.equals(initialDeliveryFee), {
            parent: parent.delivery_fee_total, want: initialDeliveryFee,
          });
        check('ParentOrder.total equals sum of sub-order totals PLUS that fee',
          parent.total.equals(subTotalSum.plus(parent.delivery_fee_total)), {
            parent: parent.total, subs: subTotalSum, fee: parent.delivery_fee_total,
          });
      }
    }
  } finally {
    if (orderId) {
      await prisma.orderEditLog.deleteMany({ where: { order_id: orderId } });
      const siblingOrders = parentOrderId
        ? await prisma.order.findMany({ where: { parent_order_id: parentOrderId }, select: { id: true } })
        : [{ id: orderId }];
      for (const o of siblingOrders) {
        await prisma.orderEditLog.deleteMany({ where: { order_id: o.id } });
        await prisma.orderItem.deleteMany({ where: { order_id: o.id } });
      }
      await prisma.order.deleteMany({ where: { id: { in: siblingOrders.map((o) => o.id) } } });
      if (parentOrderId) await prisma.parentOrder.delete({ where: { id: parentOrderId } }).catch(() => {});
    }
    await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.store.delete({ where: { id: foreignStoreId } }).catch(() => {});
    await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
