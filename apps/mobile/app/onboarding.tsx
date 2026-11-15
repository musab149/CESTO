import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Animated,
  Dimensions,
  FlatList,
  StyleSheet,
  StatusBar,
  Easing,
  ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Pattern, Circle as SvgCircle, Rect } from 'react-native-svg';
import { useRouter } from 'expo-router';
import {
  Apple,
  Leaf,
  Truck,
  ShoppingBasket,
  Plus,
  Minus,
  Check,
  MapPin,
  Repeat,
  Star,
  Phone,
  MessageSquare,
} from 'lucide-react-native';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import { useAppContent } from '@grocery-app/shared';
import { useOnboardingStore } from '../src/stores/onboardingStore';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Illustration = 'fresh' | 'rashan' | 'delivery';

interface Slide {
  key: string;
  eyebrow: string;
  titleLines: [string, string];
  body: string;
  gradient: readonly [string, string, string];
  illustration: Illustration;
}

function useBundledSlides(): Slide[] {
  const { lang } = useLanguageStore();
  const BRAND_GRADIENT: [string, string, string] = ['#022B91', '#054EE8', '#2A6AEF'];

  if (lang === 'es') {
    return [
      {
        key: 'fresh',
        eyebrow: 'Bienvenido a Cesto',
        titleLines: ['La compra fresca,', 'a tu puerta.'],
        body:
          'Productos seleccionados a mano de los mejores mercados de España. Añade, ajusta y paga en segundos.',
        gradient: BRAND_GRADIENT,
        illustration: 'fresh',
      },
      {
        key: 'rashan',
        eyebrow: 'Rashan Mensual',
        titleLines: ['Una despensa', 'siempre llena.'],
        body:
          'Suscríbete una vez y olvídate. Ajusta el pack a tu hogar y elige la frecuencia — pausa o salta cuando quieras.',
        gradient: BRAND_GRADIENT,
        illustration: 'rashan',
      },
      {
        key: 'delivery',
        eyebrow: 'Rápido y de confianza',
        titleLines: ['En tu cocina,', 'sin salir de casa.'],
        body:
          'Sigue el estado de tu pedido en cada paso y paga al recibirlo: efectivo o tarjeta.',
        gradient: BRAND_GRADIENT,
        illustration: 'delivery',
      },
    ];
  }
  return [
    {
      key: 'fresh',
      eyebrow: 'Welcome to Cesto',
      titleLines: ['Fresh groceries,', 'quietly delivered.'],
      body:
        'Hand-picked produce and pantry staples from across Spain. Add, fine-tune and check out in seconds.',
      gradient: BRAND_GRADIENT,
      illustration: 'fresh',
    },
    {
      key: 'rashan',
      eyebrow: 'Monthly Rashan',
      titleLines: ['A pantry that', 'never runs empty.'],
      body:
        'Subscribe once, never run out. Size your pack to your household and pick the cadence — pause or skip anytime.',
      gradient: BRAND_GRADIENT,
      illustration: 'rashan',
    },
    {
      key: 'delivery',
      eyebrow: 'Fast & reliable',
      titleLines: ['On your counter,', 'without leaving home.'],
      body:
        'Follow your order at every step and pay when it arrives: cash or card.',
      gradient: BRAND_GRADIENT,
      illustration: 'delivery',
    },
  ];
}

/**
 * Slides, preferring what Admin → App content says.
 *
 * The bundled copy stays as the fallback rather than being deleted: this is
 * the first screen of a first launch, quite possibly before there is a working
 * connection, and an empty onboarding is a worse failure than slightly stale
 * wording.
 *
 * Gradients and illustrations are not editable — they are drawn in code, and
 * the illustration is chosen by the slide's key. A key admin does not
 * recognise keeps the artwork of the slide in that position.
 */
function useSlides(): Slide[] {
  const { lang } = useLanguageStore();
  const bundled = useBundledSlides();
  const { data: content } = useAppContent();
  const remote = content?.onboarding?.slides;

  if (!remote?.length) return bundled;

  const known: Illustration[] = ['fresh', 'rashan', 'delivery'];
  return remote.map((slide, i) => {
    const fallback = bundled[i] ?? bundled[bundled.length - 1];
    // Regex, not '\n': a textarea in admin on Windows submits CRLF, and a
    // stray \r would render as a blank second line on the phone.
    const [first, second] = (lang === 'es' ? slide.title_es : slide.title_en).split(/\r?\n/);
    return {
      key: slide.key || fallback.key,
      eyebrow: lang === 'es' ? slide.eyebrow_es : slide.eyebrow_en,
      titleLines: [first ?? '', second ?? ''],
      body: lang === 'es' ? slide.body_es : slide.body_en,
      gradient: fallback.gradient,
      illustration: known.includes(slide.key as Illustration)
        ? (slide.key as Illustration)
        : fallback.illustration,
    };
  });
}

/* ------------------------------------------------------------- */
/*  Dotted backdrop — mirrors apps/web AuthLayout BrandPanel     */
/* ------------------------------------------------------------- */
function DotPattern() {
  return (
    <Svg
      width="100%"
      height="100%"
      style={StyleSheet.absoluteFillObject}
      opacity={0.1}
      pointerEvents="none"
    >
      <Defs>
        <Pattern
          id="cestoDots"
          x="0"
          y="0"
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
        >
          <SvgCircle cx="12" cy="12" r="1" fill="#fff" />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#cestoDots)" />
    </Svg>
  );
}

