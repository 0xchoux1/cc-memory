/**
 * EventDrivenSyncManager - Event-driven synchronization with batching and conflict resolution
 */

import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import { VectorClock, PriorityQueue, CRDTMerge, type MergeStrategy } from './VectorClock.js';
import type { ConflictStrategy, ConflictRecord, ParallelizationExport } from '../memory/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Types of sync events
 */
export type SyncEventType = 'create' | 'update' | 'delete' | 'batch';

/**
 * Priority levels for sync events
 */
export type SyncPriority = 'high' | 'normal' | 'low';

/**
 * Memory change payload
 */
export interface MemoryChange {
  memoryType: 'working' | 'episodic' | 'semantic' | 'shared';
  key: string;
  value?: unknown;
  previousValue?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Sync event
 */
export interface SyncEvent {
  id: string;
  type: SyncEventType;
  source: string;
  target: 'shared' | 'broadcast' | string[];
  data: MemoryChange;
  vectorClock: VectorClock;
  timestamp: number;
  priority: SyncPriority;
  retryCount: number;
}

/**
 * Conflict information
 */
export interface SyncConflict {
  id: string;
  event: SyncEvent;
  localData: unknown;
  remoteData: unknown;
  resolvedWith?: 'local' | 'remote' | 'merged';
  resolvedData?: unknown;
}

/**
 * Batch of sync events
 */
export interface SyncBatch {
  id: string;
  events: SyncEvent[];
  source: string;
  vectorClock: VectorClock;
  timestamp: number;
}

/**
 * Sync status
 */
export interface SyncStatus {
  connected: boolean;
  pendingEvents: number;
  lastSyncAt?: number;
  conflicts: number;
  vectorClock: VectorClock;
}

/**
 * Configuration for EventDrivenSyncManager
 */
export interface EventDrivenSyncConfig {
  nodeId: string;
  batchInterval: number;
  maxBatchSize: number;
  maxRetries: number;
  conflictStrategy: ConflictStrategy;
  onSync?: (batch: SyncBatch) => Promise<void>;
  onConflict?: (conflict: SyncConflict) => Promise<'local' | 'remote' | 'merged'>;
}

// ============================================================================
// Event Types for EventEmitter
// ============================================================================

export interface SyncManagerEvents {
  'event:queued': (event: SyncEvent) => void;
  'batch:ready': (batch: SyncBatch) => void;
  'batch:sent': (batch: SyncBatch) => void;
  'batch:received': (batch: SyncBatch) => void;
  'conflict:detected': (conflict: SyncConflict) => void;
  'conflict:resolved': (conflict: SyncConflict) => void;
  'sync:error': (error: Error, event?: SyncEvent) => void;
  'status:changed': (status: SyncStatus) => void;
}

// ============================================================================
// Priority Mapping
// ============================================================================

const PRIORITY_VALUES: Record<SyncPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

// ============================================================================
// EventDrivenSyncManager
// ============================================================================

/**
 * EventDrivenSyncManager - Manages event-driven synchronization between agents
 */
export class EventDrivenSyncManager extends EventEmitter {
  private config: EventDrivenSyncConfig;
  private eventQueue: PriorityQueue<SyncEvent>;
  private vectorClock: VectorClock;
  private batchTimer?: NodeJS.Timeout;
  private pendingBatch: SyncEvent[] = [];
  private conflicts: Map<string, SyncConflict> = new Map();
  private processedEvents: Set<string> = new Set();
  private connected: boolean = false;
  private lastSyncAt?: number;

  constructor(config: EventDrivenSyncConfig) {
    super();
    this.config = config;
    this.eventQueue = new PriorityQueue<SyncEvent>();
    this.vectorClock = new VectorClock();
  }

  /**
   * Generate a unique event ID
   */
  private generateId(): string {
    return `evt_${Date.now()}_${randomBytes(4).toString('hex')}`;
  }

  /**
   * Start the sync manager
   */
  start(): void {
    if (this.batchTimer) return;

    this.connected = true;
    this.batchTimer = setInterval(() => {
      this.processBatch().catch(err => {
        this.emit('sync:error', err as Error);
      });
    }, this.config.batchInterval);

    this.emitStatus();
  }

