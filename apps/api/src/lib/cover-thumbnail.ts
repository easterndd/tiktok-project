export function coverThumbnailUrl(url: string): string;
export function coverThumbnailUrl(url: string | null): string | null;
export function coverThumbnailUrl(url: string | null): string | null {
  if (!url) return url;
  if (!/^https:\/\/api\.evergreenprosper\.com\/api\/v1\/assets\/covers\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(url)) return url;
  return `${url}.w360.webp`;
}