/* ------------------------------------------------------------- */
/*  Reusable tap cursor                                          */
/* ------------------------------------------------------------- */
interface CursorProps {
  x: Animated.Value;
  y: Animated.Value;
  press: Animated.Value;
  opacity: Animated.Value;
  ripple: Animated.Value;
}

function TapCursor({ x, y, press, opacity, ripple }: CursorProps) {
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.78] });
  const rippleScale = ripple.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.4] });
  const rippleOpacity = ripple.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: -22,
        top: -22,
        width: 44,
        height: 44,
        opacity,
        transform: [{ translateX: x }, { translateY: y }],
        zIndex: 50,
      }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: colors.brand.DEFAULT,
          opacity: rippleOpacity,
          transform: [{ scale: rippleScale }],
        }}
      />
      <Animated.View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: 'rgba(15, 23, 42, 0.16)',
          borderWidth: 2.5,
          borderColor: '#fff',
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.18,
          shadowRadius: 8,
          elevation: 6,
          transform: [{ scale }],
        }}
      >
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: '#fff',
          }}
        />
      </Animated.View>
    </Animated.View>
  );
}

function useCursorRig() {
  return {
    x: useRef(new Animated.Value(0)).current,
    y: useRef(new Animated.Value(0)).current,
    press: useRef(new Animated.Value(0)).current,
    opacity: useRef(new Animated.Value(0)).current,
    ripple: useRef(new Animated.Value(0)).current,
  };
}

