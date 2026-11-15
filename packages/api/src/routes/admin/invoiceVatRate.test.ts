// ─── Integration test · changing a line's IVA on a factura ──
//
// Run:  cd packages/api && npm run test:invoice-vat-rate
//
// User, 2026-11-04: "in factura when I apply the iva then nothing changes in
// total or anything... we add the iva at the time of product creation... the
// added percentage already is added in the price... we can change it in
// factura and it only changes for that one factura and not as a whole on
// product".
//
// Prices are bases with IVA added on top (2026-11-01), and every order line
// records the rate it was charged at. So on a factura:
//   · each line shows the rate it was charged at, and its base (price without
//     IVA) read back out of the charged price EXACTLY;
//   · an untouched factura is what the customer paid, to the cent — saving it
//     unchanged moves nothing, even a fee no whole-cent base produces;
//   · CHANGING A RATE RE-ADDS IVA TO THE SAME BASE: the price, the line and
//     the total move, and putting the rate back returns the charged price;
//   · only that factura changes — never the product, never the order;
//   · prices stay WITH IVA, as customers see them: a typed price is kept as
//     typed and its base read out of it, and an older draft without bases
//     gets them on read, printing the same.
//
// Goes through the real routes over HTTP. Makes its own fixtures and removes
// them, triggers and all.
import http from 'http';
import { Prisma } from '@prisma/client';
import app from '../../server';
import prisma from '../../lib/prisma';
import { generateAdminAccessToken } from '../../lib/jwt';
import { addVatCents, eurosToCents, centsToEuros } from '../../lib/tax';

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

