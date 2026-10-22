import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const appRoot = process.cwd();
const appKey = basename(appRoot);
if (!/^[a-z][a-z0-9-]*$/.test(appKey)) throw new Error('Invalid mini app directory name.');

const builtAt = new Date();
const stamp = builtAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const releaseId = `${appKey}-${stamp}-${randomBytes(3).toString('hex')}`;
const env = { ...process.env, VITE_MINI_RELEASE_ID: releaseId };

function run(command, args) {
  const options = {
    cwd: appRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  };
  const result = process.platform === 'win32'
    ? spawnSync([command, ...args].join(' '), options)
    : spawnSync(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Building ${appKey} with code version ${releaseId}`);
run('pnpm', ['build']);
run('ttdx', ['minis', 'build', '--prod']);
run('ttdx', ['minis', 'check', '--output']);
run('node', ['../mini-web/scripts/check-release.mjs']);

const dist = join(appRoot, 'dist');
const assets = (await readdir(join(dist, 'assets'))).filter((name) => name.endsWith('.js'));
if (!assets.length || !(await Promise.all(assets.map((name) => readFile(join(dist, 'assets', name), 'utf8')))).some((source) => source.includes(releaseId))) {
  throw new Error(`Built JavaScript does not contain code version ${releaseId}.`);
}

run('node', ['../mini-web/scripts/package-minis-archive.mjs']);
const archive = await readFile(join(dist, 'minis.config.zip'));
const config = JSON.parse(await readFile(join(dist, 'minis.config.json'), 'utf8'));
const record = {
  appKey,
  appId: config.appId,
  releaseId,
  builtAt: builtAt.toISOString(),
  archiveSha256: createHash('sha256').update(archive).digest('hex')
};
await writeFile(join(dist, 'minis.release.json'), `${JSON.stringify(record, null, 2)}\n`);
console.log(`Code version ${releaseId} recorded in ${join(dist, 'minis.release.json')}.`);
