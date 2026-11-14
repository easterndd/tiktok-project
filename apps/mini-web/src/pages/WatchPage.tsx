import type { AlbumDetail, EpisodeSummary, PlayInfo } from '@quickreels/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom';
import { EpisodeList } from '../components/EpisodeList';
import { PlayerShell } from '../components/PlayerShell';
import { LoadingState } from '../components/LoadingState';
import { useEntryAdReady } from '../components/EntryAdGate';
import { prepareRewardedUnlockSession, unlockEpisodeByRewardedAd } from '../features/ads/rewarded-ad';
import { startEpisodeInterstitialPolicy } from '../features/ads/app-entry-ad';
import { getAdPlatform, getMiniReleaseId, isV006Release } from '../features/ads/ad-platform';
import { configureEpisodeInterstitial, prepareEpisodeInterstitial, showEpisodeTransitionInterstitial, startEpisodeInterstitialSchedule } from '../features/ads/episode-interstitial';
import { ApiError, apiClient } from '../lib/api-client';
import { reportDiagnostic, reportPerformance } from '../lib/diagnostics';
import { appKey } from '../lib/app-brand';
import { episodeDisplayTitle } from '../lib/episode-title';
import { t } from '../lib/i18n';
import { getSessionToken, subscribeToSession, useLocale } from '../lib/storage';
import { hasTikTokMinis } from '../lib/ttminis';
import styles from './WatchPage.module.css';
import { activateDebugPanel, debugPanelAvailable } from '../lib/debug-panel';

