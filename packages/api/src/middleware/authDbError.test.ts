// ─── Integration test · a database error in role auth fails the request ──
//
// Run:  cd packages/api && npm run test:auth-db-error
//
// requireSalesRep and requirePartner are async middleware, and Express 4 does
// not catch a rejected one: a database error inside them was an unhandled
// rejection, which ends the Node process — the whole API, for everyone. On
// staging 2026-10-26 the API went live before its migration ran and every rep
// request took it down. Now the error goes to the error handler and only that
// request fails.
//
// A token for a user id that is not a UUID makes Prisma throw inside both.
// The server runs in this process, so a crash ends the test run itself.
import http from 'http';
import app from '../server';
import prisma from '../lib/prisma';
import { generateAccessToken } from '../lib/jwt';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++; console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const token = generateAccessToken({ userId: 'not-a-uuid', email: 'nobody@cesto.test' });
  const get = async (path: string) => {
    const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return res.status;
  };

  try {
    const rep = await get('/api/sales/me');
    check('a rep request whose auth query fails gets an answer, not a dead server', rep >= 400 && rep < 600, rep);
    const partner = await get('/api/partner/products');
    check('...and so does a partner request', partner >= 400 && partner < 600, partner);
    await new Promise((r) => setTimeout(r, 300));
    const health = await fetch(`${base}/api/health`);
    check('the API is still up afterwards', health.status === 200, health.status);
  } finally {
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
