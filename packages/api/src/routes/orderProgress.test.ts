// ─── Order progress: the server says where a big order has got to ─────────
//
// Run:  cd packages/api && npm run test:order-progress
//
// Placing a 1,000-product order took ~20s on production (2026-10-19) behind a
// bare spinner. Each order operation now records the step it has reached
// under the key the client sent, and GET …/progress/:key reads it back while
// the request is still running.
//
// What must hold:
//   · a tracker records steps in order and closes itself when the response
//     goes out — done on success, failed on an error status;
//   · only the owner can read a record; anyone else, or a made-up key, 404s;
//   · a request without a usable key stores nothing (and still logs if slow);
//   · a REAL checkout and cancel, polled while they run, end with every step
//     of their kind reached, in order, and `done`.
//
// Part two needs the local database; it creates its own customer and cleans
// up after itself.

import http from 'http';
import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAccessToken } from '../lib/jwt';
import { trackProgress, readProgress, clearProgress, progressKeyFrom, PROGRESS_STEPS } from '../lib/orderProgress';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++; console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

function fakeReq(headers: Record<string, string>): Request {
  return { header: (name: string) => headers[name] ?? headers[name.toLowerCase()] } as unknown as Request;
}
function fakeRes(): Response & EventEmitter {
  const r = new EventEmitter() as unknown as Response & EventEmitter;
  (r as unknown as { statusCode: number }).statusCode = 200;
  return r;
}

function unitChecks() {
  clearProgress();
  let t = 1_000;
  const now = () => t;

  // Keys
  check('a key is taken from X-Progress-Key', progressKeyFrom(fakeReq({ 'X-Progress-Key': 'abcdefgh-1234' })) === 'abcdefgh-1234');
  check('...or the Idempotency-Key the request already sends', progressKeyFrom(fakeReq({ 'Idempotency-Key': 'attempt-12345' })) === 'attempt-12345');
  check('...and nonsense is refused', progressKeyFrom(fakeReq({ 'X-Progress-Key': 'no spaces/or slashes' })) === null);
  check('...as is a key too short to be anyone\'s secret', progressKeyFrom(fakeReq({ 'X-Progress-Key': 'abc' })) === null);

  // A tracked checkout, step by step
  const res = fakeRes();
  const tr = trackProgress(fakeReq({ 'X-Progress-Key': 'unit-key-0001' }), res, 'user:A', 'checkout', { detail: { lines: 1000 }, now });
  t += 1_200; tr.step('reserving');
  t += 300; tr.step('creating', { shops: 15 });
  t += 500; tr.step('confirming');
  t += 4_000;
  const mid = readProgress('unit-key-0001', 'user:A', now);
  check('the owner reads where it has got to', mid?.step === 'confirming' && mid.done === false,
    mid);
  check('...with every step so far, in order, timed from the start',
    JSON.stringify(mid?.steps) === JSON.stringify([
      { step: 'checking', ms: 0 }, { step: 'reserving', ms: 1200 }, { step: 'creating', ms: 1500 }, { step: 'confirming', ms: 2000 },
    ]), mid?.steps);
  check('...and what it is working on (1,000 lines, 15 shops)', mid?.detail.lines === 1000 && mid?.detail.shops === 15, mid?.detail);
  check('someone else gets nothing', readProgress('unit-key-0001', 'user:B', now) === null);
  check('an admin with the same key gets nothing either', readProgress('unit-key-0001', 'admin:A', now) === null);

  const logs: string[] = [];
  const realLog = console.log;
  console.log = (...a: unknown[]) => { logs.push(a.join(' ')); };
  res.emit('finish');
  console.log = realLog;
  const end = readProgress('unit-key-0001', 'user:A', now);
  check('the response going out closes it as done', end?.done === true && end.failed === false, end);
  check('...and a slow one logs every step\'s duration', logs.some((l) => l.includes('[progress] checkout (1000 lines, 15 shops) done') && l.includes('confirming 4.0s')), logs);

  // A failed one
  const bad = fakeRes();
  (bad as unknown as { statusCode: number }).statusCode = 400;
  trackProgress(fakeReq({ 'X-Progress-Key': 'unit-key-0002' }), bad, 'admin:Z', 'create', { now });
  console.log = () => {};
  bad.emit('finish');
  console.log = realLog;
  const f = readProgress('unit-key-0002', 'admin:Z', now);
  check('an error status closes it as failed, not done', f?.failed === true && f.done === false, f);

  // No key
  const quiet = trackProgress(fakeReq({}), null, 'user:A', 'cancel', { now });
  quiet.step('confirming');
  check('without a key nothing is stored', readProgress('', 'user:A', now) === null);

  // A step can only move forward through one finish
  const once = fakeRes();
  const tr3 = trackProgress(fakeReq({ 'X-Progress-Key': 'unit-key-0003' }), once, 'user:A', 'edit', { now });
  tr3.finish(true);
  tr3.step('saving');
  check('nothing changes after it has finished', readProgress('unit-key-0003', 'user:A', now)?.step === 'checking');

  check('every kind starts with its first step', Object.values(PROGRESS_STEPS).every((s) => s.length >= 2));
}

