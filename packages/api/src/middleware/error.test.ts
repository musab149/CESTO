// ─── Contract test · which Prisma codes are OUR fault, and which are not ────
//
// Run:  cd packages/api && npm run test:error-codes
//
// Every Prisma code the handler does not recognise becomes a 500 reading
// "Database error (Pxxxx). Please try again." That default is correct for an
// unknown code and wrong for the ones below, and the difference is not
// cosmetic:
//
//   · 500 tells the caller WE broke. The admin panel acts on it by replacing
//     the whole page with ERROR 500, so a one-off blip looks like an outage.
//   · 503 tells the caller to try again, which is exactly true of a lost
//     connection, a busy pool or a deadlock.
//
// On 2026-10-09 an admin hired a sales rep on production. The rep was created.
// The refetch that followed hit P1001, was served as a 500, and the panel
// threw away the page — so the one thing they could not establish was whether
// their own action had worked.
import assert from 'assert';
import { Prisma } from '@prisma/client';
import { knownPrismaResponse } from './error';

const of = (code: string) =>
  knownPrismaResponse(new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' }));

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

/** Codes that mean the database, not the request. All must read as 5xx. */
const INFRASTRUCTURE = ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034'];

/** Codes the caller can act on. */
const CALLER = { P2002: 409, P2025: 404, P2003: 400 } as const;

test('every connection-level code answers 503, not 500', () => {
  for (const code of INFRASTRUCTURE) {
    const r = of(code);
    assert.ok(r, `${code} is unclassified — it will be served as a generic 500`);
    assert.equal(r.status, 503, `${code} should be 503`);
  }
});

test('and says something a person can read', () => {
  for (const code of INFRASTRUCTURE) {
    const r = of(code)!;
    assert.ok(r.message.length > 20, `${code} has no real message`);
    assert.ok(!r.message.includes(code), `${code} leaks the Prisma code into the message`);
    // The whole point of a 503 is that trying again is the right move.
    assert.ok(/try again/i.test(r.message), `${code} does not tell the caller to try again`);
  }
});

test('the caller-fault codes keep their own statuses', () => {
  for (const [code, status] of Object.entries(CALLER)) {
    assert.equal(of(code)?.status, status, `${code} should stay ${status}`);
  }
});

test('a malformed id is a 404; other inconsistent data is still a 500', () => {
  const bad = (message: string) =>
    knownPrismaResponse(new Prisma.PrismaClientKnownRequestError(message, { code: 'P2023', clientVersion: 'test' }));
  assert.equal(bad('Inconsistent column data: Error creating UUID, invalid character')?.status, 404);
  assert.equal(bad('Inconsistent column data: something else'), null);
});

test('an unknown code is still left to the 500 default', () => {
  // The default is deliberate: an unrecognised code is not knowingly
  // transient, and silently calling it 503 would hide a real bug behind
  // "please try again".
  assert.equal(of('P2037'), null);
  assert.equal(of('P9999'), null);
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
