import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Env } from '../config/env';
import { BytePlusVodService } from './byteplus-vod.service';

const env: Env = {
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: '127.0.0.1',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  MINI_APP_KEY: 'main',
  API_CORS_ORIGIN: 'http://localhost:5173',
  TRUST_GEO_COUNTRY_HEADER: false,
  JWT_SECRET: 'test-secret-that-is-longer-than-32-characters',
  USER_JWT_EXPIRES_IN: 3_600,
  ADMIN_JWT_EXPIRES_IN: 28_800,
  ADMIN_BOOTSTRAP_EMAIL: undefined,
  ADMIN_BOOTSTRAP_PASSWORD: undefined,
  BYTEPLUS_ACCOUNT_ID: 'test-account',
  BYTEPLUS_SPACE_NAME: 'test-space',
  BYTEPLUS_REGION: 'ap-southeast-1',
  BYTEPLUS_ACCESS_KEY: 'test-access-key',
  BYTEPLUS_SECRET_KEY: 'test-secret-key',
  BYTEPLUS_VOD_ENDPOINT: 'https://vod.byteplusapi.com',
  TIKTOK_CLIENT_KEY: undefined,
  TIKTOK_CLIENT_SECRET: undefined,
  TIKTOK_APP_ID: undefined,
  TALETV_TIKTOK_CLIENT_KEY: undefined,
  TALETV_TIKTOK_CLIENT_SECRET: undefined,
  TALETV_TIKTOK_APP_ID: undefined,
  REWARDED_PLACEMENT_ID: 'ad7686459794040702993',
  TALETV_REWARDED_PLACEMENT_ID: 'ad7688599028879722512',
  APP_ENTRY_PLACEMENT_ID: 'ad7686459458972829697',
  TALETV_APP_ENTRY_PLACEMENT_ID: '',
  TIKTOK_SHORT_DRAMA_API_BASE: 'https://open.tiktokapis.com',
  API_PUBLIC_BASE_URL: undefined,
  COVER_ASSET_STORAGE_DIR: 'tmp/cover-assets-test',
  COVER_ASSET_PUBLIC_BASE_URL: undefined,
  LOCAL_PLAYBACK_ENABLED: false,
  UPLOAD_WORKER_INTERVAL_MS: 30_000,
  UPLOAD_MAX_RETRIES: 5
};

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('BytePlusVodService', () => {
  it('creates a signed UploadMediaByUrl request and returns the provider JobId', async () => {
    let requestedUrl = '';
    let authorization = '';
    const service = new BytePlusVodService(env, {
      now: () => new Date('2026-09-10T00:00:00.000Z'),
      fetch: async (input, init) => {
        requestedUrl = String(input);
        authorization = String(init?.headers && (init.headers as Record<string, string>).Authorization);
        return okJson({ Result: { Data: [{ SourceUrl: 'https://cdn.example.com/ep1.mp4', JobId: 'job-1' }] } });
      }
    });

    const result = await service.createVideoUpload({
      sourceUrl: 'https://cdn.example.com/ep1.mp4',
      title: 'Episode 1',
      spaceName: 'test-space',
      byteplusAccountId: 'test-account'
    });

    assert.equal(result.providerJobId, 'job-1');
    const requestUrl = new URL(requestedUrl);
    assert.equal(requestUrl.searchParams.get('Action'), 'UploadMediaByUrl');
    assert.equal(requestUrl.searchParams.get('Version'), '2023-01-01');
    assert.equal(requestUrl.searchParams.get('SpaceName'), 'test-space');
    assert.match(authorization, /^HMAC-SHA256 Credential=test-access-key\/20260910\/ap-southeast-1\/vod\/request,/);
    const urlSets = JSON.parse(requestUrl.searchParams.get('URLSets') ?? '[]') as Array<Record<string, unknown>>;
    assert.equal(urlSets[0].SourceUrl, 'https://cdn.example.com/ep1.mp4');
    assert.equal(urlSets[0].FileName, 'Episode-1-1788998400000.mp4');
  });

  it('maps QueryUploadTaskInfo success to the worker upload status shape', async () => {
    const service = new BytePlusVodService(env, {
      now: () => new Date('2026-09-10T00:00:00.000Z'),
      fetch: async () => okJson({
        Result: {
          Data: {
            MediaInfoList: [{
              JobId: 'job-1',
              State: 'success',
              Vid: 'vid-1',
              AccountId: 'test-account',
              SourceInfo: { Duration: 12.345 }
            }]
          }
        }
      })
    });

    const status = await service.getVideoUploadStatus({
      providerJobId: 'job-1',
      byteplusAccountId: 'test-account'
    });

    assert.equal(status.status, 'SUCCEEDED');
    assert.equal(status.byteplusVid, 'vid-1');
    assert.equal(status.durationMs, 12_345);
  });
});
