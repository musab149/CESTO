// ─── Contract test · when a lost connection may be retried, and when not ────
//
// Run:  cd packages/api && npm run test:async-retry
//
// asyncHandler re-runs a handler that lost the database connection. The whole
// safety of that rests on ONE rule — only GET and HEAD — and the rule is
// invisible at every call site, because every route in this codebase is
// wrapped in asyncHandler and none of them mention it.
//
// Get it wrong in the generous direction and hiring a sales rep runs twice:
// the first attempt creates the user, loses the connection on the grant, and
// the retry re-creates the user and answers "that account is already a sales
// rep" for something the admin did once. That is not hypothetical — the user
// create and the role grant are two separate writes in one handler.
//
// Get it wrong in the strict direction and a one-off P1001 on a read becomes
// a 503 the admin sees as a broken page, which is what happened on production
// on 2026-10-09.
import assert from 'assert';
import { Prisma } from '@prisma/client';
import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from './async';

const connErr = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('connection lost', { code, clientVersion: 'test' });

/** Runs a wrapped handler and resolves with what reached `next`. */
function run(
  method: string,
  fn: () => Promise<unknown>,
  { headersSent = false }: { headersSent?: boolean } = {},
): Promise<unknown> {
  return new Promise((resolve) => {
    const req = { method, originalUrl: '/test' } as unknown as Request;
    const res = { headersSent } as unknown as Response;
    const next = ((err?: unknown) => resolve(err)) as NextFunction;
    const handler = asyncHandler(fn as never);
    handler(req, res, next);
    // Nothing reaching `next` is itself the result for the success cases.
    setTimeout(() => resolve(undefined), 1500);
  });
}

const cases: Array<{ name: string; run: () => Promise<void> }> = [];
const test = (name: string, fn: () => Promise<void>) => cases.push({ name, run: fn });

test('a handler that works is left alone', async () => {
  let calls = 0;
  const err = await run('GET', async () => { calls++; });
  assert.equal(calls, 1);
  assert.equal(err, undefined, 'a successful handler must not reach the error middleware');
});

test('a GET that loses the connection is retried once, and succeeds', async () => {
  let calls = 0;
  const err = await run('GET', async () => {
    calls++;
    if (calls === 1) throw connErr('P1001');
  });
  assert.equal(calls, 2, 'should have run again');
  assert.equal(err, undefined, 'the retry worked, so nothing should reach the error middleware');
});

test('a GET that loses it twice gives up and reports', async () => {
  let calls = 0;
  const err = await run('GET', async () => { calls++; throw connErr('P1001'); });
  assert.equal(calls, 2, 'one retry, not a loop');
  assert.ok(err instanceof Prisma.PrismaClientKnownRequestError, 'the error must reach the middleware');
});

test('A WRITE IS NEVER RETRIED — the rule the whole thing rests on', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    let calls = 0;
    const err = await run(method, async () => { calls++; throw connErr('P1001'); });
    assert.equal(calls, 1, `${method} ran twice — a half-finished write would be replayed`);
    assert.ok(err, `${method} must report the failure`);
  }
});

test('only connection failures are retried, not query failures', async () => {
  // P2002 is a unique-constraint violation: the query reached the database and
  // was refused. Running it again just gets refused again.
  let calls = 0;
  const err = await run('GET', async () => { calls++; throw connErr('P2002'); });
  assert.equal(calls, 1);
  assert.ok(err);
});

test('an initialization failure counts as a lost connection', async () => {
  let calls = 0;
  const err = await run('GET', async () => {
    calls++;
    if (calls === 1) throw new Prisma.PrismaClientInitializationError('cannot connect', 'test');
  });
  assert.equal(calls, 2);
  assert.equal(err, undefined);
});

test('nothing is retried once a response has started', async () => {
  // A second run would be a second response, which Express answers with
  // ERR_HTTP_HEADERS_SENT — a worse failure than the one being recovered from.
  let calls = 0;
  const err = await run('GET', async () => { calls++; throw connErr('P1001'); }, { headersSent: true });
  assert.equal(calls, 1);
  assert.ok(err);
});

(async () => {
  let failures = 0;
  for (const { name, run: fn } of cases) {
    try {
      await fn();
      console.log(`  ok  ${name}`);
    } catch (e) {
      failures++;
      const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
      console.error(`  FAIL ${name}\n      ${msg.replace(/\n/g, '\n      ')}`);
    }
  }
  console.log(`\n${cases.length - failures}/${cases.length} passed`);
  if (failures > 0) process.exit(1);
})();