  /**
   * Stop the sync manager
   */
  stop(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = undefined;
    }
    this.connected = false;
    this.emitStatus();
  }

  /**
   * Emit a sync event
   */
  emitEvent(
    type: SyncEventType,
    data: MemoryChange,
    target: 'shared' | 'broadcast' | string[] = 'broadcast',
    priority: SyncPriority = 'normal'
  ): SyncEvent {
    // Increment vector clock
    this.vectorClock.increment(this.config.nodeId);

    const event: SyncEvent = {
      id: this.generateId(),
      type,
      source: this.config.nodeId,
      target,
      data,
      vectorClock: this.vectorClock.clone(),
      timestamp: Date.now(),
      priority,
      retryCount: 0,
    };

    // Add to queue with priority
    this.eventQueue.enqueue(event, PRIORITY_VALUES[priority] * 1000 + event.timestamp);
    this.pendingBatch.push(event);

    this.emit('event:queued', event);
    this.emitStatus();

    // Process immediately for high priority events
    if (priority === 'high') {
      this.processBatch().catch(err => {
        this.emit('sync:error', err as Error, event);
      });
    }

    return event;
  }

  /**
   * Process the current batch of events
   */
  private async processBatch(): Promise<void> {
    if (this.pendingBatch.length === 0) return;

    // Take up to maxBatchSize events
    const eventsToProcess = this.pendingBatch.slice(0, this.config.maxBatchSize);
    this.pendingBatch = this.pendingBatch.slice(this.config.maxBatchSize);

    // Clear corresponding items from queue
    for (let i = 0; i < eventsToProcess.length; i++) {
      this.eventQueue.dequeue();
    }

    const batch: SyncBatch = {
      id: `batch_${Date.now()}_${randomBytes(4).toString('hex')}`,
      events: eventsToProcess,
      source: this.config.nodeId,
      vectorClock: this.vectorClock.clone(),
      timestamp: Date.now(),
    };

    this.emit('batch:ready', batch);

    try {
      if (this.config.onSync) {
        await this.config.onSync(batch);
      }
      this.lastSyncAt = Date.now();
      this.emit('batch:sent', batch);
    } catch (error) {
      // Re-queue failed events for retry
      for (const event of eventsToProcess) {
        if (event.retryCount < this.config.maxRetries) {
          event.retryCount++;
          this.pendingBatch.push(event);
          this.eventQueue.enqueue(
            event,
            PRIORITY_VALUES[event.priority] * 1000 + event.timestamp + event.retryCount * 10000
          );
        }
      }
      this.emit('sync:error', error as Error);
    }

    this.emitStatus();
  }

  /**
   * Receive a batch from another node
   */
  async receiveBatch(batch: SyncBatch): Promise<{
    processed: number;
    conflicts: SyncConflict[];
  }> {
    this.emit('batch:received', batch);

    const conflicts: SyncConflict[] = [];
    let processed = 0;

    for (const event of batch.events) {
      // Skip already processed events
      if (this.processedEvents.has(event.id)) {
        continue;
      }

      // Check for conflicts
      const conflict = await this.detectConflict(event);
      if (conflict) {
        this.emit('conflict:detected', conflict);
        const resolution = await this.resolveConflict(conflict);
        conflicts.push({ ...conflict, ...resolution });
      }

      // Merge vector clock
      this.vectorClock.mergeInPlace(event.vectorClock);

      // Mark as processed
      this.processedEvents.add(event.id);
      processed++;

      // Cleanup old processed events (keep last 10000)
      if (this.processedEvents.size > 10000) {
        const iterator = this.processedEvents.values();
        for (let i = 0; i < 1000; i++) {
          const first = iterator.next().value;
          if (first) this.processedEvents.delete(first);
        }
      }
    }

    this.lastSyncAt = Date.now();
    this.emitStatus();

    return { processed, conflicts };
  }

  /**
   * Detect if an event conflicts with local state
   */
  private async detectConflict(event: SyncEvent): Promise<SyncConflict | null> {
    // This would need to be connected to actual storage
    // For now, we'll use the vector clock to detect concurrent events
    const comparison = this.vectorClock.compare(event.vectorClock);

    if (comparison === 'concurrent') {
      return {
        id: `conflict_${Date.now()}_${randomBytes(4).toString('hex')}`,
        event,
        localData: null, // Would be fetched from storage
        remoteData: event.data.value,
      };
    }

    return null;
  }

