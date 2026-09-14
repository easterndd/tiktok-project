import type {
  AlbumDetail,
  AlbumSummary,
  EpisodeSummary,
  Genre,
  HistoryItem,
  HomeResponse,
  Locale,
  Preferences,
  SearchResponse
} from '@quickreels/shared-types';
import { defaultUiComponents } from '../features/cms/defaults';
import { t, translateGenre } from '../lib/i18n';

const image = (id: string, width = 720, height = 960) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&h=${height}&q=86`;

export const mockAlbums: AlbumSummary[] = [
  { id: 'album-midnight', title: 'Midnight Contract', description: 'A struggling designer signs a dangerous contract with the heir she swore to avoid.', coverUrl: image('photo-1517841905240-472988babdf9'), backdropUrl: image('photo-1517841905240-472988babdf9', 1200, 760), episodeCount: 48, updatedAt: '2026-09-09T08:00:00.000Z', genres: ['Romance', 'Revenge'], language: 'en', rating: 9.4, views: 12_800_000, progress: 0.42, status: 'ONLINE' },
  { id: 'album-heiress', title: 'The Hidden Heiress', description: 'She returns under a new name to reclaim a family empire and the love she left behind.', coverUrl: image('photo-1508214751196-bcfd4ca60f91'), backdropUrl: image('photo-1508214751196-bcfd4ca60f91', 1200, 760), episodeCount: 62, updatedAt: '2026-09-08T09:30:00.000Z', genres: ['Drama', 'Identity'], language: 'en', rating: 9.1, views: 9_600_000, status: 'ONLINE' },
  { id: 'album-after-vows', title: 'After the Vows', description: 'A marriage of convenience starts to feel real when an old secret threatens everything.', coverUrl: image('photo-1494790108377-be9c29b29330'), backdropUrl: image('photo-1494790108377-be9c29b29330', 1200, 760), episodeCount: 36, updatedAt: '2026-09-07T12:00:00.000Z', genres: ['Romance', 'Marriage'], language: 'en', rating: 8.9, views: 7_200_000, status: 'ONLINE' },
  { id: 'album-shadow', title: 'Shadow Witness', description: 'The only witness to a city-wide conspiracy has one night to decide who deserves the truth.', coverUrl: image('photo-1534528741775-53994a69daeb'), backdropUrl: image('photo-1534528741775-53994a69daeb', 1200, 760), episodeCount: 40, updatedAt: '2026-09-06T15:20:00.000Z', genres: ['Thriller', 'Mystery'], language: 'en', rating: 9.0, views: 6_900_000, status: 'ONLINE' },
  { id: 'album-wolf', title: 'Marked by the Alpha', description: 'An accidental bond pulls a fearless doctor into a hidden world ruled by loyalty and instinct.', coverUrl: image('photo-1524504388940-b1c1722653e1'), backdropUrl: image('photo-1524504388940-b1c1722653e1', 1200, 760), episodeCount: 55, updatedAt: '2026-09-05T10:15:00.000Z', genres: ['Fantasy', 'Romance'], language: 'en', rating: 9.3, views: 15_400_000, status: 'ONLINE' },
  { id: 'album-second-chance', title: 'Seven Days to Us', description: 'Two former best friends get seven days to save the seaside hotel that once brought them together.', coverUrl: image('photo-1524250502761-1ac6f2e30d43'), backdropUrl: image('photo-1524250502761-1ac6f2e30d43', 1200, 760), episodeCount: 32, updatedAt: '2026-09-04T07:45:00.000Z', genres: ['Feel-good', 'Romance'], language: 'en', rating: 8.8, views: 5_100_000, status: 'ONLINE' },
  { id: 'album-boardroom', title: 'Queen of the Boardroom', description: 'An underestimated strategist walks into a hostile takeover with a plan nobody sees coming.', coverUrl: image('photo-1531123897727-8f129e1688ce'), backdropUrl: image('photo-1531123897727-8f129e1688ce', 1200, 760), episodeCount: 44, updatedAt: '2026-09-03T14:00:00.000Z', genres: ['Power', 'Revenge'], language: 'en', rating: 9.2, views: 8_800_000, status: 'ONLINE' },
  { id: 'album-last-call', title: 'Last Call for Love', description: 'A late-night radio host helps strangers find love while quietly losing faith in her own.', coverUrl: image('photo-1544005313-94ddf0286df2'), backdropUrl: image('photo-1544005313-94ddf0286df2', 1200, 760), episodeCount: 28, updatedAt: '2026-09-02T11:30:00.000Z', genres: ['Romance', 'City'], language: 'en', rating: 8.7, views: 4_600_000, status: 'ONLINE' }
];

export const mockGenres: Genre[] = [
  { slug: 'romance', name: 'Romance', count: 24, accent: '#ff4d6d' },
  { slug: 'revenge', name: 'Revenge', count: 16, accent: '#f59e0b' },
  { slug: 'fantasy', name: 'Fantasy', count: 12, accent: '#8b5cf6' },
  { slug: 'thriller', name: 'Thriller', count: 10, accent: '#38bdf8' },
  { slug: 'power', name: 'Power', count: 8, accent: '#22c55e' }
];

const titles: Partial<Record<Locale, Record<string, string>>> = {
  pt: { 'album-midnight': 'Contrato da Meia-Noite', 'album-heiress': 'A Herdeira Oculta', 'album-after-vows': 'Depois dos Votos', 'album-shadow': 'Testemunha das Sombras', 'album-wolf': 'Marcada pelo Alfa', 'album-second-chance': 'Sete Dias para Nos', 'album-boardroom': 'Rainha da Diretoria', 'album-last-call': 'Ultima Chamada para o Amor' },
  fr: { 'album-midnight': 'Contrat de Minuit', 'album-heiress': 'La Heritiere Secrete', 'album-after-vows': 'Apres les Voeux', 'album-shadow': 'Temoin des Ombres', 'album-wolf': 'Marquee par l Alpha', 'album-second-chance': 'Sept Jours pour Nous', 'album-boardroom': 'Reine du Conseil', 'album-last-call': 'Dernier Appel pour l Amour' },
  id: { 'album-midnight': 'Kontrak Tengah Malam', 'album-heiress': 'Pewaris Tersembunyi', 'album-after-vows': 'Setelah Janji Pernikahan', 'album-shadow': 'Saksi Bayangan', 'album-wolf': 'Ditandai Sang Alfa', 'album-second-chance': 'Tujuh Hari untuk Kita', 'album-boardroom': 'Ratu Ruang Rapat', 'album-last-call': 'Panggilan Terakhir untuk Cinta' },
  ja: { 'album-midnight': '真夜中の契約', 'album-heiress': '隠された令嬢', 'album-after-vows': '誓いのあとで', 'album-shadow': '影の証人', 'album-wolf': 'アルファに選ばれて', 'album-second-chance': '私たちの7日間', 'album-boardroom': '会議室の女王', 'album-last-call': '恋のラストコール' },
  es: { 'album-midnight': 'Contrato de Medianoche', 'album-heiress': 'La Heredera Oculta', 'album-after-vows': 'Despues de los Votos', 'album-shadow': 'Testigo de las Sombras', 'album-wolf': 'Marcada por el Alfa', 'album-second-chance': 'Siete Dias para Nosotros', 'album-boardroom': 'Reina de la Sala', 'album-last-call': 'Ultima Llamada al Amor' },
  ko: { 'album-midnight': '한밤의 계약', 'album-heiress': '숨겨진 상속녀', 'album-after-vows': '서약 그 후', 'album-shadow': '그림자의 목격자', 'album-wolf': '알파에게 선택되다', 'album-second-chance': '우리에게 남은 7일', 'album-boardroom': '회의실의 여왕', 'album-last-call': '사랑의 마지막 전화' },
  th: { 'album-midnight': 'สัญญาเที่ยงคืน', 'album-heiress': 'ทายาทที่ถูกซ่อน', 'album-after-vows': 'หลังคำสาบาน', 'album-shadow': 'พยานแห่งเงามืด', 'album-wolf': 'ตราประทับของอัลฟ่า', 'album-second-chance': 'เจ็ดวันของเรา', 'album-boardroom': 'ราชินีแห่งห้องประชุม', 'album-last-call': 'สายสุดท้ายแห่งรัก' }
};
const descriptions: Partial<Record<Locale, Record<string, string>>> = {
  pt: { 'album-midnight': 'Uma designer em dificuldades assina um contrato perigoso com o herdeiro que jurou evitar.', 'album-heiress': 'Ela volta com um novo nome para recuperar um imperio familiar e o amor que deixou para tras.' },
  fr: { 'album-midnight': 'Une designer en difficulte signe un contrat dangereux avec l heritier qu elle voulait eviter.', 'album-heiress': 'Elle revient sous un nouveau nom pour reprendre un empire familial et l amour perdu.' },
  id: { 'album-midnight': 'Seorang desainer yang kesulitan menandatangani kontrak berbahaya dengan pewaris yang ingin ia hindari.', 'album-heiress': 'Ia kembali dengan nama baru untuk merebut kembali kerajaan keluarga dan cinta yang ditinggalkan.' },
  ja: { 'album-midnight': '苦境にいるデザイナーは、避けていた後継者と危険な契約を結ぶ。', 'album-heiress': '彼女は新しい名前で戻り、家業と置き去りにした愛を取り戻そうとする。' },
  es: { 'album-midnight': 'Una disenadora en apuros firma un contrato peligroso con el heredero que juro evitar.', 'album-heiress': 'Regresa con un nombre nuevo para recuperar un imperio familiar y el amor que dejo atras.' },
  ko: { 'album-midnight': '힘든 디자이너가 피하려 했던 후계자와 위험한 계약을 맺는다.', 'album-heiress': '그녀는 새 이름으로 돌아와 가문과 떠나보낸 사랑을 되찾으려 한다.' },
  th: { 'album-midnight': 'ดีไซเนอร์ที่กำลังลำบากเซ็นสัญญาอันตรายกับทายาทที่เธอพยายามหลีกหนี', 'album-heiress': 'เธอกลับมาในชื่อใหม่เพื่อทวงคืนอาณาจักรครอบครัวและความรักที่จากมา' }
};
function localizedAlbum(album: AlbumSummary, locale: Locale): AlbumSummary {
  return { ...album, title: titles[locale]?.[album.id] ?? album.title, description: descriptions[locale]?.[album.id] ?? album.description };
}
function localizedAlbums(locale: Locale) { return mockAlbums.map((album) => localizedAlbum(album, locale)); }
function localizedGenres(locale: Locale) { return mockGenres.map((genre) => ({ ...genre, name: translateGenre(locale, genre.slug) })); }

export function getMockEpisodes(albumId: string, locale: Locale = 'en'): EpisodeSummary[] {
  const album = mockAlbums.find((item) => item.id === albumId) ?? mockAlbums[0];
  const unlocked = readStringSet('quickreels_mock_unlocked');
  return Array.from({ length: Math.min(album.episodeCount, 18) }, (_, index) => {
    const episodeNo = index + 1;
    const id = `${album.id}-episode-${episodeNo}`;
    const progress = episodeNo === 4 && album.id === 'album-midnight' ? 0.42 : 0;
    return {
      id,
      episodeNo,
      title: locale === 'pt' ? (episodeNo === 1 ? 'A Oferta Inesperada' : episodeNo === 2 ? 'Termos e Condicoes' : `Episodio ${episodeNo}`) : locale === 'fr' ? (episodeNo === 1 ? 'L Offre Inattendue' : episodeNo === 2 ? 'Termes et Conditions' : `Episode ${episodeNo}`) : locale === 'id' ? (episodeNo === 1 ? 'Tawaran Tak Terduga' : episodeNo === 2 ? 'Syarat dan Ketentuan' : `Episode ${episodeNo}`) : locale === 'ja' ? (episodeNo === 1 ? '予想外の申し出' : episodeNo === 2 ? '条件と契約' : `第${episodeNo}話`) : locale === 'es' ? (episodeNo === 1 ? 'La Oferta Inesperada' : episodeNo === 2 ? 'Terminos y Condiciones' : `Episodio ${episodeNo}`) : locale === 'ko' ? (episodeNo === 1 ? '뜻밖의 제안' : episodeNo === 2 ? '약관과 조건' : `${episodeNo}화`) : locale === 'th' ? (episodeNo === 1 ? 'ข้อเสนอที่ไม่คาดคิด' : episodeNo === 2 ? 'ข้อกำหนดและเงื่อนไข' : `ตอนที่ ${episodeNo}`) : episodeNo === 1 ? 'The Unexpected Offer' : episodeNo === 2 ? 'Terms and Conditions' : `Episode ${episodeNo}`,
      durationMs: 86_000 + (index % 4) * 4_000,
      isFree: episodeNo <= 3,
      access: episodeNo <= 3 || unlocked.has(id) ? 'PLAYABLE' : 'REWARDED_AD_REQUIRED',
      progress,
      resumePositionMs: progress ? 38_000 : 0,
      completed: false
    };
  });
}

export function getMockAlbum(albumId: string, locale: Locale = 'en'): AlbumDetail | undefined {
  const album = mockAlbums.find((item) => item.id === albumId);
  if (!album) return undefined;
  return {
    ...localizedAlbum(album, locale),
    language: album.language ?? 'en',
    regions: null,
    tags: album.genres?.map((genre) => translateGenre(locale, genre)),
    likeCount: 128_000 + album.episodeCount * 137,
    favoriteCount: 34_000 + album.episodeCount * 61,
    shareCount: 8_200 + album.episodeCount * 17,
    userState: {
      liked: readStringSet('quickreels_mock_likes').has(albumId),
      favorited: readStringSet('quickreels_mock_favorites').has(albumId)
    }
  };
}

export function getMockHome(locale: Locale): HomeResponse {
  const albums = localizedAlbums(locale);
  return {
    locale,
    cacheVersion: 'home_2026-09-10T12:00:00Z',
    components: defaultUiComponents,
    blocks: [
      { type: 'CONTINUE_WATCHING', title: locale === 'en' ? 'Continue watching' : locale === 'pt' ? 'Continuar assistindo' : locale === 'fr' ? 'Continuer a regarder' : locale === 'ja' ? '視聴を続ける' : locale === 'ko' ? '이어서 보기' : locale === 'th' ? 'ดูต่อ' : locale === 'es' ? 'Continuar viendo' : 'Lanjut menonton', items: [{ albumId: 'album-midnight', episodeId: 'album-midnight-episode-4', episodeNo: 4, title: albums[0].title, coverUrl: albums[0].coverUrl, progress: 0.42, resumePositionMs: 38_000, durationMs: 90_000 }] },
      { type: 'CAROUSEL', title: locale === 'en' ? 'Featured' : locale === 'pt' ? 'Em destaque' : locale === 'fr' ? 'A la une' : locale === 'ja' ? 'おすすめ' : locale === 'ko' ? '추천' : locale === 'th' ? 'แนะนำ' : locale === 'es' ? 'Destacados' : 'Pilihan', items: albums.slice(0, 3).map((album, index) => ({ albumId: album.id, title: album.title, subtitle: album.description, coverUrl: album.coverUrl, backdropUrl: album.backdropUrl ?? album.coverUrl, deepLink: `/album/${album.id}`, badge: index === 0 ? 'NEW EPISODES' : 'EDITOR PICK' })) },
      { type: 'GENRES', title: t(locale, 'browse'), items: localizedGenres(locale) },
      { type: 'TRENDING', title: t(locale, 'trending'), items: albums.slice(0, 5) },
      { type: 'NEW_RELEASES', title: t(locale, 'fresh'), items: albums.slice(3, 8) }
    ],
    feed: { items: albums, nextCursor: null }
  };
}

export function searchMockAlbums(query: string, locale: Locale = 'en'): SearchResponse {
  const normalized = query.trim().toLowerCase();
  const albums = localizedAlbums(locale);
  const items = normalized ? albums.filter((album) => `${album.title} ${album.description} ${(album.genres ?? []).join(' ')}`.toLowerCase().includes(normalized)) : [];
  return { query, items, nextCursor: null, fallbackItems: items.length ? [] : albums.slice(0, 4) };
}

export function getMockHistory(locale: Locale = 'en'): HistoryItem[] {
  const albums = localizedAlbums(locale);
  return [
    { ...albums[0], episodeId: 'album-midnight-episode-4', episodeNo: 4, episodeTitle: getMockEpisodes('album-midnight', locale)[3].title, progress: 0.42, resumePositionMs: 38_000, durationMs: 90_000, watchedAt: '2026-09-10T10:25:00.000Z' },
    { ...albums[4], episodeId: 'album-wolf-episode-2', episodeNo: 2, episodeTitle: getMockEpisodes('album-wolf', locale)[1].title, progress: 0.76, resumePositionMs: 68_000, durationMs: 90_000, watchedAt: '2026-09-09T18:12:00.000Z' }
  ];
}

export function readPreferences(): Preferences {
  const raw = localStorage.getItem('quickreels_preferences');
  if (!raw) return { locale: 'en', autoplay: true, reducedData: false };
  try {
    const preferences = { locale: 'en', autoplay: true, reducedData: false, ...JSON.parse(raw) } as Preferences & { locale: string };
    if (!['en', 'pt', 'fr', 'id', 'ja', 'es', 'ko', 'th'].includes(preferences.locale)) preferences.locale = 'en';
    return preferences as Preferences;
  } catch {
    return { locale: 'en', autoplay: true, reducedData: false };
  }
}

export function writePreferences(preferences: Preferences) {
  localStorage.setItem('quickreels_preferences', JSON.stringify(preferences));
}

export function readStringSet(key: string): Set<string> {
  try { return new Set<string>(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { return new Set<string>(); }
}

export function writeStringSet(key: string, values: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...values]));
}
