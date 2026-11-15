// ─── Integration test · who built an order, as admin reads it ──────────────
//
// Run:  cd packages/api && npm run test:order-provenance
//
// The admin order page could tell a rep-built order from a customer's — the
// two creator columns were already in the payload, and the back link used
// them — and that was ALL it could do. "Built by a sales rep, and I cannot
// tell you which one" is not an answer to the question ops opens that page
// with, which is usually "who do I ring about this".
//
// So the name has to be in the payload, and it has to be there for a SPLIT
// purchase too: a ParentOrder has no creator column of its own, the parts
// carry it, and that is the shape a rep-built order takes the moment an edit
// pulls one line across to another shop.
//
// Goes through the real routes over HTTP. Creates its own fixtures and
// removes them in a finally.

import http from 'http';
import app from '../../server';
import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { generateAdminAccessToken } from '../../lib/jwt';
import { generateOrderNumber } from '../../lib/pagination';
import { generateParentOrderNumber } from '../../lib/parentOrder';

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

interface Creator { id: string; name: string }
interface AdminOrder {
  created_by_sales_rep?: Creator | null;
  created_by_admin?: Creator | null;
  created_by_sales_rep_id?: string | null;
  sub_orders?: Array<{ id: string; created_by_sales_rep?: Creator | null }>;
}

