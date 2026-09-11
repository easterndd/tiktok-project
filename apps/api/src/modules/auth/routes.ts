import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env';

const loginInput = z.object({ code: z.string().min(1).max(2048) });

type TikTokTokenResponse = {
  access_token?: string;
  open_id?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type TikTokUserInfoResponse = {
  data?: { user?: { open_id?: string } };
  error?: { code?: string; message?: string };
};

async function readJson<T>(response: Response) {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

function oauthError(message: string, cause?: unknown) {
  const error = new Error(message);
  Object.assign(error, { statusCode: 502, cause });
  return error;
}

async function exchangeCode(code: string, env: Env): Promise<string> {
  const body = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY,
    client_secret: env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code'
  });
  if (env.TIKTOK_REDIRECT_URI) body.set('redirect_uri', env.TIKTOK_REDIRECT_URI);

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(env.TIKTOK_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(8_000)
    });
  } catch (error) {
    throw oauthError('TikTok login is temporarily unavailable.', error);
  }
  const token = await readJson<TikTokTokenResponse>(tokenResponse);
  if (!tokenResponse.ok || !token || token.error || !token.access_token) {
    throw oauthError('TikTok login was rejected.');
  }

  if (token.open_id) return token.open_id;

  let profileResponse: Response;
  try {
    profileResponse = await fetch(env.TIKTOK_USER_INFO_URL, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000)
    });
  } catch (error) {
    throw oauthError('TikTok profile lookup is temporarily unavailable.', error);
  }
  const profile = await readJson<TikTokUserInfoResponse>(profileResponse);
  const openId = profile?.data?.user?.open_id;
  if (!profileResponse.ok || !openId) throw oauthError('TikTok profile lookup failed.');
  return openId;
}

export async function registerAuthRoutes(app: FastifyInstance, env: Env) {
  app.post('/auth/tiktok/login', async (request) => {
    const { code } = loginInput.parse(request.body);
    const openId = await exchangeCode(code, env);
    const user = await app.prisma.user.upsert({
      where: { tiktokOpenId: openId },
      create: { tiktokOpenId: openId },
      update: {}
    });
    const accessToken = await app.jwt.sign({ sub: user.id, kind: 'user' }, { expiresIn: env.USER_JWT_EXPIRES_IN });
    return {
      accessToken,
      expiresIn: env.USER_JWT_EXPIRES_IN,
      user: { id: user.id }
    };
  });
}
