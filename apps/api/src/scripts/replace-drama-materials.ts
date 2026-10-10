import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { loadEnv } from '../config/env';
import { BytePlusVodService, episodeMediaTitle } from '../services/byteplus-vod.service';
import { vodOpenapi } from '@byteplus/vcloud-sdk-nodejs';

type Episode = { id: string; episodeNo: number; title: string; byteplusVid: string | null; isFree?: boolean; coverAssetId?: string | null; coverUrl?: string | null };
type Album = { id: string; title: string; description?: string; language?: string; coverAssetId?: string | null; coverUrl?: string; reviewStatus?: string; episodes: Episode[]; translations?: Array<{ locale: string; title: string; description: string }> };
type Source = { episodeNo: number; filePath: string; sha256: string; duration: number; width: number; height: number; hasAudio: boolean };
type Upload = { episodeId: string; sourceHash: string; title: string; state: 'UPLOADING' | 'UPLOADED' | 'BOUND' | 'FAILED'; vid?: string; coverUrl?: string; errorMessage?: string };
type Checkpoint = { apiBase: string; albumId: string; accountId: string; spaceName: string; region: string; originalAlbum: Album; originalAlbumCaptured: boolean; sources: Source[]; posterHash: string; cover?: { id: string; publicUrl: string }; uploads: Record<number, Upload> };

const { values } = parseArgs({ options: {
  'video-dir': { type: 'string' }, cover: { type: 'string' },
  'api-base': { type: 'string' }, 'album-id': { type: 'string' }, title: { type: 'string' },
  'credentials-file': { type: 'string' }, checkpoint: { type: 'string' },
  apply: { type: 'boolean', default: false }, 'upload-only': { type: 'boolean', default: false }, 'https-upload': { type: 'boolean', default: false }
} });

function required(name: keyof typeof values) {
  const value = values[name];
  if (typeof value !== 'string' || !value) throw new Error(`Missing --${name}`);
  return value;
}

