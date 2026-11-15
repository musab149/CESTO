// ─── Integration test · the /api/sales/* surface ───────────────────────────
//
// Run:  cd packages/api && npm run test:sales-api
//
// A rep works from a tablet in a van, and the whole security model is that
// `/api/sales/*` exposes only what a rep may do. Two things have to hold, and
// neither is visible from reading a route in isolation:
//
//   · SCOPE. A rep sees their book of business and nothing else. Not the
//     customer base, not another rep's clients, not another rep's orders —
//     including by direct id, and answering 404 rather than 403 so an id they
//     cannot see is not confirmed to exist.
//
//   · THE RULES ARE THE SAME ONES STAFF GET. Orders a rep builds go through
//     lib/createOrder, so a draft must take no stock and a placed order must
//     take exactly its stock, exactly as in the admin panel. That is the
//     reason the implementation is shared rather than copied, and this is
//     where "shared" is actually checked.
//
// Goes through the real routes over HTTP. Creates its own fixtures and removes
// them in a finally.

import http from 'http';
import app from '../../server';
import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { generateAccessToken } from '../../lib/jwt';
import { busiestShop, repShop } from '../../lib/testRepShop';
import bcrypt from 'bcryptjs';
import { madridDayStart, madridToday } from '../../lib/repEarnings';

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

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const invoiceIds: string[] = [];
  const addressIds: string[] = [];
  const productIds: string[] = [];
  let variantId: string | null = null;
  let startingStock = 0;

  try {
    const call = async (path: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
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
        body: await res.json() as { success: boolean; error?: string; data?: any },
      };
    };

    // ─── Fixtures ────────────────────────────────────────────
    // A rep sells from one shop (lib/repStore): both sell from the same one,
    // and every product they sell below comes from it.
    const shopId = await busiestShop({ stock_quantity: { gte: 10 } });
    // Two reps, so "their own" can be told apart from "anyone's".
    const mkRep = async (tag: string) => {
      const u = await prisma.user.create({
        data: { name: `QA ${tag} ${stamp}`, email: `qa.${tag}.${stamp}@cesto.test` },
      });
      userIds.push(u.id);
      await prisma.salesRep.create({ data: { user_id: u.id, is_active: true, ...repShop(shopId) } });
      return { id: u.id, token: generateAccessToken({ userId: u.id, email: u.email ?? undefined }) };
    };
    const rep = await mkRep('rep');
    const other = await mkRep('otherrep');
    // An admin, for an account the office opened (section 12).
    const anAdminForFind = await prisma.admin.findFirst({ select: { id: true } });

    // A client belonging to `other`, which `rep` must never see.
    const theirClient = await prisma.user.create({
      data: {
        name: `QA Theirs ${stamp}`, email: `qa.theirs.${stamp}@cesto.test`,
        created_by_sales_rep_id: other.id,
      },
    });
    userIds.push(theirClient.id);

    // A plain customer nobody opened — the customer base this must not expose.
    const stranger = await prisma.user.create({
      data: { name: `QA Stranger ${stamp}`, email: `qa.stranger.${stamp}@cesto.test` },
    });
    userIds.push(stranger.id);

    // Something sellable, with enough stock to tell a draft from a placed order.
    const variant = await prisma.productVariant.findFirst({
      where: { is_active: true, product: { is_active: true, store_id: shopId }, stock_quantity: { gte: 10 } },
      select: { id: true, stock_quantity: true, product: { select: { name_es: true } } },
    });
    if (!variant) { console.log('  SKIP  no in-stock active variant to sell'); return; }
    variantId = variant.id;
    startingStock = variant.stock_quantity;

    // ─── 1. A rep opens a client ─────────────────────────────
    const created = await call('/api/sales/clients', {
      method: 'POST', token: rep.token,
      body: {
        name: `QA Shop ${stamp}`,
        email: `qa.shop.${stamp}@cesto.test`,
        client_type: 'business',
        business: { company: `QA Shop SL ${stamp}` },
        address: {
          contact_name: 'QA Shop', contact_phone: '600111222',
          street_line_1: 'C/ Mayor 1', postcode: '28013', city: 'Madrid', province: 'Madrid',
        },
        // No email out of a test run.
        send_credentials: false,
      },
    });
    check('a rep can open a client', created.status === 201,
      { status: created.status, error: created.body.error });
    const client = created.body.data?.client as { id: string; addresses: { id: string }[] } | undefined;
    if (!client) { console.log('  ABORT  client was not created'); return; }
    userIds.push(client.id);
    addressIds.push(...client.addresses.map((a) => a.id));
    check('...with the address they took at the counter', client.addresses.length === 1);

    // The one record of who owns the relationship must be the rep themselves,
    // not whatever they typed.
    const row = await prisma.user.findUnique({
      where: { id: client.id },
      select: { created_by_sales_rep_id: true, sales_manager_name: true, created_by_admin_id: true },
    });
    check('...attributed to the rep, not to staff',
      row?.created_by_sales_rep_id === rep.id && row?.created_by_admin_id === null, row);
    check('...and the sales manager is the rep, who cannot type someone else in',
      row?.sales_manager_name === `QA rep ${stamp}`, row?.sales_manager_name);

    // A rep must not be able to hand themselves a shop.
    const vendorAttempt = await call('/api/sales/clients', {
      method: 'POST', token: rep.token,
      body: {
        name: `QA Vendor ${stamp}`, email: `qa.vendor.${stamp}@cesto.test`,
        client_type: 'retail', send_credentials: false,
        address: {
          contact_name: 'V', contact_phone: '600111333',
          street_line_1: 'C/ Uno 1', postcode: '28013', city: 'Madrid', province: 'Madrid',
        },
        vendor: { store_name: `QA Sneaky Store ${stamp}` },
      },
    });
    const sneaky = await prisma.store.findFirst({ where: { name: `QA Sneaky Store ${stamp}` } });
    check('a rep cannot open a vendor store', sneaky === null,
      { status: vendorAttempt.status, storeCreated: sneaky !== null });
    // Refused, not quietly ignored. A silently stripped field makes a wrong
    // caller look like a working one.
    check('...and the attempt is REFUSED, not silently stripped',
      vendorAttempt.status === 422, { status: vendorAttempt.status, error: vendorAttempt.body.error });
    const sneakyUser = vendorAttempt.body.data?.client?.id as string | undefined;
    if (sneakyUser) userIds.push(sneakyUser);

    // Same for the ownership record: a rep must not be able to put a colleague's
    // name on a client they opened.
    const spoof = await call('/api/sales/clients', {
      method: 'POST', token: rep.token,
      body: {
        name: `QA Spoof ${stamp}`, email: `qa.spoof.${stamp}@cesto.test`,
        client_type: 'retail', send_credentials: false,
        sales_manager_name: 'Someone Else',
        address: {
          contact_name: 'S', contact_phone: '600111444',
          street_line_1: 'C/ Dos 2', postcode: '28013', city: 'Madrid', province: 'Madrid',
        },
      },
    });
    check('a rep cannot name someone else as the account manager', spoof.status === 422,
      { status: spoof.status, error: spoof.body.error });
    const spoofUser = spoof.body.data?.client?.id as string | undefined;
    if (spoofUser) userIds.push(spoofUser);

    // ─── 2. Scope: their book, and only their book ───────────
    const book = await call('/api/sales/clients?limit=100', { token: rep.token });
    const bookIds = ((book.body.data?.items ?? []) as { id: string }[]).map((c) => c.id);
    check('their book lists the client they opened', bookIds.includes(client.id));
    check("...and NOT another rep's client", !bookIds.includes(theirClient.id));
    check('...and not the customer base', !bookIds.includes(stranger.id), bookIds.length);

    // Searching must not be a way around the scope.
    const hunt = await call(`/api/sales/clients?q=QA%20Stranger%20${stamp}`, { token: rep.token });
    check('searching cannot reach outside the book',
      ((hunt.body.data?.items ?? []) as unknown[]).length === 0);

    const byId = await call(`/api/sales/clients/${stranger.id}`, { token: rep.token });
    check('nor can a direct id', byId.status === 404, byId.status);
    check("...and the refusal does not confirm the account exists",
      byId.status === 404 && !(byId.body.error ?? '').toLowerCase().includes('permission'),
      byId.body.error);

    // ─── 3. Pricing is the CLIENT's, not the rep's ───────────
    // The client above is a business on b2b, so a variant with a wholesale
    // price must quote it. Otherwise the rep reads retail on screen and the
    // total changes when they press Create.
    await prisma.user.update({ where: { id: client.id }, data: { pricing_mode: 'b2b' } });
    const b2bVariant = await prisma.productVariant.findFirst({
      where: { is_active: true, product: { is_active: true, store_id: shopId }, b2b_price: { not: null } },
      select: { id: true, price: true, b2b_price: true, product: { select: { id: true, name_es: true } } },
    });
    if (b2bVariant && !b2bVariant.b2b_price!.equals(b2bVariant.price)) {
      const quoted = await call(
        `/api/sales/catalogue/products?for_client=${client.id}&q=${encodeURIComponent(b2bVariant.product.name_es)}&limit=60`,
        { token: rep.token },
      );
      // `Paged<Product>` with nested variants — the same shape the admin
      // catalogue serves, because the rep panel is the admin panel.
      type Row = { variants: { id: string; price: string; compare_at_price: string | null }[] };
      const line = ((quoted.body.data?.items ?? []) as Row[])
        .flatMap((p) => p.variants)
        .find((v) => v.id === b2bVariant.id);
      check('the catalogue quotes the wholesale price for a wholesale client',
        line !== undefined && Number(line.price) === Number(b2bVariant.b2b_price),
        { quoted: line?.price, b2b: b2bVariant.b2b_price?.toString(), retail: b2bVariant.price.toString() });
      // A retail "was" above a trade price would read as a discount nobody is
      // offering, so it is cleared alongside the wholesale price.
      check('...and drops the retail compare-at that would look like a discount',
        line?.compare_at_price == null, line?.compare_at_price);
      check('...without ever putting b2b_price on the wire',
        !JSON.stringify(quoted.body.data).includes('b2b_price'));

      // The Catálogo tab: nobody picked, so both prices, labelled.
      const q = encodeURIComponent(b2bVariant.product.name_es);
      const browse = await call(`/api/sales/catalogue/products?prices=both&q=${q}&limit=60`, { token: rep.token });
      type BrowseRow = { audience?: string; variants: { id: string; price: string; b2b_price?: string | null }[] };
      const browsed = (browse.body.data?.items ?? []) as BrowseRow[];
      const both = browsed.flatMap((p) => p.variants).find((v) => v.id === b2bVariant.id);
      check('browsing with prices=both shows a size\'s retail AND its wholesale price',
        both !== undefined && Number(both.price) === Number(b2bVariant.price) && Number(both.b2b_price) === Number(b2bVariant.b2b_price),
        { price: both?.price, b2b: both?.b2b_price, want: [b2bVariant.price.toString(), b2bVariant.b2b_price?.toString()] });
      check('...and says who each product is shown to',
        browsed.length > 0 && browsed.every((p) => ['all', 'b2c', 'b2b'].includes(p.audience ?? '')),
        browsed.map((p) => p.audience));
      const forClient = await call(`/api/sales/catalogue/products?prices=both&for_client=${client.id}&q=${q}&limit=60`, { token: rep.token });
      const quotedAgain = ((forClient.body.data?.items ?? []) as BrowseRow[]).flatMap((p) => p.variants).find((v) => v.id === b2bVariant.id);
      check('...but never for a client: there prices=both is ignored and the client\'s price stands',
        forClient.status === 200 && !JSON.stringify(forClient.body.data).includes('b2b_price')
          && Number(quotedAgain?.price) === Number(b2bVariant.b2b_price),
        { status: forClient.status, price: quotedAgain?.price });
      const bad = await call('/api/sales/catalogue/products?prices=all', { token: rep.token });
      check('...and prices takes only "both"', bad.status === 422, bad.status);

      // The Catálogo's "new order": one product, read again for the client.
      const one = await call(`/api/sales/catalogue/products?productId=${b2bVariant.product.id}&for_client=${client.id}`, { token: rep.token });
      const oneItems = (one.body.data?.items ?? []) as BrowseRow[];
      const oneLine = oneItems.flatMap((p) => p.variants).find((v) => v.id === b2bVariant.id);
      check('productId finds that one product, priced for the client',
        oneItems.length === 1 && Number(oneLine?.price) === Number(b2bVariant.b2b_price),
        { n: oneItems.length, price: oneLine?.price });
      const elsewhere = await prisma.product.findFirst({
        where: { is_active: true, store_id: { not: null }, NOT: { store_id: shopId } },
        select: { id: true },
      });
      if (elsewhere) {
        const outside = await call(`/api/sales/catalogue/products?productId=${elsewhere.id}`, { token: rep.token });
        check('...and finds nothing for a product outside the rep\'s shops',
          outside.status === 200 && (outside.body.data?.items ?? []).length === 0, outside.body.data?.total);
      }
    } else {
      console.log('  SKIP  no variant with a distinct b2b price to quote');
    }

    /**
     * ACTIVE ONLY, and not negotiable from the query string. The filter is
     * admin's, shared code, and admin legitimately browses inactive rows — so
     * the forcing has to happen AFTER the filters are built or a rep could ask
     * for what createOrder will refuse at the end of a built basket.
     */
    const sneakyInactive = await call(
      '/api/sales/catalogue/products?isActive=false&limit=100', { token: rep.token },
    );
    type Row = { is_active: boolean };
    const inactive = ((sneakyInactive.body.data?.items ?? []) as Row[])
      .filter((p) => !p.is_active);
    check('asking for inactive products still returns only active ones',
      sneakyInactive.status === 200 && inactive.length === 0,
      { status: sneakyInactive.status, inactive: inactive.length });

    // The taxonomy behind the ported filter rail. Read-only reference data,
    // but it still has to be behind the role like everything else here.
    const taxonomy = await Promise.all([
      call('/api/sales/catalogue/categories', { token: rep.token }),
      call('/api/sales/catalogue/subcategories', { token: rep.token }),
      call('/api/sales/catalogue/brands', { token: rep.token }),
      call('/api/sales/catalogue/origins', { token: rep.token }),
      call('/api/sales/catalogue/stores', { token: rep.token }),
    ]);
    check('the filter rail has every list it reads',
      taxonomy.every((r) => r.status === 200), taxonomy.map((r) => r.status));

    const forTheirs = await call(
      `/api/sales/catalogue/products?for_client=${theirClient.id}`, { token: rep.token },
    );
    check("a rep cannot price against another rep's client", forTheirs.status === 404,
      forTheirs.status);

    // ─── 4. A DRAFT TAKES NO STOCK ──────────────────────────
    // The single most consequential rule shared with the admin path: `draft`
    // means stock was deliberately not reserved, and cancel/delete/confirm all
    // depend on it.
    const draft = await call('/api/sales/orders', {
      method: 'POST', token: rep.token,
      body: {
        user_id: client.id,
        address_id: client.addresses[0].id,
        status: 'draft',
        items: [{ variant_id: variantId, quantity: 3 }],
      },
    });
    check('a rep can park a draft', draft.status === 201,
      { status: draft.status, error: draft.body.error });
    if (draft.body.data?.order?.id) orderIds.push(draft.body.data.order.id);
    const afterDraft = await prisma.productVariant.findUnique({
      where: { id: variantId }, select: { stock_quantity: true },
    });
    check('...and it reserves NOTHING', afterDraft?.stock_quantity === startingStock,
      { before: startingStock, after: afterDraft?.stock_quantity });

    // ─── 5. A placed order takes exactly its stock ──────────
    const placed = await call('/api/sales/orders', {
      method: 'POST', token: rep.token,
      body: {
        user_id: client.id,
        address_id: client.addresses[0].id,
        items: [{ variant_id: variantId, quantity: 2 }],
      },
    });
    check('a rep can place an order', placed.status === 201,
      { status: placed.status, error: placed.body.error });
    const placedId = placed.body.data?.order?.id as string | undefined;
    if (placedId) orderIds.push(placedId);
    const afterPlaced = await prisma.productVariant.findUnique({
      where: { id: variantId }, select: { stock_quantity: true },
    });
    check('...and takes exactly what it sold', afterPlaced?.stock_quantity === startingStock - 2,
      { before: startingStock, after: afterPlaced?.stock_quantity });

    const attribution = await prisma.order.findUnique({
      where: { id: placedId! },
      select: { created_by_sales_rep_id: true, created_by_admin_id: true, store_id: true },
    });
    check('...attributed to the rep and to no admin',
      attribution?.created_by_sales_rep_id === rep.id && attribution?.created_by_admin_id === null,
      attribution);
    check('...and owned by Cesto, so no partner dashboard shows it',
      attribution?.store_id === null);

    // Netted per variant, not per line: 3 + 3 against a stock of 5 must fail.
    const oversell = await call('/api/sales/orders', {
      method: 'POST', token: rep.token,
      body: {
        user_id: client.id,
        address_id: client.addresses[0].id,
        items: [
          { variant_id: variantId, quantity: startingStock },
          { variant_id: variantId, quantity: startingStock },
        ],
      },
    });
    check('two lines of the same variant are netted before the stock check',
      oversell.status === 400, oversell.status);
    check('...and the refusal says how many are left',
      Array.isArray(oversell.body.data?.shortfalls) && oversell.body.data.shortfalls.length > 0,
      oversell.body.data);

    // ─── 6. Building for someone outside the book ───────────
    const forStranger = await call('/api/sales/orders', {
      method: 'POST', token: rep.token,
      body: {
        user_id: stranger.id,
        address_id: client.addresses[0].id,
        items: [{ variant_id: variantId, quantity: 1 }],
      },
    });
    check('a rep cannot build an order for someone outside their book',
      forStranger.status === 404, forStranger.status);

    // ─── 7. Their orders, and only theirs ───────────────────
    const theirOrder = await prisma.order.create({
      data: {
        order_number: `QA-${stamp}-OTHER`,
        user_id: theirClient.id,
        address_id: client.addresses[0].id,
        address_snapshot: {},
        payment_method: 'cod', status: 'pending',
        subtotal: new Prisma.Decimal('10.00'),
        delivery_fee: new Prisma.Decimal(0),
        total: new Prisma.Decimal('10.00'),
        created_by_sales_rep_id: other.id,
      },
    });
    orderIds.push(theirOrder.id);

    const mine = await call('/api/sales/orders?limit=100', { token: rep.token });
    const mineIds = ((mine.body.data?.items ?? []) as { id: string }[]).map((o) => o.id);
    check('their order list holds the orders they built', mineIds.includes(placedId!));
    check("...and not another rep's", !mineIds.includes(theirOrder.id));

    const peek = await call(`/api/sales/orders/${theirOrder.id}`, { token: rep.token });
    check("another rep's order is not found by id", peek.status === 404, peek.status);

    // ─── 8. The boundary: their own work, not ops' ─────────
    //
    // WHAT OPS OWNS IS ABSENT, not refused. That is the claim the whole design
    // rests on, and a 404 from an unmatched route is the proof — there is no
    // guard to get wrong because there is no handler.
    const absent = await Promise.all([
      // The fulfilment march. A rep marking goods delivered from a shop
      // counter would be stating something they cannot know.
      call(`/api/sales/orders/${placedId}/status`, { method: 'PUT', token: rep.token, body: { status: 'delivered' } }),
      // The destructive path.
      call(`/api/sales/orders/${placedId}/delete`, { method: 'POST', token: rep.token, body: {} }),
      // A rep does not know who is free.
      call(`/api/sales/orders/${placedId}/rider`, { method: 'PUT', token: rep.token, body: { riderId: null } }),
    ]);
    check('status, delete and rider are ABSENT, not guarded',
      absent.every((r) => r.status === 404), absent.map((r) => r.status));

    /**
     * INVOICING USED TO BE ON THAT LIST, on the reasoning that a factura is
     * issued once and cannot be unissued. It is a rep's now: an albarán is
     * what they hand over at the counter, and a document nobody can issue
     * until the office opens is not a document they have.
     *
     * The line that was deleted from the list above is left as a check of its
     * own rather than silently dropped, because the boundary moving is the
     * sort of thing to state. A factura stays the office's alone, by policy on
     * every route — see routes/sales/invoices.test.ts, which covers drafting,
     * issuing, scope and the refusals.
     */
    const doc = await call(`/api/sales/orders/${placedId}/invoice`, {
      method: 'POST', token: rep.token, body: { kind: 'albaran' },
    });
    check('invoicing is PRESENT now, and scoped to their own order',
      doc.status === 201, { status: doc.status, error: doc.body.error });
    const docId = (doc.body.data as { invoice?: { id: string } } | undefined)?.invoice?.id;
    if (docId) invoiceIds.push(docId);

    // ─── 9. The actions they DO get ────────────────────────
    //
    // Each is work on an order they built ten seconds ago, and the alternative
    // to having it is ringing the office.
    const itemId = (await prisma.orderItem.findFirst({
      where: { order_id: placedId }, select: { id: true, quantity: true },
    }))!;

    const edited = await call(`/api/sales/orders/${placedId}/items`, {
      method: 'PUT', token: rep.token,
      body: {
        operations: [{ action: 'update_qty', order_item_id: itemId.id, new_quantity: 1 }],
        note: 'client changed their mind',
      },
    });
    check('a rep can edit an order they built', edited.status === 200,
      { status: edited.status, error: edited.body.error });

    // The edit log has to name the person, and say what kind of person they
    // are. `admin` would name nobody; `customer` would read as the client
    // editing their own order.
    const log = await prisma.orderEditLog.findFirst({
      where: { order_id: placedId },
      orderBy: { created_at: 'desc' },
      select: { editor_type: true, editor_sales_rep_id: true, editor_admin_id: true, editor_customer_id: true },
    });
    check('...logged as a sales rep, naming which one',
      log?.editor_type === 'sales_rep' && log?.editor_sales_rep_id === rep.id, log);
    check('...and not misattributed to an admin or the client',
      log?.editor_admin_id === null && log?.editor_customer_id === null, log);

    const feeSet = await call(`/api/sales/orders/${placedId}/delivery-fee`, {
      method: 'PUT', token: rep.token, body: { delivery_fee: 0 },
    });
    check('a rep can waive the delivery fee after the fact', feeSet.status === 200,
      { status: feeSet.status, error: feeSet.body.error });

    const noted = await call(`/api/sales/orders/${placedId}/notes`, {
      method: 'PUT', token: rep.token, body: { customer_notes: 'leave it next door' },
    });
    check("a rep can fix the client's note", noted.status === 200, noted.status);
    const notes = await prisma.order.findUnique({
      where: { id: placedId }, select: { customer_notes: true, admin_notes: true },
    });
    check("...writing the CLIENT's note, never the internal one",
      notes?.customer_notes === 'leave it next door' && notes?.admin_notes === null, notes);

    // Cancelling gives the stock back. The one status change that is theirs.
    const beforeCancel = (await prisma.productVariant.findUnique({
      where: { id: variantId }, select: { stock_quantity: true },
    }))!.stock_quantity;
    const held = (await prisma.orderItem.findMany({
      where: { order_id: placedId }, select: { quantity: true },
    })).reduce((n, i) => n + i.quantity, 0);

    const cancelled = await call(`/api/sales/orders/${placedId}/cancel`, {
      method: 'PUT', token: rep.token, body: { reason: 'client changed their mind' },
    });
    check('a rep can cancel an order they built', cancelled.status === 200,
      { status: cancelled.status, error: cancelled.body.error });
    const afterCancel = (await prisma.productVariant.findUnique({
      where: { id: variantId }, select: { stock_quantity: true },
    }))!.stock_quantity;
    check('...and the stock comes back', afterCancel === beforeCancel + held,
      { before: beforeCancel, held, after: afterCancel });

    // A draft reserved nothing, so cancelling one must not invent stock.
    const draftId = draft.body.data?.order?.id as string | undefined;
    if (draftId) {
      const beforeDraftCancel = (await prisma.productVariant.findUnique({
        where: { id: variantId }, select: { stock_quantity: true },
      }))!.stock_quantity;
      const draftCancelled = await call(`/api/sales/orders/${draftId}/cancel`, {
        method: 'PUT', token: rep.token, body: {},
      });
      const afterDraftCancel = (await prisma.productVariant.findUnique({
        where: { id: variantId }, select: { stock_quantity: true },
      }))!.stock_quantity;
      check('cancelling a DRAFT gives nothing back — it held nothing',
        draftCancelled.status === 200 && afterDraftCancel === beforeDraftCancel,
        { before: beforeDraftCancel, after: afterDraftCancel });
    }

    // Every action re-scopes. Another rep's order is not theirs to touch.
    const notTheirs = await Promise.all([
      call(`/api/sales/orders/${theirOrder.id}/cancel`, { method: 'PUT', token: rep.token, body: {} }),
      call(`/api/sales/orders/${theirOrder.id}/notes`, { method: 'PUT', token: rep.token, body: { customer_notes: 'x' } }),
      call(`/api/sales/orders/${theirOrder.id}/delivery-fee`, { method: 'PUT', token: rep.token, body: { delivery_fee: 0 } }),
      call(`/api/sales/orders/${theirOrder.id}/confirm-stock`, { method: 'POST', token: rep.token, body: {} }),
    ]);
    check("every action refuses another rep's order, as not found",
      notTheirs.every((r) => r.status === 404), notTheirs.map((r) => r.status));

    // The grouped shape the list actually renders.
    const grouped = await call('/api/sales/orders?grouped=true&limit=50', { token: rep.token });
    const groups = (grouped.body.data?.items ?? []) as { id: string; sub_orders: unknown[] }[];
    check('the list can return one row per purchase, with its parts inside',
      grouped.status === 200 && groups.every((g) => Array.isArray(g.sub_orders)),
      { status: grouped.status, rows: groups.length });
    const groupedIds = groups.flatMap((g) => (g.sub_orders as { id: string }[]).map((o) => o.id));
    check("...and still only their own orders", !groupedIds.includes(theirOrder.id));

    // A business is listed by its trading name, and found by it. The name
    // searched is the company's ("QA Shop SL …"), which the account name
    // ("QA Shop …") does not contain — so only the company can match.
    const company = `QA Shop SL ${stamp}`;
    const shopRow = (groups as { user?: { id: string; company?: string | null } }[])
      .find((g) => g.user?.id === client.id);
    check("a business client's row carries their trading name",
      shopRow?.user?.company === company, shopRow?.user);
    const byCompany = await call(`/api/sales/orders?grouped=true&q=${encodeURIComponent(company)}`, { token: rep.token });
    const found = (byCompany.body.data?.items ?? []) as { user?: { id: string } }[];
    check('...and searching that name finds their orders, and only theirs',
      byCompany.status === 200 && found.length > 0 && found.every((g) => g.user?.id === client.id),
      { status: byCompany.status, rows: found.length });

    // ─── Quick-create: a rep adds what the catalogue lacks ──
    //
    // The row has to be immediately sellable or the feature is pointless — a
    // rep adds it BECAUSE somebody is waiting to buy it — and it has to be
    // flagged, because twenty seconds at a counter is not a catalogue entry.
    const anyCategory = await prisma.category.findFirst({
      where: { is_active: true, approval_status: 'approved' },
      select: { id: true },
    });
    if (!anyCategory) { console.log('  SKIP  no approved category to file under'); } else {
      const made = await call('/api/sales/products/quick', {
        method: 'POST', token: rep.token,
        body: {
          name_es: `QA Rapido ${stamp}`,
          name_en: `QA Quick ${stamp}`,
          category_id: anyCategory.id,
          vat_category: 'general',
          price: 4.5,
          stock_quantity: 7,
        },
      });
      check('a rep can add a product the catalogue does not have', made.status === 201,
        { status: made.status, error: made.body.error });
      const newProductId = made.body.data?.id as string | undefined;
      if (newProductId) productIds.push(newProductId);

      const row = newProductId
        ? await prisma.product.findUnique({
          where: { id: newProductId },
          select: {
            is_active: true, review_needed: true, store_id: true,
            created_source: true, created_by_sales_rep_id: true, created_by_admin_id: true,
            vat_category: true, vat_category_reviewed: true,
            is_featured: true, is_new_arrival: true, is_top_seller: true, is_sponsored: true,
            variants: { select: { price: true, b2b_price: true, stock_quantity: true, is_default: true } },
          },
        })
        : null;

      check('...and it is sellable straight away', row?.is_active === true);
      check('...flagged for a proper look later', row?.review_needed === true);
      check('...attributed to the rep who added it, not to an admin',
        row?.created_by_sales_rep_id === rep.id && row?.created_by_admin_id === null,
        { rep: row?.created_by_sales_rep_id, admin: row?.created_by_admin_id });
      check('...and its provenance survives the review flag being cleared',
        row?.created_source === 'quick_create');

      // A product described in twenty seconds must not land on a storefront rail.
      check('...with every promo flag off',
        row?.is_featured === false && row?.is_new_arrival === false
        && row?.is_top_seller === false && row?.is_sponsored === false, row);

      // The one moment the VAT answer is cheap, so it is asked and trusted —
      // unlike the schema default nobody has ever confirmed.
      check('...the VAT they were asked for, marked as genuinely reviewed',
        row?.vat_category === 'general' && row?.vat_category_reviewed === true,
        { vat: row?.vat_category, reviewed: row?.vat_category_reviewed });

      check('...filed under the shop the rep sells from', row?.store_id === shopId, row?.store_id);
      check('...with the one price entered and no guessed trade price',
        row?.variants.length === 1
        && Number(row?.variants[0].price) === 4.5
        && row?.variants[0].b2b_price === null
        && row?.variants[0].stock_quantity === 7,
        row?.variants);

      // Both fields are a rep's to decide in neither case, so sending one is
      // refused rather than silently stripped — a caller that sends it is
      // wrong and should hear so.
      const withStore = await call('/api/sales/products/quick', {
        method: 'POST', token: rep.token,
        body: {
          name_es: 'QA Sneaky', name_en: 'QA Sneaky', category_id: anyCategory.id,
          vat_category: 'reduced', price: 1, store_id: theirClient.id,
        },
      });
      check('a rep cannot file a product under a shop', withStore.status === 422, withStore.status);

      const withB2b = await call('/api/sales/products/quick', {
        method: 'POST', token: rep.token,
        body: {
          name_es: 'QA Sneaky2', name_en: 'QA Sneaky2', category_id: anyCategory.id,
          vat_category: 'reduced', price: 1, b2b_price: 0.5,
        },
      });
      check('...nor set a trade price at the counter', withB2b.status === 422, withB2b.status);

      // It must be findable the moment it exists, or the rep cannot sell it.
      if (newProductId) {
        const found = await call(
          `/api/sales/catalogue/products?q=${encodeURIComponent(`QA Rapido ${stamp}`)}`,
          { token: rep.token },
        );
        const ids = ((found.body.data?.items ?? []) as { id: string }[]).map((p) => p.id);
        check('...and it shows up in the catalogue immediately', ids.includes(newProductId), ids);
      }
    }

    // ─── 10a. The dashboard's figures: this month, and drafts are not money ──
    // A draft of its own, so the rule is exercised whatever the steps above
    // left behind (their orders are cancelled by now). It reserves nothing.
    const parked = await call('/api/sales/orders', {
      method: 'POST', token: rep.token,
      body: { user_id: client.id, address_id: client.addresses[0].id, status: 'draft', items: [{ variant_id: variantId, quantity: 2 }] },
    });
    if (parked.body.data?.order?.id) orderIds.push(parked.body.data.order.id);
    const monthStart = madridDayStart(`${madridToday().slice(0, 7)}-01`);
    const mineThisMonth = await prisma.order.findMany({
      where: { created_by_sales_rep_id: rep.id, deleted_at: null, created_at: { gte: monthStart } },
      select: { status: true, total: true },
    });
    const meNow = (await call('/api/sales/me', { token: rep.token })).body.data;
    const wantRevenue = mineThisMonth
      .filter((o) => o.status !== 'cancelled' && o.status !== 'draft')
      .reduce((s, o) => s.plus(o.total), new Prisma.Decimal(0)).toFixed(2);
    check('/sales/me counts this month (Madrid) — every order built, but only placed ones as money',
      meNow?.stats?.this_month?.orders === mineThisMonth.length && meNow?.stats?.this_month?.revenue === wantRevenue
        && mineThisMonth.some((o) => o.status === 'draft'),
      { got: meNow?.stats?.this_month, want: { orders: mineThisMonth.length, revenue: wantRevenue }, drafts: mineThisMonth.filter((o) => o.status === 'draft').length });

    // ─── 10. The client's profile, and their shop login ─────
    const clientEmail = `qa.shop.${stamp}@cesto.test`;
    const profile = await call(`/api/sales/clients/${client.id}`, { token: rep.token });
    const pd = profile.body.data ?? {};
    const placedForThem = await prisma.order.count({
      where: { user_id: client.id, created_by_sales_rep_id: rep.id, deleted_at: null, status: { not: 'draft' } },
    });
    check('the profile says how the client logs in — a temporary password from opening — and never sends the hash',
      pd.access === 'temporary' && pd.opened_by_me === true && !JSON.stringify(pd).includes('password'),
      { access: pd.access, mine: pd.opened_by_me });
    check('...and counts the orders this rep placed for them', pd.stats?.orders === placedForThem && placedForThem > 0,
      { stats: pd.stats, placedForThem });

    const issued = await call(`/api/sales/clients/${client.id}/credentials`, { method: 'POST', body: {}, token: rep.token });
    const tempPw = issued.body.data?.temp_password as string | undefined;
    check('a rep can issue the client a login to hand over — mailed only if asked',
      issued.status === 200 && !!tempPw && issued.body.data?.login_email === clientEmail
        && issued.body.data?.email_sent === false && typeof issued.body.data?.login_url === 'string',
      { status: issued.status, error: issued.body.error, sent: issued.body.data?.email_sent });
    const loggedIn = await call('/api/auth/login-email', { method: 'POST', body: { email: clientEmail, password: tempPw } });
    check('...which logs in, and asks them to choose their own',
      loggedIn.status === 200 && loggedIn.body.data?.must_change_password === true,
      { status: loggedIn.status, must: loggedIn.body.data?.must_change_password });
    const tokensLeft = await prisma.userRefreshToken.count({ where: { user_id: client.id } });
    const again = await call(`/api/sales/clients/${client.id}/credentials`, { method: 'POST', body: {}, token: rep.token });
    check('...issuing again replaces it and signs them out everywhere',
      again.status === 200 && again.body.data?.temp_password !== tempPw && tokensLeft > 0
        && (await prisma.userRefreshToken.count({ where: { user_id: client.id } })) === 0,
      { status: again.status, tokensBefore: tokensLeft });

    // Once they have chosen their own, it is theirs: no rep replaces it.
    await prisma.user.update({ where: { id: client.id }, data: { password_is_temp: false } });
    const ownProfile = await call(`/api/sales/clients/${client.id}`, { token: rep.token });
    const refused = await call(`/api/sales/clients/${client.id}/credentials`, { method: 'POST', body: {}, token: rep.token });
    check('a client with their own password: the profile says so, and issuing is refused with a code',
      ownProfile.body.data?.access === 'own' && refused.status === 409 && refused.body.data?.code === 'client_has_own_login',
      { access: ownProfile.body.data?.access, status: refused.status, body: refused.body });
    const outside = await Promise.all([
      call(`/api/sales/clients/${stranger.id}/credentials`, { method: 'POST', body: {}, token: rep.token }),
      call(`/api/sales/clients/${theirClient.id}/credentials`, { method: 'POST', body: {}, token: rep.token }),
    ]);
    check('...and nobody outside their book can be given one — 404, as every read here',
      outside.every((r) => r.status === 404), outside.map((r) => r.status));
    const choosePw = await call(`/api/sales/clients/${client.id}/credentials`, { method: 'POST', body: { password: 'x' }, token: rep.token });
    check('...nor can a rep choose the password', choosePw.status === 422, choosePw.status);

    // ─── 11. Opening a client whose email already has an account ─────
    // They keep a login they chose; only an account with none of its own is
    // given a new one. It used to reset everyone, locking out a customer who
    // had set their own while the screen said they kept it.
    // Credentials are asked for ONLY where the login is kept — the case that
    // must not send anything. Anywhere else this would mail a real welcome
    // email through the configured provider (shared quota) to a test address.
    const openFor = (email: string, sendCredentials = false) => call('/api/sales/clients', {
      method: 'POST', token: rep.token,
      body: {
        name: 'QA Existente', email, client_type: 'retail', send_credentials: sendCredentials,
        address: { contact_name: 'QA', contact_phone: '600333444', street_line_1: 'C/ Ya 3', postcode: '28005', city: 'Madrid', province: 'Madrid' },
      },
    });
    const ownHash = await bcrypt.hash('MiClave!2026', 10);
    const withOwn = await prisma.user.create({ data: { name: 'QA Own', email: `qa.own.${stamp}@cesto.test`, password_hash: ownHash, password_is_temp: false } });
    const withTemp = await prisma.user.create({ data: { name: 'QA Temp', email: `qa.temp.${stamp}@cesto.test`, password_hash: ownHash, password_is_temp: true } });
    const withGoogle = await prisma.user.create({ data: { name: 'QA Google', email: `qa.google.${stamp}@cesto.test`, google_id: `qa-google-${stamp}` } });
    userIds.push(withOwn.id, withTemp.id, withGoogle.id);

    const ownOpened = await openFor(withOwn.email!, true);
    const ownAfter = await prisma.user.findUnique({ where: { id: withOwn.id }, select: { password_hash: true, password_is_temp: true } });
    const ownLogin = await call('/api/auth/login-email', { method: 'POST', body: { email: withOwn.email, password: 'MiClave!2026' } });
    check('an existing customer with their own password keeps it — and still logs in with it',
      ownOpened.status === 201 && ownOpened.body.data?.was_existing === true && ownOpened.body.data?.kept_password === true
        && ownAfter?.password_hash === ownHash && ownAfter?.password_is_temp === false && ownLogin.status === 200,
      { status: ownOpened.status, kept: ownOpened.body.data?.kept_password, login: ownLogin.status });
    check('...and no credentials email is sent for a password that was never set', ownOpened.body.data?.email_sent === false);

    const googleOpened = await openFor(withGoogle.email!, true);
    const googleAfter = await prisma.user.findUnique({ where: { id: withGoogle.id }, select: { password_hash: true } });
    check('one who signs in with Google keeps that, and is given no password',
      googleOpened.body.data?.kept_password === true && googleAfter?.password_hash === null,
      { kept: googleOpened.body.data?.kept_password });

    const tempOpened = await openFor(withTemp.email!);
    const tempAfter = await prisma.user.findUnique({ where: { id: withTemp.id }, select: { password_hash: true, password_is_temp: true } });
    check('one with only a temporary password is given new credentials, and the answer says so',
      tempOpened.status === 201 && tempOpened.body.data?.was_existing === true && tempOpened.body.data?.kept_password === false
        && tempAfter?.password_hash !== ownHash && tempAfter?.password_is_temp === true,
      { kept: tempOpened.body.data?.kept_password });
    const fresh = await openFor(`qa.fresh.${stamp}@cesto.test`);
    if (fresh.body.data?.client?.id) userIds.push(fresh.body.data.client.id);
    check('...and a brand-new client is neither existing nor kept', fresh.body.data?.was_existing === false && fresh.body.data?.kept_password === false);

    // Whose client an existing account becomes (lib/createClient repStandingOf).
    const claimed = await prisma.user.findUnique({ where: { id: withOwn.id }, select: { created_by_sales_rep_id: true } });
    const claimedProfile = await call(`/api/sales/clients/${withOwn.id}`, { token: rep.token });
    const claimedListed = ((await call(`/api/sales/clients?q=${encodeURIComponent(withOwn.email!)}`, { token: rep.token })).body.data?.items ?? [])
      .some((c: { id: string }) => c.id === withOwn.id);
    check('a customer who signed up themselves becomes the opening rep\'s client — in their list, their profile opens',
      claimed?.created_by_sales_rep_id === rep.id && claimedProfile.status === 200 && claimedListed,
      { by: claimed?.created_by_sales_rep_id === rep.id, profile: claimedProfile.status, listed: claimedListed });

    const theirsBefore = await prisma.user.findUnique({ where: { id: theirClient.id }, select: { created_by_sales_rep_id: true, sales_manager_name: true, password_hash: true } });
    const theirsLookup = await call(`/api/sales/clients/lookup?email=${encodeURIComponent(theirClient.email!)}`, { token: rep.token });
    const theirsOpened = await openFor(theirClient.email!);
    const theirsAfter = await prisma.user.findUnique({ where: { id: theirClient.id }, select: { created_by_sales_rep_id: true, sales_manager_name: true, password_hash: true } });
    check('another rep\'s client: the lookup says so up front, and opening it is refused with a code',
      theirsLookup.body.data?.belongs_elsewhere === true && theirsLookup.body.data?.existing_client === null
        && theirsOpened.status === 409 && theirsOpened.body.data?.code === 'client_belongs_elsewhere',
      { lookup: theirsLookup.body.data, status: theirsOpened.status, code: theirsOpened.body.data?.code });
    check('...and their account is left exactly as it was', JSON.stringify(theirsAfter) === JSON.stringify(theirsBefore), { before: theirsBefore, after: theirsAfter });

    const anAdmin = await prisma.admin.findFirst({ select: { id: true } });
    if (anAdmin) {
      const officeOpened = await prisma.user.create({ data: { name: 'QA Office', email: `qa.office.${stamp}@cesto.test`, created_by_admin_id: anAdmin.id } });
      userIds.push(officeOpened.id);
      const officeTry = await openFor(officeOpened.email!);
      check('a client the office opened is refused too — the office hands clients over', officeTry.status === 409 && officeTry.body.data?.code === 'client_belongs_elsewhere', officeTry.status);
    }
    const selfLookup = await call(`/api/sales/clients/lookup?email=${encodeURIComponent(`qa.nobody.${stamp}@cesto.test`)}`, { token: rep.token });
    const ownLookup = await call(`/api/sales/clients/lookup?email=${encodeURIComponent(withOwn.email!)}`, { token: rep.token });
    check('...while an unknown email, or one already theirs, is not "elsewhere"',
      selfLookup.body.data?.belongs_elsewhere === false && ownLookup.body.data?.belongs_elsewhere === false && ownLookup.body.data?.existing_client?.id === withOwn.id);
    const reopened = await openFor(clientEmail);
    check('re-opening their own client still works, and it stays theirs', reopened.status === 201 && reopened.body.data?.was_existing === true, reopened.status);

    // ─── 12. Finding any client by their email, to order for them ─────
    // (2026-10-28, lib/repClients) Their whole email, exactly: found, the rep
    // reaches them — profile, prices, an address, an order — and lists them
    // among their others, but the client stays whoever's it was.
    const find = (email: string, token = rep.token) => call('/api/sales/clients/find', { method: 'POST', body: { email }, token });
    let finds = 0;
    const findCounted = (email: string) => { finds++; return find(email); };

    const hiddenBefore = await call(`/api/sales/clients/${theirClient.id}`, { token: rep.token });
    check("before they find them, another rep's client is still invisible by id", hiddenBefore.status === 404, hiddenBefore.status);

    const [notAnEmail, nearMiss, upper] = await Promise.all([
      findCounted(theirClient.email!.split('@')[0]),
      findCounted(theirClient.email!.slice(0, -1)),
      findCounted(theirClient.email!.toUpperCase()),
    ]);
    check('a part of an email finds nothing — refused as not an email', notAnEmail.status === 422, notAnEmail.status);
    check('...and an email one letter short finds nobody', nearMiss.status === 200 && nearMiss.body.data?.found === false, nearMiss.body.data);
    const fc = upper.body.data?.client ?? {};
    check("the whole email, in any case, finds them: another rep's client, said in a word",
      upper.status === 200 && upper.body.data?.found === true && fc.id === theirClient.id && fc.relation === 'other' && fc.owner === 'rep' && fc.my_order_count === 0,
      upper.body.data);
    check('...and never says whose', !JSON.stringify(upper.body.data).includes(`otherrep.${stamp}`) && !JSON.stringify(upper.body.data).includes(`QA otherrep`));

    const [foundProfile, foundPrices, foundCatalogue, foundCreds] = await Promise.all([
      call(`/api/sales/clients/${theirClient.id}`, { token: rep.token }),
      call(`/api/sales/clients/${theirClient.id}/product-discounts`, { token: rep.token }),
      call(`/api/sales/catalogue/products?for_client=${theirClient.id}&limit=1`, { token: rep.token }),
      call(`/api/sales/clients/${theirClient.id}/credentials`, { method: 'POST', body: {}, token: rep.token }),
    ]);
    const fp = foundProfile.body.data ?? {};
    check('found: their profile opens, as somebody else\'s client, with no word on how they log in',
      foundProfile.status === 200 && fp.relation === 'other' && fp.owner === 'rep' && fp.opened_by_me === false && fp.access === undefined && !!fp.found_at,
      { status: foundProfile.status, relation: fp.relation, owner: fp.owner, access: fp.access });
    check('...their agreed prices and the catalogue priced for them open too', foundPrices.status === 200 && foundCatalogue.status === 200,
      [foundPrices.status, foundCatalogue.status]);
    check('...but a shop login is not theirs to give: refused with a code',
      foundCreds.status === 403 && foundCreds.body.data?.code === 'not_your_client', { status: foundCreds.status, body: foundCreds.body });

    const listOf = async (relation: string, token = rep.token) => (await call(`/api/sales/clients?relation=${relation}&limit=100`, { token })).body.data;
    const ownList = await listOf('own');
    const otherList = await listOf('other');
    const otherRow = (otherList?.items ?? []).find((c: { id: string }) => c.id === theirClient.id);
    check('their own list does not take them in', !(ownList?.items ?? []).some((c: { id: string }) => c.id === theirClient.id));
    check('...their others do: found by email, another rep\'s, no orders yet',
      !!otherRow && otherRow.relation === 'other' && otherRow.owner === 'rep' && otherRow.found_by_email === true && otherRow.my_order_count === 0 && !!otherRow.served_since,
      otherRow);
    check('...and both tabs are counted', otherList?.counts?.other >= 1 && otherList?.counts?.own === ownList?.total,
      { counts: otherList?.counts, ownTotal: ownList?.total });

    // An order for them — with a delivery address the rep adds.
    const theirAddress = await call(`/api/sales/clients/${theirClient.id}/addresses`, {
      method: 'POST', token: rep.token,
      body: { contact_name: 'QA Theirs', contact_phone: '600333444', street_line_1: 'C/ Toledo 9', postcode: '28005', city: 'Madrid', province: 'Madrid' },
    });
    check('...an address can be added for the delivery', theirAddress.status === 201, { status: theirAddress.status, error: theirAddress.body.error });
    if (theirAddress.body.data?.id) addressIds.push(theirAddress.body.data.id);
    const forThem = await call('/api/sales/orders', {
      method: 'POST', token: rep.token,
      body: { user_id: theirClient.id, address_id: theirAddress.body.data?.id, items: [{ variant_id: variantId, quantity: 1 }] },
    });
    check('...and an order placed for them', forThem.status === 201, { status: forThem.status, error: forThem.body.error });
    const forThemId = forThem.body.data?.order?.id as string | undefined;
    if (forThemId) orderIds.push(forThemId);
    const afterOrder = await prisma.user.findUnique({ where: { id: theirClient.id }, select: { created_by_sales_rep_id: true } });
    const forThemRow = forThemId ? await prisma.order.findUnique({ where: { id: forThemId }, select: { created_by_sales_rep_id: true } }) : null;
    check('the order is the rep\'s — and the client is still the other rep\'s',
      forThemRow?.created_by_sales_rep_id === rep.id && afterOrder?.created_by_sales_rep_id === other.id, { order: forThemRow, client: afterOrder });
    const otherAfter = (await listOf('other'))?.items?.find((c: { id: string }) => c.id === theirClient.id);
    const ownersList = await listOf('own', other.token);
    check('...listed among their others with the order counted; still in the other rep\'s own list',
      otherAfter?.my_order_count === 1 && (ownersList?.items ?? []).some((c: { id: string }) => c.id === theirClient.id),
      { mine: otherAfter?.my_order_count });
    const pickerList = await listOf('all');
    check('the order screen\'s picker reaches both their own and their others',
      (pickerList?.items ?? []).some((c: { id: string }) => c.id === theirClient.id) && (pickerList?.items ?? []).some((c: { id: string }) => c.id === client.id));

    // The New client form: somebody else's still, and pointed at.
    const formLookup = await call(`/api/sales/clients/lookup?email=${encodeURIComponent(theirClient.email!)}`, { token: rep.token });
    const reopenTheirs = await call('/api/sales/clients', {
      method: 'POST', token: rep.token,
      body: { name: 'QA Theirs', email: theirClient.email, client_type: 'retail', send_credentials: false,
        address: { contact_name: 'QA', contact_phone: '600333445', street_line_1: 'C/ Toledo 9', postcode: '28005', city: 'Madrid', province: 'Madrid' } },
    });
    check('the New client form: still elsewhere — and named as one of their others — and opening it is still refused',
      formLookup.body.data?.belongs_elsewhere === true && formLookup.body.data?.existing_client === null
        && formLookup.body.data?.reachable_client?.id === theirClient.id
        && reopenTheirs.status === 409 && reopenTheirs.body.data?.code === 'client_belongs_elsewhere',
      { lookup: formLookup.body.data, status: reopenTheirs.status });

    // A shop customer nobody opened: found, still nobody's — and one rep's
    // finding gives no other rep anything.
    const foundStranger = await findCounted(stranger.email!);
    const strangerRow = await prisma.user.findUnique({ where: { id: stranger.id }, select: { created_by_sales_rep_id: true } });
    const strangerByOther = await call(`/api/sales/clients/${stranger.id}`, { token: other.token });
    const strangerForm = await call(`/api/sales/clients/lookup?email=${encodeURIComponent(stranger.email!)}`, { token: rep.token });
    check('a customer who signed up in the shop is found as the shop\'s, and stays nobody\'s',
      foundStranger.body.data?.client?.owner === 'shop' && strangerRow?.created_by_sales_rep_id === null, foundStranger.body.data);
    check('...one rep finding them reaches nothing for another', strangerByOther.status === 404, strangerByOther.status);
    check('...and the New client form may still make them the rep\'s own, as before', strangerForm.body.data?.belongs_elsewhere === false, strangerForm.body.data);

    if (anAdminForFind) {
      const officeClient = await prisma.user.create({ data: { name: 'QA Office Find', email: `qa.officefind.${stamp}@cesto.test`, created_by_admin_id: anAdminForFind.id } });
      userIds.push(officeClient.id);
      const foundOffice = await findCounted(officeClient.email!);
      check('an account the office opened is found as the office\'s', foundOffice.body.data?.client?.owner === 'office', foundOffice.body.data);
    }

    // Who cannot be ordered for is said, and given no way in.
    const blockedUser = await prisma.user.create({ data: { name: 'QA Blocked Find', email: `qa.blockedfind.${stamp}@cesto.test`, status: 'blocked' } });
    userIds.push(blockedUser.id);
    const [foundBlocked, foundRep, foundSelf, foundOwn] = await Promise.all([
      findCounted(blockedUser.email!),
      findCounted(`qa.otherrep.${stamp}@cesto.test`),
      findCounted(`qa.rep.${stamp}@cesto.test`),
      findCounted(clientEmail),
    ]);
    const blockedLinked = await prisma.salesRepClientLink.count({ where: { sales_rep_id: rep.id, user_id: blockedUser.id } });
    const blockedProfile = await call(`/api/sales/clients/${blockedUser.id}`, { token: rep.token });
    check('a blocked account is found but not reached: no link, its profile 404',
      foundBlocked.body.data?.unavailable === 'blocked' && blockedLinked === 0 && blockedProfile.status === 404,
      { found: foundBlocked.body.data?.unavailable, linked: blockedLinked, profile: blockedProfile.status });
    check('another rep\'s own account, and their own, are not clients — and say nothing more',
      foundRep.body.data?.unavailable === 'sales_rep' && !foundRep.body.data?.client
        && foundSelf.body.data?.unavailable === 'self' && !foundSelf.body.data?.client,
      { rep: foundRep.body.data, self: foundSelf.body.data });
    const ownLinked = await prisma.salesRepClientLink.count({ where: { sales_rep_id: rep.id, user_id: client.id } });
    check('their own client is found as theirs, and needs no link', foundOwn.body.data?.client?.relation === 'own' && ownLinked === 0, foundOwn.body.data);

    // Exactness is the lock; the limit is what keeps it from being picked.
    const limited: number[] = [];
    for (let i = finds; i <= 31; i++) limited.push((await find(`qa.nobody${i}.${stamp}@cesto.test`)).status);
    const otherStillFinds = await find(`qa.nobody.${stamp}@cesto.test`, other.token);
    check('finding is limited per rep — thirty in a quarter of an hour, then 429 with a code',
      limited.includes(429) && limited.indexOf(429) + finds === 30, { finds, firstRefused: limited.indexOf(429) });
    check('...and the limit is that rep\'s alone', otherStillFinds.status === 200, otherStillFinds.status);

    // ─── 9. A revoked rep loses the lot at once ────────────
    await prisma.salesRep.update({ where: { user_id: rep.id }, data: { is_active: false } });
    const afterRevoke = await Promise.all([
      call('/api/sales/clients', { token: rep.token }),
      call('/api/sales/catalogue/products', { token: rep.token }),
      call('/api/sales/orders', { token: rep.token }),
    ]);
    check('revoking closes every endpoint, not just the one',
      afterRevoke.every((r) => r.status === 403), afterRevoke.map((r) => r.status));
  } finally {
    // Before the orders they hang off. Nothing here is ISSUED — the draft is
    // all this file makes — so the no-delete trigger has nothing to say.
    if (invoiceIds.length) await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    if (orderIds.length) {
      await prisma.invoice.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (productIds.length) {
      await prisma.productImage.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    // Put the shelf back the way it was found.
    if (variantId && startingStock) {
      await prisma.productVariant.update({
        where: { id: variantId }, data: { stock_quantity: startingStock },
      });
    }
    await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.businessProfile.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
