/**
 * Sync Adapter Types for cc-memory
 * Unified interface for syncing memories across different hardware/instances
 */

import type {
  ParallelizationExport,
  ConflictRecord,
  ConflictStrategy,
  SyncVector,
} from '../memory/types.js';

// ============================================================================
// Sync Adapter Types
// ============================================================================

/** Available sync adapter types */
export type SyncAdapterType = 'file' | 'cloud' | 'http' | 'websocket' | 'github';

/** Sync operation result */
export interface SyncResult {
  success: boolean;
  syncedItems: number;
  conflicts: ConflictRecord[];
  error?: string;
}

/** Sync adapter status */
export interface SyncStatus {
  connected: boolean;
  lastSyncAt?: number;
  pendingChanges: number;
  error?: string;
}

/** Sync adapter configuration base */
export interface SyncAdapterConfig {
  name?: string;
}

/** File sync adapter configuration */
export interface FileSyncAdapterConfig extends SyncAdapterConfig {
  syncDir: string;
}

/** Cloud sync adapter configuration */
export interface CloudSyncAdapterConfig extends SyncAdapterConfig {
  syncDir: string;
  watchInterval?: number;  // Polling interval in ms (default: 5000)
}

/** HTTP sync adapter configuration */
export interface HttpSyncAdapterConfig extends SyncAdapterConfig {
  baseUrl: string;
  apiKey: string;
  namespace?: string;
}

/** WebSocket sync adapter configuration */
export interface WebSocketSyncAdapterConfig extends SyncAdapterConfig {
  serverUrl: string;
  apiKey: string;
  reconnectInterval?: number;  // Reconnect interval in ms (default: 5000)
}

/** GitHub sync adapter configuration */
export interface GitHubSyncAdapterConfig extends SyncAdapterConfig {
  /** Git repository URL (SSH or HTTPS) */
  repoUrl: string;

  /** Local path for the cloned repository */
  localPath: string;

  /** Branch to use (default: 'main') */
  branch?: string;

  /** Subdirectory within the repo for deltas (default: 'deltas') */
  deltasDir?: string;

  /** Author name for commits */
  authorName?: string;

  /** Author email for commits */
  authorEmail?: string;

  /** Auto-pull before push (default: true) */
  autoPull?: boolean;

  /** Auto-push after commit (default: true) */
  autoPush?: boolean;
}

/** Encryption configuration for EncryptedSyncAdapter */
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

/** Configuration for EncryptedSyncAdapter */
export interface EncryptedSyncAdapterConfig extends EncryptionConfig {
  /** Name suffix for the adapter (default: '-encrypted') */
  nameSuffix?: string;
}

// ============================================================================
// Sync Adapter Interface
// ============================================================================

/**
 * Unified interface for all sync adapters
 */
export interface SyncAdapter {
  /** Adapter type identifier */
  readonly type: SyncAdapterType;

  /** Human-readable name for this adapter instance */
  readonly name: string;

  /**
   * Initialize the adapter
   * Called when the adapter is first added to the SyncManager
   */
  initialize(): Promise<void>;

  /**
   * Close the adapter and clean up resources
   */
  close(): Promise<void>;

  /**
   * Push a delta to the sync target
   * @param delta The parallelization export to push
   */
  push(delta: ParallelizationExport): Promise<SyncResult>;

  /**
   * Pull deltas from the sync source
   * @returns Array of parallelization exports to import
   */
  pull(): Promise<ParallelizationExport[]>;

  /**
   * Get the current status of the adapter
   */
  getStatus(): Promise<SyncStatus>;

  /**
   * Optional: Set callback for when new deltas are received
   * Used by adapters that support real-time sync (e.g., file watcher, websocket)
   */
  onSync?(callback: (delta: ParallelizationExport) => void): void;
}

// ============================================================================
// Sync Manager Types
// ============================================================================

/** Sync manager configuration */
export interface SyncManagerConfig {
  /** Default conflict resolution strategy */
  conflictStrategy?: ConflictStrategy;

  /** Auto-resolve conflicts (default: true) */
  autoResolve?: boolean;

  /** Auto-sync interval in ms (0 = disabled) */
  autoSyncInterval?: number;
}

/** Sync manager status */
export interface SyncManagerStatus {
  adapters: Map<string, SyncStatus>;
  lastSyncAt?: number;
  isAutoSyncing: boolean;
}

// ============================================================================
// Events
// ============================================================================

export type SyncEventType = 'push' | 'pull' | 'conflict' | 'error';

export interface SyncEvent {
  type: SyncEventType;
  adapterName: string;
  timestamp: number;
  data?: unknown;
}

export type SyncEventHandler = (event: SyncEvent) => void;