/** Move cursor + press + emit ripple at the target. */
function tapAt(rig: ReturnType<typeof useCursorRig>, tx: number, ty: number, moveMs = 700) {
  return Animated.sequence([
    Animated.parallel([
      Animated.timing(rig.x, {
        toValue: tx,
        duration: moveMs,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(rig.y, {
        toValue: ty,
        duration: moveMs,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]),
    Animated.parallel([
      Animated.sequence([
        Animated.timing(rig.press, {
          toValue: 1,
          duration: 110,
          useNativeDriver: true,
        }),
        Animated.timing(rig.press, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(rig.ripple, { toValue: 0, duration: 1, useNativeDriver: true }),
        Animated.timing(rig.ripple, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]),
  ]);
}

/* ------------------------------------------------------------- */
/*  Slide 1 — Fresh: tap Add → stepper appears → tap +           */
/*  Mirrors src/components/ProductCard.tsx                       */
/* ------------------------------------------------------------- */
function FreshAnimation() {
  const rig = useCursorRig();
  const stepper = useRef(new Animated.Value(0)).current; // 0 = Add btn, 1 = stepper
  const qty = useRef(new Animated.Value(0)).current;
  const cardLift = useRef(new Animated.Value(0)).current;
  const cartCount = useRef(new Animated.Value(0)).current; // 0,1,2 items
  const cartBump = useRef(new Animated.Value(0)).current; // 0 hidden, 1 visible (bumped)

  useEffect(() => {
    // Card is 220 wide. 4:3 image ≈ 165 tall. Content = padding 12 + name (16)
    // + gap 4 + rating (14) + gap 4 + price row (22) + paddingTop 10 + btn 38 + padding 12 ≈ 132.
    // Total card height ≈ 297. Button center y ≈ 165 + 12 + 16 + 4 + 14 + 4 + 22 + 10 + 19 ≈ 266.
    const startX = -30;
    const startY = -40;
    const addBtnX = 110;
    const addBtnY = 266;
    const plusBtnX = 196;
    const plusBtnY = 266;

    rig.x.setValue(startX);
    rig.y.setValue(startY);
    cartBump.setValue(1);

    // Build a fresh cycle each iteration — RN compositions get consumed
    // when started, so reusing the same sequence inside Animated.loop hangs.
    const buildCycle = () =>
      Animated.sequence([
        Animated.timing(rig.opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.delay(280),
        // Tap "Add"
        tapAt(rig, addBtnX, addBtnY, 780),
        Animated.parallel([
          Animated.timing(stepper, { toValue: 1, duration: 280, useNativeDriver: false }),
          Animated.timing(qty, { toValue: 1, duration: 280, useNativeDriver: false }),
          Animated.timing(cartCount, { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(cardLift, { toValue: 1, duration: 160, useNativeDriver: true }),
            Animated.timing(cardLift, { toValue: 0, duration: 220, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(cartBump, { toValue: 1.25, duration: 130, useNativeDriver: true }),
            Animated.timing(cartBump, { toValue: 1, duration: 200, useNativeDriver: true }),
          ]),
        ]),
        Animated.delay(550),
        // Tap "+"
        tapAt(rig, plusBtnX, plusBtnY, 520),
        Animated.parallel([
          Animated.timing(qty, { toValue: 2, duration: 220, useNativeDriver: false }),
          Animated.timing(cartCount, { toValue: 2, duration: 220, useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(cartBump, { toValue: 1.25, duration: 130, useNativeDriver: true }),
            Animated.timing(cartBump, { toValue: 1, duration: 200, useNativeDriver: true }),
          ]),
        ]),
        Animated.delay(950),
        // Reset
        Animated.timing(rig.opacity, { toValue: 0, duration: 350, useNativeDriver: true }),
        Animated.parallel([
          Animated.timing(stepper, { toValue: 0, duration: 250, useNativeDriver: false }),
          Animated.timing(qty, { toValue: 0, duration: 1, useNativeDriver: false }),
          Animated.timing(cartCount, { toValue: 0, duration: 250, useNativeDriver: true }),
        ]),
        Animated.delay(400),
      ]);

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      buildCycle().start(({ finished }) => {
        if (finished && !cancelled) {
          rig.x.setValue(startX);
          rig.y.setValue(startY);
          tick();
        }
      });
    };
    tick();

    return () => {
      cancelled = true;
    };
  }, []);

  const addOpacity = stepper.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0, 0] });
  const stepperOpacity = stepper.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] });
  const cardTranslate = cardLift.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });
  const cartDotOpacity = cartCount.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 0, 1],
  });

  return (
    <View style={styles.illustrationFrame}>
      <View style={[styles.chip, { backgroundColor: 'rgba(255,255,255,0.95)', top: 20, left: 22 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brand.DEFAULT }} />
          <Text style={styles.chipText}>Picked today</Text>
        </View>
      </View>

      {/* Cart badge at top-right */}
      <View style={styles.cartBadge}>
        <ShoppingBasket size={16} color={colors.ink} strokeWidth={1.75} />
        <Animated.View
          style={[
            styles.cartCountDot,
            {
              opacity: cartDotOpacity,
              transform: [{ scale: cartBump }],
            },
          ]}
        >
          <Text style={styles.cartCountText}>
            <CartCounter value={cartCount} />
          </Text>
        </Animated.View>
      </View>

      {/* Decorative secondary card — also mirroring ProductCard, smaller */}
      <View style={styles.miniProductCard}>
        <View style={styles.miniProductImage}>
          <Leaf size={20} color={colors.brand.deepest} strokeWidth={1.6} />
        </View>
        <View style={{ paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8 }}>
          <Text numberOfLines={1} style={styles.miniProductName}>Organic Basil</Text>
          <Text style={styles.miniProductPrice}>€1.80</Text>
        </View>
      </View>

      {/* Centered card group */}
      <View style={styles.freshGroup}>
        <Animated.View
          style={[
            styles.productCard,
            { transform: [{ translateY: cardTranslate }] },
          ]}
        >
          {/* Image area, 4:3 with surface.sand bg */}
          <View style={styles.productImageWrap}>
            <Apple size={56} color={colors.brand.deepest} strokeWidth={1.4} />
            <View style={styles.discountBadge}>
              <Text style={styles.discountText}>−15%</Text>
            </View>
          </View>

          {/* Content */}
          <View style={styles.productContent}>
            <Text numberOfLines={2} style={styles.productName}>
              Honey Crisp Apples
            </Text>
            <View style={styles.ratingRow}>
              <Star size={11} color={colors.amber.deep} fill={colors.amber.deep} strokeWidth={1.5} />
              <Text style={styles.ratingText}>4.8</Text>
              <Text style={styles.ratingReviews}>· 132 reviews</Text>
            </View>
            <View style={styles.priceRow}>
              <Text style={styles.productPrice}>€2.40</Text>
              <Text style={styles.compareAtPrice}>€2.80</Text>
              <Text style={styles.unitMeta}>· 1 kg</Text>
            </View>

            {/* Add / Stepper */}
            <View style={styles.addRow}>
              {/* Add button */}
              <Animated.View
                style={[styles.addBtn, { opacity: addOpacity }]}
                pointerEvents="none"
              >
                <Plus size={14} color="#fff" strokeWidth={2.5} />
                <Text style={styles.addBtnText}>Add</Text>
              </Animated.View>

              {/* Stepper */}
              <Animated.View
                style={[styles.stepper, { opacity: stepperOpacity }]}
                pointerEvents="none"
              >
                <View style={styles.stepperBtn}>
                  <Minus size={14} color={colors.brand.deepest} strokeWidth={2.5} />
                </View>
                <AnimatedCounter value={qty} />
                <View style={styles.stepperBtn}>
                  <Plus size={14} color={colors.brand.deepest} strokeWidth={2.5} />
                </View>
              </Animated.View>
            </View>
          </View>
        </Animated.View>

        <TapCursor {...rig} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------- */
/*  Slide 2 — Rashan: household + → swap frequency               */
/*  Mirrors app/rashan/pack/[id].tsx household + frequency cards */
/* ------------------------------------------------------------- */
function RashanAnimation() {
  const rig = useCursorRig();
  const household = useRef(new Animated.Value(0)).current; // 0,1,2 → 3,4,5
  const freqActive = useRef(new Animated.Value(1)).current; // 0=biweekly, 1=monthly, 2=6weeks
  const bump = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const groupW = SCREEN_WIDTH - 96;
    // Household card ≈ 122 tall. Plus btn at y 62, x = group_w - 38.
    // Frequency card starts at y 134. Option 1 (biweekly) center y ≈ 196.
    const plusX = groupW - 38;
    const plusY = 62;
    const freqX = groupW / 2;
    const freqY = 196;

    rig.x.setValue(-30);
    rig.y.setValue(-40);

    // RN compositions get consumed on start, so we rebuild the cycle each loop.
    const buildCycle = () =>
      Animated.sequence([
        Animated.timing(rig.opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.delay(280),

        // Tap household + twice (3 → 4 → 5)
        tapAt(rig, plusX, plusY, 700),
        Animated.parallel([
          Animated.timing(household, { toValue: 1, duration: 220, useNativeDriver: false }),
          Animated.sequence([
            Animated.timing(bump, { toValue: 1.08, duration: 130, useNativeDriver: true }),
            Animated.timing(bump, { toValue: 1, duration: 200, useNativeDriver: true }),
          ]),
        ]),
        Animated.delay(260),

        tapAt(rig, plusX, plusY, 380),
        Animated.parallel([
          Animated.timing(household, { toValue: 2, duration: 220, useNativeDriver: false }),
          Animated.sequence([
            Animated.timing(bump, { toValue: 1.08, duration: 130, useNativeDriver: true }),
            Animated.timing(bump, { toValue: 1, duration: 200, useNativeDriver: true }),
          ]),
        ]),
        Animated.delay(420),

        // Move down and tap "Every 2 weeks"
        tapAt(rig, freqX, freqY, 760),
        Animated.parallel([
          Animated.timing(freqActive, { toValue: 0, duration: 320, useNativeDriver: false }),
          Animated.sequence([
            Animated.timing(bump, { toValue: 1.04, duration: 140, useNativeDriver: true }),
            Animated.timing(bump, { toValue: 1, duration: 200, useNativeDriver: true }),
          ]),
        ]),
        Animated.delay(950),

        // Reset
        Animated.timing(rig.opacity, { toValue: 0, duration: 350, useNativeDriver: true }),
        Animated.timing(household, { toValue: 0, duration: 1, useNativeDriver: false }),
        Animated.timing(freqActive, { toValue: 1, duration: 1, useNativeDriver: false }),
        Animated.delay(400),
      ]);

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      buildCycle().start(({ finished }) => {
        if (finished && !cancelled) {
          rig.x.setValue(-30);
          rig.y.setValue(-40);
          tick();
        }
      });
    };
    tick();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.illustrationFrame}>
      <View style={[styles.chip, { backgroundColor: 'rgba(255,255,255,0.95)', top: 20, right: 22 }]}>
        <Text style={[styles.chipText, { color: colors.brand.deepest }]}>Subscription</Text>
      </View>

      <View style={styles.rashanGroup}>
        {/* Household card */}
        <View style={styles.builderCard}>
          <View style={styles.builderHeader}>
            <ShoppingBasket size={13} color={colors.charcoal} strokeWidth={2} />
            <Text style={styles.builderHeaderText}>HOUSEHOLD</Text>
          </View>
          <View style={styles.householdRow}>
            <View style={styles.householdStepBtn}>
              <Minus size={14} color={colors.ink} strokeWidth={2.25} />
            </View>
            <Animated.Text
              style={[styles.householdLabel, { transform: [{ scale: bump }] }]}
            >
              <HouseholdLabel value={household} />
            </Animated.Text>
            <View style={[styles.householdStepBtn, styles.householdStepBtnActive]}>
              <Plus size={14} color={colors.ink} strokeWidth={2.25} />
            </View>
          </View>
          <Text style={styles.builderHelp}>
            <HouseholdHelp value={household} />
          </Text>
        </View>

        {/* Frequency card */}
        <View style={[styles.builderCard, { marginTop: 12 }]}>
          <View style={styles.builderHeader}>
            <Repeat size={13} color={colors.charcoal} strokeWidth={2} />
            <Text style={styles.builderHeaderText}>FREQUENCY</Text>
          </View>
          <View style={{ gap: 6 }}>
            <FrequencyOption label="Every 2 weeks" index={0} active={freqActive} />
            <FrequencyOption label="Every month" index={1} active={freqActive} />
            <FrequencyOption label="Every 6 weeks" index={2} active={freqActive} />
          </View>
        </View>

        {/* Subscription summary card */}
        <Animated.View
          style={[styles.summaryCard, { transform: [{ scale: bump }] }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.summaryEyebrow}>YOUR PACK</Text>
            <Text style={styles.summaryTitle}>Family Essentials · 18 items</Text>
            <Text style={styles.summarySubtext}>
              <FreqLabel value={freqActive} /> · for <HouseholdLabel value={household} />
            </Text>
          </View>
          <View style={styles.summaryPriceBlock}>
            <Text style={styles.summaryEyebrow}>PER DELIVERY</Text>
            <Text style={styles.summaryPrice}>
              €<SummaryTotal value={household} />
            </Text>
          </View>
        </Animated.View>

        <TapCursor {...rig} />
      </View>
    </View>
  );
}

function FreqLabel({ value }: { value: Animated.Value }) {
  const [i, setI] = useState(1);
  useEffect(() => {
    const id = value.addListener(({ value: v }) => setI(Math.round(v)));
    return () => value.removeListener(id);
  }, []);
  const labels = ['Every 2 weeks', 'Every month', 'Every 6 weeks'];
  return <Text>{labels[i] ?? labels[1]}</Text>;
}

function SummaryTotal({ value }: { value: Animated.Value }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = value.addListener(({ value: v }) => setN(Math.round(v)));
    return () => value.removeListener(id);
  }, []);
  const prices = ['37.50', '47.20', '54.80'];
  return <Text>{prices[n] ?? prices[0]}</Text>;
}

