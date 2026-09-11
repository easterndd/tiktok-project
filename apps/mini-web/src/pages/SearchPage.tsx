import type { CursorPage, Genre, SearchResponse } from '@breezereels/shared-types';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Search as SearchIcon, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlbumCard } from '../components/AlbumCard';
import { LoadingState } from '../components/LoadingState';
import { apiClient } from '../lib/api-client';
import { t } from '../lib/i18n';
import { useLocale } from '../lib/storage';
import styles from './SearchPage.module.css';

export function SearchPage() {
  const locale = useLocale();
  const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get('q') ?? '');
  const query = params.get('q') ?? '';
  const genre = params.get('genre');
  const genres = useQuery({ queryKey: ['genres', locale], queryFn: () => apiClient.get<{ items: Genre[] }>(`/genres?locale=${encodeURIComponent(locale)}`) });
  const results = useQuery({
    queryKey: ['search', query, genre, locale],
    queryFn: () => apiClient.get<SearchResponse>(`/search?q=${encodeURIComponent(genre ?? query)}&locale=${encodeURIComponent(locale)}&limit=20`),
    enabled: Boolean(query || genre)
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (input.trim()) setParams({ q: input.trim() });
      else if (!genre) setParams({});
    }, 320);
    return () => window.clearTimeout(timer);
  }, [input, genre, setParams]);

  const activeItems = results.data?.items ?? [];
  const items = query || genre ? activeItems : [];
  const fallback = results.data?.fallbackItems ?? [];

  return <section className={styles.page}>
    <div className={styles.searchHeader}><Link className={styles.backLink} to="/"><ArrowLeft size={18} aria-hidden="true" /> {t(locale, 'back')}</Link><span className={styles.headerLabel}><SlidersHorizontal size={15} aria-hidden="true" /> {t(locale, 'discover')}</span></div>
    <div className={styles.searchBox}><SearchIcon size={20} aria-hidden="true" /><input value={input} onChange={(event) => setInput(event.target.value)} placeholder={t(locale, 'searchPlaceholder')} aria-label={t(locale, 'searchPlaceholder')} autoFocus />{input && <button onClick={() => { setInput(''); setParams({}); }} aria-label={t(locale, 'clearSearch')}><X size={18} /></button>}</div>
    <div className={styles.genreRail}>{genres.data?.items.map((item) => <button key={item.slug} className={genre === item.slug ? styles.genreActive : ''} onClick={() => { setInput(''); setParams({ genre: item.slug }); }}>{item.name}</button>)}</div>
    {results.isLoading && <LoadingState label={t(locale, 'searching')} />}
    {!results.isLoading && items.length > 0 && <section className={styles.results}><div className={styles.resultHeading}><h1>{genre ? genre : `"${query}"`}</h1><span>{items.length} {t(locale, 'stories')}</span></div><div className={styles.grid}>{items.map((album) => <AlbumCard key={album.id} album={album} locale={locale} />)}</div></section>}
    {!results.isLoading && (query || genre) && items.length === 0 && <section className={styles.empty}><h1>{t(locale, 'noResults')}</h1><p>{t(locale, 'tryThese')}</p><div className={styles.grid}>{fallback.map((album) => <AlbumCard key={album.id} album={album} locale={locale} />)}</div></section>}
    {!query && !genre && <section className={styles.empty}><h1>{t(locale, 'findNextStory')}</h1><p>{t(locale, 'searchByTitleMoodGenre')}</p></section>}
  </section>;
}
