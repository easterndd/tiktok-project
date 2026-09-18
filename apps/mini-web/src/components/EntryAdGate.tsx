import { AlertCircle, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { completeAppEntryAd, showAppEntryAd, startAppEntryAdSession, type AppEntryAdSession } from '../features/ads/app-entry-ad';
import { ensureAnonymousSession } from '../features/auth/anonymous-session';
import styles from './EntryAdGate.module.css';

type GateState = 'LOADING' | 'BLOCKED' | 'READY';
type GateStep = 'ANONYMOUS_SESSION' | 'ENTRY_AD_POLICY' | 'ENTRY_AD_PLAYBACK';

function formatGateError(step: GateStep, cause: unknown) {
  const detail = cause instanceof Error && cause.message ? `: ${cause.message}` : '';
  if (step === 'ANONYMOUS_SESSION') {
    return `SESSION_BOOTSTRAP_FAILED${detail}`;
  }
  if (step === 'ENTRY_AD_POLICY') {
    return `ENTRY_AD_POLICY_FAILED${detail}`;
  }
  return `ENTRY_AD_PLAYBACK_FAILED${detail}`;
}

export function EntryAdGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('LOADING');
  const [error, setError] = useState('');
  const started = useRef(false);

  const completeGate = async (session: AppEntryAdSession) => {
    if (!session.sessionId || !session.mode || !session.placementId || !session.requiredCount) throw new Error('ENTRY_AD_SESSION_UNAVAILABLE');
    let completed = session.completedCount ?? 0;
    while (completed < session.requiredCount) {
      try {
        const completionEventId = await showAppEntryAd({ mode: session.mode, placementId: session.placementId, sessionId: session.sessionId, adIndex: completed + 1 });
        const result = await completeAppEntryAd(session.sessionId, completionEventId);
        if (!result.shouldContinue) return;
        completed += 1;
      } catch (cause) {
        if (cause instanceof Error && cause.message === 'ENTRY_AD_NOT_COMPLETED') throw cause;
        if (session.onUnavailable === 'ALLOW') return;
        throw cause;
      }
    }
  };

  const run = async () => {
    setState('LOADING');
    setError('');
    let step: GateStep = 'ANONYMOUS_SESSION';
    try {
      await ensureAnonymousSession();
      step = 'ENTRY_AD_POLICY';
      const session = await startAppEntryAdSession();
      if (session.required) {
        step = 'ENTRY_AD_PLAYBACK';
        await completeGate(session);
      }
      setState('READY');
    } catch (cause) {
      console.error(`[EntryAdGate] ${step} failed`, cause);
      setError(formatGateError(step, cause));
      setState('BLOCKED');
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, []);
  if (state === 'READY') return <>{children}</>;
  return <main className={styles.gate} aria-busy={state === 'LOADING'}><section className={styles.surface} aria-live="polite">
    {state === 'LOADING' ? <><span className={styles.spinner} /><h1>QuicK ReeLS</h1><p>Preparing your next story</p></> : <><AlertCircle size={28} aria-hidden="true" /><h1>Unable to continue</h1><p>{error}</p><button onClick={() => void run()}><RefreshCw size={17} aria-hidden="true" />Try again</button></>}
  </section></main>;
}
