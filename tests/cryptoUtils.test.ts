import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptApiKey, encryptApiKey } from '../src/server/cryptoUtils.ts';
import { validateSecurityConfig } from '../src/server/securityConfig.ts';

const TEST_ENCRYPTION_SECRET = 'test-only-encryption-secret-32-bytes-minimum';
const TEST_CACHE_SECRET = 'test-only-cache-secret-32-bytes-minimum';

test('encrypts API keys with authenticated encryption', () => {
  process.env.ENCRYPTION_SECRET = TEST_ENCRYPTION_SECRET;
  process.env.CACHE_KEY_SECRET = TEST_CACHE_SECRET;

  const first = encryptApiKey('organizer-api-key');
  const second = encryptApiKey('organizer-api-key');

  assert.notEqual(first, second);
  assert.equal(decryptApiKey(first), 'organizer-api-key');
  assert.equal(decryptApiKey(second), 'organizer-api-key');
});

test('rejects missing and weak production secrets', () => {
  const previousEncryption = process.env.ENCRYPTION_SECRET;
  const previousCache = process.env.CACHE_KEY_SECRET;

  try {
    delete process.env.ENCRYPTION_SECRET;
    process.env.CACHE_KEY_SECRET = TEST_CACHE_SECRET;
    assert.throws(() => validateSecurityConfig(), /ENCRYPTION_SECRET is required/);

    process.env.ENCRYPTION_SECRET = 'too-short';
    assert.throws(() => validateSecurityConfig(), /ENCRYPTION_SECRET must contain at least 32 bytes/);

    process.env.ENCRYPTION_SECRET = TEST_ENCRYPTION_SECRET;
    delete process.env.CACHE_KEY_SECRET;
    assert.throws(() => validateSecurityConfig(), /CACHE_KEY_SECRET is required/);

    process.env.CACHE_KEY_SECRET = TEST_ENCRYPTION_SECRET;
    assert.throws(() => validateSecurityConfig(), /must be different/);
  } finally {
    if (previousEncryption === undefined) delete process.env.ENCRYPTION_SECRET;
    else process.env.ENCRYPTION_SECRET = previousEncryption;
    if (previousCache === undefined) delete process.env.CACHE_KEY_SECRET;
    else process.env.CACHE_KEY_SECRET = previousCache;
  }
});

test('never treats plaintext or tampered ciphertext as an API key', () => {
  process.env.ENCRYPTION_SECRET = TEST_ENCRYPTION_SECRET;

  assert.throws(() => decryptApiKey('plaintext-api-key'), /Не удалось расшифровать API-ключ/);

  const encrypted = encryptApiKey('organizer-api-key');
  const last = encrypted.at(-1) === '0' ? '1' : '0';
  const tampered = `${encrypted.slice(0, -1)}${last}`;
  assert.throws(() => decryptApiKey(tampered), /Не удалось расшифровать API-ключ/);
});
