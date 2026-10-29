import type { AppEntryAdSession } from './app-entry-ad';

type Playback = { clientEventId: string; isEnded: boolean };
type Progress = { shouldContinue: boolean; completedCount: number };
type ShowInput = {
  mode: 'INTERSTITIAL' | 'REWARDED_GATED';
  placementId: string;
  sessionId: string;
  adIndex: number;
  requiredCount?: number;
  countMode?: 'COMPLETED' | 'SHOWN';
  onShown?: (playback: Playback) => void;
};

function httpStatus(cause: unknown) {
  if (!cause || typeof cause !== 'object' || !('status' in cause)) return undefined;
  const status = cause.status;
  return typeof status === 'number' ? status : undefined;
}

function retryDelayMs(cause: unknown, fallbackMs: number) {
  if (httpStatus(cause) !== 429 || !cause || typeof cause !== 'object' || !('retryAfterSeconds' in cause)) return fallbackMs;
  const seconds = cause.retryAfterSeconds;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
    ? Math.min(300_000, Math.max(1_000, seconds * 1_000)) : fallbackMs;
}

function showRetryDelayMs(cause: unknown, failures: number) {
  return retryDelayMs(cause, Math.min(5_000, 1_000 * 2 ** (failures - 1)));
}

async function acknowledgeShown(actions: {
  complete: (sessionId: string, clientEventId: string, isEnded: boolean, adIndex?: number) => Promise<Progress>;
  wait: (ms: number) => Promise<void>;
  isActive: () => boolean;
}, sessionId: string, clientEventId: string, adIndex: number) {
  let failures = 0;
  while (actions.isActive()) {
    try {
      return await actions.complete(sessionId, clientEventId, true, adIndex);
    } catch (cause) {
      const status = httpStatus(cause);
      if (status !== undefined && status >= 400 && status < 500 && status !== 429) throw cause;
      if (++failures >= 3) throw cause;
      await actions.wait(retryDelayMs(cause, Math.min(failures, 5) * 500));
    }
  }
  throw new Error('ENTRY_AD_FLOW_CANCELLED');
}

export async function runEntryAdFlow(session: AppEntryAdSession, actions: {
  show: (input: ShowInput) => Promise<Playback>;
  complete: (sessionId: string, clientEventId: string, isEnded: boolean, adIndex?: number) => Promise<Progress>;
  refreshSession: () => Promise<AppEntryAdSession>;
  wait: (ms: number) => Promise<void>;
  isActive: () => boolean;
  onError: (cause: unknown) => void;
  onAdShown?: () => void;
}) {
  if (!session.sessionId || !session.mode || !session.placementId || !session.requiredCount) throw new Error('ENTRY_AD_SESSION_UNAVAILABLE');
  let { sessionId, mode, placementId, requiredCount } = session;
  let completed = session.completedCount ?? 0;
  let failures = 0;
  let sessionRecoveries = 0;
  // SHOWN mode records one ordered server acknowledgement per impression, but
  // does not wait for that HTTP round trip before opening the next ad.
  let shownCompletionQueue: Promise<Progress> | undefined;
  while (actions.isActive() && completed < requiredCount) {
    let playback: Playback;
    let queuedShownCompletion: Promise<Progress> | undefined;
    try {
      const adIndex = completed + 1;
      playback = await actions.show({
        mode,
        placementId,
        sessionId,
        adIndex,
        requiredCount,
        countMode: session.countMode,
        onShown: (shownPlayback) => {
          actions.onAdShown?.();
          if (session.countMode !== 'SHOWN') return;
          const previous = shownCompletionQueue ?? Promise.resolve({ shouldContinue: true, completedCount: completed });
          queuedShownCompletion = shownCompletionQueue = previous.then(() => acknowledgeShown(actions, sessionId, shownPlayback.clientEventId, adIndex));
          void queuedShownCompletion.catch(() => undefined);
        }
      });
    } catch (cause) {
      if (!actions.isActive()) return;
      failures += 1;
      actions.onError(cause);
      if (failures >= 3) {
        if (session.onUnavailable === 'ALLOW') return;
        throw cause;
      }
      await actions.wait(showRetryDelayMs(cause, failures));
      continue;
    }
    if (!actions.isActive()) return;
    failures = 0;
    if (session.countMode === 'SHOWN' && queuedShownCompletion) {
      // The local counter advances immediately. The ordered queue is awaited
      // only when the final ad has been shown, so ad-to-ad handoff is native.
      completed += 1;
      if (completed >= requiredCount) {
        try {
          await queuedShownCompletion;
        } catch (cause) {
          if (!actions.isActive()) return;
          throw cause;
        }
        return;
      }
      continue;
    }
    let refreshRequired = false;
    // A shown ad must be acknowledged before another one is opened, even if the HTTP response is lost.
    while (actions.isActive()) {
      try {
        const result = await actions.complete(sessionId, playback.clientEventId, playback.isEnded);
        if (!actions.isActive() || !result.shouldContinue) return;
        completed = result.completedCount;
        break;
      } catch (cause) {
        if (!actions.isActive()) return;
        failures += 1;
        actions.onError(cause);
        const status = httpStatus(cause);
        if (status === 409) {
          if (++sessionRecoveries > 3) throw cause;
          const refreshed = await actions.refreshSession();
          if (!actions.isActive() || !refreshed.required) return;
          if (!refreshed.sessionId || !refreshed.mode || !refreshed.placementId || !refreshed.requiredCount) {
            throw new Error('ENTRY_AD_SESSION_UNAVAILABLE');
          }
          sessionId = refreshed.sessionId;
          mode = refreshed.mode;
          placementId = refreshed.placementId;
          requiredCount = refreshed.requiredCount;
          completed = refreshed.completedCount ?? 0;
          failures = 0;
          refreshRequired = true;
          break;
        }
        if (status !== undefined && status >= 400 && status < 500 && status !== 429) throw cause;
        if (failures >= 3) throw cause;
        await actions.wait(retryDelayMs(cause, Math.min(failures, 5) * 500));
      }
      if (refreshRequired) break;
    }
    if (refreshRequired) continue;
  }
}
