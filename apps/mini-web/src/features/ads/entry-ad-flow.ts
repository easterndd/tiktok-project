import type { AppEntryAdSession } from './app-entry-ad';

type Playback = { clientEventId: string; isEnded: boolean };
type Progress = { shouldContinue: boolean; completedCount: number };
type ShowInput = { mode: 'INTERSTITIAL' | 'REWARDED_GATED'; placementId: string; sessionId: string; adIndex: number; onShown?: () => void };

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

export async function runEntryAdFlow(session: AppEntryAdSession, actions: {
  show: (input: ShowInput) => Promise<Playback>;
  complete: (sessionId: string, clientEventId: string, isEnded: boolean) => Promise<Progress>;
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
  while (actions.isActive() && completed < requiredCount) {
    let playback: Playback;
    try {
      playback = await actions.show({ mode, placementId, sessionId, adIndex: completed + 1, onShown: actions.onAdShown });
    } catch (cause) {
      if (!actions.isActive()) return;
      failures += 1;
      actions.onError(cause);
      if (failures >= 3) {
        if (session.onUnavailable === 'ALLOW') return;
        throw cause;
      }
      await actions.wait(retryDelayMs(cause, Math.min(failures, 5) * 500));
      continue;
    }
    if (!actions.isActive()) return;
    failures = 0;
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