function FrequencyOption({
  label,
  index,
  active,
}: {
  label: string;
  index: number;
  active: Animated.Value;
}) {
  const [isActive, setActive] = useState(index === 1);
  useEffect(() => {
    const id = active.addListener(({ value }) => setActive(Math.round(value) === index));
    return () => active.removeListener(id);
  }, [index]);

  return (
    <View
      style={[
        styles.freqOption,
        isActive && styles.freqOptionActive,
      ]}
    >
      <Text
        style={[
          styles.freqOptionText,
          isActive && styles.freqOptionTextActive,
        ]}
      >
        {label}
      </Text>
      {isActive && <Check size={14} color={colors.brand.deepest} strokeWidth={3} />}
    </View>
  );
}

function HouseholdHelp({ value }: { value: Animated.Value }) {
  const [n, setN] = useState(3);
  useEffect(() => {
    const id = value.addListener(({ value: v }) => setN(3 + Math.round(v)));
    return () => value.removeListener(id);
  }, []);
  return <Text>Quantities sized for {n} people.</Text>;
}

function HouseholdLabel({ value }: { value: Animated.Value }) {
  const [n, setN] = useState(3);
  useEffect(() => {
    const id = value.addListener(({ value: v }) => setN(3 + Math.round(v)));
    return () => value.removeListener(id);
  }, []);
  return <Text>{n} {n === 1 ? 'person' : 'people'}</Text>;
}

