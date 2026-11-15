import { useEffect, useMemo, useState } from 'react';
import { EMAIL_INPUT_PROPS } from '@/lib/emailField';
import { X, CheckCircle2, MessageSquare, XCircle, Info, AlertTriangle } from 'lucide-react';
import {
  useLinkableStores,
  type B2bLead,
  type ApprovePartnerPayload,
  type ApproveBusinessPayload,
  type RequestPartnerInfoPayload,
  type RejectPartnerPayload,
} from '@grocery-app/shared';

/**
 * `approve`          — partner_store lead → creates a Store + PartnerStoreRole.
 * `approve-business` — business lead → creates a User + BusinessProfile with
 *                      B2B pricing. No store, no dashboard.
 * The other two are shared by both funnels.
 */
export type PartnerApprovalMode = 'approve' | 'approve-business' | 'request-info' | 'reject';

type SubmitPayload =
  | { mode: 'approve'; payload: ApprovePartnerPayload }
  | { mode: 'approve-business'; payload: ApproveBusinessPayload }
  | { mode: 'request-info'; payload: RequestPartnerInfoPayload }
  | { mode: 'reject'; payload: RejectPartnerPayload };

interface Props {
  open: boolean;
  mode: PartnerApprovalMode;
  lead: B2bLead;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onSubmit: (payload: SubmitPayload) => void;
}

/**
 * Three-in-one modal for the MV Slice 1 partner-approval workflow. Mode
 * switches the header colour, the form body, and the submit label:
 *
 *   approve       — brand-green, two-column form (partner user + store)
 *   request-info  — amber, single textarea
 *   reject        — danger-red, single textarea
 *
 * Kept as one component per feedback_partner-dashboard-reuses-admin — no
 * point forking three near-identical modals when the frame is shared.
 */
