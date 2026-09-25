import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  it('uploads a local file with a unique object name and a visible media title', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'byteplus-upload-'));
    try {
      const filePath = join(directory, 'episode.mp4');
      await writeFile(filePath, Buffer.from('video-data'));
      const requests: Array<{ url: URL; init: RequestInit }> = [];
      let appliedName = '';
      let committedFunctions = '';
      const vodService = {
        ApplyUploadInfo: async (input: { FileName: string; FileExtension?: string }) => {
          appliedName = input.FileName;
          assert.equal(input.FileExtension, undefined);
          return { Result: { Data: { UploadAddress: { SessionKey: 'session', StoreInfos: [{ StoreUri: 'objects/video.mp4', Auth: 'secret' }], UploadHosts: ['upload.example.com'] } } } };
        },
        CommitUploadInfo: async (input: { Functions: string }) => {
          committedFunctions = input.Functions;
          return { Result: { Data: { Vid: 'vid-1', PosterUri: 'cover', SourceInfo: { Duration: 42 } } } };
        }
      };
      const service = new BytePlusVodService(env, {
        vodService: vodService as never,
        uploadFetch: async (url, init) => {
          requests.push({ url: new URL(String(url)), init: init ?? {} });
          return new Response('', { status: 200 });
        }
      });
      const result = await service.uploadLocalVideo({ filePath, fileName: '第1集.mp4', title: 'TaleTV - 第1集', spaceName: 'space', byteplusAccountId: 'account' });
      assert.equal(result.byteplusVid, 'vid-1');
      assert.match(appliedName, /^1-[a-f0-9-]+\.mp4$/);
      assert.equal(JSON.parse(committedFunctions)[1].Input.Title, 'TaleTV - 第1集');
      assert.equal(requests.length, 1);
      assert.equal(requests[0].init.headers && (requests[0].init.headers as Record<string, string>)['Content-CRC32']?.length, 8);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses BytePlus merge checksum positions for a multipart upload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'byteplus-parts-'));
    try {
      const filePath = join(directory, 'episode.mp4');
      await writeFile(filePath, Buffer.alloc(20 * 1024 * 1024 + 1, 1));
      const requests: Array<{ query: string; body?: BodyInit | null }> = [];
      const service = new BytePlusVodService(env, {
        vodService: {
          ApplyUploadInfo: async () => ({ Result: { Data: { UploadAddress: { SessionKey: 'session', StoreInfos: [{ StoreUri: 'object', Auth: 'secret' }], UploadHosts: ['upload.example.com'] } } } }),
          CommitUploadInfo: async () => ({ Result: { Data: { Vid: 'vid-2' } } })
        } as never,
        uploadFetch: async (url, init) => {
          const query = new URL(String(url)).search;
          requests.push({ query, body: init?.body });
          return query === '?uploads' ? Response.json({ payload: { uploadID: 'upload-1' } }) : new Response('', { status: 200 });
        }
      });
      await service.uploadLocalVideo({ filePath, fileName: 'episode.mp4', title: '第2集', spaceName: 'space', byteplusAccountId: 'account' });
      assert.equal(requests.length, 4);
      assert.match(requests[1].query, /partNumber=1/);
      assert.match(requests[2].query, /partNumber=2/);
      assert.match(String(requests[3].body), /^0:[a-f0-9]{8},1:[a-f0-9]{8}$/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not retry a permanent upload host rejection or commit an incomplete file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'byteplus-reject-'));
    try {
      const filePath = join(directory, 'episode.mp4');
      await writeFile(filePath, Buffer.from('video-data'));
      let uploads = 0;
      let commits = 0;
      const service = new BytePlusVodService(env, {
        vodService: {
          ApplyUploadInfo: async () => ({ Result: { Data: { UploadAddress: { SessionKey: 'session', StoreInfos: [{ StoreUri: 'object', Auth: 'secret' }], UploadHosts: ['upload.example.com'] } } } }),
          CommitUploadInfo: async () => { commits++; return { Result: { Data: { Vid: 'unexpected' } } }; }
        } as never,
        uploadFetch: async () => { uploads++; return Response.json({ code: 'InvalidPart' }, { status: 400 }); }
      });
      await assert.rejects(() => service.uploadLocalVideo({ filePath, fileName: 'episode.mp4', title: '第3集', spaceName: 'space', byteplusAccountId: 'account' }), /HTTP 400/);
      assert.equal(uploads, 1);
      assert.equal(commits, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('falls back to the next upload host when the first host is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'byteplus-fallback-'));
    try {
      const filePath = join(directory, 'episode.mp4');
      await writeFile(filePath, Buffer.from('video-data'));
      const hosts: string[] = [];
      const service = new BytePlusVodService(env, {
        vodService: {
          ApplyUploadInfo: async () => ({ Result: { Data: { UploadAddress: { SessionKey: 'session', StoreInfos: [{ StoreUri: 'object', Auth: 'secret' }], UploadHosts: ['first.example.com', 'second.example.com'] } } } }),
          CommitUploadInfo: async () => ({ Result: { Data: { Vid: 'vid-fallback' } } })
        } as never,
        uploadFetch: async (url) => {
          const host = new URL(String(url)).hostname;
          hosts.push(host);
          return new Response('', { status: host === 'first.example.com' ? 503 : 200 });
        }
      });
      const result = await service.uploadLocalVideo({ filePath, fileName: 'episode.mp4', title: '第4集', spaceName: 'space', byteplusAccountId: 'account' });
      assert.equal(result.byteplusVid, 'vid-fallback');
      assert.deepEqual(hosts, ['first.example.com', 'first.example.com', 'first.example.com', 'second.example.com']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

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
