import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, ExternalLink, Info, Loader2, Store as StoreIcon, UserPlus, X } from 'lucide-react';
import {
  useAdminUserLookup, useLinkableStores, useLinkPartner,
  type AdminLinkPartnerResult,
} from '@grocery-app/shared';
import { Checkbox, TextField } from '@/components/form';
import { IssuedLogin } from '@/components/CredentialsDialog';

/**
 * Give somebody a store — they become its partner (2026-10-31, user: "we used
 * to have this option that we were able to connect the store to a user… create
 * a new store or link existing store… that user becomes a partner").
 *
 * Two doors, one dialog:
 *   · the Vendors tab: nothing chosen yet — the person, then a NEW store made
 *     for them or an EXISTING one with no partner (the application approval's
 *     two choices, without needing an application);
 *   · a store's own page: the store is that one — only the person is asked.
 *
 * The person is found by email as it is typed. Somebody who already has an
 * account keeps it, and keeps a password they chose (the API's rule — it is
 * said here before they press anything, not discovered after); a new email
 * makes a new account and needs a name.
 */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function LinkPartnerDialog({ open, store, onClose }: {
  open: boolean;
  /** Fixed when opened from a store's page. */
  store?: { id: string; name: string };
  onClose: () => void;
}) {
  if (!open) return null;
  // Remounted per opening, so nothing typed last time leaks into the next.
  return <Dialog store={store} onClose={onClose} />;
}

