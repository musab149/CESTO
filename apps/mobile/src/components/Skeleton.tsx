import { useEffect, useRef } from 'react';
import { View, Animated, type ViewStyle } from 'react-native';
import { colors } from '../constants/colors';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  style?: ViewStyle;
}

export default function Skeleton({ width = '100%', height = 16, borderRadius = 8, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 750, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: width as number,
          height: height as number,
          borderRadius,
          backgroundColor: colors.border,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function ProductCardSkeleton() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.cream, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
      <Skeleton height={120} borderRadius={0} />
      <View style={{ padding: 12, gap: 8 }}>
        <Skeleton height={14} width="80%" />
        <Skeleton height={18} width="40%" />
        <Skeleton height={36} borderRadius={8} />
      </View>
    </View>
  );
}

/**
 * Two-column placeholder grid. Cell metrics are the real grids' exactly —
 * `width: '50%'` with `padding: 6` inside a container padded 10 — so nothing
 * shifts when the data lands. It used to carry 16/6 gutters, which no longer
 * matched anything after the listings were aligned on home's layout.
 */
export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10, paddingTop: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ width: '50%', padding: 6 }}>
          <ProductCardSkeleton />
        </View>
      ))}
    </View>
  );
}

/** Placeholder for the order-history rows. */
export function OrderListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={{ padding: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={{
            backgroundColor: colors.surface.cream,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 16,
            marginBottom: 12,
            gap: 12,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Skeleton height={14} width="35%" />
            <Skeleton height={20} width="25%" borderRadius={999} />
          </View>
          <Skeleton height={12} width="55%" />
          <View style={{ height: 1, backgroundColor: colors.border }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Skeleton height={22} width="30%" />
            <Skeleton height={38} width="32%" borderRadius={10} />
          </View>
        </View>
      ))}
    </View>
  );
}
