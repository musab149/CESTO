import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, KeyRound, Check, AlertCircle } from 'lucide-react';
import { ApiError, useChangePassword } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import { PasswordField } from '@/components/form';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';

interface ChangePwForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguageStore();
  const changePw = useChangePassword();
  const messages = useValidationMessages();
  const hydrateAuth = useAuthStore((s) => s.hydrate);

  // Where to go once the password is rotated. Two callers, two conventions:
  //   · PartnerProtectedRoute bounces here with router state {from}
  //   · LoginPage forwards its post-login target as ?next=
  // Read both — honouring only one is why the login path's `next` was being
  // silently dropped.
  const nextParam = new URLSearchParams(location.search).get('next');
  const returnTo = (location.state as { from?: string } | null)?.from ?? nextParam;

  const schema = useMemo(() => {
    const r = rules(messages);
    return z
      .object({
        currentPassword: z.string().min(1, messages.required),
        newPassword:     r.password({ min: 8, strong: true }),
        confirmPassword: z.string().min(1, messages.required),
      })
      .refine((v) => v.newPassword === v.confirmPassword, {
        path: ['confirmPassword'],
        message: messages.passwordMatch,
      })
      .refine((v) => v.currentPassword !== v.newPassword, {
        path: ['newPassword'],
        message: messages.passwordSame,
      });
  }, [messages]);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePwForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const newPassword = watch('newPassword');
  const meetsLength = (newPassword?.length ?? 0) >= 8;
  const meetsUpper = /[A-Z]/.test(newPassword ?? '');
  const meetsNumber = /[0-9]/.test(newPassword ?? '');

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const onSubmit = async (values: ChangePwForm) => {
    setSubmitError(null);
    setSavedAt(null);
    try {
      await changePw.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setSavedAt(Date.now());

      // Re-read /api/users/me so the store drops `password_is_temp`.
      //
      // The server clears it on a successful change, but the auth store is
      // persisted Zustand state and was never refreshed here — so a partner
      // who had just rotated an admin-issued temp password still looked
      // temp-flagged to PartnerProtectedRoute, which bounced them straight
      // back to this page. "Manage store" appeared to do nothing and the
      // only escape was a full reload (boot-time hydrate). Same trap applied
      // to the B2B forced-rotation flow.
      await hydrateAuth();

      if (returnTo) navigate(returnTo, { replace: true });
    } catch (err) {
      const code = err instanceof ApiError ? (err.data as { code?: string } | null)?.code : undefined;
      setSubmitError(
        code === 'wrong_current_password' ? t('password.wrongCurrent')
        : err instanceof Error ? err.message
        : 'Could not change password',
      );
    }
  };

  return (
    <div className="max-w-[640px] mx-auto px-6 lg:px-10 py-8">
      <button
        onClick={() => navigate('/profile')}
        className="flex items-center gap-2 text-sm font-semibold text-muted hover:text-brand transition-colors mb-6"
      >
        <ArrowLeft size={16} />
        {t('common.back') || 'Back'}
      </button>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-brand-mist flex items-center justify-center">
          <KeyRound size={22} strokeWidth={1.75} className="text-brand-ink" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-ink font-display">{t('password.title')}</h1>
          <p className="text-xs text-gray font-body mt-0.5">{t('password.requirements')}</p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="bg-surface-white border border-border/60 rounded-lg p-6 space-y-5"
        noValidate
      >
        <PasswordField
          label={t('password.current')}
          autoComplete="current-password"
          hideLockIcon
          error={errors.currentPassword?.message}
          {...register('currentPassword')}
        />

        <div>
          <PasswordField
            label={t('password.new')}
            autoComplete="new-password"
            hideLockIcon
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />
          {newPassword && newPassword.length > 0 && !errors.newPassword && (
            <ul className="mt-2 space-y-1 text-[12px] font-body">
              <Requirement ok={meetsLength} label="≥ 8 characters" />
              <Requirement ok={meetsUpper} label="One uppercase letter" />
              <Requirement ok={meetsNumber} label="One number" />
            </ul>
          )}
        </div>

        <PasswordField
          label={t('password.confirm')}
          autoComplete="new-password"
          hideLockIcon
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        {submitError && (
          <div className="bg-danger-bg border border-danger/30 rounded-xl px-4 py-3 flex items-start gap-2">
            <AlertCircle size={16} className="text-danger shrink-0 mt-0.5" />
            <p className="text-sm text-danger font-body">{submitError}</p>
          </div>
        )}

        {savedAt && (
          <div className="bg-brand-mist border border-brand-soft/50 rounded-xl px-4 py-3 flex items-center gap-2">
            <Check size={16} className="text-brand-ink" />
            <p className="text-sm text-brand-ink font-body font-semibold">{t('password.saved')}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full h-12 bg-brand text-white rounded-xl text-sm font-bold font-display hover:bg-brand-mid transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? '…' : t('password.save')}
        </button>
      </form>
    </div>
  );
}

function Requirement({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-1.5 ${ok ? 'text-brand-ink' : 'text-muted'}`}>
      {ok ? <Check size={12} strokeWidth={2.5} /> : <span className="w-1.5 h-1.5 rounded-full bg-muted/40" />}
      {label}
    </li>
  );
}
