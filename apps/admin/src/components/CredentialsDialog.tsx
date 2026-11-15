import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Loader2, Copy, Check, AlertTriangle, X, Mail } from 'lucide-react';
import type { AdminResendCredentialsResult } from '@grocery-app/shared';

/**
 * One credential, with a copy button.
 *
 * Kin to StaffPage's TempPassword panel, kept separate rather than
 * generalised: that one shows a single secret, this shows a PAIR, and the
 * username half is not a secret at all. Two small honest components beat one
 * that takes a mode.
 */
function CopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span className="w-[74px] shrink-0 text-[11px] font-semibold font-display text-gray uppercase tracking-wide">
        {label}
      </span>
      <code className="flex-1 min-w-0 truncate rounded-lg bg-card border border-border px-3 py-2 text-sm text-ink font-mono">
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
        className="h-9 px-2.5 rounded-lg border-2 border-border text-xs font-semibold font-display text-ink hover:border-brand transition-colors inline-flex items-center gap-1.5 shrink-0"
      >
        {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}
        {copied ? t('staff.copied', 'Copied') : t('staff.copy', 'Copy')}
      </button>
    </div>
  );
}

/**
 * A login just issued: the email and the password, each with a copy button,
 * and whether it was also mailed (or why not). Shown once — the password is
 * gone after this. Also what giving somebody a store shows (partner/
 * LinkPartnerDialog), so the two read the same.
 */
export function IssuedLogin({ loginEmail, password, emailSent, reason, className = '' }: {
  loginEmail: string;
  password: string;
  emailSent: boolean;
  reason: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={`rounded-xl border border-brand/30 bg-brand-whisper p-3 space-y-2 ${className}`}>
      <CopyRow label={t('credentials.loginEmail', 'Email')} value={loginEmail} />
      <CopyRow label={t('credentials.password', 'Password')} value={password} />
      <div className="pt-1">
        {emailSent ? (
          <p className="text-[12.5px] font-body text-brand inline-flex items-center gap-1.5">
            <Check size={14} strokeWidth={2.5} />
            {t('credentials.alsoEmailed', 'Also emailed to {{email}}', { email: loginEmail })}
          </p>
        ) : (
          <p className="text-[12.5px] font-body text-warning inline-flex items-start gap-1.5">
            <AlertTriangle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
            <span>
              {t('credentials.notEmailed', 'No email went out.')}
              {reason ? ' ' + reason : ''}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Issue somebody a new login, then show it.
 *
 * NOT a ConfirmModal, which offers one confirm. This asks a question with two
 * answers — mail it, or hand it over — and then has something to show
 * afterwards, which a confirm dialog has nowhere to put.
 *
 * BOTH ANSWERS ROTATE THE PASSWORD. There is no third option that reads the
 * current one back, because it is a bcrypt hash. The dialog says so plainly:
 * an admin who thought they were only looking would otherwise lock somebody
 * out mid-round, or mid-basket.
 *
 * SHARED BY THE REP PAGE AND THE CLIENT PAGE. It was written for reps first;
 * clients needed the identical thing, and the two routes behind it now answer
 * the identical shape, so a copy would only have been a second place for the
 * warning to go stale. The WORDING comes in as props — what a rotation costs
 * a rep mid-round is not what it costs a shopper mid-basket, and each page
 * keeps its own i18n keys — while everything that is genuinely the same (the
 * two buttons, the copy rows, what to say when the mail did not go) lives
 * here under `credentials.*`.
 */
export default function CredentialsDialog({
  open, email, pending, error, issued,
  title, body, issuedTitle, issuedHint,
  onEmail, onShow, onClose,
}: {
  open: boolean;
  /** Disables the email button when absent — there is nowhere to send it. */
  email: string;
  pending: boolean;
  error: string | null;
  issued: AdminResendCredentialsResult | null;
  /** Asked before anything happens. This is where the warning belongs. */
  title: string;
  body: string;
  /** Shown once the password exists. */
  issuedTitle: string;
  issuedHint: string;
  onEmail: () => void;
  onShow: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl shadow-float w-full max-w-lg p-5 sm:p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-brand-mist text-brand grid place-items-center shrink-0">
            <KeyRound size={18} strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold font-display text-ink">
              {issued ? issuedTitle : title}
            </h2>
            <p className="text-[13px] font-body text-gray mt-1">
              {issued ? issuedHint : body}
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

        {/* ─── The credentials, once they exist ─────────── */}
        {issued && (
          <IssuedLogin
            className="mt-4"
            loginEmail={issued.login_email}
            password={issued.temp_password}
            emailSent={issued.email_sent}
            reason={issued.reason}
          />
        )}

        {error && (
          <div className="mt-4 rounded-lg bg-danger-bg border border-danger/20 px-3 py-2 text-[13px] text-danger font-display">
            {error}
          </div>
        )}

        {/* ─── The two answers, or the way out ──────────── */}
        <div className="flex flex-wrap items-center justify-end gap-2 mt-5">
          {issued ? (
            <button
              type="button"
              onClick={onClose}
              className="h-11 px-5 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display transition-colors"
            >
              {t('common.done', 'Done')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="h-11 px-4 rounded-xl text-sm font-semibold font-display text-gray hover:text-ink transition-colors"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              {/* Secondary by weight, not by usefulness. Emailing is what an
                  admin at a desk reaches for; this is what they reach for
                  when the mail is the thing that failed. */}
              <button
                type="button"
                disabled={pending}
                onClick={onShow}
                className="h-11 px-4 rounded-xl border-2 border-border text-sm font-semibold font-display text-ink hover:border-brand transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Copy size={15} strokeWidth={1.75} />
                {t('credentials.issueOnly', 'Issue and show me')}
              </button>
              <button
                type="button"
                disabled={pending || !email}
                onClick={onEmail}
                className="h-11 px-5 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {pending
                  ? <Loader2 size={15} strokeWidth={2} className="animate-spin" />
                  : <Mail size={15} strokeWidth={1.75} />}
                {t('credentials.issueAndEmail', 'Email it to them')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
