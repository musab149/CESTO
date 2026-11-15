import { useEffect, useState } from 'react';
import { EMAIL_INPUT_PROPS } from '@/lib/emailField';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, KeyRound, Copy, Check, Loader2, UserCog } from 'lucide-react';
import {
  useAdminStaff, useCreateStaff, useUpdateStaff, useResetStaffPassword,
  type AdminStaff, type AdminRole,
} from '@grocery-app/shared';
import { useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import EmptyState from '@/components/EmptyState';
import { TableSkeleton } from '@/components/Skeleton';

const ROLES: AdminRole[] = ['super_admin', 'ops', 'catalog', 'lawyer'];

/** What each role can actually do, so the picker is not three opaque words. */
const ROLE_BLURB: Record<AdminRole, string> = {
  super_admin: 'Everything, including staff accounts, invoicing settings and permanent deletes.',
  ops: 'Day-to-day: orders, customers, riders, support.',
  catalog: 'Products, categories and content.',
  lawyer: 'Only the document archive: facturas, albaranes and bills, to read and download.',
};

function formatDate(value: string | null, lang: string): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

/**
 * The one-time password panel.
 *
 * Shown after a create or a reset and never again — the API returns it once
 * because there is no mail path for staff, so if it is lost the only way
 * forward is another reset. Hence the copy button rather than asking somebody
 * to transcribe fourteen characters.
 */
function TempPassword({ value, onDone }: { value: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-brand/30 bg-brand-whisper p-4 mb-5">
      <p className="text-sm font-semibold font-display text-ink">
        {t('staff.tempTitle', 'Temporary password')}
      </p>
      <p className="text-xs font-body text-gray mt-0.5">
        {t('staff.tempHint', 'Shown once. Hand it over now — they must change it at first sign-in.')}
      </p>
      <div className="flex items-center gap-2 mt-3">
        <code className="flex-1 min-w-0 truncate rounded-lg bg-card border border-border px-3 py-2 text-sm font-mono text-ink">
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(value).then(
              () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
              () => setCopied(false),
            );
          }}
          className="h-10 px-3 rounded-xl border-2 border-border text-sm font-semibold font-display text-ink hover:border-brand transition-colors inline-flex items-center gap-1.5 shrink-0"
        >
          {copied ? <Check size={15} strokeWidth={2} /> : <Copy size={15} strokeWidth={1.75} />}
          {copied ? t('staff.copied', 'Copied') : t('staff.copy', 'Copy')}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="h-10 px-3 rounded-xl text-sm font-semibold font-display text-gray hover:text-ink transition-colors shrink-0"
        >
          {t('common.dismiss', 'Dismiss')}
        </button>
      </div>
    </div>
  );
}

