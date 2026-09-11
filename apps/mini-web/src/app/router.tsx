import { createBrowserRouter } from 'react-router-dom';
import { AlbumPage } from '../pages/AlbumPage';
import { HomePage } from '../pages/HomePage';
import { LegalPage } from '../pages/LegalPage';
import { WatchPage } from '../pages/WatchPage';
import { ProfilePage } from '../pages/ProfilePage';
import { SearchPage } from '../pages/SearchPage';
import { App } from './App';

export const router = createBrowserRouter([{ path: '/', element: <App />, children: [
  { index: true, element: <HomePage /> },
  { path: 'search', element: <SearchPage /> },
  { path: 'profile', element: <ProfilePage /> },
  { path: 'album/:albumId', element: <AlbumPage /> },
  { path: 'watch/:albumId/:episodeId', element: <WatchPage /> },
  { path: 'privacy', element: <LegalPage type="privacy" /> },
  { path: 'terms', element: <LegalPage type="terms" /> }
] }]);
