import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppProviders } from './app/providers';
import { router } from './app/router';
import { initializeTikTokMinis } from './lib/ttminis';
import { installDiagnostics, reportDiagnostic } from './lib/diagnostics';
import './styles/global.css';

installDiagnostics();
try { initializeTikTokMinis(); } catch (error) {
  reportDiagnostic({ kind: 'STARTUP', phase: 'SDK_INIT', message: error instanceof Error ? error.message : String(error) });
  throw error;
}
createRoot(document.getElementById('root')!).render(<StrictMode><AppProviders><RouterProvider router={router} /></AppProviders></StrictMode>);
