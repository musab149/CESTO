// ─── Integration test · a big cart through the CUSTOMER checkout ───────────
//
// Run:  cd packages/api && npm run test:big-cart
//
// bigOrders.test.ts covers the same question for the sales-rep path, where a
// shop restocking is obviously large. This is the customer path, which gets
// large for a less obvious reason: a household doing a full monthly shop, or
// a b2b buyer filling a pallet from the storefront rather than through a rep.
//
// The checkout itself was already made flat — decrementStock() applies every
// move in one statement — but the checkout is not the whole journey. The web
// app PUSHES ITS WHOLE CART to the server before quoting, so the real
// sequence is sync → quote → checkout, and a ceiling anywhere in that chain
// fails the order just as completely as a slow transaction would. The sync
// capped at 200 items, so a 400-line cart was refused before the checkout
// code ever ran, and the customer was shown "Checkout failed".
//
// So this tests the WHOLE chain at a size no one would shop at by accident,
// and asserts the two things that decide whether it survives on Neon:
// statement counts that do not grow with the cart, and stock arithmetic that
// is exactly right at scale.
//
// Goes through the real routes over HTTP. Creates its own fixtures and
// removes them in a finally.

// FIRST: switches on the per-statement events the count assertions read.
// Imports are hoisted, so an assignment here would run too late.
import './sales/enableQueryLog';
import http from 'http';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAccessToken } from '../lib/jwt';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++; console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

const stamp = String(Date.now()).slice(-6);

/**
 * How many SQL statements a block of work issues.
 *
 * Wall-clock on localhost says nothing — a round trip here is a tenth of a
 * millisecond and on Neon it is tens of milliseconds over the network. What
 * matters is whether the count GROWS WITH THE CART.
 */
let counting = false;
let statements = 0;
/**
 * Statements between BEGIN and COMMIT/ROLLBACK — the ones that spend the
 * checkout's transaction budget. Counted apart from the total because the
 * total also holds the reads before the transaction and the notifications
 * after it, which cost nothing against that budget.
 */
let inTx = false;
let txStatements = 0;
(prisma as unknown as { $on: (e: string, cb: (ev: { query: string }) => void) => void })
  .$on('query', (ev) => {
    if (!counting) return;
    statements += 1;
    const q = ev.query.trim().toUpperCase();
    if (q.startsWith('BEGIN')) { inTx = true; return; }
    if (q.startsWith('COMMIT') || q.startsWith('ROLLBACK')) { inTx = false; return; }
    if (inTx) txStatements += 1;
  });

async function countingStatements<T>(fn: () => Promise<T>): Promise<[T, number]> {
  counting = true;
  statements = 0;
  txStatements = 0;
  inTx = false;
  try {
    return [await fn(), statements];
  } finally {
    counting = false;
  }
}

/**
 * Lines in the big cart. Deliberately past the old 200 cap — the point is a
 * cart nobody would reach by accident but a monthly shop reaches on purpose.
 */
