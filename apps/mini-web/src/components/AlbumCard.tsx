import type { AlbumSummary } from '@breezereels/shared-types';
import { Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import styles from './AlbumCard.module.css';

export function AlbumCard({ album }: { album: AlbumSummary }) {
  return <Link className={styles.card} to={`/album/${album.id}`} aria-label={`Open ${album.title}`}>
    <img className={styles.cover} src={album.coverUrl} alt="" onError={(event) => { event.currentTarget.src = '/fallback-cover.svg'; }} />
    <div className={styles.copy}>
      <span className={styles.count}><Play size={14} aria-hidden="true" /> {album.episodeCount} episodes</span>
      <h2>{album.title}</h2>
      <p>{album.description}</p>
    </div>
  </Link>;
}
