/**
 * EncryptedSyncAdapter - Decorator that adds encryption to any sync adapter
 *
 * Uses the decorator pattern to wrap any SyncAdapter with transparent
 * AES-256-GCM encryption for all sync data.
 *
 * @example
 * ```typescript
 * const encrypted = new EncryptedSyncAdapter(
 *   new FileSyncAdapter({ syncDir: '/shared' }),
 *   { passphraseEnvVar: 'CC_MEMORY_SYNC_KEY' }
 * );
 * ```
 */

import type { ParallelizationExport } from '../../memory/types.js';
import type {
  SyncAdapter,
  SyncAdapterType,
  SyncResult,
  SyncStatus,
} from '../types.js';
import type { EncryptionConfig, EncryptedPayload } from '../encryption/types.js';
import {
  encrypt,
  decrypt,
  isEncryptedPayload,
  resolvePassphrase,
} from '../encryption/crypto.js';
import { EncryptionError, DEFAULT_KDF_ITERATIONS } from '../encryption/types.js';

/**
 * Configuration for EncryptedSyncAdapter
 */
export interface EncryptedSyncAdapterConfig extends EncryptionConfig {
  /** Name suffix for the adapter (default: '-encrypted') */
  nameSuffix?: string;
}

/**
 * Encrypted data wrapper for transmission/storage
 * Contains the encrypted payload along with metadata
 */
interface EncryptedDelta {
  /** Indicates this is an encrypted delta */
  encrypted: true;

  /** The encrypted payload */
  payload: EncryptedPayload;

  /** Metadata (not encrypted) */
  metadata: {
    tachikomaId: string;
    tachikomaName?: string;
    exportedAt: number;
  };
}

/**
 * EncryptedSyncAdapter - Adds transparent encryption to any sync adapter
 */
export class EncryptedSyncAdapter implements SyncAdapter {
  readonly type: SyncAdapterType;
  readonly name: string;

  private readonly inner: SyncAdapter;
  private readonly config: EncryptedSyncAdapterConfig;
  private passphrase: string | null = null;
  private readonly kdfIterations: number;

  constructor(inner: SyncAdapter, config: EncryptedSyncAdapterConfig) {
    this.inner = inner;
    this.config = config;
    this.type = inner.type;
    this.name = `${inner.name}${config.nameSuffix || '-encrypted'}`;
    this.kdfIterations = config.kdfIterations || DEFAULT_KDF_ITERATIONS;
  }

  /**
   * Get the underlying adapter
   */
  getInnerAdapter(): SyncAdapter {
    return this.inner;
  }

  /**
   * Resolve and cache the passphrase
   */
  private getPassphrase(): string {
    if (!this.passphrase) {
      this.passphrase = resolvePassphrase(this.config);
    }
    return this.passphrase;
  }

  async initialize(): Promise<void> {
    // Validate passphrase is available (will throw if not)
    this.getPassphrase();

    // Initialize inner adapter
    await this.inner.initialize();
  }

  async close(): Promise<void> {
    // Clear cached passphrase
    this.passphrase = null;

    // Close inner adapter
    await this.inner.close();
  }

  async push(delta: ParallelizationExport): Promise<SyncResult> {
    try {
      // Encrypt the delta
      const encryptedDelta = this.encryptDelta(delta);

      // Create a pseudo-ParallelizationExport to push
      // The encrypted data is stored in a format that looks like a valid export
      // but with the actual data encrypted
      const wrappedDelta = this.wrapEncryptedDelta(encryptedDelta, delta);

      // Push through inner adapter
      return await this.inner.push(wrappedDelta);
    } catch (error) {
      if (error instanceof EncryptionError) {
        return {
          success: false,
          syncedItems: 0,
          conflicts: [],
          error: `Encryption error: ${error.message}`,
        };
      }
      throw error;
    }
  }

  async pull(): Promise<ParallelizationExport[]> {
    // Pull from inner adapter
    const wrappedDeltas = await this.inner.pull();
    const decryptedDeltas: ParallelizationExport[] = [];

    for (const wrapped of wrappedDeltas) {
      try {
        const decrypted = this.decryptWrappedDelta(wrapped);
        if (decrypted) {
          decryptedDeltas.push(decrypted);
        }
      } catch (error) {
        // Log decryption errors but continue processing other deltas
        console.error(
          `Failed to decrypt delta from ${wrapped.tachikomaId}:`,
          error instanceof EncryptionError ? error.message : error
        );
      }
    }

    return decryptedDeltas;
  }

