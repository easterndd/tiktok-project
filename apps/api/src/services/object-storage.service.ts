import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import sharp from 'sharp';
import type { Env } from '../config/env';

export interface ObjectStorageService {
  putObject(input: {
    key: string;
    filePath: string;
    contentType: string;
  }): Promise<{ storageKey: string; publicUrl: string }>;
  deleteObject(input: { storageKey: string }): Promise<void>;
}

function assertInside(basePath: string, targetPath: string) {
  const offset = relative(resolve(basePath), resolve(targetPath));
  if (!offset || offset.startsWith('..')) {
    throw new Error('Storage key resolves outside the configured storage directory.');
  }
}

export class LocalObjectStorageService implements ObjectStorageService {
  private readonly root: string;
  private readonly publicBaseUrl: string;

  constructor(env: Env) {
    this.root = resolve(env.COVER_ASSET_STORAGE_DIR);
    this.publicBaseUrl = (env.COVER_ASSET_PUBLIC_BASE_URL ?? `${env.API_PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}`}/api/v1/assets/covers`).replace(/\/$/, '');
  }

  async putObject(input: { key: string; filePath: string; contentType: string }) {
    const targetPath = resolve(this.root, input.key);
    assertInside(this.root, targetPath);
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(input.filePath, targetPath);
    if (/^[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(input.key)) {
      const thumbnail = `${targetPath}.w360.webp`;
      const temporary = `${thumbnail}.${process.pid}.tmp`;
      try {
        await sharp(input.filePath).rotate().resize({ width: 360, withoutEnlargement: true }).webp({ quality: 78 }).toFile(temporary);
        await rename(temporary, thumbnail);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    }
    return {
      storageKey: input.key,
      publicUrl: `${this.publicBaseUrl}/${input.key.split('/').map(encodeURIComponent).join('/')}`
    };
  }

  async deleteObject(input: { storageKey: string }) {
    const targetPath = resolve(this.root, input.storageKey);
    assertInside(this.root, targetPath);
    await rm(targetPath, { force: true });
    await rm(`${targetPath}.w360.webp`, { force: true });
  }
}
