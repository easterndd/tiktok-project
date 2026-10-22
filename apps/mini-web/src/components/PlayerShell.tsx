import type { PlayInfo } from '@quickreels/shared-types';
import { AlertCircle, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DramaPlayerController } from '../features/player/drama-player-controller';
import { createPlayerAutoplay } from '../features/player/player-autoplay';
import { apiClient } from '../lib/api-client';
import { reportDiagnostic, reportPerformance } from '../lib/diagnostics';
import { t } from '../lib/i18n';
import { useLocale } from '../lib/storage';
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

export function PlayerShell({ message, coverUrl, title, playInfo, playlist = [], onEpisodeEnded, onRetry, immersive = false, transitionTiming }: {
  message?: string;
  coverUrl?: string | null;
  title?: string;
  playInfo?: PlayInfo;
  playlist?: PlayInfo[];
  onEpisodeEnded?: () => void;
  onRetry?: () => void;
  immersive?: boolean;
  transitionTiming?: { kind: 'REWARDED' | 'EPISODE_INTERSTITIAL'; closedAt: number };
}) {
  const locale = useLocale();
  const mount = useRef<HTMLDivElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const controller = useRef<DramaPlayerController | undefined>(undefined);
  const playlistRef = useRef(playlist);
  const endedHandlerRef = useRef(onEpisodeEnded);
  const [playerError, setPlayerError] = useState('');
  const [playerStarting, setPlayerStarting] = useState(true);
  const [showPlayFallback, setShowPlayFallback] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const reportedTransition = useRef<string | null>(null);
  const isLocalPlayback = playInfo?.playbackMode === 'LOCAL' && Boolean(playInfo.sourceUrl);
  playlistRef.current = playlist;
  endedHandlerRef.current = onEpisodeEnded;

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
    let firstFrameRecorded = false;
    let playFallbackTimer = 0;
    let playReadyTimer = 0;
    const recordFirstFrame = () => {
      if (firstFrameRecorded) return;
      firstFrameRecorded = true;
      void apiClient.post('/playback-quality-events', {
        episodeId: playInfo.localEpisodeId,
        sessionId,
        eventType: 'FIRST_FRAME',
        startupMs: Math.round(performance.now() - startedAt)
      }).catch(() => undefined);
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
      () => instance?.player,
      markPlaybackStarted,
      () => { if (!disposed) setShowPlayFallback(true); }
    );
    const attemptPlay = () => {
      if (!disposed) autoplay.attempt();
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
        autoplay.markStarted();
        window.clearTimeout(playFallbackTimer);
        setPlayerStarting(false);
        setShowPlayFallback(false);
      }
      lastPositionMs = playInfo.durationMs ? Math.min(positionMs, playInfo.durationMs) : positionMs;
      reportProgress();
    };
    const onPlay = () => autoplay.markStarted();
    const onPause = () => reportProgress(false, true);
    const onLoadStart = () => {
      reportPerformance('PLAYER_LOAD_START', `/episodes/${playInfo.localEpisodeId}`, performance.now() - startedAt);
    };
    const onEnded = () => {
      startedPlayback = true;
      lastPositionMs = playInfo.durationMs ?? lastPositionMs;
      reportProgress(true, true);
      void apiClient.post('/playback-quality-events', {
        episodeId: playInfo.localEpisodeId,
        sessionId,
        eventType: 'ENDED',
        currentTimeMs: lastPositionMs
      }).catch(() => undefined);
      endedHandlerRef.current?.();
    };
    const onError = (event?: unknown) => {
      if (disposed) return;
      const errorCode = errorCodeFromEvent(event);
      reportDiagnostic({ kind: 'PLAYBACK', phase: 'PLAYER_ERROR', message: errorCode, path: `/episodes/${playInfo.localEpisodeId}` });
      setPlayerError('Player playback failed.');
      void apiClient.post('/playback-quality-events', {
        episodeId: playInfo.localEpisodeId,
        sessionId,
        eventType: 'ERROR',
        errorCode
      }).catch(() => undefined);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') reportProgress(false, true);
    };
    const detach = () => {
      const events = controller.current?.events;
      if (!instance || !events) return;
      instance.off?.(events.TIME_UPDATE, onTimeUpdate);
      instance.off?.(events.PLAY, onPlay);
      instance.off?.(events.PAUSE, onPause);
      instance.off?.(events.READY, attemptPlay);
      instance.off?.(events.LOAD_START, onLoadStart);
      instance.off?.(events.ENDED, onEnded);
      instance.off?.(events.ERROR, onError);
    };

    const detachLocalVideo = (video: HTMLVideoElement) => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('loadeddata', onLoadStart);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
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
      video.addEventListener('loadedmetadata', restorePosition, { once: true });
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) restorePosition();
    } else void (async () => {
      try {
        const playerController = controller.current ?? new DramaPlayerController(mount.current!);
        controller.current = playerController;
        instance = playerController.instance
          ? await playerController.switchTo(playInfo, playlistRef.current)
          : await playerController.start(playInfo, playlistRef.current);
        if (disposed) return;
        const events = playerController.events;
        if (!events) throw new Error('The official drama player events are unavailable.');
        instance.on(events.TIME_UPDATE, onTimeUpdate);
        instance.on(events.PLAY, onPlay);
        instance.on(events.PAUSE, onPause);
        instance.on(events.READY, attemptPlay);
        instance.on(events.LOAD_START, onLoadStart);
        instance.on(events.ENDED, onEnded);
        instance.on(events.ERROR, onError);
        attemptPlay();
        // READY can fire before start/playNext resolves; keep checking for the async kernel.
        playReadyTimer = window.setInterval(attemptPlay, 100);
        playFallbackTimer = window.setTimeout(() => {
          window.clearInterval(playReadyTimer);
          if (!firstFrameRecorded && !disposed) setShowPlayFallback(true);
        }, 4_000);
      } catch (error) {
        if (disposed) return;
        reportDiagnostic({ kind: 'PLAYBACK', phase: 'PLAYER_INIT_FAILED', message: error instanceof Error ? error.message : String(error), path: `/episodes/${playInfo.localEpisodeId}` });
        setPlayerError(error instanceof Error ? error.message : 'Player initialization failed.');
        void apiClient.post('/playback-quality-events', {
          episodeId: playInfo.localEpisodeId,
          sessionId,
          eventType: 'ERROR',
          errorCode: 'PLAYER_INIT_FAILED'
        }).catch(() => undefined);
      }
    })();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      reportProgress(false, true);
      if (isLocalPlayback && localVideo.current) detachLocalVideo(localVideo.current);
      else detach();
      controller.current?.cancelPending();
      document.removeEventListener('visibilitychange', onVisibilityChange);
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
    {playInfo && !isLocalPlayback && !visibleMessage && playerStarting && <div className={styles.playerLoading} role="status"><span className={styles.spinner} aria-hidden="true" /><span className={styles.playerLoadingLabel}>{t(locale, 'preparingPlayer')}</span>{showPlayFallback && <button type="button" onClick={playManually}><Play size={16} fill="currentColor" aria-hidden="true" /> Play episode</button>}</div>}
    {visibleMessage ? <div className={styles.message}><AlertCircle size={20} aria-hidden="true" /><strong>{title}</strong><span>{visibleMessage}</span>{(playerError || onRetry) && <button className={styles.retryButton} onClick={retryPlayback}>{t(locale, 'retry')}</button>}</div> : !playInfo ? <div className={styles.message}><Play size={24} aria-hidden="true" /><strong>{title}</strong><span>{t(locale, 'preparingPlayer')}</span></div> : null}
  </section>;
}