function AnimatedCounter({ value }: { value: Animated.Value }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = value.addListener(({ value: v }) => setN(Math.max(1, Math.round(v))));
    return () => value.removeListener(id);
  }, []);
  return <Text style={styles.stepperCount}>{n}</Text>;
}

function CartCounter({ value }: { value: Animated.Value }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = value.addListener(({ value: v }) => setN(Math.round(v)));
    return () => value.removeListener(id);
  }, []);
  return <Text>{n}</Text>;
}

/* ------------------------------------------------------------- */
/*  Slide 3 — Delivery: status cycles + truck travels            */
/*  Mirrors app/order/[id].tsx status pill + delivery info card  */
/* ------------------------------------------------------------- */
const ORDER_STATUSES = [
  { label: 'Confirmed',  bg: colors.infoBg,     text: colors.info },
  { label: 'Preparing',  bg: colors.amber.mist, text: colors.amber.deep },
  { label: 'On the way', bg: '#FFF3E0',         text: '#E65100' },
  { label: 'Delivered',  bg: colors.brand.mist, text: colors.brand.DEFAULT },
] as const;

function DeliveryAnimation() {
  const rig = useCursorRig();
  const statusIdx = useRef(new Animated.Value(0)).current; // 0..3
  const progress = useRef(new Animated.Value(0)).current;
  const truckX = useRef(new Animated.Value(0)).current;
  const eta = useRef(new Animated.Value(0)).current;
  const arrived = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const groupW = SCREEN_WIDTH - 96;
    // Track button sits in the ETA row of the card. Card top ≈ 64 (status pill 38 + margin 26).
    // ETA row inside card: padding 16 + ~40 / 2 ≈ 36. Total y ≈ 100.
    const trackBtnX = groupW - 48;
    const trackBtnY = 102;

    rig.x.setValue(-30);
    rig.y.setValue(-40);

    const buildCycle = () =>
      Animated.sequence([
        Animated.timing(rig.opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.delay(280),

        // Tap "Track"
        tapAt(rig, trackBtnX, trackBtnY, 720),

        // Status: Confirmed → Preparing
        Animated.timing(statusIdx, { toValue: 1, duration: 320, useNativeDriver: false }),
        Animated.delay(380),

        // Status: Preparing → On the way; truck + progress start
        Animated.parallel([
          Animated.timing(statusIdx, { toValue: 2, duration: 320, useNativeDriver: false }),
          Animated.timing(progress, {
            toValue: 1,
            duration: 2800,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: false,
          }),
          Animated.timing(truckX, {
            toValue: 1,
            duration: 2800,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(eta, {
            toValue: 1,
            duration: 2800,
            easing: Easing.linear,
            useNativeDriver: false,
          }),
        ]),

        // Status: On the way → Delivered; arrived toast
        Animated.parallel([
          Animated.timing(statusIdx, { toValue: 3, duration: 280, useNativeDriver: false }),
          Animated.timing(arrived, { toValue: 1, duration: 320, useNativeDriver: false }),
        ]),
        Animated.delay(900),

        // Reset
        Animated.timing(rig.opacity, { toValue: 0, duration: 350, useNativeDriver: true }),
        Animated.parallel([
          Animated.timing(statusIdx, { toValue: 0, duration: 1, useNativeDriver: false }),
          Animated.timing(progress, { toValue: 0, duration: 250, useNativeDriver: false }),
          Animated.timing(truckX, { toValue: 0, duration: 250, useNativeDriver: true }),
          Animated.timing(eta, { toValue: 0, duration: 1, useNativeDriver: false }),
          Animated.timing(arrived, { toValue: 0, duration: 250, useNativeDriver: false }),
        ]),
        Animated.delay(400),
      ]);

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      buildCycle().start(({ finished }) => {
        if (finished && !cancelled) {
          rig.x.setValue(-30);
          rig.y.setValue(-40);
          tick();
        }
      });
    };
    tick();

    return () => {
      cancelled = true;
    };
  }, []);

  const progressWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['8%', '100%'],
  });
  const truckTranslate = truckX.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SCREEN_WIDTH - 168],
  });
  const arrivedOpacity = arrived.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const courierOpacity = statusIdx.interpolate({
    inputRange: [0, 1.5, 2],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });
  const courierTranslate = statusIdx.interpolate({
    inputRange: [0, 1.5, 2],
    outputRange: [12, 12, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.illustrationFrame}>
      <View style={[styles.chip, { backgroundColor: 'rgba(255,255,255,0.95)', top: 20, right: 22 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={styles.liveDot} />
          <Text style={styles.chipText}>Live</Text>
        </View>
      </View>

      <View style={styles.deliveryGroup}>
        {/* Status pill (centered) */}
        <StatusPill index={statusIdx} />

        {/* Tracking card */}
        <View style={[styles.deliveryCard, { marginTop: 16 }]}>
          {/* Header row: order number */}
          <View style={styles.orderHeader}>
            <Text style={styles.orderNumber}>#CSO-2847</Text>
            <View style={styles.livePill}>
              <View style={styles.livePulse} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          </View>

          {/* ETA row */}
          <View style={styles.etaRow}>
            <View
              style={[
                styles.tileIconWrap,
                { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.brand.DEFAULT },
              ]}
            >
              <Truck size={22} color="#fff" strokeWidth={1.75} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tileEyebrow}>ARRIVING IN</Text>
              <Text style={styles.deliveryEta}>
                <Eta value={eta} /> min
              </Text>
            </View>
            <View style={styles.trackBtn}>
              <Text style={styles.trackBtnText}>Track</Text>
            </View>
          </View>

          {/* Progress road */}
          <View style={styles.road}>
            <Animated.View style={[styles.roadFill, { width: progressWidth }]} />
            <Animated.View
              style={{
                position: 'absolute',
                left: -8,
                top: -10,
                transform: [{ translateX: truckTranslate }],
              }}
            >
              <View style={styles.truckPill}>
                <Truck size={14} color="#fff" strokeWidth={2} />
              </View>
            </Animated.View>
            <View style={[styles.roadDot, { left: 0 }]} />
            <View style={[styles.roadDot, { right: 0, backgroundColor: colors.brand.deepest }]} />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MapPin size={11} color={colors.muted} strokeWidth={2} />
              <Text style={styles.deliveryMeta}>Warehouse</Text>
            </View>
            <Text style={styles.deliveryMeta}>You</Text>
          </View>

          {/* Address row */}
          <View style={styles.addressRow}>
            <MapPin size={14} color={colors.brand.DEFAULT} strokeWidth={1.75} />
            <Text numberOfLines={1} style={styles.addressText}>
              Calle de Alcalá 12, 28014 Madrid
            </Text>
          </View>
        </View>

        {/* Courier card — appears at "On the way" */}
        <Animated.View
          style={[
            styles.courierCard,
            {
              opacity: courierOpacity,
              transform: [{ translateY: courierTranslate }],
            },
          ]}
        >
          <View style={styles.courierAvatar}>
            <Text style={styles.courierInitials}>CM</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.courierName}>Carlos M.</Text>
            <View style={styles.courierRatingRow}>
              <Star size={10} color={colors.amber.deep} fill={colors.amber.deep} strokeWidth={1.5} />
              <Text style={styles.courierRating}>4.9 · 1.2k deliveries</Text>
            </View>
          </View>
          <View style={styles.courierActions}>
            <View style={styles.courierActionBtn}>
              <Phone size={14} color={colors.brand.deepest} strokeWidth={2} />
            </View>
            <View style={styles.courierActionBtn}>
              <MessageSquare size={14} color={colors.brand.deepest} strokeWidth={2} />
            </View>
          </View>
        </Animated.View>

        {/* Arrived toast */}
        <Animated.View
          style={[styles.arrivedToast, { opacity: arrivedOpacity }]}
        >
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: '#fff',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Check size={14} color={colors.brand.deepest} strokeWidth={2.8} />
          </View>
          <Text style={styles.arrivedText}>Delivered</Text>
        </Animated.View>

        <TapCursor {...rig} />
      </View>
    </View>
  );
}

function StatusPill({ index }: { index: Animated.Value }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = index.addListener(({ value }) =>
      setI(Math.min(ORDER_STATUSES.length - 1, Math.max(0, Math.round(value)))),
    );
    return () => index.removeListener(id);
  }, []);
  const s = ORDER_STATUSES[i];
  return (
    <View style={[styles.statusPill, { backgroundColor: s.bg }]}>
      <Text style={[styles.statusPillText, { color: s.text }]}>{s.label}</Text>
    </View>
  );
}

