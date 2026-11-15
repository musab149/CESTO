/**
 * Contact support. Mobile could already reach POST /api/support, but only
 * through the feedback widget buried on the home screen — there was no
 * deliberate way to write to support. Mirrors web's /contact: the same fields,
 * the same shared validation rules, and the same `source` tagging so tickets
 * stay attributable once they land in admin.
 */
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Send, CheckCircle2, HelpCircle } from 'lucide-react-native';
import { useSubmitSupportTicket } from '@grocery-app/shared';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import { useAuthStore } from '../src/stores/authStore';
import { useValidationMessages } from '../src/lib/validation/messages';
import { rules } from '../src/lib/validation/rules';
import { TextInputField } from '../src/components/form';
import { useToast } from '../src/components/Toast';

interface ContactForm {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

export default function ContactScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const submit = useSubmitSupportTicket();
  const messages = useValidationMessages();

  // Lets a screen deep-link in with attribution, e.g. /contact?source=order_help.
  // Capped like web so a crafted link cannot stuff the column.
  const { source: rawSource } = useLocalSearchParams<{ source?: string }>();
  const source = (rawSource || 'contact_form_mobile').slice(0, 40);

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      name: r.name({ min: 2, max: 100 }),
      email: r.email(),
      phone: r.phoneIntlOptional(),
      subject: r.shortText(200),
      message: r.longText(4000),
    });
  }, [messages]);

  const { control, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } =
    useForm<ContactForm>({
      resolver: zodResolver(schema),
      defaultValues: { name: '', email: '', phone: '', subject: '', message: '' },
    });

  // Prefill from the signed-in profile so a logged-in customer only writes the
  // part we don't already know. Not validated on set — an empty saved phone
  // must not paint the field red before they have touched it.
  useEffect(() => {
    if (!user) return;
    if (user.name) setValue('name', user.name, { shouldValidate: false });
    if (user.email) setValue('email', user.email, { shouldValidate: false });
    if (user.phone) setValue('phone', user.phone, { shouldValidate: false });
  }, [user, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await submit.mutateAsync({
        name: values.name,
        email: values.email,
        phone: values.phone || null,
        subject: values.subject,
        body: values.message,
        source,
        language: lang,
      });
      toast.success(
        lang === 'es' ? 'Mensaje enviado' : 'Message sent',
        lang === 'es' ? 'Te responderemos por email.' : "We'll reply by email.",
      );
      // Keep who they are, clear what they wrote — a second message is usually
      // a follow-up from the same person.
      reset({ name: values.name, email: values.email, phone: values.phone, subject: '', message: '' });
    } catch (err) {
      toast.error(
        lang === 'es' ? 'No se pudo enviar' : "Couldn't send",
        err instanceof Error ? err.message : undefined,
      );
    }
  });

  const t = {
    heading: lang === 'es' ? 'Contacto' : 'Contact us',
    intro: lang === 'es'
      ? 'Cuéntanos qué necesitas y te respondemos por email lo antes posible.'
      : "Tell us what you need and we'll reply by email as soon as we can.",
    name: lang === 'es' ? 'Nombre' : 'Name',
    email: lang === 'es' ? 'Email' : 'Email',
    phone: lang === 'es' ? 'Teléfono (opcional)' : 'Phone (optional)',
    subject: lang === 'es' ? 'Asunto' : 'Subject',
    subjectPh: lang === 'es' ? 'Resumen breve de lo que ocurre' : "Short summary of what's going on",
    message: lang === 'es' ? 'Mensaje' : 'Message',
    messagePh: lang === 'es'
      ? 'Cuéntanos qué pasó. Incluye el número de pedido si es relevante.'
      : 'Tell us what happened. Include your order number if relevant.',
    send: lang === 'es' ? 'Enviar mensaje' : 'Send message',
    helpFirst: lang === 'es' ? '¿Buscas una respuesta rápida?' : 'Looking for a quick answer?',
    helpBody: lang === 'es' ? 'Muchas dudas ya están resueltas en el centro de ayuda.' : "Most questions are already answered in the help centre.",
    helpCta: lang === 'es' ? 'Ver centro de ayuda' : 'Browse help centre',
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          {t.heading}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={{ fontSize: 14, color: colors.gray, lineHeight: 20, marginBottom: 18 }}>
            {t.intro}
          </Text>

          {/* Deflect to the help centre before the form: most people arriving
              here want an answer, not a conversation. */}
          <Pressable
            onPress={() => router.push('/help')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.brand.whisper, borderRadius: 12, borderWidth: 1, borderColor: colors.brand.mist, padding: 14, marginBottom: 20 }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center' }}>
              <HelpCircle size={17} color="#fff" strokeWidth={1.75} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>{t.helpFirst}</Text>
              <Text style={{ fontSize: 12, color: colors.gray, marginTop: 2 }}>{t.helpBody}</Text>
            </View>
          </Pressable>

          <View style={{ gap: 14 }}>
            <Controller
              control={control}
              name="name"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInputField
                  label={t.name}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.name?.message}
                  autoCapitalize="words"
                  textContentType="name"
                />
              )}
            />
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInputField
                  label={t.email}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.email?.message}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="emailAddress"
                />
              )}
            />
            <Controller
              control={control}
              name="phone"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInputField
                  label={t.phone}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.phone?.message}
                  keyboardType="phone-pad"
                  placeholder="+34 6XX XXX XXX"
                  textContentType="telephoneNumber"
                />
              )}
            />
            <Controller
              control={control}
              name="subject"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInputField
                  label={t.subject}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.subject?.message}
                  placeholder={t.subjectPh}
                />
              )}
            />
            <Controller
              control={control}
              name="message"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInputField
                  label={t.message}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.message?.message}
                  placeholder={t.messagePh}
                  multiline
                  numberOfLines={6}
                  inputContainerStyle={{ height: 140, alignItems: 'flex-start', paddingVertical: 12 }}
                  style={{ height: 116, textAlignVertical: 'top' }}
                />
              )}
            />
          </View>

          <Pressable
            onPress={onSubmit}
            disabled={isSubmitting || submit.isPending}
            style={{
              marginTop: 22, height: 52, borderRadius: 12,
              backgroundColor: colors.brand.DEFAULT,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: isSubmitting || submit.isPending ? 0.6 : 1,
            }}
          >
            {isSubmitting || submit.isPending
              ? <ActivityIndicator color="#fff" size="small" />
              : <Send size={17} color="#fff" strokeWidth={2} />}
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>{t.send}</Text>
          </Pressable>

          {submit.isSuccess && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, backgroundColor: colors.successBg, borderRadius: 10, padding: 12 }}>
              <CheckCircle2 size={16} color={colors.success} strokeWidth={2} />
              <Text style={{ flex: 1, fontSize: 13, color: colors.success, fontWeight: '600' }}>
                {lang === 'es'
                  ? 'Recibido. Te responderemos por email.'
                  : "Got it. We'll reply by email."}
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
