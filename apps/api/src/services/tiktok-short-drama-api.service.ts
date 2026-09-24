import { isSafeNumber, parse } from 'lossless-json';
import type { Env } from '../config/env';

type FetchLike = typeof fetch;

type TikTokApiError = {
  code?: string;
  message?: string;
  log_id?: string;
};

type TikTokApiEnvelope<T> = {
  data?: T;
  error?: TikTokApiError;
};

export class TikTokShortDramaNotConfiguredError extends Error {
  readonly retryable = false;

  constructor() {
    super('TikTok Short Drama OpenAPI is not configured.');
    this.name = 'TikTokShortDramaNotConfiguredError';
  }
}

export class TikTokShortDramaApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly requestId?: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = 'TikTokShortDramaApiError';
  }
}

export type TikTokAlbumInfoInput = {
  language: string;
  title: string;
  seq_num: number;
  cover_list: string[];
  year: number;
  album_status: number;
  desp: string;
  drama_type: number;
  tag_list: number[];
  publish_status?: number;
};

export type TikTokEpisodeInfoInput = {
  episode_id?: string;
  title: string;
  seq: number;
  cover_list: string[];
  byteplus_vid: string;
};

export type TikTokAlbumAuthorizationResult = {
  clientKey: string;
  authStatus?: number;
  errorCode?: string;
  errorMessage?: string;
};

type ServiceOptions = {
  fetch?: FetchLike;
  now?: () => Date;
};

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'bigint' ? String(value) : undefined;
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function tokenFailure(body: Record<string, unknown> | null, status: number) {
  const nested = asRecord(body?.error);
  const code = asString(nested.code) ?? asString(body?.error) ?? asString(body?.code);
  const detail = asString(nested.message)
    ?? asString(nested.description)
    ?? asString(body?.error_description)
    ?? asString(body?.message);
  const requestId = asString(nested.log_id)
    ?? asString(body?.log_id)
    ?? asString(body?.request_id);
  const suffix = detail ? `: ${detail}` : '';
  return {
    code,
    requestId,
    message: `TikTok token request failed (HTTP ${status})${suffix}`
  };
}

export class TikTokShortDramaApiService {
  private readonly fetch: FetchLike;
  private readonly now: () => Date;
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(private readonly env: Env, options: ServiceOptions = {}) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  isConfigured() {
    return Boolean(this.env.TIKTOK_CLIENT_KEY && this.env.TIKTOK_CLIENT_SECRET);
  }

  async createImage(input: { imageUrl: string }) {
    const { data, requestId } = await this.request<{ open_pic_id?: unknown }>('/v2/sg/shortdrama/image', 'POST', {
      image_url: input.imageUrl
    });
    const openPicId = asString(data.open_pic_id);
    if (!openPicId) throw new TikTokShortDramaApiError('TikTok image upload completed without open_pic_id.', undefined, requestId, false);
    return { openPicId, requestId };
  }

  async createVideo(input: { vid: string; title: string }) {
    const { data, requestId } = await this.request<{ result_type?: unknown; job_id?: unknown; byteplus_vid?: unknown }>('/v2/sg/shortdrama/video', 'POST', {
      vid: input.vid,
      title: input.title,
      space_name: this.env.BYTEPLUS_SPACE_NAME,
      byteplus_account_id: this.env.BYTEPLUS_ACCOUNT_ID,
      byteplus_region: this.env.BYTEPLUS_REGION
    });
    const resultType = asNumber(data.result_type);
    const jobId = asString(data.job_id);
    const returnedByteplusVid = asString(data.byteplus_vid);
    const byteplusVid = returnedByteplusVid ?? input.vid;
    // The Short Drama API reports result_type=1 when an existing BytePlus VID
    // is registered immediately. Only result_type=2 requires job polling.
    if (resultType === 1) return { status: 'READY' as const, byteplusVid, requestId };
    if (resultType === 2 || jobId) {
      if (!jobId) throw new TikTokShortDramaApiError('TikTok accepted asynchronous video registration without job_id.', undefined, requestId, true);
      return { status: 'PROCESSING' as const, jobId, byteplusVid, requestId };
    }
    if (resultType === 3) throw new TikTokShortDramaApiError('TikTok rejected video registration.', undefined, requestId, false);
    if (returnedByteplusVid) return { status: 'VERIFYING' as const, byteplusVid, requestId };
    const rawResultType = asString(data.result_type) ?? 'missing';
    const responseKeys = Object.keys(data).sort().join(',') || 'none';
    throw new TikTokShortDramaApiError(`TikTok video registration returned an unknown result_type (${rawResultType}; response keys: ${responseKeys}).`, undefined, requestId, true);
  }

