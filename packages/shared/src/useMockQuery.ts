import { useQuery, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query';

const MOCK_DELAY_MS = 600;

function mockFetch<T>(fetcher: () => T): () => Promise<T> {
  return () =>
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fetcher()), MOCK_DELAY_MS);
    });
}

/**
 * Drop-in wrapper around useQuery that resolves mock data after a fake delay.
 *
 * Usage:
 *   const { data, isLoading } = useMockQuery('products', () => mockProducts);
 *
 * When switching to a real API, replace with:
 *   const { data, isLoading } = useQuery({ queryKey: ['products'], queryFn: fetchProducts });
 */
export function useMockQuery<T>(
  key: string | string[],
  fetcher: () => T,
  options?: Omit<UseQueryOptions<T, Error, T, string[]>, 'queryKey' | 'queryFn'>
): UseQueryResult<T, Error> {
  const queryKey = Array.isArray(key) ? key : [key];

  return useQuery<T, Error, T, string[]>({
    queryKey,
    queryFn: mockFetch(fetcher),
    staleTime: Infinity, // Mock data never goes stale
    ...options,
  });
}
