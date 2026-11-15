import type { BusinessAnnouncement, BusinessHomeContent, BusinessPromotion } from '@grocery-app/shared';

/**
 * Cesto's announcements on the business home, opened one by one in the
 * full-screen viewer (components/home/Stories). Which ones a buyer has opened
 * is kept per device (stores/businessSeenStore); the layout reads the count
 * for the dot on the home tab.
 */
export type Story =
  | { kind: 'promo'; id: string; item: BusinessPromotion }
  | { kind: 'note'; id: string; item: BusinessAnnouncement };

/** The announcements as the viewer's stories, in the order the home lists them. */
export function notesOf(announcements: BusinessAnnouncement[]): Story[] {
  return announcements.map((a) => ({ kind: 'note' as const, id: a.id, item: a }));
}

/** How many announcements are waiting to be opened. */
export function unseenCount(home: Pick<BusinessHomeContent, 'announcements'> | undefined, seen: string[]): number {
  if (!home) return 0;
  const was = new Set(seen);
  return home.announcements.filter((a) => !was.has(a.id)).length;
}
