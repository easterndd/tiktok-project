import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppProviders } from './app/providers';
import { router } from './app/router';
import { initializeTikTokMinis } from './lib/ttminis';
import './styles/global.css';

initializeTikTokMinis();
createRoot(document.getElementById('root')!).render(<StrictMode><AppProviders><RouterProvider router={router} /></AppProviders></StrictMode>);
