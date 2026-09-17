import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { ensureAnonymousSession } from '../features/auth/anonymous-session';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

function AnonymousSessionBootstrap() {
  useEffect(() => {
    void ensureAnonymousSession().catch(() => undefined);
  }, []);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}><AnonymousSessionBootstrap />{children}</QueryClientProvider>;
}
