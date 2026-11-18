import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, ScryptOptions, timingSafeEqual } from 'crypto';

const ALGORITHM = 'scrypt';
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const DEFAULT_COST: Required<Pick<ScryptOptions, 'N' | 'r' | 'p'>> = {
  N: 16384,
  r: 8,
  p: 1,
};

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/**
 * Hashes passwords with Node's built-in scrypt and a random salt per password
 * (ACC-01, GEN-13). The stored value records the algorithm and cost so they can
 * be raised later without breaking existing hashes:
 * scrypt$N$r$p$<salt base64>$<hash base64>
 */
@Injectable()
export class PasswordHasherService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey(password, salt, KEY_BYTES, DEFAULT_COST);
    const { N, r, p } = DEFAULT_COST;
    return [
      ALGORITHM,
      N,
      r,
      p,
      salt.toString('base64'),
      key.toString('base64'),
    ].join('$');
  }

  /** Compares in constant time. Returns false for malformed stored values. */
  async verify(password: string, storedHash: string): Promise<boolean> {
    const parts = storedHash.split('$');
    if (parts.length !== 6 || parts[0] !== ALGORITHM) {
      return false;
    }
    const [, N, r, p, saltBase64, keyBase64] = parts;
    const expectedKey = Buffer.from(keyBase64, 'base64');
    if (expectedKey.length === 0) {
      return false;
    }
    const actualKey = await deriveKey(
      password,
      Buffer.from(saltBase64, 'base64'),
      expectedKey.length,
      { N: Number(N), r: Number(r), p: Number(p) },
    );
    return timingSafeEqual(actualKey, expectedKey);
  }
}
