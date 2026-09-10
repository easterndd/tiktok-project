import type { AlbumSummary, CursorPage } from '@breezereels/shared-types';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { AlbumCard } from '../components/AlbumCard';
import { LoadingState } from '../components/LoadingState';
import { apiClient } from '../lib/api-client';
import styles from './HomePage.module.css';

export function HomePage() {
  const albums = useQuery({ queryKey: ['albums'], queryFn: () => apiClient.get<CursorPage<AlbumSummary>>('/albums') });
  if (albums.isLoading) return <LoadingState label="Loading dramas..." />;
  if (albums.isError) return <section className="state"><p>We could not load dramas right now.</p><button onClick={() => void albums.refetch()}><RefreshCw size={18} aria-hidden="true" /> Retry</button></section>;
  return <section className={styles.page}>
    <header className={styles.header}><p className="eyebrow">SHORT DRAMA</p><h1>Find your next episode.</h1><button className="icon-button" onClick={() => void albums.refetch()} aria-label="Refresh dramas"><RefreshCw size={20} /></button></header>
    {albums.data?.items.length ? <div className={styles.grid}>{albums.data.items.map((album) => <AlbumCard key={album.id} album={album} />)}</div> : <section className="state"><p>No dramas are available yet.</p></section>}
  </section>;
}
