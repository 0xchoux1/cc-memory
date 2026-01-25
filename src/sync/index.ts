/**
 * Sync module exports for cc-memory
 */

export * from './types.js';
export { SyncManager } from './SyncManager.js';
export { FileSyncAdapter } from './adapters/FileSyncAdapter.js';
export { CloudSyncAdapter } from './adapters/CloudSyncAdapter.js';
export { GitHubSyncAdapter } from './adapters/GitHubSyncAdapter.js';
export { EncryptedSyncAdapter } from './adapters/EncryptedSyncAdapter.js';

// Encryption utilities
export {
  encrypt,
  decrypt,
  isEncryptedPayload,
  resolvePassphrase,
  expandPath,
  EncryptionError,
  ENCRYPTED_PAYLOAD_VERSION,
  DEFAULT_KDF_ITERATIONS,
  DEFAULT_PASSPHRASE_ENV_VAR,
  DEFAULT_KEYFILE_PATH,
} from './encryption/index.js';

export type {
  EncryptedPayload,
  EncryptionAlgorithm,
  KeyDerivationFunction,
  EncryptionErrorCode,
} from './encryption/index.js';
