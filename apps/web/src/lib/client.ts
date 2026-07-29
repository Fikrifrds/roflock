import { QueryClient, useQuery } from '@tanstack/react-query';
import { ApiError, createApi } from './api.js';

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
    // A 4xx is the daemon's answer, not a transient fault. Retrying it left
    // "no contract yet" and "no plan yet" endpoints permanently in flight, so
    // their panels showed a spinner instead of the empty state — and the state
    // a panel is meant to make visible is exactly the one that was hidden.
    retry: (failureCount, error) =>
      error instanceof ApiError && error.status < 500 ? false : failureCount < 2,
  });
}
