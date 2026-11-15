/**
 * A single help-centre article. The API returns the article with its parent
 * category and siblings attached, so the footer can offer the rest of the
 * category without a second request.
 */
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, ChevronRight, MessageCircle, FileQuestion } from 'lucide-react-native';
import { useHelpArticle } from '@grocery-app/shared';
import { colors } from '../../src/constants/colors';
import { useLanguageStore } from '../../src/stores/languageStore';
import SimpleMarkdown from '../../src/components/SimpleMarkdown';
import Skeleton from '../../src/components/Skeleton';

export default function HelpArticleScreen() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { lang } = useLanguageStore();
  const { data: article, isLoading, isError } = useHelpArticle(slug);

  const category = article?.category;
  // Siblings arrive on the category; drop the article the reader is already on.
  const siblings = (category?.articles ?? []).filter((a) => a.slug !== slug);

  const Header = ({ subtitle }: { subtitle?: string }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
        <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center', marginRight: 40 }}>
        <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: colors.muted, textTransform: 'uppercase' }} numberOfLines={1}>
          {subtitle ?? (lang === 'es' ? 'Ayuda' : 'Help')}
        </Text>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <Header />
        <View style={{ padding: 16, gap: 12 }}>
          <Skeleton height={26} width="80%" />
          <Skeleton height={14} width="40%" />
          <View style={{ height: 8 }} />
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} height={13} width={i % 3 === 2 ? '65%' : '100%'} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !article) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <Header />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
            <FileQuestion size={30} color={colors.muted} strokeWidth={1.5} />
          </View>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
            {lang === 'es' ? 'Artículo no encontrado' : 'Article not found'}
          </Text>
          <Text style={{ fontSize: 13, color: colors.gray, textAlign: 'center', marginTop: 6, lineHeight: 19 }}>
            {lang === 'es'
              ? 'Puede que se haya movido o retirado. Busca en el centro de ayuda.'
              : 'It may have moved or been withdrawn. Try the help centre.'}
          </Text>
          <Pressable
            onPress={() => router.replace('/help')}
            style={{ marginTop: 20, height: 52, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30 }}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
              {lang === 'es' ? 'Ir al centro de ayuda' : 'Go to help centre'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const heading = lang === 'es' ? article.title_es : article.title_en;
  const body = lang === 'es' ? article.body_es : article.body_en;
  const categoryTitle = category ? (lang === 'es' ? category.title_es : category.title_en) : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <Header subtitle={categoryTitle} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: colors.ink, letterSpacing: -0.4, lineHeight: 30, marginBottom: 16 }}>
          {heading}
        </Text>

        <View style={{ backgroundColor: colors.surface.cream, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', padding: 16 }}>
          {body?.trim()
            ? <SimpleMarkdown body={body} />
            : (
              <Text style={{ fontSize: 14, color: colors.muted, lineHeight: 21 }}>
                {lang === 'es'
                  ? 'Este artículo aún no tiene contenido.'
                  : "This article doesn't have content yet."}
              </Text>
            )}
        </View>

        {siblings.length > 0 && (
          <View style={{ marginTop: 24 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, color: colors.muted, textTransform: 'uppercase', marginBottom: 10 }}>
              {lang === 'es' ? 'Más en esta categoría' : 'More in this category'}
            </Text>
            <View style={{ backgroundColor: colors.surface.cream, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', overflow: 'hidden' }}>
              {siblings.map((sib, i) => (
                <Pressable
                  key={sib.id}
                  onPress={() => router.replace({ pathname: '/help/[slug]', params: { slug: sib.slug } })}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    paddingHorizontal: 14, paddingVertical: 14,
                    borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.border,
                    backgroundColor: pressed ? colors.surface.linen : 'transparent',
                  })}
                >
                  <Text style={{ flex: 1, fontSize: 14, color: colors.ink }} numberOfLines={2}>
                    {lang === 'es' ? sib.title_es : sib.title_en}
                  </Text>
                  <ChevronRight size={16} color={colors.muted} strokeWidth={1.75} />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <Pressable
          onPress={() => router.push('/contact')}
          style={{ marginTop: 24, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.brand.whisper, borderRadius: 12, borderWidth: 1, borderColor: colors.brand.mist, padding: 16 }}
        >
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center' }}>
            <MessageCircle size={18} color="#fff" strokeWidth={1.75} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
              {lang === 'es' ? '¿Esto no resolvió tu duda?' : "Didn't answer your question?"}
            </Text>
            <Text style={{ fontSize: 12, color: colors.gray, marginTop: 2 }}>
              {lang === 'es' ? 'Escríbenos y te respondemos.' : 'Write to us and we will reply.'}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.muted} strokeWidth={1.75} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
