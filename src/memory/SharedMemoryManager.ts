/**
 * SharedMemoryManager - Team shared memory pool management
 * Provides namespaced shared memory with visibility controls and CRDT-based merge
 */

import { randomBytes } from 'crypto';
import { VectorClock, CRDTMerge, type MergeStrategy, type MergeResult } from '../sync/VectorClock.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Visibility can be:
 * - ['*'] - visible to all team members
 * - ['agent-001', 'agent-002'] - visible to specific agents
 * - ['team:project-alpha'] - visible to all members of a team
 */
export type Visibility = string[];

/**
 * Shared memory item stored in the pool
 */
export interface SharedMemoryItem {
  id: string;
  key: string;
  value: unknown;
  namespace: string;
  visibility: Visibility;
  owner: string;
  vectorClock: VectorClock;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  syncSeq: number;
}

/**
 * Input for setting shared memory
 */
export interface SharedMemoryInput {
  key: string;
  value: unknown;
  visibility?: Visibility;
  tags?: string[];
}

/**
 * Options for setting shared memory
 */
export interface SetOptions {
  visibility?: Visibility;
  tags?: string[];
  mergeStrategy?: MergeStrategy;
}

/**
 * Filter for listing shared memory
 */
export interface SharedMemoryFilter {
  tags?: string[];
  owner?: string;
  visibility?: string;
  includeExpired?: boolean;
}

/**
 * Result of a merge operation
 */
export interface SharedMergeResult {
  success: boolean;
  hadConflict: boolean;
  strategy?: MergeStrategy;
  merged?: SharedMemoryItem;
  error?: string;
}

/**
 * Storage interface for SharedMemoryManager
 */
export interface SharedMemoryStorage {
  // CRUD operations
  set(item: SharedMemoryItem): void;
  get(namespace: string, key: string): SharedMemoryItem | null;
  delete(namespace: string, key: string): boolean;
  list(namespace: string, filter?: SharedMemoryFilter): SharedMemoryItem[];

  // Batch operations
  setMany(items: SharedMemoryItem[]): void;
  getMany(namespace: string, keys: string[]): SharedMemoryItem[];
  deleteMany(namespace: string, keys: string[]): number;

  // Query
  search(namespace: string, query: string, limit?: number): SharedMemoryItem[];
  count(namespace: string, filter?: SharedMemoryFilter): number;

  // Persistence
  save(): void;
}

// ============================================================================
// In-Memory Storage
// ============================================================================

/**
 * In-memory implementation of SharedMemoryStorage
 */
export class InMemorySharedStorage implements SharedMemoryStorage {
  private items: Map<string, SharedMemoryItem> = new Map();

  private makeKey(namespace: string, key: string): string {
    return `${namespace}::${key}`;
  }

  set(item: SharedMemoryItem): void {
    const storeKey = this.makeKey(item.namespace, item.key);
    this.items.set(storeKey, item);
  }

  get(namespace: string, key: string): SharedMemoryItem | null {
    const storeKey = this.makeKey(namespace, key);
    return this.items.get(storeKey) ?? null;
  }

  delete(namespace: string, key: string): boolean {
    const storeKey = this.makeKey(namespace, key);
    return this.items.delete(storeKey);
  }

  list(namespace: string, filter?: SharedMemoryFilter): SharedMemoryItem[] {
    const results: SharedMemoryItem[] = [];

    for (const item of this.items.values()) {
      if (item.namespace !== namespace) continue;

      if (filter?.owner && item.owner !== filter.owner) continue;
      if (filter?.tags && !filter.tags.every(tag => item.tags.includes(tag))) continue;

      results.push(item);
    }

    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  setMany(items: SharedMemoryItem[]): void {
    for (const item of items) {
      this.set(item);
    }
  }

  getMany(namespace: string, keys: string[]): SharedMemoryItem[] {
    return keys
      .map(key => this.get(namespace, key))
      .filter((item): item is SharedMemoryItem => item !== null);
  }

  deleteMany(namespace: string, keys: string[]): number {
    let deleted = 0;
    for (const key of keys) {
      if (this.delete(namespace, key)) {
        deleted++;
      }
    }
    return deleted;
  }

  search(namespace: string, query: string, limit: number = 100): SharedMemoryItem[] {
    const lowerQuery = query.toLowerCase();
    const results: SharedMemoryItem[] = [];

    for (const item of this.items.values()) {
      if (item.namespace !== namespace) continue;

      const keyMatch = item.key.toLowerCase().includes(lowerQuery);
      const valueMatch = JSON.stringify(item.value).toLowerCase().includes(lowerQuery);
      const tagMatch = item.tags.some(tag => tag.toLowerCase().includes(lowerQuery));

      if (keyMatch || valueMatch || tagMatch) {
        results.push(item);
        if (results.length >= limit) break;
      }
    }

    return results;
  }

  count(namespace: string, filter?: SharedMemoryFilter): number {
    return this.list(namespace, filter).length;
  }

  save(): void {
    // No-op for in-memory storage
  }

  clear(): void {
    this.items.clear();
  }
}

// ============================================================================
// SharedMemoryManager
// ============================================================================

/**
 * SharedMemoryManager - Manages team shared memory pools with visibility control
 */
export class SharedMemoryManager {
  private storage: SharedMemoryStorage;
  private nodeId: string;
  private vectorClock: VectorClock;
  private syncSeq: number = 0;

