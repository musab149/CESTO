import { Modal, View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useMemo, useState } from 'react';
import { X, CheckCircle2, Send, Users } from 'lucide-react-native';
import {
  useSubmitRashanLead,
  leadFrequencyToSubscription,
  type RashanLeadFrequency,
  type RashanLeadContactPref,
} from '@grocery-app/shared';
import { colors } from '../constants/colors';
import { useLanguageStore } from '../stores/languageStore';
import { useAuthStore } from '../stores/authStore';
import { useRashanStore } from '../stores/rashanStore';
import { TextInputField } from './form';

/**
 * Rashan interest capture — the demand signal web collects on its rashan
 * landing page and mobile had no equivalent for, so every lead came from the
 * website only.
 *
 * Deliberately shorter than web's version. This is a sheet inside an app, and
 * the goal is a contactable lead with enough context to size a pack: who, how
 * to reach them, household size and cadence. Everything the API accepts beyond
 * that is optional, and the follow-up conversation is a better place for it.
 */
const FREQUENCIES: { id: RashanLeadFrequency; en: string; es: string }[] = [
  { id: 'weekly', en: 'Weekly', es: 'Semanal' },
  { id: 'biweekly', en: 'Every 2 weeks', es: 'Cada 2 semanas' },
  { id: 'every_3_weeks', en: 'Every 3 weeks', es: 'Cada 3 semanas' },
  { id: 'monthly', en: 'Monthly', es: 'Mensual' },
];

const CONTACT_PREFS: { id: RashanLeadContactPref; en: string; es: string }[] = [
  { id: 'whatsapp', en: 'WhatsApp', es: 'WhatsApp' },
  { id: 'call', en: 'Call', es: 'Llamada' },
  { id: 'sms', en: 'SMS', es: 'SMS' },
  { id: 'email', en: 'Email', es: 'Email' },
];