function Eta({ value }: { value: Animated.Value }) {
  const [n, setN] = useState(14);
  useEffect(() => {
    const id = value.addListener(({ value: v }) => setN(Math.max(0, Math.round(14 - v * 14))));
    return () => value.removeListener(id);
  }, []);
  return <Text>{n}</Text>;
}

function renderIllustration(kind: Illustration) {
  if (kind === 'fresh') return <FreshAnimation />;
  if (kind === 'rashan') return <RashanAnimation />;
  return <DeliveryAnimation />;
}

/* ------------------------------------------------------------- */
/*  Screen                                                       */
/* ------------------------------------------------------------- */
export default function OnboardingScreen() {
  const router = useRouter();
  const lang = useLanguageStore((s) => s.lang);
  const completeOnboarding = useOnboardingStore((s) => s.completeOnboarding);
  const slides = useSlides();
  const listRef = useRef<FlatList<Slide>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [index, setIndex] = useState(0);

  const isLast = index === slides.length - 1;

  const handleNext = () => {
    if (isLast) {
      finish('register');
    } else {
      listRef.current?.scrollToIndex({ index: index + 1, animated: true });
    }
  };

  const finish = (next: 'register' | 'guest') => {
    completeOnboarding();
    if (next === 'register') {
      router.replace('/(auth)/register');
    } else {
      router.replace('/(tabs)');
    }
  };

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems[0]?.index != null) {
      setIndex(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.topRow}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}>
            <ShoppingBasket size={14} color="#fff" strokeWidth={2} />
          </View>
          <Text style={styles.brandName}>Cesto</Text>
        </View>
        <Pressable
          onPress={() => finish('guest')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.skipText}>
            {isLast
              ? lang === 'es'
                ? 'Explorar como invitado'
                : 'Continue as guest'
              : lang === 'es'
                ? 'Saltar'
                : 'Skip'}
          </Text>
        </Pressable>
      </View>

      <Animated.FlatList
        ref={listRef}
        data={slides}
        keyExtractor={(item) => item.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        style={{ flex: 1 }}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false },
        )}
        scrollEventThrottle={16}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewabilityConfig}
        renderItem={({ item }) => (
          <View style={{ width: SCREEN_WIDTH, flex: 1 }}>
            <View style={styles.slide}>
              <LinearGradient
                colors={item.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.illustrationCard}
              >
                <DotPattern />
                {/* Soft ambient blobs — mirrors web BrandPanel */}
                <View style={styles.blobTopRight} />
                <View style={styles.blobBottomLeft} />
                {renderIllustration(item.illustration)}
              </LinearGradient>

              <View style={styles.copy}>
                <Text style={styles.eyebrow}>{item.eyebrow}</Text>
                <Text style={styles.title}>
                  {item.titleLines[0]}
                  {'\n'}
                  {item.titleLines[1]}
                </Text>
                <Text style={styles.body}>{item.body}</Text>
              </View>
            </View>
          </View>
        )}
      />

      <View style={styles.footer}>
        <View style={styles.dotsRow}>
          {slides.map((_, i) => {
            const inputRange = [
              (i - 1) * SCREEN_WIDTH,
              i * SCREEN_WIDTH,
              (i + 1) * SCREEN_WIDTH,
            ];
            const dotWidth = scrollX.interpolate({
              inputRange,
              outputRange: [6, 24, 6],
              extrapolate: 'clamp',
            });
            const dotOpacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.35, 1, 0.35],
              extrapolate: 'clamp',
            });
            return (
              <Animated.View
                key={i}
                style={[
                  styles.dot,
                  { width: dotWidth, opacity: dotOpacity },
                ]}
              />
            );
          })}
        </View>

        <Pressable
          onPress={handleNext}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}
        >
          <Text style={styles.ctaText}>
            {isLast
              ? lang === 'es'
                ? 'Crear cuenta'
                : 'Create account'
              : lang === 'es'
                ? 'Siguiente'
                : 'Next'}
          </Text>
        </Pressable>

      </View>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------- */
