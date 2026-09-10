export function initializeTikTokMinis() {
  const clientKey = import.meta.env.VITE_TIKTOK_CLIENT_KEY;
  if (clientKey && window.TTMinis) window.TTMinis.init({ clientKey });
}

export function hasTikTokMinis() {
  return Boolean(window.TTMinis);
}
