import { colors } from '../constants/colors';
import { useAuthStore } from '../stores/authStore';

/**
 * Colour for a catalogue price, by the mode it was quoted in.
 *
 * Green is the regular price everyone sees. Blue is the wholesale price, and
 * it is the same blue as the rest of the Cesto Business surfaces — so a
 * business customer can tell at a glance which of the two catalogues they are
 * looking at, without opening the switch.
 *
 * Web returns a Tailwind class here; mobile styles inline, so this returns the
 * colour value itself. Same rule, same two tones.
 */
export function usePriceTone(): string {
  const user = useAuthStore((s) => s.user);
  return user?.pricing_mode === 'b2b' ? colors.brand.DEFAULT : colors.success;
}

/** True when the customer is currently shopping the wholesale catalogue. */
export function useIsB2bPricing(): boolean {
  const user = useAuthStore((s) => s.user);
  return user?.pricing_mode === 'b2b';
}

/** Approved Cesto Business account — gates the switch and the wholesale view. */
export function useIsBusinessCustomer(): boolean {
  const user = useAuthStore((s) => s.user);
  return user?.is_business === true;
}