interface GroupRow {
  id: string;
  built_by?: { id: string; name: string; is_rep: boolean } | null;
}

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const parentIds: string[] = [];
  let addressId: string | null = null;

  try {
    const admin = await prisma.admin.findFirst({ select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no admin row to act as'); return; }
    const adminToken = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    const call = async (path: string) => {
      const res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      return { status: res.status, body: await res.json() as { data?: AdminOrder; error?: string } };
    };

    const callList = async (path: string) => {
      const res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      return {
        status: res.status,
        body: await res.json() as { data?: { items?: GroupRow[] }; error?: string },
      };
    };

    // ─── Fixtures: a rep, a client, an address ───────────────
    const rep = await prisma.user.create({
      data: { name: `QA Rep ${stamp}`, email: `qa.prov.rep.${stamp}@cesto.test`, phone: `+34600${stamp}` },
      select: { id: true, name: true },
    });
    userIds.push(rep.id);
    await prisma.salesRep.create({ data: { user_id: rep.id, code: `QA-PROV-${stamp}` } });

    const client = await prisma.user.create({
      data: { name: `QA Client ${stamp}`, email: `qa.prov.client.${stamp}@cesto.test`, phone: `+34601${stamp}` },
      select: { id: true },
    });
    userIds.push(client.id);

    const address = await prisma.address.create({
      data: {
        user_id: client.id, contact_name: 'QA', contact_phone: '600000000',
        street_line_1: 'C/ Test 1', postcode: '28016', city: 'Madrid', province: 'Madrid',
      },
      select: { id: true },
    });
    addressId = address.id;

    const money = {
      address_snapshot: {},
      subtotal: new Prisma.Decimal('10.00'),
      delivery_fee: new Prisma.Decimal(0),
      total: new Prisma.Decimal('10.00'),
    };

    // ─── 1. A plain rep-built order names the rep ────────────
    const builtOrder = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(),
        user_id: client.id, address_id: address.id, status: 'pending',
        payment_method: 'cod', created_by_sales_rep_id: rep.id, ...money,
      },
      select: { id: true },
    });
    orderIds.push(builtOrder.id);

    const one = await call(`/api/admin/orders/${builtOrder.id}`);
    check('a rep-built order is readable by admin', one.status === 200,
      { status: one.status, error: one.body.error });
    check('...and NAMES the rep, not just their id',
      one.body.data?.created_by_sales_rep?.name === rep.name,
      { got: one.body.data?.created_by_sales_rep, want: rep.name });
    check('...with the id still there, which is what routes the back link',
      one.body.data?.created_by_sales_rep_id === rep.id,
      one.body.data?.created_by_sales_rep_id);

    // ─── 2. A customer's own order names nobody ──────────────
    //
    // The absence IS the answer on that page — no line is drawn at all — so a
    // creator leaking in here would caption every customer order with a name.
    const ownOrder = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(),
        user_id: client.id, address_id: address.id, status: 'pending',
        payment_method: 'cod', ...money,
      },
      select: { id: true },
    });
    orderIds.push(ownOrder.id);

    const plain = await call(`/api/admin/orders/${ownOrder.id}`);
    check('an order the customer placed themselves names nobody',
      !plain.body.data?.created_by_sales_rep && !plain.body.data?.created_by_admin,
      { rep: plain.body.data?.created_by_sales_rep, admin: plain.body.data?.created_by_admin });

    // ─── 3. A SPLIT purchase: the parts carry it ─────────────
    //
    // The parent row has no creator column, so the header reads the answer off
    // its parts. If the parts do not carry the relation, a rep-built purchase
    // is anonymous on the one view the admin actually lands on.
    const parent = await prisma.parentOrder.create({
      data: {
        order_number: generateParentOrderNumber(),
        user_id: client.id, address_id: address.id, payment_method: 'cod',
        address_snapshot: {},
        subtotal: new Prisma.Decimal('10.00'),
        delivery_fee_total: new Prisma.Decimal(0),
        total: new Prisma.Decimal('10.00'),
      },
      select: { id: true },
    });
    parentIds.push(parent.id);

    const part = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(),
        user_id: client.id, address_id: address.id, status: 'pending',
        payment_method: 'cod', created_by_sales_rep_id: rep.id,
        parent_order_id: parent.id, ...money,
      },
      select: { id: true },
    });
    orderIds.push(part.id);

    const split = await call(`/api/admin/orders/${parent.id}`);
    check('a split purchase is readable by admin', split.status === 200,
      { status: split.status, error: split.body.error });
    const parts = split.body.data?.sub_orders ?? [];
    check('...and its parts name the rep who built it',
      parts.some((p) => p.created_by_sales_rep?.name === rep.name),
      parts.map((p) => p.created_by_sales_rep ?? null));

    // ─── 4. The LIST names them too ──────────────────────────
    //
    // The books already separate rep-built orders from customers' own, so the
    // list could say THAT one was built by us and not which rep. Scanning a
    // page of them to find whose they are meant opening each one.
    //
    // Derived in listGroupedOrders rather than per screen, because a split is
    // built once and stored as several Orders — a caller picking the first
    // part would look like it was choosing arbitrarily between the parts.
    // `grouped=true` or the route answers with flat Order rows, which have no
    // group-level anything — the first run of this check asked for the flat
    // list and then reported the group field missing from it.
    const mine = await callList('/api/admin/orders?grouped=true&limit=100');
    check('the grouped list answers', mine.status === 200,
      { status: mine.status, error: mine.body.error });
    // Newest first, and these were made seconds ago, so one page is enough.
    const rows = mine.body.data?.items ?? [];
    const builtRow = rows.find((r) => r.id === builtOrder.id);
    const ownRow = rows.find((r) => r.id === ownOrder.id);

    check('the rep-built order appears in the grouped list', !!builtRow,
      { found: rows.length });
    check('...naming the rep who built it',
      builtRow?.built_by?.name === rep.name && builtRow?.built_by?.is_rep === true,
      { got: builtRow?.built_by, want: rep.name });
    check("...while the customer's own row names nobody",
      !!ownRow && ownRow.built_by == null,
      { found: !!ownRow, got: ownRow?.built_by });

    const splitRow = rows.find((r) => r.id === parent.id);
    check('...and a split purchase carries its builder at the group level',
      !!splitRow && splitRow.built_by?.name === rep.name,
      { found: !!splitRow, got: splitRow?.built_by });


    // ─── 5. The BOOKS, and the tab that crosses them ─────────
    //
    // Cesto Salesman is not a book. The books split orders by who they are
    // FOR and who placed them, and every order is in exactly one; this tab
    // asks who MADE it, across all of them. So a rep's orders are in two
    // places at once, which is the entire requirement:
    //
    //     rep's retail order      → Home Grocery  AND Cesto Salesman
    //     rep's wholesale order   → Cesto Wholesale AND Cesto Salesman
    //
    // It used to mean "wholesale, built in the panel", so a rep's RETAIL
    // order appeared only under Home Grocery and their work had no view of
    // its own. That is what was reported from production on 2026-10-10.
    //
    // Checked through the real route, and through BOTH branches of it: the
    // page asks for grouped=true, the flat branch is a separate WHERE in a
    // separate file, and a filter that exists in one and not the other is
    // the kind of thing nobody notices until a tab is quietly wrong.
    const b2bMoney = { ...money, buyer_is_business: true };

    const repB2b = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(),
        user_id: client.id, address_id: address.id, status: 'pending',
        payment_method: 'cod', created_by_sales_rep_id: rep.id, ...b2bMoney,
      },
      select: { id: true },
    });
    orderIds.push(repB2b.id);

    // The old occupant of the tab: wholesale, keyed in by staff, no rep.
    const adminB2b = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(),
        user_id: client.id, address_id: address.id, status: 'pending',
        payment_method: 'cod', created_by_admin_id: admin.id, ...b2bMoney,
      },
      select: { id: true },
    });
    orderIds.push(adminB2b.id);

    const customerB2b = await prisma.order.create({
      data: {
        order_number: generateOrderNumber(),
        user_id: client.id, address_id: address.id, status: 'pending',
        payment_method: 'cod', ...b2bMoney,
      },
      select: { id: true },
    });
    orderIds.push(customerB2b.id);

    const idsIn = async (query: string) => {
      const r = await callList(`/api/admin/orders?${query}&limit=100`);
      check(`the list answers for ${query}`, r.status === 200, { status: r.status, error: r.body.error });
      return new Set((r.body.data?.items ?? []).map((row) => row.id));
    };

    for (const branch of ['grouped=true', 'grouped=false']) {
      const salesman = await idsIn(`${branch}&source=sales_rep`);
      check(`[${branch}] Cesto Salesman holds the rep's RETAIL order`,
        salesman.has(builtOrder.id), [...salesman].length);
      check(`[${branch}] ...and the rep's WHOLESALE order`,
        salesman.has(repB2b.id), [...salesman].length);
      check(`[${branch}] ...and NOT the wholesale order staff keyed in`,
        !salesman.has(adminB2b.id));
      check(`[${branch}] ...nor one the customer placed themselves`,
        !salesman.has(customerB2b.id) && !salesman.has(ownOrder.id));

      const wholesale = await idsIn(`${branch}&customerType=b2b`);
      check(`[${branch}] Cesto Wholesale holds EVERY wholesale order`,
        wholesale.has(repB2b.id) && wholesale.has(adminB2b.id) && wholesale.has(customerB2b.id),
        { rep: wholesale.has(repB2b.id), admin: wholesale.has(adminB2b.id), own: wholesale.has(customerB2b.id) });
      check(`[${branch}] ...and no retail order`,
        !wholesale.has(builtOrder.id) && !wholesale.has(ownOrder.id));

      const homeGrocery = await idsIn(`${branch}&source=admin&customerType=retail`);
      check(`[${branch}] Home Grocery still holds the rep's retail order`,
        homeGrocery.has(builtOrder.id));

      // The requirement, stated as one assertion.
      check(`[${branch}] THE OVERLAP: the rep's retail order is in Home Grocery AND Cesto Salesman`,
        homeGrocery.has(builtOrder.id) && salesman.has(builtOrder.id));
      check(`[${branch}] ...and their wholesale order in Cesto Wholesale AND Cesto Salesman`,
        wholesale.has(repB2b.id) && salesman.has(repB2b.id));
    }

    // ─── 6. The dashboard's cards count what their tabs list ─
    //
    // The cards had stayed on the old four quadrants after the tabs above
    // changed: "Cesto Salesman — built by a rep" counted every wholesale order
    // WE built — the staff-keyed one here, and since Home Grocery a business
    // household's plan deliveries — and missed the rep's retail work. On
    // staging it read 6 while its tab listed 18.
    //
    // Compared over the dashboard's own window, with whatever else this
    // database holds, against the FLAT list: it counts Order rows, as the
    // cards do, where the grouped one counts purchases.
    const dashRes = await fetch(`${base}/api/admin/dashboard/stats?range=7d`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const dash = await dashRes.json() as {
      data?: { from: string; to: string; byBook: Record<string, { orders: number }> };
    };
    check('the dashboard answers', dashRes.status === 200 && !!dash.data, dashRes.status);
    const window = `&from=${encodeURIComponent(dash.data?.from ?? '')}&to=${encodeURIComponent(dash.data?.to ?? '')}`;
    const tabTotal = async (query: string) => {
      const r = await fetch(`${base}/api/admin/orders?grouped=false&limit=1&${query}${window}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      return (await r.json() as { data?: { total?: number } }).data?.total;
    };
    const cards = [
      ['customer', 'source=customer&customerType=retail'],
      ['rashan', 'source=admin&customerType=retail'],
      ['b2bOnline', 'customerType=b2b'],
      ['b2bRep', 'source=sales_rep'],
    ] as const;
    for (const [card, query] of cards) {
      const tab = await tabTotal(query);
      check(`dashboard card "${card}" counts exactly what its tab lists (${query})`,
        dash.data?.byBook[card]?.orders === tab,
        { card: dash.data?.byBook[card]?.orders, tab });
    }

  } finally {
    if (orderIds.length) {
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    // After the orders that point at it, before the address it points at.
    if (parentIds.length) await prisma.parentOrder.deleteMany({ where: { id: { in: parentIds } } });
    await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
    if (addressId) await prisma.address.deleteMany({ where: { id: addressId } });
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
