import type { AppEntryAdSession } from './app-entry-ad';

type Playback = { clientEventId: string; isEnded: boolean };
type Progress = { shouldContinue: boolean; completedCount: number };
type ShowInput = { mode: 'INTERSTITIAL' | 'REWARDED_GATED'; placementId: string; sessionId: string; adIndex: number; onShown?: () => void };

export async function runEntryAdFlow(session: AppEntryAdSession, actions: {
  show: (input: ShowInput) => Promise<Playback>;
  complete: (sessionId: string, clientEventId: string, isEnded: boolean) => Promise<Progress>;
  wait: (ms: number) => Promise<void>;
  isActive: () => boolean;
  onError: (cause: unknown) => void;
  onAdShown?: () => void;
}) {
  if (!session.sessionId || !session.mode || !session.placementId || !session.requiredCount) throw new Error('ENTRY_AD_SESSION_UNAVAILABLE');
  const { sessionId, mode, placementId, requiredCount } = session;
  let completed = session.completedCount ?? 0;
  let failures = 0;
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
      await actions.wait(Math.min(failures, 5) * 500);
      continue;
    }
    if (!actions.isActive()) return;
    failures = 0;
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
        if (failures >= 3) throw cause;
        await actions.wait(Math.min(failures, 5) * 500);
      }
    }
  }
}
