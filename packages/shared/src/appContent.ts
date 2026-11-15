import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appContentService, adminAppContent } from './api/services/appContent';

/**
 * Editorial copy the apps render but do not own: onboarding, About, the Rashan
 * landing page and the home value ribbon. Edited in Admin → App content.
 *
 * The point is that changing a sentence should not require a Play build. The
 * apps keep their bundled copy as an offline fallback, so a first launch with
 * no network still shows something.
 *
 * Shapes mirror `packages/api/src/lib/appContentDefaults.ts`. They are
 * duplicated rather than imported because the API cannot import this package
 * at runtime — see the note in the API about the shared barrel.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface OnboardingSlide {
  /** Stable id; also selects the bundled illustration, which is not editable. */
  key: string;
  eyebrow_es: string;
  eyebrow_en: string;
  /** Two display lines, separated by a newline. */
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
}

export interface AboutValue {
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
}

export interface RashanStep {
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
}

export interface RashanFaq {
  q_es: string;
  q_en: string;
  a_es: string;
  a_en: string;
}

export type RibbonIcon = 'truck' | 'wallet' | 'shield' | 'sparkles' | 'clock' | 'leaf';

export interface RibbonItem {
  icon: RibbonIcon;
  label_es: string;
  label_en: string;
  sub_es: string;
  sub_en: string;
}

export interface AppContent {
  onboarding: { slides: OnboardingSlide[] };
  about: { mission_es: string; mission_en: string; values: AboutValue[] };
  rashan: {
    hero_title_es: string;
    hero_title_en: string;
    hero_body_es: string;
    hero_body_en: string;
    steps: RashanStep[];
    faq: RashanFaq[];
  };
  ribbon: { items: RibbonItem[] };
}

export const RIBBON_ICONS: RibbonIcon[] = ['truck', 'wallet', 'shield', 'sparkles', 'clock', 'leaf'];

// ─── Hooks ────────────────────────────────────────────────────────────────

const APP_CONTENT_KEY = ['app-content'] as const;
const ADMIN_APP_CONTENT_KEY = ['admin-app-content'] as const;

/**
 * Copy changes are read far more often than they are made, and a stale
 * sentence for a few minutes costs nothing — so this is cached generously
 * rather than refetched on every screen mount.
 */
export const useAppContent = () =>
  useQuery({
    queryKey: APP_CONTENT_KEY,
    queryFn: () => appContentService.get(),
    staleTime: 5 * 60_000,
  });

export const useAdminAppContent = () =>
  useQuery({
    queryKey: ADMIN_APP_CONTENT_KEY,
    queryFn: () => adminAppContent.get(),
  });

export const useUpdateAppContent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: AppContent) => adminAppContent.update(content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ADMIN_APP_CONTENT_KEY });
      qc.invalidateQueries({ queryKey: APP_CONTENT_KEY });
    },
  });
};

export const useResetAppContent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminAppContent.reset(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ADMIN_APP_CONTENT_KEY });
      qc.invalidateQueries({ queryKey: APP_CONTENT_KEY });
    },
  });
};
