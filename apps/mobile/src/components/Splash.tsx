import { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ShoppingBasket, Leaf, Sparkles } from 'lucide-react-native';
import { colors } from '../constants/colors';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface SplashProps {
  onDone: () => void;
  /** total visible duration in ms */
  duration?: number;
}

export default function Splash({ onDone, duration = 1900 }: SplashProps) {
  const fadeIn = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.86)).current;
  const wordmarkSlide = useRef(new Animated.Value(14)).current;
  const wordmarkFade = useRef(new Animated.Value(0)).current;
  const taglineFade = useRef(new Animated.Value(0)).current;
  const containerFade = useRef(new Animated.Value(1)).current;
  const orbitOne = useRef(new Animated.Value(0)).current;
  const orbitTwo = useRef(new Animated.Value(0)).current;
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeIn, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 6,
          tension: 70,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(wordmarkSlide, {
          toValue: 0,
          duration: 380,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(wordmarkFade, {
          toValue: 1,
          duration: 380,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(taglineFade, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),
    ]).start();

    const orbit = Animated.loop(
      Animated.parallel([
        Animated.timing(orbitOne, {
          toValue: 1,
          duration: 8000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(orbitTwo, {
          toValue: 1,
          duration: 11000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    orbit.start();

    const pulse = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 380, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0.3, duration: 380, useNativeDriver: true }),
        ]),
      );
    const d1 = pulse(dot1, 0);
    const d2 = pulse(dot2, 160);
    const d3 = pulse(dot3, 320);
    d1.start();
    d2.start();
    d3.start();

    const exit = setTimeout(() => {
      Animated.timing(containerFade, {
        toValue: 0,
        duration: 380,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        orbit.stop();
        d1.stop();
        d2.stop();
        d3.stop();
        onDone();
      });
    }, duration);

    return () => clearTimeout(exit);
  }, []);

  const orbitOneRotate = orbitOne.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const orbitTwoRotate = orbitTwo.interpolate({
    inputRange: [0, 1],
    outputRange: ['360deg', '0deg'],
  });

  return (
    <Animated.View style={[styles.root, { opacity: containerFade }]} pointerEvents="none">
      <LinearGradient
        colors={[colors.brand.deepest, '#033CB5', '#02227A']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Soft ambient blobs */}
      <View style={[styles.blob, styles.blobTop]} />
      <View style={[styles.blob, styles.blobBottom]} />

      <Animated.View style={[styles.content, { opacity: fadeIn }]}>
        {/* Orbiting accents */}
        <Animated.View
          style={[
            styles.orbitRing,
            { transform: [{ rotate: orbitOneRotate }] },
          ]}
        >
          <View style={[styles.orbitDot, styles.orbitDotTop]}>
            <Leaf size={14} color={colors.brand.light} strokeWidth={1.75} />
          </View>
          <View style={[styles.orbitDot, styles.orbitDotBottom]}>
            <Sparkles size={12} color={colors.amber.mid} strokeWidth={1.75} />
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.orbitRingOuter,
            { transform: [{ rotate: orbitTwoRotate }] },
          ]}
        >
          <View style={[styles.orbitDotSmall, styles.orbitOuterTop]} />
          <View style={[styles.orbitDotSmall, styles.orbitOuterBottom]} />
        </Animated.View>

        {/* Logo mark */}
        <Animated.View
          style={[
            styles.logoBox,
            { transform: [{ scale: logoScale }] },
          ]}
        >
          <View style={styles.logoInner}>
            <ShoppingBasket size={42} color="#FFFFFF" strokeWidth={1.6} />
          </View>
        </Animated.View>

        {/* Wordmark */}
        <Animated.Text
          style={[
            styles.wordmark,
            {
              opacity: wordmarkFade,
              transform: [{ translateY: wordmarkSlide }],
            },
          ]}
        >
          Cesto
        </Animated.Text>

        <Animated.View
          style={[
            styles.taglineRow,
            { opacity: taglineFade },
          ]}
        >
          <View style={styles.taglineDot} />
          <Text style={styles.tagline}>Fresh · Curated · Delivered</Text>
          <View style={styles.taglineDot} />
        </Animated.View>
      </Animated.View>

      <Animated.View style={[styles.footer, { opacity: taglineFade }]}>
        <View style={styles.dotsRow}>
          <Animated.View style={[styles.loadingDot, { opacity: dot1 }]} />
          <Animated.View style={[styles.loadingDot, { opacity: dot2 }]} />
          <Animated.View style={[styles.loadingDot, { opacity: dot3 }]} />
        </View>
        <Text style={styles.footerText}>From the markets of Spain</Text>
      </Animated.View>
    </Animated.View>
  );
}

const RING_SIZE = 220;
const RING_OUTER = 280;

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    zIndex: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.deepest,
  },
  blob: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    opacity: 0.04,
  },
  blobTop: {
    top: -120,
    right: -80,
  },
  blobBottom: {
    bottom: -160,
    left: -120,
    backgroundColor: colors.brand.mid,
    opacity: 0.08,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitRing: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 0,
  },
  orbitRingOuter: {
    position: 'absolute',
    width: RING_OUTER,
    height: RING_OUTER,
    borderRadius: RING_OUTER / 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderStyle: 'dashed',
  },
  orbitDot: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitDotTop: {
    top: -16,
    left: RING_SIZE / 2 - 16,
  },
  orbitDotBottom: {
    bottom: -16,
    left: RING_SIZE / 2 - 16,
  },
  orbitDotSmall: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand.light,
  },
  orbitOuterTop: {
    top: -4,
    left: RING_OUTER / 2 - 4,
  },
  orbitOuterBottom: {
    bottom: -4,
    left: RING_OUTER / 2 - 4,
    backgroundColor: colors.amber.mid,
  },
  logoBox: {
    width: 104,
    height: 104,
    borderRadius: 30,
    backgroundColor: colors.brand.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.32,
    shadowRadius: 28,
    elevation: 14,
  },
  logoInner: {
    width: 92,
    height: 92,
    borderRadius: 8,
    backgroundColor: colors.brand.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  wordmark: {
    fontSize: 52,
    fontWeight: '400',
    color: '#FFFFFF',
    letterSpacing: -1.6,
    marginTop: 28,
    lineHeight: 56,
  },
  taglineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  taglineDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.brand.light,
  },
  tagline: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.78)',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  footer: {
    position: 'absolute',
    bottom: 56,
    alignItems: 'center',
    gap: 14,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  loadingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  footerText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 0.5,
  },
});
