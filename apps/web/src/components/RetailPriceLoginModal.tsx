import { LogIn } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * Shown when a business account taps "Regular" on the price toggle. Regular
 * prices only exist on a separate customer account, so there is nothing to
 * switch here — the only way in is to log out and sign in as a customer.
 * Same hand-rolled modal chrome as PricingModeDialog (no shared Modal
 * primitive in this codebase).
 */
export default function RetailPriceLoginModal({
  open, onCancel, onLogin,
}: {
  open: boolean;
  onCancel: () => void;
  onLogin: () => void;
}) {
  const { lang } = useLanguageStore();
  const label = (en: string, es: string) => (lang === 'en' ? en : es);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-veil/50 backdrop-blur-[2px]" onClick={onCancel} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="retail-login-heading"
        className="relative w-full max-w-[400px] bg-surface-cream rounded-2xl shadow-float p-6 flex flex-col items-center text-center"
      >
        <span
          className="w-14 h-14 rounded-full flex items-center justify-center mb-4 shrink-0"
          style={{ background: 'var(--color-surface-mint)' }}
        >
          <LogIn size={24} strokeWidth={1.75} className="text-brand" />
        </span>

        <h2
          id="retail-login-heading"
          className="font-display text-[19px] text-ink tracking-tight leading-tight"
          style={{ fontWeight: 700 }}
        >
          {label('Log in to a customer account', 'Inicia sesión con una cuenta de cliente')}
        </h2>
        <p className="text-[13px] text-gray font-body leading-snug mt-1.5">
          {label(
            "Regular prices aren't available on a business account. Continuing will log you out so you can sign in with a customer account.",
            'Los precios normales no están disponibles en una cuenta de empresa. Si continúas, cerraremos tu sesión para que puedas iniciar sesión con una cuenta de cliente.',
          )}
        </p>

        <div className="w-full flex flex-col gap-2 mt-5">
          <button
            type="button"
            autoFocus
            onClick={onLogin}
            className="w-full min-h-[52px] rounded-xl bg-brand text-white text-[14px] font-ui font-bold hover:bg-brand-deepest active:bg-brand-deepest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            {label('Log in', 'Iniciar sesión')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full min-h-[44px] rounded-xl text-[13px] font-ui font-semibold text-gray hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {label('Cancel', 'Cancelar')}
          </button>
        </div>
      </div>
    </div>
  );
}
