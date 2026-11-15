/**
 * Help centre — the admin-authored article tree from /api/help-center.
 *
 * Distinct from /faq, which is a fixed list of the same handful of questions
 * web hardcodes on its own FAQ page. This screen is the one that changes when
 * someone publishes an article in admin; before this existed, mobile shipped a
 * static array and nothing an admin wrote ever reached the app.
 */
import { View, Text, ScrollView, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ArrowLeft, Search, ChevronRight, HelpCircle, LifeBuoy, Package, Truck,
  CreditCard, User, ShieldCheck, RotateCcw, MessageCircle, X,
} from 'lucide-react-native';
import { useHelpCenter } from '@grocery-app/shared';
import type { HelpCategory } from '@grocery-app/shared';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import Skeleton from '../src/components/Skeleton';

// Categories carry a Lucide icon *name* from admin, so it has to be resolved
// through a fixed map — bundlers cannot tree-shake a dynamic lookup into the
// icon library, and an unknown name must not crash the screen.
const ICON_MAP: Record<string, typeof HelpCircle> = {
  package: Package,
  truck: Truck,
  'credit-card': CreditCard,
  user: User,
  'shield-check': ShieldCheck,
  'rotate-ccw': RotateCcw,
  'message-circle': MessageCircle,
  'life-buoy': LifeBuoy,
  'help-circle': HelpCircle,
};

function iconFor(name: string | null | undefined) {
  return (name && ICON_MAP[name]) || HelpCircle;
}

