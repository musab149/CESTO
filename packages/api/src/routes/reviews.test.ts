// ─── Unit tests · product reviews ───────────────────────────
//
// Run:  cd packages/api && npm run test:reviews
// or:   npx ts-node src/routes/reviews.test.ts
//
// Zero-dep, same shape as the other test files here: node:assert, a `test()`
// collector, and a runner that exits non-zero on failure.
//
// SCOPE — what is and is not here:
//   Covered: the rating aggregate (which must never disagree with what is
//   visible) and the write schema. `recomputeProductRating` takes its
//   transaction client as a parameter, so a stub exercises it without a
//   database.
//   Not covered: the verified-purchase gate and the moderation routes. Both
//   read the module-level prisma client and would need a real database or an
//   injection seam that does not exist yet. They are listed as manual cases at
//   the bottom of this file so the gap is visible rather than assumed.

import assert from 'node:assert/strict';
import { recomputeProductRating, withFirstNameOnly, writeReviewSchema } from './reviews';

type Case = { name: string; run: () => Promise<void> | void };
const cases: Case[] = [];
function test(name: string, run: () => Promise<void> | void): void { cases.push({ name, run }); }

/**
 * Minimal stand-in for Prisma.TransactionClient — just the two calls
 * recomputeProductRating makes. Records what it was asked to write so the
 * assertions can check both the value and that it targeted the right row.
 */
function stubTx(rows: { rating: number }[]) {
  const calls: { where: unknown; data: { rating: number | null; rating_count: number } }[] = [];
  let aggregateWhere: unknown = null;

  const tx = {
    productReview: {
      aggregate: async ({ where }: { where: unknown }) => {
        aggregateWhere = where;
        const count = rows.length;
        const avg = count > 0 ? rows.reduce((a, r) => a + r.rating, 0) / count : null;
        return { _avg: { rating: avg }, _count: { _all: count } };
      },
    },
    product: {
      update: async (args: { where: unknown; data: { rating: number | null; rating_count: number } }) => {
        calls.push(args);
        return {};
      },
    },
  };

  return {
    tx: tx as never,
    calls,
    get aggregateWhere() { return aggregateWhere; },
  };
}

// ─── recomputeProductRating ─────────────────────────────────

test('averages visible reviews and rounds to one decimal', async () => {
  // 5,4,4 → 4.333… must store 4.3, not 4.333333333333333. Full float
  // precision here leaks into every product payload.
  const s = stubTx([{ rating: 5 }, { rating: 4 }, { rating: 4 }]);
  await recomputeProductRating(s.tx, 'prod-1');
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].data.rating, 4.3);
  assert.equal(s.calls[0].data.rating_count, 3);
});

test('rounds half-up consistently', async () => {
  // 5,4 → 4.5 exactly; 5,5,4 → 4.666… → 4.7
  const half = stubTx([{ rating: 5 }, { rating: 4 }]);
  await recomputeProductRating(half.tx, 'p');
  assert.equal(half.calls[0].data.rating, 4.5);

  const up = stubTx([{ rating: 5 }, { rating: 5 }, { rating: 4 }]);
  await recomputeProductRating(up.tx, 'p');
  assert.equal(up.calls[0].data.rating, 4.7);
});

test('no visible reviews clears the rating instead of keeping a stale one', async () => {
  // A product whose only review was hidden must read as "no reviews yet",
  // not keep quoting whatever that review said.
  const s = stubTx([]);
  await recomputeProductRating(s.tx, 'prod-2');
  assert.equal(s.calls[0].data.rating, null);
  assert.equal(s.calls[0].data.rating_count, 0);
});

test('a single review is its own average', async () => {
  const s = stubTx([{ rating: 3 }]);
  await recomputeProductRating(s.tx, 'p');
  assert.equal(s.calls[0].data.rating, 3);
  assert.equal(s.calls[0].data.rating_count, 1);
});

test('hidden reviews are excluded from the aggregate', async () => {
  // The exclusion lives in the where clause, so assert on the query itself —
  // if this regresses, a moderated review keeps inflating the public rating.
  const s = stubTx([{ rating: 5 }]);
  await recomputeProductRating(s.tx, 'prod-3');
  assert.deepEqual(s.aggregateWhere, { product_id: 'prod-3', is_hidden: false });
});

test('writes to the product it was asked about', async () => {
  const s = stubTx([{ rating: 2 }]);
  await recomputeProductRating(s.tx, 'prod-42');
  assert.deepEqual(s.calls[0].where, { id: 'prod-42' });
});

test('an all-one-star product is not mistaken for having no reviews', async () => {
  // Guards the `count > 0 && avg != null` condition: rating 1 is falsy-adjacent
  // territory if anyone rewrites that check as a truthiness test.
  const s = stubTx([{ rating: 1 }, { rating: 1 }]);
  await recomputeProductRating(s.tx, 'p');
  assert.equal(s.calls[0].data.rating, 1);
  assert.equal(s.calls[0].data.rating_count, 2);
});

// ─── withFirstNameOnly ─────────────────────────────────
//
// Privacy policy §2.4 and terms §10 both tell customers that only a first name
// appears beside a public review. These assert the API keeps that promise.

