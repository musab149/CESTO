import { api } from '../client';
import type {
  PromoGridConfig, AdsBannerConfig, TopBrandsConfig, ShopByOriginConfig, TopShopsConfig,
  StoresHeroConfig,
} from '../../homeSections';

/** Distinct brand entry returned by the admin discovery endpoint. */
export interface DiscoveredBrand {
  name: string;
  product_count: number;
}

/** Distinct origin entry returned by the admin discovery endpoint. */
export interface DiscoveredOrigin {
  key: string;
  product_count: number;
}

/** Public origin counts payload — keyed by lowercase origin slug. */
export interface OriginCount {
  key: string;
  product_count: number;
}

/** Public brand counts payload — keyed by the exact `Product.brand` value
 *  (case preserved so the filter URL matches). */
export interface BrandCount {
  name: string;
  product_count: number;
}

/**
 * Customer-side reads (no auth). Both endpoints always return a populated
 * config — the backend falls back to baked-in defaults when no row exists.
 */
export const homeSectionsService = {
  promoGrid(): Promise<PromoGridConfig> {
    return api.get<PromoGridConfig>('/api/home-sections/promo-grid');
  },
  adsBanner(): Promise<AdsBannerConfig> {
    return api.get<AdsBannerConfig>('/api/home-sections/ads-banner');
  },
  topBrands(): Promise<TopBrandsConfig> {
    return api.get<TopBrandsConfig>('/api/home-sections/top-brands');
  },
  topShops(): Promise<TopShopsConfig> {
    return api.get<TopShopsConfig>('/api/home-sections/top-shops');
  },
  shopByOrigin(): Promise<ShopByOriginConfig> {
    return api.get<ShopByOriginConfig>('/api/home-sections/shop-by-origin');
  },
  storesHero(): Promise<StoresHeroConfig> {
    return api.get<StoresHeroConfig>('/api/home-sections/stores-hero');
  },
  originCounts(): Promise<OriginCount[]> {
    return api.get<OriginCount[]>('/api/products/origins/counts');
  },
  brandCounts(): Promise<BrandCount[]> {
    return api.get<BrandCount[]>('/api/products/brands/counts');
  },
};

/**
 * Admin reads + writes. Mirrors the customer surface but goes through the
 * `/admin` mount, which is JWT-guarded.
 */
export const adminHomeSections = {
  getPromoGrid(): Promise<PromoGridConfig> {
    return api.get<PromoGridConfig>('/api/admin/home-sections/promo-grid');
  },
  updatePromoGrid(payload: PromoGridConfig): Promise<PromoGridConfig> {
    return api.put<PromoGridConfig>('/api/admin/home-sections/promo-grid', payload);
  },
  resetPromoGrid(): Promise<PromoGridConfig> {
    return api.delete<PromoGridConfig>('/api/admin/home-sections/promo-grid');
  },
  getAdsBanner(): Promise<AdsBannerConfig> {
    return api.get<AdsBannerConfig>('/api/admin/home-sections/ads-banner');
  },
  updateAdsBanner(payload: AdsBannerConfig): Promise<AdsBannerConfig> {
    return api.put<AdsBannerConfig>('/api/admin/home-sections/ads-banner', payload);
  },
  resetAdsBanner(): Promise<AdsBannerConfig> {
    return api.delete<AdsBannerConfig>('/api/admin/home-sections/ads-banner');
  },
  getTopBrands(): Promise<TopBrandsConfig> {
    return api.get<TopBrandsConfig>('/api/admin/home-sections/top-brands');
  },
  updateTopBrands(payload: TopBrandsConfig): Promise<TopBrandsConfig> {
    return api.put<TopBrandsConfig>('/api/admin/home-sections/top-brands', payload);
  },
  resetTopBrands(): Promise<TopBrandsConfig> {
    return api.delete<TopBrandsConfig>('/api/admin/home-sections/top-brands');
  },
  discoveredBrands(): Promise<DiscoveredBrand[]> {
    return api.get<DiscoveredBrand[]>('/api/admin/products/brands');
  },
  getShopByOrigin(): Promise<ShopByOriginConfig> {
    return api.get<ShopByOriginConfig>('/api/admin/home-sections/shop-by-origin');
  },
  updateShopByOrigin(payload: ShopByOriginConfig): Promise<ShopByOriginConfig> {
    return api.put<ShopByOriginConfig>('/api/admin/home-sections/shop-by-origin', payload);
  },
  resetShopByOrigin(): Promise<ShopByOriginConfig> {
    return api.delete<ShopByOriginConfig>('/api/admin/home-sections/shop-by-origin');
  },
  discoveredOrigins(): Promise<DiscoveredOrigin[]> {
    return api.get<DiscoveredOrigin[]>('/api/admin/products/origins');
  },
  getTopShops(): Promise<TopShopsConfig> {
    return api.get<TopShopsConfig>('/api/admin/home-sections/top-shops');
  },
  updateTopShops(payload: TopShopsConfig): Promise<TopShopsConfig> {
    return api.put<TopShopsConfig>('/api/admin/home-sections/top-shops', payload);
  },
  resetTopShops(): Promise<TopShopsConfig> {
    return api.delete<TopShopsConfig>('/api/admin/home-sections/top-shops');
  },
  getStoresHero(): Promise<StoresHeroConfig> {
    return api.get<StoresHeroConfig>('/api/admin/home-sections/stores-hero');
  },
  updateStoresHero(payload: StoresHeroConfig): Promise<StoresHeroConfig> {
    return api.put<StoresHeroConfig>('/api/admin/home-sections/stores-hero', payload);
  },
  resetStoresHero(): Promise<StoresHeroConfig> {
    return api.delete<StoresHeroConfig>('/api/admin/home-sections/stores-hero');
  },
};
