import { View, Text, ScrollView, Pressable, FlatList, Image, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  MessageSquarePlus,
  ArrowRight,
  Check,
  PackageCheck,
  ShoppingBasket,
  Settings2,
  CalendarClock,
  Star,
  PiggyBank,
  ChevronDown,
  Store as StoreIcon,
  BadgeCheck,
  CalendarCheck,
} from 'lucide-react-native';
import {
  useRashanPacks,
  useRashanSubscriptions,
  useProducts,
  resolveImageUrl,
  useAppContent,
  type RashanPack,
  type Product,
} from '@grocery-app/shared';
import { colors } from '../../src/constants/colors';
import { useLanguageStore } from '../../src/stores/languageStore';
import { useRashanStore } from '../../src/stores/rashanStore';
import AppHeader from '../../src/components/AppHeader';
import Skeleton from '../../src/components/Skeleton';
import RashanInterestSheet from '../../src/components/RashanInterestSheet';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * One card design for every pack — Cesto's and partners' alike.
 *
 * Mobile used to run a per-slug colour gradient and give `premium` a heavier
 * treatment, which is what web looked like before it unified them: a mixed
 * rail of Cesto and partner packs read as four unrelated components. Whose
 * pack it is now shows in exactly one place, the store pill.
 */
function PackCard({ pack, products, subscribed = false }: {
  pack: RashanPack;
  products: Product[];
  /** The customer already has a live rashan with this pack's store. */
  subscribed?: boolean;
}) {
  const router = useRouter();
  const { lang, t } = useLanguageStore();
  const initDraft = useRashanStore((s) => s.initDraft);
  const leadPrefill = useRashanStore((s) => s.leadPrefill);
  const isCustom = pack.is_custom || pack.slug === 'custom';
  const isFeatured = pack.slug === 'premium';
  const store = pack.store ?? null;
  const cover = pack.cover_url ? resolveImageUrl(pack.cover_url, 'tile') : null;

  // Live price from current variant prices when the items resolve; the pack's
  // stored base_price is the fallback.
  const price = isCustom ? null : (() => {
    let total = 0;
    for (const it of pack.items) {
      const p = products.find((x) => x.id === it.product_id);
      const v = p?.variants?.find((x) => x.id === it.variant_id);
      if (v) total += Number(v.price) * it.quantity;
    }
    return total > 0 ? total : Number(pack.base_price);
  })();

  // Three names on one line. Five filled the row and truncated, which reads as
  // a broken sentence rather than a list.
  const previewItems = pack.items.slice(0, 3)
    .map((it) => {
      const p = products.find((x) => x.id === it.product_id);
      return p ? (lang === 'en' ? p.name_en : p.name_es) : null;
    })
    .filter((n): n is string => !!n);

  /** Capped so one wordy pack cannot set the height of the whole rail. */
  const highlights = (lang === 'en' ? pack.highlights_en : pack.highlights_es).slice(0, 3);
  const badge = lang === 'en' ? pack.badge_en : pack.badge_es;

  // Household and cadence carry over from the interest sheet when it has been
  // filled in, so nobody answers the same two questions twice.
  const handleSelect = () => {
    initDraft(pack.slug, {
      items: pack.items,
      household: leadPrefill?.household ?? pack.household_default,
      frequency: leadPrefill?.frequency ?? 'monthly',
    });
    router.push(`/rashan/pack/${pack.slug}`);
  };

  return (
    <View style={{
      borderRadius: 12, overflow: 'hidden',
      borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
      backgroundColor: colors.surface.cream,
    }}>
      {/* Top panel — the uploaded cover when there is one, otherwise the brand
          tint with the oversized emoji packs shipped with before covers
          existed. The tint sits underneath either way, so a slow or broken
          image never leaves a white hole. */}
      <View style={{ height: 168, backgroundColor: colors.brand.mist, overflow: 'hidden' }}>
        {cover && (
          <>
            <Image source={{ uri: cover }} style={{ position: 'absolute', width: '100%', height: '100%' }} resizeMode="cover" />
            {/* The name sits on an image we do not control, so it needs a
                guaranteed contrast floor. */}
            <LinearGradient
              colors={['rgba(15,23,42,0.15)', 'rgba(15,23,42,0.35)', 'rgba(15,23,42,0.78)']}
              style={{ position: 'absolute', width: '100%', height: '100%' }}
            />
          </>
        )}
        {!cover && (
          <Text style={{ position: 'absolute', right: 4, bottom: -30, fontSize: 132, opacity: 0.8 }}>
            {pack.emoji ?? '🧺'}
          </Text>
        )}

        <View style={{ flex: 1, padding: 16, justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              {/* THE differentiator. A partner pack in a rail that also holds
                  Cesto's reads as Cesto's unless it says otherwise, and the
                  customer needs to know who is delivering it. Web links this
                  to the storefront; mobile has no store screen until
                  multi-vendor, so it is informational here. */}
              {store && (
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 5,
                  maxWidth: '100%', paddingLeft: 4, paddingRight: 9, paddingVertical: 4,
                  borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.92)',
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)',
                }}>
                  <View style={{
                    width: 20, height: 20, borderRadius: 10, overflow: 'hidden',
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: store.logo_bg ?? '#FFFFFF',
                    borderWidth: 1, borderColor: 'rgba(226,232,240,0.8)',
                  }}>
                    {store.logo_url
                      ? <Image source={{ uri: resolveImageUrl(store.logo_url, 'logo') }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
                      : <StoreIcon size={10} color={colors.muted} strokeWidth={2} />}
                  </View>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.ink, flexShrink: 1 }} numberOfLines={1}>
                    {store.name}
                  </Text>
                  {store.is_verified && <BadgeCheck size={11} color={colors.brand.DEFAULT} strokeWidth={2.5} />}
                </View>
              )}
              {!!badge && (
                <View style={{
                  paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999,
                  backgroundColor: cover ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.8)',
                }}>
                  <Text style={{
                    fontSize: 10, fontWeight: '800', letterSpacing: 1.4,
                    color: cover ? '#FFFFFF' : colors.brand.deepest,
                  }}>
                    {badge.toUpperCase()}
                  </Text>
                </View>
              )}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {isFeatured && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.amber.deep }}>
                  <Star size={9} color="#fff" fill="#fff" strokeWidth={2.5} />
                  <Text style={{ fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 1 }}>POPULAR</Text>
                </View>
              )}
              {/* Savings rides up here rather than beside the price: it used to
                  compete with the figure it is meant to support. */}
              {!isCustom && pack.estimated_savings_pct > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.9)' }}>
                  <PiggyBank size={10} color={colors.brand.deepest} strokeWidth={2.5} />
                  <Text style={{ fontSize: 10, fontWeight: '800', color: colors.brand.deepest }}>
                    {pack.estimated_savings_pct}%
                  </Text>
                </View>
              )}
            </View>
          </View>

          <View>
            <Text
              style={{ fontSize: 21, fontWeight: '700', letterSpacing: -0.4, lineHeight: 25, color: cover ? '#FFFFFF' : colors.ink }}
              numberOfLines={2}
            >
              {lang === 'en' ? pack.name_en : pack.name_es}
            </Text>
            {!!(lang === 'en' ? pack.tagline_en : pack.tagline_es) && (
              <Text
                style={{ fontSize: 12.5, marginTop: 3, color: cover ? 'rgba(255,255,255,0.85)' : colors.gray }}
                numberOfLines={1}
              >
                {lang === 'en' ? pack.tagline_en : pack.tagline_es}
              </Text>
            )}
          </View>
        </View>
      </View>

      <View style={{ padding: 16, flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
          {isCustom ? (
            <Text style={{ fontSize: 20, fontWeight: '600', color: colors.ink, letterSpacing: -0.3 }}>
              {t('rashan.packs.you_choose')}
            </Text>
          ) : (
            <>
              <Text style={{ fontSize: 10, fontWeight: '800', color: colors.muted, letterSpacing: 1.4 }}>
                {t('rashan.packs.from')}
              </Text>
              <Text style={{ fontSize: 26, fontWeight: '600', color: colors.ink, letterSpacing: -0.5 }}>
                {'€'}{price!.toFixed(2)}
              </Text>
              <Text style={{ fontSize: 11.5, color: colors.gray }}>
                {lang === 'en' ? '/ delivery' : '/ entrega'}
              </Text>
            </>
          )}
        </View>

        {!isCustom ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <PackageCheck size={12} color={colors.brand.DEFAULT} strokeWidth={2} />
            <Text style={{ fontSize: 11.5, color: colors.gray }}>
              {pack.items.length} {t('rashan.packs.items_count')}
            </Text>
            <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: colors.border }} />
            <Text style={{ fontSize: 11.5, color: colors.gray }}>
              {lang === 'en'
                ? `for ${pack.household_default}`
                : `para ${pack.household_default}`}
            </Text>
          </View>
        ) : (
          <Text style={{ fontSize: 12, color: colors.gray, marginTop: 6, lineHeight: 17 }} numberOfLines={2}>
            {t('rashan.packs.subtitle')}
          </Text>
        )}

        {highlights.length > 0 && (
          <View style={{ marginTop: 14, gap: 6 }}>
            {highlights.map((h) => (
              <View key={h} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <Check size={12} color={colors.brand.DEFAULT} strokeWidth={3} style={{ marginTop: 3 }} />
                <Text style={{ flex: 1, fontSize: 12.5, color: colors.charcoal, lineHeight: 18 }} numberOfLines={1}>
                  {h}
                </Text>
              </View>
            ))}
          </View>
        )}

        {previewItems.length > 0 && (
          <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 12 }} numberOfLines={1}>
            {previewItems.join(' · ')}
            {pack.items.length > previewItems.length && (
              <Text style={{ color: colors.brand.deepest, fontWeight: '700' }}>
                {`  +${pack.items.length - previewItems.length}`}
              </Text>
            )}
          </Text>
        )}

        {/* Already subscribed with this store: sending them into the builder
            would start a second rashan they probably do not want, so the card
            points at the one they have instead. */}
        {subscribed ? (
          <Pressable
            onPress={() => router.push('/rashan/subscription')}
            style={{
              marginTop: 16, height: 46, borderRadius: 999,
              backgroundColor: colors.brand.mist,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}
          >
            <CalendarCheck size={15} color={colors.brand.deepest} strokeWidth={2} />
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.brand.deepest }}>
              {lang === 'en' ? 'Manage your rashan' : 'Gestiona tu rashan'}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleSelect}
            style={({ pressed }) => ({
              marginTop: 16, height: 46, borderRadius: 999,
              backgroundColor: colors.brand.DEFAULT,
              alignItems: 'center', justifyContent: 'center',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>
              {isCustom ? t('rashan.packs.cta_custom') : t('rashan.packs.cta_premade')}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/**
 * The pack rail. Horizontal and snapping, like web — a vertical list of
 * 400px-tall cards meant three swipes to discover there was a third pack.
 */
function PacksSection({ subscribedStoreIds }: { subscribedStoreIds: Set<string | null> }) {
  const { t, lang } = useLanguageStore();
  const { data: packs, isLoading } = useRashanPacks();
  const { data: productsPage } = useProducts({ limit: 100 });
  const products = productsPage?.items ?? [];
  const [activeIndex, setActiveIndex] = useState(0);

  const list = packs ?? [];
  const cestoCount = list.filter((p) => !p.store_id).length;
  const partnerCount = list.length - cestoCount;

  // One card plus its gutter. Used for both the snap interval and to work out
  // which card the dots should highlight.
  const CARD_WIDTH = Math.min(SCREEN_WIDTH * 0.82, 340);
  const GAP = 14;
  const PITCH = CARD_WIDTH + GAP;

  return (
    <View>
      <SectionHeader
        eyebrow={lang === 'en' ? 'Choose your pack' : 'Elige tu pack'}
        title={t('rashan.packs.title')}
        subtitle={t('rashan.packs.subtitle')}
      />

      {!isLoading && list.length > 0 && (
        <Text style={{ fontSize: 12.5, color: colors.gray, paddingHorizontal: 16, marginBottom: 12 }}>
          {partnerCount > 0
            ? (lang === 'en'
              ? `${list.length} packs · ${cestoCount} from Cesto, ${partnerCount} from local stores`
              : `${list.length} packs · ${cestoCount} de Cesto, ${partnerCount} de tiendas locales`)
            : `${list.length} packs`}
        </Text>
      )}

      {isLoading ? (
        // Same width as a real card, so the rail does not reflow when the
        // skeletons are replaced.
        <View style={{ flexDirection: 'row', gap: GAP, paddingHorizontal: 16 }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <View key={i} style={{ width: CARD_WIDTH }}>
              <Skeleton height={430} borderRadius={12} />
            </View>
          ))}
        </View>
      ) : list.length === 0 ? (
        <View style={{ marginHorizontal: 16, backgroundColor: colors.surface.cream, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 32, alignItems: 'center' }}>
          <ShoppingBasket size={30} color={colors.muted} strokeWidth={1.5} />
          <Text style={{ fontSize: 14, color: colors.ink, textAlign: 'center', marginTop: 12, lineHeight: 20 }}>
            {lang === 'en'
              ? 'No rashan packs available in your area just yet.'
              : 'Aún no hay packs de rashan disponibles en tu zona.'}
          </Text>
        </View>
      ) : (
        <>
          <FlatList
            data={list}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={PITCH}
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: 16, gap: GAP }}
            keyExtractor={(item) => item.id}
            onScroll={(e) => {
              setActiveIndex(Math.round(e.nativeEvent.contentOffset.x / PITCH));
            }}
            scrollEventThrottle={16}
            renderItem={({ item }) => (
              <View style={{ width: CARD_WIDTH }}>
                <PackCard
                  pack={item}
                  products={products}
                  subscribed={subscribedStoreIds.has(item.store_id ?? null)}
                />
              </View>
            )}
          />

          {/* Position indicator, same as web's touch view. Not tappable here —
              a 6px dot is below the minimum touch target, and the rail is
              already swipeable. */}
          {list.length > 1 && (
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingTop: 12 }}>
              {list.map((pack, i) => (
                <View
                  key={pack.id}
                  style={{
                    height: 6,
                    width: i === activeIndex ? 20 : 6,
                    borderRadius: 3,
                    backgroundColor: i === activeIndex ? colors.brand.DEFAULT : colors.border,
                  }}
                />
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

function SectionHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <View style={{ alignItems: 'center', marginBottom: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.brand.mist, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}>
        <Text style={{ fontSize: 10, fontWeight: '700', color: colors.brand.DEFAULT, letterSpacing: 1.6, textTransform: 'uppercase' }}>
          {eyebrow}
        </Text>
      </View>
      <Text style={{ fontSize: 24, fontWeight: '700', color: colors.ink, letterSpacing: -0.6, marginTop: 10, textAlign: 'center', lineHeight: 28 }}>
        {title}
      </Text>
      {subtitle && (
        <Text style={{ fontSize: 13, color: colors.gray, marginTop: 8, lineHeight: 19, textAlign: 'center', maxWidth: 320 }}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

function HowItWorks() {
  const { t, lang } = useLanguageStore();
  const { data: content } = useAppContent();
  const bundled = [
    { icon: ShoppingBasket, title: t('rashan.how.step1'), desc: t('rashan.how.step1_desc') },
    { icon: Settings2, title: t('rashan.how.step2'), desc: t('rashan.how.step2_desc') },
    { icon: CalendarClock, title: t('rashan.how.step3'), desc: t('rashan.how.step3_desc') },
    { icon: PackageCheck, title: t('rashan.how.step4'), desc: t('rashan.how.step4_desc') },
  ];
  // Icons stay in code and are reused in order, so an admin adding a fifth
  // step gets the first icon back rather than an empty square.
  const remoteSteps = content?.rashan?.steps ?? [];
  const steps = remoteSteps.length
    ? remoteSteps.map((step, i) => ({
      icon: bundled[i % bundled.length].icon,
      title: lang === 'es' ? step.title_es : step.title_en,
      desc: lang === 'es' ? step.body_es : step.body_en,
    }))
    : bundled;
  return (
    <View style={{ marginTop: 32 }}>
      <SectionHeader
        eyebrow={lang === 'en' ? 'How it works' : 'Cómo funciona'}
        title={t('rashan.how.title')}
      />
      <View style={{ gap: 12 }}>
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <View
              key={s.title}
              style={{
                flexDirection: 'row',
                backgroundColor: colors.surface.cream,
                borderRadius: 8,
                padding: 16,
                borderWidth: 1,
                borderColor: 'rgba(226,232,240,0.7)',
                gap: 14,
              }}
            >
              <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: colors.surface.mint, justifyContent: 'center', alignItems: 'center' }}>
                <Icon size={22} color={colors.brand.deepest} strokeWidth={1.75} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: colors.muted }}>0{i + 1}</Text>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{s.title}</Text>
                </View>
                <Text style={{ fontSize: 13, color: colors.gray, lineHeight: 18 }}>{s.desc}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/* The testimonial card is gone: a named person, a quote, a location and a
   five-star rating, none of which came from a real customer. Invented
   reviews are the one kind of copy that is not just inaccurate but
   deceptive. Reinstate it when there is a real quote to use, with the
   customer's permission. Web carried the same card and lost it too. */

/* ───────── FAQ — accordion of 4 items. Inline bilingual strings since the
   mobile translations file doesn't carry rashan.faq.* keys; same copy as web. */
type FaqItem = { q_en: string; q_es: string; a_en: string; a_es: string };
const FAQ_ITEMS: FaqItem[] = [
  {
    q_en: 'Can I change what is in my pack?',
    q_es: '¿Puedo cambiar lo que viene en mi pack?',
    a_en: 'Yes. Adjust quantities, swap items, or add extras any time before the cut-off — three days before each delivery.',
    a_es: 'Sí. Ajusta cantidades, cambia productos o añade extras antes del cierre — tres días antes de cada entrega.',
  },
  {
    q_en: 'How does billing work?',
    q_es: '¿Cómo funciona el cobro?',
    a_en: 'You are charged the day before delivery, after the basket is finalised. Pause or cancel any time — no contracts.',
    a_es: 'Te cobramos el día antes de la entrega, tras cerrar la cesta. Pausa o cancela cuando quieras — sin contratos.',
  },
  {
    q_en: 'What if a product is out of stock?',
    q_es: '¿Y si un producto no está disponible?',
    a_en: 'We swap it for an equivalent we have on hand. You can opt out of swaps in your subscription settings.',
    a_es: 'Lo cambiamos por un equivalente disponible. Puedes desactivar los cambios en los ajustes de tu suscripción.',
  },
  {
    q_en: 'Where do you deliver?',
    q_es: '¿Dónde entregáis?',
    a_en: 'We deliver within our published service areas in Spain. Enter your postcode and the app will tell you whether we reach you.',
    a_es: 'Repartimos dentro de nuestras zonas de servicio en España. Indica tu código postal y la app te dirá si llegamos hasta ti.',
  },
];

function FAQ() {
  const { lang } = useLanguageStore();
  const { data: content } = useAppContent();
  const [open, setOpen] = useState<number | null>(0);
  // Admin -> App content, with the bundled list as the offline fallback.
  const remoteFaq = content?.rashan?.faq ?? [];
  const faqItems: FaqItem[] = remoteFaq.length
    ? remoteFaq.map((f) => ({ q_es: f.q_es, q_en: f.q_en, a_es: f.a_es, a_en: f.a_en }))
    : FAQ_ITEMS;
  return (
    <View style={{ marginTop: 32 }}>
      <SectionHeader
        eyebrow={lang === 'en' ? 'Common questions' : 'Preguntas frecuentes'}
        title={lang === 'en' ? 'Everything you might ask' : 'Todo lo que te puedas preguntar'}
      />
      <View style={{ gap: 10 }}>
        {faqItems.map((item, i) => {
          const isOpen = open === i;
          return (
            <View
              key={i}
              style={{
                borderRadius: 12,
                borderWidth: 1,
                borderColor: isOpen ? colors.brand.DEFAULT : 'rgba(226,232,240,0.7)',
                backgroundColor: colors.surface.cream,
              }}
            >
              <Pressable
                onPress={() => setOpen(isOpen ? null : i)}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, gap: 12 }}
              >
                <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink, lineHeight: 19 }}>
                  {lang === 'en' ? item.q_en : item.q_es}
                </Text>
                <View
                  style={{
                    width: 30, height: 30, borderRadius: 15,
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: isOpen ? colors.brand.DEFAULT : colors.brand.mist,
                    transform: [{ rotate: isOpen ? '180deg' : '0deg' }],
                  }}
                >
                  <ChevronDown size={14} color={isOpen ? '#fff' : colors.brand.DEFAULT} strokeWidth={2.5} />
                </View>
              </Pressable>
              {isOpen && (
                <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                  <Text style={{ fontSize: 13, color: colors.gray, lineHeight: 19 }}>
                    {lang === 'en' ? item.a_en : item.a_es}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/* ───────── FINAL CTA — dark wrap-up card, mirrors web FinalCTA. ───────── */
function FinalCTA({ onSeePacks, onSetUpForMe }: { onSeePacks: () => void; onSetUpForMe: () => void }) {
  const { lang, t } = useLanguageStore();
  return (
    <View style={{ marginTop: 32 }}>
      <View style={{ borderRadius: 18, overflow: 'hidden', backgroundColor: colors.ink, padding: 26 }}>
        <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', marginBottom: 14 }}>
          <ShoppingBasket size={11} color="#fff" strokeWidth={2.5} />
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#fff', letterSpacing: 1.6, textTransform: 'uppercase' }}>
            {lang === 'en' ? 'Ready when you are' : 'Listo cuando tú quieras'}
          </Text>
        </View>
        <Text style={{ fontSize: 26, fontWeight: '700', color: '#fff', lineHeight: 30, letterSpacing: -0.6 }}>
          {lang === 'en' ? 'Start your monthly rashan today.' : 'Empieza tu rashan mensual hoy.'}
        </Text>
        <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.72)', marginTop: 10, lineHeight: 19 }}>
          {lang === 'en'
            ? 'Pause, edit, or cancel anytime. No contracts. Just a pantry that always stays full.'
            : 'Pausa, edita o cancela cuando quieras. Sin contratos. Solo una despensa siempre llena.'}
        </Text>
        {/* Two CTAs, as on web: back up to the packs, or hand it over. It used
            to be a single button that jumped straight into the premium pack's
            builder — a choice the visitor had not made. */}
        <Pressable
          onPress={onSeePacks}
          style={({ pressed }) => ({
            alignSelf: 'flex-start',
            flexDirection: 'row', alignItems: 'center', gap: 8,
            height: 48, paddingHorizontal: 22, borderRadius: 999,
            backgroundColor: '#fff',
            marginTop: 20,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>
            {t('rashan.hero.cta_primary')}
          </Text>
          <ArrowRight size={15} color={colors.ink} strokeWidth={2.5} />
        </Pressable>

        <Pressable
          onPress={onSetUpForMe}
          style={({ pressed }) => ({
            alignSelf: 'flex-start',
            height: 48, paddingHorizontal: 20, borderRadius: 999,
            justifyContent: 'center',
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
            marginTop: 10,
            backgroundColor: pressed ? 'rgba(255,255,255,0.1)' : 'transparent',
          })}
        >
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>
            {lang === 'en' ? 'Or let us set it up for you' : 'O deja que lo preparemos por ti'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function ActiveSubBanner({ onView }: { onView: () => void }) {
  const { t, lang } = useLanguageStore();
  return (
    <Pressable
      onPress={onView}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: colors.brand.whisper,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: 'rgba(226,232,240,0.7)',
        padding: 14,
        marginBottom: 16,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center' }}>
        <ShoppingBasket size={18} color={colors.brand.deepest} strokeWidth={1.75} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>
          {t('rashan.sub.title')}
        </Text>
        <Text style={{ fontSize: 12, color: colors.gray }}>
          {lang === 'en' ? 'Tap to manage your subscription' : 'Toca para gestionar tu suscripción'}
        </Text>
      </View>
      <ArrowRight size={16} color={colors.brand.deepest} strokeWidth={2} />
    </Pressable>
  );
}

export default function RashanLandingScreen() {
  const router = useRouter();
  const { t, lang } = useLanguageStore();
  const { data: subscriptions } = useRashanSubscriptions();
  const [interestOpen, setInterestOpen] = useState(false);
  // Web's CTAs scroll to a section rather than navigating. Same here: measure
  // each anchor's offset on layout and scroll the list to it.
  const scrollRef = useRef<ScrollView>(null);
  const packsY = useRef(0);
  const interestY = useRef(0);
  const scrollTo = (y: number) =>
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });

  const active = useMemo(
    () => (subscriptions ?? []).filter((s) => s.status !== 'cancelled'),
    [subscriptions],
  );
  // Which stores the customer already has a live rashan with. A pack from one
  // of them offers "manage" instead of starting a second subscription they
  // probably do not want. NULL is Cesto's own key.
  const subscribedStoreIds = useMemo(
    () => new Set<string | null>(active.map((s) => s.store_id ?? null)),
    [active],
  );


  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={[]}>
      <AppHeader />
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <LinearGradient
          colors={[colors.surface.dune, colors.surface.linen, colors.surface.mint]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 8, padding: 24, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', marginBottom: 24 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.8)', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
            <ShoppingBasket size={11} color={colors.brand.DEFAULT} strokeWidth={2.5} />
            <Text style={{ fontSize: 10, fontWeight: '700', color: colors.ink, letterSpacing: 2 }}>
              {t('rashan.hero.eyebrow')}
            </Text>
          </View>
          <Text style={{ fontSize: 34, fontWeight: '700', color: colors.ink, lineHeight: 38, letterSpacing: -1 }}>
            {t('rashan.hero.title')}
          </Text>
          <Text style={{ fontSize: 14, color: colors.gray, marginTop: 12, lineHeight: 20 }}>
            {t('rashan.hero.subtitle')}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 }}>
            <View style={{ flexDirection: 'row' }}>
              {['👩🏽', '👨🏻', '👵🏽', '👦🏾'].map((e, i) => (
                <View
                  key={i}
                  style={{
                    width: 30, height: 30, borderRadius: 15,
                    backgroundColor: '#fff', borderWidth: 2, borderColor: colors.surface.linen,
                    justifyContent: 'center', alignItems: 'center',
                    marginLeft: i === 0 ? 0 : -8,
                  }}
                >
                  <Text style={{ fontSize: 13 }}>{e}</Text>
                </View>
              ))}
            </View>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star key={i} size={11} color={colors.amber.DEFAULT} fill={colors.amber.DEFAULT} strokeWidth={2} />
                ))}
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.ink, marginLeft: 4 }}>4.9</Text>
              </View>
              <Text style={{ fontSize: 10, color: colors.gray, marginTop: 1 }}>
                {lang === 'en' ? '2,400+ families in Spain' : '2.400+ familias en España'}
              </Text>
            </View>
          </View>

          {/* Single CTA into the interest sheet, as on web — the sheet is what
              works out household size and cadence and hands back a matched
              pack, so it is the highest-intent path rather than a secondary
              escape hatch. The hero had no CTA at all on mobile. */}
          <Pressable
            onPress={() => setInterestOpen(true)}
            style={({ pressed }) => ({
              marginTop: 22, alignSelf: 'flex-start',
              flexDirection: 'row', alignItems: 'center', gap: 8,
              height: 48, paddingHorizontal: 22, borderRadius: 999,
              backgroundColor: colors.brand.DEFAULT,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#fff' }}>
              {lang === 'en' ? 'Join the Cesto Monthly Subscription' : 'Únete a la suscripción mensual de Cesto'}
            </Text>
            <ArrowRight size={15} color="#fff" strokeWidth={2.5} />
          </Pressable>
        </LinearGradient>

        {active.length > 0 && (
          <ActiveSubBanner onView={() => router.push('/rashan/subscription')} />
        )}

        <View onLayout={(e) => { packsY.current = e.nativeEvent.layout.y; }}>
          <PacksSection subscribedStoreIds={subscribedStoreIds} />
        </View>

        {/* Between the packs and "how it works", matching web: by here the
            visitor has seen what is on offer and either found their pack or
            not, which is exactly when a "tell us what you need" prompt is
            worth reading rather than an interruption. */}
        <Pressable
          onLayout={(e) => { interestY.current = e.nativeEvent.layout.y; }}
          onPress={() => setInterestOpen(true)}
          style={{ marginHorizontal: 16, marginTop: 8, marginBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.brand.whisper, borderRadius: 14, borderWidth: 1, borderColor: colors.brand.mist, padding: 16 }}
        >
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center' }}>
            <MessageSquarePlus size={19} color="#fff" strokeWidth={1.75} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14.5, fontWeight: '700', color: colors.ink }}>
              {lang === 'es' ? '¿No encuentras tu pack?' : "Can't find your pack?"}
            </Text>
            <Text style={{ fontSize: 12.5, color: colors.gray, marginTop: 2, lineHeight: 17 }}>
              {lang === 'es'
                ? 'Cuéntanos qué necesitas y te preparamos uno a medida.'
                : 'Tell us what you need and we will build one around it.'}
            </Text>
          </View>
        </Pressable>

        <HowItWorks />
        <FinalCTA onSeePacks={() => scrollTo(packsY.current)} onSetUpForMe={() => setInterestOpen(true)} />
        <FAQ />
      </ScrollView>

      <RashanInterestSheet visible={interestOpen} onClose={() => setInterestOpen(false)} />
    </SafeAreaView>
  );
}
