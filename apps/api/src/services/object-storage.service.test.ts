import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { LocalObjectStorageService } from './object-storage.service';
import { coverThumbnailUrl } from '../lib/cover-thumbnail';

it('stores original and generates a smaller 360px WebP thumbnail', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qr-cover-'));
  const source = join(root, 'source.png');
  await writeFile(source, await sharp({ create: { width: 900, height: 1200, channels: 3, background: 'red' } }).png().toBuffer());
  const key = `${'a'.repeat(64)}.png`;
  const storage = new LocalObjectStorageService({ COVER_ASSET_STORAGE_DIR: root, API_PUBLIC_BASE_URL: 'https://api.evergreenprosper.com', PORT: 3000 } as never);
  const result = await storage.putObject({ key, filePath: source, contentType: 'image/png' });
  const original = await stat(join(root, key));
  const thumbnail = await stat(join(root, `${key}.w360.webp`));
  assert.ok(thumbnail.size < original.size);
  assert.equal((await sharp(join(root, `${key}.w360.webp`)).metadata()).width, 360);
  assert.equal(coverThumbnailUrl(result.publicUrl), `${result.publicUrl}.w360.webp`);
});