  constructor(storage: SharedMemoryStorage, nodeId: string) {
    this.storage = storage;
    this.nodeId = nodeId;
    this.vectorClock = new VectorClock();
  }

  /**
   * Generate a unique item ID
   */
  private generateId(): string {
    return `shm_${Date.now()}_${randomBytes(4).toString('hex')}`;
  }

  /**
   * Check if a requester can see an item based on visibility
   */
  canAccess(item: SharedMemoryItem, requesterId: string, requesterTeam?: string): boolean {
    // Owner always has access
    if (item.owner === requesterId) return true;

    // Check visibility rules
    for (const v of item.visibility) {
      // Wildcard - everyone can access
      if (v === '*') return true;

      // Specific agent ID
      if (v === requesterId) return true;

      // Team visibility
      if (v.startsWith('team:') && requesterTeam) {
        const teamId = v.slice(5);
        if (teamId === requesterTeam) return true;
      }
    }

    return false;
  }

  /**
   * Set a value in the shared memory pool
   */
  async set(
    namespace: string,
    key: string,
    value: unknown,
    ownerId: string,
    options?: SetOptions
  ): Promise<SharedMemoryItem> {
    const existing = this.storage.get(namespace, key);

    // Increment vector clock
    this.vectorClock.increment(this.nodeId);
    this.syncSeq++;

    const now = Date.now();
    const item: SharedMemoryItem = {
      id: existing?.id ?? this.generateId(),
      key,
      value,
      namespace,
      visibility: options?.visibility ?? ['*'],
      owner: existing?.owner ?? ownerId,
      vectorClock: this.vectorClock.clone(),
      tags: options?.tags ?? existing?.tags ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      syncSeq: this.syncSeq,
    };

    this.storage.set(item);
    this.storage.save();

    return item;
  }

  /**
   * Get a value from the shared memory pool
   */
  async get(
    namespace: string,
    key: string,
    requesterId: string,
    requesterTeam?: string
  ): Promise<SharedMemoryItem | null> {
    const item = this.storage.get(namespace, key);
    if (!item) return null;

    // Check access
    if (!this.canAccess(item, requesterId, requesterTeam)) {
      return null;
    }

    return item;
  }

  /**
   * Delete a value from the shared memory pool
   * Only the owner or a manager can delete
   */
  async delete(
    namespace: string,
    key: string,
    requesterId: string,
    isManager: boolean = false
  ): Promise<boolean> {
    const item = this.storage.get(namespace, key);
    if (!item) return false;

    // Only owner or manager can delete
    if (item.owner !== requesterId && !isManager) {
      return false;
    }

    const deleted = this.storage.delete(namespace, key);
    if (deleted) {
      this.storage.save();
    }
    return deleted;
  }

  /**
   * List items in the shared memory pool
   */
  async list(
    namespace: string,
    requesterId: string,
    requesterTeam?: string,
    filter?: SharedMemoryFilter
  ): Promise<SharedMemoryItem[]> {
    const allItems = this.storage.list(namespace, filter);

    // Filter by access
    return allItems.filter(item => this.canAccess(item, requesterId, requesterTeam));
  }

