import type { PlayInfo } from '@quickreels/shared-types';
import { AlertCircle, Play } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DramaPlayerController } from '../features/player/drama-player-controller';
import { createPlayerAutoplay } from '../features/player/player-autoplay';
import { nativeAdActive, subscribeNativeAdIdle } from '../features/ads/ad-activity';
import { apiClient } from '../lib/api-client';
import { reportDiagnostic, reportPerformance } from '../lib/diagnostics';
import { t } from '../lib/i18n';
import { useLocale } from '../lib/storage';
import { getAdPlatform, getMiniReleaseId, isMiniPageVisible, isV006Release, subscribeMiniForeground } from '../features/ads/ad-platform';
import styles from './PlayerShell.module.css';

function positionFromEvent(event: unknown) {
  if (typeof event === 'number') return event > 10_000 ? Math.round(event) : Math.round(event * 1_000);
  if (!event || typeof event !== 'object') return null;
  const value = event as { currentTimeMs?: unknown; currentTime?: unknown; positionMs?: unknown };
  const position = value.currentTimeMs ?? value.positionMs ?? value.currentTime;
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) return null;
  return position > 10_000 ? Math.round(position) : Math.round(position * 1_000);
}

function errorCodeFromEvent(event: unknown) {
  if (event instanceof Error) return event.message;
  if (!event || typeof event !== 'object') return 'PLAYER_RUNTIME_ERROR';
  const value = event as { code?: unknown; errorCode?: unknown; message?: unknown };
  const code = value.errorCode ?? value.code ?? value.message;
  return typeof code === 'string' || typeof code === 'number' ? String(code).slice(0, 128) : 'PLAYER_RUNTIME_ERROR';
}

const createPlaybackSessionId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `play-${Date.now()}`;

function tiktokClientVersion() {
  try {
    const minis = window.TTMinis as unknown as { getSystemInfoSync?: () => Record<string, unknown>; game?: { getSystemInfoSync?: () => Record<string, unknown> } } | undefined;
    const info = minis?.game?.getSystemInfoSync?.() ?? minis?.getSystemInfoSync?.() ?? {};
    const version = info.version ?? info.clientVersion ?? info.appVersion;
    return typeof version === 'string' ? version.slice(0, 64) : undefined;
  } catch { return undefined; }
}

