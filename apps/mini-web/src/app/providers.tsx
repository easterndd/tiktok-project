import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { EntryAdGate } from '../components/EntryAdGate';
import { startAppEntryAdSession } from '../features/ads/app-entry-ad';
import { getLocalEntryAdPlacementIds } from '../features/ads/entry-ad-placements';
import { ensureAnonymousSession, ensureTikTokSession, recordMiniLaunch } from '../features/auth/anonymous-session';
import { appKey } from '../lib/app-brand';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 4_000),
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
        if (appKey === 'storyland') await startAppEntryAdSession();
      })
      .catch(() => undefined);
  }, []);
  return null;
}

function StoryLandTikTokSessionBootstrap() {
  useEffect(() => {
    if (appKey === 'storyland') void ensureTikTokSession().catch(() => undefined);
  }, []);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}><AnonymousSessionBootstrap /><StoryLandTikTokSessionBootstrap />{appKey === 'storyland'
    ? children
    : <EntryAdGate>{children}</EntryAdGate>}</QueryClientProvider>;
}