export default function RashanInterestSheet({
  visible, onClose, packSlug,
}: { visible: boolean; onClose: () => void; packSlug?: string | null }) {
  const { lang } = useLanguageStore();
  const user = useAuthStore((s) => s.user);
  const submit = useSubmitRashanLead();
  const setLeadPrefill = useRashanStore((s) => s.setLeadPrefill);

  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [household, setHousehold] = useState('');
  const [frequency, setFrequency] = useState<RashanLeadFrequency>('monthly');
  const [contactPref, setContactPref] = useState<RashanLeadContactPref>('whatsapp');
  const [slot, setSlot] = useState('');
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState(false);

  // household_size is required and numeric; anything unparseable blocks send
  // rather than silently posting a 0 the ops team then has to chase.
  const householdSize = useMemo(() => {
    const n = parseInt(household.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [household]);

  const canSend = name.trim().length >= 2 && phone.trim().length >= 7 && householdSize !== null;

  const close = () => {
    if (submit.isPending) return;
    onClose();
    // Reset a completed submission on the way out so reopening starts clean.
    if (done) {
      setDone(false);
      setHousehold('');
      setSlot('');
      setNotes('');
    }
  };

  const send = async () => {
    if (!canSend || householdSize === null) return;
    try {
      await submit.mutateAsync({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        household_size: householdSize,
        frequency,
        contact_pref: contactPref,
        preferred_slot: slot.trim() || null,
        dietary_notes: notes.trim() || null,
        interested_pack_slug: packSlug ?? null,
        source: 'mobile_rashan',
        language: lang,
      });
      // Carry the answers forward so the builder does not ask household size
      // and cadence again two screens later — the same reason web stashes them.
      setLeadPrefill({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        household: householdSize,
        frequency: leadFrequencyToSubscription(frequency),
        leadFrequency: frequency,
        preferredSlot: slot.trim() || null,
      });
      setDone(true);
    } catch { /* surfaced below */ }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ backgroundColor: colors.surface.cream, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 18, paddingBottom: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>
                  {lang === 'es' ? 'Me interesa el rashan' : 'I am interested in rashan'}
                </Text>
                {!done && (
                  <Text style={{ fontSize: 12, color: colors.gray, marginTop: 3, lineHeight: 17 }}>
                    {lang === 'es'
                      ? 'Déjanos tus datos y te preparamos una propuesta a medida.'
                      : 'Leave your details and we will put together a pack that fits.'}
                  </Text>
                )}
              </View>
              <Pressable onPress={close} hitSlop={10} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface.linen, justifyContent: 'center', alignItems: 'center' }}>
                <X size={17} color={colors.gray} strokeWidth={2} />
              </Pressable>
            </View>

            {done ? (
              <View style={{ alignItems: 'center', paddingHorizontal: 28, paddingVertical: 34 }}>
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.successBg, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                  <CheckCircle2 size={32} color={colors.success} strokeWidth={1.5} />
                </View>
                <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center', marginBottom: 6 }}>
                  {lang === 'es' ? 'Gracias' : 'Thanks'}
                </Text>
                <Text style={{ fontSize: 13.5, color: colors.gray, textAlign: 'center', lineHeight: 20 }}>
                  {lang === 'es'
                    ? 'Te contactaremos pronto para afinar tu pack.'
                    : 'We will be in touch soon to fine-tune your pack.'}
                </Text>
                <Pressable
                  onPress={close}
                  style={{ marginTop: 22, height: 50, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
                    {lang === 'es' ? 'Cerrar' : 'Close'}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 8, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
                <View style={{ gap: 12 }}>
                  <TextInputField
                    label={lang === 'es' ? 'Nombre' : 'Name'}
                    value={name} onChangeText={setName} autoCapitalize="words"
                  />
                  <TextInputField
                    label={lang === 'es' ? 'Teléfono' : 'Phone'}
                    value={phone} onChangeText={setPhone}
                    keyboardType="phone-pad" placeholder="+34 6XX XXX XXX"
                  />
                  <TextInputField
                    label={lang === 'es' ? 'Email (opcional)' : 'Email (optional)'}
                    value={email} onChangeText={setEmail}
                    keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                  />
                  <TextInputField
                    label={lang === 'es' ? 'Personas en casa' : 'People in your household'}
                    value={household} onChangeText={setHousehold}
                    keyboardType="number-pad" placeholder="4"
                    leadingIcon={<Users size={17} color={colors.muted} strokeWidth={1.75} />}
                  />
                </View>

                <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, color: colors.muted, textTransform: 'uppercase', marginTop: 18, marginBottom: 8 }}>
                  {lang === 'es' ? 'Cada cuánto' : 'How often'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {FREQUENCIES.map((f) => {
                    const on = frequency === f.id;
                    return (
                      <Pressable
                        key={f.id}
                        onPress={() => setFrequency(f.id)}
                        style={{
                          paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999,
                          borderWidth: 1,
                          borderColor: on ? colors.brand.DEFAULT : colors.border,
                          backgroundColor: on ? colors.brand.whisper : colors.surface.linen,
                        }}
                      >
                        <Text style={{ fontSize: 12.5, fontWeight: '600', color: on ? colors.brand.DEFAULT : colors.gray }}>
                          {lang === 'es' ? f.es : f.en}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, color: colors.muted, textTransform: 'uppercase', marginTop: 18, marginBottom: 8 }}>
                  {lang === 'es' ? 'Cómo prefieres que te contactemos' : 'How to reach you'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {CONTACT_PREFS.map((c) => {
                    const on = contactPref === c.id;
                    return (
                      <Pressable
                        key={c.id}
                        onPress={() => setContactPref(c.id)}
                        style={{
                          paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999,
                          borderWidth: 1,
                          borderColor: on ? colors.brand.DEFAULT : colors.border,
                          backgroundColor: on ? colors.brand.whisper : colors.surface.linen,
                        }}
                      >
                        <Text style={{ fontSize: 12.5, fontWeight: '600', color: on ? colors.brand.DEFAULT : colors.gray }}>
                          {lang === 'es' ? c.es : c.en}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={{ marginTop: 16 }}>
                  <TextInputField
                    label={lang === 'es' ? '¿Qué horario te viene mejor?' : 'What time suits you best?'}
                    value={slot}
                    onChangeText={setSlot}
                    placeholder={lang === 'es' ? 'Ej. fines de semana, después de las 18:00' : 'e.g. weekends, after 18:00'}
                  />
                </View>

                <View style={{ marginTop: 16 }}>
                  <TextInputField
                    label={lang === 'es' ? 'Preferencias o alergias (opcional)' : 'Preferences or allergies (optional)'}
                    value={notes} onChangeText={setNotes}
                    placeholder={lang === 'es' ? 'Sin gluten, halal, sin picante…' : 'Gluten-free, halal, no chilli…'}
                    multiline numberOfLines={3}
                    inputContainerStyle={{ height: 88, alignItems: 'flex-start', paddingVertical: 12 }}
                    style={{ height: 64, textAlignVertical: 'top' }}
                  />
                </View>

                {submit.isError && (
                  <Text style={{ fontSize: 12.5, color: colors.danger, marginTop: 12 }}>
                    {submit.error instanceof Error ? submit.error.message : (lang === 'es' ? 'No se pudo enviar.' : 'Could not send.')}
                  </Text>
                )}

                <Pressable
                  onPress={send}
                  disabled={!canSend || submit.isPending}
                  style={{
                    marginTop: 20, height: 52, borderRadius: 12,
                    backgroundColor: canSend ? colors.brand.DEFAULT : colors.border,
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                    opacity: submit.isPending ? 0.6 : 1,
                  }}
                >
                  {submit.isPending
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Send size={16} color={canSend ? '#fff' : colors.muted} strokeWidth={2} />}
                  <Text style={{ fontSize: 15, fontWeight: '700', color: canSend ? '#fff' : colors.muted }}>
                    {lang === 'es' ? 'Enviar' : 'Send'}
                  </Text>
                </Pressable>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
