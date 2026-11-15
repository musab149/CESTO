import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ShoppingBasket,
  Mail,
  AlertCircle,
} from 'lucide-react-native';
import { colors } from '../../src/constants/colors';
import { useAuthStore } from '../../src/stores/authStore';
import { useValidationMessages } from '../../src/lib/validation/messages';
import { rules } from '../../src/lib/validation/rules';
import { ControlledTextField, ControlledPasswordField, ControlledCheckbox } from '../../src/lib/validation/formHelpers';
import GoogleAuthButton from '../../src/components/GoogleAuthButton';

const REMEMBERED_EMAIL_KEY = '@cesto/remembered_email';

interface LoginForm {
  email: string;
  password: string;
  remember: boolean;
}

export default function LoginScreen() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const messages = useValidationMessages();

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      email:    r.email(),
      // Login uses a min-length sanity check, NOT the strength rule — legacy
      // accounts may have shorter or weaker passwords than the current policy.
      password: z.string().min(1, messages.required),
      remember: z.boolean(),
    });
  }, [messages]);

  const {
    control, handleSubmit, setValue,
    formState: { isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { email: 'amir.khan@example.com', password: '', remember: true },
  });

  const [submitError, setSubmitError] = useState<string | null>(null);

  // Restore the remembered email so the field auto-fills on subsequent visits.
  useEffect(() => {
    AsyncStorage.getItem(REMEMBERED_EMAIL_KEY)
      .then((stored) => { if (stored) setValue('email', stored); })
      .catch(() => {});
  }, [setValue]);

  const onSubmit = async (values: LoginForm) => {
    setSubmitError(null);
    try {
      const result = await login(values.email, values.password);
      if (result.ok) {
        if (values.remember) {
          AsyncStorage.setItem(REMEMBERED_EMAIL_KEY, values.email).catch(() => {});
        } else {
          AsyncStorage.removeItem(REMEMBERED_EMAIL_KEY).catch(() => {});
        }
        router.replace('/(tabs)');
      } else {
        setSubmitError(result.error || 'Invalid email or password');
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logoBox}>
            <ShoppingBasket size={24} color="#FFFFFF" strokeWidth={1.75} />
          </View>
          <Text style={styles.logoText}>Cesto</Text>
        </View>

        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>
          Sign in to your account to continue shopping
        </Text>

        {submitError && (
          <View style={styles.errorBanner}>
            <AlertCircle size={18} color={colors.danger} strokeWidth={2} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.errorTitle}>{submitError}</Text>
              <Text style={styles.errorHint}>Demo account: amir.khan@example.com / password</Text>
            </View>
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

        <ControlledPasswordField
          control={control}
          name="password"
          label="Password"
          placeholder="Enter your password"
          autoComplete="current-password"
        />

        {/* Remember + Forgot row */}
        <View style={styles.optionsRow}>
          <ControlledCheckbox control={control} name="remember" label="Remember me" />
          <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password')}>
            <Text style={styles.forgotPasswordText}>Forgot password?</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.ctaButton, isSubmitting && styles.ctaButtonDisabled]}
          onPress={handleSubmit(onSubmit)}
          disabled={isSubmitting}
          activeOpacity={0.8}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.ctaButtonText}>Sign in</Text>
          )}
        </TouchableOpacity>

        <View style={styles.dividerContainer}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or continue with</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.socialRow}>
          <View style={{ flex: 1 }}>
            <GoogleAuthButton
              onSuccess={() => router.replace('/(tabs)')}
              onError={(msg) => setSubmitError(msg)}
            />
          </View>
        </View>

        <View style={styles.bottomLink}>
          <Text style={styles.bottomLinkText}>Don't have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
            <Text style={styles.bottomLinkAction}>Sign up</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface.linen },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 32,
  },
  logoContainer: { alignItems: 'center', marginBottom: 32 },
  logoBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.brand.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  logoText: { fontSize: 22, fontWeight: '700', color: colors.ink },
  title: { fontSize: 28, fontWeight: '700', color: colors.ink, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, color: colors.gray, textAlign: 'center', marginBottom: 32 },
  optionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  forgotPasswordText: { fontSize: 13, fontWeight: '700', color: colors.brand.DEFAULT },
  errorBanner: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: colors.dangerBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
  },
  errorTitle: { fontSize: 13, fontWeight: '700', color: colors.danger },
  errorHint: { fontSize: 12, color: colors.danger, opacity: 0.85, marginTop: 2 },
  ctaButton: {
    height: 54,
    borderRadius: 12,
    backgroundColor: colors.brand.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  ctaButtonDisabled: { opacity: 0.7 },
  ctaButtonText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  dividerContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: 13, color: colors.muted, marginHorizontal: 16 },
  socialRow: { flexDirection: 'row', gap: 12, marginBottom: 32 },
  bottomLink: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  bottomLinkText: { fontSize: 14, color: colors.gray },
  bottomLinkAction: { fontSize: 14, fontWeight: '700', color: colors.brand.DEFAULT },
});
