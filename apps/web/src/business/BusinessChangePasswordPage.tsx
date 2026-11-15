import { useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Save, ShieldCheck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { authService, ApiError, BUSINESS_ME_KEY } from '@grocery-app/shared';
import { PasswordField } from '@/sales/components/form';
import { useValidationMessages } from '@/sales/lib/validation/messages';
import { rules } from '@/sales/lib/validation/rules';
import { useAuthStore } from '@/stores/authStore';
import { useBizT } from './lib/i18n';
import { useApplyBusinessTheme, useBusinessTheme } from './lib/theme';

interface Form {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

/**
 * The business panel's password screen (2026-10-29) — the rep's
 * (sales/SalesChangePasswordPage), for two cases. A rep or the office can
 * open a business's account with a temporary password: the guard sends them
 * here first, in the panel's own look rather than through the shop
 * (routeAccess businessRouteAccess). And from the account sheet, any time.
 *
 * Outside the layout: until a temporary password is rotated there is nothing
 * the sidebar could usefully link to. So it applies the panel's theme itself.
 */
export default function BusinessChangePasswordPage() {
  useApplyBusinessTheme(useBusinessTheme().resolved);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const hydrateAuth = useAuthStore((s) => s.hydrate);
  const temporary = useAuthStore((s) => !!s.user?.password_is_temp);
  const t = useBizT();
  const messages = useValidationMessages();
  const r = useMemo(() => rules(messages), [messages]);
  const from = (location.state as { from?: string } | null)?.from ?? '/business';

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
      // The guard reads `password_is_temp` off the auth store: re-read it
      // before moving, or the next route bounces straight back here.
      await hydrateAuth();
      await qc.invalidateQueries({ queryKey: BUSINESS_ME_KEY });
      navigate(from.startsWith('/business') && from !== '/business/change-password' ? from : '/business', { replace: true });
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : t('biz.pw.failed'));
    }
  };

  return (
    <div className="sales-app min-h-screen bg-surface-linen flex items-center justify-center px-4 py-10">
      <div className="bg-card rounded-2xl shadow-float p-6 sm:p-8 w-full max-w-md">
        {!temporary && (
          <button type="button" onClick={() => navigate(from)} className="-mt-2 -ml-2 mb-2 inline-flex items-center gap-1.5 h-9 px-2 rounded-lg text-[13px] font-semibold text-muted hover:text-brand hover:bg-surface-cream transition-colors">
            <ArrowLeft size={16} strokeWidth={2} />{t('biz.back')}
          </button>
        )}
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-brand text-white flex items-center justify-center shadow-card mb-4">
            <ShieldCheck size={28} strokeWidth={1.75} />
          </div>
          <h1 className="text-2xl font-bold font-display text-ink text-center">{temporary ? t('biz.pw.tempTitle') : t('biz.pw.title')}</h1>
          <p className="text-sm text-ink/60 mt-1.5 font-body text-center">{temporary ? t('biz.pw.tempBody') : t('biz.pw.body')}</p>
        </div>

        {submitError && (
          <div className="mb-4 rounded-lg bg-danger-bg border border-danger/20 px-4 py-3 text-sm text-danger font-display">{submitError}</div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <PasswordField label={t('biz.pw.current')} placeholder={temporary ? t('biz.pw.currentTempPlaceholder') : ''} autoComplete="current-password" error={errors.current_password?.message} {...register('current_password')} />
          <PasswordField label={t('biz.pw.new')} autoComplete="new-password" error={errors.new_password?.message} {...register('new_password')} />
          <PasswordField label={t('biz.pw.confirm')} autoComplete="new-password" error={errors.confirm_password?.message} {...register('confirm_password')} />
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full h-[52px] rounded-xl bg-brand hover:bg-brand-mid text-white font-display font-semibold text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? <span className="inline-block h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <><Save size={18} strokeWidth={1.75} />{t('biz.pw.save')}</>}
          </button>
        </form>
      </div>
    </div>
  );
}
