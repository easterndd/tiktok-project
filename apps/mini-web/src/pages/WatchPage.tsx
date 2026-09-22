import type { AlbumDetail, EpisodeSummary, PlayInfo } from '@quickreels/shared-types';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, Info, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EpisodeList } from '../components/EpisodeList';
import { PlayerShell } from '../components/PlayerShell';
import { LoadingState } from '../components/LoadingState';
import { unlockEpisodeByRewardedAd } from '../features/ads/rewarded-ad';
import { apiClient } from '../lib/api-client';
import { t } from '../lib/i18n';
import { useLocale } from '../lib/storage';
import { hasTikTokMinis } from '../lib/ttminis';
import styles from './WatchPage.module.css';

export function WatchPage() {
  const { albumId = '', episodeId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const locale = useLocale();
  const [episodePickerOpen, setEpisodePickerOpen] = useState(false);
  const [unlockTarget, setUnlockTarget] = useState<EpisodeSummary | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const album = useQuery({ queryKey: ['album', albumId, locale], queryFn: () => apiClient.get<AlbumDetail>(`/albums/${albumId}?locale=${encodeURIComponent(locale)}`) });
  const episodes = useQuery({ queryKey: ['episodes', albumId, locale], queryFn: () => apiClient.get<{ items: EpisodeSummary[] }>(`/albums/${albumId}/episodes?locale=${encodeURIComponent(locale)}`) });
  const playInfo = useQuery({ queryKey: ['play', episodeId, locale], queryFn: () => apiClient.get<PlayInfo>(`/episodes/${episodeId}/play?locale=${encodeURIComponent(locale)}`), enabled: Boolean(episodeId) });
  const episodeItems = episodes.data?.items ?? [];
  const currentIndex = episodeItems.findIndex((episode) => episode.id === episodeId);
  const nextEpisode = currentIndex >= 0 ? episodeItems[currentIndex + 1] : undefined;
  const preloadEpisodeIds = [episodeId, nextEpisode?.access === 'PLAYABLE' ? nextEpisode.id : undefined].filter((id): id is string => Boolean(id));
  const preloadQueries = useQueries({
    queries: preloadEpisodeIds.map((id) => ({
      queryKey: ['play', id, locale],
      queryFn: () => apiClient.get<PlayInfo>(`/episodes/${id}/play?locale=${encodeURIComponent(locale)}`),
      enabled: Boolean(id)
    }))
  });
  const playerPlaylist = preloadQueries.flatMap((query) => query.data ? [query.data] : []);
  const unlock = useMutation({
    mutationFn: async (episode: EpisodeSummary) => {
      await unlockEpisodeByRewardedAd(episode.id);
      return episode;
    },
    onSuccess: (episode) => {
      setUnlockTarget(null);
      setEpisodePickerOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['episodes', albumId] });
      navigate(`/watch/${albumId}/${episode.id}`, { replace: true });
    }
  });
  const defaultEpisode = episodeItems.find((episode) => episode.access === 'PLAYABLE') ?? episodeItems[0];

  useEffect(() => {
    if (episodeId || !defaultEpisode) return;
    navigate(`/watch/${albumId}/${defaultEpisode.id}`, { replace: true });
  }, [albumId, defaultEpisode, episodeId, navigate]);

  if (album.isError || episodes.isError) return <section className={styles.resolving}><div className="state"><p>{t(locale, 'unavailable')}</p><Link to="/">{t(locale, 'back')}</Link></div></section>;
  if (album.isLoading || episodes.isLoading) return <section className={styles.resolving}><LoadingState label={t(locale, 'preparingEpisode')} /></section>;
  if (!album.data || !defaultEpisode) return <section className={styles.resolving}><div className="state"><p>{t(locale, 'unavailable')}</p><Link to="/">{t(locale, 'back')}</Link></div></section>;
  if (!episodeId || playInfo.isLoading) return <section className={styles.resolving}><LoadingState label={t(locale, 'preparingEpisode')} /></section>;

  const detail = album.data;
  const currentEpisode = episodeItems.find((episode) => episode.id === episodeId);
  const localPlayback = playInfo.data?.playbackMode === 'LOCAL' && Boolean(playInfo.data.sourceUrl);
  const platformReady = hasTikTokMinis() && Boolean(window.TTMinis?.getPlayer);
  const message = playInfo.isError ? t(locale, 'episodeLocked') : !localPlayback && !platformReady ? t(locale, 'platformCopy') : undefined;
  const goBack = () => window.history.length > 1 ? navigate(-1) : navigate('/');
  const previousEpisode = currentIndex > 0 ? episodeItems[currentIndex - 1] : undefined;
  const requestEpisode = (episode: EpisodeSummary | undefined) => {
    if (!episode || episode.id === episodeId || unlock.isPending) return;
    if (episode.access === 'PLAYABLE') {
      setEpisodePickerOpen(false);
      navigate(`/watch/${albumId}/${episode.id}`, { replace: true });
      return;
    }
    setUnlockTarget(episode);
    unlock.mutate(episode);
  };
  const handleTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    if (episodePickerOpen || unlock.isPending || event.touches.length !== 1) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, select')) return;
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };
  const handleTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || episodePickerOpen || unlock.isPending) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const verticalDistance = Math.abs(deltaY);
    if (verticalDistance < 72 || verticalDistance < Math.abs(deltaX) * 1.2) return;
    requestEpisode(deltaY < 0 ? nextEpisode : previousEpisode);
  };

  return <section className={styles.page} onTouchStartCapture={handleTouchStart} onTouchEndCapture={handleTouchEnd} onTouchCancelCapture={() => { touchStart.current = null; }}>
    <PlayerShell
      message={message}
      playInfo={playInfo.data}
      playlist={playerPlaylist}
      onEpisodeEnded={() => requestEpisode(nextEpisode)}
      coverUrl={playInfo.data?.coverUrl ?? detail.backdropUrl ?? detail.coverUrl}
      title={playInfo.data?.title ?? currentEpisode?.title ?? detail.title}
      immersive
    />
    <header className={styles.watchHeader}>
      <button className={styles.backButton} onClick={goBack} aria-label={t(locale, 'back')}><ArrowLeft size={20} aria-hidden="true" /></button>
      <div className={styles.episodeLabel}><strong>{detail.title}</strong><span>{currentEpisode ? `${t(locale, 'episode')} ${currentEpisode.episodeNo}` : ''}</span></div>
      <button className={styles.episodeSelect} onClick={() => setEpisodePickerOpen(true)} aria-label={t(locale, 'episodes')}><ChevronDown size={19} aria-hidden="true" /></button>
    </header>
    <div className={styles.playerMeta}>
      <button className={styles.episodeTrigger} onClick={() => setEpisodePickerOpen(true)}><span>{currentEpisode ? `${t(locale, 'episode')} ${currentEpisode.episodeNo}` : t(locale, 'episodes')}</span><strong>{currentEpisode?.title ?? detail.title}</strong><ChevronDown size={16} aria-hidden="true" /></button>
      {!localPlayback && <div className={styles.playerNotice}><Info size={15} aria-hidden="true" /><span>{!hasTikTokMinis() ? t(locale, 'openInTikTok') : t(locale, 'qualificationRequired')}</span></div>}
      {playInfo.isFetching && <div className={styles.sync}><RefreshCw size={14} aria-hidden="true" /> {t(locale, 'updatingPlayback')}</div>}
    </div>
    {episodePickerOpen && <div className={styles.sheetLayer} role="presentation">
      <button className={styles.sheetBackdrop} onClick={() => setEpisodePickerOpen(false)} aria-label="Close episode picker" />
      <section className={styles.episodeSheet} role="dialog" aria-modal="true" aria-label={t(locale, 'episodes')}>
        <div className={styles.sheetHandle} />
        <header className={styles.sheetHeader}><div><span className="eyebrow">{detail.title}</span><h2>{t(locale, 'episodes')}</h2><p>{episodeItems.length} {t(locale, 'episodes')}</p></div><button className={styles.closeSheet} onClick={() => setEpisodePickerOpen(false)} aria-label="Close episode picker"><X size={19} /></button></header>
        {unlock.isPending && <p className={styles.sheetStatus}><RefreshCw size={14} aria-hidden="true" /> {t(locale, 'syncing')} · {unlockTarget?.title}</p>}
        {unlock.isError && <p className={styles.sheetError}>{t(locale, 'unlockFailed')}</p>}
        <div className={styles.sheetList}><EpisodeList albumId={albumId} episodes={episodeItems} activeEpisodeId={episodeId} onEpisodeSelected={() => setEpisodePickerOpen(false)} onLocked={requestEpisode} /></div>
      </section>
    </div>}
    {unlockTarget && unlock.isPending && !episodePickerOpen && <div className={styles.unlockLayer} role="status"><div className={styles.unlockCard}><RefreshCw size={22} aria-hidden="true" /><strong>{t(locale, 'watchAd')}</strong><span>{unlockTarget.title}</span><small>{t(locale, 'syncing')}</small></div></div>}
  </section>;
}
