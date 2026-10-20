import { useEffect } from 'react';
import { completeAppEntryAd, getLaunchId, showAppEntryAd, startAppEntryAdSession } from '../features/ads/app-entry-ad';
import { isPaidStoryLandEntry } from '../features/ads/paid-entry-context';
import { ensureAnonymousSession } from '../features/auth/anonymous-session';
import { reportDiagnostic } from '../lib/diagnostics';
import { storagePrefix } from '../lib/app-brand';

const firstAdDelayMs = 30_000;

/** A single, optional insertion after paid visitors have reached app content. */
export function StoryLandEntryAd() {
  useEffect(() => {
    const paidEntry = isPaidStoryLandEntry(window.location.search, window.location.pathname);
    if (!paidEntry) return;

    let cancelled = false;
    let timer: number | undefined;
    const attemptKey = `${storagePrefix}_${getLaunchId()}_paid_entry_ad_attempted`;
    if (sessionStorage.getItem(attemptKey) === '1') return;
    const attempt = () => {
      if (cancelled || document.visibilityState === 'hidden' ||
          !isPaidStoryLandEntry(window.location.search, window.location.pathname)) return;
      void (async () => {
        try {
          await ensureAnonymousSession();
          if (cancelled) return;
          const session = await startAppEntryAdSession();
          if (cancelled || document.visibilityState === 'hidden' ||
              !isPaidStoryLandEntry(window.location.search, window.location.pathname) ||
              !session.required || session.mode !== 'INTERSTITIAL' ||
              !session.sessionId || !session.placementId) return;
          sessionStorage.setItem(attemptKey, '1');
          const result = await showAppEntryAd({
            mode: 'INTERSTITIAL', placementId: session.placementId,
            sessionId: session.sessionId, adIndex: (session.completedCount ?? 0) + 1
          });
          if (!cancelled) await completeAppEntryAd(session.sessionId, result.clientEventId, result.isEnded);
        } catch (error) {
          reportDiagnostic({ kind: 'AD', phase: 'STORYLAND_PAID_ENTRY_AD',
            message: error instanceof Error ? error.message : String(error) });
        }
      })();
    };
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== 'hidden') timer = window.setTimeout(attempt, firstAdDelayMs);
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);

    return () => { cancelled = true; window.clearTimeout(timer); document.removeEventListener('visibilitychange', schedule); };
  }, []);
  return null;
}
