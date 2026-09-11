import { AlertCircle, Play } from 'lucide-react';
import { t } from '../lib/i18n';
import { useLocale } from '../lib/storage';
import styles from './PlayerShell.module.css';

export function PlayerShell({ message, coverUrl, title }: { message?: string; coverUrl?: string | null; title?: string }) {
  const locale = useLocale();
  return <section className={styles.shell} aria-label={t(locale, 'watchEpisode')}>
    {coverUrl && <img src={coverUrl} alt="" className={styles.poster} onError={(event) => { event.currentTarget.src = '/fallback-cover.svg'; }} />}
    <div className={styles.scrim} />
    {message ? <div className={styles.message}><AlertCircle size={20} aria-hidden="true" /><strong>{title}</strong><span>{message}</span></div> : <div className={styles.message}><Play size={24} aria-hidden="true" /><strong>{title}</strong><span>{t(locale, 'preparingPlayer')}</span></div>}
  </section>;
}
