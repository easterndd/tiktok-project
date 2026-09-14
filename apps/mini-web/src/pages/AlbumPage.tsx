import type { AlbumDetail, EpisodeSummary, InteractionResponse, ShareResponse } from '@quickreels/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bookmark, Heart, Play, RefreshCw, Share2, Star } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EpisodeList } from '../components/EpisodeList';
import { LoadingState } from '../components/LoadingState';
import { unlockEpisodeByRewardedAd } from '../features/ads/rewarded-ad';
import { loginWithTikTok } from '../features/auth/login';
import { apiClient } from '../lib/api-client';
import { formatCompactNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useLocale, getSessionToken } from '../lib/storage';
import { componentIsEnabled, useUiComponents } from '../features/cms/ui-components';
import styles from './AlbumPage.module.css';

export function AlbumPage() {
  const { albumId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const locale = useLocale();
  const components = useUiComponents();
  const ui = components.data?.items;
  const album = useQuery({ queryKey: ['album', albumId, locale], queryFn: () => apiClient.get<AlbumDetail>(`/albums/${albumId}?locale=${encodeURIComponent(locale)}`) });
  const episodes = useQuery({ queryKey: ['episodes', albumId, locale], queryFn: () => apiClient.get<{ items: EpisodeSummary[] }>(`/albums/${albumId}/episodes?locale=${encodeURIComponent(locale)}`) });
  const mutateInteraction = useMutation({
    mutationFn: async ({ action, active }: { action: 'like' | 'favorite'; active: boolean }) => {
      if (!getSessionToken()) await loginWithTikTok();
      return apiClient.put<InteractionResponse>(`/albums/${albumId}/${action}`, { active });
    },
    onSuccess: (state) => queryClient.setQueryData<AlbumDetail>(['album', albumId, locale], (current) => current ? { ...current, likeCount: state.likeCount, favoriteCount: state.favoriteCount, shareCount: state.shareCount, userState: { liked: state.liked, favorited: state.favorited } } : current)
  });
  const share = useMutation({
    mutationFn: () => apiClient.post<ShareResponse>(`/albums/${albumId}/share`, { channel: 'copy_link', locale }),
    onSuccess: (response) => void navigator.clipboard?.writeText(`${window.location.origin}${response.deepLink}`)
  });
  const unlock = useMutation({
    mutationFn: async (episode: EpisodeSummary) => {
      if (!getSessionToken()) await loginWithTikTok();
      await unlockEpisodeByRewardedAd(episode.id);
      return episode;
    },
    onSuccess: (episode) => { void queryClient.invalidateQueries({ queryKey: ['episodes', albumId] }); navigate(`/watch/${albumId}/${episode.id}`); }
  });

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
        <button className={styles.iconAction} onClick={() => mutateInteraction.mutate({ action: 'like', active: !detail.userState?.liked })} aria-label={detail.userState?.liked ? t(locale, 'liked') : t(locale, 'like')} title={detail.userState?.liked ? t(locale, 'liked') : t(locale, 'like')}><Heart size={18} fill={detail.userState?.liked ? 'currentColor' : 'none'} /></button>
        <button className={styles.iconAction} onClick={() => mutateInteraction.mutate({ action: 'favorite', active: !detail.userState?.favorited })} aria-label={detail.userState?.favorited ? t(locale, 'saved') : t(locale, 'save')} title={detail.userState?.favorited ? t(locale, 'saved') : t(locale, 'save')}><Bookmark size={18} fill={detail.userState?.favorited ? 'currentColor' : 'none'} /></button>
        <button className={styles.iconAction} onClick={() => share.mutate()} aria-label={t(locale, 'share')} title={t(locale, 'share')}><Share2 size={18} /></button>
      </div></div>
    </header>
    {(unlock.isPending || mutateInteraction.isPending || share.isPending) && <div className={styles.inlineStatus}><RefreshCw size={14} aria-hidden="true" /> {t(locale, 'syncing')}</div>}
    {unlock.isError && <div className={styles.errorStatus}>{unlock.error instanceof Error ? unlock.error.message : t(locale, 'unlockFailed')}</div>}
    {mutateInteraction.isError && <div className={styles.errorStatus}>{mutateInteraction.error instanceof Error ? mutateInteraction.error.message : t(locale, 'unavailable')}</div>}
    {detail.tags?.length ? <div className={styles.tags}>{detail.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
    {componentIsEnabled(ui, 'ALBUM_DESCRIPTION') && <section className={styles.about}><h2>{t(locale, 'about')}</h2><p>{detail.description}</p></section>}
    <section className={styles.episodes}><div className={styles.sectionHeader}><h2>{t(locale, 'episodes')}</h2><span>{episodes.data?.items.length ?? 0} / {detail.episodeCount}</span></div><EpisodeList albumId={albumId} episodes={episodes.data?.items ?? []} onLocked={(episode) => unlock.mutate(episode)} /></section>
  </section>;
}