export default function PartnerApprovalModal({
  open, mode, lead, isSubmitting = false, errorMessage, onCancel, onSubmit,
}: Props) {
  // ─── Approve mode state ──────────────────────────────────
  // Default partner-user name/email from the lead. Admin can override if the
  // primary contact isn't the person who'll log in.
  const [partnerName, setPartnerName]   = useState(lead.name);
  const [partnerEmail, setPartnerEmail] = useState(lead.email);
  const [storeMode, setStoreMode]       = useState<'new' | 'existing'>('new');
  const [existingStoreId, setExistingStoreId] = useState<string>('');

  // New-store fields — default from lead.company where it makes sense.
  const [storeName, setStoreName]           = useState(lead.company || '');
  const [taglineEs, setTaglineEs]           = useState('');
  const [taglineEn, setTaglineEn]           = useState('');
  const [descriptionEs, setDescriptionEs]   = useState('');
  const [descriptionEn, setDescriptionEn]   = useState('');
  const [contactEmail, setContactEmail]     = useState(lead.email);
  const [contactPhone, setContactPhone]     = useState(lead.phone);
  const [origin, setOrigin]                 = useState('');

  // ─── Business approve mode state ─────────────────────────
  // Prefilled from the lead but editable, so an admin can correct a typo in
  // the application once rather than chase it after the account exists.
  const [bizCompany, setBizCompany]     = useState(lead.company || '');
  const [bizType, setBizType]           = useState(lead.business_type ?? '');
  const [bizLocation, setBizLocation]   = useState(lead.location ?? '');
  const [bizWebsite, setBizWebsite]     = useState(lead.website ?? '');
  const [bizRegNo, setBizRegNo]         = useState(lead.registration_no ?? '');
  const [bizPhone, setBizPhone]         = useState(lead.phone ?? '');

  // ─── Request-info + reject mode state ────────────────────
  const [message, setMessage] = useState('');

  // Reset all state whenever the modal opens for a different lead/mode.
  useEffect(() => {
    if (!open) return;
    setPartnerName(lead.name);
    setPartnerEmail(lead.email);
    setStoreMode('new');
    setExistingStoreId('');
    setStoreName(lead.company || '');
    setTaglineEs('');
    setTaglineEn('');
    setDescriptionEs('');
    setDescriptionEn('');
    setContactEmail(lead.email);
    setContactPhone(lead.phone);
    setOrigin('');
    setBizCompany(lead.company || '');
    setBizType(lead.business_type ?? '');
    setBizLocation(lead.location ?? '');
    setBizWebsite(lead.website ?? '');
    setBizRegNo(lead.registration_no ?? '');
    setBizPhone(lead.phone ?? '');
    setMessage('');
  }, [open, lead.id, mode]);

  // Only stores that can actually be linked: created by Cesto admin, with no
  // partner attached, not deleted or scheduled for deletion. This used to list
  // EVERY store, which meant the picker happily offered stores that already
  // belonged to another partner — the server now refuses those, but offering
  // them at all is the bug.
  //
  // Fetched only while the picker is open; the modal spends most of its life
  // in create-new mode.
  const { data: linkableData, isLoading: linkableLoading } =
    useLinkableStores(open && mode === 'approve');
  const linkableStores = linkableData?.items ?? [];

  const config = useMemo(() => {
    switch (mode) {
      case 'approve': return {
        title: 'Approve partner',
        subtitle: `Create a store for ${lead.company || lead.name} and email login credentials. The store is created as a DRAFT — the partner adds products and a delivery area, then publishes it themselves. It is not visible to customers until they do.`,
        Icon: CheckCircle2,
        accent: 'brand',
        submitLabel: 'Approve & send credentials',
      };
      case 'approve-business': return {
        title: 'Approve business account',
        subtitle: `Create a Cesto account for ${lead.company || lead.name} with B2B pricing unlocked. No store is created — they shop the storefront at wholesale prices. Credentials are emailed.`,
        Icon: CheckCircle2,
        accent: 'brand',
        submitLabel: 'Approve & send credentials',
      };
      case 'request-info': return {
        title: 'Request more information',
        subtitle: `Send ${lead.name} a magic-link email asking for additional details. The link is valid for 7 days.`,
        Icon: MessageSquare,
        accent: 'amber',
        submitLabel: 'Send request',
      };
      case 'reject': return {
        title: 'Reject partner application',
        subtitle: `${lead.name} will be notified. The reason will be included in the email verbatim — write something you'd be comfortable sending.`,
        Icon: XCircle,
        accent: 'danger',
        submitLabel: 'Reject application',
      };
    }
  }, [mode, lead]);

  const canSubmit = (() => {
    if (isSubmitting) return false;
    if (mode === 'approve') {
      if (!partnerName.trim() || !partnerEmail.trim() || !partnerEmail.includes('@')) return false;
      if (storeMode === 'existing') return !!existingStoreId;
      return storeName.trim().length > 0;
    }
    if (mode === 'approve-business') {
      if (!partnerName.trim() || !partnerEmail.trim() || !partnerEmail.includes('@')) return false;
      return bizCompany.trim().length > 0;
    }
    return message.trim().length >= 10;
  })();

  function handleSubmit() {
    if (!canSubmit) return;
    if (mode === 'approve') {
      const partner_user = { name: partnerName.trim(), email: partnerEmail.trim() };
      if (storeMode === 'existing') {
        onSubmit({ mode: 'approve', payload: { partner_user, store_id: existingStoreId } });
      } else {
        const store = {
          name: storeName.trim(),
          ...(taglineEs.trim()     && { tagline_es: taglineEs.trim() }),
          ...(taglineEn.trim()     && { tagline_en: taglineEn.trim() }),
          ...(descriptionEs.trim() && { description_es: descriptionEs.trim() }),
          ...(descriptionEn.trim() && { description_en: descriptionEn.trim() }),
          ...(contactEmail.trim()  && { contact_email: contactEmail.trim() }),
          ...(contactPhone.trim()  && { contact_phone: contactPhone.trim() }),
          ...(origin.trim()        && { origin: origin.trim() }),
        };
        onSubmit({ mode: 'approve', payload: { partner_user, store } });
      }
    } else if (mode === 'approve-business') {
      // Empty optional fields go as null, not '' — the profile should read
      // "not provided", not render a blank row.
      const orNull = (s: string) => (s.trim() ? s.trim() : null);
      onSubmit({
        mode: 'approve-business',
        payload: {
          user: { name: partnerName.trim(), email: partnerEmail.trim() },
          business: {
            company:         bizCompany.trim(),
            business_type:   orNull(bizType),
            location:        orNull(bizLocation),
            website:         orNull(bizWebsite),
            registration_no: orNull(bizRegNo),
            contact_phone:   orNull(bizPhone),
          },
        },
      });
    } else if (mode === 'request-info') {
      onSubmit({ mode: 'request-info', payload: { message: message.trim() } });
    } else {
      onSubmit({ mode: 'reject', payload: { reason: message.trim() } });
    }
  }

  if (!open) return null;

  const headerClass =
    config.accent === 'brand'  ? 'bg-brand-mist/50 text-brand-deep'
    : config.accent === 'amber' ? 'bg-amber-mist/60 text-amber-deep'
    : 'bg-danger-bg text-danger';
  const iconColorClass =
    config.accent === 'brand'  ? 'text-brand'
    : config.accent === 'amber' ? 'text-amber-deep'
    : 'text-danger';
  const submitClass =
    config.accent === 'brand'  ? 'bg-brand hover:bg-brand-mid'
    : config.accent === 'amber' ? 'bg-amber-deep hover:bg-amber-deep/90'
    : 'bg-danger hover:bg-danger/90';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="partner-approval-modal-title"
    >
      <div
        className="bg-card rounded-2xl shadow-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-start gap-3 p-5 border-b border-border ${headerClass}`}>
          <config.Icon className={`w-5 h-5 mt-0.5 shrink-0 ${iconColorClass}`} strokeWidth={1.75} />
          <div className="flex-1 min-w-0">
            <h3 id="partner-approval-modal-title" className="text-base font-bold font-display text-ink">
              {config.title}
            </h3>
            <p className="text-[13px] mt-0.5 font-body opacity-90">
              {config.subtitle}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-black/10 transition-colors shrink-0"
            aria-label="Close"
            type="button"
          >
            <X size={18} strokeWidth={1.75} className="text-muted" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {mode === 'approve-business' ? (
            <>
              {/* Login identity */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted font-display mb-2">
                  Login identity
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Name</span>
                    <input
                      type="text" value={partnerName} onChange={(e) => setPartnerName(e.target.value)}
                      className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Email</span>
                    <input
                      type="email" {...EMAIL_INPUT_PROPS} value={partnerEmail} onChange={(e) => setPartnerEmail(e.target.value.toLowerCase())}
                      autoComplete="off" spellCheck={false}
                      className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm font-mono text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                  </label>
                </div>
                <p className="text-[11px] text-muted font-body mt-2">
                  If a customer account already exists at this email it is upgraded to a business account and its password is reset to the temporary one.
                </p>
              </div>

              {/* Trading details → BusinessProfile */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted font-display mb-2">
                  Business details
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block sm:col-span-2">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Company *</span>
                    <input
                      type="text" value={bizCompany} onChange={(e) => setBizCompany(e.target.value)}
                      className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Business type</span>
                    <input
                      type="text" value={bizType} onChange={(e) => setBizType(e.target.value)}
                      className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Contact phone</span>
                    <input
                      type="text" value={bizPhone} onChange={(e) => setBizPhone(e.target.value)}
                      className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Location</span>
                    <input
                      type="text" value={bizLocation} onChange={(e) => setBizLocation(e.target.value)}
                      className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Website</span>
                    <input
                      type="text" value={bizWebsite} onChange={(e) => setBizWebsite(e.target.value)}
                      className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Registration no.</span>
                    <input
                      type="text" value={bizRegNo} onChange={(e) => setBizRegNo(e.target.value)}
                      className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm font-mono text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-lg bg-brand-mist/40 border border-brand-soft/40 p-3">
                <p className="text-[12px] text-brand-deep font-body">
                  <strong>No store is created.</strong> This account shops the normal storefront with wholesale prices, and can switch between business and regular pricing from the top bar. To let them <em>sell</em> on Cesto instead, reject this and have them apply via Partner deals.
                </p>
              </div>
            </>
          ) : mode === 'approve' ? (
            <>
              {/* Partner user (login identity) */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted font-display mb-2">
                  Partner user (login identity)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Name</span>
                    <input
                      type="text" value={partnerName} onChange={(e) => setPartnerName(e.target.value)}
                      className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Email</span>
                    <input
                      type="email" {...EMAIL_INPUT_PROPS} value={partnerEmail} onChange={(e) => setPartnerEmail(e.target.value.toLowerCase())}
                      autoComplete="off" spellCheck={false}
                      className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm font-mono text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                  </label>
                </div>
              </div>

              {/* Store — new or existing */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted font-display">Store</span>
                  <div className="flex bg-surface-cream border border-border rounded-lg p-0.5">
                    <button
                      type="button" onClick={() => setStoreMode('new')}
                      className={`h-7 px-3 rounded-md text-xs font-semibold font-display transition ${storeMode === 'new' ? 'bg-card shadow-sm text-ink' : 'text-muted'}`}
                    >
                      Create new
                    </button>
                    <button
                      type="button" onClick={() => setStoreMode('existing')}
                      className={`h-7 px-3 rounded-md text-xs font-semibold font-display transition ${storeMode === 'existing' ? 'bg-card shadow-sm text-ink' : 'text-muted'}`}
                    >
                      Link existing
                    </button>
                  </div>
                </div>

                {storeMode === 'existing' ? (
                  <div>
                    {linkableLoading ? (
                      <p className="text-sm text-muted font-body py-3">Loading stores…</p>
                    ) : linkableStores.length === 0 ? (
                      /* Not an error state — it means every store Cesto created
                         already has a partner. Say which, or the admin is left
                         wondering whether the list failed to load. */
                      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-mist/50 border border-amber-deep/30">
                        <AlertTriangle size={16} strokeWidth={1.75} className="text-amber-deep shrink-0 mt-0.5" />
                        <p className="text-[13px] text-ink font-body">
                          No stores are available to link. Every store Cesto created already has a
                          partner attached — create a new store instead, or unlink one first.
                        </p>
                      </div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                        {linkableStores.map((st) => {
                          const selected = existingStoreId === st.id;
                          const inherits = st._count.products + st._count.orders > 0;
                          return (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => setExistingStoreId(selected ? '' : st.id)}
                              className={`w-full text-left px-3 py-2.5 transition ${
                                selected ? 'bg-brand-mist' : 'hover:bg-surface-cream'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-ink font-display truncate">{st.name}</span>
                                <span className="text-[11px] font-mono text-muted shrink-0">/{st.slug}</span>
                                {st.status !== 'live' && (
                                  <span className="text-[11px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded-full bg-surface-linen text-muted shrink-0">
                                    {st.status}
                                  </span>
                                )}
                              </div>
                              {/* What the partner is about to inherit. Linking a
                                  store with 800 products is legitimate, but it
                                  should be a decision rather than a surprise. */}
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11.5px] text-muted font-body">
                                <span>{st._count.products} products</span>
                                <span>{st._count.orders} orders</span>
                              </div>
                              {selected && inherits && (
                                <p className="mt-1.5 text-[11.5px] text-amber-deep font-body">
                                  The partner will gain access to everything already on this store.
                                </p>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="block">
                      <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Store name</span>
                      <input
                        type="text" value={storeName} onChange={(e) => setStoreName(e.target.value)}
                        placeholder="e.g. Shan Foods Madrid"
                        className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
                      />
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Tagline (ES)</span>
                        <input
                          type="text" value={taglineEs} onChange={(e) => setTaglineEs(e.target.value)}
                          placeholder="Optional"
                          className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Tagline (EN)</span>
                        <input
                          type="text" value={taglineEn} onChange={(e) => setTaglineEn(e.target.value)}
                          placeholder="Optional"
                          className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Contact email</span>
                        <input
                          type="email" {...EMAIL_INPUT_PROPS} value={contactEmail} onChange={(e) => setContactEmail(e.target.value.toLowerCase())}
                          className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm font-mono text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Contact phone</span>
                        <input
                          type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
                          className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm font-mono text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                        />
                      </label>
                    </div>
                    <label className="block">
                      <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Origin (country)</span>
                      <input
                        type="text" value={origin} onChange={(e) => setOrigin(e.target.value)}
                        placeholder="e.g. Pakistan"
                        className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
                      />
                    </label>
                    <div className="bg-surface-cream border border-border rounded-lg px-3 py-2 text-[12px] font-body text-muted flex items-start gap-2">
                      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" strokeWidth={1.75} />
                      <span>
                        Store is created as <strong className="text-ink">draft</strong> — not visible to customers.
                        The partner completes their profile from the dashboard, then you flip it to <strong className="text-ink">live</strong> from <span className="font-mono">/stores</span>.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted font-display">
                {mode === 'request-info' ? 'Message to applicant' : 'Rejection reason'}
                <span className="text-muted font-normal normal-case ml-1">· min 10 characters</span>
              </span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                autoFocus
                placeholder={mode === 'request-info'
                  ? 'e.g. Please upload a copy of your business registration and confirm you have refrigeration for perishable goods.'
                  : 'e.g. Your business type does not match our current partner categories.'}
                className="mt-1.5 w-full bg-surface-cream border border-border rounded-lg px-3 py-2 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 resize-none"
              />
              <span className="mt-1 block text-[11px] font-mono text-muted">
                {message.trim().length}/10 minimum
              </span>
            </label>
          )}

          {errorMessage && (
            <div className="bg-danger-bg border border-danger/40 rounded-lg px-3 py-2 text-[13px] font-body text-danger">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end px-5 pb-5 pt-0">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`h-11 px-5 rounded-xl text-sm font-semibold font-display text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${submitClass}`}
          >
            {isSubmitting ? 'Working…' : config.submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
