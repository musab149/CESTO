/**
 * Which orders staff and reps may still change — the rule the admin and rep
 * order pages and edit screens all ask before offering "Edit order".
 *
 * Drafts became editable on 2026-11-04: staff and reps change the ones our
 * team built — staff, a rep, or Home Grocery — and a customer the ones they
 * made themselves, never one our team built for them.
 *
 *   npm run test:order-editing --workspace=packages/shared
 */
import assert from 'assert';
import { staffCanEditOrder, isEditableDraft, customerCanEditOrder, type StaffEditSubject } from '../src/orderEditing';

const STAFF = 'a1';
const REP = 'u1';
const PLAN = 'p1';

const table: Array<[string, StaffEditSubject, boolean]> = [
  ['pending, placed by the customer', { status: 'pending' }, true],
  ['confirmed', { status: 'confirmed' }, true],
  ['preparing', { status: 'preparing' }, true],
  ['on the way', { status: 'on_the_way', created_by_admin_id: STAFF }, false],
  ['delivered', { status: 'delivered', created_by_sales_rep_id: REP }, false],
  ['cancelled', { status: 'cancelled', created_by_sales_rep_id: REP }, false],
  ['draft a rep built', { status: 'draft', created_by_sales_rep_id: REP }, true],
  ['draft staff built', { status: 'draft', created_by_admin_id: STAFF }, true],
  ['draft from a customer checkout', { status: 'draft' }, false],
  ['draft from a customer checkout, nulls', { status: 'draft', created_by_admin_id: null, created_by_sales_rep_id: null }, false],
  ['Home Grocery draft (old plan made it)', { status: 'draft', rashan_subscription_id: PLAN }, true],
  ['Home Grocery draft a rep saved', { status: 'draft', created_by_sales_rep_id: REP, rashan_subscription_id: PLAN }, true],
  ['Home Grocery draft staff saved', { status: 'draft', created_by_admin_id: STAFF, rashan_subscription_id: PLAN }, true],
  ['Home Grocery order delivered', { status: 'delivered', rashan_subscription_id: PLAN }, false],
];

let failed = 0;
for (const [name, order, expected] of table) {
  try {
    assert.equal(staffCanEditOrder(order), expected);
    console.log(`  PASS  ${name} → ${expected ? 'editable' : 'not editable'}`);
  } catch {
    failed++;
    console.log(`  FAIL  ${name}: expected ${expected ? 'editable' : 'not editable'}`);
  }
}

// Only a draft is ever "an editable draft" — a placed order is editable for another reason.
for (const status of ['pending', 'confirmed', 'preparing']) {
  try {
    assert.equal(isEditableDraft({ status, created_by_admin_id: STAFF }), false);
    console.log(`  PASS  ${status} is not a draft`);
  } catch {
    failed++;
    console.log(`  FAIL  ${status} counted as a draft`);
  }
}

// The customer's half: their own drafts, never one our team built.
const customerTable: Array<[string, StaffEditSubject, boolean]> = [
  ['pending', { status: 'pending' }, true],
  ['on the way', { status: 'on_the_way' }, false],
  ['their own checkout draft', { status: 'draft' }, true],
  ['their old plan draft', { status: 'draft', rashan_subscription_id: PLAN }, true],
  ['a draft a rep built for them', { status: 'draft', created_by_sales_rep_id: REP }, false],
  ['a draft staff built for them', { status: 'draft', created_by_admin_id: STAFF }, false],
  ['a Home Grocery draft staff saved', { status: 'draft', created_by_admin_id: STAFF, rashan_subscription_id: PLAN }, false],
];
for (const [name, order, expected] of customerTable) {
  try {
    assert.equal(customerCanEditOrder(order), expected);
    console.log(`  PASS  customer: ${name} → ${expected ? 'editable' : 'not editable'}`);
  } catch {
    failed++;
    console.log(`  FAIL  customer: ${name}: expected ${expected ? 'editable' : 'not editable'}`);
  }
}

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
