import { useEffect, useState, type ReactNode } from 'react';
import { completeAppEntryAd, showAppEntryAd, startAppEntryAdSession } from '../features/ads/app-entry-ad';
import { runEntryAdFlow } from '../features/ads/entry-ad-flow';
import { ensureAnonymousSession } from '../features/auth/anonymous-session';
import { appName } from '../lib/app-brand';
import { reportDiagnostic } from '../lib/diagnostics';
import styles from './EntryAdGate.module.css';

type GateState = 'LOADING' | 'READY';
type GateStep = 'ANONYMOUS_SESSION' | 'ENTRY_AD_POLICY' | 'ENTRY_AD_PLAYBACK';

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
            await runEntryAdFlow(session, { show: showAppEntryAd, complete: completeAppEntryAd, wait, isActive: () => !controller.signal.aborted, onError: (cause) => {
              reportDiagnostic({ kind: 'AD', phase: 'ENTRY_AD_PLAYBACK', message: cause instanceof Error ? cause.message : String(cause) });
              console.warn('[EntryAdGate] entry ad unavailable; retrying', cause);
            } });
          }
          if (!controller.signal.aborted) { window.clearTimeout(startupTimer); setState('READY'); }
          return;
        } catch (cause) {
          if (controller.signal.aborted) return;
          reportDiagnostic({ kind: step === 'ENTRY_AD_PLAYBACK' ? 'AD' : 'STARTUP', phase: step, message: cause instanceof Error ? cause.message : String(cause), durationMs: Date.now() - startedAt });
          console.error(`[EntryAdGate] ${step} failed`, cause);
          console.warn(formatGateError(step, cause));
          await wait(2000);
        }
      }
    };
    void run();
    return () => { controller.abort(); window.clearTimeout(startupTimer); };
  }, []);
  if (state === 'READY') return <>{children}</>;
  return <main className={styles.gate} aria-busy="true"><section className={styles.surface} aria-live="polite">
    <span className={styles.spinner} /><h1>{appName}</h1><p>Preparing your next story</p>
  </section></main>;
}
