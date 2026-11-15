import React, { useMemo, useState } from 'react';
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
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ShoppingBasket,
  User,
  Mail,
  Phone,
  AlertCircle,
} from 'lucide-react-native';
import { colors } from '../../src/constants/colors';
import { useAuthStore } from '../../src/stores/authStore';
import { useValidationMessages } from '../../src/lib/validation/messages';
import { rules } from '../../src/lib/validation/rules';
import { ControlledTextField, ControlledPasswordField, ControlledCheckbox } from '../../src/lib/validation/formHelpers';
import GoogleAuthButton from '../../src/components/GoogleAuthButton';

interface RegisterForm {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirm: string;
  terms: boolean;
}

function getPasswordStrength(pw: string): { level: number; label: string } {
  if (!pw) return { level: 0, label: '' };
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 2) return { level: 1, label: 'Weak' };
  if (score <= 3) return { level: 2, label: 'Medium' };
  return { level: 3, label: 'Strong' };
}

const strengthColors = ['transparent', colors.danger, colors.amber.DEFAULT, colors.brand.DEFAULT];

export default function RegisterScreen() {
  const router = useRouter();
  const register = useAuthStore((s) => s.register);
  const messages = useValidationMessages();

  const schema = useMemo(() => {
    const r = rules(messages);
    return z
      .object({
        name:     r.name({ min: 2, max: 80 }),
        email:    r.email(),
        phone:    r.phoneIntl(),
        password: r.password({ min: 8, strong: true }),
        confirm:  z.string().min(1, messages.required),
        terms:    r.mustBeTrue(),
      })
      .refine((v) => v.password === v.confirm, {
        path: ['confirm'],
        message: messages.passwordMatch,
      });
  }, [messages]);

  const {
    control, handleSubmit,
    formState: { isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: {
      name: '', email: '', phone: '', password: '', confirm: '', terms: false,
    },
  });

  const password = useWatch({ control, name: 'password' }) ?? '';
  const strength = useMemo(() => getPasswordStrength(password), [password]);

  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: RegisterForm) => {
    setSubmitError(null);
    try {
      const result = await register({
        name: values.name,
        email: values.email,
        phone: values.phone,
        password: values.password,
      });
      if (result.ok) {
        router.replace('/(tabs)');
      } else {
        setSubmitError(result.error || 'Could not create account');
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
        <View style={styles.logoContainer}>
          <View style={styles.logoBox}>
            <ShoppingBasket size={24} color="#FFFFFF" strokeWidth={1.75} />
          </View>
          <Text style={styles.logoText}>Cesto</Text>
        </View>

        <Text style={styles.title}>Create account</Text>
        <Text style={styles.subtitle}>
          Join Cesto and get fresh groceries delivered to your door
        </Text>

        {submitError && (
          <View style={styles.errorBanner}>
            <AlertCircle size={18} color={colors.danger} strokeWidth={2} style={{ marginTop: 1 }} />
            <Text style={styles.errorTitle}>{submitError}</Text>
          </View>
        )}

        <ControlledTextField
          control={control}
          name="name"
          label="Full name"
          placeholder="Enter your full name"
          autoCapitalize="words"
          autoComplete="name"
          leadingIcon={<User size={20} color={colors.muted} strokeWidth={1.75} />}
        />

        <ControlledTextField
          control={control}
          name="email"
          label="Email"
          placeholder="Enter your email"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          leadingIcon={<Mail size={20} color={colors.muted} strokeWidth={1.75} />}
        />

        <ControlledTextField
          control={control}
          name="phone"
          label="Phone"
          placeholder="+34 612 345 678"
          keyboardType="phone-pad"
          autoComplete="tel"
          leadingIcon={<Phone size={20} color={colors.muted} strokeWidth={1.75} />}
        />

        <View>
          <ControlledPasswordField
            control={control}
            name="password"
            label="Password"
            placeholder="Create a password"
            autoComplete="new-password"
          />
          {password.length > 0 && strength.label !== '' && (
            <View style={styles.strengthContainer}>
              <View style={styles.strengthBars}>
                {[1, 2, 3].map((bar) => (
                  <View
                    key={bar}
                    style={[
                      styles.strengthBar,
                      {
                        backgroundColor:
                          bar <= strength.level
                            ? strengthColors[strength.level]
                            : colors.border,
                      },
                    ]}
                  />
                ))}
              </View>
              <Text style={[styles.strengthLabel, { color: strengthColors[strength.level] }]}>
                {strength.label}
              </Text>
            </View>
          )}
        </View>

        <ControlledPasswordField
          control={control}
          name="confirm"
          label="Confirm password"
          placeholder="Re-enter your password"
          autoComplete="new-password"
        />

        <ControlledCheckbox
          control={control}
          name="terms"
          label="I agree to the Terms of Service and Privacy Policy"
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
            <Text style={styles.ctaButtonText}>Create account</Text>
          )}
        </TouchableOpacity>

        <View style={styles.dividerContainer}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or sign up with</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={{ marginBottom: 32 }}>
          <GoogleAuthButton
            onSuccess={() => router.replace('/(tabs)')}
            onError={(msg) => setSubmitError(msg)}
          />
        </View>

        <View style={styles.bottomLink}>
          <Text style={styles.bottomLinkText}>Already have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
            <Text style={styles.bottomLinkAction}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface.linen },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 32, paddingBottom: 32 },
  logoContainer: { alignItems: 'center', marginBottom: 24 },
  logoBox: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: colors.brand.DEFAULT,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  logoText: { fontSize: 22, fontWeight: '700', color: colors.ink },
  title: { fontSize: 28, fontWeight: '700', color: colors.ink, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, color: colors.gray, textAlign: 'center', marginBottom: 28 },
  errorBanner: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: colors.dangerBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
  },
  errorTitle: { fontSize: 13, fontWeight: '700', color: colors.danger, flex: 1 },
  strengthContainer: { flexDirection: 'row', alignItems: 'center', marginTop: -8, marginBottom: 14, gap: 8 },
  strengthBars: { flexDirection: 'row', gap: 4, flex: 1 },
  strengthBar: { flex: 1, height: 4, borderRadius: 2 },
  strengthLabel: { fontSize: 12, fontWeight: '600' },
  ctaButton: {
    height: 54, borderRadius: 12,
    backgroundColor: colors.brand.DEFAULT,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 12, marginBottom: 24,
  },
  ctaButtonDisabled: { opacity: 0.7 },
  ctaButtonText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  dividerContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: 13, color: colors.muted, marginHorizontal: 16 },
  bottomLink: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  bottomLinkText: { fontSize: 14, color: colors.gray },
  bottomLinkAction: { fontSize: 14, fontWeight: '700', color: colors.brand.DEFAULT },
});
