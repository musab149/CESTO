import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { businessMe, businessCatalogue, type BusinessMe, type BusinessProductsParams } from './services/business';

/**
 * The business panel's queries (2026-10-29). Only the panel's own endpoints —
 * the cart, checkout, orders and addresses are the customer hooks.
 */

export const BUSINESS_ME_KEY = ['business-me'] as const;
export const BUSINESS_CATALOGUE_KEY = ['business-catalogue'] as const;

/** The browse cards change when the office edits the catalogue — seldom. */
const TAXONOMY_STALE = 10 * 60 * 1000;

export const useBusinessMe = (opts: { enabled?: boolean } = {}) =>
  useQuery<BusinessMe>({
    queryKey: BUSINESS_ME_KEY,
    queryFn: () => businessMe.get(),
    enabled: opts.enabled ?? true,
    retry: false,
  });

export const useBusinessProducts = (params: BusinessProductsParams = {}, enabled = true) =>
  useQuery({
    queryKey: [...BUSINESS_CATALOGUE_KEY, 'products', params],
    queryFn: () => businessCatalogue.products(params),
    enabled,
    // Paging or filtering keeps the last page on screen until the next lands.
    placeholderData: keepPreviousData,
  });

/** The catalogue grid: the next page as the end of the grid comes into view. */
export const useBusinessProductsInfinite = (params: Omit<BusinessProductsParams, 'page'> = {}) =>
  useInfiniteQuery({
    queryKey: [...BUSINESS_CATALOGUE_KEY, 'grid', params],
    queryFn: ({ pageParam }) => businessCatalogue.products({ ...params, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });

export const useBusinessProduct = (id: string | undefined) =>
  useQuery({
    queryKey: [...BUSINESS_CATALOGUE_KEY, 'product', id],
    queryFn: () => businessCatalogue.product(id!),
    enabled: !!id,
    retry: false,
  });

export const useBusinessCategories = () =>
  useQuery({ queryKey: [...BUSINESS_CATALOGUE_KEY, 'categories'], queryFn: () => businessCatalogue.categories(), staleTime: TAXONOMY_STALE });

export const useBusinessBrands = () =>
  useQuery({ queryKey: [...BUSINESS_CATALOGUE_KEY, 'brands'], queryFn: () => businessCatalogue.brands(), staleTime: TAXONOMY_STALE });

export const useBusinessOrigins = () =>
  useQuery({ queryKey: [...BUSINESS_CATALOGUE_KEY, 'origins'], queryFn: () => businessCatalogue.origins(), staleTime: TAXONOMY_STALE });

export const useBusinessStores = () =>
  useQuery({ queryKey: [...BUSINESS_CATALOGUE_KEY, 'stores'], queryFn: () => businessCatalogue.stores(), staleTime: TAXONOMY_STALE });

/** The home's rails (2026-10-31). New products change with the catalogue; what they order most, with each order. */
export const useBusinessNewArrivals = () =>
  useQuery({ queryKey: [...BUSINESS_CATALOGUE_KEY, 'new'], queryFn: () => businessCatalogue.newArrivals(12), staleTime: TAXONOMY_STALE });

export const useBusinessUsuals = () =>
  useQuery({ queryKey: [...BUSINESS_CATALOGUE_KEY, 'usuals'], queryFn: () => businessCatalogue.usuals(12), staleTime: 60 * 1000 });