  async getVideo(input: { jobId?: string; vid?: string }) {
    if (!input.jobId && !input.vid) throw new TikTokShortDramaApiError('TikTok video query requires jobId or vid.');
    const { data, requestId } = await this.request<Record<string, unknown>>('/v2/sg/shortdrama/video', 'GET', undefined, {
      ...(input.jobId ? { job_id: input.jobId } : {}),
      ...(input.vid ? { vid: input.vid } : {}),
      byteplus_account_id: this.env.BYTEPLUS_ACCOUNT_ID
    });
    const uploadStatus = asNumber(data.upload_status);
    if (![1, 2, 3].includes(uploadStatus ?? 0)) {
      throw new TikTokShortDramaApiError('TikTok video query returned an unknown upload status.', undefined, requestId, true);
    }
    return {
      uploadStatus,
      vid: asString(data.vid),
      jobId: asString(data.job_id),
      byteplusUrl: asString(data.byteplus_url),
      title: asString(data.title),
      rawVideoInfoJson: asString(data.raw_video_info_json),
      requestId
    };
  }

  async createAlbum() {
    const { data, requestId } = await this.request<{ album_id?: unknown }>('/v2/sg/shortdrama/album/create/', 'POST', {});
    const albumId = asString(data.album_id);
    if (!albumId) throw new TikTokShortDramaApiError('TikTok album creation completed without album_id.', undefined, requestId, false);
    return { albumId, requestId };
  }

  async updateAlbumVersion(input: { albumId: string; version?: number; albumInfo: TikTokAlbumInfoInput; episodes: TikTokEpisodeInfoInput[] }) {
    const { data, requestId } = await this.request<Record<string, unknown>>('/v2/sg/shortdrama/album/update/', 'POST', {
      album_id: input.albumId,
      operation_type: 1,
      ...(input.version ? { version: input.version } : {}),
      album_info: input.albumInfo,
      episode_info_list: input.episodes
    });
    const version = asNumber(data.version);
    if (!version) throw new TikTokShortDramaApiError('TikTok album update completed without a version.', undefined, requestId, false);
    const episodeIdMap = Object.fromEntries(Object.entries(asRecord(data.episode_id_map)).flatMap(([key, value]) => {
      const episodeId = asString(value);
      return episodeId ? [[key, episodeId]] : [];
    }));
    return { version, episodeIdMap, requestId, albumStatus: asNumber(data.album_status), publishStatus: asNumber(data.publish_status) };
  }

  async queryAlbum(input: { albumId: string; version?: number }) {
    const { data, requestId } = await this.request<Record<string, unknown>>('/v2/sg/shortdrama/album/query/', 'GET', undefined, {
      album_id: input.albumId,
      ...(input.version ? { version: String(input.version) } : {})
    });
    const versions = Array.isArray(data.album_version_list)
      ? data.album_version_list.map(asRecord)
      : [];
    const currentVersion = asNumber(data.current_version);
    const selected = versions.find((item) => asNumber(item.version) === input.version)
      ?? versions.find((item) => asNumber(item.version) === currentVersion)
      ?? versions.sort((left, right) => (asNumber(right.version) ?? 0) - (asNumber(left.version) ?? 0))[0]
      ?? {};
    // The API returns publication fields at the album level and review / episode
    // detail in album_version_list. Expose one normalized view to the worker.
    return {
      data: {
        ...data,
        ...selected,
        current_version: currentVersion ?? asNumber(selected.version),
        online_version: asNumber(data.online_version),
        publish_status: asNumber(data.publish_status),
        review_status: asNumber(selected.review_status) ?? asNumber(data.review_status),
        episode_info_list: selected.episode_info_list ?? data.episode_info_list
      },
      requestId
    };
  }

  async submitReview(input: { albumId: string; version: number; priorityScore: 1 | 2 }) {
    const { data, requestId } = await this.request<{ review_id?: unknown }>('/v2/sg/shortdrama/album/review/submit/', 'POST', {
      album_id: input.albumId,
      version: input.version,
      priority_score: input.priorityScore
    });
    return { reviewId: asString(data.review_id), requestId };
  }

  async setOnlineVersion(input: { albumId: string; version: number }) {
    const { data, requestId } = await this.request<Record<string, unknown>>('/v2/sg/shortdrama/album/online_version/', 'POST', {
      album_id: input.albumId,
      version: input.version
    });
    const onlineVersion = asNumber(data.online_version) ?? input.version;
    return { onlineVersion, requestId };
  }