export function WatchPage() {
  const { albumId = '', episodeId } = useParams();
  const releaseId = getMiniReleaseId();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const locale = useLocale();
  const sessionToken = useSyncExternalStore(subscribeToSession, getSessionToken, () => null);
  const entryAdReady = useEntryAdReady();
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [retentionError, setRetentionError] = useState('');
  const [playbackActive, setPlaybackActive] = useState(false);
  const [transitionAdPending, setTransitionAdPending] = useState(false);
  const retentionSeen = useRef(false);
  const debugTaps = useRef({ count: 0, lastAt: 0 });
  const playRequest = useRef({ episodeId, startedAt: performance.now() });
  if (playRequest.current.episodeId !== episodeId) playRequest.current = { episodeId, startedAt: performance.now() };
  const v005App = ['bloomreel', 'quillshort', 'amberplay', 'nimbusclip', 'runereel'].includes(appKey);
  const observePlayback = v005App || isV006Release(releaseId);
  const allowExit = useRef(false);
  const locationState = location.state && typeof location.state === 'object' ? location.state as { transitionTiming?: { kind?: unknown; closedAt?: unknown } } : null;
  const transitionTiming = locationState?.transitionTiming
    && (locationState.transitionTiming.kind === 'REWARDED' || locationState.transitionTiming.kind === 'EPISODE_INTERSTITIAL')
    && typeof locationState.transitionTiming.closedAt === 'number'
    ? { kind: locationState.transitionTiming.kind, closedAt: locationState.transitionTiming.closedAt } as { kind: 'REWARDED' | 'EPISODE_INTERSTITIAL'; closedAt: number }
    : undefined;
  const [episodePickerOpen, setEpisodePickerOpen] = useState(false);
  const [unlockTarget, setUnlockTarget] = useState<EpisodeSummary | null>(null);
  const touchStart = useRef<{ x: number; y: number; axis: 'pending' | 'vertical' | 'horizontal' } | null>(null);
  const transitionPending = useRef(false);
  const lastNaturalTransitionFrom = useRef<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    lastNaturalTransitionFrom.current = null;
    transitionPending.current = false;
  }, [episodeId]);
  const interstitialConfig = useQuery({
    queryKey: ['episode-interstitial-config', releaseId],
    queryFn: () => startEpisodeInterstitialPolicy(releaseId),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: Boolean(sessionToken)
  });
  const interstitialPlacementId = interstitialConfig.data?.enabled ? interstitialConfig.data.placementId : null;
  useEffect(() => {
    if (interstitialConfig.data) configureEpisodeInterstitial(interstitialConfig.data, v005App);
  }, [interstitialConfig.data, v005App]);
  useEffect(() => { prepareEpisodeInterstitial(interstitialPlacementId); }, [interstitialPlacementId]);
  useEffect(() => {
    if (isV006Release(releaseId) || !entryAdReady || (v005App && !playbackActive) || !interstitialPlacementId || !interstitialConfig.data?.enabled) return;
    return startEpisodeInterstitialSchedule(interstitialPlacementId, () => mounted.current && document.visibilityState !== 'hidden');
  }, [entryAdReady, playbackActive, v005App, releaseId, interstitialConfig.data?.enabled, interstitialPlacementId]);
  useEffect(() => {
    if (interstitialConfig.isSuccess && !interstitialConfig.data.enabled) {
      reportDiagnostic({ kind: 'AD', phase: 'EPISODE_INTERSTITIAL_DISABLED', message: 'No episode interstitial placement configured', path: '/episode-interstitial/config' });
    }
  }, [interstitialConfig.data, interstitialConfig.isSuccess]);
  const album = useQuery({ queryKey: ['album', albumId, locale], queryFn: () => apiClient.get<AlbumDetail>(`/albums/${albumId}?locale=${encodeURIComponent(locale)}`) });
  const episodes = useQuery({ queryKey: ['episodes', albumId, locale], queryFn: () => apiClient.get<{ items: EpisodeSummary[] }>(`/albums/${albumId}/episodes?locale=${encodeURIComponent(locale)}`) });
  const playInfo = useQuery({ queryKey: ['play', episodeId, locale], queryFn: async () => {
    const startedAt = performance.now();
    const result = await apiClient.get<PlayInfo>(`/episodes/${episodeId}/play?locale=${encodeURIComponent(locale)}`);
    reportPerformance('PLAY_API', `/episodes/${episodeId}/play`, performance.now() - startedAt);
    return result;
  }, enabled: Boolean(episodeId) });
  const episodeItems = episodes.data?.items ?? [];
  const currentIndex = episodeItems.findIndex((episode) => episode.id === episodeId);
  const nextEpisode = currentIndex >= 0 ? episodeItems[currentIndex + 1] : undefined;
  const retentionConfig = useQuery({
    queryKey: ['exit-retention-config', releaseId],
    queryFn: () => apiClient.get<{ enabled: boolean; placementId?: string; placementIds?: string[]; adLoadMode?: 'DIRECT_SHOW' | 'EXPLICIT_LOAD'; strategyVariant?: string; requiredCount?: number }>(`/exit-retention/config?releaseId=${encodeURIComponent(releaseId)}&platform=${encodeURIComponent(getAdPlatform())}`),
    enabled: Boolean(sessionToken && entryAdReady), staleTime: 60_000, retry: false
  });
  const retentionEnabled = v005App || retentionConfig.data?.enabled;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => Boolean(retentionEnabled && (!v005App || !retentionSeen.current) && !allowExit.current && currentLocation.pathname.startsWith('/watch/') && !nextLocation.pathname.startsWith('/watch/')));
  const canOfferRetentionUnlock = Boolean(retentionEnabled && nextEpisode?.access === 'REWARDED_AD_REQUIRED');
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (v005App) retentionSeen.current = true;
      setRetentionOpen(true);
    }
  }, [blocker]);
  useEffect(() => {
    if (canOfferRetentionUnlock && nextEpisode && !v005App) {
      void prepareRewardedUnlockSession(nextEpisode.id, { purpose: 'EXIT_RETENTION', releaseId }).catch(() => undefined);
    }
  }, [canOfferRetentionUnlock, nextEpisode?.id, v005App]);
  useEffect(() => {
    if (nextEpisode?.access === 'REWARDED_AD_REQUIRED') {
      void prepareRewardedUnlockSession(nextEpisode.id).catch(() => undefined);
    }
  }, [nextEpisode?.access, nextEpisode?.id]);
  const nextPlayableId = nextEpisode?.access === 'PLAYABLE' ? nextEpisode.id : undefined;
  const nextPlayInfo = useQuery({
    queryKey: ['play', nextPlayableId, locale],
    queryFn: () => apiClient.get<PlayInfo>(`/episodes/${nextPlayableId}/play?locale=${encodeURIComponent(locale)}`),
    enabled: Boolean(nextPlayableId), staleTime: 30_000
  });
  const playerPlaylist = [playInfo.data, nextPlayInfo.data].filter((item): item is PlayInfo => Boolean(item));
  const unlock = useMutation({
    mutationFn: async (episode: EpisodeSummary) => {
      const closedAt = await unlockEpisodeByRewardedAd(episode.id);
      return { episode, closedAt };
    },
    onSuccess: ({ episode, closedAt }) => {
      setUnlockTarget(null);
      setEpisodePickerOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['episodes', albumId] });
      navigate(`/watch/${albumId}/${episode.id}`, { replace: true, state: closedAt === undefined ? null : { transitionTiming: { kind: 'REWARDED', closedAt } } });
    }
  });
  const retentionUnlock = useMutation({
    mutationFn: async (episode: EpisodeSummary) => {
      const closedAt = await unlockEpisodeByRewardedAd(episode.id, v005App ? undefined : { purpose: 'EXIT_RETENTION', releaseId });
      return { episode, closedAt };
    },
    onSuccess: ({ episode, closedAt }) => {
      setRetentionOpen(false);
      setRetentionError('');
      if (blocker.state === 'blocked') blocker.reset();
      void queryClient.invalidateQueries({ queryKey: ['episodes', albumId] });
      navigate(`/watch/${albumId}/${episode.id}`, { replace: true, state: closedAt === undefined ? null : { transitionTiming: { kind: 'REWARDED', closedAt } } });
    },
    onError: (error) => setRetentionError(error instanceof Error && error.message === 'AD_REWARD_NOT_EARNED' ? 'The ad was closed early. Watch it to the end to unlock the next episode.' : 'The ad could not be completed. Please try again or leave.')
  });
  const defaultEpisode = episodeItems.find((episode) => episode.access === 'PLAYABLE') ?? episodeItems[0];

  useEffect(() => {
    if (episodeId || !defaultEpisode) return;
    navigate(`/watch/${albumId}/${defaultEpisode.id}`, { replace: true });
  }, [albumId, defaultEpisode, episodeId, navigate]);

  if (!entryAdReady) return <section className={styles.resolving}><LoadingState label="Preparing your next story" /></section>;
  if ((album.isError || episodes.isError) && (!(v005App || isV006Release(releaseId)) || !playInfo.data)) return <section className={styles.resolving}><div className="state"><p>{t(locale, 'unavailable')}</p><button className={styles.retryButton} onClick={() => { void Promise.all([album.refetch(), episodes.refetch()]); }}>{t(locale, 'retry')}</button><Link to="/">{t(locale, 'back')}</Link></div></section>;
  if ((album.isLoading || episodes.isLoading) && (!(v005App || isV006Release(releaseId)) || !playInfo.data)) return <section className={styles.resolving}><LoadingState label={t(locale, 'preparingEpisode')} /></section>;
  if ((!album.data || !defaultEpisode) && (!(v005App || isV006Release(releaseId)) || !playInfo.data)) return <section className={styles.resolving}><div className="state"><p>{t(locale, 'unavailable')}</p><Link to="/">{t(locale, 'back')}</Link></div></section>;
  if (!episodeId || playInfo.isLoading) return <section className={styles.resolving}><LoadingState label={t(locale, 'preparingEpisode')} /></section>;

  const detail = album.data;
  const currentEpisode = episodeItems.find((episode) => episode.id === episodeId);
  const localPlayback = playInfo.data?.playbackMode === 'LOCAL' && Boolean(playInfo.data.sourceUrl);
  const byteplusPlayback = playInfo.data?.playbackMode === 'BYTEPLUS';
  const platformReady = hasTikTokMinis() && Boolean(window.TTMinis?.getPlayer);
  const message = playInfo.isError ? (!v005App || playInfo.error instanceof ApiError && playInfo.error.status === 403 ? t(locale, 'episodeLocked') : t(locale, 'unavailable')) : byteplusPlayback && !platformReady ? t(locale, 'platformCopy') : undefined;
  const leavePage = () => {
    setRetentionOpen(false);
    setRetentionError('');
    allowExit.current = true;
    if (blocker.state === 'blocked') blocker.proceed();
    else if (v005App || window.history.length <= 1) navigate('/');
    else navigate(-1);
  };
  const goBack = () => {
    if (retentionEnabled && (!v005App || !retentionSeen.current)) { if (v005App) retentionSeen.current = true; setRetentionError(''); setRetentionOpen(true); }
    else leavePage();
  };
  const previousEpisode = currentIndex > 0 ? episodeItems[currentIndex - 1] : undefined;
  const requestEpisode = (episode: EpisodeSummary | undefined, naturalTransition = false) => {
    if (!episode || episode.id === episodeId || unlock.isPending || transitionPending.current) return;
    if (naturalTransition && lastNaturalTransitionFrom.current === episodeId) return;
    if (episode.access === 'PLAYABLE') {
      if (naturalTransition) lastNaturalTransitionFrom.current = episodeId ?? null;
      setEpisodePickerOpen(false);
      if (naturalTransition && interstitialPlacementId) {
        transitionPending.current = true;
        if (isV006Release(releaseId)) setTransitionAdPending(true);
        void new Promise<void>((resolve) => {
          if (!isV006Release(releaseId) || document.visibilityState === 'hidden') { resolve(); return; }
          const fallback = window.setTimeout(resolve, 100);
          requestAnimationFrame(() => { window.clearTimeout(fallback); resolve(); });
        }).then(() => showEpisodeTransitionInterstitial(interstitialPlacementId)).catch(() => undefined).then((closedAt) => {
          if (mounted.current) navigate(`/watch/${albumId}/${episode.id}`, { replace: true, state: closedAt === undefined ? null : { transitionTiming: { kind: 'EPISODE_INTERSTITIAL', closedAt } } });
        }).finally(() => {
          transitionPending.current = false;
          if (mounted.current) setTransitionAdPending(false);
        });
      } else navigate(`/watch/${albumId}/${episode.id}`, { replace: true });
      return;
    }
    setUnlockTarget(episode);
    unlock.mutate(episode);
  };
  const handleTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    if (retentionOpen || episodePickerOpen || unlock.isPending || event.touches.length !== 1) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, [role="button"]')) return;
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, axis: 'pending' };
  };
  const handleTouchMove = (event: React.TouchEvent<HTMLElement>) => {
    const start = touchStart.current;
    if (!start || retentionOpen || episodePickerOpen || unlock.isPending || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (start.axis === 'pending' && Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 8) {
      start.axis = Math.abs(deltaY) > Math.abs(deltaX) * 1.2 ? 'vertical' : 'horizontal';
    }
    if (start.axis === 'vertical') {
      // 垂直手势由本页切集处理，拦截播放器 SDK 对同一手势的切剧响应。
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
    }
  };
  const handleTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || retentionOpen || episodePickerOpen || unlock.isPending) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const verticalDistance = Math.abs(deltaY);
    const verticalSwipe = verticalDistance > Math.abs(deltaX) * 1.2;
    if (verticalSwipe) {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
    }
    if (verticalDistance < 72 || verticalDistance < Math.abs(deltaX) * 1.2) return;
    requestEpisode(deltaY < 0 ? nextEpisode : previousEpisode, true);
  };

  return <section className={styles.page} onTouchStartCapture={handleTouchStart} onTouchMoveCapture={handleTouchMove} onTouchEndCapture={handleTouchEnd} onTouchCancelCapture={() => { touchStart.current = null; }}>
    <PlayerShell
      message={message}
      onRetry={playInfo.isError ? () => { void playInfo.refetch(); } : undefined}
      playInfo={playInfo.data}
      requestStartedAt={observePlayback ? playRequest.current.startedAt : undefined}
      onPlaybackActiveChange={observePlayback ? setPlaybackActive : undefined}
      adTransitionPending={transitionAdPending}
      rewardedAdPending={isV006Release(releaseId) && (unlock.isPending || retentionUnlock.isPending)}
      observePlayback={observePlayback}
      playlist={playerPlaylist}
      onEpisodeEnded={() => requestEpisode(nextEpisode, true)}
      transitionTiming={transitionTiming}
      coverUrl={playInfo.data?.coverUrl ?? detail?.backdropUrl ?? detail?.coverUrl}
      title={v005App && currentEpisode ? episodeDisplayTitle(currentEpisode.title, currentEpisode.episodeNo) : v005App && playInfo.data ? episodeDisplayTitle(playInfo.data.title, playInfo.data.episodeNo ?? 1) : playInfo.data?.title ?? currentEpisode?.title ?? detail?.title}
      immersive
    />
    <header className={styles.watchHeader}>
      <button className={styles.backButton} onClick={goBack} aria-label={t(locale, 'back')}><ArrowLeft size={20} aria-hidden="true" /></button>
      <button type="button" className={styles.episodeLabel} onClick={() => {
        if (!debugPanelAvailable()) return;
        const now = Date.now();
        debugTaps.current = { count: now - debugTaps.current.lastAt <= 500 ? debugTaps.current.count + 1 : 1, lastAt: now };
        if (debugTaps.current.count >= 5) { debugTaps.current = { count: 0, lastAt: 0 }; activateDebugPanel(); navigate('/debug'); }
      }}><strong>{detail?.title ?? 'Now playing'}</strong><span>{currentEpisode ? `${v005App ? 'Episode' : t(locale, 'episode')} ${currentEpisode.episodeNo}` : ''}</span></button>
      <button className={styles.episodeSelect} onClick={() => setEpisodePickerOpen(true)} aria-label={t(locale, 'episodes')}><ChevronDown size={19} aria-hidden="true" /></button>
    </header>
    <div className={styles.playerMeta}>
      <button className={styles.episodeTrigger} onClick={() => setEpisodePickerOpen(true)}><span>{currentEpisode ? `${v005App ? 'Episode' : t(locale, 'episode')} ${currentEpisode.episodeNo}` : t(locale, 'episodes')}</span><strong>{currentEpisode ? v005App ? episodeDisplayTitle(currentEpisode.title, currentEpisode.episodeNo) : currentEpisode.title : detail?.title ?? playInfo.data?.title}</strong><ChevronDown size={16} aria-hidden="true" /></button>
      {playInfo.isFetching && <div className={styles.sync}><RefreshCw size={14} aria-hidden="true" /> {t(locale, 'updatingPlayback')}</div>}
    </div>
    {episodePickerOpen && <div className={styles.sheetLayer} role="presentation">
      <button className={styles.sheetBackdrop} onClick={() => setEpisodePickerOpen(false)} aria-label="Close episode picker" />
      <section className={styles.episodeSheet} role="dialog" aria-modal="true" aria-label={t(locale, 'episodes')}>
        <div className={styles.sheetHandle} />
        <header className={styles.sheetHeader}><div><span className="eyebrow">{detail?.title ?? 'Episodes'}</span><h2>{t(locale, 'episodes')}</h2><p>{episodeItems.length} {t(locale, 'episodes')}</p></div><button className={styles.closeSheet} onClick={() => setEpisodePickerOpen(false)} aria-label="Close episode picker"><X size={19} /></button></header>
        {unlock.isPending && <p className={styles.sheetStatus}><RefreshCw size={14} aria-hidden="true" /> {t(locale, 'syncing')} · {unlockTarget?.title}</p>}
        {unlock.isError && <p className={styles.sheetError}>{t(locale, 'unlockFailed')}</p>}
        {unlock.isError && unlockTarget && <button className={styles.retryButton} onClick={() => unlock.mutate(unlockTarget)}>{t(locale, 'retry')}</button>}
        <div className={styles.sheetList}><EpisodeList albumId={albumId} episodes={episodeItems} activeEpisodeId={episodeId} englishNumbers={v005App} onEpisodeSelected={() => setEpisodePickerOpen(false)} onLocked={requestEpisode} /></div>
      </section>
    </div>}
    {unlockTarget && unlock.isPending && !episodePickerOpen && <div className={styles.unlockLayer} role="status"><div className={styles.unlockCard}><RefreshCw size={22} aria-hidden="true" /><strong>{t(locale, 'watchAd')}</strong><span>{unlockTarget.title}</span><small>{t(locale, 'syncing')}</small></div></div>}
    {retentionOpen && <div className={styles.retentionLayer}>
      <section className={styles.retentionCard} role="dialog" aria-modal="true" aria-labelledby="retention-title">
        <span className={styles.retentionEyebrow}>ONE MORE EPISODE?</span>
        <h2 id="retention-title">{v005App ? "There's more to this story. Keep watching?" : 'Nearly 5,000 viewers love these stories. Are you sure you want to leave?'}</h2>
        {canOfferRetentionUnlock && nextEpisode && <p>{v005App ? `Watch an ad to unlock ${episodeDisplayTitle(nextEpisode.title, nextEpisode.episodeNo)}.` : `Watch ${retentionConfig.data?.requiredCount ?? 1} rewarded ${retentionConfig.data?.requiredCount === 1 ? 'ad' : 'ads'} to unlock the next episode: ${nextEpisode.title}`}</p>}
        {retentionError && <p className={styles.retentionError} role="alert">{retentionError}</p>}
        {canOfferRetentionUnlock && nextEpisode && <button type="button" className={styles.retentionPrimary} disabled={retentionUnlock.isPending} onClick={() => retentionUnlock.mutate(nextEpisode)}>{retentionUnlock.isPending ? 'Preparing your ad…' : v005App ? `Watch an ad to unlock Episode ${nextEpisode.episodeNo}` : 'Watch this ad to unlock'}</button>}
        {v005App && nextEpisode?.access === 'PLAYABLE' && <button type="button" className={styles.retentionPrimary} onClick={() => { setRetentionOpen(false); if (blocker.state === 'blocked') blocker.reset(); navigate(`/watch/${albumId}/${nextEpisode.id}`, { replace: true }); }}>Watch Episode {nextEpisode.episodeNo}</button>}
        <button type="button" className={styles.retentionSecondary} disabled={retentionUnlock.isPending} onClick={() => { setRetentionOpen(false); setRetentionError(''); if (blocker.state === 'blocked') blocker.reset(); }}>Keep watching</button>
        <button type="button" className={styles.retentionLeave} disabled={retentionUnlock.isPending} onClick={leavePage}>{v005App ? 'Back to Home' : 'Leave now'}</button>
      </section>
    </div>}
  </section>;
}
