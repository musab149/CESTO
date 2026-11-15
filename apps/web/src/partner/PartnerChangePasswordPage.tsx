import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck, Save } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { authService, ApiError, PARTNER_ME_KEY } from '@grocery-app/shared';
import { PasswordField } from './components/form';
import { useAuthStore } from '@/stores/authStore';
import { useValidationMessages } from './lib/validation-messages';

interface Form {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

/**
 * Password rotate screen shown when a partner's `password_is_temp` is
 * still true — i.e. they haven't rotated the admin-issued temp password
 * yet. Same customer JWT is already in storage; we just call
 * authService.changePassword and let the API clear the flag on success.
 * After the change, the user is bounced to /partner/dashboard where
 * useCurrentPartner refetches and the gate stops firing.
 */
export default function PartnerChangePasswordPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hydrateAuth = useAuthStore((s) => s.hydrate);
  const messages = useValidationMessages();

  const schema = useMemo(() => z.object({
    current_password: z.string().min(1, messages.required),
    new_password:     z.string().min(10, 'Password must be at least 10 characters.'),
    confirm_password: z.string().min(1, messages.required),
  }).refine((v) => v.new_password === v.confirm_password, {
    message: 'Passwords do not match.',
    path:    ['confirm_password'],
  }), [messages]);

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
      // PartnerProtectedRoute reads `password_is_temp` off the AUTH STORE,
      // not React Query. Invalidating PARTNER_ME_KEY alone left the store
      // still holding the stale temp flag, so navigating to the dashboard
      // bounced straight back here and the rotation looked like it had
      // failed. Re-hydrate the store first, then move.
      await hydrateAuth();
      await qc.invalidateQueries({ queryKey: PARTNER_ME_KEY });
      navigate('/partner/dashboard', { replace: true });
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message
        : err instanceof Error ? err.message
        : 'Failed to change password.',
      );
    }
  };

  return (
    <div className="partner-app min-h-screen bg-surface-linen flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-float p-8 w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-brand text-white flex items-center justify-center shadow-card mb-4">
            <ShieldCheck size={28} strokeWidth={1.75} />
          </div>
          <h1 className="text-2xl font-bold font-display text-ink">Set a new password</h1>
          <p className="text-sm text-ink/60 mt-1 font-body text-center">
            Please choose a strong password to replace the temp one you were emailed. You&apos;ll use it to sign in from now on.
          </p>
        </div>

        {submitError && (
          <div className="mb-4 rounded-lg bg-danger-bg border border-danger/20 px-4 py-3 text-sm text-danger font-display">
            {submitError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <PasswordField
            label="Current password"
            placeholder="The one from your welcome email"
            autoComplete="current-password"
            error={errors.current_password?.message}
            {...register('current_password')}
          />
          <PasswordField
            label="New password"
            placeholder="At least 10 characters"
            autoComplete="new-password"
            error={errors.new_password?.message}
            {...register('new_password')}
          />
          <PasswordField
            label="Confirm new password"
            placeholder="Retype your new password"
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
                Save password
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