const BIG = 400;
/** And a small one, because "it works at scale" must not mean "only at scale". */
const SMALL = 3;
const QTY = 2;

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const opening = new Map<string, number>();

  const call = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
    const started = Date.now();
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return {
      status: res.status,
      ms: Date.now() - started,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: await res.json() as { success: boolean; error?: string; data?: any },
    };
  };

  try {
    // ─── Fixtures ────────────────────────────────────────────
    const variants = await prisma.productVariant.findMany({
      where: {
        is_active: true,
        product: { is_active: true },
        stock_quantity: { gte: QTY * 2 },
      },
      select: { id: true, product_id: true, stock_quantity: true },
      take: BIG,
    });
    if (variants.length < 50) {
      console.log(`  SKIP  only ${variants.length} variants with stock to work with`);
      return;
    }
    for (const v of variants) opening.set(v.id, v.stock_quantity);
    console.log(`  ..    ${variants.length} lines available for the big cart`);

    const user = await prisma.user.create({
      data: { name: `QA BigCart ${stamp}`, email: `qa.bigcart.${stamp}@cesto.test` },
      select: { id: true, email: true },
    });
    userIds.push(user.id);
    const token = generateAccessToken({ userId: user.id, email: user.email ?? undefined });

    const address = await prisma.address.create({
      data: {
        user_id: user.id, contact_name: 'QA', contact_phone: '600000000',
        street_line_1: 'C/ Test 1', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
      select: { id: true },
    });

    const cartBody = (n: number) => ({
      items: variants.slice(0, n).map((v) => ({
        productId: v.product_id, variantId: v.id, quantity: QTY,
      })),
    });

    // ─── 1. A SMALL cart still behaves ───────────────────────
    //
    // First, because every change made for the big case is a chance to break
    // the ordinary one, and the ordinary one is every order we take.
    const smallSync = await call('/api/cart', { method: 'PUT', token, body: cartBody(SMALL) });
    check(`a ${SMALL}-line cart syncs`, smallSync.status === 200,
      { status: smallSync.status, error: smallSync.body.error });

    const smallQuote = await call('/api/orders/quote', {
      method: 'POST', token, body: { addressId: address.id },
    });
    check('...and quotes', smallQuote.status === 200,
      { status: smallQuote.status, error: smallQuote.body.error });

    // ─── 2. The BIG cart, through the same three calls ───────
    const [bigSync, syncStmts] = await countingStatements(() =>
      call('/api/cart', { method: 'PUT', token, body: cartBody(variants.length) }));
    check(`a ${variants.length}-line cart syncs to the server`, bigSync.status === 200,
      { status: bigSync.status, error: bigSync.body.error });
    check('...in a fixed number of statements, not one per line',
      syncStmts <= 20, { statements: syncStmts, lines: variants.length });

    const serverCart = await call('/api/cart', { token });
    check('...and the server really holds every line',
      (serverCart.body.data?.items ?? []).length === variants.length,
      { got: (serverCart.body.data?.items ?? []).length, want: variants.length });

    const [bigQuote, quoteStmts] = await countingStatements(() =>
      call('/api/orders/quote', { method: 'POST', token, body: { addressId: address.id } }));
    check('the big cart quotes', bigQuote.status === 200,
      { status: bigQuote.status, error: bigQuote.body.error });
    check('...in a fixed number of statements', quoteStmts <= 20,
      { statements: quoteStmts });

    const before = new Map(
      (await prisma.productVariant.findMany({
        where: { id: { in: [...opening.keys()] } },
        select: { id: true, stock_quantity: true },
      })).map((r) => [r.id, r.stock_quantity]),
    );

    const [placed, placeStmts] = await countingStatements(() =>
      call('/api/orders', {
        method: 'POST', token, body: { addressId: address.id, paymentMethod: 'cod' },
      }));
    check(`a ${variants.length}-line order is PLACED`, placed.status === 201,
      { status: placed.status, error: placed.body.error });
    // Well inside the transaction budget (15s), with room to spare: locally a
    // big order takes a fraction of a second, so seconds here mean a regression.
    check('...well inside the transaction budget', placed.ms < 8000, { ms: placed.ms });
    /**
     * The number that actually decides this on Neon. A per-line statement at
     * 400 lines is 400 round trips inside an 8-second transaction; locally
     * that is a few milliseconds and passes, which is exactly why the count
     * is asserted and not the clock. A split across stores adds a few per
     * store, so the bound is generous but still nowhere near per-line.
     */
    check('...in a fixed number of statements, not one per line',
      placeStmts < 120, { statements: placeStmts, lines: variants.length });

    const placedPayload = placed.body.data ?? {};
    const shops = Array.isArray(placedPayload.orders) ? placedPayload.orders.length : 1;
    /**
     * AND NOT ONE PER SHOP, inside the transaction.
     *
     * The bound above allowed "a few per store", and that is what failed on
     * production on 2026-10-16: the API and the database sit an ocean apart,
     * so each sub-order's four round trips cost ~0.55s, and a ten-shop basket
     * ran past what was then an 8s budget (P2028). The transaction now writes every
     * sub-order in one statement and every line in another, so its count is
     * the same for one shop or twenty.
     */
    check(`...and the transaction itself takes a fixed number of statements, across ${shops} shop(s)`,
      txStatements <= 16, { txStatements, shops });

    // Printed whether or not it passed: the trend over time is the useful
    // thing, and a run that passes at 118 statements is worth noticing before
    // the one that fails at 121.
    console.log(`  ..    ${variants.length} lines · sync ${syncStmts} stmts · `
      + `quote ${quoteStmts} stmts · checkout ${placeStmts} stmts (${txStatements} in the transaction, `
      + `${shops} shops) in ${placed.ms}ms`);

    // The checkout may split by store, so collect whatever came back.
    const payload = placed.body.data ?? {};
    const ids: string[] = Array.isArray(payload.orders)
      ? payload.orders.map((o: { id: string }) => o.id)
      : payload.id ? [payload.id] : [];
    orderIds.push(...ids);
    if (payload.parent_order?.id) orderIds.push(payload.parent_order.id);

    // ─── 3. The arithmetic, which is the whole point ─────────
    const lineCount = await prisma.orderItem.count({ where: { order_id: { in: ids } } });
    check('every line of the cart reached the order', lineCount === variants.length,
      { got: lineCount, want: variants.length });

    const after = new Map(
      (await prisma.productVariant.findMany({
        where: { id: { in: [...opening.keys()] } },
        select: { id: true, stock_quantity: true },
      })).map((r) => [r.id, r.stock_quantity]),
    );
    const wrong: Array<{ id: string; was: number; is: number }> = [];
    for (const [id, was] of before) {
      const is = after.get(id) ?? -1;
      if (is !== was - QTY) wrong.push({ id, was, is });
    }
    check(`...taking exactly ${QTY} units from each of them`, wrong.length === 0,
      wrong.slice(0, 4));

    // ─── 4. And the cart is empty afterwards ─────────────────
    //
    // Cleared inside the transaction. If it survived, the next page load
    // offers to buy all 400 again.
    const leftover = await call('/api/cart', { token });
    check('the cart is emptied by a successful checkout',
      (leftover.body.data?.items ?? []).length === 0,
      { left: (leftover.body.data?.items ?? []).length });

  } finally {
    if (orderIds.length) {
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.parentOrder.deleteMany({ where: { id: { in: orderIds } } }).catch(() => {});
    }
    // Put back whatever the test took, so a re-run starts where this did.
    for (const [id, was] of opening) {
      await prisma.productVariant.update({ where: { id }, data: { stock_quantity: was } }).catch(() => {});
    }
    if (userIds.length) {
      await prisma.cartItem.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.userRefreshToken.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
