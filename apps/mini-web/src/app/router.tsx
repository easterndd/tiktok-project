import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AlbumPage } from '../pages/AlbumPage';
import { FavoritesPage } from '../pages/FavoritesPage';
import { HomePage } from '../pages/HomePage';
import { LegalPage } from '../pages/LegalPage';
import { WatchPage } from '../pages/WatchPage';
import { ProfilePage } from '../pages/ProfilePage';
import { App } from './App';

export const router = createBrowserRouter([{ path: '/', element: <App />, children: [
  { index: true, element: <HomePage /> },
  { path: 'search', element: <Navigate to="/?search=1" replace /> },
  { path: 'profile', element: <ProfilePage /> },
  { path: 'favorites', element: <FavoritesPage /> },
  { path: 'album/:albumId', element: <AlbumPage /> },
  { path: 'watch/:albumId', element: <WatchPage /> },
  { path: 'watch/:albumId/:episodeId', element: <WatchPage /> },
  { path: 'privacy', element: <LegalPage type="privacy" /> },
  { path: 'terms', element: <LegalPage type="terms" /> }
] }]);
