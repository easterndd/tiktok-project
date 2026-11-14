import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { acknowledgeAppEntryAdShown, completeAppEntryAd, showAppEntryAd, startAppEntryAdSession } from '../features/ads/app-entry-ad';
import { runEntryAdFlow } from '../features/ads/entry-ad-flow';
import { runEntryAdFlowV2 } from '../features/ads/entry-ad-flow-v2';
import { queueEntryObservation } from '../features/ads/entry-observations';
import { queueLegacyEntryObservation } from '../features/ads/entry-legacy-observations';
import { getLocalEntryAdPlacementIds } from '../features/ads/entry-ad-placements';
import { attemptLocalEntryAd } from '../features/ads/local-entry-ad';
import { ensureAnonymousSession, ensureTikTokSession, recordMiniLaunch } from '../features/auth/anonymous-session';
import { reportDiagnostic } from '../lib/diagnostics';
import { recordEntryAdDecision } from '../lib/analytics';
import { ApiError, apiClient } from '../lib/api-client';
import { campaignLaunchOptionsEvent, getCampaignEntryTarget, hasCampaignEntryIntent } from '../lib/launch-context';
import { appKey } from '../lib/app-brand';
import { isLaunchAttributionRelease } from '../features/ads/ad-platform';
import styles from './EntryAdGate.module.css';

type GateState = 'LOADING' | 'READY' | 'ERROR';
type GateStep = 'ANONYMOUS_SESSION' | 'ENTRY_AD_POLICY' | 'ENTRY_AD_PLAYBACK';
const EntryAdReadyContext = createContext(true);
const campaignLaunchWaitMs = 1_200;

