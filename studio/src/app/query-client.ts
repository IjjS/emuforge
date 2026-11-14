import { QueryClient } from '@tanstack/react-query';

/**
 * A new TanStack Query client. Queries are not retried or refetched behind the screen's back: the engine client
 * does its own single session retry, and each screen decides when it checks again.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
    },
  });
}
