import { create } from 'zustand';

/**
 * Partner Preview mode — set by the /partner dashboard's "Customer" toggle
 * (see apps/admin/src/partner/PartnerLayout.tsx). When active, the
 * customer web hides prices, add-to-cart affordances, and the checkout
 * CTA, and shows a sticky banner at the top with an "Exit preview" button.
 *
 * The flag lives in localStorage under `mvPreviewMode` so it survives
 * cross-origin navigation from the admin app (both apps run on the same
 * origin in prod; different ports in dev). Format: `partner:{storeId}` or
 * absent (normal customer mode).
 */

export const PREVIEW_MODE_KEY = 'mvPreviewMode';

interface PreviewState {
  /** Full string value from localStorage — e.g. "partner:abc123" or null. */
  raw: string | null;
  /** True when we're rendering as a partner preview (prices hidden etc.). */
  isPartnerPreview: boolean;
  /** Partner's store id, parsed out of `raw`. */
  storeId: string | null;
  /** Turn off preview mode + clear the persisted flag. Reloads to reset any
   *  React-Query caches that captured hidden fields. */
  exit: () => void;
}

function parse(raw: string | null): { isPartnerPreview: boolean; storeId: string | null } {
  if (!raw?.startsWith('partner:')) return { isPartnerPreview: false, storeId: null };
  const storeId = raw.slice('partner:'.length) || null;
  return { isPartnerPreview: true, storeId };
}

const initialRaw = typeof window === 'undefined' ? null : window.localStorage.getItem(PREVIEW_MODE_KEY);

export const usePreviewModeStore = create<PreviewState>((set) => ({
  raw: initialRaw,
  ...parse(initialRaw),
  exit: () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(PREVIEW_MODE_KEY);
      // Reload so hooks/components sampling the store on mount all reset.
      window.location.reload();
    }
    set({ raw: null, isPartnerPreview: false, storeId: null });
  },
}));