  /**
   * Search items in the shared memory pool
   */
  async search(
    namespace: string,
    query: string,
    requesterId: string,
    requesterTeam?: string,
    limit?: number
  ): Promise<SharedMemoryItem[]> {
    const allItems = this.storage.search(namespace, query, limit ? limit * 2 : undefined);

    // Filter by access
    const accessible = allItems.filter(item => this.canAccess(item, requesterId, requesterTeam));

    return limit ? accessible.slice(0, limit) : accessible;
  }

  /**
   * Merge a remote item into the local storage
   * Uses CRDT conflict resolution
   */
  async merge(
    remote: SharedMemoryItem,
    strategy: MergeStrategy = 'lww_wins'
  ): Promise<SharedMergeResult> {
    const local = this.storage.get(remote.namespace, remote.key);

    // No local item - just insert remote
    if (!local) {
      // Update our vector clock
      this.vectorClock.mergeInPlace(remote.vectorClock);
      this.syncSeq = Math.max(this.syncSeq, remote.syncSeq) + 1;

      const item: SharedMemoryItem = {
        ...remote,
        vectorClock: this.vectorClock.clone(),
        syncSeq: this.syncSeq,
      };

      this.storage.set(item);
      this.storage.save();

      return {
        success: true,
        hadConflict: false,
        merged: item,
      };
    }

    // Check for conflict using vector clocks
    const comparison = local.vectorClock.compare(remote.vectorClock);

    if (comparison === 'after' || comparison === 'equal') {
      // Local is newer or same - no merge needed
      return {
        success: true,
        hadConflict: false,
        merged: local,
      };
    }

    if (comparison === 'before') {
      // Remote is strictly newer - take remote
      this.vectorClock.mergeInPlace(remote.vectorClock);
      this.vectorClock.increment(this.nodeId);
      this.syncSeq = Math.max(this.syncSeq, remote.syncSeq) + 1;

      const item: SharedMemoryItem = {
        ...remote,
        vectorClock: this.vectorClock.clone(),
        syncSeq: this.syncSeq,
      };

      this.storage.set(item);
      this.storage.save();

      return {
        success: true,
        hadConflict: false,
        merged: item,
      };
    }

    // Concurrent updates - need to merge
    const mergedItem = this.mergeItems(local, remote, strategy);

    // Update vector clock
    this.vectorClock.mergeInPlace(remote.vectorClock);
    this.vectorClock.increment(this.nodeId);
    this.syncSeq = Math.max(this.syncSeq, remote.syncSeq) + 1;

    mergedItem.vectorClock = this.vectorClock.clone();
    mergedItem.syncSeq = this.syncSeq;
    mergedItem.updatedAt = Date.now();

    this.storage.set(mergedItem);
    this.storage.save();

    return {
      success: true,
      hadConflict: true,
      strategy,
      merged: mergedItem,
    };
  }

  /**
   * Merge two concurrent items based on strategy
   */
  private mergeItems(
    local: SharedMemoryItem,
    remote: SharedMemoryItem,
    strategy: MergeStrategy
  ): SharedMemoryItem {
    switch (strategy) {
      case 'lww_wins': {
        // Last-write-wins based on timestamp
        return local.updatedAt >= remote.updatedAt ? { ...local } : { ...remote };
      }

      case 'union_tags': {
        // Merge tags, keep newer value
        const merged = local.updatedAt >= remote.updatedAt ? { ...local } : { ...remote };
        merged.tags = CRDTMerge.unionArray(local.tags, remote.tags);
        return merged;
      }

      case 'merge_observations':
      case 'merge_learnings': {
        // For array values, merge them
        const merged = { ...local };
        if (Array.isArray(local.value) && Array.isArray(remote.value)) {
          merged.value = CRDTMerge.unionArray(local.value as unknown[], remote.value as unknown[]);
        } else if (typeof local.value === 'object' && typeof remote.value === 'object') {
          // Deep merge objects
          merged.value = this.deepMerge(local.value as object, remote.value as object);
        } else {
          // Fallback to LWW for scalar values
          merged.value = local.updatedAt >= remote.updatedAt ? local.value : remote.value;
        }
        merged.tags = CRDTMerge.unionArray(local.tags, remote.tags);
        return merged;
      }

      case 'higher_importance':
      case 'higher_confidence': {
        // Try to extract importance/confidence from value
        const localScore = this.extractScore(local.value, strategy);
        const remoteScore = this.extractScore(remote.value, strategy);
        return localScore >= remoteScore ? { ...local } : { ...remote };
      }

      default:
        // Default to LWW
        return local.updatedAt >= remote.updatedAt ? { ...local } : { ...remote };
    }
  }

