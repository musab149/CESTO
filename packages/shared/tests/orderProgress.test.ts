/**
 * The order progress panel's model, as a contract.
 *
 *   npm run test:order-progress --workspace=packages/shared
 *
 * What the pages draw while a big order is placed, created, edited or
 * cancelled. What must hold:
 *   · the steps are the API's steps, in the API's order (no drift — the API
 *     keeps its own copy because it cannot import this package);
 *   · the bar only moves forward and never shows 100% before the work is done;
 *   · no report from the server (older API, other instance) still draws the
 *     first step as under way rather than nothing;
 *   · the words say what is happening, with the real counts.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { orderProgressModel, ORDER_PROGRESS_STEPS, type OrderProgressView } from '../src/orderProgress';

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

const view = (step: OrderProgressView['step'], extra: Partial<OrderProgressView> = {}): OrderProgressView => ({
  kind: 'checkout', step, steps: [{ step: 'checking', ms: 0 }, ...(step !== 'checking' ? [{ step, ms: 2000 }] : [])],
  detail: { lines: 1000, shops: 15 }, elapsedMs: 3000, done: false, failed: false, ...extra,
});

test('the steps are the API\'s steps, in its order', () => {
  const apiFile = path.join(__dirname, '../../api/src/lib/orderProgress.ts');
  // A branch that does not carry the API's half yet (mobile/expo-54 until
  // master is merged in) has nothing to drift from.
  if (!fs.existsSync(apiFile)) { console.log('      (API step lists not on this branch — skipped)'); return; }
  const src = fs.readFileSync(apiFile, 'utf8');
  const block = src.slice(src.indexOf('PROGRESS_STEPS'), src.indexOf('};', src.indexOf('PROGRESS_STEPS')));
  for (const [kind, steps] of Object.entries(ORDER_PROGRESS_STEPS)) {
    const m = block.match(new RegExp(`${kind}: \\[([^\\]]*)\\]`));
    assert.ok(m, `API has no step list for ${kind}`);
    const api = m![1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
    assert.deepStrictEqual(api, steps, `${kind} drifted`);
  }
});

test('checkout draws basket, the server\'s four steps, and opening', () => {
  const m = orderProgressModel({ kind: 'checkout', lang: 'en', phase: 'before', view: null, phaseElapsedMs: 0, withBasket: true, withOpening: true });
  assert.deepStrictEqual(m.steps.map((s) => s.id), ['basket', 'checking', 'reserving', 'creating', 'confirming', 'opening']);
  assert.strictEqual(m.steps[0].state, 'active');
  assert.ok(m.steps.slice(1).every((s) => s.state === 'todo'));
});

test('the server\'s step is the one under way, earlier ones done', () => {
  const m = orderProgressModel({ kind: 'checkout', lang: 'en', phase: 'server', view: view('creating'), phaseElapsedMs: 3000, withBasket: true, withOpening: true });
  assert.deepStrictEqual(m.steps.map((s) => s.state), ['done', 'done', 'done', 'active', 'todo', 'todo']);
  assert.strictEqual(m.steps[3].label, 'Creating the orders for 15 shops');
  assert.strictEqual(m.steps[1].label, 'Checking 1,000 products');
});

test('the bar only moves forward, and holds below 100 until done', () => {
  const at = (phase: 'before' | 'server' | 'after', v: OrderProgressView | null, ms: number) =>
    orderProgressModel({ kind: 'checkout', lang: 'es', phase, view: v, phaseElapsedMs: ms, withBasket: true, withOpening: true }).percent;
  const series = [
    at('before', null, 0), at('before', null, 3000), at('server', null, 500),
    at('server', view('checking'), 0), at('server', view('reserving'), 0), at('server', view('creating'), 0),
    at('server', view('confirming'), 0), at('server', { ...view('confirming'), elapsedMs: 60_000 }, 0),
    at('after', view('confirming', { done: true }), 0), at('after', view('confirming', { done: true }), 2000),
  ];
  for (let i = 1; i < series.length; i++) assert.ok(series[i] >= series[i - 1], `went back at ${i}: ${series.join(',')}`);
  assert.ok(series.every((p) => p < 100), `reached 100 early: ${series.join(',')}`);
  // A step that drags on still never fills past its share.
  assert.ok(at('server', { ...view('checking'), elapsedMs: 600_000 }, 0) < at('server', view('reserving'), 0));
});

test('a late report never pulls the bar back, and the bar moves between reports', () => {
  const at = (v: OrderProgressView | null, ms: number) =>
    orderProgressModel({ kind: 'cancel', lang: 'en', phase: 'server', view: v, phaseElapsedMs: ms }).percent;
  // Seen on staging 2026-10-21 over a slow connection: three seconds of easing
  // on the page's own clock, then the first answer — taken when the server had
  // only just started — dropped the bar from 29% to 0%.
  const justStarted: OrderProgressView = {
    kind: 'cancel', step: 'cancelling', steps: [{ step: 'cancelling', ms: 0 }],
    detail: {}, elapsedMs: 5, done: false, failed: false,
  };
  assert.ok(at(justStarted, 3200) >= at(null, 3000), `went back: ${at(null, 3000)} → ${at(justStarted, 3200)}`);
  // The same report, still the latest a second later, does not freeze the bar.
  assert.ok(at(justStarted, 4200) > at(justStarted, 3200), 'froze between reports');
});

test('100% only when the server is done and nothing of the page\'s is left', () => {
  const m = orderProgressModel({ kind: 'cancel', lang: 'en', phase: 'after', view: null, phaseElapsedMs: 0 });
  assert.strictEqual(m.percent, 100);
  assert.ok(m.steps.every((s) => s.state === 'done'));
});

test('no report from the server still shows the first step working', () => {
  const m = orderProgressModel({ kind: 'create', lang: 'es', phase: 'server', view: null, phaseElapsedMs: 5000, detail: { lines: 1000 } });
  assert.strictEqual(m.steps[0].state, 'active');
  // Spanish writes four digits without a separator (1000) and groups from
  // five (10.000) — Intl's es-ES rule, which is the correct one.
  assert.strictEqual(m.steps[0].label, 'Comprobando 1000 productos');
  const big = orderProgressModel({ kind: 'create', lang: 'es', phase: 'server', view: null, phaseElapsedMs: 0, detail: { lines: 12000 } });
  assert.strictEqual(big.steps[0].label, 'Comprobando 12.000 productos');
  assert.ok(m.percent > 0 && m.percent < 100);
});

test('words for every kind, in both languages', () => {
  for (const kind of Object.keys(ORDER_PROGRESS_STEPS) as Array<keyof typeof ORDER_PROGRESS_STEPS>) {
    for (const lang of ['es', 'en'] as const) {
      const m = orderProgressModel({ kind, lang, phase: 'server', view: null, phaseElapsedMs: 0, withOpening: kind !== 'cancel' && kind !== 'edit' });
      assert.ok(m.title.length > 3, `${kind}/${lang} title`);
      assert.ok(m.steps.every((s) => s.label.length > 3), `${kind}/${lang} labels`);
    }
  }
  const es = orderProgressModel({ kind: 'cancel', lang: 'es', phase: 'server', view: null, phaseElapsedMs: 0, detail: { lines: 998 } });
  assert.strictEqual(es.steps[0].label, 'Cancelando y devolviendo 998 productos al stock');
});

let failures = 0;
for (const { name, run } of cases) {
  try { run(); console.log(`  ok  ${name}`); }
  catch (e) {
    failures++;
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    console.error(`  FAIL ${name}\n      ${msg.replace(/\n/g, '\n      ')}`);
  }
}
console.log(`\n${cases.length - failures}/${cases.length} passed`);
if (failures > 0) process.exit(1);
