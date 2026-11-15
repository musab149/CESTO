import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/stores/authStore';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Download, FileCheck2, AlertTriangle, Info, Trash2, Save, Loader2, Lock,
  Hash, FileWarning, Plus, Eye, EyeOff, Undo2,
} from 'lucide-react';
import {
  useAdminInvoice, useUpdateInvoice, useIssueInvoice, useDeleteInvoice,
  useCreateInvoiceForOrder,
  baseOfPriceCents, priceAtRate, eurosToCents, centsToEuros, computeTaxBreakdown,
  baselineOf, formKey, readSavedForm, writeSavedForm, clearSavedForm, sweepSavedForms,
  recargoCents, recargoBasisPoints, VAT_RATES,
  type Invoice, type InvoiceBlocker, type InvoiceEnvelope, type InvoiceLine,
} from '@grocery-app/shared';
import { downloadFactura, downloadPdfFile } from '@grocery-app/shared/invoice';
import ConfirmModal from '@/components/ConfirmModal';
import BackLink from '@/components/BackLink';
import { TableSkeleton } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { useBlockerMessage } from '@/lib/blockerMessage';
import { TextField, Textarea } from '@/components/form';
import { pdfOfIssuedById } from '@/lib/archivePdf';
import { facturaLabels } from '@/lib/facturaLabels';
import { useGoBack } from '@/lib/useGoBack';

/**
 * One invoice: read it, edit it while it is a draft, issue it once, download
 * it whenever.
 *
 * The screen has to teach a lifecycle the rep has no reason to know, so it
 * says it rather than implying it:
 *
 *   draft   — freely editable, deletable, and NOT numbered. Numbering a draft
 *             would put a hole in the series every time one is abandoned, and
 *             a factura series may not have holes.
 *   issued  — numbered, frozen, undeletable. Corrections go out as a credit
 *             note, not an edit.
 *
 * Blockers are shown on the document, not discovered at the button. Most of
 * them do not stop anything — they decide whether this can be a real factura
 * or has to stay an albarán — so they read as information rather than errors.
 */

function BlockerRow({ b }: { b: InvoiceBlocker }) {
  const blockerText = useBlockerMessage();
  const hard = !b.albaran_ok;
  return (
    <li className={`flex items-start gap-2 text-sm ${hard ? 'text-danger' : 'text-warning'}`}>
      {hard
        ? <AlertTriangle size={15} strokeWidth={2} className="shrink-0 mt-0.5" />
        : <Info size={15} strokeWidth={2} className="shrink-0 mt-0.5" />}
      <span className="text-ink">{blockerText(b)}</span>
    </li>
  );
}

/** A party snapshot as the form holds it — all optional, all strings. */
interface Party {
  name?: string;
  /** The seller's name on a factura; the buyer uses `name`. See PartyFields. */
  legal_name?: string;
  tax_id?: string; address?: string; postcode?: string;
  city?: string; province?: string; country?: string; email?: string; phone?: string;
}

const PARTY_FIELDS: Array<keyof Party> = [
  // `legal_name` is the seller's name on a factura; `name` is the buyer's.
  // Reading both means the editor shows what the document will print,
  // whichever party it is looking at.
  'name', 'legal_name', 'tax_id', 'address', 'postcode', 'city', 'province',
  'country', 'email', 'phone',
];

function toParty(snap: Record<string, unknown> | null | undefined): Party {
  const out: Party = {};
  for (const k of PARTY_FIELDS) {
    const v = snap?.[k];
    if (v != null) out[k] = String(v);
  }
  return out;
}

/** Line fields are kept as typed, so a half-written "1," survives a render. */
interface LineDraft {
  description: string;
  quantity: string;
  /**
   * One unit WITH IVA — the price the customer saw and paid, and the one the
   * document prints. Typed here as it is; when the RATE changes it is worked
   * out again from `unit_base` (shared invoiceLinePrice, 2026-11-04).
   */
  unit_price: string;
  /**
   * The base inside that price, in euros — never typed, never printed. A new
   * rate re-adds IVA to it, as at product creation, so the price and total
   * follow the rate; typing a price reads it out again.
   */
  unit_base: string;
  /** Euros off the line, IVA included — as the order's discounts are. */
  discount: string;
  rate_pct: string;
  product_id: string | null;
  /**
   * The CÓDIGO the line prints (2026-11-04). Comes from the product's sku;
   * typed here for this document only — the product is never changed.
   */
  code: string;
  /** The server's key for the line; a line added here has none until saved. */
  key?: string;
  /** As read: the price with IVA, and the base and rate it was charged at. */
  was?: { unit_price: string; unit_base: string; rate_pct: number };
}

/** Typed euros to cents, tolerating a comma and a half-written "1,". */
const cents = (v: string) => eurosToCents((v || '0').replace(',', '.'));

/** The document's lines as the editor holds them. */
const draftOf = (lines: InvoiceLine[]): LineDraft[] => lines.map((l) => {
  // Read out of the price exactly when an older document has no base stored.
  const base = l.unit_base ?? centsToEuros(baseOfPriceCents(eurosToCents(l.unit_price), l.rate_pct));
  return {
    description: l.description,
    quantity: String(l.quantity),
    unit_price: l.unit_price,
    unit_base: base,
    discount: l.discount ?? '',
    rate_pct: String(l.rate_pct),
    product_id: l.product_id ?? null,
    code: l.code ?? '',
    key: l.key,
    was: { unit_price: l.unit_price, unit_base: base, rate_pct: l.rate_pct },
  };
});

/**
 * Every line of a document in its order — the printed ones with the hidden
 * ones put back where they sat (`at`), as the server does (lib/invoicing
 * allLinesOf).
 */
function allLinesOf(inv: Pick<Invoice, 'lines' | 'hidden_lines'>): InvoiceLine[] {
  const out = [...(inv.lines ?? [])];
  for (const { at, ...line } of [...(inv.hidden_lines ?? [])].sort((a, b) => a.at - b.at)) {
    out.splice(Math.min(Math.max(0, at), out.length), 0, line);
  }
  return out;
}

/** The keys of a document's hidden lines, as saved. */
const hiddenKeysOf = (inv: Pick<Invoice, 'hidden_lines'>): string[] =>
  (inv.hidden_lines ?? []).map((h) => h.key).filter((k): k is string => !!k);

/**
 * The editor's whole form — what is kept in the browser while unsaved, and
 * what the saved document is compared with to know whether anything is.
 */
interface InvoiceForm {
  lines: LineDraft[];
  /** Sorted, so the same set always reads the same. */
  hidden: string[];
  buyer: Party;
  seller: Party;
  notes: string;
  terms: string;
}

/** The form exactly as the saved document fills it. */
const serverForm = (inv: Invoice): InvoiceForm => ({
  lines: draftOf(allLinesOf(inv)),
  hidden: hiddenKeysOf(inv).sort(),
  buyer: toParty(inv.buyer_snapshot),
  seller: toParty(inv.seller_snapshot),
  notes: inv.notes ?? '',
  terms: inv.payment_terms ?? '',
});

/** A kept form worth putting back: every part present, in the shape this screen writes. */
const isInvoiceForm = (v: unknown): v is InvoiceForm => {
  const f = v as InvoiceForm | null;
  return !!f && Array.isArray(f.lines) && f.lines.length > 0
    && f.lines.every((l) => !!l && ['description', 'quantity', 'unit_price', 'unit_base', 'discount', 'rate_pct']
      .every((k) => typeof (l as unknown as Record<string, unknown>)[k] === 'string'))
    && Array.isArray(f.hidden) && f.hidden.every((k) => typeof k === 'string')
    && !!f.buyer && typeof f.buyer === 'object' && !!f.seller && typeof f.seller === 'object'
    && typeof f.notes === 'string' && typeof f.terms === 'string';
};

