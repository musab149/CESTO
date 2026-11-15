import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Geometry for a bottom tab bar that survives every device.
 *
 * Expo SDK 54 targets Android 16, where edge-to-edge is mandatory and cannot
 * be switched off, so the app draws UNDERNEATH the system navigation bar.
 * React Navigation's default tab-bar height already adds `insets.bottom` for
 * exactly that reason — and a hardcoded `height` REPLACES that default,
 * throwing the allowance away. The icons and labels then get painted into the
 * strip the system owns, and the row looks clipped or missing entirely.
 *
 * Both bars used to hardcode `height: 72, paddingBottom: 12, paddingTop: 10`,
 * which left this much room for a 24dp icon and its label:
 *
 *     three-button navigation (inset 48)    2dp    <- effectively invisible
 *     gesture pill            (inset 24)   26dp    <- icon only, label cut
 *     no system bar           (inset  0)   50dp    <- fine
 *
 * That is why it looked device-specific rather than simply broken: the more
 * the system navigation took, the more of the bar vanished.
 *
 * Height is therefore the visible row PLUS the inset, with `paddingBottom`
 * lifting the contents back above the system bar — a steady 46dp of usable
 * room everywhere, or 34dp once labels are dropped.
 */
export function useTabBarLayout() {
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();

  // Labels are dropped rather than clipped when there is genuinely no room:
  // a short screen, a large accessibility font, or both. The icons still
  // identify each tab, whereas half a label reads as breakage.
  const showLabel = height >= 640 && fontScale <= 1.3;
  const row = showLabel ? 58 : 46;

  return {
    showLabel,
    /** Spread into `tabBarStyle` ahead of the bar's own colours. */
    style: {
      height: row + insets.bottom,
      paddingBottom: insets.bottom + 6,
      paddingTop: 6,
    },
  };
}