  /**
   * Resolve a conflict using the configured strategy
   */
  private async resolveConflict(conflict: SyncConflict): Promise<{
    resolvedWith: 'local' | 'remote' | 'merged';
    resolvedData: unknown;
  }> {
    // Try custom handler first
    if (this.config.onConflict) {
      const resolution = await this.config.onConflict(conflict);
      conflict.resolvedWith = resolution;
      this.conflicts.set(conflict.id, conflict);
      this.emit('conflict:resolved', conflict);

      return {
        resolvedWith: resolution,
        resolvedData: resolution === 'local' ? conflict.localData : conflict.remoteData,
      };
    }

    // Use configured strategy
    const resolution = this.applyStrategy(conflict, this.config.conflictStrategy);
    conflict.resolvedWith = resolution.resolvedWith;
    conflict.resolvedData = resolution.resolvedData;
    this.conflicts.set(conflict.id, conflict);
    this.emit('conflict:resolved', conflict);

    return resolution;
  }

  /**
   * Apply a conflict resolution strategy
   */
  private applyStrategy(
    conflict: SyncConflict,
    strategy: ConflictStrategy
  ): { resolvedWith: 'local' | 'remote' | 'merged'; resolvedData: unknown } {
    switch (strategy) {
      case 'newer_wins':
        // Use timestamp from event
        return {
          resolvedWith: 'remote',
          resolvedData: conflict.remoteData,
        };

      case 'higher_importance':
        const localImportance = this.extractImportance(conflict.localData);
        const remoteImportance = this.extractImportance(conflict.remoteData);
        if (localImportance >= remoteImportance) {
          return { resolvedWith: 'local', resolvedData: conflict.localData };
        }
        return { resolvedWith: 'remote', resolvedData: conflict.remoteData };

      case 'higher_confidence':
        const localConfidence = this.extractConfidence(conflict.localData);
        const remoteConfidence = this.extractConfidence(conflict.remoteData);
        if (localConfidence >= remoteConfidence) {
          return { resolvedWith: 'local', resolvedData: conflict.localData };
        }
        return { resolvedWith: 'remote', resolvedData: conflict.remoteData };

      case 'merge_observations':
      case 'merge_learnings':
        const merged = this.mergeData(conflict.localData, conflict.remoteData, strategy);
        return { resolvedWith: 'merged', resolvedData: merged };

      case 'manual':
      default:
        // Default to local for manual resolution
        return { resolvedWith: 'local', resolvedData: conflict.localData };
    }
  }

