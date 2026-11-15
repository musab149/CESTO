import { useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck, Save } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { authService, ApiError, SALES_ME_KEY } from '@grocery-app/shared';
import { PasswordField } from './components/form';
import { useAuthStore } from '@/stores/authStore';
import { useSalesT } from './lib/i18n';
import { useValidationMessages } from './lib/validation/messages';
import { rules } from './lib/validation/rules';
import { useApplySalesTheme, useSalesTheme } from './lib/theme';

interface Form {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

/**
 * Rotate screen for the temp password a rep was emailed, in SALES chrome.
 *
 * The partner surface has its own copy of this for the same reason, and the
 * reason is the whole point: the guard used to send a rep to the customer
 * /profile/change-password, which meant the one screen a rep cannot skip was
 * the storefront — navbar, search, cart, the lot — on their very first login.
 * Staff should not have to pass through the shop to start work.
 *
 * Self-contained rather than inside SalesLayout: there is nothing to navigate
 * to until the password is rotated, so a sidebar here would only offer screens
 * the guard will bounce. Outside the layout, so it puts the rep's light or
 * dark on the page itself (lib/theme), as the layout does.
 */
export default function SalesChangePasswordPage() {
  useApplySalesTheme(useSalesTheme().resolved);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const hydrateAuth = useAuthStore((s) => s.hydrate);
  const t = useSalesT();
  const messages = useValidationMessages();
  const r = useMemo(() => rules(messages), [messages]);

  // Where they were heading when the guard caught them, so rotating does not
  // also cost them their place.
  const from = (location.state as { from?: string } | null)?.from ?? '/sales';

  const schema = useMemo(() => z.object({
    current_password: z.string().min(1, messages.required),
    new_password: r.password(),
    confirm_password: z.string().min(1, messages.required),
  }).refine((v) => v.new_password === v.confirm_password, {
    message: messages.passwordMatch,
    path: ['confirm_password'],
  }), [messages, r]);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
  });

  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: Form) => {
    setSubmitError(null);
    try {
      await authService.changePassword(values.current_password, values.new_password);
      // The guard reads `password_is_temp` off the AUTH STORE, not React
      // Query, so the store has to be re-read before moving or the next route
      // bounces straight back here and the rotation looks like it failed.
      // Partner's copy learned this the hard way; same order here.
      await hydrateAuth();
      await qc.invalidateQueries({ queryKey: SALES_ME_KEY });
      navigate(from, { replace: true });
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message
        : err instanceof Error ? err.message
        : t('sales.changePassword.failed'),
      );
    }
  };

  return (
    <div className="sales-app min-h-screen bg-surface-linen flex items-center justify-center px-4 py-10">
      <div className="bg-card rounded-2xl shadow-float p-6 sm:p-8 w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-brand text-white flex items-center justify-center shadow-card mb-4">
            <ShieldCheck size={28} strokeWidth={1.75} />
          </div>
          <h1 className="text-2xl font-bold font-display text-ink text-center">
            {t('sales.changePassword.title')}
          </h1>
          <p className="text-sm text-ink/60 mt-1.5 font-body text-center">
            {t('sales.changePassword.subtitle')}
          </p>
        </div>

        {submitError && (
          <div className="mb-4 rounded-lg bg-danger-bg border border-danger/20 px-4 py-3 text-sm text-danger font-display">
            {submitError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <PasswordField
            label={t('sales.changePassword.current')}
            placeholder={t('sales.changePassword.currentPlaceholder')}
            autoComplete="current-password"
            error={errors.current_password?.message}
            {...register('current_password')}
          />
          <PasswordField
            label={t('sales.changePassword.new')}
            placeholder={t('sales.changePassword.newPlaceholder')}
            autoComplete="new-password"
            error={errors.new_password?.message}
            {...register('new_password')}
          />
          <PasswordField
            label={t('sales.changePassword.confirm')}
            placeholder={t('sales.changePassword.confirmPlaceholder')}
            autoComplete="new-password"
            error={errors.confirm_password?.message}
            {...register('confirm_password')}
          />

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full h-[52px] rounded-xl bg-brand hover:bg-brand-mid text-white font-display font-semibold text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <span className="inline-block h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Save size={18} strokeWidth={1.75} />
                {t('sales.changePassword.save')}
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
