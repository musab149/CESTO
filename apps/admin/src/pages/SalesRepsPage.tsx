import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Search, BadgeCheck, Ban, RotateCcw, Loader2, UserRound } from 'lucide-react';
import {
  useAdminSalesReps, useAdminUsers, useGrantSalesRep, useUpdateSalesRep, useAdminMe, repStoresOf,
  type AdminGrantSalesRepPayload,
} from '@grocery-app/shared';
import { TableSkeleton } from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';
import { RepShopsBadge, RepShopsField } from '@/components/salesRep/RepShopControls';

/**
 * Sales reps — the people who open accounts and build orders for them.
 *
 * SEPARATE FROM STAFF, and not the same kind of thing. Staff are Admin rows
 * with an admin login; a rep is a User carrying a role, who signs in where
 * customers do and works in the rep app. The two tabs sit side by side because
 * an admin thinks of both as "our people", but nothing is shared underneath.
 *
 * Adding one is a form, not a picker. Hiring is the common case \u2014 somebody is
 * told "you start Monday" \u2014 so a name and an email create the account, grant
 * the role and send the login in one press. Picking an existing account is
 * still there on the second tab, for the customer who applied or the B2B buyer
 * who now sells for us.
 */
export default function SalesRepsPage({
  registerCreate,
}: {
  /** Lets the Users tab's header button open this tab's own dialog. */
  registerCreate?: (fn: () => void) => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();

  const fmt = (v: string | null | undefined) => (v
    ? new Date(v).toLocaleDateString(i18n.language === 'en' ? 'en-GB' : 'es-ES',
      { day: '2-digit', month: 'short', year: 'numeric' })
    : '—');

  /**
   * Hiring and revoking are super_admin-only on the API, so the buttons for
   * them are too. An ops admin still gets the whole list and every rep's
   * page: "which of our reps sold what" is their work.
   */
  const { data: me } = useAdminMe();
  const isSuperAdmin = me?.role === 'super_admin';

  const [search, setSearch] = useState('');
  const [grantOpen, setGrantOpen] = useState(false);
  const [revoking, setRevoking] = useState<{ userId: string; name: string } | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const { data, isLoading } = useAdminSalesReps({ q: search.trim() || undefined, limit: 100 });
  const grant = useGrantSalesRep();
  const update = useUpdateSalesRep();

  useEffect(() => {
    registerCreate?.(() => setGrantOpen(true));
  }, [registerCreate]);

  const rows = data?.items ?? [];

  /**
   * WHY THESE HAVE AN onError, when they used to have only onSuccess.
   *
   * Revoke looked like it did nothing: the confirm button went disabled for
   * the length of the request, came back, and that was all — no message, and
   * the dialog stayed open, because closing it was in onSuccess.
   *
   * Nothing above catches it either. The global mutationCache.onError in
   * main.tsx only acts on 5xx, where it redirects to /500. Every 4xx — the
   * 403 from the super_admin guard, a 404 for an account that is not a rep,
   * a 409 on a duplicate staff number — fell through to silence. A refusal
   * the server took the trouble to explain was thrown away one layer below
   * the screen that needed it.
   */
  const revoke = () => {
    if (!revoking) return;
    setRevokeError(null);
    update.mutate({ userId: revoking.userId, is_active: false }, {
      onSuccess: () => {
        toast.success(
          t('salesReps.revoked', 'Access removed'),
          t('salesReps.revokedBody', '{{name}} can no longer work as a rep. Their orders and clients are untouched.', { name: revoking.name }),
        );
        setRevoking(null);
      },
      // In the DIALOG, not a toast: the dialog is still open and in front, so
      // a toast behind it is the same silence with extra steps.
      onError: (e) => setRevokeError(e instanceof Error ? e.message : String(e)),
    });
  };

  const reinstate = (userId: string, name: string) => {
    update.mutate({ userId, is_active: true }, {
      onSuccess: () => toast.success(
        t('salesReps.reinstated', 'Access restored'),
        t('salesReps.reinstatedBody', '{{name}} can sell again.', { name }),
      ),
      // No dialog on this one, so it has nowhere to go but a toast.
      onError: (e) => toast.error(
        t('salesReps.reinstateFailed', 'Could not restore their access'),
        e instanceof Error ? e.message : String(e),
      ),
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('salesReps.search', 'Search by name, email or staff number…')}
            className="w-full h-10 bg-surface-cream border border-border rounded-lg pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={4} cols={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<UserRound size={22} strokeWidth={1.75} />}
          title={t('salesReps.emptyTitle', 'No sales reps yet')}
          description={t('salesReps.emptyBody', 'A rep opens client accounts and builds orders for them. Give the role to someone who already has an account.')}
          action={isSuperAdmin
            ? { label: t('salesReps.add', 'Add sales rep'), onClick: () => setGrantOpen(true) }
            : undefined}
        />
      ) : (
        <>
        {/* ON A PHONE (2026-11-05): a list — the table needed 1162px and hid
            the shops, the counts, the status and Revoke / Reinstate off to the
            right. Same handlers; tapping a rep opens their page, as a table
            row does. The table from sm. */}
        <ul className="sm:hidden bg-card rounded-xl border border-border divide-y divide-border overflow-hidden">
          {rows.map((r) => (
            <li key={r.user_id}>
              <button
                type="button"
                onClick={() => navigate(`/sales-reps/${r.user_id}`)}
                className={`w-full text-left px-4 pt-3 ${isSuperAdmin ? 'pb-2' : 'pb-3'} hover:bg-brand-mist/30 transition-colors`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold font-display text-ink truncate">{r.name}</span>
                  {/* Both facts, as in the table: the role and the account. */}
                  {!r.is_active && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-surface-linen text-muted shrink-0">
                      {t('salesReps.revokedBadge', 'Revoked')}
                    </span>
                  )}
                  {r.account_status === 'blocked' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-danger-bg text-danger shrink-0">
                      {t('salesReps.accountBlocked', 'Account blocked')}
                    </span>
                  )}
                  <span className="ml-auto text-[11.5px] text-muted shrink-0">
                    {t('salesReps.orders', 'Orders')}{' '}
                    <span className="text-sm font-semibold text-ink tabular-nums">{r.orders_created}</span>
                  </span>
                </div>
                {r.email && (
                  <p className="text-[12.5px] text-muted truncate mt-0.5">{r.email}</p>
                )}
                {/* The shops they sell from; none means no orders. */}
                <div className="text-[12.5px] mt-1 min-w-0">
                  <RepShopsBadge stores={repStoresOf(r)} assigned={r.assigned_products} />
                </div>
                <p className="text-[11.5px] text-muted mt-1">
                  {r.code && (
                    <>
                      {t('salesReps.code', 'Staff no.')} <span className="font-mono">{r.code}</span>
                      {'  ·  '}
                    </>
                  )}
                  {t('salesReps.clients', 'Clients')}{' '}
                  <span className="font-semibold text-ink tabular-nums">{r.clients_opened}</span>
                  {'  ·  '}
                  {t('salesReps.since', 'Since')} {fmt(r.granted_at)}
                </p>
              </button>
              {isSuperAdmin && (
                <div className="px-4 pb-3">
                  {r.is_active ? (
                    <button
                      type="button"
                      onClick={() => setRevoking({ userId: r.user_id, name: r.name })}
                      className="h-9 px-3 -ml-3 rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold font-display text-danger hover:bg-danger-bg transition-colors"
                    >
                      <Ban size={14} strokeWidth={2} />
                      {t('salesReps.revoke', 'Revoke')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => reinstate(r.user_id, r.name)}
                      disabled={update.isPending}
                      className="h-9 px-3 -ml-3 rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold font-display text-brand hover:bg-brand-mist/40 disabled:opacity-50 transition-colors"
                    >
                      <RotateCcw size={14} strokeWidth={2} />
                      {t('salesReps.reinstate', 'Reinstate')}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="hidden sm:block bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="bg-surface-cream">
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.name')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('salesReps.code', 'Staff no.')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.email')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('salesReps.shop.label', 'Shop')}</th>
                <th className="text-right text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('salesReps.orders', 'Orders')}</th>
                <th className="text-right text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('salesReps.clients', 'Clients')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('salesReps.since', 'Since')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.status')}</th>
                <th className="text-right text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.user_id}
                  onClick={() => navigate(`/sales-reps/${r.user_id}`)}
                  className="border-t border-border hover:bg-brand-mist/30 transition cursor-pointer"
                >
                  <td className="px-4 py-3 text-sm font-semibold font-display text-ink">{r.name}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray">{r.code || '—'}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray">{r.email || '—'}</td>
                  {/* The one shop they sell from; none means no orders. */}
                  <td className="px-4 py-3 text-sm max-w-[220px]"><RepShopsBadge stores={repStoresOf(r)} assigned={r.assigned_products} /></td>
                  <td className="px-4 py-3 text-sm text-ink text-right tabular-nums">{r.orders_created}</td>
                  <td className="px-4 py-3 text-sm text-ink text-right tabular-nums">{r.clients_opened}</td>
                  <td className="px-4 py-3 text-sm text-gray whitespace-nowrap">{fmt(r.granted_at)}</td>
                  <td className="px-4 py-3">
                    {/* TWO facts, and they can disagree: the role can be live
                        while the account behind it is blocked, and then they
                        still cannot work. Showing only one would mislead. */}
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide ${
                        r.is_active ? 'bg-success-bg text-success' : 'bg-surface-linen text-muted'
                      }`}>
                        {r.is_active
                          ? <><BadgeCheck size={11} strokeWidth={2.5} />{t('salesReps.active', 'Active')}</>
                          : t('salesReps.revokedBadge', 'Revoked')}
                      </span>
                      {r.account_status === 'blocked' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-danger-bg text-danger">
                          {t('salesReps.accountBlocked', 'Account blocked')}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {!isSuperAdmin ? null : r.is_active ? (
                      <button
                        type="button"
                        onClick={() => setRevoking({ userId: r.user_id, name: r.name })}
                        className="h-8 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold font-display text-danger hover:bg-danger-bg transition-colors"
                      >
                        <Ban size={13} strokeWidth={2} />
                        {t('salesReps.revoke', 'Revoke')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => reinstate(r.user_id, r.name)}
                        disabled={update.isPending}
                        className="h-8 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold font-display text-brand hover:bg-brand-mist/40 disabled:opacity-50 transition-colors"
                      >
                        <RotateCcw size={13} strokeWidth={2} />
                        {t('salesReps.reinstate', 'Reinstate')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Mounted only while open, so opening it IS the reset — no effect
          clearing eight fields, and no way for one of them to be forgotten. */}
      {grantOpen && (
      <GrantDialog
        onClose={() => setGrantOpen(false)}
        onSubmit={(payload) => grant.mutate(payload, {
          onSuccess: (r) => {
            /**
             * Three outcomes, and the admin has to be told which one they got.
             * "Sales rep added" over an account that already existed sends them
             * looking for a welcome email that was never due, and over a failed
             * send it loses the one fact they need to act on.
             */
            const body = r.credentials_sent
              ? t('salesReps.grantedEmailed', '{{name}} can now open clients and build orders. Their login is on its way by email.', { name: r.name })
              : r.account_created === false
                ? t('salesReps.grantedExisting', '{{name}} already had a Cesto account, so we used it. They sign in with the password they already have.', { name: r.name })
                : t('salesReps.grantedNoEmail', '{{name}} can now open clients and build orders. No email went out \u2014 send them their login from their profile.', { name: r.name });
            toast.success(t('salesReps.granted', 'Sales rep added'), body);
            setGrantOpen(false);
          },
          onError: (e) => toast.error(
            t('salesReps.grantFailed', 'Could not add them'),
            e instanceof Error ? e.message : String(e),
          ),
        })}
        isPending={grant.isPending}
      />
      )}

      <ConfirmModal
        open={!!revoking}
        danger
        title={t('salesReps.revokeTitle', 'Remove sales access?')}
        message={t('salesReps.revokeBody', '{{name}} stops being able to open clients or build orders. Their account stays, and every order and client they already created keeps pointing at them.', { name: revoking?.name ?? '' })}
        confirmLabel={t('salesReps.revoke', 'Revoke')}
        cancelLabel={t('common.cancel', 'Cancel')}
        confirmDisabled={update.isPending}
        onConfirm={revoke}
        onCancel={() => { setRevoking(null); setRevokeError(null); }}
      >
        {revokeError && (
          <div className="rounded-lg bg-danger-bg border border-danger/20 px-3 py-2 text-[13px] text-danger font-display">
            {revokeError}
          </div>
        )}
      </ConfirmModal>
    </div>
  );
}

/**
 * Adding a rep. Two ways, and they are not equally likely.
 *
 * HIRING IS THE DEFAULT. Somebody is told "you start Monday" and needs a
 * login — that is the common case, so the form is what opens, and one press
 * makes the account, grants the role and emails the credentials. It used to
 * mean leaving for the client-create screen, making an account, coming back
 * and searching for it: two screens and a search for one decision.
 *
 * Assigning an existing account is the second tab, kept because it is
 * genuinely a different situation — a customer who applied, a B2B buyer who
 * now sells for us — and creating a second account for someone who already has
 * one is the worse mistake.
 *
 * The two tabs are a convenience, not a correctness boundary. An email typed
 * into the hiring form that already has an account resolves server-side to the
 * account that is there: nothing is duplicated and nobody's password is reset.
 * The admin is told which happened rather than being asked to know in advance.
 */
function GrantDialog({
  onClose, onSubmit, isPending,
}: {
  onClose: () => void;
  onSubmit: (payload: AdminGrantSalesRepPayload) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'create' | 'assign'>('create');

  // Create
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [sendCredentials, setSendCredentials] = useState(true);
  const [touched, setTouched] = useState(false);

  // Assign
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);

  // Both
  const [code, setCode] = useState('');
  /** '' = none yet; they cannot build orders until one is assigned. */
  const [shopIds, setShopIds] = useState<string[]>([]);

  const { data, isLoading } = useAdminUsers(
    // Only on the assign tab: the hiring form is the default, and a user
    // search behind a tab nobody opened is a request nobody asked for.
    { q: q.trim() || undefined, limit: 8 },
    { enabled: mode === 'assign' },
  );

  const emailLooksRight = /.+@.+\..+/.test(email.trim());
  const createReady = name.trim() !== '' && emailLooksRight;
  const canSubmit = mode === 'create' ? createReady : !!picked;

  const submit = () => {
    setTouched(true);
    if (!canSubmit) return;
    onSubmit(mode === 'create'
      ? {
        name: name.trim(),
        email: email.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        code: code.trim() || null,
        send_credentials: sendCredentials,
        ...(shopIds.length ? { store_ids: shopIds } : {}),
      }
      : { user_id: picked!.id, code: code.trim() || null, ...(shopIds.length ? { store_ids: shopIds } : {}) });
  };

  const tab = (value: 'create' | 'assign', label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setMode(value)}
      className={`h-9 px-3.5 rounded-lg text-sm font-semibold font-display transition-colors ${
        mode === value ? 'bg-brand text-white' : 'text-gray hover:bg-surface-linen'
      }`}
    >
      {label}
    </button>
  );

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts: { type?: string; placeholder?: string; required?: boolean; note?: string; autoFocus?: boolean } = {},
  ) => {
    const invalid = opts.required && touched && value.trim() === '';
    return (
      <label className="block">
        <span className="block text-[11px] font-display uppercase tracking-wider text-muted mb-1">
          {label}{opts.required && <span className="text-danger"> *</span>}
        </span>
        <input
          type={opts.type ?? 'text'}
          value={value}
          autoFocus={opts.autoFocus}
          placeholder={opts.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full h-10 px-3 rounded-lg bg-card border text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 ${
            invalid ? 'border-danger' : 'border-border'
          }`}
        />
        {opts.note && <span className="block text-[11.5px] text-muted mt-1">{opts.note}</span>}
      </label>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="shrink-0 px-5 py-4 border-b border-border">
          <h3 className="text-lg font-bold font-display text-ink">
            {t('salesReps.add', 'Add sales rep')}
          </h3>
          <div className="flex items-center gap-1 mt-3 -mb-1">
            {tab('create', t('salesReps.modeCreate', 'New rep'))}
            {tab('assign', t('salesReps.modeAssign', 'Existing account'))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {mode === 'create' ? (
            <>
              <p className="text-sm text-gray">
                {t('salesReps.createBody', 'Creates the account, makes them a rep and emails them their login. If that email already has an account, we use it instead of making a second one.')}
              </p>
              {field(t('salesReps.name', 'Full name'), name, setName,
                { required: true, autoFocus: true })}
              {field(t('salesReps.email', 'Email'), email, setEmail, {
                type: 'email',
                required: true,
                note: t('salesReps.emailNote', 'Their login, and where the password goes.'),
              })}
              {field(t('salesReps.phone', 'Phone (optional)'), phone, setPhone, { type: 'tel' })}

              <label className="flex items-start gap-2.5 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={sendCredentials}
                  onChange={(e) => setSendCredentials(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-brand shrink-0"
                />
                <span className="text-sm text-gray">
                  {t('salesReps.sendCredentials', 'Email them their login details')}
                </span>
              </label>

              {touched && !createReady && (
                <p className="text-sm text-danger">
                  {email.trim() !== '' && !emailLooksRight
                    ? t('salesReps.emailInvalid', "That email doesn't look right.")
                    : t('salesReps.required', 'Fill in the name and the email.')}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-gray">
                {t('salesReps.assignBody', 'Give the role to somebody who already has a Cesto account. They keep the password they have.')}
              </p>
              <div className="relative">
                <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setPicked(null); }}
                  placeholder={t('salesReps.findUser', 'Search by name, email or phone…')}
                  className="w-full h-10 bg-card border border-border rounded-lg pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>

              {isLoading ? (
                <p className="text-sm text-muted">{t('common.loading', 'Loading…')}</p>
              ) : (
                <div className="space-y-1.5">
                  {(data?.items ?? []).map((u) => {
                    const active = picked?.id === u.id;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => setPicked({ id: u.id, name: u.name })}
                        className={`w-full text-left rounded-xl border-2 p-3 transition-colors ${
                          active ? 'border-brand bg-brand-whisper' : 'border-border hover:border-brand/40'
                        }`}
                      >
                        <span className="block text-sm font-semibold text-ink">{u.name}</span>
                        <span className="block text-xs text-muted font-mono mt-0.5">
                          {u.email || u.phone || '—'}
                        </span>
                      </button>
                    );
                  })}
                  {q.trim() !== '' && (data?.items ?? []).length === 0 && (
                    <p className="text-sm text-muted">{t('salesReps.noMatch', 'Nobody matches that.')}</p>
                  )}
                </div>
              )}
            </>
          )}

          <label className="block pt-1">
            <span className="block text-[11px] font-display uppercase tracking-wider text-muted mb-1">
              {t('salesReps.codeOptional', 'Staff number (optional)')}
            </span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="EMP-001"
              className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>

          {/* Not a <label>: the Combobox's own button would get the forwarded click and reopen. */}
          <div className="pt-1">
            <p className="block text-[11px] font-display uppercase tracking-wider text-muted mb-1">
              {t('salesReps.shop.optional', 'Shops (optional)')}
            </p>
            <RepShopsField value={shopIds} onChange={setShopIds} />
            <p className="text-[11.5px] text-muted mt-1">
              {shopIds.length
                ? t('salesReps.shop.hint', 'They see and sell only these shops\' active products. The order is still Cesto\'s.')
                : t('salesReps.shop.noneHint', 'They cannot build orders until you assign one.')}
            </p>
          </div>
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            disabled={isPending || (mode === 'assign' && !picked)}
            onClick={submit}
            className="h-11 px-5 rounded-xl text-sm font-semibold font-display text-white bg-brand hover:bg-brand-mid disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 transition-colors"
          >
            {isPending && <Loader2 size={16} strokeWidth={2.5} className="animate-spin" />}
            {mode === 'create'
              ? t('salesReps.createAction', 'Create sales rep')
              : t('salesReps.grantAction', 'Make them a rep')}
          </button>
        </div>
      </div>
    </div>
  );
}