export function PlayerShell({ message, coverUrl, title, playInfo, playlist = [], onEpisodeEnded, onRetry, onPlaybackActiveChange, adTransitionPending = false, rewardedAdPending = false, requestStartedAt, observePlayback = false, immersive = false, transitionTiming }: {
  message?: string;
  coverUrl?: string | null;
  title?: string;
  playInfo?: PlayInfo;
  playlist?: PlayInfo[];
  onEpisodeEnded?: () => void;
  onRetry?: () => void;
  onPlaybackActiveChange?: (active: boolean) => void;
  adTransitionPending?: boolean;
  rewardedAdPending?: boolean;
  requestStartedAt?: number;
  observePlayback?: boolean;
  immersive?: boolean;
  transitionTiming?: { kind: 'REWARDED' | 'EPISODE_INTERSTITIAL'; closedAt: number };
}) {
  const locale = useLocale();
  const mount = useRef<HTMLDivElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const controller = useRef<DramaPlayerController | undefined>(undefined);
  const playlistRef = useRef(playlist);
  const endedHandlerRef = useRef(onEpisodeEnded);
  const activeHandlerRef = useRef(onPlaybackActiveChange);
  const adInterruptionRef = useRef(adTransitionPending || rewardedAdPending);
  const transitionPendingRef = useRef(adTransitionPending);
  const resumeAfterInterruption = useRef(false);
  const resumePlaybackRef = useRef<() => void>(() => undefined);
  const episodeRef = useRef(playInfo?.localEpisodeId);
  const [playerError, setPlayerError] = useState('');
  const [playerStarting, setPlayerStarting] = useState(true);
  const [showPlayFallback, setShowPlayFallback] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const reportedTransition = useRef<string | null>(null);
  const isLocalPlayback = playInfo?.playbackMode === 'LOCAL' && Boolean(playInfo.sourceUrl);
  playlistRef.current = playlist;
  endedHandlerRef.current = onEpisodeEnded;
  activeHandlerRef.current = onPlaybackActiveChange;
  adInterruptionRef.current = adTransitionPending || rewardedAdPending;
  transitionPendingRef.current = adTransitionPending;
  if (episodeRef.current !== playInfo?.localEpisodeId) {
    episodeRef.current = playInfo?.localEpisodeId;
    resumeAfterInterruption.current = false;
  }

  useLayoutEffect(() => {
    if (adTransitionPending) resumeAfterInterruption.current = false;
    if (!adInterruptionRef.current) { resumePlaybackRef.current(); return; }
    const player = (isLocalPlayback ? localVideo.current : controller.current?.instance?.player) as { paused?: boolean; pause?: () => void } | null | undefined;
    if (rewardedAdPending && player?.paused === false) resumeAfterInterruption.current = true;
    try { player?.pause?.(); }
    catch { /* The player may already be disposed during a transition. */ }
  }, [adTransitionPending, rewardedAdPending, isLocalPlayback]);

  const playlistKey = playlist.map((item) => `${item.albumId}:${item.episodeId}:${item.vid}`).join('|');
  useEffect(() => {
    void controller.current?.updatePreload(playlistRef.current);
  }, [playlistKey]);

  useEffect(() => {
    if (!playInfo || (isLocalPlayback ? !localVideo.current : !mount.current)) return;
    const sessionId = createPlaybackSessionId();
    const startedAt = performance.now();
    let disposed = false;
    let instance: VePlayerInstance | undefined;
    let lastPositionMs = playInfo.resumePositionMs;
    let lastReportedMs = 0;
    let startedPlayback = false;
    let wasPlaying = false;
    let firstFrameRecorded = false;
    let preloadHit: boolean | undefined;
    const detailedPlayback = isV006Release();
    let playFallbackTimer = 0;
    let playReadyTimer = 0;
    let resumeTimer = 0;
    let resumeVerifyTimer = 0;
    let resumeInFlight = false;
    let seekStartedAt = 0;
    let seekedAt = 0;
    let seekTimeUpdates = 0;
    let seekCount = 0;
    let seekReports = 0;
    const reportPlaybackQuality = (eventType: 'START' | 'PLAYER_CONSTRUCTED' | 'PLAYER_READY' | 'FIRST_FRAME' | 'SEEK_RESUME' | 'ENDED' | 'ERROR', stage: string, details: Record<string, unknown> = {}) => {
      if (!observePlayback) return;
      if (!detailedPlayback && (eventType === 'START' || eventType === 'PLAYER_CONSTRUCTED' || eventType === 'PLAYER_READY')) return;
      void apiClient.post('/playback-quality-events', {
        episodeId: playInfo.localEpisodeId,
        sessionId,
        playerOperationId: sessionId,
        clientVersion: getMiniReleaseId(),
        platform: getAdPlatform(),
        tiktokClientVersion: tiktokClientVersion(),
        stage,
        ...(preloadHit === undefined ? {} : { preloadHit }),
        eventType,
        ...details
      }).catch(() => undefined);
    };
    reportPlaybackQuality('START', 'REQUESTED', { startupMs: Math.max(0, Math.round(performance.now() - (requestStartedAt ?? startedAt))) });
    const setActive = (active: boolean) => activeHandlerRef.current?.(active);
    const resumeFromSeek = () => {
      if (!seekStartedAt) return;
      const durationMs = Math.round(performance.now() - seekStartedAt);
      seekStartedAt = 0;
      seekedAt = 0;
      setActive(true);
      if (observePlayback) reportPerformance('PLAYER_SEEK_RESUME', `/episodes/${playInfo.localEpisodeId}`, durationMs);
      seekCount++;
      if (observePlayback && seekReports < 3 && (durationMs >= 2_000 || seekCount === 1 && Math.random() < 0.1)) {
        seekReports++;
        reportPlaybackQuality('SEEK_RESUME', 'SEEK_RESUME', { bufferMs: durationMs, currentTimeMs: lastPositionMs });
      }
    };
    const recordFirstFrame = () => {
      if (firstFrameRecorded) return;
      firstFrameRecorded = true;
      reportPlaybackQuality('FIRST_FRAME', 'FIRST_FRAME', { startupMs: Math.max(0, Math.round(performance.now() - (requestStartedAt ?? startedAt))) });
    };
    const markPlaybackStarted = () => {
      if (startedPlayback) return;
      startedPlayback = true;
      window.clearInterval(playReadyTimer);
      const key = transitionTiming ? `${playInfo.localEpisodeId}:${transitionTiming.kind}:${transitionTiming.closedAt}` : '';
      const now = performance.timeOrigin + performance.now();
      if (transitionTiming && transitionTiming.closedAt >= performance.timeOrigin && reportedTransition.current !== key) {
        reportedTransition.current = key;
        reportPerformance(`${transitionTiming.kind}_CLOSE_TO_NEXT_EPISODE_PLAY`, `/episodes/${playInfo.localEpisodeId}`, now - transitionTiming.closedAt);
      }
    };
    const autoplay = createPlayerAutoplay(
      () => detailedPlayback && (adInterruptionRef.current || nativeAdActive() || !isMiniPageVisible()) ? undefined : instance?.player,
      markPlaybackStarted,
      () => { if (!disposed) { setPlayerStarting(false); setShowPlayFallback(true); } }
    );
    const attemptPlay = () => {
      if (!disposed && (!detailedPlayback || !adInterruptionRef.current && !nativeAdActive() && isMiniPageVisible())) autoplay.attempt();
    };
    const currentPlayer = () => isLocalPlayback ? localVideo.current : instance?.player;
    const requestResume = () => {
      if (!detailedPlayback || disposed || episodeRef.current !== playInfo.localEpisodeId || !resumeAfterInterruption.current || adInterruptionRef.current || !isMiniPageVisible() || resumeTimer || resumeInFlight) return;
      resumeTimer = window.setTimeout(() => {
        resumeTimer = 0;
        if (disposed || episodeRef.current !== playInfo.localEpisodeId || !resumeAfterInterruption.current || adInterruptionRef.current || !isMiniPageVisible()) return;
        if (nativeAdActive()) return;
        const player = currentPlayer();
        if (!player?.play) return;
        if (player.paused === false) { resumeAfterInterruption.current = false; return; }
        resumeInFlight = true;
        try {
          void Promise.resolve(player.play()).then(() => {
            resumeInFlight = false;
            resumeVerifyTimer = window.setTimeout(() => {
              if (disposed || episodeRef.current !== playInfo.localEpisodeId || adInterruptionRef.current || !isMiniPageVisible()) return;
              resumeAfterInterruption.current = false;
              setShowPlayFallback(currentPlayer()?.paused === true);
            }, 500);
          }, () => {
            resumeInFlight = false;
            if (adInterruptionRef.current || nativeAdActive() || !isMiniPageVisible()) { resumeAfterInterruption.current = true; return; }
            resumeAfterInterruption.current = false;
            if (!disposed) setShowPlayFallback(true);
          });
        } catch {
          resumeInFlight = false;
          if (adInterruptionRef.current || nativeAdActive() || !isMiniPageVisible()) { resumeAfterInterruption.current = true; return; }
          resumeAfterInterruption.current = false;
          if (!disposed) setShowPlayFallback(true);
        }
      }, 300);
    };
    resumePlaybackRef.current = () => {
      if (episodeRef.current !== playInfo.localEpisodeId) return;
      if (!startedPlayback) attemptPlay();
      requestResume();
    };
    const reportProgress = (completed = false, force = false) => {
      if (!startedPlayback && !completed) return;
      if (!force && Math.abs(lastPositionMs - lastReportedMs) < 10_000) return;
      lastReportedMs = lastPositionMs;
      void apiClient.put('/me/watch-progress', {
        episodeId: playInfo.localEpisodeId,
        positionMs: lastPositionMs,
        durationMs: playInfo.durationMs,
        completed
      }).catch(() => undefined);
    };
    const onTimeUpdate = (event?: unknown) => {
      const positionMs = event instanceof Event && event.currentTarget instanceof HTMLMediaElement
        ? Math.round(event.currentTarget.currentTime * 1_000)
        : positionFromEvent(event);
      if (positionMs === null) return;
      if (positionMs > 0) {
        recordFirstFrame();
        if (observePlayback && seekedAt && ++seekTimeUpdates >= 2) resumeFromSeek();
        if (!seekStartedAt) setActive(true);
        autoplay.markStarted();
        window.clearTimeout(playFallbackTimer);
        setPlayerStarting(false);
        setShowPlayFallback(false);
      }
      lastPositionMs = playInfo.durationMs ? Math.min(positionMs, playInfo.durationMs) : positionMs;
      reportProgress();
    };
    const onPlay = () => {
      if (detailedPlayback && (adInterruptionRef.current || nativeAdActive() || !isMiniPageVisible())) {
        if (!transitionPendingRef.current) resumeAfterInterruption.current = true;
        try { (currentPlayer() as { pause?: () => void } | null | undefined)?.pause?.(); } catch { /* A disposed player cannot be paused. */ }
        return;
      }
      wasPlaying = true;
      resumeAfterInterruption.current = false;
      autoplay.markStarted();
    };
    const onPause = () => {
      if (detailedPlayback && wasPlaying && !transitionPendingRef.current && (adInterruptionRef.current || nativeAdActive() || !isMiniPageVisible())) resumeAfterInterruption.current = true;
      else if (isMiniPageVisible() && !adInterruptionRef.current && !nativeAdActive()) resumeAfterInterruption.current = false;
      wasPlaying = false;
      setActive(false);
      reportProgress(false, true);
    };
    const onWaiting = () => setActive(false);
    const onSeeking = () => { if (!observePlayback) return; seekStartedAt = performance.now(); seekedAt = 0; seekTimeUpdates = 0; setActive(false); };
    const onSeeked = () => {
      if (!seekStartedAt) return;
      seekedAt = performance.now();
      if (observePlayback) reportPerformance('PLAYER_SEEKED', `/episodes/${playInfo.localEpisodeId}`, seekedAt - seekStartedAt);
    };
    const onPlaying = () => {
      if (detailedPlayback && (adInterruptionRef.current || nativeAdActive() || !isMiniPageVisible())) {
        if (!transitionPendingRef.current) resumeAfterInterruption.current = true;
        try { (currentPlayer() as { pause?: () => void } | null | undefined)?.pause?.(); } catch { /* A disposed player cannot be paused. */ }
        return;
      }
      wasPlaying = true;
      setPlayerStarting(false);
      setShowPlayFallback(false);
      if (observePlayback && firstFrameRecorded) { resumeFromSeek(); setActive(true); }
    };
    const onLoadedData = () => { if (observePlayback) reportPerformance('PLAYER_LOADED_DATA', `/episodes/${playInfo.localEpisodeId}`, performance.now() - startedAt); };
    const onCanPlay = () => { if (observePlayback) reportPerformance('PLAYER_CANPLAY', `/episodes/${playInfo.localEpisodeId}`, performance.now() - startedAt); };
    const onReady = () => {
      reportPlaybackQuality('PLAYER_READY', 'READY', { startupMs: Math.max(0, Math.round(performance.now() - (requestStartedAt ?? startedAt))) });
      setPlayerStarting(false);
      attemptPlay();
      requestResume();
    };
    const onLoadStart = () => {
      reportPerformance('PLAYER_LOAD_START', `/episodes/${playInfo.localEpisodeId}`, performance.now() - startedAt);
    };
    const onEnded = () => {
      wasPlaying = false;
      resumeAfterInterruption.current = false;
      setActive(false);
      startedPlayback = true;
      lastPositionMs = playInfo.durationMs ?? lastPositionMs;
      reportProgress(true, true);
      reportPlaybackQuality('ENDED', 'ENDED', { currentTimeMs: lastPositionMs });
      endedHandlerRef.current?.();
    };
    const onError = (event?: unknown) => {
      if (disposed) return;
      wasPlaying = false;
      resumeAfterInterruption.current = false;
      setActive(false);
      const errorCode = errorCodeFromEvent(event);
      reportDiagnostic({ kind: 'PLAYBACK', phase: 'PLAYER_ERROR', message: errorCode, path: `/episodes/${playInfo.localEpisodeId}` });
      setPlayerError('Player playback failed.');
      reportPlaybackQuality('ERROR', 'PLAYBACK', { errorCode });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (detailedPlayback && !transitionPendingRef.current && (currentPlayer()?.paused === false || wasPlaying)) resumeAfterInterruption.current = true;
        reportProgress(false, true);
      } else resumePlaybackRef.current();
    };
    const detach = () => {
      const events = controller.current?.events;
      if (!instance || !events) return;
      instance.off?.(events.TIME_UPDATE, onTimeUpdate);
      instance.off?.(events.PLAY, onPlay);
      instance.off?.(events.PAUSE, onPause);
      instance.off?.(events.LOAD_START, onLoadStart);
      instance.off?.(events.ENDED, onEnded);
      instance.off?.(events.ERROR, onError);
      if (events.WAITING) instance.off?.(events.WAITING, onWaiting);
      if (events.STALLED) instance.off?.(events.STALLED, onWaiting);
      if (events.SEEKING) instance.off?.(events.SEEKING, onSeeking);
      if (events.SEEKED) instance.off?.(events.SEEKED, onSeeked);
      if (events.PLAYING) instance.off?.(events.PLAYING, onPlaying);
      if (events.LOADED_DATA) instance.off?.(events.LOADED_DATA, onLoadedData);
      if (events.CANPLAY) instance.off?.(events.CANPLAY, onCanPlay);
      if (events.READY) instance.off?.(events.READY, onReady);
    };

    const detachLocalVideo = (video: HTMLVideoElement) => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('loadeddata', onLoadStart);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('stalled', onWaiting);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
    };

    setPlayerError('');
    setPlayerStarting(true);
    setShowPlayFallback(false);
    if (isLocalPlayback) {
      controller.current?.destroy();
      controller.current = undefined;
      const video = localVideo.current!;
      const restorePosition = () => {
        if (!playInfo.resumePositionMs || !Number.isFinite(video.duration)) return;
        video.currentTime = Math.min(playInfo.resumePositionMs / 1_000, Math.max(video.duration - 0.1, 0));
      };
      video.addEventListener('timeupdate', onTimeUpdate);
      video.addEventListener('play', onPlay);
      video.addEventListener('pause', onPause);
      video.addEventListener('loadeddata', onLoadStart, { once: true });
      video.addEventListener('ended', onEnded);
      video.addEventListener('error', onError);
      video.addEventListener('waiting', onWaiting);
      video.addEventListener('stalled', onWaiting);
      video.addEventListener('seeking', onSeeking);
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('playing', onPlaying);
      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('loadedmetadata', restorePosition, { once: true });
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) restorePosition();
      reportPlaybackQuality('PLAYER_CONSTRUCTED', 'LOCAL_MEDIA');
    } else void (async () => {
      try {
        const playerController = controller.current ?? new DramaPlayerController(mount.current!);
        controller.current = playerController;
        instance = playerController.instance
          ? await playerController.switchTo(playInfo, playlistRef.current)
          : await playerController.start(playInfo, playlistRef.current);
        if (disposed) return;
        preloadHit = typeof instance.preLoadData?.hit === 'number' ? instance.preLoadData.hit > 0 : undefined;
        reportPlaybackQuality('PLAYER_CONSTRUCTED', 'SDK_INSTANCE', { preloadHit });
        if (observePlayback) reportPerformance('PLAYER_CONSTRUCTED', `/episodes/${playInfo.localEpisodeId}`, performance.now() - startedAt,
          { preloadHit: preloadHit ?? null });
        const events = playerController.events;
        if (!events) throw new Error('The official drama player events are unavailable.');
        instance.on(events.TIME_UPDATE, onTimeUpdate);
        instance.on(events.PLAY, onPlay);
        instance.on(events.PAUSE, onPause);
        instance.on(events.READY, onReady);
        instance.on(events.LOAD_START, onLoadStart);
        instance.on(events.ENDED, onEnded);
        instance.on(events.ERROR, onError);
        if (events.WAITING) instance.on(events.WAITING, onWaiting);
        if (events.STALLED) instance.on(events.STALLED, onWaiting);
        if (events.SEEKING) instance.on(events.SEEKING, onSeeking);
        if (events.SEEKED) instance.on(events.SEEKED, onSeeked);
        if (events.PLAYING) instance.on(events.PLAYING, onPlaying);
        if (events.LOADED_DATA) instance.on(events.LOADED_DATA, onLoadedData);
        if (events.CANPLAY) instance.on(events.CANPLAY, onCanPlay);
        setPlayerStarting(false);
        attemptPlay();
        // READY can fire before start/playNext resolves; keep checking for the async kernel.
        playReadyTimer = window.setInterval(attemptPlay, 100);
        playFallbackTimer = window.setTimeout(() => {
          window.clearInterval(playReadyTimer);
          if (!firstFrameRecorded && !disposed && !adInterruptionRef.current && !nativeAdActive() && currentPlayer()?.paused !== false) {
            setPlayerStarting(false);
            setShowPlayFallback(true);
          }
        }, 4_000);
      } catch (error) {
        if (disposed) return;
        reportDiagnostic({ kind: 'PLAYBACK', phase: 'PLAYER_INIT_FAILED', message: error instanceof Error ? error.message : String(error), path: `/episodes/${playInfo.localEpisodeId}` });
        setPlayerError(error instanceof Error ? error.message : 'Player initialization failed.');
        reportPlaybackQuality('ERROR', 'PLAYER_INIT', { errorCode: 'PLAYER_INIT_FAILED' });
      }
    })();
    document.addEventListener('visibilitychange', onVisibilityChange);
    const unsubscribeForeground = detailedPlayback ? subscribeMiniForeground(() => resumePlaybackRef.current()) : undefined;
    const unsubscribeAdIdle = detailedPlayback ? subscribeNativeAdIdle(() => resumePlaybackRef.current()) : undefined;
    return () => {
      disposed = true;
      resumeAfterInterruption.current = false;
      resumePlaybackRef.current = () => undefined;
      setActive(false);
      reportProgress(false, true);
      if (isLocalPlayback && localVideo.current) detachLocalVideo(localVideo.current);
      else detach();
      controller.current?.cancelPending();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribeForeground?.();
      unsubscribeAdIdle?.();
      window.clearTimeout(resumeTimer);
      window.clearTimeout(resumeVerifyTimer);
      window.clearTimeout(playFallbackTimer);
      window.clearInterval(playReadyTimer);
      autoplay.dispose();
    };
  }, [playInfo?.localEpisodeId, isLocalPlayback, playbackAttempt]);

  useEffect(() => () => controller.current?.destroy(), []);

  const visibleMessage = playerError || message;
  const retryPlayback = () => {
    controller.current?.destroy();
    controller.current = undefined;
    setPlayerError('');
    setPlaybackAttempt((attempt) => attempt + 1);
    onRetry?.();
  };
  const playManually = () => {
    const play = controller.current?.instance?.player?.play;
    if (!play) return;
    try { void Promise.resolve(play.call(controller.current?.instance?.player)).catch(() => setPlayerError('Playback could not start. Please try again.')); }
    catch { setPlayerError('Playback could not start. Please try again.'); }
  };
  return <section className={`${styles.shell} ${immersive ? styles.immersive : ''}`} aria-label={t(locale, 'watchEpisode')}>
    {coverUrl && <img src={coverUrl} alt="" className={styles.poster} onError={(event) => { event.currentTarget.src = '/fallback-cover.svg'; }} />}
    <div className={styles.scrim} />
    {playInfo && !visibleMessage && (isLocalPlayback
      ? <video ref={localVideo} className={styles.localVideo} src={playInfo.sourceUrl ?? undefined} poster={coverUrl ?? undefined} controls playsInline autoPlay preload="auto" />
      : <div className={styles.playerMount} ref={mount} />)}
    {playInfo && !isLocalPlayback && !visibleMessage && (playerStarting || showPlayFallback) && <div className={styles.playerLoading} role="status">{playerStarting && <><span className={styles.spinner} aria-hidden="true" /><span className={styles.playerLoadingLabel}>{t(locale, 'preparingPlayer')}</span></>}{showPlayFallback && <button type="button" onClick={playManually}><Play size={16} fill="currentColor" aria-hidden="true" /> Play episode</button>}</div>}
    {visibleMessage ? <div className={styles.message}><AlertCircle size={20} aria-hidden="true" /><strong>{title}</strong><span>{visibleMessage}</span>{(playerError || onRetry) && <button className={styles.retryButton} onClick={retryPlayback}>{t(locale, 'retry')}</button>}</div> : !playInfo ? <div className={styles.message}><Play size={24} aria-hidden="true" /><strong>{title}</strong><span>{t(locale, 'preparingPlayer')}</span></div> : null}
  </section>;
}
