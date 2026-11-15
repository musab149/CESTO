import { View } from 'react-native';
import { Star } from 'lucide-react-native';
import { colors } from '../constants/colors';

/**
 * Five-star row. Uses `Math.round(rating)` to decide filled vs empty so a 4.4
 * shows four filled stars and a 4.5 shows five. Stars are amber-deep when
 * filled. Unfilled stars use a visible muted outline (NOT colors.border,
 * which is nearly invisible against both white cards and colored hero
 * backgrounds — and made the row look broken).
 */
export default function StarRow({
  rating,
  size = 14,
  emptyColor = colors.muted,
}: {
  rating: number;
  size?: number;
  /** Outline color for empty stars. Defaults to colors.muted; override on
   *  dark/colored backgrounds with a translucent white like
   *  `'rgba(255,255,255,0.55)'`. */
  emptyColor?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 1 }}>
      {Array.from({ length: 5 }).map((_, i) => {
        const filled = i + 1 <= Math.round(rating);
        return (
          <Star
            key={i}
            size={size}
            strokeWidth={filled ? 1.5 : 1.75}
            color={filled ? colors.amber.deep : emptyColor}
            fill={filled ? colors.amber.deep : 'transparent'}
          />
        );
      })}
    </View>
  );
}
