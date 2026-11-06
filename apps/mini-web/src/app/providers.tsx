import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { getLocalEntryAdPlacementIds } from '../features/ads/entry-ad-placements';
import { ensureAnonymousSession, recordMiniLaunch } from '../features/auth/anonymous-session';
import { ApiError } from '../lib/api-client';

function shouldRetryQuery(failureCount: number, error: unknown) {
  if (failureCount >= 1) return false;
  if (!(error instanceof ApiError)) return true;
  return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
}

function retryDelay(attempt: number, error: unknown) {
  const minimum = error instanceof ApiError && (error.status === 429 || error.status === 503)
    ? (error.retryAfterSeconds ?? 0) * 1_000
    : 0;
  return Math.min(10_000, Math.max(1_000 * 2 ** attempt, minimum) + Math.random() * 500);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      retryDelay,
      staleTime: 30_000,
      refetchOnReconnect: true
    }
  }
});
function AnonymousSessionBootstrap() {
  useEffect(() => {
    void ensureAnonymousSession()
      .then(async () => {
        if (getLocalEntryAdPlacementIds().length === 2) return;
        await recordMiniLaunch();
      })
      .catch(() => undefined);
  }, []);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}><AnonymousSessionBootstrap />{children}</QueryClientProvider>;
}