export default function HelpCenterScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const { data: categories, isLoading, isError } = useHelpCenter();
  const [query, setQuery] = useState('');

  const title = (c: { title_en: string; title_es: string }) =>
    lang === 'es' ? c.title_es : c.title_en;

  // Search filters articles, then drops categories left with nothing. Done on
  // the client because the payload is the whole tree already — a round trip
  // per keystroke would be slower and no more accurate.
  const filtered = useMemo<HelpCategory[]>(() => {
    const all = categories ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all
      .map((cat) => ({
        ...cat,
        articles: (cat.articles ?? []).filter((a) =>
          title(a).toLowerCase().includes(q) || title(cat).toLowerCase().includes(q),
        ),
      }))
      .filter((cat) => (cat.articles ?? []).length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, query, lang]);

  const totalArticles = (categories ?? []).reduce(
    (n, c) => n + (c.articles?.length ?? c._count?.articles ?? 0),
    0,
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          {lang === 'es' ? 'Centro de ayuda' : 'Help centre'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardDismissMode="on-drag">
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 46, backgroundColor: colors.surface.white, borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border }}>
          <Search size={18} color={colors.muted} strokeWidth={1.75} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={lang === 'es' ? 'Buscar en la ayuda…' : 'Search help…'}
            placeholderTextColor={colors.muted}
            style={{ flex: 1, fontSize: 15, color: colors.ink, marginLeft: 8, paddingVertical: 0 }}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <X size={18} color={colors.muted} strokeWidth={1.75} />
            </Pressable>
          )}
        </View>

        {!isLoading && !isError && totalArticles > 0 && !query && (
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 10 }}>
            {lang === 'es'
              ? `${totalArticles} ${totalArticles === 1 ? 'artículo' : 'artículos'} en ${(categories ?? []).length} ${(categories ?? []).length === 1 ? 'categoría' : 'categorías'}`
              : `${totalArticles} ${totalArticles === 1 ? 'article' : 'articles'} across ${(categories ?? []).length} ${(categories ?? []).length === 1 ? 'category' : 'categories'}`}
          </Text>
        )}

        {isLoading && (
          <View style={{ gap: 12, marginTop: 18 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <View key={i} style={{ backgroundColor: colors.surface.cream, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10 }}>
                <Skeleton height={16} width="45%" />
                <Skeleton height={12} width="70%" />
                <Skeleton height={12} width="60%" />
              </View>
            ))}
          </View>
        )}

        {isError && (
          <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.dangerBg, justifyContent: 'center', alignItems: 'center', marginBottom: 14 }}>
              <LifeBuoy size={28} color={colors.danger} strokeWidth={1.5} />
            </View>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
              {lang === 'es' ? 'No pudimos cargar la ayuda' : "We couldn't load help"}
            </Text>
            <Text style={{ fontSize: 13, color: colors.gray, textAlign: 'center', marginTop: 6, lineHeight: 19 }}>
              {lang === 'es'
                ? 'Revisa tu conexión e inténtalo de nuevo. Mientras tanto, escríbenos.'
                : 'Check your connection and try again. In the meantime, get in touch.'}
            </Text>
            <Pressable
              onPress={() => router.push('/contact')}
              style={{ marginTop: 18, height: 52, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
                {lang === 'es' ? 'Contactar con soporte' : 'Contact support'}
              </Text>
            </Pressable>
          </View>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center', marginBottom: 14 }}>
              <Search size={26} color={colors.muted} strokeWidth={1.5} />
            </View>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
              {query
                ? (lang === 'es' ? 'Sin resultados' : 'No results')
                : (lang === 'es' ? 'Aún no hay artículos' : 'No articles yet')}
            </Text>
            <Text style={{ fontSize: 13, color: colors.gray, textAlign: 'center', marginTop: 6, lineHeight: 19 }}>
              {query
                ? (lang === 'es' ? 'Prueba con otras palabras o escríbenos directamente.' : 'Try different words, or just write to us.')
                : (lang === 'es' ? 'Estamos preparando la ayuda. Mientras tanto, escríbenos.' : "We're still writing these. In the meantime, get in touch.")}
            </Text>
            <Pressable
              onPress={() => router.push('/contact')}
              style={{ marginTop: 18, height: 52, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
                {lang === 'es' ? 'Contactar con soporte' : 'Contact support'}
              </Text>
            </Pressable>
          </View>
        )}

        {filtered.map((cat) => {
          const Icon = iconFor(cat.icon);
          const articles = cat.articles ?? [];
          return (
            <View key={cat.id} style={{ marginTop: 18 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center' }}>
                  <Icon size={17} color={colors.brand.deepest} strokeWidth={1.75} />
                </View>
                <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: colors.ink }}>
                  {title(cat)}
                </Text>
              </View>

              <View style={{ backgroundColor: colors.surface.cream, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', overflow: 'hidden' }}>
                {articles.map((article, i) => (
                  <Pressable
                    key={article.id}
                    onPress={() => router.push({ pathname: '/help/[slug]', params: { slug: article.slug } })}
                    style={({ pressed }) => ({
                      flexDirection: 'row', alignItems: 'center', gap: 10,
                      paddingHorizontal: 14, paddingVertical: 14,
                      borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.border,
                      backgroundColor: pressed ? colors.surface.linen : 'transparent',
                    })}
                  >
                    <Text style={{ flex: 1, fontSize: 14, color: colors.ink }} numberOfLines={2}>
                      {title(article)}
                    </Text>
                    <ChevronRight size={16} color={colors.muted} strokeWidth={1.75} />
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}

        {!isLoading && !isError && filtered.length > 0 && (
          <Pressable
            onPress={() => router.push('/contact')}
            style={{ marginTop: 24, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.brand.whisper, borderRadius: 12, borderWidth: 1, borderColor: colors.brand.mist, padding: 16 }}
          >
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center' }}>
              <MessageCircle size={18} color="#fff" strokeWidth={1.75} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
                {lang === 'es' ? '¿Sigues necesitando ayuda?' : 'Still need help?'}
              </Text>
              <Text style={{ fontSize: 12, color: colors.gray, marginTop: 2 }}>
                {lang === 'es' ? 'Escríbenos y te respondemos.' : 'Write to us and we will reply.'}
              </Text>
            </View>
            <ChevronRight size={18} color={colors.muted} strokeWidth={1.75} />
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