  /**
   * Deep merge two objects
   */
  private deepMerge(local: object, remote: object): object {
    const result: Record<string, unknown> = { ...local };

    for (const [key, remoteValue] of Object.entries(remote)) {
      const localValue = (local as Record<string, unknown>)[key];

      if (localValue === undefined) {
        result[key] = remoteValue;
      } else if (Array.isArray(localValue) && Array.isArray(remoteValue)) {
        result[key] = CRDTMerge.unionArray(localValue, remoteValue);
      } else if (
        typeof localValue === 'object' &&
        localValue !== null &&
        typeof remoteValue === 'object' &&
        remoteValue !== null
      ) {
        result[key] = this.deepMerge(localValue, remoteValue);
      }
      // Keep local value for scalar conflicts
    }

    return result;
  }

  /**
   * Extract importance/confidence score from value
   */
  private extractScore(value: unknown, strategy: MergeStrategy): number {
    if (typeof value !== 'object' || value === null) return 0;

    const obj = value as Record<string, unknown>;

    if (strategy === 'higher_importance') {
      return typeof obj.importance === 'number' ? obj.importance : 0;
    } else {
      return typeof obj.confidence === 'number' ? obj.confidence : 0;
    }
  }

  /**
   * Get current vector clock state
   */
  getVectorClock(): VectorClock {
    return this.vectorClock.clone();
  }

  /**
   * Get current sync sequence number
   */
  getSyncSeq(): number {
    return this.syncSeq;
  }

  /**
   * Export all items in a namespace for sync
   */
  async exportNamespace(
    namespace: string,
    sinceSeq?: number
  ): Promise<SharedMemoryItem[]> {
    const items = this.storage.list(namespace);

    if (sinceSeq !== undefined) {
      return items.filter(item => item.syncSeq > sinceSeq);
    }

    return items;
  }

  /**
   * Import items from sync
   */
  async importItems(
    items: SharedMemoryItem[],
    strategy: MergeStrategy = 'merge_learnings'
  ): Promise<{ merged: number; conflicts: number }> {
    let merged = 0;
    let conflicts = 0;

    for (const item of items) {
      const result = await this.merge(item, strategy);
      if (result.success) {
        merged++;
        if (result.hadConflict) {
          conflicts++;
        }
      }
    }

    return { merged, conflicts };
  }

  /**
   * Update item visibility
   */
  async updateVisibility(
    namespace: string,
    key: string,
    requesterId: string,
    newVisibility: Visibility,
    isManager: boolean = false
  ): Promise<boolean> {
    const item = this.storage.get(namespace, key);
    if (!item) return false;

    // Only owner or manager can change visibility
    if (item.owner !== requesterId && !isManager) {
      return false;
    }

    this.vectorClock.increment(this.nodeId);
    this.syncSeq++;

    item.visibility = newVisibility;
    item.vectorClock = this.vectorClock.clone();
    item.syncSeq = this.syncSeq;
    item.updatedAt = Date.now();

    this.storage.set(item);
    this.storage.save();

    return true;
  }

  /**
   * Get item count in a namespace
   */
  async count(namespace: string, filter?: SharedMemoryFilter): Promise<number> {
    return this.storage.count(namespace, filter);
  }
}

/**
 * Serialize a SharedMemoryItem for transport
 */
export function serializeSharedMemoryItem(item: SharedMemoryItem): Record<string, unknown> {
  return {
    ...item,
    vectorClock: item.vectorClock.toObject(),
  };
}

/**
 * Deserialize a SharedMemoryItem from transport
 */
export function deserializeSharedMemoryItem(data: Record<string, unknown>): SharedMemoryItem {
  return {
    id: data.id as string,
    key: data.key as string,
    value: data.value,
    namespace: data.namespace as string,
    visibility: data.visibility as Visibility,
    owner: data.owner as string,
    vectorClock: VectorClock.fromObject(data.vectorClock as Record<string, number>),
    tags: data.tags as string[],
    createdAt: data.createdAt as number,
    updatedAt: data.updatedAt as number,
    syncSeq: data.syncSeq as number,
  };
}