  /**
   * Extract importance from data
   */
  private extractImportance(data: unknown): number {
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      if (typeof obj.importance === 'number') return obj.importance;
    }
    return 0;
  }

  /**
   * Extract confidence from data
   */
  private extractConfidence(data: unknown): number {
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      if (typeof obj.confidence === 'number') return obj.confidence;
    }
    return 0;
  }

  /**
   * Merge data based on strategy
   */
  private mergeData(local: unknown, remote: unknown, strategy: ConflictStrategy): unknown {
    if (local === null || local === undefined) return remote;
    if (remote === null || remote === undefined) return local;

    if (typeof local !== 'object' || typeof remote !== 'object') {
      // For primitives, prefer remote (newer)
      return remote;
    }

    const localObj = local as Record<string, unknown>;
    const remoteObj = remote as Record<string, unknown>;

    const result: Record<string, unknown> = { ...localObj };

    // Merge specific fields based on strategy
    if (strategy === 'merge_observations' && Array.isArray(localObj.observations) && Array.isArray(remoteObj.observations)) {
      result.observations = CRDTMerge.unionArray(localObj.observations, remoteObj.observations);
    }

    if (strategy === 'merge_learnings') {
      // Merge outcome.learnings if present
      if (localObj.outcome && remoteObj.outcome) {
        const localOutcome = localObj.outcome as Record<string, unknown>;
        const remoteOutcome = remoteObj.outcome as Record<string, unknown>;
        if (Array.isArray(localOutcome.learnings) && Array.isArray(remoteOutcome.learnings)) {
          result.outcome = {
            ...localOutcome,
            learnings: CRDTMerge.unionArray(localOutcome.learnings, remoteOutcome.learnings),
          };
        }
      }
    }

    // Merge tags if present
    if (Array.isArray(localObj.tags) && Array.isArray(remoteObj.tags)) {
      result.tags = CRDTMerge.unionArray(localObj.tags, remoteObj.tags);
    }

    return result;
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return {
      connected: this.connected,
      pendingEvents: this.eventQueue.size(),
      lastSyncAt: this.lastSyncAt,
      conflicts: this.conflicts.size,
      vectorClock: this.vectorClock.clone(),
    };
  }

  /**
   * Emit status change event
   */
  private emitStatus(): void {
    this.emit('status:changed', this.getStatus());
  }

  /**
   * Get pending conflicts
   */
  getConflicts(): SyncConflict[] {
    return Array.from(this.conflicts.values());
  }

  /**
   * Get unresolved conflicts
   */
  getUnresolvedConflicts(): SyncConflict[] {
    return Array.from(this.conflicts.values()).filter(c => !c.resolvedWith);
  }

  /**
   * Manually resolve a conflict
   */
  manuallyResolveConflict(
    conflictId: string,
    resolution: 'local' | 'remote',
    mergedData?: unknown
  ): boolean {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) return false;

    conflict.resolvedWith = mergedData ? 'merged' : resolution;
    conflict.resolvedData = mergedData ?? (resolution === 'local' ? conflict.localData : conflict.remoteData);
    this.emit('conflict:resolved', conflict);

    return true;
  }

  /**
   * Get vector clock
   */
  getVectorClock(): VectorClock {
    return this.vectorClock.clone();
  }

  /**
   * Force sync (process pending batch immediately)
   */
  async forceSync(): Promise<void> {
    await this.processBatch();
  }

  /**
   * Clear all pending events
   */
  clearPending(): void {
    this.pendingBatch = [];
    this.eventQueue.clear();
    this.emitStatus();
  }

  /**
   * Get pending event count
   */
  getPendingCount(): number {
    return this.pendingBatch.length;
  }
}

/**
 * Create a sync event for a memory change
 */
export function createMemoryChangeEvent(
  memoryType: 'working' | 'episodic' | 'semantic' | 'shared',
  key: string,
  type: SyncEventType,
  value?: unknown,
  metadata?: Record<string, unknown>
): MemoryChange {
  return {
    memoryType,
    key,
    value,
    metadata,
  };
}

/**
 * Serialize a SyncEvent for transport
 */
export function serializeSyncEvent(event: SyncEvent): Record<string, unknown> {
  return {
    ...event,
    vectorClock: event.vectorClock.toObject(),
  };
}

/**
 * Deserialize a SyncEvent from transport
 */
export function deserializeSyncEvent(data: Record<string, unknown>): SyncEvent {
  return {
    id: data.id as string,
    type: data.type as SyncEventType,
    source: data.source as string,
    target: data.target as 'shared' | 'broadcast' | string[],
    data: data.data as MemoryChange,
    vectorClock: VectorClock.fromObject(data.vectorClock as Record<string, number>),
    timestamp: data.timestamp as number,
    priority: data.priority as SyncPriority,
    retryCount: data.retryCount as number,
  };
}

/**
 * Serialize a SyncBatch for transport
 */
export function serializeSyncBatch(batch: SyncBatch): Record<string, unknown> {
  return {
    ...batch,
    events: batch.events.map(serializeSyncEvent),
    vectorClock: batch.vectorClock.toObject(),
  };
}

/**
 * Deserialize a SyncBatch from transport
 */
export function deserializeSyncBatch(data: Record<string, unknown>): SyncBatch {
  return {
    id: data.id as string,
    events: (data.events as Record<string, unknown>[]).map(deserializeSyncEvent),
    source: data.source as string,
    vectorClock: VectorClock.fromObject(data.vectorClock as Record<string, number>),
    timestamp: data.timestamp as number,
  };
}
