import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Cookie consent (GDPR / LSSI-CE).
 *
 * Records what the shopper agreed to. It does NOT itself load or block any
 * script — today the app ships no analytics or ad tags at all (see
 * PrivacyPage §6), so there is nothing to gate yet. When a tag is added,
 * gate it on `hasCookieConsent('analytics')` and re-check on the store
 * subscription, rather than firing it at module load.
 *
 * Bump CONSENT_VERSION whenever the set of categories changes or a new
 * vendor is introduced. A stored decision from an older version is treated
 * as no decision, so the banner reappears and the shopper re-consents —
 * which is what "specific and informed" requires.
 */
export const CONSENT_VERSION = 1;

export interface CookiePrefs {
  /** Session, auth, cart, language. Always on — the site cannot work without them. */
  necessary: true;
  analytics: boolean;
  marketing: boolean;
}

export type OptionalCookieCategory = 'analytics' | 'marketing';

interface CookieConsentState {
  /** ISO timestamp of the decision, or null while undecided. */
  decidedAt: string | null;
  version: number;
  prefs: CookiePrefs;
  /** Preferences dialog — opened from the banner's gear and the footer. */
  settingsOpen: boolean;

  acceptAll: () => void;
  rejectAll: () => void;
  savePrefs: (prefs: Pick<CookiePrefs, OptionalCookieCategory>) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

const DEFAULT_PREFS: CookiePrefs = { necessary: true, analytics: false, marketing: false };

/** Rejecting is the default state, so a shopper who never answers is never tracked. */
function decide(prefs: Pick<CookiePrefs, OptionalCookieCategory>) {
  return {
    prefs: { necessary: true as const, ...prefs },
    decidedAt: new Date().toISOString(),
    version: CONSENT_VERSION,
    settingsOpen: false,
  };
}

export const useCookieConsentStore = create<CookieConsentState>()(
  persist(
    (set) => ({
      decidedAt: null,
      version: CONSENT_VERSION,
      prefs: DEFAULT_PREFS,
      settingsOpen: false,

      acceptAll: () => set(decide({ analytics: true, marketing: true })),
      rejectAll: () => set(decide({ analytics: false, marketing: false })),
      savePrefs: (prefs) => set(decide(prefs)),
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),
    }),
    {
      name: 'cesto-cookie-consent',
      // settingsOpen is UI state — persisting it would reopen the dialog on
      // every page load for anyone who closed the tab with it open.
      partialize: (s) => ({ decidedAt: s.decidedAt, version: s.version, prefs: s.prefs }),
    },
  ),
);

/** True once the shopper has answered under the current version. */
export function useConsentDecided(): boolean {
  return useCookieConsentStore((s) => s.decidedAt !== null && s.version === CONSENT_VERSION);
}

/** Read consent outside React — for script loaders and one-off checks. */
export function hasCookieConsent(category: OptionalCookieCategory): boolean {
  const { decidedAt, version, prefs } = useCookieConsentStore.getState();
  if (decidedAt === null || version !== CONSENT_VERSION) return false;
  return prefs[category];
}
