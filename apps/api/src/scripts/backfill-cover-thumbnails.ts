import { readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

export async function backfillCoverThumbnails(root: string) {
  const names = (await readdir(root)).filter((name) => /^[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(name));
  let generated = 0;
  for (const name of names) {
    const source = join(root, name);
    const destination = `${source}.w360.webp`;
    try { if ((await stat(destination)).size > 0) continue; } catch { /* Missing thumbnail. */ }
    const temporary = `${destination}.${process.pid}.tmp`;
    try {
      await sharp(source).rotate().resize({ width: 360, withoutEnlargement: true }).webp({ quality: 78 }).toFile(temporary);
      await rename(temporary, destination);
      generated++;
    } catch (error) {
      await rm(temporary, { force: true });
      throw new Error(`Thumbnail failed for ${name}`, { cause: error });
    }
  }
  return { originals: names.length, generated };
}

if (require.main === module) {
  backfillCoverThumbnails(process.env.COVER_ASSET_STORAGE_DIR ?? '/var/lib/quickreels/cover-assets')
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
