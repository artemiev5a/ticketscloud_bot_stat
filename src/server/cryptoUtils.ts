import crypto from 'crypto';

// Если переменная ENCRYPTION_SECRET не задана в .env, автоматически используется дефолтный ключ
const HARDCODED_SECRET = '7f9a8b1c2d3e4f5a6b7c8d9e0f1a2b3c';
const SECRET = process.env.ENCRYPTION_SECRET || HARDCODED_SECRET;
const ALGORITHM = 'aes-256-gcm';

/**
 * Зашифровать API-ключ перед сохранением
 */
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

/**
 * Расшифровать API-ключ перед отправкой запроса к TicketsCloud
 */
export function decryptApiKey(cipherText: string): string {
  if (!cipherText) return '';
  
  // Если ключ был сохранен до включения шифрования (в открытом виде) — возвращаем как есть
  if (!cipherText.includes(':')) return cipherText;

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
