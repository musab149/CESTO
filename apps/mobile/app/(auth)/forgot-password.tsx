import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react-native';
import { useForgotPassword } from '@grocery-app/shared';
import { colors } from '../../src/constants/colors';
import { useValidationMessages } from '../../src/lib/validation/messages';
import { rules } from '../../src/lib/validation/rules';
import { ControlledTextField } from '../../src/lib/validation/formHelpers';

interface ForgotForm {
  email: string;
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const forgotPw = useForgotPassword();
  const messages = useValidationMessages();

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({ email: r.email() });
  }, [messages]);

  const {
    control, handleSubmit, getValues,
    formState: { isSubmitting },
  } = useForm<ForgotForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { email: '' },
  });

  const [sent, setSent] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: ForgotForm) => {
    setSubmitError(null);
    try {
      await forgotPw.mutateAsync({ email: values.email });
      setSent(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "We couldn't send a reset link. Try again.");
    }
  };

  if (sent) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centeredContent}>
          <View style={styles.successIconWrapper}>
            <CheckCircle size={48} color={colors.brand.DEFAULT} strokeWidth={1.75} />
          </View>

          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            We've sent a password reset link to{'\n'}
            <Text style={styles.emailHighlight}>{getValues('email')}</Text>
          </Text>

          <TouchableOpacity
            style={styles.ctaButton}
            onPress={() => router.push('/(auth)/login')}
            activeOpacity={0.8}
          >
            <Text style={styles.ctaButtonText}>Back to login</Text>
          </TouchableOpacity>

          <Text style={styles.helperText}>
            Didn't receive the email? Check your spam folder or try again.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ArrowLeft size={24} color={colors.ink} strokeWidth={1.75} />
        </TouchableOpacity>

        <View style={styles.iconBadge}>
          <Mail size={32} color={colors.brand.DEFAULT} strokeWidth={1.75} />
        </View>

        <Text style={styles.title}>Forgot password?</Text>
        <Text style={styles.subtitle}>
          No worries! Enter your email and we'll send you a reset link.
        </Text>

        {submitError && (
          <View style={styles.errorBanner}>
            <AlertCircle size={16} color={colors.danger} strokeWidth={2} />
            <Text style={styles.errorText}>{submitError}</Text>
          </View>
        )}

        <ControlledTextField
          control={control}
          name="email"
          label="Email"
          placeholder="Enter your email"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          leadingIcon={<Mail size={20} color={colors.muted} strokeWidth={1.75} />}
        />

        <TouchableOpacity
          style={[styles.ctaButton, isSubmitting && styles.ctaButtonDisabled]}
          onPress={handleSubmit(onSubmit)}
          disabled={isSubmitting}
          activeOpacity={0.8}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.ctaButtonText}>Send reset link</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.backToLogin}
          onPress={() => router.push('/(auth)/login')}
        >
          <ArrowLeft size={16} color={colors.brand.DEFAULT} strokeWidth={1.75} />
          <Text style={styles.backToLoginText}>Back to login</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface.linen },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 16 },
  centeredContent: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center' },
  backButton: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: colors.surface.cream,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 32,
  },
  iconBadge: {
    width: 72, height: 72, borderRadius: 8,
    backgroundColor: colors.brand.mist,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginBottom: 24,
  },
  successIconWrapper: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.brand.mist,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
  },
  title: { fontSize: 28, fontWeight: '700', color: colors.ink, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, color: colors.gray, textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  emailHighlight: { fontWeight: '700', color: colors.ink },
  errorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: colors.dangerBg,
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 16,
  },
  errorText: { flex: 1, fontSize: 13, color: colors.danger, fontWeight: '600' },
  ctaButton: {
    height: 54, borderRadius: 12,
    backgroundColor: colors.brand.DEFAULT,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20, marginTop: 8,
  },
  ctaButtonDisabled: { opacity: 0.7 },
  ctaButtonText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  backToLogin: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  backToLoginText: { fontSize: 14, fontWeight: '600', color: colors.brand.DEFAULT },
  helperText: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20 },
});