/*  Styles                                                       */
/* ------------------------------------------------------------- */
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface.linen,
  },
  topRow: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: colors.brand.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.3,
  },
  skipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.gray,
    letterSpacing: -0.2,
  },
  slide: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  illustrationCard: {
    flex: 1,
    borderRadius: 32,
    overflow: 'hidden',
    backgroundColor: '#022B91',
  },
  blobTopRight: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    top: -120,
    right: -100,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  blobBottomLeft: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    bottom: -140,
    left: -110,
    backgroundColor: 'rgba(251, 146, 60, 0.16)',
  },
  illustrationFrame: {
    flex: 1,
    position: 'relative',
    justifyContent: 'center',
  },
  freshGroup: {
    width: 220,
    alignSelf: 'center',
    position: 'relative',
  },
  rashanGroup: {
    alignSelf: 'stretch',
    marginHorizontal: 24,
    position: 'relative',
  },
  deliveryGroup: {
    alignSelf: 'stretch',
    marginHorizontal: 24,
    position: 'relative',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.danger,
  },

  /* shared tile */
  tile: {
    position: 'absolute',
    borderRadius: 18,
    backgroundColor: '#fff',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 6,
  },
  tileIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  tilePrice: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.brand.deepest,
    marginTop: 2,
  },
  tileEyebrow: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  chip: {
    position: 'absolute',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    shadowColor: colors.brand.deepest,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: 0.2,
  },

  /* slide 1 — product card (mirrors ProductCard.tsx) */
  productCard: {
    width: 220,
    backgroundColor: colors.surface.cream,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.7)',
    overflow: 'hidden',
  },
  productImageWrap: {
    aspectRatio: 4 / 3,
    backgroundColor: colors.surface.sand,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  discountBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: colors.ink,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  discountText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.2,
  },
  productContent: {
    padding: 12,
    gap: 4,
  },
  productName: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.ink,
    lineHeight: 16,
    letterSpacing: -0.2,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  ratingText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.2,
  },
  ratingReviews: {
    fontSize: 10.5,
    color: colors.muted,
  },
  unitMeta: {
    fontSize: 10.5,
    color: colors.muted,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 2,
  },
  cartBadge: {
    position: 'absolute',
    top: 18,
    right: 20,
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.brand.deepest,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  cartCountDot: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: colors.brand.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: '#fff',
  },
  cartCountText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.2,
  },
  productPrice: {
    fontSize: 18,
    fontWeight: '500',
    color: colors.ink,
    letterSpacing: -0.5,
  },
  compareAtPrice: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: colors.muted,
    textDecorationLine: 'line-through',
  },
  addRow: {
    marginTop: 10,
    height: 38,
    position: 'relative',
  },
  addBtn: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 38,
    borderRadius: 999,
    backgroundColor: colors.brand.deepest,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  addBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.2,
  },
  stepper: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 38,
    borderRadius: 999,
    backgroundColor: colors.brand.mist,
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepperBtn: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperCount: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: colors.brand.deepest,
  },

  /* slide 1 — mini decorative product card */
  miniProductCard: {
    position: 'absolute',
    width: 108,
    bottom: 32,
    right: 22,
    transform: [{ rotate: '5deg' }],
    backgroundColor: colors.surface.cream,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.7)',
    overflow: 'hidden',
  },
  miniProductImage: {
    aspectRatio: 4 / 3,
    backgroundColor: colors.surface.sand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniProductName: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.ink,
    letterSpacing: -0.2,
  },
  miniProductPrice: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.ink,
    letterSpacing: -0.3,
    marginTop: 2,
  },

  /* slide 2 — builder card (mirrors pack/[id].tsx) */
  builderCard: {
    backgroundColor: colors.surface.cream,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.7)',
  },
  builderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  builderHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.charcoal,
    letterSpacing: 1.2,
  },
  builderHelp: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 8,
  },
  householdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface.linen,
    borderRadius: 12,
    padding: 4,
  },
  householdStepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  householdStepBtnActive: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  householdLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
  },
  freqOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface.cream,
  },
  freqOptionActive: {
    borderColor: colors.brand.DEFAULT,
    backgroundColor: colors.brand.mist,
  },
  freqOptionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.charcoal,
  },
  freqOptionTextActive: {
    color: colors.brand.deepest,
  },

  /* slide 2 — subscription summary card */
  summaryCard: {
    marginTop: 12,
    backgroundColor: colors.brand.deepest,
    borderRadius: 8,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: colors.brand.deepest,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
  },
  summaryEyebrow: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.2,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    marginTop: 4,
    letterSpacing: -0.2,
  },
  summarySubtext: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  summaryPriceBlock: {
    alignItems: 'flex-end',
    paddingLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.18)',
  },
  summaryPrice: {
    fontSize: 22,
    fontWeight: '500',
    color: '#fff',
    letterSpacing: -0.8,
    marginTop: 4,
  },

  /* slide 3 — status pill (mirrors order/[id].tsx) */
  statusPill: {
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  statusPillText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },

  /* slide 3 — delivery card */
  deliveryCard: {
    backgroundColor: colors.surface.cream,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.7)',
  },
  orderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  orderNumber: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
    letterSpacing: 0.2,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.brand.mist,
  },
  livePulse: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.brand.DEFAULT,
  },
  liveText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.brand.deepest,
    letterSpacing: 1,
  },
  etaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  addressText: {
    flex: 1,
    fontSize: 12,
    color: colors.charcoal,
  },
  courierCard: {
    marginTop: 12,
    backgroundColor: colors.surface.cream,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.7)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  courierAvatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.brand.mist,
    alignItems: 'center',
    justifyContent: 'center',
  },
  courierInitials: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.brand.deepest,
    letterSpacing: -0.2,
  },
  courierName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.2,
  },
  courierRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  courierRating: {
    fontSize: 11,
    color: colors.muted,
  },
  courierActions: {
    flexDirection: 'row',
    gap: 6,
  },
  courierActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: colors.brand.mist,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deliveryEta: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 2,
  },
  trackBtn: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.brand.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  road: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface.mint,
    marginTop: 18,
    position: 'relative',
  },
  roadFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brand.DEFAULT,
  },
  roadDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.brand.DEFAULT,
    top: -2,
    borderWidth: 2,
    borderColor: '#fff',
  },
  truckPill: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.brand.deepest,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
  deliveryMeta: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    letterSpacing: 0.2,
  },
  arrivedToast: {
    marginTop: 24,
    alignSelf: 'center',
    paddingHorizontal: 18,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brand.deepest,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: colors.brand.deepest,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 8,
  },
  arrivedText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.2,
  },

  /* copy + footer */
  copy: {
    paddingTop: 36,
    paddingHorizontal: 4,
    paddingBottom: 2,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.8,
    color: colors.brand.DEFAULT,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 30,
    fontWeight: '400',
    color: colors.ink,
    letterSpacing: -1,
    lineHeight: 36,
    marginTop: 8,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.gray,
    marginTop: 10,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 14,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brand.deepest,
  },
  cta: {
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.brand.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    shadowColor: colors.brand.deepest,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 6,
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.2,
  },
});