/** A typed price: kept as typed, its base read out of it at the line's rate. */
const withPrice = (l: LineDraft, typed: string): LineDraft => ({
  ...l,
  unit_price: typed,
  unit_base: centsToEuros(baseOfPriceCents(cents(typed), Number(l.rate_pct) || 0)),
});

/**
 * A new rate: IVA re-added to the same base, so the price follows it — and
 * back at the charged base and rate, the charged price to the cent.
 */
const withRate = (l: LineDraft, typed: string): LineDraft => {
  const rate = Number(typed) || 0;
  const charged = l.was
    ? { priceCents: cents(l.was.unit_price), baseCents: cents(l.was.unit_base), ratePct: l.was.rate_pct }
    : null;
  return { ...l, rate_pct: typed, unit_price: centsToEuros(priceAtRate(cents(l.unit_base), rate, charged)) };
};

/** The Spanish IVA bands, low to high: 0, 4, 10, 21. */
const IVA_BANDS = [...new Set(Object.values(VAT_RATES))].sort((a, b) => a - b);

/** The bands, plus a line's own rate when it is outside them (an old draft). */
const rateChoices = (current: string): number[] => {
  const n = Number(current);
  return current !== '' && Number.isFinite(n) && !IVA_BANDS.includes(n)
    ? [...IVA_BANDS, n].sort((a, b) => a - b)
    : IVA_BANDS;
};

/** The line's total with IVA, in cents, net of its discount. */
const lineGrossCents = (l: LineDraft) =>
  Math.max(0, (Number(l.quantity) || 0) * cents(l.unit_price) - cents(l.discount));

function PartyFields({ party, onChange, nameKey = 'name' }: {
  party: Party;
  onChange: (next: Party) => void;
  /**
   * Which field holds this party's name.
   *
   * A factura prints the seller as `legal_name` (FacturaDocument) and the
   * buyer as `name`. This box wrote `name` for both, so correcting the company
   * name on a document changed a field nothing rendered — and the box came up
   * empty even when the settings had a name in them, because it was reading
   * the wrong key too.
   */
  nameKey?: 'name' | 'legal_name';
}) {
  // Its own useTranslation rather than a `t` prop: i18next's TFunction does
  // not fit a hand-written signature, and narrowing it to the two overloads
  // used here would be a lie about what it is.
  const { t } = useTranslation();
  const set = (k: keyof Party) => (e: { target: { value: string } }) =>
    onChange({ ...party, [k]: e.target.value });
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <div className="sm:col-span-2">
        <TextField
          label={t('invoices.partyName', 'Name')}
          value={party[nameKey] ?? ''}
          onChange={set(nameKey)}
        />
      </div>
      <TextField
        label={t('invoices.partyTaxId', 'CIF / NIF')}
        hint={t('invoices.buyerTaxIdHint', 'Required for a full invoice')}
        value={party.tax_id ?? ''}
        onChange={set('tax_id')}
      />
      <TextField label={t('invoices.partyPhone', 'Phone')} value={party.phone ?? ''} onChange={set('phone')} />
      <div className="sm:col-span-2">
        <TextField label={t('invoices.partyAddress', 'Address')} value={party.address ?? ''} onChange={set('address')} />
      </div>
      <TextField label={t('invoices.partyPostcode', 'Postcode')} value={party.postcode ?? ''} onChange={set('postcode')} />
      <TextField label={t('invoices.partyCity', 'City')} value={party.city ?? ''} onChange={set('city')} />
      <TextField label={t('invoices.partyProvince', 'Province')} value={party.province ?? ''} onChange={set('province')} />
      <TextField label={t('invoices.partyCountry', 'Country')} value={party.country ?? ''} onChange={set('country')} />
      <div className="sm:col-span-2">
        <TextField label={t('invoices.partyEmail', 'Email')} value={party.email ?? ''} onChange={set('email')} />
      </div>
    </div>
  );
}

