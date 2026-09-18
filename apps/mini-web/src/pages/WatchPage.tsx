import type { AlbumDetail, EpisodeSummary, PlayInfo } from '@quickreels/shared-types';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, Info, RefreshCw } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EpisodeList } from '../components/EpisodeList';
import { PlayerShell } from '../components/PlayerShell';
import { LoadingState } from '../components/LoadingState';
import { apiClient } from '../lib/api-client';
import { t } from '../lib/i18n';
import { useLocale } from '../lib/storage';
import { hasTikTokMinis } from '../lib/ttminis';
import styles from './WatchPage.module.css';

export function WatchPage() {
  const { albumId = '', episodeId = '' } = useParams();
  const navigate = useNavigate();
  const locale = useLocale();
  const album = useQuery({ queryKey: ['album', albumId, locale], queryFn: () => apiClient.get<AlbumDetail>(`/albums/${albumId}?locale=${locale}`) });
  const episodes = useQuery({ queryKey: ['episodes', albumId, locale], queryFn: () => apiClient.get<{ items: EpisodeSummary[] }>(`/albums/${albumId}/episodes?locale=${encodeURIComponent(locale)}`) });
  const playInfo = useQuery({ queryKey: ['play', episodeId, locale], queryFn: () => apiClient.get<PlayInfo>(`/episodes/${episodeId}/play?locale=${encodeURIComponent(locale)}`), enabled: Boolean(episodeId) });
  const currentIndex = episodes.data?.items.findIndex((episode) => episode.id === episodeId) ?? -1;
  const nextEpisode = currentIndex >= 0 ? episodes.data?.items[currentIndex + 1] : undefined;
  const preloadEpisodeIds = [episodeId, nextEpisode?.access === 'PLAYABLE' ? nextEpisode.id : undefined].filter((id): id is string => Boolean(id));
  const preloadQueries = useQueries({
    queries: preloadEpisodeIds.map((id) => ({
      queryKey: ['play', id, locale],
      queryFn: () => apiClient.get<PlayInfo>(`/episodes/${id}/play?locale=${encodeURIComponent(locale)}`),
      enabled: Boolean(id)
    }))
  });
  const playerPlaylist = preloadQueries.flatMap((query) => query.data ? [query.data] : []);

  if (album.isLoading || episodes.isLoading || playInfo.isLoading) return <LoadingState label={t(locale, 'preparingEpisode')} />;
  if (album.isError || episodes.isError || !album.data) return <section className="state"><p>{t(locale, 'unavailable')}</p><Link to={`/album/${albumId}`}>{t(locale, 'back')}</Link></section>;
  const currentEpisode = episodes.data?.items.find((episode) => episode.id === episodeId);
  const localPlayback = playInfo.data?.playbackMode === 'LOCAL' && Boolean(playInfo.data.sourceUrl);
  const platformReady = hasTikTokMinis() && Boolean(window.TTMinis?.getPlayer);
  const message = playInfo.isError ? t(locale, 'episodeLocked') : !localPlayback && !platformReady ? t(locale, 'platformCopy') : undefined;

  return <section className={styles.page}>
    <div className={styles.watchHeader}><Link className={styles.backLink} to={`/album/${albumId}`}><ArrowLeft size={18} aria-hidden="true" /> {t(locale, 'back')}</Link><span className={styles.episodeLabel}>{currentEpisode ? `${t(locale, 'episode')} ${currentEpisode.episodeNo}` : ''}</span><button className={styles.episodeSelect} aria-label="Open episode list"><ChevronDown size={18} /></button></div>
    <PlayerShell
      message={message}
      playInfo={playInfo.data}
      playlist={playerPlaylist}
      onEpisodeEnded={nextEpisode?.access === 'PLAYABLE' ? () => navigate(`/watch/${albumId}/${nextEpisode.id}`) : undefined}
      coverUrl={playInfo.data?.coverUrl ?? album.data.backdropUrl ?? album.data.coverUrl}
      title={playInfo.data?.title ?? currentEpisode?.title ?? album.data.title}
    />
    {!localPlayback && <div className={styles.playerNotice}><Info size={16} aria-hidden="true" /><span><strong>{t(locale, 'platformPending')}</strong>{!hasTikTokMinis() ? ` ${t(locale, 'openInTikTok')}` : ` ${t(locale, 'qualificationRequired')}`}</span></div>}
    <section className={styles.nextUp}><div className={styles.sectionHeader}><h2>{t(locale, 'upNext')}</h2><span>{episodes.data?.items.length ?? 0} {t(locale, 'episodes')}</span></div><EpisodeList albumId={albumId} episodes={episodes.data?.items.slice(0, 5) ?? []} /></section>
    {playInfo.isFetching && <div className={styles.sync}><RefreshCw size={14} aria-hidden="true" /> {t(locale, 'updatingPlayback')}</div>}
  </section>;
}