function Dialog({ store, onClose }: { store?: { id: string; name: string }; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const link = useLinkPartner();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [storeMode, setStoreMode] = useState<'new' | 'existing'>('new');
  const [storeName, setStoreName] = useState('');
  const [storePhone, setStorePhone] = useState('');
  const [storeId, setStoreId] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<AdminLinkPartnerResult | null>(null);

  const emailReady = EMAIL.test(email.trim());
  const { data: lookup, isFetching: looking, isError: lookupFailed } = useAdminUserLookup(
    { email: emailReady ? email.trim().toLowerCase() : undefined },
    emailReady,
  );
  const existing = emailReady ? lookup?.email ?? null : null;
  // A failed lookup reads as "no account": the name is asked for, and the API
  // finds the account anyway if there is one (it ignores the name then).
  const known = emailReady && !looking && (lookup !== undefined || lookupFailed);
  const blocked = existing?.status === 'blocked';
  const keepsPassword = existing?.access === 'own';

  const { data: linkableData, isLoading: linkableLoading } = useLinkableStores(!store && storeMode === 'existing');
  const linkable = linkableData?.items ?? [];

  const storeOk = store ? true : storeMode === 'new' ? storeName.trim().length > 0 : !!storeId;
  const personOk = known && !blocked && (!!existing || name.trim().length > 0);
  const canSubmit = personOk && storeOk && !link.isPending;

  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    link.mutate(
      {
        user: { name: existing ? '' : name.trim(), email: email.trim().toLowerCase() },
        ...(store
          ? { store_id: store.id }
          : storeMode === 'existing'
            ? { store_id: storeId }
            : { store: { name: storeName.trim(), contact_phone: storePhone.trim() || null } }),
        send_email: sendEmail,
      },
      {
        onSuccess: setDone,
        onError: (e) => setError(e instanceof Error ? e.message : String(e)),
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-partner-title"
        className="bg-card rounded-2xl shadow-modal w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${done ? 'bg-success-bg text-success' : 'bg-brand-mist text-brand'}`}>
            {done ? <Check size={18} strokeWidth={2} /> : <UserPlus size={18} strokeWidth={1.75} />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="link-partner-title" className="text-base font-bold font-display text-ink">
              {done
                ? t('partners.link.doneTitle', '{{name}} now manages {{store}}', { name: existing?.name || name.trim() || done.login_email, store: done.store_name })
                : store
                  ? t('partners.link.titleStore', 'Give {{store}} a partner', { store: store.name })
                  : t('partners.link.title', 'Add a partner')}
            </h2>
            <p className="text-[13px] font-body text-gray mt-1">
              {done
                ? t('partners.link.doneBody', 'They manage it from Cesto Shop: they sign in, then choose "Manage store".')
                : t('partners.link.body', 'The person you choose manages the store from Cesto Shop — its products, its orders and its details.')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', 'Close')}
            className="w-8 h-8 rounded-lg text-gray hover:text-ink hover:bg-surface-linen grid place-items-center shrink-0"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {done ? (
          <>
            {done.temp_password ? (
              <IssuedLogin
                className="mt-4"
                loginEmail={done.login_email}
                password={done.temp_password}
                emailSent={done.email_sent}
                reason={done.reason}
              />
            ) : (
              <div className="mt-4 rounded-xl border border-border bg-surface-cream p-3 text-[13px] font-body text-ink space-y-1.5">
                <p>{t('partners.link.keptDone', 'They sign in with the password they already use — it has not changed.')}</p>
                <p className={done.email_sent ? 'text-brand' : 'text-gray'}>
                  {done.email_sent
                    ? t('partners.link.toldByEmail', 'We emailed {{email}} to say they now manage the store.', { email: done.login_email })
                    : t('partners.link.notTold', 'No email went out, so let them know yourself.')}
                </p>
              </div>
            )}
            {done.store_created && (
              <p className="mt-3 text-[12.5px] font-body text-gray inline-flex items-start gap-1.5">
                <Info size={14} strokeWidth={2} className="shrink-0 mt-0.5 text-brand" />
                {t('partners.link.draftNote', '{{store}} is a draft, hidden from customers. Finish its details and publish it on its page when it is ready.', { store: done.store_name })}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2 mt-5">
              {!store && (
                <button
                  type="button"
                  onClick={() => { onClose(); navigate(`/stores/${done.store_id}/edit`); }}
                  className="h-11 px-4 rounded-xl border-2 border-border text-sm font-semibold font-display text-ink hover:border-brand transition-colors inline-flex items-center gap-1.5"
                >
                  <StoreIcon size={15} strokeWidth={1.75} />
                  {t('partners.link.openStore', 'Open the store')}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="h-11 px-5 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display transition-colors"
              >
                {t('common.done', 'Done')}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* ─── The person ─────────────────────────────── */}
            <div className="mt-5 space-y-3">
              <div>
                <TextField
                  label={t('partners.link.email', 'Their email')}
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  placeholder="nombre@tienda.es"
                  hint={t('partners.link.emailHint', 'It is their login. An account with this email is used; otherwise one is made.')}
                  trailing={emailReady && looking ? <Loader2 size={15} strokeWidth={2} className="animate-spin text-muted" /> : undefined}
                />
                {known && existing && (
                  <div className={`mt-2 rounded-lg border p-2.5 flex items-start gap-2 ${blocked ? 'bg-danger-bg border-danger/20' : 'bg-brand-whisper border-brand-mist'}`}>
                    {blocked
                      ? <AlertTriangle size={14} strokeWidth={2} className="text-danger shrink-0 mt-0.5" />
                      : <Info size={14} strokeWidth={2} className="text-brand shrink-0 mt-0.5" />}
                    <div className="min-w-0 text-xs">
                      <p className={`font-medium ${blocked ? 'text-danger' : 'text-ink'}`}>
                        {blocked
                          ? t('partners.link.blocked', "{{name}}'s account is blocked. Unblock it before giving it a store.", { name: existing.name })
                          : t('partners.link.found', '{{name}} already has an account', { name: existing.name })}
                      </p>
                      {!blocked && (
                        <p className="text-muted mt-0.5 leading-snug">
                          {keepsPassword
                            ? t('partners.link.keepsPassword', 'They keep the password they use now — nothing about their sign-in changes.')
                            : t('partners.link.getsPassword', 'They have no password of their own yet, so a temporary one is issued.')}
                        </p>
                      )}
                      {!!existing.partner_stores?.length && (
                        <p className="text-muted mt-0.5 leading-snug">
                          {t('partners.link.alreadyManages', 'Already manages: {{stores}}', { stores: existing.partner_stores.map((s) => s.name).join(', ') })}
                        </p>
                      )}
                      <a
                        href={`/customers/${existing.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 font-semibold text-brand hover:underline"
                      >
                        {t('clients.emailExistsOpen', 'Open their page')}
                        <ExternalLink size={11} strokeWidth={2} />
                      </a>
                    </div>
                  </div>
                )}
              </div>
              {known && !existing && (
                <TextField
                  label={t('partners.link.name', 'Their name')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                  hint={t('partners.link.nameHint', 'No account has this email yet — one is made in this name, with a temporary password.')}
                />
              )}
            </div>

            {/* ─── The store (the Vendors tab only) ──────── */}
            {!store && (
              <div className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-2">
                  <span className="text-sm font-semibold font-display text-ink">{t('partners.link.store', 'Store')}</span>
                  <div className="flex w-full sm:w-auto bg-surface-cream border border-border rounded-lg p-0.5" role="tablist">
                    {(['new', 'existing'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={storeMode === m}
                        onClick={() => setStoreMode(m)}
                        className={`flex-1 sm:flex-none h-8 px-3 rounded-md text-xs font-semibold font-display whitespace-nowrap transition ${storeMode === m ? 'bg-card shadow-sm text-ink' : 'text-muted hover:text-ink'}`}
                      >
                        {m === 'new' ? t('partners.link.newStore', 'Create a new store') : t('partners.link.existingStore', 'Link an existing store')}
                      </button>
                    ))}
                  </div>
                </div>

                {storeMode === 'new' ? (
                  <div className="space-y-3">
                    <TextField
                      label={t('partners.link.storeName', 'Store name')}
                      value={storeName}
                      onChange={(e) => setStoreName(e.target.value)}
                      placeholder="Supermercado Lavapiés"
                      hint={t('partners.link.storeDraft', 'It starts as a draft, hidden from customers. You finish its details and publish it on its page.')}
                    />
                    <TextField
                      label={t('partners.link.storePhone', 'Store phone (optional)')}
                      type="tel"
                      value={storePhone}
                      onChange={(e) => setStorePhone(e.target.value)}
                    />
                  </div>
                ) : linkableLoading ? (
                  <p className="text-sm text-muted font-body py-3 inline-flex items-center gap-2">
                    <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                    {t('partners.link.loadingStores', 'Loading stores…')}
                  </p>
                ) : linkable.length === 0 ? (
                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-warning-bg border border-warning/30">
                    <AlertTriangle size={16} strokeWidth={1.75} className="text-warning shrink-0 mt-0.5" />
                    <p className="text-[13px] text-ink font-body">
                      {t('partners.link.noStores', 'Every store Cesto set up already has a partner. Create a new store instead — or, to move a store to somebody else, unlink its partner on the store’s page first.')}
                    </p>
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                    {linkable.map((st) => {
                      const selected = storeId === st.id;
                      return (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => setStoreId(selected ? '' : st.id)}
                          aria-pressed={selected}
                          className={`w-full text-left px-3 py-2.5 transition ${selected ? 'bg-brand-mist' : 'hover:bg-surface-cream'}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-ink font-display truncate">{st.name}</span>
                            {st.status !== 'live' && (
                              <span className="text-[11px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded-full bg-surface-linen text-muted shrink-0">
                                {st.status}
                              </span>
                            )}
                            {selected && <Check size={15} strokeWidth={2.25} className="ml-auto text-brand shrink-0" />}
                          </div>
                          {/* What they are about to inherit — a decision, not a surprise. */}
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11.5px] text-muted font-body">
                            <span>{t('partners.link.products', '{{count}} products', { count: st._count.products })}</span>
                            <span>{t('partners.link.orders', '{{count}} orders', { count: st._count.orders })}</span>
                          </div>
                          {selected && st._count.products + st._count.orders > 0 && (
                            <p className="mt-1.5 text-[11.5px] text-warning font-body">
                              {t('partners.link.inherits', 'They will manage everything already on this store.')}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ─── How they hear about it ─────────────────── */}
            <div className="mt-5">
              <Checkbox
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                label={keepsPassword
                  ? t('partners.link.emailKept', 'Email them that they now manage the store')
                  : t('partners.link.emailIssued', 'Email them how to sign in, with their temporary password')}
              />
              {!sendEmail && !keepsPassword && (
                <p className="mt-1 ml-7 text-[12px] font-body text-gray">
                  {t('partners.link.handOver', 'The temporary password is shown here once, for you to hand over.')}
                </p>
              )}
            </div>

            {error && (
              <div className="mt-4 rounded-lg bg-danger-bg border border-danger/20 px-3 py-2 text-[13px] text-danger font-display">
                {error}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={onClose}
                className="h-11 px-4 rounded-xl text-sm font-semibold font-display text-gray hover:text-ink transition-colors"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={submit}
                className="h-11 px-5 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {link.isPending && <Loader2 size={15} strokeWidth={2} className="animate-spin" />}
                {store
                  ? t('partners.link.submitStore', 'Give them the store')
                  : t('partners.link.submit', 'Add partner')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
