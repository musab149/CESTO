import { Check, AlertTriangle } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';

export type PricingModeSwitch = {
  mode: 'retail' | 'b2b';
  phase: 'working' | 'done' | 'error';
};

/**
 * Status dialog for the Regular ↔ Business price switch.
 *
 * The switch rewrites every price in the catalogue, so it is not instant: the
 * POST lands, then eight query caches refetch. Before this, the only feedback
 * was the toggle going disabled, which read as the app hanging — and the
 * moment it re-enabled, prices on screen could still be the old ones.
 *
 * So it is deliberately blocking, and it holds after finishing rather than
 * closing itself. A dialog that vanishes on its own leaves you unsure whether
 * what you are now looking at is the new number or the old one; dismissing it
 * yourself makes the reveal the thing you asked for.
 */
export default function PricingModeDialog({
  state, onClose, onRetry,
}: {
  state: PricingModeSwitch;
  onClose: () => void;
  onRetry: () => void;
}) {
  const { lang } = useLanguageStore();
  const label = (en: string, es: string) => (lang === 'en' ? en : es);
  const toBusiness = state.mode === 'b2b';

  const heading =
    state.phase === 'error'
      ? label('Prices did not change', 'No se cambiaron los precios')
      : state.phase === 'done'
        ? toBusiness
          ? label('Business prices are on', 'Precios de empresa activados')
          : label('Regular prices are on', 'Precios normales activados')
        : toBusiness
          ? label('Switching to business prices', 'Cambiando a precios de empresa')
          : label('Switching to regular prices', 'Cambiando a precios normales');

  const body =
    state.phase === 'error'
      ? label('Check your connection and try again. Your prices are unchanged.',
              'Revisa tu conexión e inténtalo de nuevo. Tus precios no han cambiado.')
      : state.phase === 'done'
        ? toBusiness
          ? label('Every product now shows your wholesale price.',
                  'Cada producto muestra ahora tu precio mayorista.')
          : label('Every product now shows the regular price.',
                  'Cada producto muestra ahora el precio normal.')
        : label('Updating the price on every product in the catalogue.',
                'Actualizando el precio de cada producto del catálogo.');

  const working = state.phase === 'working';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-veil/50 backdrop-blur-[2px]"
        // No dismiss while the catalogue is mid-refetch — leaving at that
        // point is exactly the ambiguity this dialog exists to remove.
        onClick={working ? undefined : onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-busy={working}
        aria-labelledby="pricing-mode-heading"
        className="relative w-full max-w-[400px] bg-surface-cream rounded-2xl shadow-float p-6 flex flex-col items-center text-center"
      >
        <span className="w-14 h-14 rounded-full flex items-center justify-center mb-4 shrink-0"
              style={{ background: state.phase === 'error' ? '#FDE7E1' : '#E8F5EC' }}>
          {working ? (
            <span className="w-7 h-7 rounded-full border-2 border-brand/25 border-t-brand animate-spin" />
          ) : state.phase === 'done' ? (
            <Check size={26} strokeWidth={1.75} className="text-success" />
          ) : (
            <AlertTriangle size={24} strokeWidth={1.75} className="text-danger" />
          )}
        </span>

        <h2
          id="pricing-mode-heading"
          className="font-display text-[19px] text-ink tracking-tight leading-tight"
          style={{ fontWeight: 700 }}
        >
          {heading}
        </h2>
        <p className="text-[13px] text-gray font-body leading-snug mt-1.5" aria-live="polite">
          {body}
        </p>

        {state.phase === 'done' && (
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="w-full min-h-[52px] mt-5 rounded-xl bg-brand text-white text-[14px] font-ui font-bold hover:bg-brand-deepest active:bg-brand-deepest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            {label('See the new prices', 'Ver los nuevos precios')}
          </button>
        )}

        {state.phase === 'error' && (
          <div className="w-full flex flex-col gap-2 mt-5">
            <button
              type="button"
              autoFocus
              onClick={onRetry}
              className="w-full min-h-[52px] rounded-xl bg-brand text-white text-[14px] font-ui font-bold hover:bg-brand-deepest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              {label('Try again', 'Intentar de nuevo')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[44px] rounded-xl text-[13px] font-ui font-semibold text-gray hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {label('Close', 'Cerrar')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
