import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useStoreSettings } from '@grocery-app/shared';
import { colors } from '../constants/colors';
import { useLanguageStore } from '../stores/languageStore';
import SimpleMarkdown from './SimpleMarkdown';

export const SUPPORT_EMAIL_FALLBACK = 'support.cesto@gmail.com';

/**
 * Shell for the admin-managed Privacy Policy and Terms screens.
 *
 * Both screens used to carry a hardcoded copy of the document, shown
 * whenever the admin-managed field was blank. Those copies were written
 * before the real documents and contradicted them: the privacy one said
 * Stripe processed card payments and that records are kept for six years;
 * the terms promised 60-minute delivery in central Madrid, slot windows,
 * and disputes heard in the courts of Madrid. None of that is true, and it
 * shipped inside the app.
 *
 * They also printed "Last updated: April 2026" above whatever the document
 * said — so the app contradicted the dated document it was displaying.
 *
 * Now: the document, or a short notice pointing at support. The date comes
 * from the document itself, like everywhere else.
 */
export default function LegalDocumentScreen({
  icon: Icon,
  titleEs,
  titleEn,
  body,
}: {
  icon: LucideIcon;
  titleEs: string;
  titleEn: string;
  body: string | undefined;
}) {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const { data: settings } = useStoreSettings();
  const es = lang === 'es';
  const email = settings?.contactEmail?.trim() || SUPPORT_EMAIL_FALLBACK;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: colors.border,
      }}>
        <Pressable
          onPress={() => router.back()}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}
        >
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          {es ? titleEs : titleEn}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={{
          backgroundColor: colors.surface.cream, borderRadius: 12, padding: 20,
          borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <View style={{
              width: 44, height: 44, borderRadius: 12, backgroundColor: colors.brand.mist,
              justifyContent: 'center', alignItems: 'center',
            }}>
              <Icon size={22} color={colors.brand.DEFAULT} strokeWidth={1.75} />
            </View>
            <Text style={{ flex: 1, fontSize: 20, fontWeight: '800', color: colors.ink }}>
              {es ? titleEs : titleEn}
            </Text>
          </View>

          {body ? (
            <SimpleMarkdown body={body} />
          ) : (
            <Text style={{ fontSize: 14, lineHeight: 22, color: colors.charcoal }}>
              {es ? 'Estamos actualizando este documento. Mientras tanto, escríbenos a ' : 'We are updating this document. In the meantime, email '}
              <Text
                onPress={() => Linking.openURL(`mailto:${email}`)}
                style={{ color: colors.brand.DEFAULT, fontWeight: '600' }}
              >
                {email}
              </Text>
              {es ? ' y te enviamos la versión vigente.' : ' and we will send you the current version.'}
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
