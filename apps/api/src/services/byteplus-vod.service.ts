import { createHash, createHmac, randomUUID } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { vodOpenapi } from '@byteplus/vcloud-sdk-nodejs';
import { crc32 } from 'crc';
import type { Env } from '../config/env';
import {
  ProviderNotConfiguredError,
  type TikTokShortDramaService,
  type UploadStatusResult
} from './tiktok-short-drama.service';

const vodServiceName = 'vod';
const vodApiVersion = '2023-01-01';
const contentType = 'application/x-www-form-urlencoded; charset=utf-8';
const emptyPayloadHash = hash('');

type FetchLike = typeof fetch;

type BytePlusVodOptions = {
  fetch?: FetchLike;
  now?: () => Date;
  uploadFetch?: FetchLike;
  vodService?: vodOpenapi.VodService;
};

export type BytePlusMedia = {
  vid: string;
  title: string;
  coverUrl?: string;
  durationMs?: number;
  publishStatus?: string;
  createTime?: string;
};

type LocalUploadInput = {
  filePath: string;
  fileName: string;
  title: string;
  spaceName: string;
  byteplusAccountId: string;
};

const uploadPartSize = 20 * 1024 * 1024;
const uploadAttempts = 3;

export function episodeMediaTitle(albumTitle: string, episodeNo: number) {
  return `${albumTitle.trim()} - 第${episodeNo}集`.slice(0, 128);
}

type UploadAddress = {
  SessionKey?: string;
  StoreInfos?: Array<{ StoreUri?: string; Auth?: string }>;
  UploadHosts?: string[];
};

type BytePlusError = {
  ResponseMetadata?: {
    RequestId?: string;
    Error?: {
      Code?: string;
      Message?: string;
    };
  };
};

type UploadMediaByUrlResponse = BytePlusError & {
  Result?: {
    Data?: Array<{
      SourceUrl?: string;
      JobId?: string;
    }>;
  };
};

type QueryUploadTaskInfoResponse = BytePlusError & {
  Result?: {
    Data?: {
      MediaInfoList?: Array<{
        JobId?: string;
        State?: string;
        Vid?: string;
        AccountId?: string;
        SourceInfo?: {
          Duration?: number;
        };
      }>;
      NotExistJobIds?: string[];
    };
  };
};

export class BytePlusVodError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'BytePlusVodError';
    this.retryable = retryable;
  }
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest();
}

function hmacHex(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest('hex');
}

function formatAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(params: URLSearchParams) {
  return [...params.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&');
}

function createAuthorization(input: {
  accessKey: string;
  secretKey: string;
  region: string;
  method: string;
  host: string;
  query: URLSearchParams;
  now: Date;
}) {
  const xDate = formatAmzDate(input.now);
  const shortDate = xDate.slice(0, 8);
  const credentialScope = `${shortDate}/${input.region}/${vodServiceName}/request`;
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${input.host}`,
    `x-content-sha256:${emptyPayloadHash}`,
    `x-date:${xDate}`,
    ''
  ].join('\n');
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonicalRequest = [
    input.method,
    '/',
    canonicalQuery(input.query),
    canonicalHeaders,
    signedHeaders,
    emptyPayloadHash
  ].join('\n');
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    credentialScope,
    hash(canonicalRequest)
  ].join('\n');
  const kDate = hmac(input.secretKey, shortDate);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, vodServiceName);
  const kSigning = hmac(kService, 'request');
  const signature = hmacHex(kSigning, stringToSign);
  return {
    xDate,
    authorization: `HMAC-SHA256 Credential=${input.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

function safeProviderMessage(body: BytePlusError | null, fallback: string) {
  const error = body?.ResponseMetadata?.Error;
  if (!error?.Code && !error?.Message) return fallback;
  return `${error.Code ?? 'BytePlusError'}: ${error.Message ?? fallback}`;
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function sanitizeFileName(title: string, nowMs: number) {
  const base = title.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96);
  return `${base || 'episode'}-${nowMs}.mp4`;
}

export class BytePlusVodService implements TikTokShortDramaService {
  private readonly fetch: FetchLike;
  private readonly uploadFetch: FetchLike;
  private readonly now: () => Date;
  private readonly vodService?: vodOpenapi.VodService;

  constructor(private readonly env: Env, options: BytePlusVodOptions = {}) {
    this.fetch = options.fetch ?? fetch;
    this.uploadFetch = options.uploadFetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.vodService = options.vodService;
  }

  async createVideoUpload(input: { sourceUrl: string; title: string; spaceName: string; byteplusAccountId: string }): Promise<{ providerJobId: string }> {
    const urlSets = [{
      SourceUrl: input.sourceUrl,
      Title: input.title,
      FileName: sanitizeFileName(input.title, this.now().getTime()),
      FileType: 'media',
      RecordType: 1,
      CallbackArgs: JSON.stringify({ byteplusAccountId: input.byteplusAccountId })
    }];
    const response = await this.request<UploadMediaByUrlResponse>('UploadMediaByUrl', {
      SpaceName: input.spaceName,
      URLSets: JSON.stringify(urlSets)
    });
    const providerJobId = response.Result?.Data?.[0]?.JobId;
    if (!providerJobId) throw new BytePlusVodError('BytePlus upload task was created without a JobId.', false);
    return { providerJobId };
  }

  async getVideoUploadStatus(input: { providerJobId: string; byteplusAccountId: string }): Promise<UploadStatusResult> {
    const response = await this.request<QueryUploadTaskInfoResponse>('QueryUploadTaskInfo', {
      JobIds: input.providerJobId
    });
    if (response.Result?.Data?.NotExistJobIds?.includes(input.providerJobId)) {
      return { status: 'FAILED', errorMessage: 'BytePlus upload task does not exist.', retryable: false };
    }
    const item = response.Result?.Data?.MediaInfoList?.find((media) => media.JobId === input.providerJobId);
    if (!item) return { status: 'PROCESSING' };

    const state = item.State?.toLowerCase();
    if (state === 'initial' || state === 'processing') return { status: 'PROCESSING' };
    if (state === 'failed') return { status: 'FAILED', errorMessage: 'BytePlus upload task failed.', retryable: false };
    if (state !== 'success') return { status: 'PROCESSING' };
    if (item.AccountId && item.AccountId !== input.byteplusAccountId) {
      return { status: 'FAILED', errorMessage: 'BytePlus upload task belongs to a different account.', retryable: false };
    }
    return {
      status: 'SUCCEEDED',
      byteplusVid: item.Vid,
      durationMs: typeof item.SourceInfo?.Duration === 'number' ? Math.round(item.SourceInfo.Duration * 1000) : undefined
    };
  }

  async uploadLocalVideo(input: LocalUploadInput) {
    const service = this.createSdkService();
    const extension = input.fileName.includes('.') ? input.fileName.slice(input.fileName.lastIndexOf('.')) : '.mp4';
    const safeName = input.fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'episode';
    const objectName = `${safeName}-${randomUUID()}${extension.toLowerCase()}`;
    const size = (await stat(input.filePath)).size;
    if (!size) throw new BytePlusVodError('视频文件为空。', false);
    let response: Awaited<ReturnType<typeof service.CommitUploadInfo>>;
    try {
      const applied = await service.ApplyUploadInfo({
        SpaceName: input.spaceName,
        FileType: 'media',
        FileName: objectName
      });
      if (applied.ResponseMetadata?.Error) {
        throw new BytePlusVodError(safeProviderMessage(applied, 'BytePlus 未能签发上传地址。'), false);
      }
      const address: UploadAddress | undefined = applied.Result?.Data?.UploadAddress;
      const store = address?.StoreInfos?.[0];
      if (!address?.SessionKey || !store?.StoreUri || !store.Auth || !address.UploadHosts?.length) {
        throw new BytePlusVodError('BytePlus 未返回完整的上传地址。', true);
      }
      await this.transferLocalFile(input.filePath, size, address.UploadHosts, store.StoreUri, store.Auth);
      response = await service.CommitUploadInfo({
        SpaceName: input.spaceName,
        SessionKey: address.SessionKey,
        CallbackArgs: JSON.stringify({ byteplusAccountId: input.byteplusAccountId }),
        Functions: JSON.stringify([
          { Name: 'GetMeta' },
          { Name: 'AddOptionInfo', Input: { Title: input.title.slice(0, 128) } }
        ])
      });
    } catch (error) {
      if (error instanceof BytePlusVodError) throw error;
      throw Object.assign(new BytePlusVodError(
        'BytePlus 上传地址申请或提交失败，请查看服务端日志。',
        true
      ), { cause: error });
    }
    const providerError = response.ResponseMetadata?.Error;
    if (providerError) {
      throw new BytePlusVodError(
        safeProviderMessage({ ResponseMetadata: { Error: providerError } }, 'BytePlus VOD 拒绝本地上传。'),
        false
      );
    }
    const data = response.Result?.Data;
    if (!data?.Vid) throw new BytePlusVodError('BytePlus VOD 上传后没有返回视频 VID。', true);
    return {
      byteplusVid: data.Vid,
      coverUrl: data.PosterUri,
      durationMs: typeof data.SourceInfo?.Duration === 'number' ? Math.round(data.SourceInfo.Duration * 1000) : undefined
    };
  }

  private async transferLocalFile(filePath: string, size: number, hosts: string[], objectName: string, auth: string) {
    const file = await open(filePath, 'r');
    try {
      if (size <= uploadPartSize) {
        const data = await this.readPart(file, 0, size);
        await this.tryUploadHosts(hosts, objectName, auth, '', data);
        return;
      }
      for (const host of hosts) {
        let uploadId: string;
        try {
          const response = await this.uploadRequest(host, objectName, auth, 'uploads', undefined, true);
          const body = await response.json() as { payload?: { uploadID?: string } };
          uploadId = body.payload?.uploadID ?? '';
          if (!uploadId) throw new BytePlusVodError('BytePlus 分片初始化未返回 uploadID。', true);
        } catch (error) {
          if (error instanceof BytePlusVodError && !error.retryable) throw error;
          if (host === hosts.at(-1)) throw error;
          continue;
        }
        const checksums: string[] = [];
        for (let offset = 0, partNumber = 1; offset < size; offset += uploadPartSize, partNumber++) {
          const data = await this.readPart(file, offset, Math.min(uploadPartSize, size - offset));
          const checksum = crc32(data).toString(16).padStart(8, '0');
          await this.uploadRequest(host, objectName, auth,
            `partNumber=${partNumber}&uploadID=${encodeURIComponent(uploadId)}`, data, true, checksum);
          checksums.push(`${partNumber - 1}:${checksum}`);
        }
        // The BytePlus SDK uses zero-based checksum positions in the merge body.
        await this.uploadRequest(host, objectName, auth, `uploadID=${encodeURIComponent(uploadId)}`,
          checksums.join(','), true, undefined, false);
        return;
      }
    } finally {
      await file.close();
    }
  }

  private async readPart(file: Awaited<ReturnType<typeof open>>, offset: number, length: number) {
    const data = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const result = await file.read(data, read, length - read, offset + read);
      if (!result.bytesRead) throw new BytePlusVodError('视频文件读取不完整。', false);
      read += result.bytesRead;
    }
    return data;
  }

  private async tryUploadHosts(hosts: string[], objectName: string, auth: string, query: string, data: Buffer) {
    const checksum = crc32(data).toString(16).padStart(8, '0');
    for (const host of hosts) {
      try {
        await this.uploadRequest(host, objectName, auth, query, data, false, checksum);
        return;
      } catch (error) {
        if (error instanceof BytePlusVodError && !error.retryable) throw error;
        if (host === hosts.at(-1)) throw error;
      }
    }
  }

  private async uploadRequest(host: string, objectName: string, auth: string, query: string,
    data?: Buffer | string, multipart = false, checksum?: string, retry = true): Promise<Response> {
    const url = new URL(`http://${host}/${objectName.split('/').map(encodeURIComponent).join('/')}`);
    url.search = query;
    for (let attempt = 1; attempt <= (retry ? uploadAttempts : 1); attempt++) {
      try {
        const response = await this.uploadFetch(url, {
          method: 'PUT',
          headers: {
            Authorization: auth,
            ...(multipart ? { 'X-Storage-Mode': 'gateway' } : {}),
            ...(checksum ? { 'Content-CRC32': checksum } : {})
          },
          body: typeof data === 'string' ? data : data ? new Uint8Array(data) : undefined,
          signal: AbortSignal.timeout(90_000)
        });
        if (response.ok) return response;
        const body = await response.text();
        const providerCode = body.match(/"(?:Code|code)"\s*:\s*"([a-zA-Z0-9_.-]{1,80})"/)?.[1];
        const requestId = response.headers.get('x-request-id')?.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
        const retryable = isRetryableStatus(response.status);
        if (!retryable || attempt === uploadAttempts || !retry) {
          throw new BytePlusVodError(`BytePlus 上传主机 ${host} 返回 HTTP ${response.status}${providerCode ? ` (${providerCode})` : ''}${requestId ? `，请求 ID ${requestId}` : ''}。`, retryable);
        }
      } catch (error) {
        if (error instanceof BytePlusVodError && !error.retryable) throw error;
        if (attempt === uploadAttempts || !retry) {
          if (error instanceof BytePlusVodError) throw error;
          throw Object.assign(new BytePlusVodError(`连接 BytePlus 上传主机 ${host} 失败。`, true), { cause: error });
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
    throw new BytePlusVodError('BytePlus 上传未完成。', true);
  }

  async getPlayAuthToken(input: { vid: string }): Promise<string> {
    return this.createSdkService().GetPlayAuthToken({ Vid: input.vid }, 900);
  }

  async getMediaInfos(input: { vids: string[] }): Promise<BytePlusMedia[]> {
    const vids = [...new Set(input.vids.map((vid) => vid.trim()).filter(Boolean))];
    if (!vids.length) return [];
    const response = await this.createSdkService().GetMediaInfos({ Vids: vids.join(',') });
    const providerError = response.ResponseMetadata?.Error;
    if (providerError) throw new Error(`${providerError.Code ?? 'BytePlusError'}: ${providerError.Message ?? 'Unable to read media information.'}`);
    return (response.Result?.MediaInfoList ?? []).flatMap((media) => {
      const vid = media.BasicInfo?.Vid;
      if (!vid) return [];
      return [{
        vid,
        title: media.BasicInfo?.Title ?? vid,
        coverUrl: media.BasicInfo?.PosterUri,
        durationMs: typeof media.SourceInfo?.Duration === 'number'
          ? Math.round(media.SourceInfo.Duration * 1000)
          : undefined,
        publishStatus: media.BasicInfo?.PublishStatus,
        createTime: media.BasicInfo?.CreateTime
      }];
    });
  }

  async listMedia(input: { offset?: number; pageSize?: number; status?: string }) {
    const response = await this.createSdkService().GetMediaList({
      SpaceName: this.env.BYTEPLUS_SPACE_NAME,
      Offset: String(input.offset ?? 0),
      PageSize: String(Math.min(Math.max(input.pageSize ?? 50, 1), 100)),
      Status: input.status
    });
    const providerError = response.ResponseMetadata?.Error;
    if (providerError) throw new Error(`${providerError.Code ?? 'BytePlusError'}: ${providerError.Message ?? 'Unable to list BytePlus media.'}`);
    const items = (response.Result?.MediaInfoList ?? []).flatMap((media) => {
      const vid = media.BasicInfo?.Vid;
      if (!vid) return [];
      return [{
        vid,
        title: media.BasicInfo?.Title ?? vid,
        coverUrl: media.BasicInfo?.PosterUri,
        durationMs: typeof media.SourceInfo?.Duration === 'number'
          ? Math.round(media.SourceInfo.Duration * 1000)
          : undefined,
        publishStatus: media.BasicInfo?.PublishStatus,
        createTime: media.BasicInfo?.CreateTime
      }];
    });
    return { items, total: response.Result?.TotalCount ?? items.length };
  }

  private createSdkService() {
    if (this.vodService) return this.vodService;
    if (!this.env.BYTEPLUS_ACCESS_KEY || !this.env.BYTEPLUS_SECRET_KEY) throw new ProviderNotConfiguredError();
    const service = new vodOpenapi.VodService({
      region: this.env.BYTEPLUS_REGION,
      host: new URL(this.env.BYTEPLUS_VOD_ENDPOINT).host,
      serviceName: vodServiceName,
      defaultVersion: vodApiVersion
    });
    service.setAccessKeyId(this.env.BYTEPLUS_ACCESS_KEY);
    service.setSecretKey(this.env.BYTEPLUS_SECRET_KEY);
    return service;
  }

  private async request<T extends BytePlusError>(action: string, params: Record<string, string>) {
    if (!this.env.BYTEPLUS_ACCESS_KEY || !this.env.BYTEPLUS_SECRET_KEY) throw new ProviderNotConfiguredError();
    const endpoint = new URL(this.env.BYTEPLUS_VOD_ENDPOINT);
    const query = new URLSearchParams({ Action: action, Version: vodApiVersion, ...params });
    const { authorization, xDate } = createAuthorization({
      accessKey: this.env.BYTEPLUS_ACCESS_KEY,
      secretKey: this.env.BYTEPLUS_SECRET_KEY,
      region: this.env.BYTEPLUS_REGION,
      method: 'GET',
      host: endpoint.host,
      query,
      now: this.now()
    });
    endpoint.search = query.toString();
    let response: Response;
    try {
      response = await this.fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: authorization,
          'Content-Type': contentType,
          Host: endpoint.host,
          'X-Content-Sha256': emptyPayloadHash,
          'X-Date': xDate
        },
        signal: AbortSignal.timeout(15_000)
      });
    } catch (error) {
      throw new BytePlusVodError('BytePlus VOD request failed before receiving a response.', true);
    }
    const body = await response.json().catch(() => null) as T | null;
    const providerError = body?.ResponseMetadata?.Error;
    if (!response.ok || providerError) {
      throw new BytePlusVodError(safeProviderMessage(body, 'BytePlus VOD request failed.'), isRetryableStatus(response.status));
    }
    if (!body) throw new BytePlusVodError('BytePlus VOD returned an empty response.', true);
    return body;
  }
}

export const __bytePlusVodTestUtils = {
  createAuthorization,
  canonicalQuery,
  emptyPayloadHash
};
