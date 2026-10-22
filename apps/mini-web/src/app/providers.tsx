import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { EntryAdGate } from '../components/EntryAdGate';
import { startAppEntryAdSession } from '../features/ads/app-entry-ad';
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
let sdkLaunchListenerInstalled = false;

function AnonymousSessionBootstrap() {
  useEffect(() => {
    const minis = window.TTMinis;
    if (!sdkLaunchListenerInstalled && minis?.onShow && minis.canIUse?.('onShow.callback')) {
      try {
        minis.onShow((payload) => {
          if (payload === undefined) return;
          try {
            const raw = JSON.stringify(payload);
            if (raw && raw.length <= 32768) void recordMiniLaunch(raw).catch(() => undefined);
          } catch { /* Some SDK payloads cannot be serialized. */ }
        });
        sdkLaunchListenerInstalled = true;
      } catch { /* onShow is optional on older TikTok clients. */ }
    }
    void ensureAnonymousSession()
      .then(async () => {
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
