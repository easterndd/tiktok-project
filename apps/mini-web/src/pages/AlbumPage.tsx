import type { AlbumDetail, EpisodeSummary } from '@breezereels/shared-types';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { EpisodeList } from '../components/EpisodeList';
import { LoadingState } from '../components/LoadingState';
import { apiClient } from '../lib/api-client';
import styles from './AlbumPage.module.css';

export function AlbumPage() {
  const { albumId = '' } = useParams();
  const album = useQuery({ queryKey: ['album', albumId], queryFn: () => apiClient.get<AlbumDetail>(`/albums/${albumId}`) });
  const episodes = useQuery({ queryKey: ['episodes', albumId], queryFn: () => apiClient.get<{ items: EpisodeSummary[] }>(`/albums/${albumId}/episodes`) });
  if (album.isLoading || episodes.isLoading) return <LoadingState />;
  if (album.isError || episodes.isError || !album.data) return <section className="state"><p>This drama is unavailable.</p><Link to="/">Back to dramas</Link></section>;
  return <section className={styles.page}>
    <Link className="back-link" to="/"><ArrowLeft size={18} aria-hidden="true" /> All dramas</Link>
    <header className={styles.hero}><img src={album.data.coverUrl} alt="" onError={(event) => { event.currentTarget.src = '/fallback-cover.svg'; }} /><div><p className="eyebrow">{album.data.language.toUpperCase()}</p><h1>{album.data.title}</h1><p>{album.data.description}</p></div></header>
    <section><h2>Episodes</h2><EpisodeList albumId={albumId} episodes={episodes.data?.items ?? []} /></section>
  </section>;
}
