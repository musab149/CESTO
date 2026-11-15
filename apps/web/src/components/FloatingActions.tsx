import { useConsentDecided } from '@/stores/cookieConsentStore';
import FloatingCartBar from '@/components/FloatingCartBar';
import WhatsAppButton from '@/components/WhatsAppButton';
import { useFloatingActionsStore } from '@/stores/floatingActionsStore';

/**
 * The bottom-right corner of the site: WhatsApp, with the cart pill under it
 * whenever there is something in the cart.
 *
 * One container rather than two fixed elements, so they stack instead of
 * landing on each other, and move together: above the mobile tab bar below
 * lg, back to the viewport edge at lg, and up above the cookie bar while it
 * is still waiting for an answer.
 *
 * `cart` and `tabBar` are off on the sign-in pages, which have neither.
 */
export default function FloatingActions({ cart = true, tabBar = true }: { cart?: boolean; tabBar?: boolean }) {
  const consentPending = !useConsentDecided();
  // A screen with its own bottom bar has asked for the corner below xl.
  const cleared = useFloatingActionsStore((s) => s.hiders > 0);
  const bottom = consentPending
    ? 'bottom-[188px] md:bottom-[172px]'
    : tabBar
      ? 'bottom-[70px] lg:bottom-6'
      : 'bottom-4 md:bottom-6';

  return (
    <div
      className={`fixed right-4 md:right-6 z-40 flex flex-col items-end gap-3 pointer-events-none transition-[bottom] duration-500 ease-out ${bottom} ${cleared ? 'max-xl:hidden' : ''}`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <WhatsAppButton />
      {cart && <FloatingCartBar />}
    </div>
  );
}
