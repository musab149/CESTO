import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface FavoritesState {
  productIds: string[];
  toggle: (productId: string) => boolean;
  add: (productId: string) => void;
  remove: (productId: string) => void;
  clear: () => void;
  isFavorite: (productId: string) => boolean;
  count: () => number;
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      productIds: [],

      toggle: (productId) => {
        const exists = get().productIds.includes(productId);
        if (exists) {
          set((s) => ({ productIds: s.productIds.filter((id) => id !== productId) }));
          return false;
        }
        set((s) => ({ productIds: [productId, ...s.productIds] }));
        return true;
      },

      add: (productId) => {
        if (get().productIds.includes(productId)) return;
        set((s) => ({ productIds: [productId, ...s.productIds] }));
      },

      remove: (productId) => {
        set((s) => ({ productIds: s.productIds.filter((id) => id !== productId) }));
      },

      clear: () => set({ productIds: [] }),

      isFavorite: (productId) => get().productIds.includes(productId),

      count: () => get().productIds.length,
    }),
    {
      name: 'cesto-favorites-v1',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
