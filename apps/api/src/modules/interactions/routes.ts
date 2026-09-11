import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth';
import { optionalUser } from '../../plugins/optional-auth';

const albumParams = z.object({ albumId: z.string().min(1).max(128) });
const activeBody = z.object({ active: z.boolean() });

async function state(app: FastifyInstance, albumId: string, userId: string) {
  const [liked, favorited, likeCount, favoriteCount, shareCount] = await Promise.all([
    app.prisma.albumLike.findUnique({ where: { userId_albumId: { userId, albumId } } }),
    app.prisma.albumFavorite.findUnique({ where: { userId_albumId: { userId, albumId } } }),
    app.prisma.albumLike.count({ where: { albumId } }),
    app.prisma.albumFavorite.count({ where: { albumId } }),
    app.prisma.shareEvent.count({ where: { albumId } })
  ]);
  return { liked: Boolean(liked), favorited: Boolean(favorited), likeCount, favoriteCount, shareCount };
}

export async function registerInteractionRoutes(app: FastifyInstance) {
  app.put('/albums/:albumId/like', { preHandler: requireUser }, async (request) => {
    const { albumId } = albumParams.parse(request.params);
    const { active } = activeBody.parse(request.body);
    const album = await app.prisma.album.findFirst({ where: { id: albumId, status: 'ONLINE' }, select: { id: true } });
    if (!album) throw Object.assign(new Error('Album not found.'), { statusCode: 404 });
    if (active) await app.prisma.albumLike.upsert({ where: { userId_albumId: { userId: request.user.sub, albumId } }, create: { userId: request.user.sub, albumId }, update: {} });
    else await app.prisma.albumLike.deleteMany({ where: { userId: request.user.sub, albumId } });
    return state(app, albumId, request.user.sub);
  });
  app.put('/albums/:albumId/favorite', { preHandler: requireUser }, async (request) => {
    const { albumId } = albumParams.parse(request.params);
    const { active } = activeBody.parse(request.body);
    const album = await app.prisma.album.findFirst({ where: { id: albumId, status: 'ONLINE' }, select: { id: true } });
    if (!album) throw Object.assign(new Error('Album not found.'), { statusCode: 404 });
    if (active) await app.prisma.albumFavorite.upsert({ where: { userId_albumId: { userId: request.user.sub, albumId } }, create: { userId: request.user.sub, albumId }, update: {} });
    else await app.prisma.albumFavorite.deleteMany({ where: { userId: request.user.sub, albumId } });
    return state(app, albumId, request.user.sub);
  });
  app.post('/albums/:albumId/share', async (request) => {
    const { albumId } = albumParams.parse(request.params);
    const user = await optionalUser(request);
    const body = z.object({ channel: z.string().min(1).max(32).default('copy_link') }).parse(request.body ?? {});
    const album = await app.prisma.album.findFirst({ where: { id: albumId, status: 'ONLINE' } });
    if (!album) throw Object.assign(new Error('Album not found.'), { statusCode: 404 });
    const deepLink = `/album/${albumId}`;
    await app.prisma.shareEvent.create({ data: { albumId, userId: user?.sub, channel: body.channel, deepLink } });
    return { deepLink, title: album.title, coverUrl: album.coverUrl, shareCount: await app.prisma.shareEvent.count({ where: { albumId } }) };
  });
}
