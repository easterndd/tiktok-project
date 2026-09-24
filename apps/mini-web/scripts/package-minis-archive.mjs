import { createWriteStream } from 'node:fs';
import { access, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { join } from 'node:path';
import archiver from 'archiver';

const appRoot = process.cwd();
const outputRoot = join(appRoot, 'dist');
const archivePath = join(outputRoot, 'minis.config.zip');
const files = ['fallback-cover.svg', 'index.html', 'minis.config.json', 'minis.manifest.json'];

for (const file of files) await access(join(outputRoot, file));
await access(join(outputRoot, 'assets'));
await rm(archivePath, { force: true });

const output = createWriteStream(archivePath);
const archive = archiver('zip', { zlib: { level: 9 } });
const completed = once(output, 'close');

archive.on('warning', (error) => {
  if (error.code !== 'ENOENT') throw error;
});
archive.on('error', (error) => { throw error; });
archive.pipe(output);
archive.directory(join(outputRoot, 'assets'), 'assets');
for (const file of files) archive.file(join(outputRoot, file), { name: file });
await archive.finalize();
await completed;

console.log(`Created ${archivePath}.`);
