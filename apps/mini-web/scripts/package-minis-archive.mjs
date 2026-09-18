import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const outputRoot = join(appRoot, 'dist');
const archivePath = join(outputRoot, 'minis.config.zip');
const releaseEntries = ['assets', 'local-test-media', 'fallback-cover.svg', 'index.html', 'minis.config.json', 'minis.manifest.json'];

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  };
}

function localHeader(entry) {
  const header = Buffer.alloc(30 + entry.name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(entry.time, 10);
  header.writeUInt16LE(entry.date, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressed.length, 18);
  header.writeUInt32LE(entry.source.length, 22);
  header.writeUInt16LE(entry.name.length, 26);
  entry.name.copy(header, 30);
  return header;
}

function centralHeader(entry, offset) {
  const header = Buffer.alloc(46 + entry.name.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(entry.time, 12);
  header.writeUInt16LE(entry.date, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressed.length, 20);
  header.writeUInt32LE(entry.source.length, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  entry.name.copy(header, 46);
  return header;
}

async function collectFiles(path) {
  const details = await stat(path);
  if (details.isFile()) return [path];
  const children = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(children.sort((a, b) => a.name.localeCompare(b.name)).map((child) => collectFiles(join(path, child.name))));
  return nested.flat();
}

const files = (await Promise.all(releaseEntries.map((entry) => collectFiles(join(outputRoot, entry))))).flat();
const entries = await Promise.all(files.map(async (path) => {
  const source = await readFile(path);
  const modifiedAt = (await stat(path)).mtime;
  const { date, time } = dosDateTime(modifiedAt);
  return {
    name: Buffer.from(relative(outputRoot, path).replaceAll('\\', '/')),
    source,
    compressed: deflateRawSync(source),
    crc: crc32(source),
    date,
    time
  };
}));

await rm(archivePath, { force: true });
let offset = 0;
const locals = entries.map((entry) => {
  const header = localHeader(entry);
  offset += header.length + entry.compressed.length;
  return Buffer.concat([header, entry.compressed]);
});
const centralOffset = offset;
const centrals = [];
offset = 0;
for (const entry of entries) {
  const header = centralHeader(entry, offset);
  centrals.push(header);
  offset += localHeader(entry).length + entry.compressed.length;
}
const centralSize = centrals.reduce((total, header) => total + header.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(centralOffset, 16);
await writeFile(archivePath, Buffer.concat([...locals, ...centrals, end]));
console.log(`Created ${archivePath} with ${entries.length} files.`);
