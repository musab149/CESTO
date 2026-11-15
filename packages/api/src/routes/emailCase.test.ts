// ─── Integration test · an address finds its account, whatever the capitals ──
//
// Run:  cd packages/api && npm run test:email-case
//
// `users.email` is a plain unique column, so Postgres and Prisma both read
// `Omar@gmail.com` and `omar@gmail.com` as two different people. The customer
// auth routes never normalised one; createClient.ts, salesReps.ts and the b2b
// approval all lowercase before writing. Half the codebase stored one thing
// and the other half looked up another.
//
// Reported from production on 2026-10-10: b2b clients could not sign in with
// the address in their own welcome email. THREE people had two accounts each,
// differing only in capitals — they had registered with a capital first
// letter, which is what a phone keyboard offers, and the b2b approval then
// made a second, lowercased account holding the temp password that was
// emailed to them. The address they were used to typing reached the account
// whose password was not the one they had been sent.
//
// The rule under test: AN ADDRESS IS LOWER CASE. Normalised going in and
// going out, so nothing downstream has to think about capitals. A row stored
// with capitals before any of this is still reachable — that is a net, not a
// second rule, and it can only ever match one row now that the duplicates are
// gone.
//
// NOTE: registration is rate limited to 10/hour per IP. This suite spends two
// of them, so about five runs in an hour will start seeing 429s.
import http from 'http';
import bcrypt from 'bcryptjs';
import app from '../server';
import prisma from '../lib/prisma';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++; console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

const stamp = String(Date.now()).slice(-7);

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userIds: string[] = [];

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as { data?: Record<string, unknown>; error?: string } };
  };

  try {
    // ─── 1. A legacy row stored WITH capitals is still reachable ─
    const legacyEmail = `QA.Legacy.${stamp}@Cesto.test`;
    const legacyPw = 'LegacyPass1';
    const legacy = await prisma.user.create({
      data: {
        name: 'QA Legacy',
        email: legacyEmail,                       // as it sits on production
        password_hash: await bcrypt.hash(legacyPw, 12),
      },
      select: { id: true },
    });
    userIds.push(legacy.id);

    const asStored = await post('/api/auth/login-email', { email: legacyEmail, password: legacyPw });
    check('a legacy capitalised account logs in with its exact address',
      asStored.status === 200, { status: asStored.status, error: asStored.body.error });

    const asTyped = await post('/api/auth/login-email', { email: legacyEmail.toLowerCase(), password: legacyPw });
    check('...AND with the same address in lower case — the reported bug',
      asTyped.status === 200, { status: asTyped.status, error: asTyped.body.error });

    // ─── 2. Registration normalises, and refuses a case twin ─────
    const regMixed = `QA.Reg.${stamp}@Cesto.test`;
    const reg = await post('/api/auth/register-email', {
      name: 'QA Reg', email: regMixed, password: 'RegPass123',
    });
    check('registering with capitals succeeds', reg.status === 201,
      { status: reg.status, error: reg.body.error });

    const stored = await prisma.user.findFirst({
      where: { email: { equals: regMixed, mode: 'insensitive' } },
      select: { id: true, email: true },
    });
    if (stored) userIds.push(stored.id);
    check('...and the address is STORED in lower case',
      stored?.email === regMixed.toLowerCase(), { got: stored?.email, want: regMixed.toLowerCase() });

    const twin = await post('/api/auth/register-email', {
      name: 'QA Twin', email: regMixed.toLowerCase(), password: 'TwinPass123',
    });
    check('...and signing up again in another case is refused, not duplicated',
      twin.status === 409, { status: twin.status, error: twin.body.error });

    const howMany = await prisma.user.count({ where: { email: { equals: regMixed, mode: 'insensitive' } } });
    check('...leaving exactly one account for that address', howMany === 1, { count: howMany });

    // ─── 3. Where both forms somehow exist, LOWER CASE wins ─────
    //
    // Three such pairs existed on production and were merged by hand on
    // 2026-10-10; all three environments now hold none. This is here so the
    // behaviour is DEFINED rather than whatever the query planner returns
    // first: the address is lower case, so the lower-case row is the account.
    //
    // It is also the check that would catch the rule being quietly reverted.
    // While the pairs existed a read deliberately preferred an exact match,
    // because lowercasing the input would move each person onto whichever of
    // their two accounts was lower case. That protection is gone with the
    // pairs, and this asserts which rule is in force.
    const upper = `QA.Pair.${stamp}@Cesto.test`;
    const lower = upper.toLowerCase();
    const upperPw = 'UpperPass1';
    const lowerPw = 'LowerPass1';

    const uRow = await prisma.user.create({
      data: { name: 'QA Pair upper', email: upper, password_hash: await bcrypt.hash(upperPw, 12) },
      select: { id: true },
    });
    userIds.push(uRow.id);
    const lRow = await prisma.user.create({
      data: { name: 'QA Pair lower', email: lower, password_hash: await bcrypt.hash(lowerPw, 12) },
      select: { id: true },
    });
    userIds.push(lRow.id);

    const typedUpper = await post('/api/auth/login-email', { email: upper, password: lowerPw });
    check('typing capitals reaches the LOWER-CASE account', typedUpper.status === 200,
      { status: typedUpper.status, error: typedUpper.body.error });

    const typedLower = await post('/api/auth/login-email', { email: lower, password: lowerPw });
    check('...and so does typing it in lower case', typedLower.status === 200,
      { status: typedLower.status, error: typedLower.body.error });

    const strandedPw = await post('/api/auth/login-email', { email: upper, password: upperPw });
    check('...so the capitalised row is not reachable while a lower-case one exists',
      strandedPw.status === 401, { status: strandedPw.status });

    // ─── 4. Forgot-password finds a legacy row too ───────────────
    //
    // Worth its own check: it is the way back IN for anyone already stuck,
    // and a 404 here reads to the customer as "we have no record of you".
    const forgot = await post('/api/auth/forgot-password', { email: legacyEmail.toLowerCase() });
    check('a reset can be requested using the other capitalisation',
      forgot.status === 200, { status: forgot.status, error: forgot.body.error });

  } finally {
    if (userIds.length) {
      await prisma.passwordResetToken.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => {});
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
