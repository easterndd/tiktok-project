import type { AlbumSummary, CursorPage, HistoryItem, Preferences } from '@quickreels/shared-types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bookmark, ChevronRight, Clock3, FileText, Globe2, Play, Settings2, ShieldCheck } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { AlbumCard } from '../components/AlbumCard';
import { LoadingState } from '../components/LoadingState';
import { apiClient } from '../lib/api-client';
import { t, supportedLocales } from '../lib/i18n';
import { getSessionToken, useLocale, setStoredLocale, subscribeToSession } from '../lib/storage';
import { componentIsEnabled, useUiComponents } from '../features/cms/ui-components';
import styles from './ProfilePage.module.css';

export function ProfilePage() {
  const locale = useLocale();
  const components = useUiComponents();
  const ui = components.data?.items;
  const [selectedLocale, setSelectedLocale] = useState(locale);
  const token = useSyncExternalStore(subscribeToSession, getSessionToken, () => null);
  const history = useQuery({ queryKey: ['history', token, locale], queryFn: () => apiClient.get<{ items: HistoryItem[] }>(`/me/history?locale=${encodeURIComponent(locale)}`), enabled: Boolean(token) });
  const favorites = useQuery({ queryKey: ['favorites', token, locale], queryFn: () => apiClient.get<CursorPage<AlbumSummary>>(`/me/favorites?locale=${encodeURIComponent(locale)}`), enabled: Boolean(token) });
  const savePreferences = useMutation({
    mutationFn: (patch: Partial<Preferences>) => apiClient.put<Preferences>('/me/preferences', patch),
    onSuccess: (next) => { setStoredLocale(next.locale); setSelectedLocale(next.locale); }
  });

  return <section className={styles.page}>
    <div className={styles.header}><Link className={styles.backLink} to="/"><ArrowLeft size={18} aria-hidden="true" /> {t(locale, 'back')}</Link><span className="eyebrow">{t(locale, 'profile')}</span></div>
    {componentIsEnabled(ui, 'PROFILE_HISTORY') && <section className={styles.section}><div className={styles.sectionHeading}><h2><Clock3 size={18} aria-hidden="true" /> {t(locale, 'history')}</h2><ChevronRight size={17} aria-hidden="true" /></div>{history.isLoading ? <LoadingState label={t(locale, 'loadingHistory')} /> : history.data?.items.length ? <div className={styles.historyList}>{history.data.items.map((item) => <Link key={item.episodeId} to={`/watch/${item.id}/${item.episodeId}`} className={styles.historyRow}><img src={item.coverUrl} alt="" onError={(event) => { event.currentTarget.src = '/fallback-cover.svg'; }} /><span><strong>{item.title}</strong><small>{t(locale, 'episode')} {item.episodeNo} · {Math.round(item.progress * 100)}% {t(locale, 'watched')}</small><i><span style={{ width: `${item.progress * 100}%` }} /></i></span><Play size={17} fill="currentColor" aria-hidden="true" /></Link>)}</div> : <p className={styles.muted}>{t(locale, 'noHistory')}</p>}</section>}
    <section className={styles.section}><div className={styles.sectionHeading}><h2><Bookmark size={18} aria-hidden="true" /> {t(locale, 'myCollection')}</h2></div>{favorites.isLoading ? <LoadingState label={t(locale, 'loadingFavorites')} /> : favorites.data?.items.length ? <div className={styles.favoriteGrid}>{favorites.data.items.map((album) => <AlbumCard key={album.id} album={album} locale={locale} />)}</div> : <p className={styles.muted}>{t(locale, 'noFavorites')}</p>}</section>
    <section className={styles.section}><div className={styles.sectionHeading}><h2><Settings2 size={18} aria-hidden="true" /> {t(locale, 'settings')}</h2></div><div className={styles.settingRow}><span><Globe2 size={17} aria-hidden="true" /><span><strong>{t(locale, 'language')}</strong><small>{supportedLocales.find((item) => item.value === selectedLocale)?.label}</small></span></span><select value={selectedLocale} onChange={(event) => { const next = event.target.value as Preferences['locale']; setSelectedLocale(next); setStoredLocale(next); if (token) savePreferences.mutate({ locale: next }); }} aria-label={t(locale, 'language')}>{supportedLocales.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div><Link className={`${styles.settingRow} ${styles.linkRow}`} to="/privacy"><span><ShieldCheck size={17} aria-hidden="true" /><span><strong>{t(locale, 'privacyPolicy')}</strong><small>QuicK ReeLS</small></span></span><ChevronRight size={17} aria-hidden="true" /></Link><Link className={`${styles.settingRow} ${styles.linkRow}`} to="/terms"><span><FileText size={17} aria-hidden="true" /><span><strong>{t(locale, 'termsOfService')}</strong><small>QuicK ReeLS</small></span></span><ChevronRight size={17} aria-hidden="true" /></Link></section>
  </section>;
}
