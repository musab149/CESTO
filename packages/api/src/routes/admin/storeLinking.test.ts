// ─── Integration tests · linking a partner to an existing store ────
//
// Admin can approve a partner application onto a store Cesto already created,
// instead of creating a new one. The rules that matter are about which stores
// are eligible, and they are all invisible to a typecheck:
//
//   · only created_via='admin' — a store created BY an approval belongs to a
//     partner already, and offering it would hand one partner's storefront to
//     another
//   · only stores with NO PartnerStoreRole at all, active or not
//   · not deleted, not scheduled for deletion
//   · the store leaves the pool the moment it is linked
//   · eligibility is re-checked inside the transaction, so two admins racing
//     cannot both link the same store
//
// Also covers the application data surviving approval as a PartnerProfile,
// which is the point of the feature beyond the plumbing.
//
// Run:  cd packages/api && npm run test:store-linking

import http from 'http';
import app from '../../server';
import prisma from '../../lib/prisma';
import { generateAdminAccessToken } from '../../lib/jwt';

const TOKEN = generateAdminAccessToken({
  adminId: '00000000-0000-4000-8000-00000000ad22',
  email: 'link-test@cesto.local',
  role: 'super_admin',
});

/** An ops admin. Unlink is super_admin-only, and that guard needs a negative
 *  case or the restriction is decorative. `ops` is the realistic one to test —
 *  it is the role support staff hold. */
const PLAIN_ADMIN_TOKEN = generateAdminAccessToken({
  adminId: '00000000-0000-4000-8000-00000000ad23',
  email: 'link-test-ops@cesto.local',
  role: 'ops',
});

let base = '';
let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

