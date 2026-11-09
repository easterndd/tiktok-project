import { access, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { v006Placements, validateV006Placements } from './v006-placements.mjs';

const root = join(process.cwd(), 'dist');
const appKey = basename(process.cwd());
validateV006Placements();
const v006Placement = v006Placements[appKey];
const envFile = existsSync('.env.production') ? '.env.production' : '.env';
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);
const failures = [];
const apiBaseUrl = process.env.VITE_API_BASE_URL;
const clientKey = process.env.VITE_TIKTOK_CLIENT_KEY;
let foundApiBaseUrl = false;
let foundClientKey = false;
let builtSources = '';

try {
  await access(join(root, 'minis.config.json'));
} catch {
  failures.push('minis.config.json is missing; run `pnpm build:minis:release` before check:release');
}
const config = failures.length ? {} : JSON.parse(await readFile(join(root, 'minis.config.json'), 'utf8'));

if (!config.appId || !/^\d+$/.test(config.appId)) failures.push('minis.config.json appId is missing or invalid');
if (!config.build?.outputDir) failures.push('minis.config.json build.outputDir is missing');
if (!apiBaseUrl) failures.push('VITE_API_BASE_URL must be set for a production Mini build');
else if (!/^https:\/\//.test(apiBaseUrl) || /localhost/i.test(apiBaseUrl)) failures.push('VITE_API_BASE_URL must be a non-localhost HTTPS URL');
if (!clientKey) failures.push('VITE_TIKTOK_CLIENT_KEY must be set for a production Mini build');
else if (/REPLACE_WITH|your_|placeholder|^</i.test(clientKey)) failures.push('VITE_TIKTOK_CLIENT_KEY is still a placeholder');

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.(html|js|css|json)$/i.test(entry.name)) {
      const content = await readFile(path, 'utf8');
      if (entry.name.endsWith('.js')) builtSources += content;
      if (apiBaseUrl && content.includes(apiBaseUrl)) foundApiBaseUrl = true;
      if (clientKey && content.includes(clientKey)) foundClientKey = true;
      if (/REPLACE_WITH|your_tiktok_client_key|your_rewarded_placement_id|your_interstitial_placement_id/i.test(content)) failures.push(`${path} contains a placeholder credential`);
    }
  }
}

await scan(root);
const placementConfigPath = join(process.cwd(), '../mini-web/src/features/ads/entry-ad-placement-config.json');
try {
  const placementConfig = JSON.parse(await readFile(placementConfigPath, 'utf8'));
  for (const placementId of placementConfig[appKey] ?? []) {
    if (!builtSources.includes(placementId)) failures.push(`built Mini output does not contain configured entry placement ${placementId}`);
  }
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
if (v006Placement) {
  if (config.appId !== v006Placement.appId) failures.push('Mini App ID does not match the v0.0.6 placement manifest');
  const releaseId = process.env.VITE_MINI_RELEASE_ID ?? '';
  if (!releaseId.startsWith(appKey + '-v006-') || !builtSources.includes(releaseId)) failures.push('built Mini output does not contain the expected v0.0.6 release ID');
  for (const placementId of [...v006Placement.rewarded, ...v006Placement.interstitial]) {
    if (!builtSources.includes(placementId)) failures.push('built Mini output is missing its configured placement ' + placementId);
  }
  for (const [otherApp, otherPlacement] of Object.entries(v006Placements)) {
    if (otherApp === appKey) continue;
    for (const placementId of [...otherPlacement.rewarded, ...otherPlacement.interstitial]) {
      if (builtSources.includes(placementId)) failures.push('built Mini output contains another app placement ' + placementId);
    }
  }
}
if (apiBaseUrl && !foundApiBaseUrl) failures.push('built Mini output does not contain VITE_API_BASE_URL');
if (clientKey && !foundClientKey) failures.push('built Mini output does not contain VITE_TIKTOK_CLIENT_KEY');
if (failures.length) {
  console.error('Mini release check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Mini release check passed.');
