type PlayerCore = {
  play?: () => void | Promise<void>;
  paused?: boolean;
};

type AutoplayOptions = {
  maxAttempts?: number;
  retryDelayMs?: number;
};

export function createPlayerAutoplay(
  getPlayer: () => PlayerCore | undefined,
  onStarted: () => void,
  onFallback: () => void,
  { maxAttempts = 4, retryDelayMs = 500 }: AutoplayOptions = {}
) {
  let attempts = 0;
  let requestPending = false;
  let started = false;
  let disposed = false;
  let fallbackShown = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const markStarted = () => {
    if (disposed || started) return;
    started = true;
    if (retryTimer) clearTimeout(retryTimer);
    onStarted();
  };

  const showFallback = () => {
    if (disposed || started || fallbackShown) return;
    fallbackShown = true;
    onFallback();
  };

  const scheduleAttempt = () => {
    if (disposed || started || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      attempt();
    }, retryDelayMs);
  };

  const attempt = () => {
    if (disposed || started || requestPending || retryTimer) return;
    const player = getPlayer();
    if (!player?.play) return;
    if (player.paused === false) {
      markStarted();
      return;
    }
    if (attempts >= maxAttempts) {
      showFallback();
      return;
    }

    attempts += 1;
    requestPending = true;
    let result: void | Promise<void>;
    try {
      result = player.play();
    } catch {
      requestPending = false;
      scheduleAttempt();
      return;
    }
    void Promise.resolve(result).then(() => {
      requestPending = false;
      if (disposed || started) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (getPlayer()?.paused === false) markStarted();
        else attempt();
      }, retryDelayMs);
    }, () => {
      requestPending = false;
      scheduleAttempt();
    });
  };

  return {
    attempt,
    markStarted,
    dispose() {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  };
}