function waitForCampaignLaunchOptions(signal: AbortSignal) {
  if (getCampaignEntryTarget() || hasCampaignEntryIntent()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener(campaignLaunchOptionsEvent, check);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const check = () => {
      if (getCampaignEntryTarget() || hasCampaignEntryIntent()) finish();
    };
    const timer = window.setTimeout(finish, campaignLaunchWaitMs);
    window.addEventListener(campaignLaunchOptionsEvent, check);
    signal.addEventListener('abort', finish, { once: true });
  });
}

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
  const navigate = useNavigate();
  const localPlacementIds = getLocalEntryAdPlacementIds();
  const localEntryMode = localPlacementIds.length === 2;
  const [state, setState] = useState<GateState>('LOADING');
  const [attempt, setAttempt] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const startupTimer = window.setTimeout(() => {
      if (!controller.signal.aborted) reportDiagnostic({ kind: 'STARTUP', phase: 'ENTRY_GATE_SLOW', message: 'Entry gate has not completed after 15 seconds', durationMs: Date.now() - startedAt });
    }, 15_000);
    const run = async () => {
      await waitForCampaignLaunchOptions(controller.signal);
      if (controller.signal.aborted) return;
      let launchRecord: Awaited<ReturnType<typeof recordMiniLaunch>> | undefined;
      let attributionUnavailable = false;
      if (isLaunchAttributionRelease()) {
        await ensureAnonymousSession();
        try {
          launchRecord = await recordMiniLaunch();
        } catch (cause) {
          attributionUnavailable = true;
          recordEntryAdDecision({ decision: 'SUPPRESS', reason: 'ATTRIBUTION_UNAVAILABLE', required: false });
          reportDiagnostic({ kind: 'STARTUP', phase: 'LAUNCH_ATTRIBUTION_SAVE', message: cause instanceof Error ? cause.message : String(cause) });
        }
      }
      const campaignTarget = getCampaignEntryTarget();
      if (!campaignTarget && hasCampaignEntryIntent()) {
        window.clearTimeout(startupTimer);
        setState('READY');
        navigate('/', { replace: true });
        return;
      }
      if (campaignTarget) {
        try {
          const query = new URLSearchParams({ album_id: campaignTarget.albumId, episode_id: campaignTarget.episodeId });
          const target = await apiClient.getPublic<{ status: 'PLAYABLE'; albumId: string; episodeId: string }>(`/campaign-entry/resolve?${query}`);
          if (target.status !== 'PLAYABLE') throw new ApiError('Campaign episode is unavailable.', 404, 'NOT_FOUND');
          if (controller.signal.aborted) return;
          window.clearTimeout(startupTimer);
          setState('READY');
          navigate(`/watch/${encodeURIComponent(target.albumId)}/${encodeURIComponent(target.episodeId)}`, { replace: true });
          return;
        } catch (cause) {
          if (controller.signal.aborted) return;
          if (!(cause instanceof ApiError) || cause.status !== 404) {
            reportDiagnostic({ kind: 'STARTUP', phase: 'CAMPAIGN_ENTRY_RESOLVE', message: cause instanceof Error ? cause.message : String(cause) });
          }
          navigate('/', { replace: true });
          return;
        }
      }

      if (localEntryMode && !isLaunchAttributionRelease()) {
        const anonymousSession = ensureAnonymousSession();
        void anonymousSession.then(() => setState('READY'), () => setState('READY'));
        void attemptLocalEntryAd({
          placementIds: localPlacementIds,
          getEligibility: async () => {
            await anonymousSession;
            void ensureTikTokSession().catch(() => undefined);
            const result = await recordMiniLaunch();
            return result?.entryAdEligibility;
          },
          isActive: () => !controller.signal.aborted
        }).catch((cause) => {
          reportDiagnostic({ kind: 'AD', phase: 'LOCAL_ENTRY_AD', message: cause instanceof Error ? cause.message : String(cause) });
        });
        return;
      }

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
      let failures = 0;
      while (!controller.signal.aborted) {
        let step: GateStep = 'ANONYMOUS_SESSION';
        try {
          await ensureAnonymousSession();
          if (controller.signal.aborted) return;
          if (appKey === 'storyland') await ensureTikTokSession().catch(() => undefined);
          if (controller.signal.aborted) return;
          step = 'ENTRY_AD_POLICY';
          if (attributionUnavailable || (isLaunchAttributionRelease() && !launchRecord?.launchRef)) {
            if (!attributionUnavailable) recordEntryAdDecision({ decision: 'SUPPRESS', reason: 'ATTRIBUTION_UNAVAILABLE', required: false });
            window.clearTimeout(startupTimer);
            setState('READY');
            if (appKey !== 'storyland') void ensureTikTokSession().catch(() => undefined);
            return;
          }
          const session = await startAppEntryAdSession(launchRecord?.launchRef);
          if (controller.signal.aborted) return;
          if (session.required) {
            step = 'ENTRY_AD_PLAYBACK';
            if (session.entryFlowVersion === 2 && session.mode === 'REWARDED_GATED') {
              await runEntryAdFlowV2(session, {
                show: showAppEntryAd, observe: (observation) => session.legacyObservationProtocol
                  ? queueLegacyEntryObservation(session.sessionId!, session.countMode ?? 'COMPLETED', observation)
                  : queueEntryObservation(session.sessionId!, observation),
                wait, isActive: () => !controller.signal.aborted,
                onError: (cause) => reportDiagnostic({ kind: 'AD', phase: 'ENTRY_AD_PLAYBACK_V2', message: cause instanceof Error ? cause.message : String(cause) })
              });
            } else await runEntryAdFlow(session, { show: showAppEntryAd, complete: (sessionId, clientEventId, isEnded, adIndex, placementId, adType) => session.countMode === 'SHOWN'
              ? acknowledgeAppEntryAdShown(sessionId, clientEventId, adIndex!, placementId, adType)
              : completeAppEntryAd(sessionId, clientEventId, isEnded), refreshSession: startAppEntryAdSession, wait, isActive: () => !controller.signal.aborted, onError: (cause) => {
              reportDiagnostic({ kind: 'AD', phase: 'ENTRY_AD_PLAYBACK', message: cause instanceof Error ? cause.message : String(cause) });
              console.warn('[EntryAdGate] entry ad unavailable; retrying', cause);
            } });
          }
          if (!controller.signal.aborted) {
            window.clearTimeout(startupTimer);
            setState('READY');
            if (appKey !== 'storyland') void ensureTikTokSession().catch(() => undefined);
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
    return () => {
      controller.abort();
      window.clearTimeout(startupTimer);
    };
  }, [attempt, localEntryMode, navigate]);
  return <EntryAdReadyContext.Provider value={state === 'READY'}>
    {children}
    {state === 'ERROR' && <aside className={`${styles.notice} ${import.meta.env.VITE_DEBUG_PANEL === 'true' ? styles.debugNotice : ''}`} role="alert"><p>{errorMessage}</p><button onClick={() => { setState('LOADING'); setAttempt((value) => value + 1); }}>Try again</button></aside>}
  </EntryAdReadyContext.Provider>;
}