async function fileHash(filePath: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  const videoDir = resolve(required('video-dir'));
  const poster = resolve(required('cover'));
  const sources: Source[] = [];
  for (const name of await readdir(videoDir)) {
    if (!/\.mp4$/i.test(name)) continue;
    const match = name.match(/^(?:第\s*)?(\d+)(?:\s*集)?\.mp4$/i);
    if (!match) throw new Error(`Cannot determine episode number: ${name}`);
    const filePath = resolve(videoDir, name);
    const { stdout } = await promisify(execFile)('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath]);
    const info = JSON.parse(stdout);
    const video = info.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video');
    if (!video || !Number(info.format.duration)) throw new Error(`Invalid video: ${name}`);
    sources.push({ episodeNo: Number(match[1]), filePath, sha256: await fileHash(filePath), duration: Number(info.format.duration), width: video.width, height: video.height, hasAudio: info.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio') });
  }
  sources.sort((a, b) => a.episodeNo - b.episodeNo);
  if (!sources.length || sources.some((item, index) => item.episodeNo !== index + 1)) throw new Error('Episode files must be unique and contiguous, starting at 1.');
  const posterHash = await fileHash(poster);
  console.log(JSON.stringify({ sourceCount: sources.length, poster, sources }, null, 2));
  if (!values['credentials-file'] && !values['upload-only']) {
    if (values.apply) throw new Error('Missing --credentials-file');
    console.log('Inspection only. No media uploaded and no records changed.');
    return;
  }
  const credentials = values['credentials-file'] ? parseEnv(await readFile(resolve(required('credentials-file')), 'utf8')) : {};
  const adminEmail = process.env.TALETV_ADMIN_EMAIL ?? credentials.TALETV_ADMIN_EMAIL ?? credentials.ADMIN_EMAIL ?? credentials.ADMIN_BOOTSTRAP_EMAIL;
  const adminPassword = process.env.TALETV_ADMIN_PASSWORD ?? credentials.TALETV_ADMIN_PASSWORD ?? credentials.ADMIN_PASSWORD ?? credentials.ADMIN_BOOTSTRAP_PASSWORD;
  if (!values['upload-only'] && (!adminEmail || !adminPassword)) throw new Error('Credentials file requires an administrator email and password for the target app.');
  const apiBase = required('api-base').replace(/\/$/, '');
  if (new URL(apiBase).protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(new URL(apiBase).hostname)) throw new Error('Remote API must use HTTPS.');
  let accessToken = '';
  async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${apiBase}${path}`, { ...options, headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.body instanceof FormData || !options.body ? {} : { 'Content-Type': 'application/json' })
    }, signal: AbortSignal.timeout(60_000) });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${body?.error?.message ?? 'Request failed'}`);
    return body as T;
  }
  if (!values['upload-only']) accessToken = (await api<{ accessToken: string }>('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: adminEmail, password: adminPassword }) })).accessToken;
  const albumId = required('album-id');
  const expectedTitle = required('title');
  const album = values['upload-only'] ? {
    ...await api<Album>(`/albums/${albumId}`),
    episodes: (await api<{ items: Episode[] }>(`/albums/${albumId}/episodes`)).items
  } : await api<Album>(`/admin/albums/${albumId}`);
  if (album.title.replace(/[《》]/g, '').trim() !== expectedTitle.replace(/[《》]/g, '').trim()) throw new Error('Target album title does not match --title.');
  if (['REVIEWING', '1'].includes(album.reviewStatus ?? '')) throw new Error('Target album is under review.');
  if (album.episodes.length !== sources.length || sources.some((source) => !album.episodes.some((episode) => episode.episodeNo === source.episodeNo))) throw new Error('Source episodes do not match target episode numbers.');
  const env = loadEnv();
  const sdk = new vodOpenapi.VodService({ region: env.BYTEPLUS_REGION, host: new URL(env.BYTEPLUS_VOD_ENDPOINT).host, serviceName: 'vod', defaultVersion: '2023-01-01' });
  sdk.setAccessKeyId(env.BYTEPLUS_ACCESS_KEY!);
  sdk.setSecretKey(env.BYTEPLUS_SECRET_KEY!);
  // Reuse the existing multipart transport when the SDK's HTTP upload is interrupted.
  const vod = values['https-upload'] ? new BytePlusVodService(env, {
    vodService: new Proxy(sdk, { get: (target, key) => key === 'UploadMedia' ? undefined : Reflect.get(target, key) }),
    uploadFetch: (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      url.protocol = 'https:';
      return fetch(url, init);
    }
  }) : new BytePlusVodService(env);
  if (!values['upload-only']) {
    const existingMedia = await vod.getMediaInfos({ vids: [album.episodes[0].byteplusVid!].filter(Boolean) });
    if (!existingMedia.length || existingMedia[0].spaceName !== env.BYTEPLUS_SPACE_NAME) throw new Error('Local BytePlus credentials cannot read the target album media in the configured space.');
  }
  console.log(JSON.stringify({ albumId, title: album.title, accountId: env.BYTEPLUS_ACCOUNT_ID, spaceName: env.BYTEPLUS_SPACE_NAME, region: env.BYTEPLUS_REGION, episodeCount: sources.length, mode: values.apply ? 'apply' : 'preview' }, null, 2));
  if (!values.apply) return;
  if (!values['upload-only']) {
    const jobs = await api<{ items: Array<{ status: string }> }>(`/admin/platform-sync-jobs?albumId=${encodeURIComponent(albumId)}&limit=100`);
    if (jobs.items.some((job) => ['PENDING', 'PROCESSING', 'CONFLICT'].includes(job.status))) throw new Error('Resolve active or uncertain platform jobs before replacing materials.');
  }
  const checkpointPath = resolve(required('checkpoint'));
  await mkdir(dirname(checkpointPath), { recursive: true });
  const lockPath = `${checkpointPath}.lock`;
  const lock = await open(lockPath, 'wx');
  try {
    let checkpoint: Checkpoint;
    try { checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      checkpoint = { apiBase, albumId, accountId: env.BYTEPLUS_ACCOUNT_ID, spaceName: env.BYTEPLUS_SPACE_NAME, region: env.BYTEPLUS_REGION, originalAlbum: album, originalAlbumCaptured: !values['upload-only'], sources, posterHash, uploads: {} };
    }
    if (checkpoint.apiBase !== apiBase || checkpoint.albumId !== albumId || checkpoint.accountId !== env.BYTEPLUS_ACCOUNT_ID || checkpoint.spaceName !== env.BYTEPLUS_SPACE_NAME || checkpoint.region !== env.BYTEPLUS_REGION || checkpoint.posterHash !== posterHash || JSON.stringify(checkpoint.sources) !== JSON.stringify(sources)) throw new Error('Checkpoint does not match this target, media account or source files.');
    async function persist() {
      await open(`${checkpointPath}.tmp`, 'w').then(async (file) => { try { await file.writeFile(JSON.stringify(checkpoint, null, 2)); await file.sync(); } finally { await file.close(); } });
      await rename(`${checkpointPath}.tmp`, checkpointPath);
    }
    if (!values['upload-only'] && !checkpoint.originalAlbumCaptured) {
      checkpoint.originalAlbum = album;
      checkpoint.originalAlbumCaptured = true;
    }
    await persist();
    // Finish uploading every source before changing the existing episode bindings.
    for (const source of sources) {
      const episode = album.episodes.find((item) => item.episodeNo === source.episodeNo)!;
      const previous = checkpoint.uploads[source.episodeNo];
      if (previous?.vid) continue;
      if (previous?.state === 'UPLOADING') throw new Error(`Episode ${source.episodeNo}: previous upload result is uncertain. Reconcile BytePlus title ${previous.title} before retrying.`);
      const upload: Upload = { episodeId: episode.id, sourceHash: source.sha256, title: episodeMediaTitle(expectedTitle, source.episodeNo), state: 'UPLOADING' };
      checkpoint.uploads[source.episodeNo] = upload;
      await persist();
      console.log(`Uploading episode ${source.episodeNo}/${sources.length}`);
      let result;
      try {
        result = await vod.uploadLocalVideo({ filePath: source.filePath, fileName: `${source.episodeNo}.mp4`, title: upload.title, spaceName: env.BYTEPLUS_SPACE_NAME, byteplusAccountId: env.BYTEPLUS_ACCOUNT_ID });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed';
        if (/upload part error|init upload error|BytePlus 分片(上传|初始化)/i.test(message)) upload.state = 'FAILED';
        upload.errorMessage = message.slice(0, 240);
        await persist();
        throw error;
      }
      Object.assign(upload, { vid: result.byteplusVid, coverUrl: result.coverUrl, state: 'UPLOADED' });
      await persist();
    }
    if (values['upload-only']) {
      console.log(JSON.stringify({ uploaded: Object.keys(checkpoint.uploads).length, checkpointPath, vids: Object.entries(checkpoint.uploads).map(([episodeNo, upload]) => ({ episodeNo: Number(episodeNo), vid: upload.vid })) }, null, 2));
      console.log('BytePlus upload stage complete. Existing app bindings remain unchanged.');
      return;
    }
    if (!checkpoint.cover) {
      const form = new FormData();
      const bytes = await readFile(poster);
      const mime = /\.png$/i.test(poster) ? 'image/png' : /\.webp$/i.test(poster) ? 'image/webp' : 'image/jpeg';
      form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), `replacement-cover.${mime.split('/')[1]}`);
      checkpoint.cover = await api('/admin/cover-assets', { method: 'POST', body: form });
      await persist();
    }
    await api(`/admin/albums/${albumId}`, { method: 'PATCH', body: JSON.stringify({ coverAssetId: checkpoint.cover!.id, description: checkpoint.originalAlbum.description || expectedTitle, language: checkpoint.originalAlbum.language ?? 'en' }) });
    for (const translation of album.translations ?? []) {
      await api('/admin/translations', { method: 'POST', body: JSON.stringify({ kind: 'album', contentId: albumId, ...translation, coverUrl: null }) });
    }
    for (const source of sources) {
      const upload = checkpoint.uploads[source.episodeNo];
      if (upload.state === 'BOUND') continue;
      const latest = await api<Album>(`/admin/albums/${albumId}`);
      const episode = latest.episodes.find((item) => item.id === upload.episodeId);
      const original = checkpoint.originalAlbum.episodes.find((item) => item.id === upload.episodeId);
      if (!episode || (episode.byteplusVid !== original?.byteplusVid && episode.byteplusVid !== upload.vid)) throw new Error(`Episode ${source.episodeNo} changed since the plan was created.`);
      if (episode.byteplusVid !== upload.vid) await api(`/admin/episodes/${episode.id}/bind-byteplus`, { method: 'POST', body: JSON.stringify({ byteplusVid: upload.vid, coverAssetId: null }) });
      // Also works against deployments made before bind-byteplus accepted coverAssetId.
      await api(`/admin/episodes/${episode.id}`, { method: 'PATCH', body: JSON.stringify({ coverAssetId: null, coverUrl: checkpoint.cover!.publicUrl, isFree: original?.isFree }) });
      upload.state = 'BOUND';
      await persist();
      console.log(`Bound episode ${source.episodeNo} -> ${upload.vid}`);
    }
    const verified = await api<Album>(`/admin/albums/${albumId}`);
    if (verified.coverAssetId !== checkpoint.cover!.id || sources.some((source) => verified.episodes.find((item) => item.episodeNo === source.episodeNo)?.byteplusVid !== checkpoint.uploads[source.episodeNo].vid)) throw new Error('Final verification failed. Keep the checkpoint and reconcile before retrying.');
    console.log('Materials replaced and verified. Media registration is queued. Review and publication have not been submitted.');
  } finally { await lock.close(); await unlink(lockPath); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Replacement failed.'); process.exitCode = 1; });
