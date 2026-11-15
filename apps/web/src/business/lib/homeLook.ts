import type { AnnouncementTag, BusinessHomeTone } from '@grocery-app/shared';

/*
 * What the business home's blocks share (2026-10-31): the tints the team
 * picks in Admin → Business home, by name, and the bits of date and language
 * every block reads.
 */

export type Lang = 'es' | 'en';

/** A bilingual field of something the team wrote: `title` → title_es / title_en. */
export const pick = (o: object, field: string, lang: Lang): string =>
  ((o as Record<string, string>)[`${field}_${lang}`] ?? '').trim();

/** The panel's own tints — a wash for a card, a tile for an icon — so dark mode repaints them. */
export const TONE: Record<BusinessHomeTone, { wash: string; tile: string }> = {
  blue: { wash: 'bg-gradient-to-br from-st-blue-soft to-st-blue-soft-2', tile: 'bg-st-blue-tile text-st-blue-fg' },
  green: { wash: 'bg-gradient-to-br from-st-emerald-soft to-st-emerald-soft-2', tile: 'bg-st-emerald-tile text-st-emerald-fg' },
  orange: { wash: 'bg-gradient-to-br from-st-orange-soft to-st-orange-soft-2', tile: 'bg-st-orange-tile text-st-orange-fg' },
  violet: { wash: 'bg-gradient-to-br from-st-violet-soft to-st-violet-soft-2', tile: 'bg-st-violet-tile text-st-violet-fg' },
  amber: { wash: 'bg-gradient-to-br from-st-amber-soft to-st-amber-soft-2', tile: 'bg-st-amber-tile text-st-amber-fg' },
  sky: { wash: 'bg-gradient-to-br from-st-sky-soft to-st-sky-soft-2', tile: 'bg-st-sky-tile text-st-sky-fg' },
};

/**
 * A deep canvas for white type — a banner, a promotion tile or a story with
 * no photo. The same in either theme, like a photo would be.
 */
export const CANVAS: Record<BusinessHomeTone, string> = {
  blue: 'from-[#0A2E86] via-brand to-[#2F6EF0]',
  sky: 'from-[#06476E] via-[#0B78B8] to-[#2BA3E0]',
  green: 'from-[#06513A] via-[#0B8A5C] to-[#27B37E]',
  orange: 'from-[#7A2E06] via-[#C2560E] to-[#EE7F2D]',
  amber: 'from-[#6B3F00] via-[#B26A00] to-[#E59A1C]',
  violet: 'from-[#2E1B78] via-[#5236C9] to-[#7C5CF0]',
};

/** Each kind of announcement in its own tint. */
export const TAG_TONE: Record<AnnouncementTag, BusinessHomeTone> = { offer: 'amber', new: 'green', delivery: 'blue', news: 'violet' };

/** "1" and "nov" of a YYYY-MM-DD, as a calendar tile shows them. */
export function dayParts(iso: string, lang: Lang) {
  const d = new Date(`${iso}T00:00:00Z`);
  return { day: d.getUTCDate(), month: d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { month: 'short', timeZone: 'UTC' }).replace('.', '') };
}

/** Today in Spain, YYYY-MM-DD — the calendar the server drops past announcements by. */
export function madridToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Whether the buyer's device asks for less motion — no autoplay then. */
export function prefersLessMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** WebGL or the painted fallback — asked once per page. */
export function canWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}
