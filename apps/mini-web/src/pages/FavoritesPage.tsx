import type { AlbumSummary, CursorPage } from '@quickreels/shared-types';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bookmark } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { AlbumCard } from '../components/AlbumCard';
import { LoadingState } from '../components/LoadingState';
import { apiClient } from '../lib/api-client';
import { t } from '../lib/i18n';
import { getSessionToken, subscribeToSession, useLocale } from '../lib/storage';
import styles from './FavoritesPage.module.css';

export function FavoritesPage() {
  const locale = useLocale();
  const token = useSyncExternalStore(subscribeToSession, getSessionToken, () => null);
  const favorites = useQuery({
    queryKey: ['favorites', token, locale],
    queryFn: () => apiClient.get<CursorPage<AlbumSummary>>(`/me/favorites?locale=${encodeURIComponent(locale)}`),
    enabled: Boolean(token)
  });

  return <section className={styles.page}>
    <div className={styles.header}>
      <Link className={styles.backLink} to="/profile"><ArrowLeft size={18} aria-hidden="true" /> {t(locale, 'back')}</Link>
      <span className="eyebrow"><Bookmark size={14} aria-hidden="true" /> {t(locale, 'favorites')}</span>
    </div>
    <div className={styles.heading}><h1>{t(locale, 'myCollection')}</h1><span>{favorites.data?.items.length ?? 0} {t(locale, 'stories')}</span></div>
    {favorites.isLoading && <LoadingState label={t(locale, 'loadingFavorites')} />}
    {!favorites.isLoading && favorites.data?.items.length ? <div className={styles.grid}>{favorites.data.items.map((album) => <AlbumCard key={album.id} album={album} locale={locale} />)}</div> : null}
    {!favorites.isLoading && !favorites.data?.items.length && <section className={styles.empty}><Bookmark size={24} aria-hidden="true" /><p>{t(locale, 'noFavorites')}</p></section>}
  </section>;
}
