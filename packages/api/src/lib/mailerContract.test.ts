// ─── Contract test · mail that carries a password must not fail quietly ────
//
// Run:  cd packages/api && npm run test:mailer-contract
//
// The Resend sender logs a rejection and resolves unless the caller asked for
// `throwOnFail: true`. That default is right for most mail: an order
// confirmation that cannot be sent should not fail the order.
//
// It is wrong for anything carrying a credential. Those sends are awaited by a
// route that reports back whether the mail went — "credentials_sent",
// "email_sent" — and a send that resolves after being refused makes that
// report a lie. The admin is told the login is on its way, the person never
// receives it, and the only trace is one line in a server log nobody is
// watching.
//
// That is not hypothetical: `salesrep-welcome` shipped without it while
// partner-welcome, business-welcome and client-welcome all had it, so a rep
// hired on staging was reported as emailed and never was.
//
// Read as SOURCE rather than exercised, deliberately. Proving it by sending
// would need a Resend account that refuses on demand; the property worth
// holding is simply that each of these call sites asks to be told.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { mailerDelivers } from './mailer';

const MAILER = path.join(__dirname, 'mailer.ts');

/**
 * Labels whose mail hands somebody a way in — a temporary password, a reset
 * link, an approval that creates an account. A route reports the outcome of
 * each of these to a human who will act on it.
 */
const MUST_THROW = [
  'reset',
  'client-welcome',
  'salesrep-welcome',
  'partner-welcome',
  'partner-access',
  'business-welcome',
  'partner-request-info',
];

/**
 * Labels that are deliberately fire-and-forget. Listed rather than inferred so
 * that a NEW label has to be classified by hand: an unclassified one fails the
 * last check below, which is the point.
 */
const MAY_SWALLOW = [
  'welcome',
  'order-placed',
  'order-status',
  'order-edited',
  'support',
  'support-receipt',
  'admin-alert',
  'partner-rejected',
  'partner-info-received',
  'home-grocery-approved',
  'home-grocery-rejected',
];

const src = fs.readFileSync(MAILER, 'utf8');

/** Every `send('label', { … })` call, with its options text. */
const CALL = /await send\('([a-z-]+)',\s*\{([^}]*)\}/gs;
const calls = [...src.matchAll(CALL)].map((m) => ({
  label: m[1],
  throws: /throwOnFail:\s*true/.test(m[2]),
}));

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

test('a test run cannot reach a real provider', () => {
  /**
   * The suites in this package run against a developer's own .env, which
   * holds PRODUCTION's Resend key — so before pickMailer() learned to spot a
   * test entrypoint, they sent live email through the account the shop runs
   * on. One pass of test:big-orders attempts eleven, and a working session
   * that runs it a dozen times spends a hundred-a-day quota by itself. On
   * 2026-10-11 it did: password resets began returning 500 on production and
   * order confirmations stopped arriving, because a test run had used up the
   * allowance.
   *
   * This asserts the protection from inside a test, which is the only place
   * it matters. If someone makes the detection cleverer and breaks it, this
   * fails here rather than on the day the quota goes again.
   */
  assert.equal(mailerDelivers, false,
    'a test run has a live mail provider — it will send real email and spend the quota');
});

test('the mailer is actually being read', () => {
  // Guards the regex, not the code: a change to how sends are written would
  // otherwise turn this file into a test that passes by finding nothing.
  assert.ok(calls.length >= 12, `only matched ${calls.length} send() calls`);
});

test('every credential mail asks to be told when it is refused', () => {
  const quiet = MUST_THROW
    .filter((label) => calls.some((c) => c.label === label))
    .filter((label) => !calls.find((c) => c.label === label)!.throws);
  assert.deepEqual(quiet, [], 'these resolve after a refusal and make the route lie');
});

test('every label in MUST_THROW still exists', () => {
  // A rename that left this list behind would make the check above vacuous —
  // it filters to the labels it can find.
  const missing = MUST_THROW.filter((label) => !calls.some((c) => c.label === label));
  assert.deepEqual(missing, [], 'renamed or removed; update MUST_THROW');
});

test('no send is unclassified', () => {
  // The real guard. A new mail added without a decision about failure lands
  // here, and whoever added it has to say which list it belongs in.
  const known = new Set([...MUST_THROW, ...MAY_SWALLOW]);
  const unknown = [...new Set(calls.map((c) => c.label))].filter((l) => !known.has(l));
  assert.deepEqual(unknown, [], 'classify it in MUST_THROW or MAY_SWALLOW');
});

let failures = 0;
for (const { name, run } of cases) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    console.error(`  FAIL ${name}\n      ${msg.replace(/\n/g, '\n      ')}`);
  }
}
console.log(`\n${cases.length - failures}/${cases.length} passed`);
if (failures > 0) process.exit(1);