export default function StaffPage(
  { registerCreate }: { registerCreate?: (open: () => void) => void } = {},
) {
  const { t, i18n } = useTranslation();
  const toast = useToast();

  const { data, isLoading } = useAdminStaff({ limit: 100 });
  const createStaff = useCreateStaff();
  const updateStaff = useUpdateStaff();
  const resetPassword = useResetStaffPassword();

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<{ name: string; email: string; role: AdminRole }>(
    { name: '', email: '', role: 'ops' },
  );
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminStaff | null>(null);

  const rows = data?.items ?? [];

  // See RidersPage — UsersPage draws this page's add button beside the title.
  useEffect(() => { registerCreate?.(() => setCreateOpen(true)); });

  const fail = (err: unknown) => toast.error(
    t('staff.failed', 'Could not save'),
    err instanceof Error ? err.message : String(err),
  );

  const submitCreate = () => {
    createStaff.mutate(
      { name: form.name.trim(), email: form.email.trim(), role: form.role },
      {
        onSuccess: (res) => {
          setCreateOpen(false);
          setForm({ name: '', email: '', role: 'ops' });
          setTempPassword(res.temp_password);
        },
        onError: fail,
      },
    );
  };

  return (
    <div>
      {tempPassword && (
        <TempPassword value={tempPassword} onDone={() => setTempPassword(null)} />
      )}

      {isLoading ? (
        <TableSkeleton rows={4} cols={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<UserCog size={22} strokeWidth={1.75} />}
          title={t('staff.emptyTitle', 'No staff accounts')}
          description={t('staff.emptyBody', 'Add the people who need access to this panel.')}
        />
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <ul className="divide-y divide-border">
            {rows.map((s) => (
              <li key={s.id} className="p-4 sm:px-5 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold font-display text-ink truncate">
                    {s.name}
                    {!s.is_active && (
                      <span className="ml-2 text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-linen text-muted">
                        {t('staff.disabled', 'Disabled')}
                      </span>
                    )}
                    {s.password_changed_at === null && (
                      <span className="ml-2 text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-mist text-amber-deep">
                        {t('staff.mustRotate', 'Must change password')}
                      </span>
                    )}
                  </p>
                  <p className="text-xs font-mono text-gray truncate mt-0.5">{s.email}</p>
                  <p className="text-xs font-body text-muted mt-0.5">
                    {t('staff.lastLogin', 'Last sign-in')}: {formatDate(s.last_login_at, i18n.language)}
                  </p>
                </div>

                <select
                  value={s.role}
                  onChange={(e) => updateStaff.mutate(
                    { id: s.id, role: e.target.value as AdminRole },
                    { onError: fail },
                  )}
                  className="h-9 bg-surface-cream border border-border rounded-lg px-2 text-sm font-display text-ink cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand/30"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{t(`staff.role.${r}`, r)}</option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => setResetTarget(s)}
                  className="h-9 px-3 rounded-lg border border-border text-xs font-semibold font-display text-ink hover:border-brand transition-colors inline-flex items-center gap-1.5"
                >
                  <KeyRound size={14} strokeWidth={1.75} />
                  {t('staff.reset', 'Reset password')}
                </button>

                <button
                  type="button"
                  onClick={() => updateStaff.mutate(
                    { id: s.id, is_active: !s.is_active },
                    { onError: fail },
                  )}
                  className={`h-9 px-3 rounded-lg border text-xs font-semibold font-display transition-colors ${
                    s.is_active
                      ? 'border-border text-danger hover:border-danger'
                      : 'border-border text-brand hover:border-brand'
                  }`}
                >
                  {s.is_active ? t('staff.disable', 'Disable') : t('staff.enable', 'Enable')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ─── Add ──────────────────────────────────────── */}
      <ConfirmModal
        open={createOpen}
        title={t('staff.addTitle', 'Add a staff account')}
        message={t('staff.addBody', 'They sign in with this email and a generated password you hand over once.')}
        confirmLabel={createStaff.isPending ? t('staff.adding', 'Adding…') : t('staff.add', 'Add staff')}
        confirmDisabled={createStaff.isPending || !form.name.trim() || !form.email.trim()}
        onConfirm={submitCreate}
        onCancel={() => setCreateOpen(false)}
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted font-display">
              {t('staff.name', 'Name')}
            </span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1.5 w-full h-11 bg-surface-cream border border-border rounded-lg px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted font-display">
              {t('staff.email', 'Email')}
            </span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value.toLowerCase() }))}
              {...EMAIL_INPUT_PROPS}
              spellCheck={false}
              autoComplete="off"
              className="mt-1.5 w-full h-11 bg-surface-cream border border-border rounded-lg px-3 text-sm font-mono text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <span className="block text-xs font-body text-muted mt-1">
              {t('staff.emailLocked', 'This is their sign-in identity and cannot be changed later.')}
            </span>
          </label>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted font-display">
              {t('staff.roleLabel', 'Role')}
            </span>
            <div className="mt-1.5 space-y-2">
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, role: r }))}
                  className={`w-full text-left rounded-lg border-2 px-3 py-2.5 transition-colors ${
                    form.role === r ? 'border-brand bg-brand-mist/40' : 'border-border hover:border-brand/40'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold font-display text-ink">
                    {r === 'super_admin' && <ShieldCheck size={14} strokeWidth={2} className="text-brand" />}
                    {t(`staff.role.${r}`, r)}
                  </span>
                  <span className="block text-xs font-body text-gray mt-0.5">
                    {t(`staff.roleBlurb.${r}`, ROLE_BLURB[r])}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </ConfirmModal>

      {/* ─── Reset ────────────────────────────────────── */}
      <ConfirmModal
        open={!!resetTarget}
        danger
        title={t('staff.resetTitle', 'Reset this password?')}
        message={t('staff.resetBody', 'A new temporary password is generated and every active session for this account is ended. They will have to sign in again and choose a new password.')}
        confirmLabel={resetPassword.isPending
          ? t('staff.resetting', 'Resetting…')
          : t('staff.reset', 'Reset password')}
        confirmDisabled={resetPassword.isPending}
        onConfirm={() => {
          if (!resetTarget) return;
          resetPassword.mutate(resetTarget.id, {
            onSuccess: (res) => { setResetTarget(null); setTempPassword(res.temp_password); },
            onError: (err) => { setResetTarget(null); fail(err); },
          });
        }}
        onCancel={() => setResetTarget(null)}
      >
        {resetPassword.isPending && (
          <p className="text-sm text-gray inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" strokeWidth={2} />
            {t('staff.resetting', 'Resetting…')}
          </p>
        )}
      </ConfirmModal>
    </div>
  );
}
