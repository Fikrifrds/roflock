import { QueryClient, useQuery } from '@tanstack/react-query';
import { createApi } from './api.js';

export const api = createApi();
export const queryClient = new QueryClient();

/**
 * Polled read of a daemon endpoint. The interval is the fallback path; the SSE
 * stream in `Shell` invalidates queries as soon as the daemon publishes.
 */
export function useData<T>(key: string[], path: string, enabled = true) {
  return useQuery({
    queryKey: key,
    queryFn: () => api.request<T>(path),
    enabled,
    refetchInterval: 2000,
  });
}
