/**
 * Application status, opened from the magic link we email an applicant.
 *
 * The token is its own authentication — no login required — so this route sits
 * outside the auth guard. Reachable as `cesto://apply/status/<token>`; making
 * the emailed https:// link open the app instead of the browser needs Android
 * App Links / iOS Universal Links verification, which is a store-release task
 * rather than a code one. Until then the web page handles https and this
 * handles the app scheme.
 *
 * Only `needs_info` is actionable: admin asked for something more, and the
 * applicant can send it back once. The token is single-use, so a successful
 * resubmit invalidates it and the next fetch 404s — which is why the success
 * state is rendered from local state rather than from a refetch.
 */
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ArrowLeft, Clock, CheckCircle2, XCircle, AlertTriangle, Send, Link2Off,
} from 'lucide-react-native';
import { useLeadStatusByToken, useResubmitLead } from '@grocery-app/shared';
import { colors } from '../../../src/constants/colors';
import { useLanguageStore } from '../../../src/stores/languageStore';
import { TextInputField } from '../../../src/components/form';
import Skeleton from '../../../src/components/Skeleton';

export default function ApplicationStatusScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { lang } = useLanguageStore();
  const { data: lead, isLoading, isError } = useLeadStatusByToken(token);
  const resubmit = useResubmitLead();

  const [location, setLocation] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [website, setWebsite] = useState('');
  const [registrationNo, setRegistrationNo] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);

  // Prefill with whatever admin already holds, so the applicant edits rather
  // than retypes.
  useEffect(() => {
    if (!lead) return;
    setLocation(lead.location ?? '');
    setBusinessType(lead.business_type ?? '');
    setWebsite(lead.website ?? '');
    setRegistrationNo(lead.registration_no ?? '');
  }, [lead]);

  const Header = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Pressable onPress={() => router.replace('/')} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
        <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
      </Pressable>
      <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
        {lang === 'es' ? 'Tu solicitud' : 'Your application'}
      </Text>
      <View style={{ width: 40 }} />
    </View>
  );

  const Centered = ({ icon: Icon, tint, bg, title, body, cta }: {
    icon: typeof Clock; tint: string; bg: string; title: string; body: string; cta?: string;
  }) => (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, paddingBottom: 60 }}>
      <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: bg, justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
        <Icon size={36} color={tint} strokeWidth={1.5} />
      </View>
      <Text style={{ fontSize: 21, fontWeight: '800', color: colors.ink, textAlign: 'center', marginBottom: 10 }}>{title}</Text>
      <Text style={{ fontSize: 14, color: colors.gray, textAlign: 'center', lineHeight: 21 }}>{body}</Text>
      <Pressable
        onPress={() => router.replace('/')}
        style={{ marginTop: 26, height: 52, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}
      >
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
          {cta ?? (lang === 'es' ? 'Ir a la tienda' : 'Go to the shop')}
        </Text>
      </Pressable>
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <Header />
        <View style={{ padding: 16, gap: 12 }}>
          <Skeleton height={80} borderRadius={12} />
          <Skeleton height={18} width="55%" />
          <Skeleton height={13} width="80%" />
        </View>
      </SafeAreaView>
    );
  }

  // A consumed or expired token 404s. That is the normal end state after a
  // successful resubmit, so say so plainly rather than showing an error.
  if (isError || !lead) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <Header />
        <Centered
          icon={Link2Off} tint={colors.muted} bg={colors.surface.cream}
          title={lang === 'es' ? 'Este enlace ya no sirve' : 'This link is no longer valid'}
          body={lang === 'es'
            ? 'Puede que ya lo hayas usado o que haya caducado. Si aún necesitas algo, escríbenos.'
            : 'You may have used it already, or it expired. If you still need something, get in touch.'}
        />
      </SafeAreaView>
    );
  }

  if (done) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <Header />
        <Centered
          icon={CheckCircle2} tint={colors.success} bg={colors.successBg}
          title={lang === 'es' ? 'Enviado' : 'Sent'}
          body={lang === 'es'
            ? 'Gracias. Lo revisaremos y te escribiremos por email.'
            : 'Thanks. We will review it and email you.'}
        />
      </SafeAreaView>
    );
  }

  if (lead.approval_status === 'approved') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <Header />
        <Centered
          icon={CheckCircle2} tint={colors.success} bg={colors.successBg}
          title={lang === 'es' ? 'Aprobada' : 'Approved'}
          body={lang === 'es'
            ? `${lead.company} ya tiene precios de empresa. Inicia sesión y cambia a precios de empresa desde tu perfil.`
            : `${lead.company} now has business pricing. Log in and switch to business prices from your profile.`}
          cta={lang === 'es' ? 'Empezar a comprar' : 'Start shopping'}
        />
      </SafeAreaView>
    );
  }

  if (lead.approval_status === 'rejected') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <Header />
        <Centered
          icon={XCircle} tint={colors.danger} bg={colors.dangerBg}
          title={lang === 'es' ? 'No podemos aprobarla' : 'We cannot approve this'}
          body={lang === 'es'
            ? 'No hemos podido aprobar esta solicitud. Si crees que es un error, escríbenos.'
            : 'We could not approve this application. If you think that is a mistake, get in touch.'}
        />
      </SafeAreaView>
    );
  }

  if (lead.approval_status === 'pending_review') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <Header />
        <Centered
          icon={Clock} tint={colors.info} bg={colors.infoBg}
          title={lang === 'es' ? 'En revisión' : 'Under review'}
          body={lang === 'es'
            ? `Estamos revisando la solicitud de ${lead.company}. Te escribiremos por email en cuanto haya novedades.`
            : `We are reviewing the application from ${lead.company}. We will email you as soon as there is news.`}
        />
      </SafeAreaView>
    );
  }

  // needs_info — the only branch with something to do.
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <Header />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', gap: 12, backgroundColor: colors.warningBg, borderRadius: 12, padding: 16, marginBottom: 20 }}>
            <AlertTriangle size={20} color={colors.warning} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: colors.warning }}>
                {lang === 'es' ? 'Necesitamos algo más' : 'We need a bit more'}
              </Text>
              <Text style={{ fontSize: 12.5, color: colors.charcoal, marginTop: 4, lineHeight: 18 }}>
                {lang === 'es'
                  ? `Completa lo que falte de la solicitud de ${lead.company} y vuelve a enviarla. Este enlace solo se puede usar una vez.`
                  : `Fill in what is missing from the application for ${lead.company} and send it back. This link works once.`}
              </Text>
            </View>
          </View>

          <View style={{ gap: 14 }}>
            <TextInputField
              label={lang === 'es' ? 'Dirección o ciudad' : 'Address or city'}
              value={location}
              onChangeText={setLocation}
            />
            <TextInputField
              label={lang === 'es' ? 'Tipo de negocio' : 'Business type'}
              value={businessType}
              onChangeText={setBusinessType}
              placeholder={lang === 'es' ? 'Restaurante, tienda, catering…' : 'Restaurant, shop, catering…'}
            />
            <TextInputField
              label={lang === 'es' ? 'Sitio web (opcional)' : 'Website (optional)'}
              value={website}
              onChangeText={setWebsite}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TextInputField
              label={lang === 'es' ? 'CIF / NIF (opcional)' : 'Company reg. no. (optional)'}
              value={registrationNo}
              onChangeText={setRegistrationNo}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TextInputField
              label={lang === 'es' ? 'Nota para el equipo (opcional)' : 'Note to the team (optional)'}
              value={note}
              onChangeText={setNote}
              placeholder={lang === 'es' ? 'Qué has actualizado' : 'What you updated'}
              multiline
              numberOfLines={4}
              inputContainerStyle={{ height: 100, alignItems: 'flex-start', paddingVertical: 12 }}
              style={{ height: 76, textAlignVertical: 'top' }}
            />
          </View>

          {resubmit.isError && (
            <Text style={{ fontSize: 13, color: colors.danger, marginTop: 12 }}>
              {resubmit.error instanceof Error ? resubmit.error.message : (lang === 'es' ? 'No se pudo enviar.' : 'Could not send.')}
            </Text>
          )}

          <Pressable
            onPress={async () => {
              try {
                await resubmit.mutateAsync({
                  token: token as string,
                  payload: {
                    location: location.trim() || undefined,
                    business_type: businessType.trim() || undefined,
                    website: website.trim() || undefined,
                    registration_no: registrationNo.trim() || undefined,
                    note: note.trim() || undefined,
                  },
                });
                setDone(true);
              } catch { /* surfaced above */ }
            }}
            disabled={resubmit.isPending}
            style={{
              marginTop: 22, height: 52, borderRadius: 12, backgroundColor: colors.brand.DEFAULT,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: resubmit.isPending ? 0.6 : 1,
            }}
          >
            {resubmit.isPending
              ? <ActivityIndicator color="#fff" size="small" />
              : <Send size={17} color="#fff" strokeWidth={2} />}
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>
              {lang === 'es' ? 'Volver a enviar' : 'Send it back'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