export default function InvoiceDetailPage() {
  const { t } = useTranslation();
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  // Pops the history entry rather than pushing the order route.
  //
  // Pushing made order → invoice → order, so back from there returned to the
  // invoice and the two pages trapped each other. The fallback only fires on
  // a cold arrival — a pasted link or a refresh — where there is nothing of
  // ours behind to pop.
  const goBack = useGoBack();
  const toast = useToast();

  const { data, isLoading } = useAdminInvoice(invoiceId);
  const updateInvoice = useUpdateInvoice();
  const qc = useQueryClient();
  /**
   * The saved document, straight into what this screen shows — not only
   * after the refetch. Between a save and that refetch the screen still held
   * the old copy, so a second hide pressed in that moment counted as an
   * unsaved change and was then wiped when the refetch landed.
   */
  const adopt = (saved: Invoice) => qc.setQueryData<InvoiceEnvelope>(
    ['admin-invoice', saved.id],
    (old) => (old ? { ...old, invoice: { ...old.invoice, ...saved } } : old),
  );
  const issueInvoice = useIssueInvoice();
  const deleteInvoice = useDeleteInvoice();
  // Converting a draft is the same endpoint as creating one: it is idempotent
  // per order, so asking for the other kind rewrites the open draft.
  const switchDraft = useCreateInvoiceForOrder();

  // Both parties as a whole snapshot rather than a field per useState: the
  // form is nine fields twice, and twenty setters is how one gets forgotten.
  const [buyer, setBuyer] = useState<Party>({});
  const [seller, setSeller] = useState<Party>({});
  /** Every line of the draft, shown and hidden, in the document's order. */
  const [lineDraft, setLineDraft] = useState<LineDraft[]>([]);
  /** The keys of the lines left off the document, as being edited. */
  const [hiddenDraft, setHiddenDraft] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [issueOpen, setIssueOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const invoice = data?.invoice;
  const blockers = data?.blockers ?? [];
  const isDraft = invoice?.status === 'draft';
  /**
   * Two different questions, and conflating them was the bug.
   *
   * `eligibleForFactura` is what the blockers allow. `isFacturaDraft` is what
   * somebody actually asked for. They were the same thing while the kind was
   * derived; now that it is chosen, an albarán drafted deliberately for a
   * fully invoiceable order would otherwise announce itself as "ready to
   * issue as a full invoice" and then issue as an albarán.
   */
  const eligibleForFactura = data?.kind === 'invoice';
  const isFacturaDraft = invoice?.kind === 'invoice';
  const cannotIssue = data?.kind === null;

  /**
   * WHAT STILL STOPS THIS FACTURA, which is not the same as what is imperfect.
   *
   * This was `blockers.length > 0`, so an unreviewed IVA category in the
   * catalogue disabled Issue on a document whose rates the admin had just gone
   * through line by line, and a missing company CIF sent them to Ajustes
   * instead of to the field two sections below. The server now judges a
   * factura on its own fields and returns those separately.
   *
   * `blockers` is still shown in full — an unreviewed rate is worth knowing
   * about — it just no longer decides anything.
   */
  const documentGaps = data?.document_blockers ?? [];
  const structural = blockers.filter((b) => !b.fix_on_document);
  const blockedAsFactura = isFacturaDraft && (structural.length > 0 || documentGaps.length > 0);

  /**
   * Each part of the form is re-filled only when the server's copy of THAT
   * part changes. One effect on `invoice` re-filled all of it on every
   * refetch, so hiding a line — which changes only the lines — would have
   * wiped a CIF typed a moment before and not yet saved.
   */
  const partiesSig = invoice
    ? JSON.stringify([invoice.id, invoice.buyer_snapshot, invoice.seller_snapshot, invoice.notes, invoice.payment_terms])
    : '';
  useEffect(() => {
    if (!invoice) return;
    setBuyer(toParty(invoice.buyer_snapshot));
    setSeller(toParty(invoice.seller_snapshot));
    setNotes(invoice.notes ?? '');
    setTerms(invoice.payment_terms ?? '');
    // The signature is the dependency: the same values in a new object are no change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partiesSig]);
  // Every line — shown and hidden — and which are hidden, re-filled when the
  // server's copy of either changes.
  const linesSig = invoice ? JSON.stringify([invoice.id, invoice.lines, invoice.hidden_lines ?? []]) : '';
  useEffect(() => {
    if (!invoice) return;
    setLineDraft(draftOf(allLinesOf(invoice)));
    setHiddenDraft(hiddenKeysOf(invoice));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesSig]);

  /**
   * UNSAVED CHANGES SURVIVE A RELOAD (2026-11-04, packages/shared
   * savedForm.ts): the whole form — every line shown or hidden, the hidden
   * set, both parties, the note and the terms — kept in this browser per admin
   * and document while it differs from the saved draft, cleared the moment it
   * does not (saved, or discarded). Put back only while the draft is still the
   * one the changes were made against (`baseline`); otherwise dropped, and
   * the admin told.
   *
   * Declared AFTER the effects that fill the form from the server and SAVE
   * BEFORE RESTORE: on the first pass the fill runs, the save sees nothing
   * restored yet and stays out of the way, and the restore's state lands last.
   */
  const adminId = useAdminAuthStore((st) => st.user?.id) ?? '';
  const keptKey = invoice && adminId ? formKey('admin', adminId, `invoice:${invoice.id}`) : null;
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!invoice || !keptKey || restoredFor.current !== keptKey) return;
    if (invoice.status !== 'draft') { clearSavedForm(keptKey); return; }
    const saved = serverForm(invoice);
    const now: InvoiceForm = { lines: lineDraft, hidden: [...hiddenDraft].sort(), buyer, seller, notes, terms };
    if (JSON.stringify(now) === JSON.stringify(saved)) clearSavedForm(keptKey);
    else writeSavedForm<InvoiceForm>(keptKey, now, baselineOf(saved));
  }, [keptKey, lineDraft, hiddenDraft, buyer, seller, notes, terms, invoice]);
  useEffect(() => {
    if (!invoice || !keptKey || restoredFor.current === keptKey) return;
    restoredFor.current = keptKey;
    sweepSavedForms('admin');
    if (invoice.status !== 'draft') return;
    const kept = readSavedForm(keptKey, isInvoiceForm);
    if (!kept) return;
    if (kept.baseline !== baselineOf(serverForm(invoice))) {
      clearSavedForm(keptKey);
      toast.warning(
        t('invoices.restoreStaleTitle', 'Your unsaved changes were not kept'),
        t('invoices.restoreStaleBody', 'This document changed after you left it. Start again from what it holds now.'),
      );
      return;
    }
    // A form kept before lines had a code comes back with an empty one.
    setLineDraft(kept.form.lines.map((l) => ({ ...l, code: l.code ?? '' })));
    setHiddenDraft(kept.form.hidden);
    setBuyer(kept.form.buyer);
    setSeller(kept.form.seller);
    setNotes(kept.form.notes);
    setTerms(kept.form.terms);
    toast.info(
      t('invoices.restoredTitle', 'Your unsaved changes are back'),
      t('invoices.restoredBody', 'From before the page reloaded. Save them, or press Discard changes to drop them.'),
    );
    // Once per document, when it first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keptKey, invoice]);

  if (isLoading) return <TableSkeleton rows={8} cols={3} />;
  if (!invoice) return null;

  const money = (v: string) => `${Number(v).toFixed(2).replace('.', ',')} €`;

  /**
   * A line the order does not have, and a line the document should not.
   *
   * The server has always accepted the lines as a whole list — replaced, not
   * patched, precisely so that adding and deleting are expressible — but the
   * screen could only edit the ones that were already there. An admin billing
   * a pallet charge, or dropping a line a customer is not being charged for,
   * had to go through the order instead and change what the order says.
   *
   * Both detach the draft from its order on save, which is correct: a document
   * with a line of its own is no longer a view of the basket.
   */
  const addLine = () => setLineDraft((prev) => [...prev, {
    description: '', quantity: '1', unit_price: '0.00', unit_base: '0.00', discount: '',
    // The general rate, which is what a service or a charge usually carries.
    // Food lines come from the order already carrying theirs.
    rate_pct: '21',
    product_id: null,
    code: '',
    // Its own key from the start, so it can be hidden before it is saved; the
    // server keeps a key it is given.
    key: `manual:${crypto.randomUUID()}`,
  }]);

  /**
   * HIDING A LINE (user, 2026-11-04: "hide any item from the factura and it
   * should not affect the order"). The order is never touched, and a hidden
   * line leaves the paper and the totals.
   *
   * It works whatever else is going on. With nothing else unsaved it is saved
   * at once, on its own, which does NOT detach the draft from its order. With
   * line edits waiting (a rate changed, a price typed), it joins them and goes
   * with "Save line changes" — it used to be refused then, which looked like
   * a button that did nothing. Issue and Download wait for anything unsaved,
   * so a hide can never be left off the paper by mistake.
   */
  const isHidden = (l: LineDraft) => !!l.key && hiddenDraft.includes(l.key);
  const shownCount = lineDraft.filter((l) => !isHidden(l)).length;

  /** The last shown line cannot go: a document with no lines is not one. */
  const removeLine = (i: number) =>
    setLineDraft((prev) => (shownCount <= 1 ? prev : prev.filter((_, j) => j !== i)));

  /** The lines' own content changed. Sending them detaches the draft from
   *  its order, which should not happen because somebody edited a note — or
   *  only hid a line. */
  const linesChanged = JSON.stringify(lineDraft) !== JSON.stringify(draftOf(allLinesOf(invoice)));
  const hiddenChanged = [...hiddenDraft].sort().join() !== hiddenKeysOf(invoice).sort().join();
  const linesDirty = linesChanged || hiddenChanged;

  const docName = invoice.kind === 'albaran'
    ? t('invoices.docAlbaran', 'the albarán')
    : t('invoices.docFactura', 'the invoice');
  const toggleHidden = (key: string, hide: boolean) => {
    const next = hide ? [...hiddenDraft, key] : hiddenDraft.filter((k) => k !== key);
    setHiddenDraft(next);
    if (linesDirty) return; // goes with "Save line changes"
    updateInvoice.mutate(
      { id: invoice.id, hidden: next },
      {
        onSuccess: (saved) => {
          adopt(saved);
          toast.success(hide
            ? t('invoices.lineHidden', 'Hidden from {{doc}}', { doc: docName })
            : t('invoices.lineShown', 'Back on {{doc}}', { doc: docName }));
        },
        onError: (e) => {
          setHiddenDraft(hiddenKeysOf(invoice));
          toast.error(t('invoices.hideFailed', 'Could not change the lines shown'), e instanceof Error ? e.message : String(e));
        },
      },
    );
  };
  /**
   * The hidden lines as listed under the table: on a draft, as being edited
   * (saved or waiting to be); on an issued document, as it went out.
   */
  const hiddenRows = isDraft
    ? lineDraft.filter(isHidden).map((l) => ({
      key: l.key as string,
      description: l.description,
      quantity: l.quantity,
      unit_price: centsToEuros(cents(l.unit_price)),
      discount: cents(l.discount) > 0 ? centsToEuros(cents(l.discount)) : null,
      gross: centsToEuros(lineGrossCents(l)),
    }))
    : (invoice.hidden_lines ?? []).map((h) => ({
      key: h.key ?? `at-${h.at}`,
      description: h.description,
      quantity: String(h.quantity),
      unit_price: h.unit_price,
      discount: h.discount ?? null,
      gross: h.gross,
    }));
  /** Counts the printed rows as the table renders them (see `diverges`). */
  let shownIdx = -1;
  /** As saved — what an issue would leave off. */
  const hiddenLines = invoice.hidden_lines ?? [];

  /**
   * THE TOTALS AS THEY WILL BE, while lines are being changed (2026-11-04).
   * Change a rate and the IVA breakdown and total move at once, worked out
   * exactly as the server will (same cents, same breakdown); the saved
   * figures come back on Save.
   */
  const previewTotals = (() => {
    if (!isDraft || !linesDirty) return null;
    const shown = lineDraft.filter((l) => !isHidden(l));
    const b = computeTaxBreakdown(shown.map((l) => ({ grossCents: lineGrossCents(l), rate_pct: Number(l.rate_pct) || 0 })));
    // Recargo de equivalencia, when the document charges it — as the server will.
    const re = b.groups.map((g) => (invoice.recargo_equivalencia ? recargoCents(g.base_cents, g.rate_pct) : 0));
    const reTotal = re.reduce((a, x) => a + x, 0);
    return {
      by_rate: b.groups.map((g, i) => ({
        rate_pct: g.rate_pct, base: centsToEuros(g.base_cents), vat: centsToEuros(g.vat_cents), gross: centsToEuros(g.gross_cents),
        ...(invoice.recargo_equivalencia ? { recargo_pct: recargoBasisPoints(g.rate_pct) / 100, recargo: centsToEuros(re[i]) } : {}),
      })),
      discount_total: centsToEuros(shown.reduce((s, l) => s + cents(l.discount), 0)),
      gross: centsToEuros(b.gross_total_cents),
      ...(invoice.recargo_equivalencia ? { recargo: centsToEuros(reTotal) } : {}),
      total: centsToEuros(b.gross_total_cents + reTotal),
    };
  })();
  const shownTotals = previewTotals ?? invoice.totals;

  /**
   * Anything typed and not saved. The PDF and Issue both use the SAVED
   * document, so they wait for it: otherwise the screen would show one total
   * and the paper — or a factura nobody can change — another.
   */
  const unsaved = isDraft && (linesDirty
    || JSON.stringify([buyer, seller, notes, terms]) !== JSON.stringify([
      toParty(invoice.buyer_snapshot), toParty(invoice.seller_snapshot), invoice.notes ?? '', invoice.payment_terms ?? '',
    ]));
  const saveBeforeLeaving = t('invoices.saveBeforeIssue', 'Save your changes first: the PDF and the issued document use the saved version.');

  /** Back to the saved draft: every unsaved change dropped, here and in the browser. */
  const discardChanges = () => {
    if (keptKey) clearSavedForm(keptKey);
    const f = serverForm(invoice);
    setLineDraft(f.lines);
    setHiddenDraft(f.hidden);
    setBuyer(f.buyer);
    setSeller(f.seller);
    setNotes(f.notes);
    setTerms(f.terms);
    toast.success(t('invoices.discarded', 'Changes discarded'));
  };

  /**
   * Redraft this order's document as the other kind.
   *
   * The create endpoint is idempotent per order and rewrites the open draft
   * rather than stacking a second one, so "make this a factura instead" and
   * "create a factura" are the same call. A refused factura comes back 422
   * listing every blocker.
   */
  const switchKind = (kind: 'albaran' | 'invoice') => {
    switchDraft.mutate(
      { orderId: invoice.order_id, kind },
      {
        onError: (err) => toast.error(
          kind === 'invoice'
            ? t('invoices.facturaBlocked', 'This order cannot be invoiced yet')
            : t('invoices.createFailed', 'Could not create the invoice'),
          err instanceof Error ? err.message : String(err),
        ),
      },
    );
  };

  const save = () => {
    updateInvoice.mutate(
      {
        id: invoice.id,
        buyer: { ...buyer, tax_id: buyer.tax_id || null },
        seller: { ...seller, tax_id: seller.tax_id || null },
        notes: notes || null,
        payment_terms: terms || null,
        // Edited lines go as the WHOLE list, hidden ones included, with the
        // hidden set beside it — the server sorts them back apart by key. A
        // hide or show on its own sends only the set, which keeps the draft
        // following its order.
        ...(linesChanged ? {
          lines: lineDraft.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity) || 1,
            // The price WITH IVA, as shown; the server reads the base back out.
            unit_price: centsToEuros(cents(l.unit_price)),
            ...(cents(l.discount) > 0 ? { discount: centsToEuros(cents(l.discount)) } : {}),
            rate_pct: Number(l.rate_pct) || 0,
            product_id: l.product_id,
            code: l.code.trim() || null,
            // So the edit keeps each line's identity — and what is hidden stays hidden.
            ...(l.key ? { key: l.key } : {}),
          })),
          hidden: hiddenDraft,
        } : hiddenChanged ? { hidden: hiddenDraft } : {}),
      },
      {
        onSuccess: (saved) => {
          adopt(saved);
          toast.success(t('invoices.saved', 'Draft saved'));
        },
        onError: (e) => toast.error(t('invoices.saveFailed', 'Could not save'), String(e)),
      },
    );
  };

  const issue = () => {
    issueInvoice.mutate(invoice.id, {
      onSuccess: (res) => {
        setIssueOpen(false);
        toast.success(
          t('invoices.issued', 'Issued'),
          t('invoices.issuedBody', 'Number {{n}} assigned. It can no longer be changed.', {
            n: res.invoice.invoice_number,
          }),
        );
        // Its exact PDF, for the archive, now rather than whenever it is next
        // opened. Read back first: what prints includes the order's number, which
        // the issue answer does not carry.
        void pdfOfIssuedById(invoice.id).then(({ saved }) => {
          if (!saved) toast.error(t('documents.pdfNotSaved'), t('documents.pdfNotSavedBody'));
        }).catch(() => toast.error(t('documents.pdfNotSaved'), t('documents.pdfNotSavedBody')));
      },
      onError: (e) => toast.error(t('invoices.issueFailed', 'Could not issue'), String(e)),
    });
  };

  const download = async () => {
    try {
      // A draft is drawn as it stands. An issued one is the file kept for it.
      if (isDraft) await downloadFactura({ invoice, labels: facturaLabels() });
      else downloadPdfFile((await pdfOfIssuedById(invoice.id)).file);
    } catch (e) {
      toast.error(t('invoices.downloadFailed', 'Could not build the PDF'), String(e));
    }
  };

  return (
    // Wide enough for the lines table with its CÓDIGO column (2026-11-04);
    // at 3xl the descriptions were cut to a dozen letters.
    <div className="space-y-4 max-w-4xl">
      <BackLink
        label={t('common.backToOrder', 'Back to the order')}
        onClick={() => goBack(`/orders/${invoice.order_id}`)}
        className="mb-3"
      />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold font-display text-ink leading-tight">
              {invoice.kind === 'albaran'
                ? t('invoices.albaran', 'Albarán')
                : t('invoices.factura', 'Invoice')}
            </h1>
            {invoice.invoice_number && (
              <span className="font-mono text-sm text-muted">{invoice.invoice_number}</span>
            )}
            <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${
              isDraft ? 'bg-warning-bg text-warning' : 'bg-success-bg text-success'
            }`}>
              {isDraft ? t('invoices.statusDraft', 'Draft') : t('invoices.statusIssued', 'Issued')}
            </span>
          </div>
          <p className="text-sm text-muted mt-0.5">
            {invoice.order?.order_number && (
              <span className="font-mono">{invoice.order.order_number}</span>
            )}
            {invoice.user?.name && <span> · {invoice.user.name}</span>}
          </p>
        </div>
      </div>

      {/* What this document currently is, and why. */}
      {isDraft && (
        <section className={`rounded-xl border p-4 ${
          cannotIssue || blockedAsFactura ? 'border-danger/30 bg-danger-bg'
            : isFacturaDraft ? 'border-success/30 bg-success-bg' : 'border-warning/30 bg-warning-bg'
        }`}>
          <p className="text-sm font-semibold text-ink mb-1">
            {cannotIssue
              ? t('invoices.cannotIssue', 'This order cannot be invoiced')
              : blockedAsFactura
                ? t('invoices.facturaBlocked', 'This order cannot be invoiced yet')
                : isFacturaDraft
                  ? t('invoices.willBeFactura', 'Ready to issue as a full invoice')
                  : t('invoices.willBeAlbaran', 'This will be issued as an albarán')}
          </p>
          {blockedAsFactura && (
            <p className="text-xs text-gray mb-2 leading-snug">
              {documentGaps.length > 0 && structural.length === 0
                ? t('invoices.fillItHere', 'Fill in what is missing on this document and then issue it — nothing else has to change first.')
                : t('invoices.facturaBlockedWhy', 'Resolve the points below, or switch this draft to an albarán.')}
            </p>
          )}
          {!cannotIssue && !isFacturaDraft && !eligibleForFactura && (
            <p className="text-xs text-gray mb-2 leading-snug">
              {t('invoices.albaranWhy', 'An albarán is not a fiscal document. Resolve the points below to issue a real invoice instead.')}
            </p>
          )}
          {/* The document's own gaps first, since those are the ones holding
              it up, then anything else worth knowing. A gap that is also in
              `blockers` is not repeated. */}
          {(documentGaps.length > 0 || blockers.length > 0) && (
            <ul className="space-y-1.5 mt-2">
              {documentGaps.map((b) => <BlockerRow key={`doc-${b.code}`} b={b} />)}
              {blockers
                .filter((b) => !documentGaps.some((g) => g.code === b.code))
                .map((b) => <BlockerRow key={b.code} b={b} />)}
            </ul>
          )}

          {/* Switching is just answering the question again — nothing is
              issued yet, and the lines are identical either way. Offered only
              when the other kind is actually available. */}
          {!cannotIssue && (isFacturaDraft || eligibleForFactura) && (
            <button
              type="button"
              onClick={() => switchKind(isFacturaDraft ? 'albaran' : 'invoice')}
              disabled={switchDraft.isPending}
              className="mt-3 h-9 px-3 rounded-lg bg-card border border-border hover:border-brand text-xs font-semibold font-display text-ink transition-colors inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {switchDraft.isPending && <Loader2 size={13} strokeWidth={2} className="animate-spin" />}
              {isFacturaDraft
                ? t('invoices.switchToAlbaran', 'Make this an albarán instead')
                : t('invoices.switchToFactura', 'Make this a factura instead')}
            </button>
          )}
        </section>
      )}

      {/* Buyer — editable while draft, because a rep often has to add the
          CIF the client only produces at the counter. */}
      <section className="bg-card rounded-xl border border-border p-4 sm:p-6 space-y-4">
        <h2 className="text-base font-semibold font-display text-ink">
          {t('invoices.buyer', 'Bill to')}
        </h2>
        {isDraft ? (
          <>
            <PartyFields party={buyer} onChange={setBuyer} />

            <Textarea
              label={t('invoices.paymentTerms', 'Payment terms')}
              rows={2}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
            />
            <Textarea
              label={t('invoices.notes', 'Notes')}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            {/* The seller is frozen from invoicing settings when the draft is
                created. Editable here because a one-off correction — a trading
                address, a phone — should not mean changing the settings every
                future document inherits. */}
            <details className="rounded-lg border border-border">
              <summary className="px-3 py-2 text-sm font-semibold text-ink cursor-pointer select-none">
                {t('invoices.seller', 'Issued by')}
              </summary>
              <div className="p-3 pt-0 space-y-3">
                <PartyFields party={seller} onChange={setSeller} nameKey="legal_name" />
              </div>
            </details>
            <button
              type="button"
              onClick={save}
              disabled={updateInvoice.isPending}
              className="min-h-[44px] px-4 rounded-xl bg-card border-2 border-border hover:border-brand text-sm font-semibold font-display text-ink inline-flex items-center gap-2 disabled:opacity-60"
            >
              <Save size={15} strokeWidth={2} />
              {t('common.save', 'Save')}
            </button>
          </>
        ) : (
          <div className="text-sm text-ink space-y-0.5">
            <p className="font-semibold">{String(invoice.buyer_snapshot.name ?? '—')}</p>
            {invoice.buyer_snapshot.tax_id && (
              <p className="font-mono text-xs text-muted">{String(invoice.buyer_snapshot.tax_id)}</p>
            )}
            <p className="text-muted">{String(invoice.buyer_snapshot.address ?? '')}</p>
          </div>
        )}
      </section>

      {/* Lines */}
      {isDraft && invoice.manually_edited && (
        <div className="rounded-xl border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-ink">
          {t('invoices.detached', 'This draft no longer follows its order.')}
        </div>
      )}

      {/* THE LINES ON A PHONE (2026-11-05): a card per line instead of the
          table, which needed 600–780px and hid quantity, IVA and total off to
          the right. Same state and handlers as the table below; from sm the
          table takes over (table → list below sm). */}
      <section className="sm:hidden bg-card rounded-xl border border-border">
        <ul className="divide-y divide-border">
          {isDraft && (() => {
            let mShown = -1;
            return lineDraft.map((l, i) => {
              if (isHidden(l)) return null;
              mShown += 1;
              const diverges = !linesDirty && (data?.divergence ?? []).includes(mShown);
              const set = (k: keyof LineDraft) => (v: string) =>
                setLineDraft((prev) => prev.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
              const change = (next: (x: LineDraft) => LineDraft) =>
                setLineDraft((prev) => prev.map((x, j) => (j === i ? next(x) : x)));
              const gross = centsToEuros(lineGrossCents(l));
              const rate = Number(l.rate_pct) || 0;
              const box = 'w-full h-11 px-3 rounded-lg border border-border bg-card text-ink focus:outline-none focus:ring-2 focus:ring-brand/30';
              const cap = 'block text-[11px] font-semibold uppercase tracking-wide text-muted font-display mb-1';
              return (
                <li key={i} className={`p-3.5 space-y-2.5 ${diverges ? 'bg-warning-bg/40' : ''}`}>
                  <div className="flex items-center gap-2">
                    <input
                      value={l.code}
                      maxLength={40}
                      onChange={(e) => set('code')(e.target.value)}
                      aria-label={t('invoices.code', 'Code')}
                      placeholder={t('invoices.code', 'Code')}
                      className="w-32 h-10 px-3 rounded-lg border border-border bg-card font-mono text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => l.key && toggleHidden(l.key, true)}
                      disabled={!l.key || shownCount <= 1 || updateInvoice.isPending}
                      aria-label={t('invoices.hideLine', 'Hide from {{doc}}', { doc: docName })}
                      className="w-10 h-10 rounded-lg border border-border flex items-center justify-center text-muted active:bg-surface-cream disabled:opacity-30 transition-colors"
                    >
                      <EyeOff size={16} strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      disabled={shownCount <= 1}
                      aria-label={t('invoices.removeLine', 'Remove line')}
                      className="w-10 h-10 rounded-lg border border-border flex items-center justify-center text-muted active:bg-danger-bg active:text-danger disabled:opacity-30 transition-colors"
                    >
                      <Trash2 size={16} strokeWidth={1.75} />
                    </button>
                  </div>
                  <div>
                    <input
                      value={l.description}
                      onChange={(e) => set('description')(e.target.value)}
                      aria-label={t('invoices.item', 'Item')}
                      className={box}
                    />
                    {diverges && (
                      <span className="block mt-1 text-[11px] text-warning">
                        {t('invoices.lineDiverges', 'Differs from the order')}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="block min-w-0">
                      <span className={cap}>{t('invoices.qty', 'Qty')}</span>
                      <input
                        value={l.quantity}
                        inputMode="numeric"
                        onChange={(e) => set('quantity')(e.target.value.replace(/[^0-9]/g, ''))}
                        className={`${box} text-right tabular-nums`}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className={cap}>{t('invoices.unitPriceVat', 'Price incl. IVA')}</span>
                      <input
                        value={l.unit_price}
                        inputMode="decimal"
                        onChange={(e) => {
                          const typed = e.target.value.replace(/[^0-9.,]/g, '');
                          change((x) => withPrice(x, typed));
                        }}
                        className={`${box} text-right tabular-nums`}
                      />
                      {rate > 0 && (
                        <span className="block mt-1 text-[11px] text-muted text-right tabular-nums">
                          {t('invoices.baseHint', '{{base}} + {{rate}}% IVA', { base: money(centsToEuros(cents(l.unit_base))), rate })}
                        </span>
                      )}
                    </label>
                    <label className="block min-w-0">
                      <span className={cap}>{t('orderDetail.editOrder.discount', 'Discount')}</span>
                      <input
                        value={l.discount}
                        inputMode="decimal"
                        placeholder="0,00"
                        onChange={(e) => set('discount')(e.target.value.replace(/[^0-9.,]/g, ''))}
                        className={`${box} text-right tabular-nums`}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className={cap}>{t('invoices.vat', 'IVA')}</span>
                      <select
                        value={l.rate_pct}
                        onChange={(e) => {
                          const picked = e.target.value;
                          change((x) => withRate(x, picked));
                        }}
                        className={`${box} tabular-nums`}
                      >
                        {rateChoices(l.rate_pct).map((r) => (
                          <option key={r} value={String(r)}>{r} %</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="flex items-baseline justify-between pt-0.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted font-display">{t('invoices.lineTotal', 'Total')}</span>
                    <span className="text-base font-bold text-ink tabular-nums">{money(gross)}</span>
                  </div>
                </li>
              );
            });
          })()}
          {!isDraft && invoice.lines.map((l, i) => (
            <li key={i} className="px-4 py-3">
              {l.code && <p className="text-[11px] font-mono text-muted">{l.code}</p>}
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-ink min-w-0">{l.description}</p>
                <span className="text-sm font-semibold text-ink tabular-nums shrink-0">{money(l.gross)}</span>
              </div>
              <p className="text-xs text-muted tabular-nums mt-0.5">
                {l.quantity} × {money(l.unit_price)} · {t('invoices.vat', 'IVA')} {l.rate_pct}%
                {l.vat_source === 'default' && (
                  <span className="ml-0.5 text-warning" title={t('invoices.vatUnreviewed', 'Rate not reviewed')}>*</span>
                )}
                {l.discount && <span className="ml-1.5 text-success">−{money(l.discount)}</span>}
              </p>
            </li>
          ))}
        </ul>
        {isDraft && (
          <div className="flex items-center gap-2 flex-wrap p-3.5 border-t border-border">
            <button
              type="button"
              onClick={addLine}
              className="h-11 px-4 rounded-lg border border-dashed border-border text-sm font-semibold font-display text-gray inline-flex items-center gap-1.5 transition-colors"
            >
              <Plus size={16} strokeWidth={2.25} />
              {t('invoices.addLine', 'Add a line')}
            </button>
            {linesDirty && (
              <button
                type="button"
                onClick={save}
                disabled={updateInvoice.isPending}
                className="h-11 px-4 rounded-lg bg-brand text-white text-sm font-semibold font-display inline-flex items-center gap-1.5 disabled:opacity-60 transition-colors"
              >
                {updateInvoice.isPending
                  ? <Loader2 size={15} strokeWidth={2} className="animate-spin" />
                  : <Save size={15} strokeWidth={2} />}
                {t('invoices.saveLines', 'Save line changes')}
              </button>
            )}
          </div>
        )}
      </section>

      {/* From sm: the table. Scrolls sideways if a tablet is still too narrow
          rather than clipping the hide and remove buttons at the row's end. */}
      <section className="hidden sm:block bg-card rounded-xl border border-border overflow-x-auto">
        <table className={`w-full ${isDraft ? 'min-w-[780px]' : 'min-w-[600px]'}`}>
          <thead>
            <tr className="bg-surface-cream">
              <th className="text-left text-xs font-semibold text-gray uppercase pl-4 pr-1 py-3 font-display">{t('invoices.code', 'Code')}</th>
              <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('invoices.item', 'Item')}</th>
              <th className="text-right text-xs font-semibold text-gray uppercase px-3 py-3 font-display">{t('invoices.qty', 'Qty')}</th>
              {isDraft && (
                <>
                  <th className="text-right text-xs font-semibold text-gray uppercase px-2 py-3 font-display">{t('invoices.unitPriceVat', 'Price incl. IVA')}</th>
                  <th className="text-right text-xs font-semibold text-gray uppercase px-2 py-3 font-display">{t('orderDetail.editOrder.discount', 'Discount')}</th>
                </>
              )}
              <th className="text-right text-xs font-semibold text-gray uppercase px-3 py-3 font-display">{t('invoices.vat', 'IVA')}</th>
              <th className="text-right text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('invoices.lineTotal', 'Total')}</th>
              {isDraft && <th className="w-20 px-2 py-3" />}
            </tr>
          </thead>
          <tbody>
            {isDraft && lineDraft.map((l, i) => {
              // Hidden lines are listed under the table, not in it.
              if (isHidden(l)) return null;
              shownIdx += 1;
              // The server numbers the PRINTED lines; while edits are pending
              // that numbering may not match, so the flag waits for the save.
              const diverges = !linesDirty && (data?.divergence ?? []).includes(shownIdx);
              const set = (k: keyof LineDraft) => (v: string) =>
                setLineDraft((prev) => prev.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
              const change = (next: (x: LineDraft) => LineDraft) =>
                setLineDraft((prev) => prev.map((x, j) => (j === i ? next(x) : x)));
              const gross = centsToEuros(lineGrossCents(l));
              const rate = Number(l.rate_pct) || 0;
              return (
                // Every cell top-aligned, so all the boxes sit on one line and a
                // note under one of them (the IVA make-up under the price, "Differs
                // from the order" under the item) hangs below it instead of pushing
                // that box up out of line with the rest.
                <tr key={i} className={`border-t border-border [&>td]:align-top ${diverges ? 'bg-warning-bg/40' : ''}`}>
                  <td className="pl-4 pr-1 py-2.5">
                    {/* The product's code, as the PDF's CÓDIGO prints it —
                        filled from its sku, typed here when it has none. */}
                    <input
                      value={l.code}
                      maxLength={40}
                      onChange={(e) => set('code')(e.target.value)}
                      aria-label={t('invoices.code', 'Code')}
                      className="w-24 h-9 px-2 rounded-lg border border-border bg-card text-xs font-mono text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      value={l.description}
                      onChange={(e) => set('description')(e.target.value)}
                      aria-label={t('invoices.item', 'Item')}
                      className="w-full h-9 px-2 rounded-lg border border-border bg-card text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                    {/* The warning names the one thing a reader cannot see:
                        that this line no longer says what was ordered. */}
                    {diverges && (
                      <span className="block mt-1 text-[11px] text-warning">
                        {t('invoices.lineDiverges', 'Differs from the order')}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <input
                      value={l.quantity}
                      inputMode="numeric"
                      onChange={(e) => set('quantity')(e.target.value.replace(/[^0-9]/g, ''))}
                      aria-label={t('invoices.qty', 'Qty')}
                      className="w-14 h-9 px-2 rounded-lg border border-border bg-card text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                  </td>
                  <td className="px-2 py-2.5">
                    <input
                      value={l.unit_price}
                      inputMode="decimal"
                      onChange={(e) => {
                        const typed = e.target.value.replace(/[^0-9.,]/g, '');
                        change((x) => withPrice(x, typed));
                      }}
                      aria-label={t('invoices.unitPriceVat', 'Price incl. IVA')}
                      className="w-20 h-9 px-2 rounded-lg border border-border bg-card text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                    {/* Where the price comes from: the base, plus this line's
                        IVA. A new rate is added to the same base. */}
                    {rate > 0 && (
                      <span className="block mt-1 text-[11px] text-muted text-right tabular-nums whitespace-nowrap">
                        {t('invoices.baseHint', '{{base}} + {{rate}}% IVA', { base: money(centsToEuros(cents(l.unit_base))), rate })}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <input
                      value={l.discount}
                      inputMode="decimal"
                      placeholder="0,00"
                      onChange={(e) => set('discount')(e.target.value.replace(/[^0-9.,]/g, ''))}
                      aria-label={t('orderDetail.editOrder.discount', 'Discount')}
                      className="w-20 h-9 px-2 rounded-lg border border-border bg-card text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                  </td>
                  <td className="px-2 py-2.5">
                    {/* Picked from the four Spanish bands (0 / 4 / 10 / 21) —
                        a typed box with a datalist only ever offered the
                        option matching what was already in it (user,
                        2026-11-04). A rate outside the bands that a line
                        already carries stays listed, so opening an old
                        draft never changes it behind anyone's back. */}
                    <select
                      value={l.rate_pct}
                      onChange={(e) => {
                        // IVA re-added to the same base: the price and the total follow.
                        const picked = e.target.value;
                        change((x) => withRate(x, picked));
                      }}
                      aria-label={t('invoices.vat', 'IVA')}
                      className="w-20 h-9 px-2 rounded-lg border border-border bg-card text-sm text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-brand/30"
                    >
                      {rateChoices(l.rate_pct).map((r) => (
                        <option key={r} value={String(r)}>{r} %</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm font-semibold text-ink tabular-nums whitespace-nowrap">
                    {/* The height of a box, so the amount sits level with them. */}
                    <div className="h-9 flex items-center justify-end">{money(gross)}</div>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="h-9 flex items-center justify-end gap-0.5">
                      {/* Hide: off the paper and the totals, the order untouched. */}
                      <button
                        type="button"
                        onClick={() => l.key && toggleHidden(l.key, true)}
                        disabled={!l.key || shownCount <= 1 || updateInvoice.isPending}
                        aria-label={t('invoices.hideLine', 'Hide from {{doc}}', { doc: docName })}
                        title={shownCount <= 1
                          ? t('invoices.hideKeepOne', 'A document needs at least one line')
                          : t('invoices.hideLine', 'Hide from {{doc}}', { doc: docName })}
                        className="w-8 h-8 rounded-lg hover:bg-surface-cream flex items-center justify-center text-muted hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted transition-colors"
                      >
                        <EyeOff size={14} strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        disabled={shownCount <= 1}
                        aria-label={t('invoices.removeLine', 'Remove line')}
                        title={shownCount <= 1
                          ? t('invoices.lastLine', 'A document needs at least one line')
                          : t('invoices.removeLine', 'Remove line')}
                        className="w-8 h-8 rounded-lg hover:bg-danger-bg flex items-center justify-center text-muted hover:text-danger disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted transition-colors"
                      >
                        <Trash2 size={14} strokeWidth={1.75} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {isDraft && (
              <tr className="border-t border-border">
                <td colSpan={8} className="px-4 py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={addLine}
                      className="h-9 px-3 rounded-lg border border-dashed border-border hover:border-brand text-xs font-semibold font-display text-gray hover:text-ink inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Plus size={14} strokeWidth={2.25} />
                      {t('invoices.addLine', 'Add a line')}
                    </button>
                    {/* Save beside the lines, not only up by the buyer: a rate
                        changed here is what most edits on this table are. */}
                    {linesDirty && (
                      <button
                        type="button"
                        onClick={save}
                        disabled={updateInvoice.isPending}
                        className="h-9 px-3 rounded-lg bg-brand hover:bg-brand-mid text-white text-xs font-semibold font-display inline-flex items-center gap-1.5 disabled:opacity-60 transition-colors"
                      >
                        {updateInvoice.isPending
                          ? <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                          : <Save size={13} strokeWidth={2} />}
                        {t('invoices.saveLines', 'Save line changes')}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}
            {!isDraft && invoice.lines.map((l, i) => (
              <tr key={i} className="border-t border-border">
                <td className="pl-4 pr-1 py-3 text-xs font-mono text-gray">{l.code ?? ''}</td>
                <td className="px-4 py-3 text-sm text-ink">{l.description}</td>
                <td className="px-3 py-3 text-sm text-ink text-right tabular-nums">{l.quantity}</td>
                <td className="px-3 py-3 text-sm text-right tabular-nums">
                  {l.rate_pct}%
                  {l.vat_source === 'default' && (
                    <span className="ml-1 text-warning" title={t('invoices.vatUnreviewed', 'Rate not reviewed')}>*</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {l.discount && (
                    <span className="block text-[11.5px] text-success">
                      {'−'}{money(l.discount)}
                    </span>
                  )}
                  <span className="block text-sm font-semibold text-ink">{money(l.gross)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Lines left off the document. On a draft each can be shown again —
          what is listed is the draft as being edited, saved or not; on an
          issued one this is the record of what was hidden when it went out.
          Neither is ever printed or totalled. */}
      {hiddenRows.length > 0 && (
        <section className="bg-card rounded-xl border border-dashed border-border p-4 sm:p-5">
          <div className="flex items-start gap-2.5">
            <EyeOff size={16} strokeWidth={1.75} className="text-muted shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold font-display text-ink flex items-center gap-2 flex-wrap">
                {isDraft
                  ? t('invoices.hiddenTitle', 'Hidden from {{doc}} ({{n}})', { doc: docName, n: hiddenRows.length })
                  : t('invoices.hiddenIssuedTitle', 'Left off {{doc}} ({{n}})', { doc: docName, n: hiddenRows.length })}
                {isDraft && hiddenChanged && (
                  <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-warning-bg text-warning">
                    {t('invoices.previewUnsaved', 'Not saved yet')}
                  </span>
                )}
              </h2>
              <p className="text-xs text-muted mt-0.5 leading-snug">
                {isDraft
                  ? t('invoices.hiddenBody', 'Not printed and not counted in the totals. The order itself does not change.')
                  : t('invoices.hiddenIssuedBody', 'Hidden when it was issued: not on the PDF and not in its totals.')}
              </p>
            </div>
          </div>
          <ul className="mt-3 divide-y divide-border border-t border-border">
            {hiddenRows.map((h) => (
              <li key={h.key} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray truncate">{h.description}</p>
                  <p className="text-xs text-muted tabular-nums">
                    {h.quantity} × {money(h.unit_price)}
                    {h.discount ? <span className="ml-1.5">−{money(h.discount)}</span> : null}
                  </p>
                </div>
                <span className="text-sm text-muted tabular-nums shrink-0">{money(h.gross)}</span>
                {isDraft && (
                  <button
                    type="button"
                    onClick={() => toggleHidden(h.key, false)}
                    disabled={updateInvoice.isPending}
                    aria-label={t('invoices.showLine', 'Show on {{doc}}', { doc: docName })}
                    title={t('invoices.showLine', 'Show on {{doc}}', { doc: docName })}
                    className="h-9 px-3 rounded-lg bg-card border border-border hover:border-brand text-xs font-semibold font-display text-ink inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50 transition-colors"
                  >
                    <Eye size={14} strokeWidth={1.75} />
                    {t('invoices.showShort', 'Show')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* IVA summary */}
      <section className="bg-card rounded-xl border border-border p-4 sm:p-6">
        <h2 className="text-sm font-semibold font-display text-ink mb-3 flex items-center gap-2 flex-wrap">
          {t('invoices.vatSummary', 'IVA breakdown')}
          {previewTotals && (
            <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-warning-bg text-warning">
              {t('invoices.previewUnsaved', 'Not saved yet')}
            </span>
          )}
        </h2>
        <div className="space-y-1.5">
          {shownTotals.by_rate.map((g) => (
            <div key={g.rate_pct} className="flex justify-between text-sm">
              <span className="text-muted">
                {t('invoices.baseAt', 'Base at {{rate}}%', { rate: g.rate_pct })}
              </span>
              <span className="tabular-nums text-ink">
                {money(g.base)} <span className="text-muted">+ {money(g.vat)}</span>
                {g.recargo !== undefined && (
                  <span className="text-muted"> + {money(g.recargo)} {t('invoices.recargoShort', 'rec.')}</span>
                )}
              </span>
            </div>
          ))}
          {shownTotals.recargo !== undefined && (
            <div className="flex justify-between text-sm pt-1.5">
              <span className="text-muted">{t('invoices.recargoTotal', 'Recargo de equivalencia')}</span>
              <span className="tabular-nums text-ink">{money(shownTotals.recargo)}</span>
            </div>
          )}
          {Number(shownTotals.discount_total ?? 0) > 0 && (
            <div className="flex justify-between text-sm pt-1.5">
              <span className="text-success">{t('invoices.discountTotal', 'Discount applied')}</span>
              <span className="tabular-nums text-success">
                {'−'}{money(shownTotals.discount_total ?? '0')}
              </span>
            </div>
          )}
          <div className="flex justify-between pt-2 mt-2 border-t border-border">
            <span className="text-sm font-semibold text-ink">{t('invoices.total', 'Total')}</span>
            <span className="text-lg font-bold text-ink tabular-nums">{money(shownTotals.total ?? shownTotals.gross)}</span>
          </div>
        </div>
      </section>

      {/* Actions */}
      {unsaved && (
        <div className="flex items-start gap-2 flex-wrap">
          <p className="flex items-start gap-2 text-xs text-warning flex-1 min-w-[220px]">
            <AlertTriangle size={14} strokeWidth={2} className="shrink-0 mt-px" />
            <span>{saveBeforeLeaving}</span>
          </p>
          {/* Changes kept across a reload need a way out that is not Save. */}
          <button
            type="button"
            onClick={discardChanges}
            className="h-8 px-3 rounded-lg border border-border hover:border-danger text-xs font-semibold font-display text-gray hover:text-danger inline-flex items-center gap-1.5 transition-colors"
          >
            <Undo2 size={13} strokeWidth={1.75} />
            {t('invoices.discardChanges', 'Discard changes')}
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={download}
          disabled={unsaved}
          title={unsaved ? saveBeforeLeaving : undefined}
          className="min-h-[52px] px-5 rounded-xl bg-card border-2 border-border hover:border-brand text-sm font-semibold font-display text-ink inline-flex items-center gap-2 disabled:opacity-50 disabled:hover:border-border"
        >
          <Download size={16} strokeWidth={2} />
          {t('invoices.download', 'Download PDF')}
        </button>

        {isDraft && !cannotIssue && (
          <button
            type="button"
            onClick={() => setIssueOpen(true)}
            disabled={issueInvoice.isPending || blockedAsFactura || unsaved}
            title={unsaved ? saveBeforeLeaving : blockedAsFactura ? blockers.map((b) => b.message).join(' ') : undefined}
            className="min-h-[52px] px-5 rounded-xl bg-brand hover:bg-brand-mid disabled:opacity-60 text-white text-sm font-semibold font-display inline-flex items-center gap-2"
          >
            {issueInvoice.isPending
              ? <Loader2 size={16} strokeWidth={2.5} className="animate-spin" />
              : <FileCheck2 size={16} strokeWidth={2} />}
            {isFacturaDraft
              ? t('invoices.issueFactura', 'Issue invoice')
              : t('invoices.issueAlbaran', 'Issue albarán')}
          </button>
        )}

        {isDraft && (
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="min-h-[52px] px-4 rounded-xl border-2 border-border hover:border-danger text-sm font-semibold font-display text-danger inline-flex items-center gap-2"
          >
            <Trash2 size={16} strokeWidth={1.75} />
            {t('invoices.deleteDraft', 'Delete draft')}
          </button>
        )}

        {!isDraft && (
          <p className="flex items-center gap-2 text-xs text-muted self-center">
            <Lock size={13} strokeWidth={2} />
            {t('invoices.frozen', 'Issued documents cannot be changed. Corrections go out as a credit note.')}
          </p>
        )}
      </div>

      <ConfirmModal
        open={issueOpen}
        title={isFacturaDraft
          ? t('invoices.confirmIssueTitle', 'Issue this invoice?')
          : t('invoices.confirmAlbaranTitle', 'Issue this albarán?')}
        message={t('invoices.confirmIssueLead', 'This is a one-way step. Three things happen the moment you confirm:')}
        confirmLabel={issueInvoice.isPending ? t('invoices.issuing', 'Issuing…') : t('invoices.confirmIssue', 'Issue')}
        confirmDisabled={issueInvoice.isPending}
        onConfirm={issue}
        onCancel={() => setIssueOpen(false)}
      >
        {/* Spelled out one consequence per line rather than in a paragraph.
            The second one is the surprise — people expect the DOCUMENT to
            freeze and do not expect the ORDER to, and they find out by
            trying to change it later and being refused. */}
        <ul className="space-y-2.5 text-sm font-body text-gray">
          <li className="flex gap-2.5">
            <Hash size={15} strokeWidth={1.75} className="text-brand shrink-0 mt-0.5" />
            <span>
              {t('invoices.consequenceNumber', 'A number is assigned from the {{s}} series. It is used up even if you later decide the document was wrong.', { s: invoice.series })}
            </span>
          </li>
          <li className="flex gap-2.5">
            <Lock size={15} strokeWidth={1.75} className="text-brand shrink-0 mt-0.5" />
            <span className="text-ink font-medium">
              {t('invoices.consequenceOrder', 'The order is closed. Its items and delivery fee can no longer be changed — by you, by the shop, or by the customer.')}
            </span>
          </li>
          <li className="flex gap-2.5">
            <FileWarning size={15} strokeWidth={1.75} className="text-brand shrink-0 mt-0.5" />
            <span>
              {t('invoices.consequenceFrozen', 'The document itself cannot be edited or deleted. A correction goes out as a credit note.')}
            </span>
          </li>
        </ul>

        {/* What is hidden goes out hidden, for good — said here, at the one
            moment it can still be changed. */}
        {hiddenLines.length > 0 && (
          <p className="mt-4 rounded-lg border border-border bg-surface-cream px-3 py-2 text-xs font-body text-ink flex items-start gap-2">
            <EyeOff size={14} strokeWidth={1.75} className="text-muted shrink-0 mt-0.5" />
            <span>{t('invoices.confirmHiddenNote', '{{n}} hidden line(s) will be left off it and out of its total.', { n: hiddenLines.length })}</span>
          </p>
        )}

        {/* A albaran is not a fiscal document, and the person issuing it
            should be told that here rather than discovering it on the PDF. */}
        {!isFacturaDraft && (
          <p className="mt-4 rounded-lg border border-warning/30 bg-warning-bg/50 px-3 py-2 text-xs font-body text-ink">
            {t('invoices.confirmAlbaranNote', 'This goes out as an ALBARÁN, which is not valid as an invoice for IVA purposes. It says so on the document.')}
          </p>
        )}
      </ConfirmModal>

      <ConfirmModal
        open={deleteOpen}
        danger
        title={t('invoices.confirmDeleteTitle', 'Delete this draft?')}
        message={t('invoices.confirmDeleteBody', 'Nothing has been issued, so no number is used up. You can create a new draft from the order.')}
        confirmLabel={t('invoices.confirmDelete', 'Delete')}
        onConfirm={() => deleteInvoice.mutate(invoice.id, {
          onSuccess: () => {
            if (keptKey) clearSavedForm(keptKey);
            toast.success(t('invoices.deleted', 'Draft deleted'));
            // Replace, not push: this invoice no longer exists, and leaving
            // it behind in history gives back a 404.
            navigate(`/orders/${invoice.order_id}`, { replace: true });
          },
          onError: (e) => toast.error(t('invoices.deleteFailed', 'Could not delete'), String(e)),
        })}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
