/**
 * Which document freezes an order, and which does not.
 *
 * Four lines of logic that decide whether every screen offers editing, and
 * they were wrong in a way nothing could catch: `issuedInvoiceOf` took the
 * first row on faith, because every admin projection pre-filters to
 * `status: 'issued'`. The rep's order payload does not — it sends drafts too,
 * newest first — so an admin drafting a factura on a rep's order put
 * `kind: 'invoice'` at the head of the list and the rep lost the ability to
 * edit an order that nothing had been issued for.
 *
 * Both halves of the permissiveness are asserted as well, because both exist
 * for a reason that is easy to "tidy up" later: a missing `kind` must not
 * lock, and a missing `status` must still count as issued. Frontends and the
 * API deploy independently, so in the window between them an older payload
 * has to degrade to "offer the button and let the server refuse", never to
 * "freeze every order that carries any document".
 *
 *   npm run test:invoice-lock --workspace=packages/shared
 */
import assert from 'assert';
import { issuedInvoiceOf, lockingInvoiceOf, isInvoiceLocked } from '../src/invoiceLock';
import type { IssuedInvoiceRef } from '../src/invoiceLock';

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

const doc = (over: Partial<IssuedInvoiceRef> = {}): IssuedInvoiceRef => ({
  id: 'i1',
  invoice_number: 'FAC-2026-000001',
  issue_date: '2026-10-10T00:00:00.000Z',
  ...over,
});

test('no documents is not locked', () => {
  assert.equal(issuedInvoiceOf({ invoices: [] }), null);
  assert.equal(lockingInvoiceOf({ invoices: [] }), null);
  assert.equal(isInvoiceLocked({ invoices: [] }), false);
});

test('a missing `invoices` is not locked', () => {
  // The deploy-skew case: an API that does not send the field at all.
  assert.equal(lockingInvoiceOf({}), null);
  assert.equal(lockingInvoiceOf(null), null);
  assert.equal(lockingInvoiceOf(undefined), null);
});

test('an issued factura locks', () => {
  const rows = [doc({ kind: 'invoice' })];
  assert.equal(lockingInvoiceOf({ invoices: rows })?.id, 'i1');
  assert.equal(isInvoiceLocked({ invoices: rows }), true);
});

test('an issued albarán does NOT lock', () => {
  // It is a quote. Revising a quote is what a quote is for, so the order
  // behind one stays editable and the albarán is reissued instead.
  const rows = [doc({ kind: 'albaran' })];
  assert.equal(issuedInvoiceOf({ invoices: rows })?.id, 'i1');
  assert.equal(lockingInvoiceOf({ invoices: rows }), null);
});

test('a document with no `kind` does not lock', () => {
  // An API older than the field. Locking here would freeze every order
  // carrying any document until the API caught up.
  assert.equal(lockingInvoiceOf({ invoices: [doc()] }), null);
});

test('a DRAFT factura does not lock — the bug this file exists for', () => {
  const rows = [doc({ id: 'draft', kind: 'invoice', status: 'draft', invoice_number: null })];
  assert.equal(issuedInvoiceOf({ invoices: rows }), null, 'a draft is not an issued document');
  assert.equal(lockingInvoiceOf({ invoices: rows }), null);
  assert.equal(isInvoiceLocked({ invoices: rows }), false);
});

test('a draft in front of an issued one is skipped, not taken', () => {
  // The exact shape the rep's payload produces: newest first, and the newest
  // is the draft somebody started this morning.
  const rows = [
    doc({ id: 'draft', kind: 'invoice', status: 'draft', invoice_number: null }),
    doc({ id: 'real', kind: 'invoice', status: 'issued' }),
  ];
  assert.equal(issuedInvoiceOf({ invoices: rows })?.id, 'real');
  assert.equal(lockingInvoiceOf({ invoices: rows })?.id, 'real');
});

test('a document with no `status` still counts as issued', () => {
  // Every admin projection pre-filters to issued and does not select the
  // column, so absent has to mean issued or admin stops locking anything.
  const rows = [doc({ kind: 'invoice' })];
  assert.equal(issuedInvoiceOf({ invoices: rows })?.id, 'i1');
  assert.equal(isInvoiceLocked({ invoices: rows }), true);
});

test('an issued albarán beside a draft factura leaves the order editable', () => {
  // A rep's ordinary day: they issued the albarán, the office has started the
  // factura and not finished it. Editing has to stay open until it is issued.
  const rows = [
    doc({ id: 'fac', kind: 'invoice', status: 'draft', invoice_number: null }),
    doc({ id: 'alb', kind: 'albaran', status: 'issued' }),
  ];
  assert.equal(issuedInvoiceOf({ invoices: rows })?.id, 'alb');
  assert.equal(lockingInvoiceOf({ invoices: rows }), null);
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
