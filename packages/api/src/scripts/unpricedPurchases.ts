/**
 * READ ONLY · which purchases lost their delivery fee, and which never had one
 *
 *   cd packages/api
 *   npx ts-node src/scripts/unpricedPurchases.ts staging
 *   npx ts-node src/scripts/unpricedPurchases.ts production
 *
 * Until `b97fcf3`, editing any part of a split purchase recomputed the
 * purchase's `delivery_fee_total` by summing its parts' fees. Every part
 * carries zero by design, so the sum wrote 0 over the figure the office had
 * typed, and the purchase's `total` was rewritten to match. Nothing in the row
 * remembers what the fee was.
 *
 * So this cannot simply list "purchases that lost a fee". It lists every
 * purchase sitting at zero and says what is known about each:
 *
 *   WAS PRICED, FEE RECOVERABLE  an issued albarán/factura froze the fee
 *                                before the edit, and it is printed here.
 *   EDITED, FEE UNKNOWN          parts carry edit-log rows, so the wipe could
 *                                have happened — or it was never priced. The
 *                                row cannot tell these apart; a human can.
 *   NEVER EDITED                 nothing touched it, so zero is simply "not
 *                                priced yet" and no fee was lost.
 *
 * Writes a Markdown report. Deliberately prints ORDER NUMBERS, not names or
 * emails: the number is what an admin types into the panel to reopen the
 * purchase, and the file then carries no personal data.
 *
 * Takes no locks and writes nothing to the database.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const env = (process.argv[2] ?? '').toLowerCase();
if (env !== 'staging' && env !== 'production') {
  console.error('usage: ts-node src/scripts/unpricedPurchases.ts <staging|production>');
  process.exit(1);
}
const envFile = path.join(process.cwd(), `.env.${env}`);
if (!fs.existsSync(envFile)) {
  console.error(`no ${envFile} — cannot reach ${env}`);
  process.exit(1);
}
dotenv.config({ path: envFile });

// After dotenv, so every one of these reads the environment this run is
// aimed at rather than the local .env that an import at the top would pin.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveDeliveryFee } = require('../lib/delivery-pricing');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDeliveryPricing } = require('../lib/delivery-pricing');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient() as any;

/**
 * EDIT-LOG ROWS ARE THE DIVIDING LINE.
 *
 * The wipe only happened inside editOrder, so a purchase whose parts were
 * never edited cannot have been hit by it however odd its fee looks. Keeping
 * those apart is the difference between a list somebody can act on and a list
 * of everything that happens to be at zero.
 */
type Verdict =
  /** An issued document froze the fee: it is known, exactly. */
  | 'recoverable'
  /** Retail, edited, and the rules would have charged — the likely damage. */
  | 'wiped'
  /** Wholesale and edited: zero is also its starting state, so unknowable. */
  | 'unknown'
  /** Never edited. Zero came from checkout, not from this bug. */
  | 'from_checkout';

interface Row {
  order_number: string;
  created_at: Date;
  parts: number;
  subtotal: number;
  total: number;
  partsTotal: number;
  business: boolean;
  edits: number;
  lastEdit: Date | null;
  editActions: string[];
  verdict: Verdict;
  recoveredFee: number | null;
  invoiceNumber: string | null;
  /**
   * What the delivery rules quote for this purchase NOW.
   *
   * For a RETAIL purchase this is close to evidence rather than a guess: a
   * retail checkout always prices delivery from the flat fee or the band
   * ladder, so a retail purchase sitting at zero was almost certainly wiped,
   * and this is the figure it was wiped from — give or take a settings change
   * since. A wholesale purchase is quoted nothing on purpose (the office types
   * it), so the same number means nothing there and is not shown.
   */
  ruleQuote: number | null;
  quoteMode: string | null;
}

