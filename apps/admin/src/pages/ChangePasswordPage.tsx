import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@grocery-app/shared';
import { useAdminAuthStore } from '@/stores/authStore';
import { PasswordField } from '@/components/form';
import { useToast } from '@/components/Toast';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';

interface PasswordForm {
  current: string;
  next: string;
  confirm: string;
}

/**
 * A staff member's own password.
 *
 * Two ways in. From the sidebar, to change it whenever they like. Or held here at
 * sign-in, because the password they used was chosen by somebody else: a new
 * account, a reset under Staff, a seeded row. Then nothing else in the panel opens
 * until they have picked their own, and the API refuses everything else too.
 *
 * A page of its own, outside the panel's chrome, like sign-in: when it is forced
 * there is nowhere else to go, and a sidebar would only offer places that bounce.
 */
export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const toast = useToast();
  const messages = useValidationMessages();
  const user = useAdminAuthStore((s) => s.user);
  const changePassword = useAdminAuthStore((s) => s.changePassword);
  const forced = !!user?.must_change_password;

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      current: z.string().min(1, messages.required),
      next: r.password(),
      confirm: z.string().min(1, messages.required),
    }).refine((v) => v.next === v.confirm, { path: ['confirm'], message: t('account.password.mismatch') });
  }, [messages, t]);

  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<PasswordForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { current: '', next: '', confirm: '' },
  });
  const [failure, setFailure] = useState('');

  const onSubmit = async (values: PasswordForm) => {
    setFailure('');
    const result = await changePassword(values.current, values.next);
    if (result.ok) {
      toast.success(t('account.password.done'), t('account.password.doneBody'));
      navigate('/', { replace: true });
      return;
    }
    const err = result.error;
    const code = err instanceof ApiError ? (err.data as { code?: string } | null)?.code : undefined;
    if (code === 'wrong_current_password') setError('current', { message: t('account.password.wrongCurrent') });
    else if (code === 'same_password') setError('next', { message: t('account.password.same') });
    else setFailure(err instanceof Error ? err.message : t('account.password.failed'));
  };

  return (
    <div className="min-h-screen bg-surface-linen flex items-center justify-center px-4 py-8">
      <div className="bg-card rounded-2xl shadow-float p-6 sm:p-8 w-full max-w-md">
        {!forced && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mb-4 -ml-1 h-9 px-1 inline-flex items-center gap-1.5 text-sm font-semibold font-display text-gray hover:text-ink transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={1.75} />
            {t('account.password.back')}
          </button>
        )}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-brand-mist text-brand flex items-center justify-center mb-3">
            {forced ? <ShieldCheck size={24} strokeWidth={1.75} /> : <KeyRound size={24} strokeWidth={1.75} />}
          </div>
          <h1 className="text-xl font-bold font-display text-ink">
            {forced ? t('account.password.forcedTitle') : t('account.password.title')}
          </h1>
          <p className="text-sm text-gray mt-1.5">
            {forced ? t('account.password.forcedBody') : t('account.password.body')}
          </p>
          {user?.email && <p className="text-xs text-muted mt-2 break-all">{user.email}</p>}
        </div>

        {failure && (
          <div role="alert" className="mb-4 rounded-lg bg-danger-bg border border-danger/20 px-4 py-3 text-sm text-danger font-display">
            {failure}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <PasswordField
            label={forced ? t('account.password.temporary') : t('account.password.current')}
            autoComplete="current-password"
            error={errors.current?.message}
            {...register('current')}
          />
          <PasswordField
            label={t('account.password.new')}
            autoComplete="new-password"
            hint={t('account.password.hint')}
            error={errors.next?.message}
            {...register('next')}
          />
          <PasswordField
            label={t('account.password.confirm')}
            autoComplete="new-password"
            error={errors.confirm?.message}
            {...register('confirm')}
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full h-[52px] rounded-xl bg-brand hover:bg-brand-mid text-white font-display font-semibold text-sm transition-colors disabled:opacity-60"
          >
            {isSubmitting ? t('account.password.saving') : t('account.password.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
