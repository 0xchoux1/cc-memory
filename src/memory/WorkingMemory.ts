/**
 * Working Memory - Short-term, TTL-based memory for current task context
 * Implements capacity limit inspired by Cowan's 4±1 model
 */

import { v7 as uuidv7 } from 'uuid';
import type { SqliteStorage } from '../storage/SqliteStorage.js';
import type {
  WorkingMemoryItem,
  WorkingMemoryInput,
  WorkingMemoryFilter,
  WorkingMemoryType,
  WORKING_MEMORY_TTL,
} from './types.js';

export interface WorkingMemoryConfig {
  /** Maximum number of items in working memory (default: 7, Cowan's 4±1) */
  capacity?: number;
  /** Callback when items are evicted due to capacity overflow */
  onEvict?: (item: WorkingMemoryItem) => void;
}

export class WorkingMemory {
  private storage: SqliteStorage;
  private sessionId: string;
  private defaultTTLs: Record<WorkingMemoryType, number>;
  private capacity: number;
  private onEvict?: (item: WorkingMemoryItem) => void;

  constructor(storage: SqliteStorage, sessionId: string, config?: WorkingMemoryConfig) {
    this.storage = storage;
    this.sessionId = sessionId;
    this.capacity = config?.capacity ?? 7;
    this.onEvict = config?.onEvict;
    this.defaultTTLs = {
      task_state: 24 * 60 * 60 * 1000,    // 24 hours
      decision: 4 * 60 * 60 * 1000,       // 4 hours
      context: 1 * 60 * 60 * 1000,        // 1 hour
      scratch: 30 * 60 * 1000,            // 30 minutes
    };
  }

  /**
   * Store a value in working memory
   * If capacity is exceeded, lowest-priority oldest items are evicted
   */
  set(input: WorkingMemoryInput): WorkingMemoryItem {
    const now = Date.now();
    const type = input.type || 'context';
    const ttl = input.ttl || this.defaultTTLs[type];

    // Check if item already exists
    const existing = this.storage.getWorkingItem(input.key);

    const item: WorkingMemoryItem = {
      id: existing?.id || uuidv7(),
      type,
      key: input.key,
      value: input.value,
      metadata: {
        createdAt: existing?.metadata.createdAt || now,
        updatedAt: now,
        expiresAt: now + ttl,
        sessionId: this.sessionId,
        priority: input.priority || 'medium',
      },
      tags: input.tags || [],
    };

    this.storage.setWorkingItem(item);

    // Enforce capacity limit (only if this was a new item, not an update)
    if (!existing) {
      this.enforceCapacity();
    }

    return item;
  }

  /**
   * Enforce capacity limit by evicting lowest-priority, oldest items
   */
  private enforceCapacity(): void {
    const items = this.storage.listWorkingItems({ includeExpired: false });

    if (items.length <= this.capacity) return;

    // Sort by priority (low first) then by updatedAt (oldest first)
    const priorityOrder: Record<string, number> = { low: 0, medium: 1, high: 2 };
    const sorted = [...items].sort((a, b) => {
      const pDiff = priorityOrder[a.metadata.priority] - priorityOrder[b.metadata.priority];
      if (pDiff !== 0) return pDiff;
      return a.metadata.updatedAt - b.metadata.updatedAt;
    });

    // Evict excess items
    const toEvict = sorted.slice(0, items.length - this.capacity);
    for (const item of toEvict) {
      if (this.onEvict) {
        this.onEvict(item);
      }
      this.storage.deleteWorkingItem(item.key);
    }
  }

  /**
   * Get the current capacity limit
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Set a new capacity limit
   */
  setCapacity(capacity: number): void {
    this.capacity = capacity;
    this.enforceCapacity();
  }

  /**
   * Retrieve a value from working memory
   */
  get(key: string): WorkingMemoryItem | null {
    return this.storage.getWorkingItem(key);
  }

  /**
   * Delete a value from working memory
   */
  delete(key: string): boolean {
    return this.storage.deleteWorkingItem(key);
  }

  /**
   * List all working memory items
   */
  list(filter?: WorkingMemoryFilter): WorkingMemoryItem[] {
    return this.storage.listWorkingItems(filter);
  }

  /**
   * Get all items for the current session
   */
  getBySession(sessionId?: string): WorkingMemoryItem[] {
    return this.storage.listWorkingItems({
      sessionId: sessionId || this.sessionId,
    });
  }

  /**
   * Clear expired items
   */
  clearExpired(): number {
    return this.storage.clearExpiredWorking();
  }

  /**
   * Clear all working memory
   */
  clearAll(): number {
    return this.storage.clearAllWorking();
  }

  /**
   * Extend TTL for an item
   */
  touch(key: string, additionalTTL?: number): boolean {
    const item = this.storage.getWorkingItem(key);
    if (!item) return false;

    const ttl = additionalTTL || this.defaultTTLs[item.type];
    item.metadata.expiresAt = Date.now() + ttl;
    item.metadata.updatedAt = Date.now();

    this.storage.setWorkingItem(item);
    return true;
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    return this.storage.getWorkingItem(key) !== null;
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Set a new session ID
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }
}
