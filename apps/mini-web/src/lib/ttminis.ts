export function initializeTikTokMinis() {
  const clientKey = import.meta.env.VITE_TIKTOK_CLIENT_KEY;
  if (!clientKey || !window.TTMinis) return;
  try {
    window.TTMinis.init({ clientKey });
  } catch (error) {
    // The preview runtime may inject an unavailable or outdated SDK. Keep the
    // application usable so entry-ad fallback policy can decide the next step.
    console.error('TikTok Minis SDK initialization failed.', error);
  }
}

export function hasTikTokMinis() {
  return Boolean(window.TTMinis);
}
