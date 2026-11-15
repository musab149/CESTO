import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, User, Mail, Camera, Trash2, AlertTriangle } from 'lucide-react';
import {
  useUpdateProfile,
  useUpdateAvatar,
  useDeleteAccount,
  customerUploads,
  resolveImageUrl,
} from '@grocery-app/shared';
import { useAuthStore } from '@/stores/authStore';
import { useLanguageStore } from '@/stores/languageStore';
import { TextField } from '@/components/form';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';

interface ProfileForm {
  name: string;
  email: string;
}

export default function EditProfilePage() {
  const navigate = useNavigate();
  const { t } = useLanguageStore();
  const user = useAuthStore((s) => s.user);
  const forceLogout = useAuthStore((s) => s.forceLogout);
  const messages = useValidationMessages();

  const updateProfile = useUpdateProfile();
  const updateAvatar = useUpdateAvatar();
  const deleteAccount = useDeleteAccount();

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      name: r.name({ min: 2, max: 100 }),
      // Email is optional on the profile — phone users may not have set one.
      // But if present it must be a valid address.
      email: z
        .string()
        .trim()
        .max(254, messages.tooLong(254))
        .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: messages.email })
        .optional()
        .or(z.literal('')),
    });
  }, [messages]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileForm>({
    resolver: zodResolver(schema) as unknown as Resolver<ProfileForm>,
    mode: 'onBlur',
    defaultValues: { name: user?.name ?? '', email: user?.email ?? '' },
  });

  useEffect(() => {
    if (user) reset({ name: user.name ?? '', email: user.email ?? '' });
  }, [user, reset]);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const initials = (user?.name || '').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?';

  const onSubmit = async (values: ProfileForm) => {
    setSubmitError(null);
    setSavedAt(null);
    try {
      await updateProfile.mutateAsync({
        name: values.name.trim() || undefined,
        email: values.email?.trim() || undefined,
      });
      await useAuthStore.getState().hydrate();
      setSavedAt(Date.now());
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  async function handleAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    setAvatarError(null);
    try {
      const result = await customerUploads.uploadAvatar(file);
      await updateAvatar.mutateAsync(result.url);
      await useAuthStore.getState().hydrate();
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function confirmDelete() {
    if (deleteText !== 'DELETE') {
      setDeleteError('Type DELETE in capital letters to confirm.');
      return;
    }
    setDeleteError(null);
    try {
      await deleteAccount.mutateAsync();
      forceLogout();
      navigate('/', { replace: true });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="max-w-[800px] mx-auto px-6 lg:px-10 py-8">
      <button
        onClick={() => navigate('/profile')}
        className="flex items-center gap-2 text-sm font-semibold text-muted hover:text-brand transition-colors mb-6"
      >
        <ArrowLeft size={16} />
        {t('common.back') || 'Back'}
      </button>

      <h1 className="text-3xl font-extrabold text-ink font-display mb-2">{t('profile.edit_profile') || 'Edit profile'}</h1>
      <p className="text-sm text-gray font-body mb-8">
        Update your account details. Phone is the identifier you signed up with and can't be changed here.
      </p>

      {/* Avatar */}
      <section className="bg-surface-white border border-border/60 rounded-lg p-6 mb-6">
        <h2 className="text-base font-extrabold text-ink font-display mb-4">Profile picture</h2>
        <div className="flex items-center gap-5">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-brand to-brand-mid text-white flex items-center justify-center text-xl font-bold font-display overflow-hidden border-2 border-border">
            {user?.avatar_url ? (
              <img src={resolveImageUrl(user.avatar_url, 'logo')} alt={user.name} className="w-full h-full object-cover" />
            ) : (
              <span>{initials}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleAvatar}
              className="hidden"
            />
            <button
              onClick={() => !uploadingAvatar && fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="inline-flex items-center gap-2 h-10 px-4 bg-surface-cream hover:bg-brand-mist border border-border rounded-xl text-sm font-semibold font-display text-ink transition-colors disabled:opacity-50"
            >
              <Camera size={14} strokeWidth={1.75} />
              {uploadingAvatar ? 'Uploading…' : (user?.avatar_url ? 'Change picture' : 'Upload picture')}
            </button>
            {avatarError && <p className="text-xs text-danger font-body mt-2">{avatarError}</p>}
            <p className="text-xs text-muted font-body mt-2">JPG, PNG or WebP · max 2 MB</p>
          </div>
        </div>
      </section>

      {/* Profile fields */}
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="bg-surface-white border border-border/60 rounded-lg p-6 mb-6"
        noValidate
      >
        <h2 className="text-base font-extrabold text-ink font-display mb-4">Personal details</h2>
        <div className="flex flex-col gap-5">
          <TextField
            label="Full name"
            placeholder="Your name"
            autoComplete="name"
            leadingIcon={<User size={18} strokeWidth={1.75} />}
            error={errors.name?.message}
            {...register('name')}
          />

          <TextField
            label="Email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            leadingIcon={<Mail size={18} strokeWidth={1.75} />}
            hint="Used for order receipts and account recovery."
            error={errors.email?.message}
            {...register('email')}
          />

          {user?.phone && (
            <div>
              <label className="block text-[13px] font-semibold text-charcoal font-display mb-2">Phone</label>
              <input
                type="text"
                value={user.phone}
                disabled
                className="w-full h-[52px] px-4 bg-surface-cream border-2 border-border rounded-xl text-[15px] text-muted font-ui cursor-not-allowed"
              />
            </div>
          )}

          {submitError && (
            <p className="text-sm text-danger font-body bg-danger-bg rounded-xl p-3">{submitError}</p>
          )}
          {savedAt && (
            <p className="text-sm text-success font-body bg-success-bg rounded-xl p-3">Saved.</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigate('/profile')}
              className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isDirty || isSubmitting}
              className="h-11 px-6 rounded-xl text-sm font-bold font-display bg-brand text-white hover:bg-brand-mid transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? '…' : 'Save changes'}
            </button>
          </div>
        </div>
      </form>

      {/* Danger zone */}
      <section className="bg-danger-bg/30 border border-danger/20 rounded-lg p-6">
        <h2 className="text-base font-extrabold text-danger font-display mb-2">Danger zone</h2>
        <p className="text-sm text-charcoal font-body mb-4">
          Deleting your account is permanent. If you have past orders, your personal info will be anonymized but the orders will be kept for legal records.
        </p>
        <button
          onClick={() => { setShowDelete(true); setDeleteText(''); setDeleteError(null); }}
          className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border-2 border-danger text-danger text-sm font-bold font-display hover:bg-danger hover:text-white transition-colors"
        >
          <Trash2 size={14} strokeWidth={1.75} />
          Delete my account
        </button>
      </section>

      {/* Delete confirmation */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDelete(false)}>
          <div className="bg-card rounded-lg p-6 shadow-modal w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-danger-bg flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} strokeWidth={1.75} className="text-danger" />
              </div>
              <div>
                <h3 className="text-lg font-bold font-display text-ink">Delete your account</h3>
                <p className="text-sm text-muted font-body mt-0.5">This can't be undone.</p>
              </div>
            </div>
            <p className="text-sm text-charcoal font-body mb-4">
              Your saved addresses and cart will be removed. If you have any past orders, your name/email/phone will be replaced with "Deleted user" so the order history stays intact for accounting.
            </p>
            <label className="block text-[13px] font-semibold text-charcoal font-display mb-1.5">
              Type <span className="font-mono font-bold">DELETE</span> to confirm
            </label>
            <input
              type="text"
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              placeholder="DELETE"
              className="w-full h-12 px-4 bg-surface-white border-2 border-border rounded-xl text-sm font-mono text-ink focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand-mist transition-all"
              autoComplete="off"
            />
            {deleteError && <p className="text-sm text-danger font-body mt-3">{deleteError}</p>}
            <div className="flex gap-3 justify-end mt-5">
              <button
                onClick={() => setShowDelete(false)}
                className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteAccount.isPending || deleteText !== 'DELETE'}
                className="h-11 px-5 rounded-xl text-sm font-bold font-display bg-danger text-white hover:bg-danger/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleteAccount.isPending ? '…' : 'Delete account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