async function req(method: string, path: string, body?: unknown, auth: boolean | 'plain' = true) {
  const bearer = auth === 'plain' ? PLAIN_ADMIN_TOKEN : TOKEN;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const stamp = Date.now();
  const storeIds: string[] = [];
  const leadIds: string[] = [];
  const userEmails: string[] = [];

  const mkStore = async (label: string, over: Record<string, unknown> = {}) => {
    const st = await prisma.store.create({
      data: {
        name: `LinkTest ${label} ${stamp}`,
        slug: `linktest-${label.toLowerCase()}-${stamp}`,
        status: 'draft', is_active: true,
        ...over,
      },
      select: { id: true },
    });
    storeIds.push(st.id);
    return st.id;
  };

  const mkLead = async (suffix: string) => {
    const l = await prisma.b2bLead.create({
      data: {
        type: 'partner_store', source: 'partner_form',
        name: `Applicant ${suffix}`, company: `Company ${suffix} ${stamp}`,
        email: `link-${suffix}-${stamp}@cesto.local`, phone: '+34600111222',
        location: 'Madrid', business_type: 'Grocery',
        website: 'https://example.test', registration_no: `REG-${suffix}`,
      },
      select: { id: true, email: true },
    });
    leadIds.push(l.id);
    userEmails.push(l.email.toLowerCase());
    return l.id;
  };

  try {
    // ── eligibility of the pool ─────────────────────────
    console.log('\nWhich stores are offered');
    const freeStore = await mkStore('Free');
    const approvalStore = await mkStore('FromApproval', { created_via: 'partner_approval' });
    const deletedStore = await mkStore('Tombstoned', { deleted_at: new Date() });
    const pendingStore = await mkStore('PendingDelete', {
      deletion_scheduled_at: new Date(Date.now() + 5 * 864e5),
    });

    {
      const r = await req('GET', '/api/admin/stores/linkable');
      const ids = (r.body?.data?.items ?? []).map((s: any) => s.id);
      check('endpoint responds', r.status === 200, r.status);
      check('an unclaimed admin store is offered', ids.includes(freeStore), ids.length);
      check('an approval-created store is NOT offered', !ids.includes(approvalStore));
      check('a tombstoned store is NOT offered', !ids.includes(deletedStore));
      check('a store scheduled for deletion is NOT offered', !ids.includes(pendingStore));
      const row = (r.body?.data?.items ?? []).find((s: any) => s.id === freeStore);
      check('rows carry the counts the admin needs to see what is inherited',
        row && typeof row._count?.products === 'number' && typeof row._count?.orders === 'number',
        row?._count);
    }

    // ── linking ─────────────────────────────────────────
    console.log('\nLinking an application to a store');
    const leadA = await mkLead('a');
    {
      const r = await req('POST', `/api/admin/leads/${leadA}/approve`, {
        partner_user: { name: 'Partner A', email: `link-a-${stamp}@cesto.local` },
        store_id: freeStore,
      });
      check('approval succeeds', r.status === 200 || r.status === 201, r.body);

      const roles = await prisma.partnerStoreRole.findMany({
        where: { store_id: freeStore }, select: { role: true, is_active: true },
      });
      check('the partner owns the store', roles.length === 1 && roles[0].role === 'owner' && roles[0].is_active, roles);

      const st = await prisma.store.findUnique({
        where: { id: freeStore }, select: { created_via: true },
      });
      check('linking does NOT rewrite provenance', st?.created_via === 'admin', st?.created_via);
    }
    {
      const r = await req('GET', '/api/admin/stores/linkable');
      const ids = (r.body?.data?.items ?? []).map((s: any) => s.id);
      check('a linked store leaves the pool', !ids.includes(freeStore), ids.length);
    }

    // ── the application survives ────────────────────────
    console.log('\nThe submitted application is kept');
    {
      const user = await prisma.user.findUnique({
        where: { email: `link-a-${stamp}@cesto.local` },
        select: { id: true, is_business: true, partner_profile: true },
      });
      const pp = user?.partner_profile;
      check('a partner profile exists', !!pp, pp);
      check('it carries the company from the form', pp?.company === `Company a ${stamp}`, pp?.company);
      check('and the registration number', pp?.registration_no === 'REG-a', pp?.registration_no);
      check('and the trading location', pp?.location === 'Madrid', pp?.location);
      check('it points at the linked store', pp?.linked_store_id === freeStore, pp?.linked_store_id);
      check('and records that an existing store was adopted', pp?.linked_existing === true, pp?.linked_existing);
      check('the partner is NOT flagged as a wholesale buyer', user?.is_business === false, user?.is_business);
    }

    // ── refusals ────────────────────────────────────────
    console.log('\nStores that must be refused');
    {
      const lead = await mkLead('b');
      const r = await req('POST', `/api/admin/leads/${lead}/approve`, {
        partner_user: { name: 'Partner B', email: `link-b-${stamp}@cesto.local` },
        store_id: freeStore,
      });
      check('a store that already has a partner is refused', r.status === 409, r.status);
      const roles = await prisma.partnerStoreRole.count({ where: { store_id: freeStore } });
      check('and no second owner is attached', roles === 1, roles);
    }
    {
      const lead = await mkLead('c');
      const r = await req('POST', `/api/admin/leads/${lead}/approve`, {
        partner_user: { name: 'Partner C', email: `link-c-${stamp}@cesto.local` },
        store_id: approvalStore,
      });
      check('an approval-created store is refused', r.status === 409, r.status);
    }
    {
      const lead = await mkLead('d');
      const r = await req('POST', `/api/admin/leads/${lead}/approve`, {
        partner_user: { name: 'Partner D', email: `link-d-${stamp}@cesto.local` },
        store_id: pendingStore,
      });
      check('a store scheduled for deletion is refused', r.status === 409, r.status);
    }

    // ── creating a new store still works ────────────────
    console.log('\nCreating a new store (the other branch)');
    {
      const lead = await mkLead('e');
      const r = await req('POST', `/api/admin/leads/${lead}/approve`, {
        partner_user: { name: 'Partner E', email: `link-e-${stamp}@cesto.local` },
        store: { name: `LinkTest Created ${stamp}` },
      });
      check('approval creates a store', r.status === 200 || r.status === 201, r.body);
      const created = await prisma.store.findFirst({
        where: { name: `LinkTest Created ${stamp}` },
        select: { id: true, created_via: true, status: true },
      });
      if (created) storeIds.push(created.id);
      check('marked as approval-created', created?.created_via === 'partner_approval', created?.created_via);
      check('and starts as a draft', created?.status === 'draft', created?.status);

      const pool = await req('GET', '/api/admin/stores/linkable');
      const ids = (pool.body?.data?.items ?? []).map((s: any) => s.id);
      check('so it never enters the link pool', !ids.includes(created?.id), created?.id);

      const user = await prisma.user.findUnique({
        where: { email: `link-e-${stamp}@cesto.local` },
        select: { partner_profile: { select: { linked_existing: true, company: true } } },
      });
      check('the application is kept for this branch too', !!user?.partner_profile, user?.partner_profile);
      check('and records that the store was created, not adopted',
        user?.partner_profile?.linked_existing === false, user?.partner_profile?.linked_existing);
    }

    // ── unlink ──────────────────────────────────────────
    console.log('\nUnlinking');
    {
      const r = await req('POST', `/api/admin/stores/${freeStore}/unlink-partner`);
      check('unlink succeeds', r.status === 200, r.body);
      check('it reports who was removed', (r.body?.data?.unlinked ?? []).length === 1, r.body?.data?.unlinked);
      check('and that the store returns to the pool', r.body?.data?.returned_to_link_pool === true, r.body?.data);

      const roles = await prisma.partnerStoreRole.count({ where: { store_id: freeStore } });
      check('the role is gone', roles === 0, roles);

      const user = await prisma.user.findUnique({
        where: { email: `link-a-${stamp}@cesto.local` },
        select: { id: true, partner_profile: { select: { linked_store_id: true, company: true } } },
      });
      check('the user account survives', !!user, !!user);
      check('the application record survives', !!user?.partner_profile, user?.partner_profile);
      check('with its store pointer cleared', user?.partner_profile?.linked_store_id === null, user?.partner_profile?.linked_store_id);

      const pool = await req('GET', '/api/admin/stores/linkable');
      const ids = (pool.body?.data?.items ?? []).map((s: any) => s.id);
      check('the store is offered again', ids.includes(freeStore), ids.length);
    }
    {
      const r = await req('POST', `/api/admin/stores/${freeStore}/unlink-partner`);
      check('unlinking an unlinked store is refused', r.status === 409, r.status);
    }

    // ── unlinking an approval-created store ─────────────
    console.log('\nUnlinking a store that an approval created');
    {
      // Give the approval-created store a partner, then unlink. It must NOT
      // return to the pool: it was never unclaimed inventory, and re-offering
      // it would misrepresent where it came from.
      const lead = await mkLead('f');
      const email = `link-f-${stamp}@cesto.local`;
      const r = await req('POST', `/api/admin/leads/${lead}/approve`, {
        partner_user: { name: 'Partner F', email },
        store: { name: `LinkTest Adopted ${stamp}` },
      });
      check('setup: approval created a store', r.status === 200 || r.status === 201, r.body);
      const created = await prisma.store.findFirst({
        where: { name: `LinkTest Adopted ${stamp}` }, select: { id: true },
      });
      if (created) storeIds.push(created.id);

      const un = await req('POST', `/api/admin/stores/${created!.id}/unlink-partner`);
      check('unlink succeeds', un.status === 200, un.body);
      check('but it does NOT return to the link pool',
        un.body?.data?.returned_to_link_pool === false, un.body?.data);

      const pool = await req('GET', '/api/admin/stores/linkable');
      const ids = (pool.body?.data?.items ?? []).map((s: any) => s.id);
      check('and it is genuinely absent from the pool', !ids.includes(created!.id), created!.id);

      const via = await prisma.store.findUnique({
        where: { id: created!.id }, select: { created_via: true },
      });
      check('its provenance is unchanged by unlinking',
        via?.created_via === 'partner_approval', via?.created_via);
    }

    // ── role guard ──────────────────────────────────────
    console.log('\nWho may unlink');
    {
      const lead = await mkLead('g');
      const email = `link-g-${stamp}@cesto.local`;
      await req('POST', `/api/admin/leads/${lead}/approve`, {
        partner_user: { name: 'Partner G', email },
        store_id: freeStore,
      });

      const r = await req('POST', `/api/admin/stores/${freeStore}/unlink-partner`, undefined, 'plain');
      check('an ops admin cannot unlink', r.status === 403, r.status);
      const roles = await prisma.partnerStoreRole.count({ where: { store_id: freeStore } });
      check('and the partner keeps the store', roles === 1, roles);

      const ok = await req('POST', `/api/admin/stores/${freeStore}/unlink-partner`);
      check('a super_admin can', ok.status === 200, ok.status);
    }

    // ── auth ────────────────────────────────────────────
    console.log('\nAuthentication');
    {
      const r = await req('GET', '/api/admin/stores/linkable', undefined, false);
      check('the pool requires an admin', r.status === 401, r.status);
    }
  } finally {
    if (userEmails.length) {
      const users = await prisma.user.findMany({
        where: { email: { in: userEmails } }, select: { id: true },
      });
      const uids = users.map((u) => u.id);
      if (uids.length) {
        await prisma.partnerProfile.deleteMany({ where: { user_id: { in: uids } } });
        await prisma.partnerStoreRole.deleteMany({ where: { user_id: { in: uids } } });
        await prisma.user.deleteMany({ where: { id: { in: uids } } });
      }
    }
    if (leadIds.length) await prisma.b2bLead.deleteMany({ where: { id: { in: leadIds } } });
    if (storeIds.length) {
      await prisma.partnerStoreRole.deleteMany({ where: { store_id: { in: storeIds } } });
      await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    }
    await new Promise<void>((r) => server.close(() => r()));
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
