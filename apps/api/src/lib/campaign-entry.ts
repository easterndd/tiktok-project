export const campaignEntryApps = new Set(['bloomreel', 'quillshort', 'amberplay', 'nimbusclip', 'runereel']);

export function normalizeCampaignEntryBase(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || !['tiktok.com', 'www.tiktok.com'].includes(url.hostname.toLowerCase())
    || !/^\/minis\/[A-Za-z0-9_-]{5,}\/?$/.test(url.pathname)
    || /\/minis\/(?:undefined|placeholder|example|test)(?:\/|$)/i.test(url.pathname)
    || url.username || url.password || url.hash) {
    throw new Error('Provide the verified TikTok Minis link for this app.');
  }
  url.searchParams.delete('album_id');
  url.searchParams.delete('episode_id');
  return url.toString();
}