const review = (name: string) => ({ id: 'r1', rating: 5, user: { id: 'u1', name } });

test('a full name is reduced to the first name', () => {
  assert.equal(withFirstNameOnly(review('María López Ruiz')).user.name, 'María');
});

test('a single-word name is unchanged', () => {
  assert.equal(withFirstNameOnly(review('María')).user.name, 'María');
});

test('stray whitespace does not produce an empty name', () => {
  assert.equal(withFirstNameOnly(review('  Ana  Torres ')).user.name, 'Ana');
  assert.equal(withFirstNameOnly(review('   ')).user.name, '   ');
});

test('an erased account keeps its marker rather than becoming "Deleted"', () => {
  assert.equal(withFirstNameOnly(review('Deleted user')).user.name, 'Deleted user');
});

test('nothing else on the review is altered', () => {
  const out = withFirstNameOnly(review('Juan Perez'));
  assert.equal(out.id, 'r1');
  assert.equal(out.rating, 5);
  assert.equal(out.user.id, 'u1');
});

// ─── writeReviewSchema ──────────────────────────────────────

test('accepts a well-formed review', () => {
  const r = writeReviewSchema.safeParse({
    rating: 5, title: 'Great', body: 'Genuinely good, would buy again.',
  });
  assert.equal(r.success, true);
});

test('title is optional and may be null', () => {
  assert.equal(writeReviewSchema.safeParse({ rating: 4, body: 'Ten chars ok' }).success, true);
  assert.equal(writeReviewSchema.safeParse({ rating: 4, title: null, body: 'Ten chars ok' }).success, true);
});

test('rating must be a whole 1-5', () => {
  for (const rating of [0, 6, -1, 2.5]) {
    assert.equal(
      writeReviewSchema.safeParse({ rating, body: 'Long enough body' }).success,
      false,
      `rating ${rating} should be rejected`,
    );
  }
  for (const rating of [1, 2, 3, 4, 5]) {
    assert.equal(
      writeReviewSchema.safeParse({ rating, body: 'Long enough body' }).success,
      true,
      `rating ${rating} should be accepted`,
    );
  }
});

test('body has a floor, so one-word reviews cannot pad the aggregate', () => {
  assert.equal(writeReviewSchema.safeParse({ rating: 5, body: 'good' }).success, false);
  assert.equal(writeReviewSchema.safeParse({ rating: 5, body: '   ' }).success, false);
  assert.equal(writeReviewSchema.safeParse({ rating: 5, body: 'exactly10!' }).success, true);
});

test('body and title have ceilings', () => {
  assert.equal(writeReviewSchema.safeParse({ rating: 5, body: 'x'.repeat(4001) }).success, false);
  assert.equal(writeReviewSchema.safeParse({ rating: 5, body: 'x'.repeat(4000) }).success, true);
  assert.equal(
    writeReviewSchema.safeParse({ rating: 5, title: 'x'.repeat(121), body: 'Long enough body' }).success,
    false,
  );
});

test('whitespace is trimmed before the length checks', () => {
  const r = writeReviewSchema.safeParse({ rating: 5, title: '  Nice  ', body: '  Long enough body  ' });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.title, 'Nice');
    assert.equal(r.data.body, 'Long enough body');
  }
});

// ─── Runner ─────────────────────────────────────────────────

(async () => {
  let failures = 0;
  for (const { name, run } of cases) {
    try {
      await run();
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

/*
 ─── Not covered here · needs a database ───────────────────────
 These are the cases a reviewer should run by hand (or that justify a real
 integration harness later). Listed so the gap is explicit:

 Verified-purchase gate — POST /api/products/:id/reviews
   1. No session                        → 401
   2. Session, never ordered it         → 403
   3. Ordered but status = pending      → 403
   4. Ordered but status = cancelled    → 403
   5. Ordered but status = draft        → 403 (never reserved, never arrived)
   6. Delivered order containing it     → 201, review appears in the list
   7. Delivered SUB-order containing it → 201 (sub status is its own)
   8. Delivered but soft-deleted order  → 403 (deleted_at is not null)
   9. Second POST by the same user      → 200-ish upsert, still ONE row
  10. Second POST after admin hid it    → updates the row, stays hidden
  11. Inactive product                  → 404

 Aggregate consistency
  12. Post a review        → products.rating and rating_count both move
  13. Admin hides it       → rating returns to null, count to 0
  14. Admin unhides it     → rating comes back
  15. Author deletes it    → rating returns to null
  16. Product with an admin-typed legacy rating and no reviews → keeps it
      until the first real review lands, then the computed value takes over

 Moderation — /api/admin/reviews
  17. Non-admin token      → 401/403
  18. hide sets reason, hidden_at and hidden_by_admin_id
  19. Hidden row is absent from the public list but present as `mine`
  20. Hard delete removes the row and recomputes

 Clients
  21. Product page with zero reviews shows the empty state, not a 0.0 rating
  22. A guest sees the list but no write affordance
  23. A signed-in customer who cannot review sees no form
*/
