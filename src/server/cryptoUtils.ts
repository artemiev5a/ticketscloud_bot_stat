import crypto from 'crypto';

const SECRET = process.env.ENCRYPTION_SECRET || '32_chars_secret_key_ticketscloud!';
const ALGORITHM = 'aes-256-gcm';

export function encryptApiKey(text: string): string {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const key = Buffer.from(SECRET.padEnd(32).slice(0, 32));
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptApiKey(cipherText: string): string {
  if (!cipherText) return '';
  if (!cipherText.includes(':')) return cipherText; // Если ключ был сохранен в открытом виде

  try {
    const [ivHex, authTagHex, encryptedText] = cipherText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = Buffer.from(SECRET.padEnd(32).slice(0, 32));
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('❌ Ошибка расшифровки API-ключа:', error);
    return cipherText;
  }
}
