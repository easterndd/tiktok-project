import type { CursorPage, HistoryItem, Preferences, UserProfile } from '@quickreels/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bookmark, Check, ChevronRight, Clock3, FileText, Globe2, LogIn, Play, Settings2, ShieldCheck, UserRound } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlbumCard } from '../components/AlbumCard';
import { LoadingState } from '../components/LoadingState';
import { loginWithTikTok } from '../features/auth/login';
import { apiClient } from '../lib/api-client';
import { t, supportedLocales } from '../lib/i18n';
import { getSessionToken, useLocale, setStoredLocale, subscribeToSession } from '../lib/storage';
import { componentIsEnabled, useUiComponents } from '../features/cms/ui-components';
import styles from './ProfilePage.module.css';

export function ProfilePage() {
  const locale = useLocale();
  const components = useUiComponents();
  const ui = components.data?.items;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedLocale, setSelectedLocale] = useState(locale);
  const [loginError, setLoginError] = useState('');
  const token = useSyncExternalStore(subscribeToSession, getSessionToken, () => null);
  const profile = useQuery({ queryKey: ['me', token], queryFn: () => apiClient.get<UserProfile>('/me'), enabled: Boolean(token) });
  const preferences = useQuery({ queryKey: ['preferences', token], queryFn: () => apiClient.get<Preferences>('/me/preferences'), enabled: Boolean(token) });
  const history = useQuery({ queryKey: ['history', token, locale], queryFn: () => apiClient.get<{ items: HistoryItem[] }>(`/me/history?locale=${encodeURIComponent(locale)}`), enabled: Boolean(token) });
  const favorites = useQuery({ queryKey: ['favorites', token, locale], queryFn: () => apiClient.get<CursorPage<HistoryItem>>(`/me/favorites?locale=${encodeURIComponent(locale)}`), enabled: Boolean(token) });
  const savePreferences = useMutation({
    mutationFn: (patch: Partial<Preferences>) => apiClient.put<Preferences>('/me/preferences', { ...(preferences.data ?? { locale, autoplay: true, reducedData: false }), ...patch }),
    onSuccess: (next) => { setStoredLocale(next.locale); setSelectedLocale(next.locale); queryClient.setQueryData(['preferences', token], next); }
  });
  const signIn = async () => {
    setLoginError('');
    try { await loginWithTikTok(); void queryClient.invalidateQueries(); } catch (error) { setLoginError(error instanceof Error ? error.message : 'Sign in failed.'); }
  };

  return <section className={styles.page}>
    <div className={styles.header}><Link className={styles.backLink} to="/"><ArrowLeft size={18} aria-hidden="true" /> {t(locale, 'back')}</Link><span className="eyebrow">{t(locale, 'profile')}</span></div>
    <section className={styles.profileHero}>{token ? <div className={styles.avatar}><UserRound size={28} /></div> : <div className={styles.avatar}><LogIn size={25} /></div>}<div><p className="eyebrow">{token ? t(locale, 'member') : t(locale, 'welcome')}</p><h1>{profile.data?.displayName ?? t(locale, 'guest')}</h1><p>{t(locale, 'signInCopy')}</p></div>{!token && <button className={styles.signIn} onClick={() => void signIn()}>{t(locale, 'signIn')}</button>}</section>
    {loginError && <p className={styles.error}>{loginError}</p>}
    {token && <>{componentIsEnabled(ui, 'PROFILE_HISTORY') && <section className={styles.section}><div className={styles.sectionHeading}><h2><Clock3 size={18} aria-hidden="true" /> {t(locale, 'history')}</h2><ChevronRight size={17} aria-hidden="true" /></div>{history.isLoading ? <LoadingState label={t(locale, 'loadingHistory')} /> : history.data?.items.length ? <div className={styles.historyList}>{history.data.items.map((item) => <Link key={item.episodeId} to={`/watch/${item.id}/${item.episodeId}`} className={styles.historyRow}><img src={item.coverUrl} alt="" onError={(event) => { event.currentTarget.src = '/fallback-cover.svg'; }} /><span><strong>{item.title}</strong><small>{t(locale, 'episode')} {item.episodeNo} · {Math.round(item.progress * 100)}% {t(locale, 'watched')}</small><i><span style={{ width: `${item.progress * 100}%` }} /></i></span><Play size={17} fill="currentColor" aria-hidden="true" /></Link>)}</div> : <p className={styles.muted}>{t(locale, 'noHistory')}</p>}</section>}
    {componentIsEnabled(ui, 'PROFILE_FAVORITES') && <section className={styles.section}><div className={styles.sectionHeading}><h2><Bookmark size={18} aria-hidden="true" /> {t(locale, 'favorites')}</h2><ChevronRight size={17} aria-hidden="true" /></div>{favorites.isLoading ? <LoadingState label={t(locale, 'loadingFavorites')} /> : favorites.data?.items.length ? <div className={styles.favoriteGrid}>{favorites.data.items.slice(0, 4).map((album) => <AlbumCard key={album.id} album={album} locale={locale} />)}</div> : <p className={styles.muted}>{t(locale, 'noFavorites')}</p>}</section>}</>}
    <section className={styles.section}><div className={styles.sectionHeading}><h2><Settings2 size={18} aria-hidden="true" /> {t(locale, 'settings')}</h2></div><div className={styles.settingRow}><span><Globe2 size={17} aria-hidden="true" /><span><strong>{t(locale, 'language')}</strong><small>{supportedLocales.find((item) => item.value === selectedLocale)?.label}</small></span></span><select value={selectedLocale} onChange={(event) => { const next = event.target.value as Preferences['locale']; setSelectedLocale(next); setStoredLocale(next); if (token) savePreferences.mutate({ locale: next }); }} aria-label={t(locale, 'language')}>{supportedLocales.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div><label className={styles.settingRow}><span><Check size={17} aria-hidden="true" /><span><strong>{t(locale, 'autoplay')}</strong><small>{t(locale, 'continueWithoutTapping')}</small></span></span><input type="checkbox" checked={preferences.data?.autoplay ?? true} onChange={(event) => savePreferences.mutate({ autoplay: event.target.checked })} disabled={!token} /></label><label className={styles.settingRow}><span><Check size={17} aria-hidden="true" /><span><strong>{t(locale, 'reducedData')}</strong><small>{t(locale, 'useLessData')}</small></span></span><input type="checkbox" checked={preferences.data?.reducedData ?? false} onChange={(event) => savePreferences.mutate({ reducedData: event.target.checked })} disabled={!token} /></label><Link className={`${styles.settingRow} ${styles.linkRow}`} to="/privacy"><span><ShieldCheck size={17} aria-hidden="true" /><span><strong>{t(locale, 'privacyPolicy')}</strong><small>QuicKReeL</small></span></span><ChevronRight size={17} aria-hidden="true" /></Link><Link className={`${styles.settingRow} ${styles.linkRow}`} to="/terms"><span><FileText size={17} aria-hidden="true" /><span><strong>{t(locale, 'termsOfService')}</strong><small>QuicKReeL</small></span></span><ChevronRight size={17} aria-hidden="true" /></Link></section>
  </section>;
}
