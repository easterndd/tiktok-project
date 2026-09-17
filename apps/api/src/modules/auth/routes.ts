import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const anonymousSessionInput = z.object({
  visitorKey: z.string().min(32).max(512),
  clientSessionId: z.string().min(8).max(128),
  platform: z.string().trim().min(1).max(64).optional(),
  clientVersion: z.string().trim().min(1).max(64).optional(),
  source: z.string().trim().min(1).max(64).optional()
});

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/auth/anonymous/session', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request) => {
    const { visitorKey, clientSessionId, platform, clientVersion, source } = anonymousSessionInput.parse(request.body);
    const visitorKeyHash = createHmac('sha256', app.config.JWT_SECRET).update(visitorKey).digest('base64url');
    const user = await app.prisma.user.upsert({
      where: { visitorKeyHash },
      create: { identityType: 'ANONYMOUS', visitorKeyHash },
      update: {}
    });
    await app.prisma.appSession.upsert({
      where: { userId_clientSessionId: { userId: user.id, clientSessionId } },
      create: { userId: user.id, clientSessionId, platform, clientVersion, source },
      update: { platform, clientVersion, source }
    });
    const accessToken = await app.jwt.sign({ sub: user.id, kind: 'user' }, { expiresIn: app.config.USER_JWT_EXPIRES_IN });
    return {
      accessToken,
      expiresIn: app.config.USER_JWT_EXPIRES_IN,
      viewer: { id: user.id, type: 'ANONYMOUS' as const }
    };
  });
}