  async setAlbumStatus(input: { albumId: string; status: 1 | 2 }) {
    const { data, requestId } = await this.request<Record<string, unknown>>('/v2/sg/shortdrama/album/status/', 'POST', {
      album_id: input.albumId,
      status: input.status
    });
    return { status: asNumber(data.status) ?? input.status, requestId };
  }

  async authorizeAlbum(input: { albumId: string; targetClientKeys: string[]; operateType?: 1 | 2 }) {
    const targetClientKeys = [...new Set(input.targetClientKeys.map((value) => value.trim()).filter(Boolean))];
    if (!targetClientKeys.length) throw new TikTokShortDramaApiError('TikTok album authorization requires at least one target client key.');
    const { data, requestId } = await this.request<Record<string, unknown>>('/v2/sg/shortdrama/album/authorize/', 'POST', {
      album_id: input.albumId,
      operate_type: input.operateType ?? 1,
      target_client_key_list: targetClientKeys
    });
    const rawResults = Array.isArray(data.client_key_result_list)
      ? data.client_key_result_list.map(asRecord)
      : [];
    const results = rawResults.map((item) => ({
      clientKey: asString(item.client_key) ?? '',
      authStatus: asNumber(item.auth_status),
      errorCode: asString(item.error_code),
      errorMessage: asString(item.error_message)
    })).filter((item) => Boolean(item.clientKey));
    if (!results.length) {
      throw new TikTokShortDramaApiError('TikTok album authorization returned no target result.', undefined, requestId, true);
    }
    return { results, requestId, raw: data };
  }

  private async request<T extends Record<string, unknown>>(path: string, method: 'GET' | 'POST', body?: Record<string, unknown>, query?: Record<string, string>) {
    const token = await this.getAccessToken();
    const url = new URL(path, this.env.TIKTOK_SHORT_DRAMA_API_BASE);
    for (const [key, value] of Object.entries({ client_key: this.env.TIKTOK_CLIENT_KEY!, ...query })) url.searchParams.set(key, value);
    const response = await this.fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
      },
      ...(method === 'POST' ? { body: JSON.stringify({ client_key: this.env.TIKTOK_CLIENT_KEY!, ...body }) } : {}),
      signal: AbortSignal.timeout(15_000)
    }).catch(() => {
      throw new TikTokShortDramaApiError('TikTok Short Drama request failed before receiving a response.', undefined, undefined, true);
    });
    const envelope = await response.text()
      .then((text) => parse(text, undefined, {
        parseNumber: (value) => isSafeNumber(value) ? Number(value) : value
      }))
      .catch(() => null) as TikTokApiEnvelope<T> | null;
    const requestId = envelope?.error?.log_id ?? response.headers.get('x-tt-logid') ?? undefined;
    if (!response.ok || (envelope?.error?.code && envelope.error.code !== 'ok')) {
      throw new TikTokShortDramaApiError(
        envelope?.error?.message ?? 'TikTok Short Drama request failed.',
        envelope?.error?.code,
        requestId,
        isRetryableStatus(response.status)
      );
    }
    if (!envelope?.data) throw new TikTokShortDramaApiError('TikTok Short Drama response did not contain data.', undefined, requestId, true);
    return { data: envelope.data, requestId };
  }

  private async getAccessToken() {
    if (!this.isConfigured()) throw new TikTokShortDramaNotConfiguredError();
    if (this.accessToken && this.accessTokenExpiresAt > this.now().getTime()) return this.accessToken;
    const form = new URLSearchParams({
      client_key: this.env.TIKTOK_CLIENT_KEY!,
      client_secret: this.env.TIKTOK_CLIENT_SECRET!,
      grant_type: 'client_credentials'
    });
    const url = new URL('/v2/oauth/token/', this.env.TIKTOK_SHORT_DRAMA_API_BASE);
    const response = await this.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(15_000)
    }).catch(() => {
      throw new TikTokShortDramaApiError('TikTok token request failed before receiving a response.', undefined, undefined, true);
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    const token = asString(body?.access_token);
    const expiresIn = asNumber(body?.expires_in);
    if (!response.ok || !token || !expiresIn) {
      const failure = tokenFailure(body, response.status);
      throw new TikTokShortDramaApiError(failure.message, failure.code, failure.requestId, isRetryableStatus(response.status));
    }
    this.accessToken = token;
    this.accessTokenExpiresAt = this.now().getTime() + Math.max(1, expiresIn - 300) * 1_000;
    return token;
  }
}
