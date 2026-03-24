const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function getKey() {
  const key = process.env.AES_KEY;
  if (!key || key.length !== 64) {
    throw new Error('AES_KEY must be a 64-character hex string (256 bits)');
  }
  return Buffer.from(key, 'hex');
}

function encrypt(text) {
  if (!text) return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(String(text), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText) {
  if (!encryptedText) return null;
  const key = getKey();
  const parts = encryptedText.split(':');
  if (parts.length !== 2) return encryptedText; // 평문 데이터 호환
  const iv = Buffer.from(parts[0], 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(parts[1], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function hashEmail(email) {
  const hmacKey = process.env.AES_KEY;
  if (!hmacKey) throw new Error('AES_KEY is required for HMAC');
  return crypto.createHmac('sha256', hmacKey).update(String(email).toLowerCase().trim()).digest('hex');
}

module.exports = { encrypt, decrypt, hashEmail };
