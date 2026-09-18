import type { AlbumDetail, EpisodeSummary, InteractionResponse } from '@quickreels/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Heart, Play, RefreshCw, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EpisodeList } from '../components/EpisodeList';
import { LoadingState } from '../components/LoadingState';
import { unlockEpisodeByRewardedAd } from '../features/ads/rewarded-ad';
import { apiClient } from '../lib/api-client';
import { formatCompactNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useLocale } from '../lib/storage';
import { componentIsEnabled, useUiComponents } from '../features/cms/ui-components';
import styles from './AlbumPage.module.css';

export function AlbumPage() {
  const { albumId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const locale = useLocale();
  const components = useUiComponents();
  const ui = components.data?.items;
  const [favoriteNotice, setFavoriteNotice] = useState('');
  const album = useQuery({ queryKey: ['album', albumId, locale], queryFn: () => apiClient.get<AlbumDetail>(`/albums/${albumId}?locale=${encodeURIComponent(locale)}`) });
  const episodes = useQuery({ queryKey: ['episodes', albumId, locale], queryFn: () => apiClient.get<{ items: EpisodeSummary[] }>(`/albums/${albumId}/episodes?locale=${encodeURIComponent(locale)}`) });
  const mutateInteraction = useMutation({
    mutationFn: async ({ action, active }: { action: 'favorite'; active: boolean }) => {
      return apiClient.put<InteractionResponse>(`/albums/${albumId}/${action}`, { active });
    },
    onSuccess: (state, variables) => {
      queryClient.setQueryData<AlbumDetail>(['album', albumId, locale], (current) => current ? { ...current, likeCount: state.likeCount, favoriteCount: state.favoriteCount, shareCount: state.shareCount, userState: { liked: state.liked, favorited: state.favorited } } : current);
      setFavoriteNotice(variables.active ? t(locale, 'savedSuccess') : t(locale, 'savedRemoved'));
    }
  });
  const unlock = useMutation({
    mutationFn: async (episode: EpisodeSummary) => {
      await unlockEpisodeByRewardedAd(episode.id);
      return episode;
    },
    onSuccess: (episode) => { void queryClient.invalidateQueries({ queryKey: ['episodes', albumId] }); navigate(`/watch/${albumId}/${episode.id}`); }
  });

  useEffect(() => {
    if (!favoriteNotice) return;
    const timeout = window.setTimeout(() => setFavoriteNotice(''), 2_500);
    return () => window.clearTimeout(timeout);
  }, [favoriteNotice]);

  if (album.isLoading || episodes.isLoading) return <LoadingState label={t(locale, 'openingDrama')} />;
  if (album.isError || episodes.isError || !album.data) return <section className="state"><p>{t(locale, 'unavailable')}</p><Link to="/">{t(locale, 'back')}</Link></section>;
  const detail = album.data;
  const firstPlayable = episodes.data?.items.find((episode) => episode.access === 'PLAYABLE') ?? episodes.data?.items[0];

  return <section className={styles.page}>
    <Link className={styles.backLink} to="/"><ArrowLeft size={18} aria-hidden="true" /> {t(locale, 'back')}</Link>
    <header className={styles.hero}>
      <div className={styles.backdrop} style={{ backgroundImage: `url("${detail.backdropUrl ?? detail.coverUrl}")` }} />
      <img className={styles.cover} src={detail.coverUrl} alt={`${detail.title} cover`} onError={(event) => { event.currentTarget.src = '/fallback-cover.svg'; }} />
      <div className={styles.copy}><p className="eyebrow">{t(locale, 'details')}</p><h1>{detail.title}</h1><p>{detail.description}</p><div className={styles.stats}><span><Star size={14} fill="currentColor" aria-hidden="true" /> {detail.rating?.toFixed(1) ?? '9.0'}</span><span>{formatCompactNumber(detail.views ?? 0)} {t(locale, 'views')}</span><span>{detail.episodeCount} {t(locale, 'episodes')}</span></div><div className={styles.actions}>
        {firstPlayable && <button className={styles.primary} onClick={() => firstPlayable.access === 'PLAYABLE' ? navigate(`/watch/${albumId}/${firstPlayable.id}`) : unlock.mutate(firstPlayable)}><Play size={17} fill="currentColor" aria-hidden="true" /> {firstPlayable.access === 'PLAYABLE' ? t(locale, 'watchNow') : t(locale, 'watchAd')}</button>}
        <button className={styles.iconAction} onClick={() => mutateInteraction.mutate({ action: 'favorite', active: !detail.userState?.favorited })} aria-label={detail.userState?.favorited ? t(locale, 'saved') : t(locale, 'save')} title={detail.userState?.favorited ? t(locale, 'saved') : t(locale, 'save')}><Heart size={18} fill={detail.userState?.favorited ? 'currentColor' : 'none'} /></button>
      </div></div>
    </header>
    {(unlock.isPending || mutateInteraction.isPending) && <div className={styles.inlineStatus}><RefreshCw size={14} aria-hidden="true" /> {t(locale, 'syncing')}</div>}
    {favoriteNotice && <div className={styles.successStatus} role="status">{favoriteNotice}</div>}
    {unlock.isError && <div className={styles.errorStatus}>{t(locale, 'unlockFailed')}</div>}
    {mutateInteraction.isError && <div className={styles.errorStatus}>{mutateInteraction.error instanceof Error ? mutateInteraction.error.message : t(locale, 'unavailable')}</div>}
    {detail.tags?.length ? <div className={styles.tags}>{detail.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
    {componentIsEnabled(ui, 'ALBUM_DESCRIPTION') && <section className={styles.about}><h2>{t(locale, 'about')}</h2><p>{detail.description}</p></section>}
    <section className={styles.episodes}><div className={styles.sectionHeader}><h2>{t(locale, 'episodes')}</h2><span>{episodes.data?.items.length ?? 0} / {detail.episodeCount}</span></div><EpisodeList albumId={albumId} episodes={episodes.data?.items ?? []} onLocked={(episode) => unlock.mutate(episode)} /></section>
  </section>;
}
