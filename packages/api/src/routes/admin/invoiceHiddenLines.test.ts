// ─── Integration test · lines hidden from a factura ─────
//
// Run:  cd packages/api && npm run test:invoice-hidden-lines
//
// User, 2026-11-04: "I should be able to hide any item from the factura and it
// should not affect the order or anything it will just stay hidden and will
// not be mentioned in the factura pdf that will be generated".
//
// What has to hold:
//   · hiding a line takes it off the document's lines AND its totals, and
//     keeps it apart (hidden_lines) so it can be shown again;
//   · THE ORDER IS UNTOUCHED — its items, totals, stock and edit history are
//     the same before and after, and the draft keeps following it (hiding does
//     not detach it): an order edit still reaches the document, and the hidden
//     line stays hidden through it;
//   · the delivery fee is a line like any other and can be hidden too;
//   · a document cannot be hidden down to nothing;
//   · a draft edited by hand can hide and show as well, and a shown line goes
//     back where it was;
//   · issuing prints only what is shown, records what was left off, and the
//     record is frozen with the rest;
//   · a rep reading the document never receives the hidden lines.
//
// Goes through the real routes over HTTP. Makes its own fixtures and removes
// them, triggers and all.
import http from 'http';
import { Prisma } from '@prisma/client';
import app from '../../server';
import prisma from '../../lib/prisma';
import { generateAccessToken, generateAdminAccessToken } from '../../lib/jwt';

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

