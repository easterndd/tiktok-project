import type { AlbumSummary, HomeResponse } from '@quickreels/shared-types';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronLeft, ChevronRight, Play, RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlbumCard } from '../components/AlbumCard';
import { LoadingState } from '../components/LoadingState';
import { getMockHome } from '../data/mock-data';
import { apiClient } from '../lib/api-client';
import { t } from '../lib/i18n';
import { useLocale, isDemoMode } from '../lib/storage';
import { componentIsEnabled, useUiComponents } from '../features/cms/ui-components';
import styles from './HomePage.module.css';

function AlbumRail({ title, items, locale }: { title: string; items: AlbumSummary[]; locale: import('@quickreels/shared-types').Locale }) {
  return <section className={styles.section}><div className={styles.sectionHeading}><h2>{title}</h2><Link to="/search">{t(locale, 'seeAll')} <ArrowRight size={15} aria-hidden="true" /></Link></div><div className={styles.rail}>{items.map((album) => <AlbumCard key={album.id} album={album} locale={locale} />)}</div></section>;
}

export function HomePage() {
  const locale = useLocale();
  const navigate = useNavigate();
  const [heroIndex, setHeroIndex] = useState(0);
  const components = useUiComponents();
  const ui = components.data?.items;
  const home = useQuery({ queryKey: ['home', locale], queryFn: () => apiClient.get<HomeResponse>(`/home?locale=${encodeURIComponent(locale)}`), placeholderData: isDemoMode() ? getMockHome(locale) : undefined });
  if (home.isLoading && !home.data) return <LoadingState label={t(locale, 'loadingReel')} />;
  if (home.isError && !home.data) return <section className="state"><p>{t(locale, 'unavailable')}</p><button onClick={() => void home.refetch()}><RefreshCw size={17} aria-hidden="true" /> {t(locale, 'retry')}</button></section>;
  const data = home.data ?? getMockHome(locale);
  const hero = data.blocks.find((block) => block.type === 'CAROUSEL');
  const continueBlock = data.blocks.find((block) => block.type === 'CONTINUE_WATCHING');
  const genres = data.blocks.find((block) => block.type === 'GENRES');
  const trending = data.blocks.find((block) => block.type === 'TRENDING');
  const fresh = data.blocks.find((block) => block.type === 'NEW_RELEASES');
  const heroItems = hero?.type === 'CAROUSEL' ? hero.items : [];
  const currentHero = heroItems[heroIndex % Math.max(heroItems.length, 1)];

  return <div className={styles.page}>
    <div className={styles.statusBar}><span><span className={styles.liveDot} /> {home.isFetching ? t(locale, 'refresh') : (isDemoMode() ? t(locale, 'apiFallback') : t(locale, 'apiConnected'))}</span><button onClick={() => void home.refetch()} aria-label={t(locale, 'refresh')} title={t(locale, 'refresh')}><RefreshCw size={14} aria-hidden="true" /></button></div>
    {currentHero && <section className={styles.hero} style={{ backgroundImage: `url("${currentHero.backdropUrl}")` }}><div className={styles.heroOverlay} /><div className={styles.heroContent}><span className={styles.heroBadge}><Sparkles size={13} aria-hidden="true" /> {currentHero.badge}</span><p className="eyebrow">{t(locale, 'featured')}</p><h1>{currentHero.title}</h1><p className={styles.heroSubtitle}>{currentHero.subtitle}</p><button className={styles.primaryButton} onClick={() => navigate(currentHero.deepLink)}><Play size={17} fill="currentColor" aria-hidden="true" /> {t(locale, 'watchNow')}</button></div>{heroItems.length > 1 && <div className={styles.heroControls}><button onClick={() => setHeroIndex((value) => (value - 1 + heroItems.length) % heroItems.length)} aria-label={t(locale, 'previousFeatured')}><ChevronLeft size={18} /></button><span>{heroIndex + 1} / {heroItems.length}</span><button onClick={() => setHeroIndex((value) => (value + 1) % heroItems.length)} aria-label={t(locale, 'nextFeatured')}><ChevronRight size={18} /></button></div>}</section>}
    {componentIsEnabled(ui, 'HOME_INTRO') && <header className={styles.intro}><div><p className="eyebrow">QUICKREEL</p><h2>{t(locale, 'discover')}</h2><p>{t(locale, 'discoverCopy')}</p></div><Link to="/search" className={styles.roundButton} aria-label={t(locale, 'search')}><ArrowRight size={19} /></Link></header>}
    {continueBlock?.type === 'CONTINUE_WATCHING' && continueBlock.items.length > 0 && <section className={styles.continueCard}><div className={styles.continueCover}><img src={continueBlock.items[0].coverUrl} alt="" onError={(event) => { event.currentTarget.src = '/fallback-cover.svg'; }} /><span><Play size={12} fill="currentColor" aria-hidden="true" /> {continueBlock.items[0].episodeNo}</span></div><div className={styles.continueCopy}><p className="eyebrow">{t(locale, 'continue')}</p><h2>{continueBlock.items[0].title}</h2><p>{t(locale, 'episode')} {continueBlock.items[0].episodeNo} · {Math.round(continueBlock.items[0].progress * 100)}% {t(locale, 'watched')}</p><div className={styles.progress}><span style={{ width: `${continueBlock.items[0].progress * 100}%` }} /></div></div><Link className={styles.continueAction} to={`/watch/${continueBlock.items[0].albumId}/${continueBlock.items[0].episodeId}`} aria-label={t(locale, 'watchNow')}><Play size={19} fill="currentColor" /></Link></section>}
    {genres?.type === 'GENRES' && <section className={styles.section}><div className={styles.sectionHeading}><h2>{t(locale, 'browse')}</h2></div><div className={styles.genreGrid}>{genres.items.map((genre) => <Link key={genre.slug} to={`/search?genre=${genre.slug}`} className={styles.genre} style={{ '--genre-accent': genre.accent } as React.CSSProperties}><span>{genre.name}</span><small>{genre.count} {t(locale, 'stories')}</small><ArrowRight size={16} aria-hidden="true" /></Link>)}</div></section>}
    {trending?.type === 'TRENDING' && <AlbumRail title={t(locale, 'trending')} items={trending.items} locale={locale} />}
    {fresh?.type === 'NEW_RELEASES' && <AlbumRail title={t(locale, 'fresh')} items={fresh.items} locale={locale} />}
    {componentIsEnabled(ui, 'HOME_FEED') && <section className={styles.section}><div className={styles.sectionHeading}><h2>{t(locale, 'moreToWatch')}</h2><span className={styles.resultCount}>{data.feed.items.length} {t(locale, 'stories')}</span></div><div className={styles.feed}>{data.feed.items.map((album) => <AlbumCard key={album.id} album={album} locale={locale} />)}</div></section>}
  </div>;
}
