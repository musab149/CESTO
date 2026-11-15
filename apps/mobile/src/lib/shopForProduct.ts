/** The identity fields a product's Store relation carries. */
export interface ProductStoreRef {
  slug: string;
  name: string;
  logo_url?: string | null;
  logo_bg?: string | null;
}

export interface ProductShopSource {
  store?: ProductStoreRef | null;
  shop_id?: string | null;
}

/** Shape the shop cards render — matches TopShop structurally. */
export interface ShopIdentity {
  id: string;
  name: string;
  logo_url: string | null;
  logo_bg: string;
}

/**
 * Attribute a product to the shop that actually sells it.
 *
 * `resolveShop` only knows the curated Top Shops home-section blob and returns
 * CESTO_SHOP for any shop_id not pinned there — which is most partner stores.
 * With 8 stores in this catalogue and the same product listed by several of
 * them, every card read "Sold by Cesto Shop" and the listings were
 * indistinguishable. Web fixed this when stores got their own table; mobile's
 * cards never did.
 *
 * The real Store relation rides on the product response, so identity comes
 * from there. The blob's entry is passed in as `fallback` and supplies the
 * presentation extras the shop cards need (cover, rating, counts) — and is
 * used wholesale when the response predates the relation.
 *
 * `fallback` is a parameter rather than a resolveShop() call inside because
 * that import pulls the shared barrel, which re-exports a .tsx component and
 * cannot load under ts-node. Keeping it out leaves this unit testable.
 */
export function shopForProduct<T extends ShopIdentity>(
  product: ProductShopSource,
  fallback: T,
): T {
  if (!product.store) return fallback;
  return {
    ...fallback,
    id: product.store.slug,
    name: product.store.name,
    logo_url: product.store.logo_url ?? fallback.logo_url,
    logo_bg: product.store.logo_bg ?? fallback.logo_bg,
  };
}
