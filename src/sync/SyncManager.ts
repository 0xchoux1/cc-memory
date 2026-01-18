/**
 * SyncManager - Unified management for sync adapters
 * Coordinates multiple sync adapters for cross-hardware memory synchronization
 */

import type { SqliteStorage } from '../storage/SqliteStorage.js';
import type { ConflictStrategy, ParallelizationExport } from '../memory/types.js';
import type {
  SyncAdapter,
  SyncResult,
  SyncManagerConfig,
  SyncManagerStatus,
  SyncEvent,
  SyncEventHandler,
  SyncStatus,
} from './types.js';

export class SyncManager {
  private adapters: Map<string, SyncAdapter> = new Map();
  private storage: SqliteStorage;
  private config: Required<SyncManagerConfig>;
  private syncTimer?: ReturnType<typeof setInterval>;
  private lastSyncAt?: number;
  private eventHandlers: SyncEventHandler[] = [];

  constructor(storage: SqliteStorage, config: SyncManagerConfig = {}) {
    this.storage = storage;
    this.config = {
      conflictStrategy: config.conflictStrategy ?? 'merge_learnings',
      autoResolve: config.autoResolve ?? true,
      autoSyncInterval: config.autoSyncInterval ?? 0,
    };
  }

  /**
   * Add a sync adapter
   */
  async addAdapter(name: string, adapter: SyncAdapter): Promise<void> {
    if (this.adapters.has(name)) {
      throw new Error(`Adapter with name "${name}" already exists`);
    }

    await adapter.initialize();
    this.adapters.set(name, adapter);

    // Set up sync callback if adapter supports real-time sync
    if (adapter.onSync) {
      adapter.onSync((delta) => this.handleIncomingDelta(name, delta));
    }
  }

  /**
   * Remove a sync adapter
   */
  async removeAdapter(name: string): Promise<void> {
    const adapter = this.adapters.get(name);
    if (adapter) {
      await adapter.close();
      this.adapters.delete(name);
    }
  }

  /**
   * Get a specific adapter
   */
  getAdapter(name: string): SyncAdapter | undefined {
    return this.adapters.get(name);
  }

  /**
   * Get all adapter names
   */
  getAdapterNames(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Push to all adapters
   */
  async pushToAll(sinceTimestamp?: number): Promise<Map<string, SyncResult>> {
    const delta = this.storage.exportDelta(sinceTimestamp);
    const results = new Map<string, SyncResult>();

    for (const [name, adapter] of this.adapters) {
      try {
        const result = await adapter.push(delta);
        results.set(name, result);
        this.emitEvent({
          type: 'push',
          adapterName: name,
          timestamp: Date.now(),
          data: { syncedItems: result.syncedItems },
        });
      } catch (error) {
        const result: SyncResult = {
          success: false,
          syncedItems: 0,
          conflicts: [],
          error: (error as Error).message,
        };
        results.set(name, result);
        this.emitEvent({
          type: 'error',
          adapterName: name,
          timestamp: Date.now(),
          data: { error: (error as Error).message },
        });
      }
    }

    this.lastSyncAt = Date.now();
    return results;
  }

  /**
   * Push to a specific adapter
   */
  async pushTo(adapterName: string, sinceTimestamp?: number): Promise<SyncResult> {
    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      throw new Error(`Adapter "${adapterName}" not found`);
    }

    const delta = this.storage.exportDelta(sinceTimestamp);
    return adapter.push(delta);
  }

  /**
   * Pull from all adapters
   */
  async pullFromAll(): Promise<Map<string, SyncResult>> {
    const results = new Map<string, SyncResult>();

    for (const [name, adapter] of this.adapters) {
      try {
        const deltas = await adapter.pull();
        let totalSyncedItems = 0;
        let allConflicts: typeof results extends Map<string, SyncResult> ? SyncResult['conflicts'] : never = [];

        for (const delta of deltas) {
          const importResult = this.storage.importDelta(delta, {
            strategy: this.config.conflictStrategy,
            autoResolve: this.config.autoResolve,
          });
          totalSyncedItems += importResult.merged.working +
                             importResult.merged.episodic +
                             importResult.merged.semantic.entities +
                             importResult.merged.semantic.relations;
          allConflicts = allConflicts.concat(importResult.conflicts);
        }

        const result: SyncResult = {
          success: true,
          syncedItems: totalSyncedItems,
          conflicts: allConflicts,
        };
        results.set(name, result);

        this.emitEvent({
          type: 'pull',
          adapterName: name,
          timestamp: Date.now(),
          data: { syncedItems: totalSyncedItems, deltasProcessed: deltas.length },
        });

        if (allConflicts.length > 0) {
          this.emitEvent({
            type: 'conflict',
            adapterName: name,
            timestamp: Date.now(),
            data: { conflicts: allConflicts },
          });
        }
      } catch (error) {
        const result: SyncResult = {
          success: false,
          syncedItems: 0,
          conflicts: [],
          error: (error as Error).message,
        };
        results.set(name, result);
        this.emitEvent({
          type: 'error',
          adapterName: name,
          timestamp: Date.now(),
          data: { error: (error as Error).message },
        });
      }
    }

    this.lastSyncAt = Date.now();
    return results;
  }

