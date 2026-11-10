import { isV006Release } from '../features/ads/ad-platform';

const activationKey = 'quickreels_debug_panel_active';

export function debugPanelAvailable() {
  return import.meta.env.VITE_DEBUG_PANEL === 'true' || isV006Release();
}

export function debugPanelActive() {
  if (import.meta.env.VITE_DEBUG_PANEL === 'true') return true;
  if (!isV006Release()) return false;
  try { return sessionStorage.getItem(activationKey) === 'true'; }
  catch { return false; }
}

export function activateDebugPanel() {
  if (!debugPanelAvailable()) return;
  try { sessionStorage.setItem(activationKey, 'true'); }
  catch { /* The route still works when storage is unavailable. */ }
}
