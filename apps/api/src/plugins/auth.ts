import type { FastifyRequest } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; kind: 'user' | 'admin' };
    user: { sub: string; kind: 'user' | 'admin' };
  }
}

export async function requireUser(request: FastifyRequest) {
  await request.jwtVerify();
  if (request.user.kind !== 'user') throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

export async function requireAdmin(request: FastifyRequest) {
  await request.jwtVerify();
  if (request.user.kind !== 'admin') throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}
