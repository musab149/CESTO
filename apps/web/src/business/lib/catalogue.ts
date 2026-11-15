import { useMemo } from 'react';
import { useBusinessBrands, useBusinessCategories, useBusinessOrigins, useBusinessStores } from '@grocery-app/shared';
import type { ShopCard } from '@/sales/components/catalogue/data';

/**
 * What the business Catálogo's browse page and the lists behind its cards
 * read (2026-10-29): the shops with something at wholesale — Cesto's own
 * first, it has no shop row — and the categories, origins and brands, each
 * with how many of its products a business can buy. The API leaves out any
 * with none, so no card opens onto nothing.
 */
export function useBizBrowseData() {
  const storesQ = useBusinessStores();
  const categoriesQ = useBusinessCategories();
  const originsQ = useBusinessOrigins();
  const brandsQ = useBusinessBrands();

  const shopCards = useMemo<ShopCard[]>(
    () => (storesQ.data?.items ?? []).map((s) => ({
      id: s.id, name: s.name, logo_url: s.logo_url, logo_bg: s.logo_bg, cover_url: s.cover_url,
      tagline_es: s.tagline_es, tagline_en: s.tagline_en, shop_hours: s.shop_hours, products: s.products,
    })),
    [storesQ.data],
  );
  // The brands they can buy most of first. Names break ties.
  const brands = useMemo(
    () => [...(brandsQ.data ?? [])].sort((a, b) => b.products - a.products || a.name.localeCompare(b.name)),
    [brandsQ.data],
  );
  const houseCount = storesQ.data?.house.products ?? 0;

  return {
    shopCards,
    house: houseCount > 0,
    houseCount,
    /** More than one shop can be on a list's screen, so cards name theirs. */
    manyShops: shopCards.length + (houseCount > 0 ? 1 : 0) > 1,
    categories: categoriesQ.data ?? [],
    origins: originsQ.data ?? [],
    brands,
    queries: { stores: storesQ, categories: categoriesQ, origins: originsQ, brands: brandsQ },
  };
}
