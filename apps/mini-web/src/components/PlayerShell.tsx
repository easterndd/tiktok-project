import type { PlayInfo } from '@quickreels/shared-types';
import { AlertCircle, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createDramaPlayer } from '../features/player/create-player';
import { apiClient } from '../lib/api-client';
import { t } from '../lib/i18n';
import { useLocale } from '../lib/storage';
import styles from './PlayerShell.module.css';

export function PlayerShell({ message, coverUrl, title, playInfo }: { message?: string; coverUrl?: string | null; title?: string; playInfo?: PlayInfo }) {
  const locale = useLocale();
  const mount = useRef<HTMLDivElement>(null);
  const [playerError, setPlayerError] = useState('');

  useEffect(() => {
    if (!playInfo || !mount.current) return;
    let disposed = false;
    let player: { destroy(): void } | undefined;
    const startedAt = performance.now();
    void createDramaPlayer(mount.current, playInfo)
      .then((instance) => {
        if (disposed) {
          instance.destroy();
          return;
        }
        player = instance;
        void apiClient.post('/playback-quality-events', { episodeId: playInfo.localEpisodeId, eventType: 'FIRST_FRAME', startupMs: Math.round(performance.now() - startedAt) }).catch(() => undefined);
      })
      .catch((error) => {
        if (disposed) return;
        setPlayerError(error instanceof Error ? error.message : 'Player initialization failed.');
        void apiClient.post('/playback-quality-events', { episodeId: playInfo.localEpisodeId, eventType: 'ERROR', errorCode: 'PLAYER_INIT_FAILED' }).catch(() => undefined);
      });
    return () => { disposed = true; player?.destroy(); };
  }, [playInfo]);

  const visibleMessage = playerError || message;
  return <section className={styles.shell} aria-label={t(locale, 'watchEpisode')}>
    {coverUrl && <img src={coverUrl} alt="" className={styles.poster} onError={(event) => { event.currentTarget.src = '/fallback-cover.svg'; }} />}
    <div className={styles.scrim} />
    {playInfo && !visibleMessage && <div className={styles.playerMount} ref={mount} />}
    {visibleMessage ? <div className={styles.message}><AlertCircle size={20} aria-hidden="true" /><strong>{title}</strong><span>{visibleMessage}</span></div> : !playInfo ? <div className={styles.message}><Play size={24} aria-hidden="true" /><strong>{title}</strong><span>{t(locale, 'preparingPlayer')}</span></div> : null}
  </section>;
}
