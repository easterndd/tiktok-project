import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const N = 16_384;
const r = 8;
const p = 1;
const keyLength = 64;

function deriveKey(password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number; maxmem: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt, keyLength, { N, r, p, maxmem: 32 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt.toString('base64url'), derivedKey.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, encodedN, encodedR, encodedP, encodedSalt, encodedKey] = encoded.split('$');
  if (algorithm !== 'scrypt' || !encodedN || !encodedR || !encodedP || !encodedSalt || !encodedKey) return false;

  const cost = Number(encodedN);
  const blockSize = Number(encodedR);
  const parallelization = Number(encodedP);
  if (!Number.isSafeInteger(cost) || !Number.isSafeInteger(blockSize) || !Number.isSafeInteger(parallelization)) return false;
  if (cost < 1_024 || cost > 262_144 || blockSize < 1 || blockSize > 32 || parallelization < 1 || parallelization > 16) return false;

  try {
    const salt = Buffer.from(encodedSalt, 'base64url');
    const expected = Buffer.from(encodedKey, 'base64url');
    const actual = await deriveKey(password, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelization,
      maxmem: 64 * 1024 * 1024
    }) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
