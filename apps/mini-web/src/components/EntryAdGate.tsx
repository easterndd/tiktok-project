import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { completeAppEntryAd, showAppEntryAd, startAppEntryAdSession } from '../features/ads/app-entry-ad';
import { runEntryAdFlow } from '../features/ads/entry-ad-flow';
import { ensureAnonymousSession, ensureTikTokSession } from '../features/auth/anonymous-session';
import { reportDiagnostic } from '../lib/diagnostics';
import { ApiError } from '../lib/api-client';
import styles from './EntryAdGate.module.css';

type GateState = 'LOADING' | 'READY' | 'ERROR';
type GateStep = 'ANONYMOUS_SESSION' | 'ENTRY_AD_POLICY' | 'ENTRY_AD_PLAYBACK';
const EntryAdReadyContext = createContext(true);

export function useEntryAdReady() {
  return useContext(EntryAdReadyContext);
}

function formatGateError(step: GateStep, cause: unknown) {
  const detail = cause instanceof Error && cause.message ? `: ${cause.message}` : '';
  if (step === 'ANONYMOUS_SESSION') {
    return `Unable to connect to the app service. Please check the API URL and try again${detail}`;
  }
  if (step === 'ENTRY_AD_POLICY') {
    return `Unable to load the entry-ad policy. Please try again${detail}`;
  }
  if (cause instanceof Error && cause.message === 'ENTRY_AD_UNAVAILABLE') {
    return 'TikTok does not currently provide this ad placement in Preview. The app can continue without the entry ad.';
  }
  return `The entry ad could not be shown. Please try again${detail}`;
}

export function EntryAdGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('LOADING');
  const [attempt, setAttempt] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const startupTimer = window.setTimeout(() => {
      if (!controller.signal.aborted) reportDiagnostic({ kind: 'STARTUP', phase: 'ENTRY_GATE_SLOW', message: 'Entry gate has not completed after 15 seconds', durationMs: Date.now() - startedAt });
    }, 15_000);
    const wait = (ms: number) => new Promise<void>((resolve) => {
      if (controller.signal.aborted) return resolve();
      const timer = window.setTimeout(done, ms);
      function done() {
        window.clearTimeout(timer);
        controller.signal.removeEventListener('abort', done);
        resolve();
      }
      controller.signal.addEventListener('abort', done, { once: true });
    });
    const run = async () => {
      let failures = 0;
      while (!controller.signal.aborted) {
        let step: GateStep = 'ANONYMOUS_SESSION';
        try {
          await ensureAnonymousSession();
          if (controller.signal.aborted) return;
          step = 'ENTRY_AD_POLICY';
          const session = await startAppEntryAdSession();
          if (controller.signal.aborted) return;
          if (session.required) {
            step = 'ENTRY_AD_PLAYBACK';
            await runEntryAdFlow(session, { show: showAppEntryAd, complete: completeAppEntryAd, refreshSession: startAppEntryAdSession, wait, isActive: () => !controller.signal.aborted, onError: (cause) => {
              reportDiagnostic({ kind: 'AD', phase: 'ENTRY_AD_PLAYBACK', message: cause instanceof Error ? cause.message : String(cause) });
              console.warn('[EntryAdGate] entry ad unavailable; retrying', cause);
            } });
          }
          if (!controller.signal.aborted) {
            window.clearTimeout(startupTimer);
            setState('READY');
            void ensureTikTokSession().catch(() => undefined);
          }
          return;
        } catch (cause) {
          if (controller.signal.aborted) return;
          reportDiagnostic({ kind: step === 'ENTRY_AD_PLAYBACK' ? 'AD' : 'STARTUP', phase: step, message: cause instanceof Error ? cause.message : String(cause), durationMs: Date.now() - startedAt });
          console.error(`[EntryAdGate] ${step} failed`, cause);
          console.warn(formatGateError(step, cause));
          if (++failures >= 3) {
            window.clearTimeout(startupTimer);
            setErrorMessage(step === 'ENTRY_AD_PLAYBACK' ? 'The ad is unavailable right now. Please try again.' : 'Unable to connect. Check your connection and try again.');
            setState('ERROR');
            return;
          }
          await wait(cause instanceof ApiError && cause.status === 429 && cause.retryAfterSeconds !== undefined
            ? Math.min(300_000, Math.max(1_000, cause.retryAfterSeconds * 1_000)) : 2_000);
        }
      }
    };
    void run();
    return () => { controller.abort(); window.clearTimeout(startupTimer); };
  }, [attempt]);
  return <EntryAdReadyContext.Provider value={state === 'READY'}>
    {children}
    {state === 'ERROR' && <aside className={styles.notice} role="alert"><p>{errorMessage}</p><button onClick={() => { setState('LOADING'); setAttempt((value) => value + 1); }}>Try again</button></aside>}
  </EntryAdReadyContext.Provider>;
}