async function liveChecks() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const stamp = String(Date.now()).slice(-6);
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const parentIds: string[] = [];
  const opening = new Map<string, number>();

  const call = async (path: string, init: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return { status: res.status, body: await res.json() as { success: boolean; error?: string; data?: any } };
  };

  /** Fire a request and poll its progress every 20ms until it answers. */
  const watched = async (key: string, token: string, request: () => Promise<{ status: number; body: any }>) => {
    const seen: string[] = [];
    let finished = false;
    const poll = (async () => {
      while (!finished) {
        const p = await call(`/api/orders/progress/${key}`, { token });
        if (p.status === 200 && seen[seen.length - 1] !== p.body.data.step) seen.push(p.body.data.step);
        await new Promise((r) => setTimeout(r, 20));
      }
    })();
    const result = await request();
    finished = true;
    await poll;
    const final = await call(`/api/orders/progress/${key}`, { token });
    return { result, seen, final };
  };

  try {
    const variants = await prisma.productVariant.findMany({
      where: { is_active: true, product: { is_active: true }, stock_quantity: { gte: 10 } },
      select: { id: true, product_id: true, stock_quantity: true },
      take: 12,
    });
    if (variants.length < 4) { console.log('  SKIP  not enough stocked variants for the live part'); return; }
    for (const v of variants) opening.set(v.id, v.stock_quantity);

    const user = await prisma.user.create({
      data: { name: `QA Progress ${stamp}`, email: `qa.progress.${stamp}@cesto.test` },
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
    await call('/api/cart', {
      method: 'PUT', token,
      body: { items: variants.map((v) => ({ productId: v.product_id, variantId: v.id, quantity: 1 })) },
    });

    const key = `qa-progress-${stamp}-checkout`;
    const { result, seen, final } = await watched(key, token, () => call('/api/orders', {
      method: 'POST', token, headers: { 'Idempotency-Key': key },
      body: { addressId: address.id, paymentMethod: 'cod' },
    }));
    check('a real checkout is placed', result.status === 201, { status: result.status, error: result.body.error });
    const placed = result.body.data;
    const placedOrders: Array<{ id: string; parent_order_id?: string | null }> = placed?.orders ?? (placed?.id ? [placed] : []);
    for (const o of placedOrders) orderIds.push(o.id);
    if (placed?.parent_order?.id) parentIds.push(placed.parent_order.id);

    const steps = (final.body.data?.steps ?? []).map((s: { step: string }) => s.step);
    check('...its progress ends done, with every checkout step reached in order',
      final.status === 200 && final.body.data.done === true
      && JSON.stringify(steps) === JSON.stringify(PROGRESS_STEPS.checkout),
      { status: final.status, steps, done: final.body.data?.done });
    check('...and says how many lines it worked on', final.body.data?.detail?.lines === variants.length, final.body.data?.detail);
    check('...the polls saw it move (never backwards)',
      seen.length >= 1 && seen.every((s, i) => i === 0 || PROGRESS_STEPS.checkout.indexOf(s as never) > PROGRESS_STEPS.checkout.indexOf(seen[i - 1] as never)),
      seen);

    // Someone else, same key
    const other = await prisma.user.create({
      data: { name: `QA Progress B ${stamp}`, email: `qa.progress.b.${stamp}@cesto.test` },
      select: { id: true, email: true },
    });
    userIds.push(other.id);
    const otherToken = generateAccessToken({ userId: other.id, email: other.email ?? undefined });
    const peek = await call(`/api/orders/progress/${key}`, { token: otherToken });
    check('another customer asking for that key gets 404', peek.status === 404, peek.status);
    const unknown = await call(`/api/orders/progress/qa-progress-nope-${stamp}`, { token });
    check('an unknown key is 404 too', unknown.status === 404, unknown.status);

    // Cancel one part, watched
    const target = placedOrders[0];
    if (target) {
      const ckey = `qa-progress-${stamp}-cancel`;
      const c = await watched(ckey, token, () => call(`/api/orders/${target.id}/cancel`, {
        method: 'POST', token, headers: { 'X-Progress-Key': ckey }, body: {},
      }));
      const csteps = (c.final.body.data?.steps ?? []).map((s: { step: string }) => s.step);
      check('a cancel, watched the same way, ends done with its steps',
        c.result.status === 200 && c.final.body.data?.done === true && JSON.stringify(csteps) === JSON.stringify(PROGRESS_STEPS.cancel),
        { status: c.result.status, csteps });
    }
  } finally {
    // Cancel restocked one part; put every variant back where it started anyway.
    if (orderIds.length) {
      await prisma.orderIdempotency.deleteMany({ where: { OR: [{ order_id: { in: orderIds } }, { parent_order_id: { in: parentIds } }] } });
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (parentIds.length) await prisma.parentOrder.deleteMany({ where: { id: { in: parentIds } } });
    for (const [id, was] of opening) {
      await prisma.productVariant.update({ where: { id }, data: { stock_quantity: was } }).catch(() => {});
    }
    if (userIds.length) {
      await prisma.orderIdempotency.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.notification.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
      await prisma.cartItem.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.address.deleteMany({ where: { user_id: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function main() {
  unitChecks();
  await liveChecks();
  await prisma.$disconnect();
  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