  /**
   * Pull from a specific adapter
   */
  async pullFrom(adapterName: string): Promise<SyncResult> {
    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      throw new Error(`Adapter "${adapterName}" not found`);
    }

    const deltas = await adapter.pull();
    let totalSyncedItems = 0;
    const allConflicts: SyncResult['conflicts'] = [];

    for (const delta of deltas) {
      const importResult = this.storage.importDelta(delta, {
        strategy: this.config.conflictStrategy,
        autoResolve: this.config.autoResolve,
      });
      totalSyncedItems += importResult.merged.working +
                         importResult.merged.episodic +
                         importResult.merged.semantic.entities +
                         importResult.merged.semantic.relations;
      allConflicts.push(...importResult.conflicts);
    }

    return {
      success: true,
      syncedItems: totalSyncedItems,
      conflicts: allConflicts,
    };
  }

  /**
   * Perform a full sync (pull then push)
   */
  async sync(): Promise<{ pull: Map<string, SyncResult>; push: Map<string, SyncResult> }> {
    const pullResults = await this.pullFromAll();
    const pushResults = await this.pushToAll();
    return { pull: pullResults, push: pushResults };
  }

  /**
   * Start automatic synchronization
   */
  startAutoSync(intervalMs?: number): void {
    const interval = intervalMs ?? this.config.autoSyncInterval;
    if (interval <= 0) {
      return;
    }

    this.stopAutoSync();
    this.syncTimer = setInterval(async () => {
      try {
        await this.sync();
      } catch (error) {
        console.error('Auto-sync error:', error);
      }
    }, interval);
  }

  /**
   * Stop automatic synchronization
   */
  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
  }

  /**
   * Get status of all adapters
   */
  async getStatus(): Promise<SyncManagerStatus> {
    const adapterStatuses = new Map<string, SyncStatus>();

    for (const [name, adapter] of this.adapters) {
      try {
        const status = await adapter.getStatus();
        adapterStatuses.set(name, status);
      } catch (error) {
        adapterStatuses.set(name, {
          connected: false,
          pendingChanges: 0,
          error: (error as Error).message,
        });
      }
    }

    return {
      adapters: adapterStatuses,
      lastSyncAt: this.lastSyncAt,
      isAutoSyncing: this.syncTimer !== undefined,
    };
  }

  /**
   * Register an event handler
   */
  on(handler: SyncEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Unregister an event handler
   */
  off(handler: SyncEventHandler): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index !== -1) {
      this.eventHandlers.splice(index, 1);
    }
  }

  /**
   * Close the sync manager and all adapters
   */
  async close(): Promise<void> {
    this.stopAutoSync();
    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.close();
      } catch (error) {
        console.error(`Error closing adapter "${name}":`, error);
      }
    }
    this.adapters.clear();
    this.eventHandlers = [];
  }

  /**
   * Handle incoming delta from real-time sync adapters
   */
  private handleIncomingDelta(adapterName: string, delta: ParallelizationExport): void {
    try {
      const importResult = this.storage.importDelta(delta, {
        strategy: this.config.conflictStrategy,
        autoResolve: this.config.autoResolve,
      });

      const syncedItems = importResult.merged.working +
                         importResult.merged.episodic +
                         importResult.merged.semantic.entities +
                         importResult.merged.semantic.relations;

      this.emitEvent({
        type: 'pull',
        adapterName,
        timestamp: Date.now(),
        data: { syncedItems, realtime: true },
      });

      if (importResult.conflicts.length > 0) {
        this.emitEvent({
          type: 'conflict',
          adapterName,
          timestamp: Date.now(),
          data: { conflicts: importResult.conflicts },
        });
      }
    } catch (error) {
      this.emitEvent({
        type: 'error',
        adapterName,
        timestamp: Date.now(),
        data: { error: (error as Error).message },
      });
    }
  }

  /**
   * Emit an event to all handlers
   */
  private emitEvent(event: SyncEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in sync event handler:', error);
      }
    }
  }
}
