import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { businessHomeService, adminBusinessHome } from './api/services/businessHome';

/**
 * The business panel's home (2026-10-31): intro, promotions, Cesto
 * logistics, the banners and Cesto's announcements, edited in Admin →
 * Business home.
 *
 * Shapes mirror `packages/api/src/lib/businessHomeDefaults.ts`. They are
 * duplicated rather than imported because the API cannot import this package
 * at runtime — see the note in the API about the shared barrel.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export const LOGISTICS_ICONS = ['truck', 'clock', 'calendar', 'package', 'store', 'map', 'euro', 'receipt', 'phone', 'shield'] as const;
export type LogisticsIcon = (typeof LOGISTICS_ICONS)[number];

/** A tint from the panel's palette for a tile with no photo. */
export const BUSINESS_HOME_TONES = ['blue', 'green', 'orange', 'violet', 'amber', 'sky'] as const;
export type BusinessHomeTone = (typeof BUSINESS_HOME_TONES)[number];

export const ANNOUNCEMENT_TAGS = ['offer', 'new', 'delivery', 'news'] as const;
export type AnnouncementTag = (typeof ANNOUNCEMENT_TAGS)[number];

export interface BusinessHomeIntro {
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
  cta_es: string;
  cta_en: string;
  /** A panel path (/business/…), a shop path the panel maps (/products/…), or https://… */
  link: string;
  image_url: string | null;
}

export interface BusinessPromotion {
  id: string;
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
  badge_es: string;
  badge_en: string;
  image_url: string | null;
  tone: BusinessHomeTone;
  link: string;
  is_active: boolean;
}

export interface LogisticsPoint {
  id: string;
  icon: LogisticsIcon;
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
}

export interface BusinessLogistics {
  is_active: boolean;
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
  points: LogisticsPoint[];
}

/** One slide of the home's banner carousel: only the uploaded image, and where a tap goes. */
export interface BusinessBanner {
  id: string;
  is_active: boolean;
  link: string;
  /** Wide (4:1), for a computer. */
  image_url: string | null;
  /** 16:9, for a phone; the wide one is used when there is none. */
  image_mobile_url: string | null;
}

export interface BusinessAnnouncement {
  id: string;
  /** The day it is about (YYYY-MM-DD); it leaves the home the day after. */
  date: string | null;
  tag: AnnouncementTag;
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
  is_active: boolean;
}

export interface BusinessHomeContent {
  intro: BusinessHomeIntro;
  promotions: BusinessPromotion[];
  logistics: BusinessLogistics;
  banners: BusinessBanner[];
  announcements: BusinessAnnouncement[];
}

// ─── Hooks ────────────────────────────────────────────────────────────────

const BUSINESS_HOME_KEY = ['business-home'] as const;
const ADMIN_BUSINESS_HOME_KEY = ['admin-business-home'] as const;

/** Read often, changed rarely: a stale offer for a few minutes costs nothing. */
export const useBusinessHome = () =>
  useQuery({
    queryKey: BUSINESS_HOME_KEY,
    queryFn: () => businessHomeService.get(),
    staleTime: 5 * 60_000,
  });

export const useAdminBusinessHome = () =>
  useQuery({
    queryKey: ADMIN_BUSINESS_HOME_KEY,
    queryFn: () => adminBusinessHome.get(),
  });

export const useUpdateBusinessHome = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: BusinessHomeContent) => adminBusinessHome.update(content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ADMIN_BUSINESS_HOME_KEY });
      qc.invalidateQueries({ queryKey: BUSINESS_HOME_KEY });
    },
  });
};

export const useResetBusinessHome = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminBusinessHome.reset(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ADMIN_BUSINESS_HOME_KEY });
      qc.invalidateQueries({ queryKey: BUSINESS_HOME_KEY });
    },
  });
};
