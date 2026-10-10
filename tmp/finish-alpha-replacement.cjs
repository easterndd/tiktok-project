const fs = require('node:fs/promises');
const { parseEnv } = require('node:util');
const base = 'https://api.evergreenprosper.com/api/taletv/v1';
const albumId = 'cmugoejl9007dp9011tzztapt';
const checkpointPath = 'tmp/material-replacement-qa/alpha-production-checkpoint.json';
const reportPath = 'tmp/material-replacement-qa/alpha-workflow.json';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
  if (checkpoint.albumId !== albumId || Object.values(checkpoint.uploads).length !== 30 || Object.values(checkpoint.uploads).some((item) => item.state !== 'BOUND')) throw new Error('All 30 replacement videos must be bound before continuing.');
  const credentials = parseEnv(await fs.readFile('C:/Users/xy/AppData/Local/Temp/taletv-replacement-credentials.env', 'utf8'));
  let token;
  const report = { albumId, actions: [] };
  async function persist() { await fs.writeFile(reportPath, JSON.stringify(report, null, 2)); }
  async function api(path, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    const result = await response.json();
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${result.error?.message ?? 'Request failed'}`);
    return result;
  }
  token = (await api('/admin/auth/login', 'POST', { email: credentials.TALETV_ADMIN_EMAIL, password: credentials.TALETV_ADMIN_PASSWORD })).accessToken;
  async function waitJob(job, albumOnly = true) {
    if (!job) return;
    for (let attempt = 0; attempt < 40; attempt++) {
      const jobs = await api(`/admin/platform-sync-jobs?${albumOnly ? 'albumId=' + albumId + '&' : ''}limit=100`);
      const latest = jobs.items.find((item) => item.id === job.id);
      if (latest && ['SUCCEEDED', 'FAILED', 'CONFLICT'].includes(latest.status)) {
        report.actions.push({ id: latest.id, kind: latest.kind, status: latest.status, providerRequestId: latest.providerRequestId, providerResponse: latest.providerResponse, errorMessage: latest.errorMessage });
        await persist();
        if (latest.status !== 'SUCCEEDED') throw new Error(`${latest.kind}: ${latest.errorMessage ?? latest.status}; request ID ${latest.providerRequestId ?? 'unknown'}`);
        return latest;
      }
      await pause(15000);
    }
    throw new Error(`Job ${job.id} is still pending. Reconcile before submitting another operation.`);
  }
  async function action(name, body) {
    console.log(`Submitting ${name}`);
    const result = await api(`/admin/albums/${albumId}/${name}`, 'POST', body);
    await waitJob(result.job);
  }
  const before = await api(`/admin/albums/${albumId}`);
  if (before.coverAssetId !== checkpoint.cover.id || before.episodes.some((item) => item.byteplusVid !== checkpoint.uploads[item.episodeNo]?.vid)) throw new Error('Live bindings do not match the replacement checkpoint.');
  if (['LISTED', '1'].includes(before.publishStatus)) await action('offline');
  const coverSync = await api(`/admin/cover-assets/${checkpoint.cover.id}/sync`, 'POST');
  await waitJob(coverSync.job, false);
  let mediaReady = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const album = await api(`/admin/albums/${albumId}`);
    const ready = album.episodes.filter((item) => item.tiktokVideoStatus === 'READY').length;
    if (album.episodes.some((item) => item.tiktokVideoStatus === 'FAILED')) {
      const failed = album.episodes.filter((item) => item.tiktokVideoStatus === 'FAILED').map(({ episodeNo, tiktokVideoError }) => ({ episodeNo, tiktokVideoError }));
      throw new Error(`Media registration failed: ${JSON.stringify(failed)}`);
    }
    if (ready === 30) { mediaReady = true; break; }
    console.log(`TikTok media ready ${ready}/30`);
    await pause(15000);
  }
  if (!mediaReady) throw new Error('Media registration is still pending.');
  const beforeVersion = await api(`/admin/albums/${albumId}`);
  if (beforeVersion.tiktokVersion === checkpoint.originalAlbum.tiktokVersion) await action('sync-version');
  let album = await api(`/admin/albums/${albumId}`);
  if (!['REVIEWING', '1', 'PASSED', '2'].includes(album.reviewStatus)) await action('review-submit', { priorityScore: 2 });
  await action('reconcile');
  album = await api(`/admin/albums/${albumId}`);
  if (['PASSED', '2'].includes(album.reviewStatus)) {
    if (album.onlineVersion !== album.tiktokVersion) await action('online-version');
    album = await api(`/admin/albums/${albumId}`);
    if (!['LISTED', '1'].includes(album.publishStatus)) await action('online');
    await action('reconcile');
    album = await api(`/admin/albums/${albumId}`);
  }
  report.final = { title: album.title, coverUrl: album.coverUrl, coverAssetId: album.coverAssetId, tiktokAlbumId: album.tiktokAlbumId, tiktokVersion: album.tiktokVersion, onlineVersion: album.onlineVersion, status: album.status, reviewStatus: album.reviewStatus, publishStatus: album.publishStatus, replacedEpisodes: album.episodes.filter((item) => item.byteplusVid === checkpoint.uploads[item.episodeNo]?.vid).length };
  await persist();
  console.log(JSON.stringify(report.final, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
