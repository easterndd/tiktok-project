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

export function PlayerShell({ message, coverUrl, title, playInfo, playlist = [], onEpisodeEnded, onRetry, onPlaybackActiveChange, requestStartedAt, observePlayback = false, immersive = false, transitionTiming }: {
  message?: string;
  coverUrl?: string | null;
  title?: string;
  playInfo?: PlayInfo;
  playlist?: PlayInfo[];
  onEpisodeEnded?: () => void;
  onRetry?: () => void;
  onPlaybackActiveChange?: (active: boolean) => void;
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
  const [playerError, setPlayerError] = useState('');
  const [playerStarting, setPlayerStarting] = useState(true);
  const [showPlayFallback, setShowPlayFallback] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const reportedTransition = useRef<string | null>(null);
  const isLocalPlayback = playInfo?.playbackMode === 'LOCAL' && Boolean(playInfo.sourceUrl);
  playlistRef.current = playlist;
  endedHandlerRef.current = onEpisodeEnded;
  activeHandlerRef.current = onPlaybackActiveChange;

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
    let seekStartedAt = 0;
    let seekedAt = 0;
    let seekTimeUpdates = 0;
    let seekCount = 0;
    let seekReports = 0;
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
        void apiClient.post('/playback-quality-events', { episodeId: playInfo.localEpisodeId, sessionId,
          eventType: 'SEEK_RESUME', bufferMs: durationMs, currentTimeMs: lastPositionMs,
          clientVersion: import.meta.env.VITE_MINI_RELEASE_ID || 'default' }).catch(() => undefined);
      }
    };
    const recordFirstFrame = () => {
      if (firstFrameRecorded) return;
      firstFrameRecorded = true;
      void apiClient.post('/playback-quality-events', {
        episodeId: playInfo.localEpisodeId,
        sessionId,
        eventType: 'FIRST_FRAME',
          startupMs: Math.round(performance.now() - (requestStartedAt ?? startedAt)),
          ...(observePlayback ? { clientVersion: import.meta.env.VITE_MINI_RELEASE_ID || 'default' } : {})
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
    const onPlay = () => autoplay.markStarted();
    const onPause = () => { setActive(false); reportProgress(false, true); };
    const onWaiting = () => setActive(false);
    const onSeeking = () => { if (!observePlayback) return; seekStartedAt = performance.now(); seekedAt = 0; seekTimeUpdates = 0; setActive(false); };
    const onSeeked = () => {
      if (!seekStartedAt) return;
      seekedAt = performance.now();
      if (observePlayback) reportPerformance('PLAYER_SEEKED', `/episodes/${playInfo.localEpisodeId}`, seekedAt - seekStartedAt);
    };
    const onPlaying = () => { if (observePlayback && firstFrameRecorded) { resumeFromSeek(); setActive(true); } };
    const onLoadedData = () => { if (observePlayback) reportPerformance('PLAYER_LOADED_DATA', `/episodes/${playInfo.localEpisodeId}`, performance.now() - startedAt); };
    const onCanPlay = () => { if (observePlayback) reportPerformance('PLAYER_CANPLAY', `/episodes/${playInfo.localEpisodeId}`, performance.now() - startedAt); };
    const onLoadStart = () => {
      reportPerformance('PLAYER_LOAD_START', `/episodes/${playInfo.localEpisodeId}`, performance.now() - startedAt);
    };
    const onEnded = () => {
      setActive(false);
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
      setActive(false);
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
      if (events.WAITING) instance.off?.(events.WAITING, onWaiting);
      if (events.STALLED) instance.off?.(events.STALLED, onWaiting);
      if (events.SEEKING) instance.off?.(events.SEEKING, onSeeking);
      if (events.SEEKED) instance.off?.(events.SEEKED, onSeeked);
      if (events.PLAYING) instance.off?.(events.PLAYING, onPlaying);
      if (events.LOADED_DATA) instance.off?.(events.LOADED_DATA, onLoadedData);
      if (events.CANPLAY) instance.off?.(events.CANPLAY, onCanPlay);
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
    } else void (async () => {
      try {
        const playerController = controller.current ?? new DramaPlayerController(mount.current!);
        controller.current = playerController;
        instance = playerController.instance
          ? await playerController.switchTo(playInfo, playlistRef.current)
          : await playerController.start(playInfo, playlistRef.current);
        if (disposed) return;
        if (observePlayback) reportPerformance('PLAYER_CONSTRUCTED', `/episodes/${playInfo.localEpisodeId}`, performance.now() - startedAt,
          { preloadHit: instance.preLoadData?.hit ?? null });
        const events = playerController.events;
        if (!events) throw new Error('The official drama player events are unavailable.');
        instance.on(events.TIME_UPDATE, onTimeUpdate);
        instance.on(events.PLAY, onPlay);
        instance.on(events.PAUSE, onPause);
        instance.on(events.READY, attemptPlay);
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
      setActive(false);
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
