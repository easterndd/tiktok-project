import type { PlayInfo } from '@breezereels/shared-types';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { PlayerShell } from '../components/PlayerShell';
import { apiClient } from '../lib/api-client';
import { hasTikTokMinis } from '../lib/ttminis';
import styles from './WatchPage.module.css';

export function WatchPage() {
  const { albumId = '', episodeId = '' } = useParams();
  const playInfo = useQuery({ queryKey: ['play', episodeId], queryFn: () => apiClient.get<PlayInfo>(`/episodes/${episodeId}/play`), enabled: Boolean(sessionStorage.getItem('breezereels_access_token')) });
  let message = 'Sign in with TikTok to start this episode.';
  if (!hasTikTokMinis()) message = 'The official player is available inside TikTok.';
  else if (playInfo.isLoading) message = 'Preparing the official player...';
  else if (playInfo.isError) message = 'This episode is locked or unavailable.';
  else if (playInfo.data) message = 'Player integration will mount here after TikTok Preview configuration.';
  return <section className={styles.page}><Link className="back-link" to={`/album/${albumId}`}><ArrowLeft size={18} aria-hidden="true" /> Episodes</Link><PlayerShell message={message} /></section>;
}
