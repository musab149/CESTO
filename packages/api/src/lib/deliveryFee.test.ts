// ─── Unit test · delivery fee, who may change it and what it does ──
//
// Run:  cd packages/api && npx ts-node src/lib/deliveryFee.test.ts
//
// Pure — no database, no fixtures. The point of deliveryFee.ts is that the
// admin and partner routes can never drift on WHEN a fee may change, so
// this pins the decision itself: every status, an issued invoice, a draft
// invoice, a split purchase, and the precedence between them.
//
// The routes' own wording is deliberately NOT asserted here. Each says the
// same refusal in its own voice — a partner asks us for a credit note, an
// admin issues one — and pinning the strings would make a copy edit look
// like a regression.

// Side-effect import for the `Express.Request.user` global augmentation.
// deliveryFee.ts pulls in editOrder.ts for EDITABLE_STATUSES, which reaches
// pricing.ts, which reads req.user. The other suites import '../server' for
// this; just the middleware is enough and keeps the test from booting a
// mailer and a push dispatcher to check some arithmetic.
import '../middleware/auth';
import { Prisma, OrderStatus } from '@prisma/client';
import { deliveryFeeBlocker, applyDeliveryFee } from './deliveryFee';

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

const OPEN = { parent_order_id: null, invoices: [] };

console.log('\n1. The status window');
{
  for (const status of ['pending', 'confirmed', 'preparing'] as OrderStatus[]) {
    check(`${status} allows a fee change`, deliveryFeeBlocker({ ...OPEN, status }) === null);
  }
  for (const status of ['on_the_way', 'delivered', 'cancelled', 'draft', 'partially_completed'] as OrderStatus[]) {
    const b = deliveryFeeBlocker({ ...OPEN, status });
    check(`${status} blocks it`, b?.kind === 'not_editable', b);
    if (b?.kind === 'not_editable') {
      check(`  ...and reports which status`, b.status === status, b.status);
    }
  }
}

console.log('\n2. Invoices');
{
  const issued = deliveryFeeBlocker({
    status: 'confirmed', parent_order_id: null,
    invoices: [{ invoice_number: 'FA/2026/0042' }],
  });
  check('an issued invoice blocks it', issued?.kind === 'invoiced', issued);
  if (issued?.kind === 'invoiced') {
    check('  ...and names the invoice', issued.invoiceNumber === 'FA/2026/0042', issued.invoiceNumber);
  }

  // The caller's query filters to issued, so an empty array IS "no issued
  // invoice" — a draft invoice never reaches here and must not block, because
  // it re-reads its order on load and follows the change.
  check(
    'a draft invoice does not block it (absent from the filtered set)',
    deliveryFeeBlocker({ status: 'confirmed', parent_order_id: null, invoices: [] }) === null,
  );

  // An issued invoice with a null number should still block. The DB CHECK
  // makes that unreachable, but a guard that depends on the number being
  // present would be one schema change away from silently passing.
  const noNumber = deliveryFeeBlocker({
    status: 'confirmed', parent_order_id: null,
    invoices: [{ invoice_number: null }],
  });
  check('an issued invoice with no number still blocks', noNumber?.kind === 'invoiced', noNumber);
  if (noNumber?.kind === 'invoiced') {
    check('  ...reported as an empty string, not "null"', noNumber.invoiceNumber === '', noNumber.invoiceNumber);
  }
}

console.log('\n3. Split purchases');
{
  const b = deliveryFeeBlocker({
    status: 'preparing', parent_order_id: 'a5f1e0c4-0000-4000-8000-000000000001', invoices: [],
  });
  check('one part of a split purchase blocks it', b?.kind === 'split', b);
}

console.log('\n4. Precedence');
{
  // All three true at once. Status wins: "this was already delivered" is the
  // more fundamental objection and the one a person is most likely to
  // recognise, so it should be what they are told.
  const all = deliveryFeeBlocker({
    status: 'delivered',
    parent_order_id: 'a5f1e0c4-0000-4000-8000-000000000002',
    invoices: [{ invoice_number: 'FA/2026/0043' }],
  });
  check('status is reported ahead of invoice and split', all?.kind === 'not_editable', all);

  // Invoice ahead of split: the legally load-bearing one beats the confusing
  // one when both apply.
  const two = deliveryFeeBlocker({
    status: 'confirmed',
    parent_order_id: 'a5f1e0c4-0000-4000-8000-000000000003',
    invoices: [{ invoice_number: 'FA/2026/0044' }],
  });
  check('invoice is reported ahead of split', two?.kind === 'invoiced', two);
}

console.log('\n5. What applying a fee actually does');
{
  const subtotal = new Prisma.Decimal('23.45');

  const r = applyDeliveryFee(subtotal, 4.55);
  check('total = subtotal + fee', r.total.equals(new Prisma.Decimal('28.00')), r.total.toString());
  check('fee is carried exactly', r.delivery_fee.equals(new Prisma.Decimal('4.55')), r.delivery_fee.toString());

  // A free delivery is a real value, not an absence — it must still rewrite
  // the total rather than leaving whatever was there before.
  const zero = applyDeliveryFee(subtotal, 0);
  check('a zero fee still recomputes the total', zero.total.equals(subtotal), zero.total.toString());

  // Decimal in, Decimal out — the partner route compares the previous fee
  // against this to decide whether to notify, so it must not be coerced
  // through a float on the way.
  const asDecimal = applyDeliveryFee(subtotal, new Prisma.Decimal('0.10'));
  check(
    'accepts a Decimal without going through a float',
    asDecimal.total.equals(new Prisma.Decimal('23.55')),
    asDecimal.total.toString(),
  );

  // The classic binary-float trap: 0.1 + 0.2 !== 0.3. Decimal must hold.
  const trap = applyDeliveryFee(new Prisma.Decimal('0.20'), 0.1);
  check('0.20 + 0.10 === 0.30 exactly', trap.total.equals(new Prisma.Decimal('0.30')), trap.total.toString());

  // Both columns are Decimal(10,2). A fee carrying more precision than that
  // must be quantised BEFORE the total is derived from it, or Postgres
  // rounds the two independently and they can land a cent apart.
  const third = applyDeliveryFee(new Prisma.Decimal('10.00'), 3.333);
  check('excess precision is quantised to cents', third.delivery_fee.equals(new Prisma.Decimal('3.33')), third.delivery_fee.toString());
  check('  ...and the total follows the quantised fee', third.total.equals(new Prisma.Decimal('13.33')), third.total.toString());

  // The case that would actually have split them: .335 rounds UP on the fee
  // but the unrounded total 13.335 rounds DOWN to 13.33 under Postgres's
  // half-up-on-the-stored-scale. Quantising first makes them agree.
  const halfCent = applyDeliveryFee(new Prisma.Decimal('10.00'), 3.335);
  check('a half-cent fee rounds up', halfCent.delivery_fee.equals(new Prisma.Decimal('3.34')), halfCent.delivery_fee.toString());
  check(
    '  ...and fee + subtotal still equals the stored total exactly',
    halfCent.total.equals(new Prisma.Decimal('10.00').plus(halfCent.delivery_fee)),
    { fee: halfCent.delivery_fee.toString(), total: halfCent.total.toString() },
  );

  check('the subtotal itself is never mutated', subtotal.equals(new Prisma.Decimal('23.45')), subtotal.toString());
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
