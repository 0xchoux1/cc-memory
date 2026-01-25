/**
 * Crypto Utilities for cc-memory sync
 * Provides AES-256-GCM encryption with PBKDF2-SHA512 key derivation
 */

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';
import type { EncryptionConfig, EncryptedPayload } from './types.js';
import {
  EncryptionError,
  DEFAULT_KDF_ITERATIONS,
  SALT_SIZE,
  IV_SIZE,
  KEY_SIZE,
  AUTH_TAG_SIZE,
  ENCRYPTED_PAYLOAD_VERSION,
  DEFAULT_PASSPHRASE_ENV_VAR,
} from './types.js';

/**
 * Resolve passphrase from config
 * Tries in order: direct passphrase, environment variable, keyfile
 */
export function resolvePassphrase(config: EncryptionConfig): string {
  // 1. Direct passphrase
  if (config.passphrase) {
    return config.passphrase;
  }

  // 2. Environment variable
  const envVar = config.passphraseEnvVar || DEFAULT_PASSPHRASE_ENV_VAR;
  const envPassphrase = process.env[envVar];
  if (envPassphrase) {
    return envPassphrase;
  }

  // 3. Keyfile
  if (config.keyfilePath) {
    const keyfilePath = expandPath(config.keyfilePath);
    return readKeyfile(keyfilePath);
  }

  throw new EncryptionError(
    'NO_PASSPHRASE',
    `No passphrase found. Set ${envVar} environment variable, provide a keyfile, or specify passphrase directly.`
  );
}

/**
 * Expand ~ to home directory in path
 */
export function expandPath(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return resolve(homedir(), filePath.slice(2));
  }
  return resolve(filePath);
}

/**
 * Read passphrase from keyfile
 * Validates file permissions (should be 600 on Unix)
 */
function readKeyfile(keyfilePath: string): string {
  if (!existsSync(keyfilePath)) {
    throw new EncryptionError(
      'KEYFILE_NOT_FOUND',
      `Keyfile not found: ${keyfilePath}`
    );
  }

  // Check file permissions on Unix
  if (process.platform !== 'win32') {
    const stats = statSync(keyfilePath);
    const mode = stats.mode & 0o777;
    if (mode !== 0o600) {
      throw new EncryptionError(
        'KEYFILE_PERMISSION_ERROR',
        `Keyfile has insecure permissions (${mode.toString(8)}). Should be 600.`
      );
    }
  }

  const content = readFileSync(keyfilePath, 'utf-8');
  const passphrase = content.trim();

  if (!passphrase) {
    throw new EncryptionError(
      'INVALID_PASSPHRASE',
      'Keyfile is empty'
    );
  }

  return passphrase;
}

/**
 * Derive encryption key from passphrase using PBKDF2-SHA512
 */
function deriveKey(passphrase: string, salt: Buffer, iterations: number): Buffer {
  return pbkdf2Sync(passphrase, salt, iterations, KEY_SIZE, 'sha512');
}

/**
 * Encrypt data using AES-256-GCM
 */
export function encrypt(
  data: string,
  passphrase: string,
  iterations: number = DEFAULT_KDF_ITERATIONS
): EncryptedPayload {
  // Generate random salt and IV
  const salt = randomBytes(SALT_SIZE);
  const iv = randomBytes(IV_SIZE);

  // Derive key
  const key = deriveKey(passphrase, salt, iterations);

  // Create cipher and encrypt
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(data, 'utf-8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return {
    version: ENCRYPTED_PAYLOAD_VERSION,
    algorithm: 'aes-256-gcm',
    kdf: 'pbkdf2-sha512',
    kdfIterations: iterations,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

/**
 * Decrypt encrypted payload using AES-256-GCM
 */
export function decrypt(
  payload: EncryptedPayload,
  passphrase: string
): string {
  // Validate payload
  validatePayload(payload);

  // Decode base64 values
  const salt = Buffer.from(payload.salt, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');

  // Validate sizes
  if (salt.length !== SALT_SIZE) {
    throw new EncryptionError('INVALID_PAYLOAD', `Invalid salt size: ${salt.length}`);
  }
  if (iv.length !== IV_SIZE) {
    throw new EncryptionError('INVALID_PAYLOAD', `Invalid IV size: ${iv.length}`);
  }
  if (authTag.length !== AUTH_TAG_SIZE) {
    throw new EncryptionError('INVALID_PAYLOAD', `Invalid auth tag size: ${authTag.length}`);
  }

  // Derive key
  const key = deriveKey(passphrase, salt, payload.kdfIterations);

  // Create decipher and decrypt
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);

    return decrypted.toString('utf-8');
  } catch (error) {
    throw new EncryptionError(
      'DECRYPTION_FAILED',
      'Decryption failed. Invalid passphrase or corrupted data.'
    );
  }
}

/**
 * Validate encrypted payload structure
 */
function validatePayload(payload: unknown): asserts payload is EncryptedPayload {
  if (!payload || typeof payload !== 'object') {
    throw new EncryptionError('INVALID_PAYLOAD', 'Payload must be an object');
  }

  const p = payload as Record<string, unknown>;

  if (p.version !== ENCRYPTED_PAYLOAD_VERSION) {
    throw new EncryptionError(
      'UNSUPPORTED_VERSION',
      `Unsupported payload version: ${p.version}. Expected: ${ENCRYPTED_PAYLOAD_VERSION}`
    );
  }

  if (p.algorithm !== 'aes-256-gcm') {
    throw new EncryptionError(
      'UNSUPPORTED_ALGORITHM',
      `Unsupported algorithm: ${p.algorithm}`
    );
  }

  if (p.kdf !== 'pbkdf2-sha512') {
    throw new EncryptionError(
      'UNSUPPORTED_ALGORITHM',
      `Unsupported KDF: ${p.kdf}`
    );
  }

  const requiredFields = ['salt', 'iv', 'authTag', 'ciphertext', 'kdfIterations'];
  for (const field of requiredFields) {
    if (typeof p[field] === 'undefined') {
      throw new EncryptionError('INVALID_PAYLOAD', `Missing required field: ${field}`);
    }
  }
}

/**
 * Check if an object looks like an encrypted payload
 */
export function isEncryptedPayload(data: unknown): data is EncryptedPayload {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const p = data as Record<string, unknown>;

  return (
    p.version === ENCRYPTED_PAYLOAD_VERSION &&
    p.algorithm === 'aes-256-gcm' &&
    p.kdf === 'pbkdf2-sha512' &&
    typeof p.salt === 'string' &&
    typeof p.iv === 'string' &&
    typeof p.authTag === 'string' &&
    typeof p.ciphertext === 'string'
  );
}