  async getStatus(): Promise<SyncStatus> {
    return this.inner.getStatus();
  }

  onSync(callback: (delta: ParallelizationExport) => void): void {
    if (!this.inner.onSync) {
      return;
    }

    // Wrap the callback to decrypt incoming deltas
    this.inner.onSync((wrapped: ParallelizationExport) => {
      try {
        const decrypted = this.decryptWrappedDelta(wrapped);
        if (decrypted) {
          callback(decrypted);
        }
      } catch (error) {
        console.error(
          `Failed to decrypt real-time delta:`,
          error instanceof EncryptionError ? error.message : error
        );
      }
    });
  }

  /**
   * Encrypt a ParallelizationExport
   */
  private encryptDelta(delta: ParallelizationExport): EncryptedDelta {
    const passphrase = this.getPassphrase();
    const plaintext = JSON.stringify(delta);
    const payload = encrypt(plaintext, passphrase, this.kdfIterations);

    return {
      encrypted: true,
      payload,
      metadata: {
        tachikomaId: delta.tachikomaId,
        tachikomaName: delta.tachikomaName,
        exportedAt: delta.exportedAt,
      },
    };
  }

  /**
   * Wrap encrypted delta as a ParallelizationExport for transmission
   */
  private wrapEncryptedDelta(
    encryptedDelta: EncryptedDelta,
    original: ParallelizationExport
  ): ParallelizationExport {
    // Store encrypted data in a special format that's still valid JSON
    // The encrypted payload is stored as the content of a special working memory item
    return {
      version: original.version,
      format: 'tachikoma-parallelize-delta',
      tachikomaId: original.tachikomaId,
      tachikomaName: original.tachikomaName,
      exportedAt: original.exportedAt,
      syncVector: original.syncVector,
      delta: {
        working: [
          {
            id: '__encrypted__',
            type: 'context',
            key: '__encrypted_payload__',
            value: encryptedDelta,
            metadata: {
              createdAt: original.exportedAt,
              updatedAt: original.exportedAt,
              expiresAt: 0,
              sessionId: '__encryption__',
              priority: 'high',
            },
            tags: ['__encrypted__'],
          },
        ],
        episodic: [],
        semantic: { entities: [], relations: [] },
      },
      deleted: {
        working: [],
        episodic: [],
        semantic: { entities: [], relations: [] },
      },
    };
  }

  /**
   * Decrypt a wrapped ParallelizationExport
   */
  private decryptWrappedDelta(wrapped: ParallelizationExport): ParallelizationExport | null {
    // Check if this is an encrypted delta
    const encryptedItem = wrapped.delta.working.find(
      item => item.key === '__encrypted_payload__' && item.id === '__encrypted__'
    );

    if (!encryptedItem) {
      // Not encrypted - could be from unencrypted source, skip
      console.warn(
        `Received unencrypted delta from ${wrapped.tachikomaId}. ` +
        `EncryptedSyncAdapter expects encrypted data.`
      );
      return null;
    }

    const encryptedDelta = encryptedItem.value as EncryptedDelta;

    if (!encryptedDelta.encrypted || !encryptedDelta.payload) {
      throw new EncryptionError(
        'INVALID_PAYLOAD',
        'Invalid encrypted delta format'
      );
    }

    if (!isEncryptedPayload(encryptedDelta.payload)) {
      throw new EncryptionError(
        'INVALID_PAYLOAD',
        'Invalid encrypted payload structure'
      );
    }

    const passphrase = this.getPassphrase();
    const plaintext = decrypt(encryptedDelta.payload, passphrase);
    const delta = JSON.parse(plaintext) as ParallelizationExport;

    // Validate the decrypted data
    if (delta.format !== 'tachikoma-parallelize-delta') {
      throw new EncryptionError(
        'INVALID_PAYLOAD',
        'Decrypted data is not a valid ParallelizationExport'
      );
    }

    return delta;
  }
}