interface Line {
  description: string; quantity: number; unit_price: string; unit_base?: string; gross: string;
  key?: string; rate_pct: number; discount?: string; product_id: string | null; code?: string | null;
}
interface Totals { gross: string; base: string; vat: string; by_rate: Array<{ rate_pct: number; base: string; vat: string; gross: string }> }

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

    // ─── Fixtures: a 10 % product, an undecided (0 %) one, a fee ──
    categoryId = (await prisma.category.create({
      data: { name_es: `VR ${stamp}`, name_en: `VR ${stamp}`, sort_order: 9999 }, select: { id: true },
    })).id;
    const make = async (name: string, price: string, reviewed: boolean, sku: string | null = null) => {
      const p = await prisma.product.create({
        data: {
          name_es: `${name} ${stamp}`, name_en: `${name} ${stamp}`, category_id: categoryId, is_active: true,
          vat_category: 'reduced', vat_category_reviewed: reviewed,
          variants: { create: [{ name_es: '1 kg', name_en: '1 kg', price: new Prisma.Decimal(price), stock_quantity: 50, is_active: true, sku }] },
        },
        include: { variants: true },
      });
      productIds.push(p.id);
      return p;
    };
    const SKU = `VR-ARROZ-${stamp}`;
    const pA = await make('Arroz VR', '10.00', true, SKU); // 10 %: charged 11.00, with a product code
    const pB = await make('Lentejas VR', '5.00', false); // undecided: charged 5.00 at 0 %
    const vA = pA.variants[0];
    const vB = pB.variants[0];

    const user = await prisma.user.create({
      data: { name: `QA VatRate ${stamp}`, email: `qa.vatrate.${stamp}@cesto.test`, tax_id: 'B12345678', fiscal_name: `QA VatRate SL ${stamp}` },
      select: { id: true },
    });
    userIds.push(user.id);
    const address = await prisma.address.create({
      data: { user_id: user.id, contact_name: 'QA', contact_phone: '600000008', street_line_1: 'C/ IVA 1', postcode: '28016', city: 'Madrid', province: 'Madrid' },
      select: { id: true },
    });

    const made = await call('/api/admin/orders', {
      method: 'POST', token,
      body: {
        user_id: user.id, address_id: address.id, delivery_fee: 4,
        // 0.50 off each rice, off the price WITH IVA, as agreed discounts are.
        items: [{ variant_id: vA.id, quantity: 2, unit_discount: 0.5 }, { variant_id: vB.id, quantity: 1 }],
      },
    });
    const orderId = made.body.data?.order?.id as string | undefined;
    if (!orderId) { console.log('  ABORT  could not create the order', made.status, made.body?.error); return; }
    orderIds.push(orderId);

    const orderSig = async () => JSON.stringify(await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        subtotal: true, delivery_fee: true, total: true,
        items: { select: { id: true, quantity: true, unit_price: true, tax_rate_pct: true, line_total: true, discount_amount: true }, orderBy: { id: 'asc' } },
      },
    }));
    const productSig = async () => JSON.stringify(await prisma.product.findMany({
      where: { id: { in: productIds } }, select: { id: true, vat_category: true, vat_category_reviewed: true }, orderBy: { id: 'asc' },
    }));
    const order0 = await orderSig();
    const product0 = await productSig();
    const charged = await prisma.order.findUnique({ where: { id: orderId }, select: { total: true } });

    // ─── 1. The draft: rates as charged, bases read back exactly ─
    const drafted = await call(`/api/admin/orders/${orderId}/invoice`, { method: 'POST', token, body: { kind: 'invoice' } });
    const invoiceId = drafted.body.data?.invoice?.id as string | undefined;
    if (!invoiceId) { console.log('  ABORT  no draft', drafted.status, drafted.body?.error); return; }
    invoiceIds.push(invoiceId);
    const read = async () => (await call(`/api/admin/invoices/${invoiceId}`, { token })).body.data as {
      invoice: { lines: Line[]; totals: Totals; total: string; manually_edited: boolean };
    };
    let doc = await read();
    const lineOf = (pid: string | null) => doc.invoice.lines.find((l) => (pid ? l.product_id === pid : l.key === 'delivery'))!;
    let A = lineOf(pA.id); let B = lineOf(pB.id); let D = lineOf(null);
    check('the rice line shows the rate it was charged at (10 %) and its base 10.00 under 11.00',
      A.rate_pct === 10 && A.unit_price === '11.00' && A.unit_base === '10.00' && A.discount === '1.00' && A.gross === '21.00', A);
    check('the undecided product shows 0 %, base = price = 5.00', B.rate_pct === 0 && B.unit_price === '5.00' && B.unit_base === '5.00', B);
    check('the fee shows 21 %, its base read out of 4.00 (3.31)', D.rate_pct === 21 && D.unit_price === '4.00' && D.unit_base === '3.31', D);
    check('the CÓDIGO column: the rice carries the code of its size; a product without one and the fee carry none',
      A.code === SKU && B.code === null && D.code === null, { A: A.code, B: B.code, D: D.code });
    const env = (await call(`/api/admin/invoices/${invoiceId}`, { token })).body.data?.invoice;
    check('...and the PEDIDO column has the order number to print', env?.order?.order_number?.startsWith('ORD-'), env?.order);
    check(`an untouched factura is what the customer paid (${charged?.total.toFixed(2)})`,
      doc.invoice.totals.gross === charged?.total.toFixed(2) && doc.invoice.totals.gross === '30.00', doc.invoice.totals);

    // What the editor sends (shared invoiceLinePrice): prices WITH IVA. A new
    // rate re-adds IVA to the line's base; back at the charged base and rate,
    // the charged price exactly; a typed price as typed.
    const charged0 = new Map(doc.invoice.lines.map((l) => [l.key, {
      price: eurosToCents(l.unit_price), base: eurosToCents(l.unit_base ?? '0'), rate: l.rate_pct,
    }]));
    const editorPrice = (l: Line, rate: number) => {
      const c = charged0.get(l.key);
      const lineBase = eurosToCents(l.unit_base ?? '0');
      if (c && c.rate === rate && c.base === lineBase) return centsToEuros(c.price);
      return centsToEuros(addVatCents(lineBase, rate));
    };
    const send = (edit: (l: Line) => { rate_pct?: number; unit_price?: string }) => call(`/api/admin/invoices/${invoiceId}`, {
      method: 'PUT', token,
      body: {
        lines: doc.invoice.lines.map((l) => {
          const e = edit(l);
          const rate = e.rate_pct ?? l.rate_pct;
          const price = e.unit_price ?? (e.rate_pct !== undefined ? editorPrice(l, rate) : l.unit_price);
          return {
            description: l.description, quantity: l.quantity, unit_price: price, rate_pct: rate,
            product_id: l.product_id, key: l.key, ...(l.discount ? { discount: l.discount } : {}),
          };
        }),
      },
    });

    // ─── 2. Saved unchanged, nothing moves ─────────────────
    const same = await send(() => ({}));
    doc = await read();
    D = lineOf(null);
    check('an edited line keeps its product code', lineOf(pA.id).code === SKU, lineOf(pA.id).code);
    check('saving every line unchanged moves nothing — not even the 4.00 fee (3.31 + 21 % would be 4.01)',
      same.status === 200 && doc.invoice.totals.gross === '30.00' && D.unit_price === '4.00' && D.gross === '4.00' && D.unit_base === '3.31',
      { status: same.status, error: same.body?.error, total: doc.invoice.totals.gross, fee: D });

    // ─── 3. Apply IVA: the total moves ──────────────────────
    const applied = await send((l) => (l.product_id === pB.id ? { rate_pct: 10 } : l.product_id === pA.id ? { rate_pct: 21 } : {}));
    doc = await read();
    A = lineOf(pA.id); B = lineOf(pB.id);
    check('applying 10 % to the undecided line: 5.00 + IVA = 5.50, its base still 5.00',
      applied.status === 200 && B.unit_price === '5.50' && B.unit_base === '5.00' && B.gross === '5.50', B);
    check('moving the rice to 21 %: 10.00 + IVA = 12.10 × 2 − 1.00 discount = 23.20, its base still 10.00',
      A.unit_price === '12.10' && A.unit_base === '10.00' && A.gross === '23.20', A);
    check('THE TOTAL FOLLOWS: 23.20 + 5.50 + 4.00 = 32.70', doc.invoice.totals.gross === '32.70' && Number(doc.invoice.total) === 32.7, doc.invoice.totals);
    const by = Object.fromEntries(doc.invoice.totals.by_rate.map((g) => [g.rate_pct, g]));
    check('...and the IVA breakdown with it (10 %: 5.00 + 0.50; 21 %: 22.48 + 4.72 on 27.20)',
      by[10]?.base === '5.00' && by[10]?.vat === '0.50' && by[21]?.gross === '27.20' && by[21]?.vat === '4.72' && !by[0],
      doc.invoice.totals.by_rate);
    check('ONLY THIS FACTURA: the products keep their IVA settings', (await productSig()) === product0);
    check('...and the order is exactly as it was charged', (await orderSig()) === order0);

    // ─── 4. Back to the charged rate: back to the charged price ─
    await send((l) => (l.product_id === pA.id ? { rate_pct: 10 } : {}));
    doc = await read();
    A = lineOf(pA.id);
    check('putting the rice back to 10 % returns 11.00 and 21.00 exactly (total 30.50)',
      A.unit_price === '11.00' && A.gross === '21.00' && doc.invoice.totals.gross === '30.50', { A, total: doc.invoice.totals.gross });

    // ─── 5. A typed price is kept, and its base follows it ──
    await send((l) => (l.product_id === pB.id ? { unit_price: '6.60' } : {}));
    doc = await read();
    B = lineOf(pB.id);
    check('typing 6.60 (with IVA) on a 10 % line keeps 6.60; its base is 6.00', B.unit_price === '6.60' && B.unit_base === '6.00' && B.gross === '6.60', B);
    await send((l) => (l.key === 'delivery' ? { unit_price: '4.50' } : {}));
    doc = await read();
    D = lineOf(null);
    check('a price no whole-cent base gives (4.50 at 21 %) is kept as typed; its base is the nearest, 3.72',
      D.unit_price === '4.50' && D.unit_base === '3.72' && D.gross === '4.50', D);
    await send((l) => (l.key === 'delivery' ? { rate_pct: 10 } : {}));
    doc = await read();
    D = lineOf(null);
    check('...and a new rate then re-adds IVA to that base: 3.72 + 10 % = 4.09', D.unit_price === '4.09' && D.rate_pct === 10, D);

    // ─── 7. An older draft without bases ────────────────────
    const stripped = doc.invoice.lines.map(({ unit_base: _b, ...rest }) => rest);
    await prisma.invoice.update({ where: { id: invoiceId }, data: { lines: stripped as unknown as Prisma.InputJsonValue } });
    const before = JSON.stringify(stripped.map((l) => [l.unit_price, l.gross]));
    doc = await read();
    check('a draft from before bases gets them on read, and prints exactly the same',
      doc.invoice.lines.every((l) => typeof l.unit_base === 'string')
        && JSON.stringify(doc.invoice.lines.map((l) => [l.unit_price, l.gross])) === before
        && lineOf(null).unit_base === '3.72',
      doc.invoice.lines.map((l) => [l.unit_base, l.unit_price]));

    // ─── 8. Issue: the edited figures go out ────────────────
    const shown = doc.invoice.totals.gross;
    const issued = await call(`/api/admin/invoices/${invoiceId}/issue`, { method: 'POST', token });
    const stored = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    check(`the factura issues with the total on screen (${shown})`,
      issued.status === 200 && stored?.status === 'issued' && stored.total.toFixed(2) === shown,
      { status: issued.status, error: issued.body?.error, total: stored?.total });
    check('...each line keeping its base', ((stored?.lines ?? []) as unknown as Line[]).every((l) => typeof l.unit_base === 'string'));
    check('...and still nothing changed on the order or the products',
      (await orderSig()) === order0 && (await productSig()) === product0);
  } finally {
    if (invoiceIds.length) {
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
      await prisma.customerProductDiscount.deleteMany({ where: { product_id: { in: productIds } } }).catch(() => {});
      await prisma.productVariant.deleteMany({ where: { product_id: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    if (userIds.length) {
      await prisma.customerProductDiscount.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
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
