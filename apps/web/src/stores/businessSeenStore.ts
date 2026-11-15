import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Which of Cesto's stories (the business home's promotions and announcements,
 * 2026-10-31) this buyer has already opened — so the ring around a new one
 * stays lit, and the home tab shows a dot, until they look. Per device, like
 * any "unread" a browser keeps; the newest few hundred is plenty.
 */
interface BusinessSeenState {
  seen: string[];
  markSeen: (id: string) => void;
}

const KEEP = 300;

export const useBusinessSeenStore = create<BusinessSeenState>()(
  persist(
    (set) => ({
      seen: [],
      markSeen: (id) => set((s) => (s.seen.includes(id) ? s : { seen: [id, ...s.seen].slice(0, KEEP) })),
    }),
    { name: 'cesto-business-seen' },
  ),
);
