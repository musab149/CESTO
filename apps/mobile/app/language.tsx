import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Check, Globe } from 'lucide-react-native';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';

const languages = [
  { code: 'es' as const, name: 'Español', nativeName: 'Español', flag: '🇪🇸', description: 'Idioma predeterminado' },
  { code: 'en' as const, name: 'English', nativeName: 'English', flag: '🇬🇧', description: 'Default language' },
];

export default function LanguageScreen() {
  const router = useRouter();
  const { lang, setLang } = useLanguageStore();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          {lang === 'es' ? 'Idioma' : 'Language'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16 }}>
        {/* Info */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.brand.whisper, borderRadius: 12, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: colors.brand.mist }}>
          <Globe size={18} color={colors.brand.DEFAULT} strokeWidth={1.75} />
          <Text style={{ flex: 1, fontSize: 13, color: colors.brand.DEFAULT, lineHeight: 18 }}>
            {lang === 'es'
              ? 'Selecciona tu idioma preferido. Todos los textos de la app se actualizarán.'
              : 'Select your preferred language. All app text will be updated.'}
          </Text>
        </View>

        {/* Language options */}
        <View style={{
          backgroundColor: colors.surface.cream, borderRadius: 12, overflow: 'hidden',
          borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
        }}>
          {languages.map((language, index) => {
            const isSelected = lang === language.code;
            return (
              <Pressable
                key={language.code}
                onPress={() => setLang(language.code)}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16,
                  borderBottomWidth: index < languages.length - 1 ? 1 : 0,
                  borderBottomColor: colors.border,
                  backgroundColor: pressed ? colors.surface.linen : isSelected ? colors.brand.whisper : 'transparent',
                })}
              >
                {/* Flag */}
                <View style={{
                  width: 44, height: 44, borderRadius: 22,
                  backgroundColor: isSelected ? colors.brand.mist : colors.surface.linen,
                  justifyContent: 'center', alignItems: 'center', marginRight: 14,
                }}>
                  <Text style={{ fontSize: 22 }}>{language.flag}</Text>
                </View>

                {/* Label */}
                <View style={{ flex: 1 }}>
                  <Text style={{
                    fontSize: 16,
                    fontWeight: isSelected ? '700' : '600',
                    color: isSelected ? colors.brand.DEFAULT : colors.ink,
                  }}>
                    {language.nativeName}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                    {language.name}
                  </Text>
                </View>

                {/* Checkmark */}
                {isSelected && (
                  <View style={{
                    width: 26, height: 26, borderRadius: 13,
                    backgroundColor: colors.brand.DEFAULT,
                    justifyContent: 'center', alignItems: 'center',
                  }}>
                    <Check size={16} color="#fff" strokeWidth={2.5} />
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* Note */}
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 16, textAlign: 'center', lineHeight: 18 }}>
          {lang === 'es'
            ? 'El idioma de los nombres de productos puede variar según el proveedor.'
            : 'Product name language may vary depending on the supplier.'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