interface Line { description: string; quantity: number; unit_price: string; gross: string; key?: string; rate_pct: number; discount?: string; product_id: string | null }
interface Hidden extends Line { at: number }

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];
  const orderIds: string[] = [];
  const invoiceIds: string[] = [];
  const productIds: string[] = [];
  let categoryId = '';

  const call = async (path: string, init: { method?: string; body?: unknown; token: string }) => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${init.token}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: await res.json().catch(() => null) as { success: boolean; error?: string; data?: any } };
  };

  try {
    const admin = await prisma.admin.findFirst({ where: { role: 'super_admin' }, select: { id: true, email: true, role: true } });
    if (!admin) { console.log('  SKIP  no super admin to act as'); return; }
    const token = generateAdminAccessToken({ adminId: admin.id, email: admin.email, role: admin.role });

    // ─── Fixtures: three products, a customer with a CIF ────
    const category = await prisma.category.create({
      data: { name_es: `HL ${stamp}`, name_en: `HL ${stamp}`, sort_order: 9999 },
      select: { id: true },
    });
    categoryId = category.id;
    const make = async (name: string, price: string) => {
      const p = await prisma.product.create({
        data: {
          name_es: `${name} ${stamp}`, name_en: `${name} ${stamp}`, category_id: categoryId, is_active: true,
          vat_category: 'reduced', vat_category_reviewed: true,
          variants: { create: [{ name_es: '1 kg', name_en: '1 kg', price: new Prisma.Decimal(price), stock_quantity: 50, is_active: true }] },
        },
        include: { variants: true },
      });
      productIds.push(p.id);
      return p.variants[0];
    };
    const vA = await make('Arroz HL', '10.00');
    const vB = await make('Muestra HL', '5.00');
    const vC = await make('Aceite HL', '8.00');

    const user = await prisma.user.create({
      data: { name: `QA Hidden ${stamp}`, email: `qa.hidden.${stamp}@cesto.test`, tax_id: 'B12345678', fiscal_name: `QA Hidden SL ${stamp}` },
      select: { id: true },
    });
    userIds.push(user.id);
    const address = await prisma.address.create({
      data: { user_id: user.id, contact_name: 'QA', contact_phone: '600000007', street_line_1: 'C/ Oculta 1', postcode: '28016', city: 'Madrid', province: 'Madrid' },
      select: { id: true },
    });

    const made = await call('/api/admin/orders', {
      method: 'POST', token,
      body: {
        user_id: user.id, address_id: address.id, delivery_fee: 4,
        items: [{ variant_id: vA.id, quantity: 2 }, { variant_id: vB.id, quantity: 1 }, { variant_id: vC.id, quantity: 3 }],
      },
    });
    const orderId = made.body.data?.order?.id as string | undefined;
    if (!orderId) { console.log('  ABORT  could not create the order', made.status, made.body?.error); return; }
    orderIds.push(orderId);

    const orderState = async () => {
      const o = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          subtotal: true, delivery_fee: true, total: true, status: true,
          items: { select: { id: true, variant_id: true, quantity: true, line_total: true }, orderBy: { id: 'asc' } },
          _count: { select: { edit_logs: true } },
        },
      });
      const stock = await prisma.productVariant.findMany({
        where: { id: { in: [vA.id, vB.id, vC.id] } }, select: { id: true, stock_quantity: true }, orderBy: { id: 'asc' },
      });
      return JSON.stringify({ o, stock });
    };
    const items = await prisma.orderItem.findMany({ where: { order_id: orderId }, select: { id: true, variant_id: true } });
    const itemOf = (variantId: string) => items.find((i) => i.variant_id === variantId)!.id;
    const [kA, kB, kC] = [itemOf(vA.id), itemOf(vB.id), itemOf(vC.id)];

    // ─── 1. A fresh factura draft: every line keyed, nothing hidden ─
    const drafted = await call(`/api/admin/orders/${orderId}/invoice`, { method: 'POST', token, body: { kind: 'invoice' } });
    const invoiceId = drafted.body.data?.invoice?.id as string | undefined;
    if (!invoiceId) { console.log('  ABORT  no draft', drafted.status, drafted.body?.error); return; }
    invoiceIds.push(invoiceId);
    const read = async () => (await call(`/api/admin/invoices/${invoiceId}`, { token })).body.data as {
      invoice: { lines: Line[]; hidden_lines: Hidden[]; totals: { gross: string; base: string; vat: string }; total: string; manually_edited: boolean };
      divergence: number[];
    };
    let doc = await read();
    const keys = doc.invoice.lines.map((l) => l.key);
    check('a draft\'s lines are keyed by order item, and the fee by "delivery"',
      [kA, kB, kC, 'delivery'].every((k) => keys.includes(k)) && keys.length === 4, keys);
    check('...and nothing is hidden yet', Array.isArray(doc.invoice.hidden_lines) && doc.invoice.hidden_lines.length === 0);
    const fullTotal = doc.invoice.totals.gross;
    // Bases + 10 % IVA (prices are bases since 2026-11-01): rice 2 × 11.00,
    // sample 5.50, oil 3 × 8.80, and the 4.00 fee.
    check('...the total is the whole order (22.00 + 5.50 + 26.40 + 4.00 fee = 57.90)', fullTotal === '57.90', doc.invoice.totals);

    const before = await orderState();

    // ─── 2. Hide the sample ─────────────────────────────────
    const hid = await call(`/api/admin/invoices/${invoiceId}`, { method: 'PUT', token, body: { hidden: [kB] } });
    check('hiding a line is accepted', hid.status === 200, { status: hid.status, error: hid.body?.error });
    doc = await read();
    check('...it is off the document\'s lines', !doc.invoice.lines.some((l) => l.key === kB) && doc.invoice.lines.length === 3,
      doc.invoice.lines.map((l) => l.key));
    check('...and kept apart, where it sat (2nd line)',
      doc.invoice.hidden_lines.length === 1 && doc.invoice.hidden_lines[0].key === kB && doc.invoice.hidden_lines[0].at === 1,
      doc.invoice.hidden_lines);
    check('...the totals leave it out: 57.90 − 5.50 = 52.40',
      doc.invoice.totals.gross === '52.40' && Number(doc.invoice.total) === 52.4, { totals: doc.invoice.totals, total: doc.invoice.total });
    check('...the draft still follows its order (not detached, nothing "differs")',
      doc.invoice.manually_edited === false && doc.divergence.length === 0, { edited: doc.invoice.manually_edited, divergence: doc.divergence });
    check('THE ORDER IS UNTOUCHED — items, totals, stock, edit history', (await orderState()) === before);

    // ─── 3. The order changes; the document follows, the line stays hidden ─
    const edit = await call(`/api/admin/orders/${orderId}/items`, {
      method: 'PUT', token, body: { operations: [{ action: 'update_qty', order_item_id: kA, new_quantity: 3 }] },
    });
    check('the order can still be edited while a line is hidden', edit.status === 200, { status: edit.status, error: edit.body?.error });
    doc = await read();
    const lineA = doc.invoice.lines.find((l) => l.key === kA);
    check('...the document follows it (rice now 3 × 11.00)', lineA?.quantity === 3 && lineA?.gross === '33.00', lineA);
    check('...and the sample is still hidden: 33.00 + 26.40 + 4.00 = 63.40',
      !doc.invoice.lines.some((l) => l.key === kB) && doc.invoice.hidden_lines.some((h) => h.key === kB) && doc.invoice.totals.gross === '63.40',
      { lines: doc.invoice.lines.map((l) => l.key), total: doc.invoice.totals.gross });
    const afterEdit = await orderState();

    // ─── 4. The delivery fee is hideable too, and comes back ─
    await call(`/api/admin/invoices/${invoiceId}`, { method: 'PUT', token, body: { hidden: [kB, 'delivery'] } });
    doc = await read();
    check('the delivery fee can be hidden: 63.40 − 4.00 = 59.40',
      !doc.invoice.lines.some((l) => l.key === 'delivery') && doc.invoice.totals.gross === '59.40', doc.invoice.totals);
    await call(`/api/admin/invoices/${invoiceId}`, { method: 'PUT', token, body: { hidden: [kB, 'unknown-key'] } });
    doc = await read();
    check('showing it again is sending the set without it (an unknown key hides nothing)',
      doc.invoice.lines.some((l) => l.key === 'delivery') && doc.invoice.hidden_lines.length === 1 && doc.invoice.totals.gross === '63.40',
      { hidden: doc.invoice.hidden_lines.map((h) => h.key), total: doc.invoice.totals.gross });
    check('...still without touching the order', (await orderState()) === afterEdit);

    // ─── 5. Not down to nothing ─────────────────────────────
    const all = await call(`/api/admin/invoices/${invoiceId}`, { method: 'PUT', token, body: { hidden: [kA, kB, kC, 'delivery'] } });
    check('hiding every line is refused', all.status === 422, { status: all.status, error: all.body?.error });
    doc = await read();
    check('...and the document is as it was', doc.invoice.lines.length === 3 && doc.invoice.hidden_lines.length === 1);

    // ─── 6. An edited draft hides and shows as well ─────────
    const edited = await call(`/api/admin/invoices/${invoiceId}`, {
      method: 'PUT', token,
      body: {
        lines: doc.invoice.lines.map((l) => ({
          description: l.key === kA ? 'Arroz basmati (saco)' : l.description,
          quantity: l.quantity, unit_price: l.unit_price, rate_pct: l.rate_pct, product_id: l.product_id,
          ...(l.discount ? { discount: l.discount } : {}), key: l.key,
        })),
      },
    });
    check('editing a line still works (and detaches, as before)', edited.status === 200, { status: edited.status, error: edited.body?.error });
    doc = await read();
    check('...the edit keeps every key and the hidden sample stays hidden',
      doc.invoice.manually_edited === true
        && doc.invoice.lines.map((l) => l.key).join() === [kA, kC, 'delivery'].join()
        && doc.invoice.hidden_lines.some((h) => h.key === kB),
      { keys: doc.invoice.lines.map((l) => l.key), hidden: doc.invoice.hidden_lines.map((h) => h.key) });
    check('...and a hidden line does not make the lines after it "differ from the order"',
      doc.divergence.length === 0, doc.divergence);
    await call(`/api/admin/invoices/${invoiceId}`, { method: 'PUT', token, body: { hidden: [kB, kC] } });
    doc = await read();
    check('an edited draft can hide another line (oil): 63.40 − 26.40 = 37.00',
      doc.invoice.lines.map((l) => l.key).join() === [kA, 'delivery'].join() && doc.invoice.totals.gross === '37.00',
      { keys: doc.invoice.lines.map((l) => l.key), total: doc.invoice.totals.gross });
    await call(`/api/admin/invoices/${invoiceId}`, { method: 'PUT', token, body: { hidden: [kB] } });
    doc = await read();
    check('...and show it again, back in its place (before the fee)',
      doc.invoice.lines.map((l) => l.key).join() === [kA, kC, 'delivery'].join() && doc.invoice.totals.gross === '63.40',
      { keys: doc.invoice.lines.map((l) => l.key), total: doc.invoice.totals.gross });
    check('...the typed description survived all of it', doc.invoice.lines[0]?.description === 'Arroz basmati (saco)', doc.invoice.lines[0]);
    check('...and the order was never touched', (await orderState()) === afterEdit);

    // ─── 7. Issue: only what is shown goes out ──────────────
    const issued = await call(`/api/admin/invoices/${invoiceId}/issue`, { method: 'POST', token });
    check('the factura issues', issued.status === 200, { status: issued.status, error: issued.body?.error });
    const stored = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    const storedLines = (stored?.lines ?? []) as unknown as Line[];
    const storedHidden = (stored?.hidden_lines ?? []) as unknown as Hidden[];
    check('...its lines are only the shown ones — the sample is nowhere in them',
      stored?.status === 'issued' && storedLines.length === 3 && !storedLines.some((l) => l.key === kB || /Muestra/.test(l.description)),
      storedLines.map((l) => l.description));
    check('...its total is what they add up to (63.40)', stored?.total.toFixed(2) === '63.40', stored?.total);
    check('...and what was left off is on record', storedHidden.length === 1 && storedHidden[0].key === kB, storedHidden);
    let frozen = false;
    try {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { hidden_lines: [] as unknown as Prisma.InputJsonValue } });
    } catch { frozen = true; }
    check('...a record nobody can rewrite once issued (trigger)', frozen);

    // ─── 8. A rep never receives the hidden lines ───────────
    const repEmail = `qa.hidden.rep.${stamp}@cesto.test`;
    const rep = await call('/api/admin/sales-reps', {
      method: 'POST', token, body: { name: `QA Hidden Rep ${stamp}`, email: repEmail, send_credentials: false, store_ids: [] },
    });
    const repId = rep.body.data?.user_id as string | undefined;
    if (repId) {
      userIds.push(repId);
      await prisma.order.update({ where: { id: orderId }, data: { created_by_sales_rep_id: repId } });
      const repRead = await call(`/api/sales/invoices/${invoiceId}`, { token: generateAccessToken({ userId: repId, email: repEmail }) });
      check('a rep reading the factura gets its printed lines and no hidden ones',
        repRead.status === 200 && !('hidden_lines' in (repRead.body.data ?? {})) && (repRead.body.data?.lines ?? []).length === 3
          && !JSON.stringify(repRead.body.data).includes('Muestra'),
        { status: repRead.status, keys: Object.keys(repRead.body.data ?? {}) });
    } else {
      check('a rep could be made for the last check', false, { status: rep.status, error: rep.body?.error });
    }
  } finally {
    if (invoiceIds.length) {
      // The triggers that make an issued document immutable also stop the
      // cleanup, exactly as in the factura-gaps suite.
      await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_mutate_issued');
      await prisma.$executeRawUnsafe('ALTER TABLE invoices DISABLE TRIGGER invoices_no_delete_issued');
      try {
        await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_mutate_issued');
        await prisma.$executeRawUnsafe('ALTER TABLE invoices ENABLE TRIGGER invoices_no_delete_issued');
      }
    }
    if (orderIds.length) {
      await prisma.orderEditLog.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (productIds.length) {
      await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    if (userIds.length) {
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.salesRep.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.userRefreshToken.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
