import { isV006DualRelease, isV006Release } from '../features/ads/ad-platform';

const activationKey = 'quickreels_debug_panel_active';
const debugPanelBuildEnabled = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_DEBUG_PANEL === 'true';

export function debugPanelAvailable() {
  return debugPanelBuildEnabled || isV006Release();
}

export function debugPanelActive() {
  if (debugPanelBuildEnabled) return true;
  if (!isV006Release()) return false;
  try { return sessionStorage.getItem(activationKey) === 'true'; }
  catch { return false; }
}

export function debugRecordCaptureEnabled() {
  return debugPanelActive() || isV006DualRelease();
}

export function activateDebugPanel() {
  if (!debugPanelAvailable()) return;
  try { sessionStorage.setItem(activationKey, 'true'); }
  catch { /* The route still works when storage is unavailable. */ }
}
