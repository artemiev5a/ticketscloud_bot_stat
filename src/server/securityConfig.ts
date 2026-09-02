import { createHash } from 'node:crypto';

const MIN_SECRET_BYTES = 32;

function requiredSecret(name: 'ENCRYPTION_SECRET' | 'CACHE_KEY_SECRET'): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`${name} is required`);
  }
  if (value !== value.trim()) {
    throw new Error(`${name} must not contain leading or trailing whitespace`);
  }
  if (Buffer.byteLength(value, 'utf8') < MIN_SECRET_BYTES) {
    throw new Error(`${name} must contain at least ${MIN_SECRET_BYTES} bytes`);
  }
  return value;
}

export function getEncryptionKey(): Buffer {
  return createHash('sha256').update(requiredSecret('ENCRYPTION_SECRET'), 'utf8').digest();
}

export function getCacheKeySecret(): string {
  return requiredSecret('CACHE_KEY_SECRET');
}

export function validateSecurityConfig(): void {
  const encryptionSecret = requiredSecret('ENCRYPTION_SECRET');
  const cacheKeySecret = requiredSecret('CACHE_KEY_SECRET');
  if (encryptionSecret === cacheKeySecret) {
    throw new Error('ENCRYPTION_SECRET and CACHE_KEY_SECRET must be different');
  }
}
