import { create } from 'zustand';

interface FloatingActionsState {
  /** Screens currently asking for the corner to be clear. */
  hiders: number;
  /** Ask for the corner to be clear; call what it returns to give it back. */
  hide: () => () => void;
}

/**
 * A screen with its own bottom bar — the Home Grocery list builder — needs the
 * floating WhatsApp / cart corner out of the way below xl, where the two land
 * on each other. A count rather than a flag, so two such screens cannot give
 * the corner back on each other's behalf.
 */
export const useFloatingActionsStore = create<FloatingActionsState>((set) => ({
  hiders: 0,
  hide: () => {
    set((s) => ({ hiders: s.hiders + 1 }));
    let given = false;
    return () => {
      if (given) return;
      given = true;
      set((s) => ({ hiders: Math.max(0, s.hiders - 1) }));
    };
  },
}));
