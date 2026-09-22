import type { AlbumSummary, HomeResponse, SearchResponse } from '@quickreels/shared-types';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Flame, Play, RefreshCw, Search as SearchIcon, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlbumCard } from '../components/AlbumCard';
import { LoadingState } from '../components/LoadingState';
import { getMockHome } from '../data/mock-data';
import { apiClient } from '../lib/api-client';
import { t } from '../lib/i18n';
import { useLocale, isDemoMode } from '../lib/storage';
import { componentIsEnabled, useUiComponents } from '../features/cms/ui-components';
import styles from './HomePage.module.css';

function AlbumGrid({ title, items, locale }: { title: string; items: AlbumSummary[]; locale: import('@quickreels/shared-types').Locale }) {
  return <section className={styles.section}><div className={styles.sectionHeading}><h2>{title}</h2><span>{items.length} {t(locale, 'stories')}</span></div><div className={styles.posterGrid}>{items.map((album) => <AlbumCard key={album.id} album={album} locale={locale} presentation="poster" />)}</div></section>;
}

export function HomePage() {
  const locale = useLocale();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [heroIndex, setHeroIndex] = useState(0);
  const [searchInput, setSearchInput] = useState(params.get('q') ?? '');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const components = useUiComponents();
  const ui = components.data?.items;
  const query = params.get('q')?.trim() ?? '';
  const requestedChannel = params.get('channel');
  const activeChannel = requestedChannel === 'new' ? 'new' : 'hot';
  const isSearchOpen = params.get('search') === '1' || Boolean(query);
  const home = useQuery({ queryKey: ['home', locale], queryFn: () => apiClient.get<HomeResponse>(`/home?locale=${encodeURIComponent(locale)}`), placeholderData: isDemoMode() ? getMockHome(locale) : undefined });
  const search = useQuery({
    queryKey: ['home-search', query, locale],
    queryFn: () => apiClient.get<SearchResponse>(`/search?q=${encodeURIComponent(query)}&locale=${encodeURIComponent(locale)}&limit=30`),
    enabled: Boolean(query)
  });

  useEffect(() => {
    if (!isSearchOpen) return;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isSearchOpen]);

  useEffect(() => {
    if (!isSearchOpen) return;
    const timer = window.setTimeout(() => {
      const value = searchInput.trim();
      if (value === query) return;
      const next = new URLSearchParams(params);
      next.set('search', '1');
      if (value) next.set('q', value);
      else next.delete('q');
      setParams(next, { replace: true });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [isSearchOpen, params, query, searchInput, setParams]);

  const data = home.data ?? getMockHome(locale);
  const hero = data.blocks.find((block) => block.type === 'CAROUSEL');
  const continueBlock = data.blocks.find((block) => block.type === 'CONTINUE_WATCHING');
  const trending = data.blocks.find((block) => block.type === 'TRENDING');
  const fresh = data.blocks.find((block) => block.type === 'NEW_RELEASES');
  const hotItems = trending?.type === 'TRENDING' ? trending.items : data.feed.items;
  const channelItems = activeChannel === 'new' ? (fresh?.type === 'NEW_RELEASES' ? fresh.items : hotItems) : hotItems;
  const channelTitle = activeChannel === 'new' ? t(locale, 'fresh') : t(locale, 'trending');
  const heroItems = hero?.type === 'CAROUSEL' ? hero.items : [];
  const currentHero = heroItems[heroIndex % Math.max(heroItems.length, 1)];
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  const [heroVideoFailed, setHeroVideoFailed] = useState(false);
  const [heroVideoReady, setHeroVideoReady] = useState(false);
  const heroPreviewUrl = currentHero?.previewUrl
    ?? (heroIndex === 0 ? import.meta.env.VITE_HOME_PREVIEW_URL as string | undefined : undefined)
    ?? (import.meta.env.DEV && currentHero?.albumId === 'local-playback-album' ? '/local-test-media/while-my-fiance-knocked-episode-1.mp4' : undefined);
  const isFiltering = Boolean(query);
  const searchItems = search.data?.items ?? [];
  const fallbackItems = search.data?.fallbackItems ?? [];
  const closeSearch = () => {
    setSearchInput('');
    const next = new URLSearchParams(params);
    next.delete('search');
    next.delete('q');
    setParams(next, { replace: true });
  };
  const selectChannel = (channel: 'hot' | 'new') => {
    setSearchInput('');
    const next = new URLSearchParams(params);
    if (channel === 'new') next.set('channel', 'new');
    else next.delete('channel');
    next.delete('search');
    next.delete('q');
    setParams(next, { replace: true });
  };

  useEffect(() => { setHeroVideoFailed(false); setHeroVideoReady(false); }, [currentHero?.albumId, heroPreviewUrl]);

  useEffect(() => {
    if (!heroPreviewUrl) return;
    const syncPreviewPlayback = () => {
      const video = heroVideoRef.current;
      if (!video) return;
      if (document.visibilityState === 'hidden') {
        video.pause();
        return;
      }
      void video.play().catch(() => undefined);
    };
    syncPreviewPlayback();
    document.addEventListener('visibilitychange', syncPreviewPlayback);
    return () => document.removeEventListener('visibilitychange', syncPreviewPlayback);
  }, [heroPreviewUrl, currentHero?.albumId]);

  useEffect(() => {
    if (activeChannel !== 'hot' || heroItems.length < 2 || isFiltering || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setHeroIndex((value) => (value + 1) % heroItems.length), 7_000);
    return () => window.clearInterval(timer);
  }, [activeChannel, heroItems.length, isFiltering]);

  if (home.isLoading && !home.data) return <LoadingState label={t(locale, 'loadingReel')} />;
  if (home.isError && !home.data) return <section className="state"><p>{t(locale, 'unavailable')}</p><button onClick={() => void home.refetch()}><RefreshCw size={17} aria-hidden="true" /> {t(locale, 'retry')}</button></section>;

  return <div className={styles.page}>
    <section className={styles.discoveryHeader} aria-label={t(locale, 'discover')}>
      <nav className={styles.channelRail} aria-label={t(locale, 'discover')}>
        <button className={activeChannel === 'hot' ? styles.channelActive : ''} onClick={() => selectChannel('hot')}><Flame size={16} aria-hidden="true" />{t(locale, 'trending')}</button>
        <button className={activeChannel === 'new' ? styles.channelActive : ''} onClick={() => selectChannel('new')}><Sparkles size={16} aria-hidden="true" />{t(locale, 'fresh')}</button>
      </nav>
      {isSearchOpen && <form className={styles.searchBox} onSubmit={(event) => event.preventDefault()}><SearchIcon size={18} aria-hidden="true" /><input ref={searchInputRef} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t(locale, 'searchPlaceholder')} aria-label={t(locale, 'searchPlaceholder')} /><button type="button" onClick={closeSearch} aria-label={t(locale, 'clearSearch')}><X size={18} /></button></form>}
    </section>
    {isFiltering ? <section className={styles.results} aria-live="polite">
      <div className={styles.sectionHeading}><h1>“{query}”</h1><span>{search.isFetching ? t(locale, 'searching') : `${searchItems.length} ${t(locale, 'stories')}`}</span></div>
      {search.isLoading ? <LoadingState label={t(locale, 'searching')} /> : searchItems.length ? <div className={styles.posterGrid}>{searchItems.map((album) => <AlbumCard key={album.id} album={album} locale={locale} presentation="poster" />)}</div> : <div className={styles.emptyResults}><h2>{t(locale, 'noResults')}</h2><p>{t(locale, 'tryThese')}</p>{fallbackItems.length > 0 && <div className={styles.posterGrid}>{fallbackItems.map((album) => <AlbumCard key={album.id} album={album} locale={locale} presentation="poster" />)}</div>}</div>}
    </section> : <>
      {activeChannel === 'hot' && currentHero && <section className={styles.hero} style={{ backgroundImage: `url("${currentHero.backdropUrl}")` }}><div className={styles.heroMedia} aria-hidden="true">{heroPreviewUrl && !heroVideoFailed && <video key={currentHero.albumId} ref={heroVideoRef} className={`${styles.heroVideo} ${heroVideoReady ? styles.heroVideoReady : ''}`} src={heroPreviewUrl} poster={currentHero.backdropUrl} muted autoPlay loop playsInline preload="metadata" onCanPlay={() => setHeroVideoReady(true)} onError={() => setHeroVideoFailed(true)} />}</div><div className={styles.heroOverlay} /><div className={styles.heroContent}><span className={styles.heroBadge}><Sparkles size={12} aria-hidden="true" /> {currentHero.badge ?? t(locale, 'trending')}</span><p className="eyebrow">{t(locale, 'trending')}</p><h1>{currentHero.title}</h1><p className={styles.heroSubtitle}>{currentHero.subtitle}</p><button className={styles.primaryButton} onClick={() => navigate(currentHero.albumId ? `/watch/${currentHero.albumId}` : currentHero.deepLink)}><Play size={16} fill="currentColor" aria-hidden="true" /> {t(locale, 'watchNow')}</button></div>{heroItems.length > 1 && <div className={styles.heroControls}><button onClick={() => setHeroIndex((value) => (value - 1 + heroItems.length) % heroItems.length)} aria-label={t(locale, 'previousFeatured')}><ChevronLeft size={17} /></button><span>{heroIndex + 1} / {heroItems.length}</span><button onClick={() => setHeroIndex((value) => (value + 1) % heroItems.length)} aria-label={t(locale, 'nextFeatured')}><ChevronRight size={17} /></button></div>}</section>}
      {activeChannel === 'hot' && continueBlock?.type === 'CONTINUE_WATCHING' && continueBlock.items.length > 0 && <section className={styles.continueCard}><div className={styles.continueCover}><img src={continueBlock.items[0].coverUrl} alt="" onError={(event) => { event.currentTarget.src = '/fallback-cover.svg'; }} /><span><Play size={12} fill="currentColor" aria-hidden="true" /> {continueBlock.items[0].episodeNo}</span></div><div className={styles.continueCopy}><p className="eyebrow">{t(locale, 'continue')}</p><h2>{continueBlock.items[0].title}</h2><p>{t(locale, 'episode')} {continueBlock.items[0].episodeNo} · {Math.round(continueBlock.items[0].progress * 100)}% {t(locale, 'watched')}</p><div className={styles.progress}><span style={{ width: `${continueBlock.items[0].progress * 100}%` }} /></div></div><Link className={styles.continueAction} to={`/watch/${continueBlock.items[0].albumId}/${continueBlock.items[0].episodeId}`} aria-label={t(locale, 'watchNow')}><Play size={18} fill="currentColor" /></Link></section>}
      <AlbumGrid title={channelTitle} items={channelItems} locale={locale} />
      {activeChannel === 'hot' && componentIsEnabled(ui, 'HOME_FEED') && <AlbumGrid title={t(locale, 'moreToWatch')} items={data.feed.items} locale={locale} />}
    </>}
  </div>;
}
