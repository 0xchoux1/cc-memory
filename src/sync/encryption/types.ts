/**
 * Encryption Types for cc-memory sync
 * AES-256-GCM encryption with PBKDF2-SHA512 key derivation
 */

// ============================================================================
// Encryption Configuration Types
// ============================================================================

/**
 * Configuration for encryption
 * Passphrase can be provided via:
 * 1. Environment variable (passphraseEnvVar)
 * 2. Key file (keyfilePath)
 * 3. Direct passphrase (passphrase) - not recommended for production
 */
export interface EncryptionConfig {
  /** Environment variable name containing the passphrase */
  passphraseEnvVar?: string;

  /** Path to a key file (should have 600 permissions) */
  keyfilePath?: string;

  /** Direct passphrase - use only for testing */
  passphrase?: string;

  /** Number of PBKDF2 iterations (default: 100000) */
  kdfIterations?: number;
}

// ============================================================================
// Encrypted Payload Types
// ============================================================================

/** Current encryption payload version */
export const ENCRYPTED_PAYLOAD_VERSION = 1;

/** Supported encryption algorithms */
export type EncryptionAlgorithm = 'aes-256-gcm';

/** Supported key derivation functions */
export type KeyDerivationFunction = 'pbkdf2-sha512';

/**
 * Encrypted payload structure
 * This is the format stored/transmitted when data is encrypted
 */
export interface EncryptedPayload {
  /** Payload format version */
  version: typeof ENCRYPTED_PAYLOAD_VERSION;

  /** Encryption algorithm used */
  algorithm: EncryptionAlgorithm;

  /** Key derivation function used */
  kdf: KeyDerivationFunction;

  /** Number of KDF iterations */
  kdfIterations: number;

  /** Salt used for key derivation (base64 encoded) */
  salt: string;

  /** Initialization vector (base64 encoded) */
  iv: string;

  /** Authentication tag (base64 encoded) */
  authTag: string;

  /** Encrypted data (base64 encoded) */
  ciphertext: string;
}

// ============================================================================
// Encryption Constants
// ============================================================================

/** Default number of PBKDF2 iterations */
export const DEFAULT_KDF_ITERATIONS = 100000;

/** Salt size in bytes */
export const SALT_SIZE = 16;

/** IV size in bytes (for AES-256-GCM) */
export const IV_SIZE = 12;

/** Key size in bytes (for AES-256) */
export const KEY_SIZE = 32;

/** Auth tag size in bytes (for GCM) */
export const AUTH_TAG_SIZE = 16;

/** Default environment variable name for passphrase */
export const DEFAULT_PASSPHRASE_ENV_VAR = 'CC_MEMORY_SYNC_PASSPHRASE';

/** Default key file path */
export const DEFAULT_KEYFILE_PATH = '~/.cc-memory/sync.key';

// ============================================================================
// Error Types
// ============================================================================

/** Encryption-related error codes */
export type EncryptionErrorCode =
  | 'NO_PASSPHRASE'
  | 'INVALID_PASSPHRASE'
  | 'DECRYPTION_FAILED'
  | 'INVALID_PAYLOAD'
  | 'KEYFILE_NOT_FOUND'
  | 'KEYFILE_PERMISSION_ERROR'
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_ALGORITHM';

/**
 * Custom error class for encryption-related errors
 */
export class EncryptionError extends Error {
  constructor(
    public readonly code: EncryptionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'EncryptionError';
  }
}
