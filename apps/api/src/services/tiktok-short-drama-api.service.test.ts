import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Env } from '../config/env';
import { TikTokShortDramaApiService } from './tiktok-short-drama-api.service';

const env: Env = {
  NODE_ENV: 'test', PORT: 3000, HOST: '127.0.0.1', DATABASE_URL: 'postgresql://test:test@localhost:5432/test', API_CORS_ORIGIN: 'http://localhost:5173', TRUST_GEO_COUNTRY_HEADER: false,
  JWT_SECRET: 'test-secret-that-is-longer-than-32-characters', USER_JWT_EXPIRES_IN: 3600, ADMIN_JWT_EXPIRES_IN: 28_800,
  ADMIN_BOOTSTRAP_EMAIL: undefined, ADMIN_BOOTSTRAP_PASSWORD: undefined,
  BYTEPLUS_ACCOUNT_ID: 'account-1', BYTEPLUS_SPACE_NAME: 'space-1', BYTEPLUS_REGION: 'ap-singapore-1', BYTEPLUS_ACCESS_KEY: undefined, BYTEPLUS_SECRET_KEY: undefined, BYTEPLUS_VOD_ENDPOINT: 'https://vod.byteplusapi.com',
  TIKTOK_CLIENT_KEY: 'mn-client-key', TIKTOK_CLIENT_SECRET: 'client-secret', TIKTOK_SHORT_DRAMA_API_BASE: 'https://open.tiktokapis.com',
  API_PUBLIC_BASE_URL: undefined, COVER_ASSET_STORAGE_DIR: 'tmp/cover-assets-test', COVER_ASSET_PUBLIC_BASE_URL: undefined, LOCAL_PLAYBACK_ENABLED: false, UPLOAD_WORKER_INTERVAL_MS: 30_000, UPLOAD_MAX_RETRIES: 5
};

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('TikTokShortDramaApiService', () => {
  it('adds the server-only credentials and BytePlus binding when registering a video', async () => {
    const requests: Array<{ url: URL; body: string | undefined }> = [];
    const service = new TikTokShortDramaApiService(env, {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        requests.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
        if (url.pathname === '/v2/oauth/token/') return response({ access_token: 'token-1', expires_in: 7200 });
        return response({ data: { result_type: 2, job_id: 'vod:job:1', byteplus_vid: 'v123' }, error: { code: 'ok', message: '', log_id: 'log-1' } });
      }
    });

    const result = await service.createVideo({ vid: 'v123', title: 'Episode 1' });
    assert.equal(result.status, 'PROCESSING');
    assert.equal(result.jobId, 'vod:job:1');
    assert.equal(requests.length, 2);
    const body = JSON.parse(requests[1].body!);
    assert.deepEqual(body, { client_key: 'mn-client-key', vid: 'v123', title: 'Episode 1', space_name: 'space-1', byteplus_account_id: 'account-1', byteplus_region: 'ap-singapore-1' });
    assert.equal(requests[1].url.searchParams.get('client_key'), 'mn-client-key');
  });

  it('accepts a synchronously registered BytePlus video without a polling job', async () => {
    const service = new TikTokShortDramaApiService(env, {
      fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === '/v2/oauth/token/') return response({ access_token: 'token-1', expires_in: 7200 });
        return response({ data: { result_type: 1, byteplus_vid: 'v123' }, error: { code: 'ok', message: '', log_id: 'log-1' } });
      }
    });

    const result = await service.createVideo({ vid: 'v123', title: 'Episode 1' });
    assert.deepEqual(result, { status: 'READY', byteplusVid: 'v123', requestId: 'log-1' });
  });

  it('accepts numeric result types returned as strings by the platform', async () => {
    const service = new TikTokShortDramaApiService(env, {
      fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === '/v2/oauth/token/') return response({ access_token: 'token-1', expires_in: 7200 });
        return response({ data: { result_type: '1', byteplus_vid: 'v123' }, error: { code: 'ok', log_id: 'log-1' } });
      }
    });

    const result = await service.createVideo({ vid: 'v123', title: 'Episode 1' });
    assert.equal(result.status, 'READY');
  });

  it('returns a verification state when TikTok only returns byteplus_vid', async () => {
    const service = new TikTokShortDramaApiService(env, {
      fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === '/v2/oauth/token/') return response({ access_token: 'token-1', expires_in: 7200 });
        return response({ data: { byteplus_vid: 'v123' }, error: { code: 'ok', log_id: 'log-1' } });
      }
    });

    const result = await service.createVideo({ vid: 'v123', title: 'Episode 1' });
    assert.deepEqual(result, { status: 'VERIFYING', byteplusVid: 'v123', requestId: 'log-1' });
  });

  it('preserves an int64 album id as a string and normalizes album_version_list', async () => {
    let queryUrl = '';
    const service = new TikTokShortDramaApiService(env, {
      fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === '/v2/oauth/token/') return response({ access_token: 'token-1', expires_in: 7200 });
        queryUrl = url.toString();
        return response({ data: { current_version: 2, online_version: 2, publish_status: 1, album_version_list: [{ version: 2, review_status: 2, episode_info_list: [{ episode_id: '7637437361307027476' }] }] }, error: { code: 'ok' } });
      }
    });

    const result = await service.queryAlbum({ albumId: '7637420375425239060' });
    assert.match(queryUrl, /album_id=7637420375425239060/);
    assert.equal(result.data.current_version, 2);
    assert.equal(result.data.review_status, 2);
    assert.deepEqual(result.data.episode_info_list, [{ episode_id: '7637437361307027476' }]);
  });

  it('parses numeric int64 album and episode ids without rounding them', async () => {
    const albumId = '7688340549090544384';
    const episodeId = '7688340549090544385';
    const service = new TikTokShortDramaApiService(env, {
      fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === '/v2/oauth/token/') return response({ access_token: 'token-1', expires_in: 7200 });
        if (url.pathname.endsWith('/album/create/')) {
          return new Response(`{"data":{"album_id":${albumId}},"error":{"code":"ok"}}`);
        }
        return new Response(`{"data":{"version":1,"episode_id_map":{"seq_1":${episodeId}}},"error":{"code":"ok"}}`);
      }
    });

    const created = await service.createAlbum();
    assert.equal(created.albumId, albumId);
    const updated = await service.updateAlbumVersion({
      albumId: created.albumId,
      albumInfo: { language: 'en', title: 'Test', seq_num: 1, cover_list: ['cover-1'], year: 2026, album_status: 3, desp: 'Test', drama_type: 1, tag_list: [1] },
      episodes: [{ title: 'Episode 1', seq: 1, cover_list: ['cover-1'], byteplus_vid: 'vid-1' }]
    });
    assert.equal(updated.episodeIdMap.seq_1, episodeId);
  });

  it('reports a safe OAuth error code and HTTP status without exposing credentials', async () => {
    const service = new TikTokShortDramaApiService(env, {
      fetch: async () => new Response(JSON.stringify({ error: 'invalid_client', error_description: 'Client key is invalid', log_id: 'log-1' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      })
    });

    await assert.rejects(
      () => service.createAlbum(),
      (error: unknown) => error instanceof Error
        && error.message === 'TikTok token request failed (HTTP 401): Client key is invalid'
        && !error.message.includes(env.TIKTOK_CLIENT_SECRET!)
    );
  });
});
