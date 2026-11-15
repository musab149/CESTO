import { create } from 'zustand';
import type { RashanFrequency, RashanPackItem, RashanLeadFrequency } from '@grocery-app/shared';

export interface RashanDraft {
  packSlug: string;
  items: RashanPackItem[];
  household: number;
  frequency: RashanFrequency;
}

interface InitDraftPayload {
  items: RashanPackItem[];
  household: number;
  frequency: RashanFrequency;
}

/**
 * Answers carried over from the rashan interest sheet, so the builder does not
 * ask household size and cadence again two screens later. Mirrors web's
 * leadPrefill, minus the address fields mobile's shorter form does not collect.
 */
export interface RashanLeadPrefill {
  name: string;
  phone: string;
  email: string | null;
  household: number;
  /** Narrowed onto the subscription enum — what the builder and checkout use. */
  frequency: RashanFrequency;
  /** What they actually picked, kept so it can be shown back to them. */
  leadFrequency: RashanLeadFrequency;
  /** Free text — "weekends", "after 18:00". Handed to the subscription as
   *  slotPreference so ops know when the household is actually home. */
  preferredSlot: string | null;
}

interface RashanState {
  draft: RashanDraft | null;
  initDraft: (packSlug: string, init: InitDraftPayload) => void;
  clearDraft: () => void;
  setHousehold: (n: number) => void;
  setFrequency: (f: RashanFrequency) => void;
  leadPrefill: RashanLeadPrefill | null;
  setLeadPrefill: (prefill: RashanLeadPrefill) => void;
  clearLeadPrefill: () => void;
  addItem: (item: RashanPackItem) => void;
  removeItem: (productId: string) => void;
  setItemQuantity: (productId: string, qty: number) => void;
  setItemVariant: (productId: string, variantId: string) => void;
}

export const useRashanStore = create<RashanState>((set, get) => ({
  draft: null,
  leadPrefill: null,

  initDraft: (packSlug, init) => {
    set({
      draft: {
        packSlug,
        items: init.items.map((i) => ({ ...i })),
        household: init.household,
        frequency: init.frequency,
      },
    });
  },

  clearDraft: () => set({ draft: null }),

  setLeadPrefill: (prefill) => set({ leadPrefill: prefill }),
  clearLeadPrefill: () => set({ leadPrefill: null }),

  setHousehold: (n) => {
    const d = get().draft;
    if (!d) return;
    set({ draft: { ...d, household: Math.max(1, Math.min(8, n)) } });
  },

  setFrequency: (f) => {
    const d = get().draft;
    if (!d) return;
    set({ draft: { ...d, frequency: f } });
  },

  addItem: (item) => {
    const d = get().draft;
    if (!d) return;
    const existing = d.items.find((i) => i.product_id === item.product_id);
    if (existing) {
      set({
        draft: {
          ...d,
          items: d.items.map((i) =>
            i.product_id === item.product_id
              ? { ...i, quantity: i.quantity + item.quantity, variant_id: item.variant_id }
              : i,
          ),
        },
      });
    } else {
      set({ draft: { ...d, items: [...d.items, item] } });
    }
  },

  removeItem: (productId) => {
    const d = get().draft;
    if (!d) return;
    set({ draft: { ...d, items: d.items.filter((i) => i.product_id !== productId) } });
  },

  setItemQuantity: (productId, qty) => {
    const d = get().draft;
    if (!d) return;
    if (qty <= 0) {
      set({ draft: { ...d, items: d.items.filter((i) => i.product_id !== productId) } });
      return;
    }
    set({
      draft: {
        ...d,
        items: d.items.map((i) =>
          i.product_id === productId ? { ...i, quantity: qty } : i,
        ),
      },
    });
  },

  setItemVariant: (productId, variantId) => {
    const d = get().draft;
    if (!d) return;
    set({
      draft: {
        ...d,
        items: d.items.map((i) =>
          i.product_id === productId ? { ...i, variant_id: variantId } : i,
        ),
      },
    });
  },
}));