/** The delivery line an issued document froze, if it carried one. */
function feeFromInvoiceLines(lines: unknown): number | null {
  if (!Array.isArray(lines)) return null;
  for (const raw of lines) {
    const l = raw as { description?: string; gross?: string | number; product_id?: unknown };
    const d = String(l?.description ?? '').toLowerCase();
    // invoicing.ts writes exactly one such line, 'Gastos de envío', with a
    // null product_id. Matched loosely so a later rewording still lands.
    if (l?.product_id == null && (d.includes('env') || d.includes('deliver'))) {
      const n = Number(l.gross);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

async function main() {
  // The same rules the checkout priced with. Read once: a settings change
  // since then is exactly the uncertainty this report admits to.
  const pricing = await getDeliveryPricing();

  const purchases = await prisma.parentOrder.findMany({
    where: { delivery_fee_total: 0 },
    select: {
      id: true, order_number: true, created_at: true,
      subtotal: true, delivery_fee_total: true, total: true,
      sub_orders: {
        where: { deleted_at: null },
        select: { id: true, total: true, buyer_is_business: true },
      },
      // For the retail quote below. Coordinates only matter in distance mode.
      address: { select: { latitude: true, longitude: true, postcode: true } },
      invoices: {
        where: { status: 'issued' },
        select: { invoice_number: true, number: true, lines: true, issue_date: true },
        orderBy: [{ issue_date: 'desc' }],
      },
    },
    orderBy: { created_at: 'desc' },
  });

  const rows: Row[] = [];

  for (const p of purchases) {
    const partIds = p.sub_orders.map((o: { id: string }) => o.id);
    if (partIds.length === 0) continue;

    const edits = await prisma.orderEditLog.findMany({
      where: { order_id: { in: partIds } },
      select: { action: true, created_at: true },
      orderBy: { created_at: 'desc' },
    });

    let recoveredFee: number | null = null;
    let invoiceNumber: string | null = null;
    for (const inv of p.invoices) {
      const fee = feeFromInvoiceLines(inv.lines);
      if (fee != null) {
        recoveredFee = fee;
        invoiceNumber = inv.invoice_number ?? (inv.number != null ? String(inv.number) : null);
        break;
      }
    }

    // What the rules say today, for a retail purchase only.
    const business = p.sub_orders.some((o: { buyer_is_business: boolean }) => o.buyer_is_business);
    let ruleQuote: number | null = null;
    let quoteMode: string | null = null;
    if (!business) {
      const destination = pricing.mode === 'distance'
        ? (p.address?.latitude != null && p.address?.longitude != null
          ? { lat: Number(p.address.latitude), lng: Number(p.address.longitude) }
          : null)
        : null;
      const quote = resolveDeliveryFee({
        subtotal: p.subtotal,
        pricing,
        destination,
        buyerIsBusiness: false,
      });
      ruleQuote = Number(quote.fee);
      quoteMode = quote.bandLabel ? `${quote.mode} · ${quote.bandLabel}` : quote.mode;
    }

    const verdict: Verdict = edits.length === 0
      ? 'from_checkout'
      : recoveredFee != null
        ? 'recoverable'
        : (!business && (ruleQuote ?? 0) > 0) ? 'wiped' : 'unknown';

    rows.push({
      order_number: p.order_number,
      created_at: p.created_at,
      parts: p.sub_orders.length,
      subtotal: Number(p.subtotal),
      total: Number(p.total),
      partsTotal: p.sub_orders.reduce((s: number, o: { total: unknown }) => s + Number(o.total), 0),
      business,
      edits: edits.length,
      lastEdit: edits[0]?.created_at ?? null,
      editActions: [...new Set(edits.map((e: { action: string }) => e.action))] as string[],
      verdict,
      recoveredFee,
      invoiceNumber,
      ruleQuote,
      quoteMode,
    });
  }

  // Also worth knowing: how many purchases ARE priced, as the denominator for
  // "is this widespread or three rows".
  const pricedCount = await prisma.parentOrder.count({
    where: { delivery_fee_total: { gt: 0 } },
  });
  const totalCount = await prisma.parentOrder.count();

  const eur = (n: number) => `${n.toFixed(2)} €`;
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—');

  const recoverable = rows.filter((r) => r.verdict === 'recoverable');
  const wiped = rows.filter((r) => r.verdict === 'wiped');
  const unknown = rows.filter((r) => r.verdict === 'unknown');
  const fromCheckout = rows.filter((r) => r.verdict === 'from_checkout');

  const out: string[] = [];
  out.push(`# Purchases sitting at a zero delivery fee — ${env}`);
  out.push('');
  out.push(`Read ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, read-only.`);
  out.push('');
  out.push(`${totalCount} split purchases in total; ${pricedCount} carry a fee, ${rows.length} are at zero.`);
  out.push('');
  out.push(`Delivery rules as read: **${pricing.mode}**, flat fee ${eur(Number(pricing.fee))}.`);
  out.push('');
  out.push('Until `b97fcf3`, editing ANY part of a purchase recomputed its');
  out.push('`delivery_fee_total` by summing the parts — which are all zero by design —');
  out.push('and rewrote the purchase `total` to match. The figure the office had typed');
  out.push('is not stored anywhere else, so this report reasons from what is: an');
  out.push('issued document that froze the fee, whether any part was ever EDITED (the');
  out.push('wipe only happened inside editOrder, so a purchase with no edits cannot');
  out.push('have been hit), and whether the delivery rules would have charged at all.');
  out.push('');
  out.push('Order numbers only: the number is what you type into the panel to reopen');
  out.push('the purchase, so this file carries no customer data.');
  out.push('');

  out.push('## 1. Priced, and the fee is recoverable');
  out.push('');
  out.push('An issued albarán or factura froze the delivery line before the edit, so');
  out.push('this IS what the purchase was priced at. Re-enter it and the document and');
  out.push('the order agree again.');
  out.push('');
  if (recoverable.length === 0) {
    out.push('_None._');
  } else {
    out.push('| Purchase | Issued doc | Fee to restore | Parts | Goods | Stored total |');
    out.push('| --- | --- | --- | --- | --- | --- |');
    for (const r of recoverable) {
      out.push(`| \`${r.order_number}\` | ${r.invoiceNumber ?? '—'} | **${eur(r.recoveredFee!)}** | ${r.parts} | ${eur(r.subtotal)} | ${eur(r.total)} |`);
    }
  }
  out.push('');

  out.push('## 2. START HERE — retail, edited, and the rules would have charged');
  out.push('');
  out.push('Each of these was EDITED, which is the only way the wipe happened, and each');
  out.push('is retail — and a retail checkout always prices delivery, from the flat fee');
  out.push('or the band ladder. So zero is not where these started. The figure below is');
  out.push('what the same rules quote for the purchase now, which is what it was charged');
  out.push('unless the settings have changed since.');
  out.push('');
  if (wiped.length === 0) {
    out.push('_None._');
  } else {
    out.push('| Purchase | Created | Rules quote now | How | Parts | Goods | Edits | Last edit |');
    out.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of wiped) {
      out.push(`| \`${r.order_number}\` | ${day(r.created_at)} | **${eur(r.ruleQuote!)}** | ${r.quoteMode ?? '—'} | ${r.parts} | ${eur(r.subtotal)} | ${r.edits} | ${day(r.lastEdit)} |`);
    }
  }
  out.push('');

  out.push('## 3. Wholesale, edited — the fee may have been wiped, needs a human');
  out.push('');
  out.push('A wholesale drop is quoted nothing at checkout on purpose — the office');
  out.push('types the fee afterwards — so zero is the state it STARTS in. These parts');
  out.push('carry edit-log rows, which is what the wipe rode in on, so each of these');
  out.push('was either priced and then flattened or never priced at all. The row cannot');
  out.push('tell the two apart; whoever quoted it can.');
  out.push('');
  if (unknown.length === 0) {
    out.push('_None._');
  } else {
    out.push('| Purchase | Created | Parts | Goods | Stored total | Edits | Last edit | What was edited | b2b |');
    out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of unknown) {
      out.push(`| \`${r.order_number}\` | ${day(r.created_at)} | ${r.parts} | ${eur(r.subtotal)} | ${eur(r.total)} | ${r.edits} | ${day(r.lastEdit)} | ${r.editActions.join(', ')} | ${r.business ? 'yes' : 'no'} |`);
    }
  }
  out.push('');

  out.push('## 4. NOT this bug — never edited, so zero came from checkout');
  out.push('');
  out.push('No part of these was ever edited, so editOrder never ran on them and');
  out.push('nothing was wiped. Wholesale ones are simply waiting to be priced, which is');
  out.push('what the customer was told. A RETAIL one at zero is still worth a look —');
  out.push('checkout stored that zero itself, and the free-delivery threshold that used');
  out.push('to exist is the likeliest reason — but it is a separate question from this');
  out.push('fix and re-pricing it would be changing a price the customer already saw.');
  out.push('');
  if (fromCheckout.length === 0) {
    out.push('_None._');
  } else {
    out.push('| Purchase | Created | Parts | Goods | b2b | Rules quote now |');
    out.push('| --- | --- | --- | --- | --- | --- |');
    for (const r of fromCheckout) {
      out.push(`| \`${r.order_number}\` | ${day(r.created_at)} | ${r.parts} | ${eur(r.subtotal)} | ${r.business ? 'yes' : 'no'} | ${r.ruleQuote != null ? eur(r.ruleQuote) : 'n/a (wholesale)'} |`);
    }
  }
  out.push('');

  const mismatched = rows.filter((r) => Math.abs(r.total - r.partsTotal) > 0.005);
  out.push('## Consistency check');
  out.push('');
  out.push('With no fee, a purchase total must equal the sum of its parts. A row that');
  out.push('does not is carrying a total from before something changed under it.');
  out.push('');
  if (mismatched.length === 0) {
    out.push('Every row at zero totals exactly its parts.');
  } else {
    out.push('| Purchase | Stored total | Sum of parts | Difference |');
    out.push('| --- | --- | --- | --- |');
    for (const r of mismatched) {
      out.push(`| \`${r.order_number}\` | ${eur(r.total)} | ${eur(r.partsTotal)} | ${eur(r.total - r.partsTotal)} |`);
    }
  }
  out.push('');
  out.push('---');
  out.push('');
  out.push('Re-pricing is `PUT /api/admin/orders/<purchase id>/delivery-fee`, which is');
  out.push('the Edit control on the purchase page. It recomputes the total, and the');
  out.push('customer sees the new figure — which is what they were promised when the');
  out.push('order said the fee would be added later.');
  out.push('');

  const file = path.join(process.cwd(), '..', '..', `docs/FEE_WIPE_${env.toUpperCase()}.md`);
  fs.writeFileSync(file, out.join('\n'), 'utf8');
  console.log(`${rows.length} at zero: ${recoverable.length} known from a document, ${wiped.length} LIKELY WIPED (retail + edited), ${unknown.length} wholesale + edited (unknowable), ${fromCheckout.length} never edited (not this bug)`);
  console.log(`of ${totalCount} purchases; ${pricedCount} carry a fee`);
  console.log(`report: ${path.resolve(file)}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
