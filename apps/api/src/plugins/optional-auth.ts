import type { FastifyRequest } from 'fastify';

export async function optionalUser(request: FastifyRequest) {
  try {
    await request.jwtVerify();
    if (request.user.kind !== 'user' || request.user.appKey !== request.server.config.MINI_APP_KEY) return null;
    return request.user;
  } catch {
    return null;
  }
}
