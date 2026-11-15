import { useAuthStore } from '@/stores/authStore';

/**
 * Colour for a catalogue price, by the pricing mode it was quoted in.
 *
 * Green is the regular price everyone sees. Blue is the wholesale price, and
 * it is the same blue as the rest of the Cesto Business surfaces — so a
 * business customer can tell at a glance which of the two catalogues they are
 * looking at, without checking the toggle in the header.
 *
 * Reads pricing_mode off authStore rather than a prop: the price switch
 * re-hydrates auth as its last step, so every price on the page recolours in
 * the same pass that renumbers it.
 */
export function usePriceTone(): string {
  const user = useAuthStore((s) => s.user);
  return user?.pricing_mode === 'b2b' ? 'text-brand' : 'text-success';
}

/** True when the visitor is currently shopping the wholesale catalogue. */
export function useIsB2bPricing(): boolean {
  const user = useAuthStore((s) => s.user);
  return user?.pricing_mode === 'b2b';
}
