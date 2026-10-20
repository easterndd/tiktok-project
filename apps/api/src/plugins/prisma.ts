import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export async function registerPrisma(app: FastifyInstance, providedPrisma?: PrismaClient, databaseUrl?: string) {
  const prisma = providedPrisma ?? (databaseUrl ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : new PrismaClient());
  app.decorate('prisma', prisma);
  if (!providedPrisma) app.addHook('onClose', async () => prisma.$disconnect());
}
