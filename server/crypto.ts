import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

let cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const envKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (envKey && envKey.length >= 16) {
    cachedKey = crypto.createHash('sha256').update(envKey).digest();
    return cachedKey;
  }

  const baseDir = process.env.VERCEL ? '/tmp' : process.cwd();
  const dataDir = path.join(baseDir, '.data');
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const keyFile = path.join(dataDir, '.encryption.key');
    if (fs.existsSync(keyFile)) {
      const raw = fs.readFileSync(keyFile, 'utf8').trim();
      cachedKey = Buffer.from(raw, 'hex');
      return cachedKey;
    }

    const generated = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, generated.toString('hex'), { mode: 0o600 });
    cachedKey = generated;
    return cachedKey;
  } catch {
    // Ephemeral fallback if runtime filesystem is completely read-only
    cachedKey = crypto
      .createHash('sha256')
      .update(process.env.AUTH_SESSION_SECRET || 'leadflow-ephemeral-fallback-key')
      .digest();
    return cachedKey;
  }
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }
  const [ivHex, tagHex, dataHex] = parts;
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function verifyMetaSignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false;
  const [algo, receivedHex] = signatureHeader.split('=');
  if (algo !== 'sha256' || !receivedHex) return false;
  const expectedHex = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(receivedHex, 'hex'), Buffer.from(expectedHex, 'hex'));
  } catch {
    return false;
  }
}
