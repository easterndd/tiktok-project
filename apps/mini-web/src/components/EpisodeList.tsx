import type { EpisodeSummary } from '@breezereels/shared-types';
import { ChevronRight, LockKeyhole, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDuration } from '../lib/format';
import { t } from '../lib/i18n';
import { useLocale } from '../lib/storage';
import styles from './EpisodeList.module.css';

export function EpisodeList({ albumId, episodes, onLocked }: { albumId: string; episodes: EpisodeSummary[]; onLocked?: (episode: EpisodeSummary) => void }) {
  const locale = useLocale();
  return <ol className={styles.list}>{episodes.map((episode) => {
    const locked = episode.access !== 'PLAYABLE';
    const row = <span className={styles.rowInner}>
        <span className={styles.number}>{episode.episodeNo}</span>
        <span className={styles.title}>{episode.title}<small>{formatDuration(episode.durationMs)}</small></span>
        <span className={styles.status}>{locked ? <LockKeyhole size={17} aria-label={t(locale, 'rewardedAdRequired')} /> : <Play size={17} aria-label={t(locale, 'playable')} />}<ChevronRight size={16} aria-hidden="true" /></span>
      </span>;
    return <li key={episode.id}>{locked ? <button className={styles.buttonRow} onClick={() => onLocked?.(episode)} aria-label={`${t(locale, 'unlockEpisode')}: ${episode.title}`}>{row}</button> : <Link className={styles.row} to={`/watch/${albumId}/${episode.id}`} aria-label={`${t(locale, 'watchEpisode')}: ${episode.title}`}>{row}</Link>}</li>;
  })}</ol>;
}
