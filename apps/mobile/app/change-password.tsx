import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, KeyRound, Check, AlertCircle } from 'lucide-react-native';
import { useChangePassword } from '@grocery-app/shared';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import { useAuthStore } from '../src/stores/authStore';
import { useValidationMessages } from '../src/lib/validation/messages';
import { rules } from '../src/lib/validation/rules';
import { ControlledPasswordField } from '../src/lib/validation/formHelpers';

interface ChangePwForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { t } = useLanguageStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const changePw = useChangePassword();
  const messages = useValidationMessages();

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
    control, handleSubmit, reset,
    formState: { isSubmitting },
  } = useForm<ChangePwForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const newPassword = useWatch({ control, name: 'newPassword' }) ?? '';
  const meetsLength = newPassword.length >= 8;
  const meetsUpper = /[A-Z]/.test(newPassword);
  const meetsNumber = /[0-9]/.test(newPassword);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(false);

  if (!isAuthenticated) {
    router.replace('/(auth)/login');
    return null;
  }

  const onSubmit = async (values: ChangePwForm) => {
    setSubmitError(null);
    setSavedAt(false);
    try {
      await changePw.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setSavedAt(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not change password');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' }}>
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.ink }}>
          {t('password.title')}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center' }}>
            <KeyRound size={22} color={colors.brand.deepest} strokeWidth={1.75} />
          </View>
          <Text style={{ flex: 1, fontSize: 13, color: colors.gray, lineHeight: 18 }}>
            {t('password.requirements')}
          </Text>
        </View>

        <View style={{ backgroundColor: colors.surface.cream, borderRadius: 8, padding: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)' }}>
          <ControlledPasswordField
            control={control}
            name="currentPassword"
            label={t('password.current')}
            autoComplete="current-password"
            textContentType="password"
            hideLockIcon
          />

          <View>
            <ControlledPasswordField
              control={control}
              name="newPassword"
              label={t('password.new')}
              autoComplete="new-password"
              textContentType="newPassword"
              hideLockIcon
            />
            {newPassword.length > 0 && (
              <View style={{ marginTop: -6, marginBottom: 12, gap: 4 }}>
                <Requirement ok={meetsLength} label="≥ 8 characters" />
                <Requirement ok={meetsUpper} label="One uppercase letter" />
                <Requirement ok={meetsNumber} label="One number" />
              </View>
            )}
          </View>

          <ControlledPasswordField
            control={control}
            name="confirmPassword"
            label={t('password.confirm')}
            autoComplete="new-password"
            textContentType="newPassword"
            hideLockIcon
          />
        </View>

        {submitError && (
          <View style={{ marginTop: 12, backgroundColor: colors.dangerBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderColor: colors.danger + '30' }}>
            <AlertCircle size={16} color={colors.danger} strokeWidth={2} />
            <Text style={{ flex: 1, fontSize: 13, color: colors.danger }}>{submitError}</Text>
          </View>
        )}

        {savedAt && (
          <View style={{ marginTop: 12, backgroundColor: colors.brand.mist, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.brand.soft + '70' }}>
            <Check size={16} color={colors.brand.deepest} strokeWidth={2.25} />
            <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: colors.brand.deepest }}>
              {t('password.saved')}
            </Text>
          </View>
        )}

        <Pressable
          onPress={handleSubmit(onSubmit)}
          disabled={isSubmitting}
          style={{
            marginTop: 20, height: 52, borderRadius: 12,
            backgroundColor: isSubmitting ? colors.muted : colors.brand.DEFAULT,
            justifyContent: 'center', alignItems: 'center',
            opacity: isSubmitting ? 0.6 : 1,
          }}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
              {t('password.save')}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Requirement({ ok, label }: { ok: boolean; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {ok ? (
        <Check size={12} color={colors.brand.deepest} strokeWidth={2.5} />
      ) : (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted }} />
      )}
      <Text style={{ fontSize: 12, color: ok ? colors.brand.deepest : colors.muted }}>
        {label}
      </Text>
    </View>
  );
}
