/**
 * Reset password — counterpart to web's /reset-password screen.
 * Reached via the password-reset email link; expects a `token` URL param.
 */
import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, KeyRound, Check, AlertCircle } from 'lucide-react-native';
import { useResetPassword } from '@grocery-app/shared';
import { colors } from '../../src/constants/colors';
import { useValidationMessages } from '../../src/lib/validation/messages';
import { rules } from '../../src/lib/validation/rules';
import { ControlledPasswordField } from '../../src/lib/validation/formHelpers';

interface ResetForm {
  newPassword: string;
  confirmPassword: string;
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === 'string' ? params.token : '';
  const resetPw = useResetPassword();
  const messages = useValidationMessages();

  const schema = useMemo(() => {
    const r = rules(messages);
    return z
      .object({
        newPassword: r.password({ min: 8, strong: true }),
        confirmPassword: z.string().min(1, messages.required),
      })
      .refine((v) => v.newPassword === v.confirmPassword, {
        path: ['confirmPassword'],
        message: messages.passwordMatch,
      });
  }, [messages]);

  const {
    control, handleSubmit,
    formState: { isSubmitting },
  } = useForm<ResetForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const newPassword = useWatch({ control, name: 'newPassword' }) ?? '';
  const meetsLength = newPassword.length >= 8;
  const meetsUpper = /[A-Z]/.test(newPassword);
  const meetsNumber = /[0-9]/.test(newPassword);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = async (values: ResetForm) => {
    setSubmitError(null);
    try {
      await resetPw.mutateAsync({ token, newPassword: values.newPassword });
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not reset password. Try again.');
    }
  };

  if (!token) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <View style={[styles.iconBadge, { backgroundColor: colors.dangerBg }]}>
            <AlertCircle size={28} color={colors.danger} strokeWidth={1.75} />
          </View>
          <Text style={styles.title}>Reset link missing</Text>
          <Text style={styles.subtitle}>
            We couldn't find a reset token. Request a new password-reset email and try again.
          </Text>
          <TouchableOpacity
            style={styles.ctaButton}
            onPress={() => router.replace('/(auth)/forgot-password')}
            activeOpacity={0.85}
          >
            <Text style={styles.ctaButtonText}>Request new link</Text>
            <ArrowRight size={18} color="#fff" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <View style={[styles.iconBadge, { backgroundColor: colors.brand.mist, borderWidth: 2, borderColor: colors.brand.soft }]}>
            <Check size={36} color={colors.brand.DEFAULT} strokeWidth={2} />
          </View>
          <Text style={styles.title}>Password updated</Text>
          <Text style={styles.subtitle}>
            You can now sign in with your new password.
          </Text>
          <TouchableOpacity
            style={styles.ctaButton}
            onPress={() => router.replace('/(auth)/login')}
            activeOpacity={0.85}
          >
            <Text style={styles.ctaButtonText}>Go to login</Text>
            <ArrowRight size={18} color="#fff" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ArrowLeft size={22} color={colors.ink} strokeWidth={1.75} />
        </TouchableOpacity>

        <View style={[styles.iconBadge, { backgroundColor: colors.brand.mist }]}>
          <KeyRound size={28} color={colors.brand.DEFAULT} strokeWidth={1.75} />
        </View>

        <Text style={styles.title}>Set a new password</Text>
        <Text style={styles.subtitle}>
          Use at least 8 characters, including one uppercase letter and one number.
        </Text>

        <View>
          <ControlledPasswordField
            control={control}
            name="newPassword"
            label="New password"
            placeholder="Enter new password"
            autoComplete="new-password"
            // No lock icon — the screen-level KeyRound badge already telegraphs context.
            hideLockIcon={false}
          />
          {newPassword.length > 0 && (
            <View style={{ marginTop: -6, marginBottom: 12, gap: 4 }}>
              <Requirement ok={meetsLength} label="At least 8 characters" />
              <Requirement ok={meetsUpper} label="Includes an uppercase letter" />
              <Requirement ok={meetsNumber} label="Includes a number" />
            </View>
          )}
        </View>

        <ControlledPasswordField
          control={control}
          name="confirmPassword"
          label="Confirm password"
          placeholder="Re-enter new password"
          autoComplete="new-password"
        />

        {submitError && (
          <View style={styles.errorBanner}>
            <AlertCircle size={16} color={colors.danger} strokeWidth={2} />
            <Text style={styles.errorText}>{submitError}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.ctaButton, isSubmitting && styles.ctaButtonDisabled]}
          onPress={handleSubmit(onSubmit)}
          disabled={isSubmitting}
          activeOpacity={0.85}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.ctaButtonText}>Reset password</Text>
              <ArrowRight size={18} color="#fff" strokeWidth={2.25} />
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={{ alignSelf: 'center', marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          onPress={() => router.replace('/(auth)/login')}
        >
          <ArrowLeft size={14} color={colors.brand.DEFAULT} strokeWidth={2} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: colors.brand.DEFAULT }}>Back to login</Text>
        </TouchableOpacity>
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
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted, marginLeft: 3, marginRight: 3 }} />
      )}
      <Text style={{ fontSize: 12, color: ok ? colors.brand.deepest : colors.muted }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface.linen },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 32 },
  backButton: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surface.cream,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  iconBadge: {
    width: 72, height: 72, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 26, fontWeight: '700', color: colors.ink,
    letterSpacing: -0.5, marginBottom: 6,
  },
  subtitle: {
    fontSize: 14, color: colors.gray, lineHeight: 20,
    marginBottom: 24,
  },
  errorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: colors.dangerBg, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 12,
  },
  errorText: { flex: 1, fontSize: 13, color: colors.danger, fontWeight: '600' },
  ctaButton: {
    height: 54, borderRadius: 12,
    backgroundColor: colors.brand.DEFAULT,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8,
    marginTop: 8,
  },
  ctaButtonDisabled: { backgroundColor: colors.muted },
  ctaButtonText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
