import crypto from 'node:crypto';
import { getEncryptionKey } from './securityConfig.ts';

const ALGORITHM = 'aes-256-gcm';

/**
 * Зашифровать API-ключ перед сохранением
 */
export function encryptApiKey(text: string): string {
  if (!text) return '';
  
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Расшифровать API-ключ перед отправкой запроса к TicketsCloud
 */
export function decryptApiKey(cipherText: string): string {
  if (!cipherText) return '';

  try {
    const parts = cipherText.split(':');
    if (parts.length !== 3) throw new Error('invalid encrypted value format');
    const [ivHex, authTagHex, encryptedText] = parts;
    if (!/^[0-9a-f]{24}$/i.test(ivHex)) throw new Error('invalid IV');
    if (!/^[0-9a-f]{32}$/i.test(authTagHex)) throw new Error('invalid authentication tag');
    if (!/^(?:[0-9a-f]{2})+$/i.test(encryptedText)) throw new Error('invalid ciphertext');

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    console.error('❌ Не удалось расшифровать API-ключ. Пользователь должен указать ключ повторно.');
    throw new Error('Не удалось расшифровать API-ключ');
  }
}
