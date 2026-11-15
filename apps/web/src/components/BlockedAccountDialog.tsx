import { useNavigate } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useLanguageStore } from '@/stores/languageStore';

const SUPPORT_EMAIL = 'support.cesto@gmail.com';

/**
 * Shown when the API refuses because this account has been blocked.
 *
 * Blocking someone used to be silent: their access token stayed
 * cryptographically valid for up to fifteen minutes, so they carried on
 * browsing, and then requests began failing with nothing on screen to say
 * why. The API now rejects every authenticated call the moment the block
 * lands, and this is what the customer sees.
 *
 * Not dismissable by clicking away, and with no close button: the session is
 * already over, so an X that returns you to a signed-out app pretending
 * nothing happened would be a lie. The only way out is to acknowledge it or
 * to write to support.
 */
export default function BlockedAccountDialog() {
  const notice = useAuthStore((s) => s.blockedNotice);
  const setBlockedNotice = useAuthStore((s) => s.setBlockedNotice);
  const { lang } = useLanguageStore();
  const navigate = useNavigate();
  const es = lang === 'es';

  if (notice === null) return null;

  const dismiss = () => {
    setBlockedNotice(null);
    navigate('/');
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-veil/50 backdrop-blur-[2px]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="blocked-title"
        className="w-full max-w-[440px] bg-surface-cream rounded-2xl border border-border shadow-modal p-6"
      >
        <div className="w-12 h-12 rounded-xl bg-danger-bg flex items-center justify-center mb-4">
          <ShieldOff className="w-6 h-6 text-danger" strokeWidth={1.75} />
        </div>

        <h2 id="blocked-title" className="text-xl font-bold font-display text-ink mb-2">
          {es ? 'Tu cuenta ha sido bloqueada' : 'Your account has been blocked'}
        </h2>

        <p className="text-sm font-body text-gray leading-relaxed">
          {es
            ? 'Hemos cerrado tu sesión. No podrás iniciar sesión ni hacer pedidos hasta que se resuelva.'
            : "We've signed you out. You won't be able to sign in or place orders until this is resolved."}
        </p>

        {/* The reason is whatever the admin wrote for the customer. Blocked
            with none recorded is possible on accounts blocked before reasons
            existed, so the block itself has to read sensibly without one. */}
        {notice.trim() !== '' && (
          <div className="mt-4 p-3.5 rounded-xl bg-danger-bg/60 border border-danger/20">
            <p className="text-[11px] font-display font-semibold text-danger uppercase tracking-wider mb-1">
              {es ? 'Motivo' : 'Reason'}
            </p>
            <p className="text-sm font-body text-ink leading-relaxed">{notice}</p>
          </div>
        )}

        <p className="mt-4 text-sm font-body text-gray leading-relaxed">
          {es ? 'Si crees que es un error, escríbenos a ' : 'If you think this is a mistake, write to us at '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-brand font-semibold underline underline-offset-2 break-all"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>

        <div className="flex gap-2 mt-6">
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="flex-1 h-[52px] rounded-xl border-2 border-border text-ink font-semibold font-display text-sm inline-flex items-center justify-center hover:bg-surface-linen transition-colors"
          >
            {es ? 'Contactar con soporte' : 'Contact support'}
          </a>
          <button
            type="button"
            onClick={dismiss}
            className="flex-1 h-[52px] rounded-xl bg-brand text-white font-semibold font-display text-sm hover:bg-brand-mid transition-colors"
          >
            {es ? 'Entendido' : 'I understand'}
          </button>
        </div>
      </div>
    </div>
  );
}
