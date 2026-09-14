import type { FastifyRequest } from 'fastify';

/**
 * Region metadata is an allow-list. A missing region list means worldwide;
 * an empty or malformed list never grants access. The country header is only
 * honored after the deployment proxy has been configured to overwrite it.
 */
export function requestCountry(request: FastifyRequest, trustGeoCountryHeader: boolean): string | null {
  if (!trustGeoCountryHeader) return null;
  const value = request.headers['x-geo-country'];
  const country = (Array.isArray(value) ? value[0] : value)?.trim().toUpperCase();
  return country && /^[A-Z]{2}$/.test(country) ? country : null;
}

export function isAlbumVisibleInCountry(regions: unknown, country: string | null): boolean {
  if (regions === null || regions === undefined) return true;
  if (!Array.isArray(regions) || !country) return false;
  return regions.some((region) => typeof region === 'string' && region.trim().toUpperCase() === country);
}
