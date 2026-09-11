import type { AlbumSummary } from '@breezereels/shared-types';
import { ChevronRight, Play, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { t, translateGenre } from '../lib/i18n';
import { useLocale } from '../lib/storage';
import styles from './AlbumCard.module.css';

export function AlbumCard({ album, locale: providedLocale }: { album: AlbumSummary; locale?: import('@breezereels/shared-types').Locale }) {
  const currentLocale = useLocale();
  const locale = providedLocale ?? currentLocale;
  return <Link className={styles.card} to={`/album/${album.id}`} aria-label={`${t(locale, 'watchEpisode')}: ${album.title}`}>
    <div className={styles.coverWrap}>
      <img className={styles.cover} src={album.coverUrl} alt={`${album.title} cover`} onError={(event) => { event.currentTarget.src = '/fallback-cover.svg'; }} />
      {typeof album.progress === 'number' && album.progress > 0 && <span className={styles.progress}><span style={{ width: `${album.progress * 100}%` }} /></span>}
    </div>
    <div className={styles.copy}>
      <div className={styles.meta}><span><Play size={12} aria-hidden="true" /> {album.episodeCount} {t(locale, 'episodes')}</span>{album.rating && <span><Star size={12} fill="currentColor" aria-hidden="true" /> {album.rating.toFixed(1)}</span>}</div>
      <h2>{album.title}</h2>
      <p>{album.description}</p>
      <div className={styles.footer}><span>{album.genres?.slice(0, 2).map((genre) => translateGenre(locale, genre)).join(' · ')}</span><ChevronRight size={17} aria-hidden="true" /></div>
    </div>
  </Link>;
}
