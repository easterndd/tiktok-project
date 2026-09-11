import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export async function registerPrisma(app: FastifyInstance, providedPrisma?: PrismaClient) {
  const prisma = providedPrisma ?? new PrismaClient();
  app.decorate('prisma', prisma);
  if (!providedPrisma) app.addHook('onClose', async () => prisma.$disconnect());
}
