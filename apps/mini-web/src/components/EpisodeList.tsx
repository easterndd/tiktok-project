import type { EpisodeSummary } from '@breezereels/shared-types';
import { LockKeyhole, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDuration } from '../lib/format';
import styles from './EpisodeList.module.css';

export function EpisodeList({ albumId, episodes }: { albumId: string; episodes: EpisodeSummary[] }) {
  return <ol className={styles.list}>{episodes.map((episode) => {
    const locked = episode.access !== 'PLAYABLE';
    return <li key={episode.id}>
      <Link className={styles.row} to={`/watch/${albumId}/${episode.id}`} aria-label={`Watch ${episode.title}`}>
        <span className={styles.number}>{episode.episodeNo}</span>
        <span className={styles.title}>{episode.title}<small>{formatDuration(episode.durationMs)}</small></span>
        {locked ? <LockKeyhole size={18} aria-label="Rewarded ad required" /> : <Play size={18} aria-label="Playable" />}
      </Link>
    </li>;
  })}</ol>;
}
