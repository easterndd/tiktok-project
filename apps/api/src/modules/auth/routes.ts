import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const loginInput = z.object({ code: z.string().min(1).max(2048) });

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/auth/tiktok/login', async (request, reply) => {
    loginInput.parse(request.body);
    // The OAuth code exchange is intentionally not faked: it must be wired to the current TikTok OAuth API.
    return reply.code(501).send({ error: { code: 'INTERNAL_ERROR', message: 'TikTok OAuth integration is not configured.', requestId: request.id } });
  });
}
