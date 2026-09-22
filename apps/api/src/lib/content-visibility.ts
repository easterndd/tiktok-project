import type { FastifyRequest } from 'fastify';
import type { Env } from '../config/env';

/**
 * A local ONLINE flag is not enough to make a drama public in production. The
 * platform publication version is only written by the successful publish or
 * reconciliation transaction.
 */
export function publicAlbumWhere(env: Env): any {
  if (env.NODE_ENV !== 'production' && env.LOCAL_PLAYBACK_ENABLED) return { status: 'ONLINE' };
  return {
    status: 'ONLINE',
    platformPublishedVersion: { not: null },
    onlineVersion: { not: null },
    reviewStatus: 'PASSED',
    publishStatus: 'LISTED'
  };
}

export function isPlatformPublished(album: any, env: Env): boolean {
  if (album.status !== 'ONLINE') return false;
  if (env.NODE_ENV !== 'production' && env.LOCAL_PLAYBACK_ENABLED) return true;
  return album.platformPublishedVersion !== null
    && album.platformPublishedVersion !== undefined
    && album.onlineVersion !== null
    && album.onlineVersion !== undefined
    && album.reviewStatus === 'PASSED'
    && album.publishStatus === 'LISTED';
}

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
