/**
 * PersistentEventEmitter - Event emitter with SQLite persistence
 *
 * Extends MemoryEventEmitter with:
 * - Automatic persistence of events to SQLite
 * - Event replay from storage
 * - Audit trail queries
 */

import { MemoryEventEmitter } from './MemoryEventEmitter.js';
import { EventStoreRepository, type EventQuery } from '../storage/repositories/EventStoreRepository.js';
import type { DatabaseConnection } from '../storage/DatabaseConnection.js';
import type { AllMemoryEvents, MemoryEventType } from './types.js';

export interface PersistentEventEmitterConfig {
  /** Whether to persist events to storage (default: true) */
  persist?: boolean;
  /** Maximum age of events to keep in days (default: 30) */
  maxAgeDays?: number;
  /** Clean up old events on startup (default: true) */
  cleanupOnStart?: boolean;
}

export class PersistentEventEmitter extends MemoryEventEmitter {
  private eventStore: EventStoreRepository;
  private persist: boolean;
  private maxAgeDays: number;

  constructor(connection: DatabaseConnection, config?: PersistentEventEmitterConfig) {
    super();
    this.eventStore = new EventStoreRepository(connection);
    this.persist = config?.persist !== false;
    this.maxAgeDays = config?.maxAgeDays ?? 30;

    // Initialize tables
    this.eventStore.createTables();

    // Cleanup old events
    if (config?.cleanupOnStart !== false) {
      this.cleanupOldEvents();
    }
  }

  /**
   * Emit an event (overrides base to add persistence)
   */
  override emit<T extends AllMemoryEvents>(event: Omit<T, 'timestamp'> & { timestamp?: number }): void {
    const fullEvent = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    } as AllMemoryEvents;

    // Persist to storage
    if (this.persist) {
      try {
        this.eventStore.append(fullEvent);
      } catch (error) {
        console.error('[PersistentEventEmitter] Failed to persist event:', error);
      }
    }

    // Emit to listeners
    super.emit(fullEvent);
  }

  /**
   * Query persisted events
   */
  queryEvents(query: EventQuery): AllMemoryEvents[] {
    return this.eventStore.query(query);
  }

  /**
   * Get event count
   */
  getEventCount(query?: Omit<EventQuery, 'limit' | 'offset'>): number {
    return this.eventStore.count(query);
  }

  /**
   * Get the latest event of a specific type
   */
  getLatestEvent(type: MemoryEventType): AllMemoryEvents | null {
    return this.eventStore.getLatest(type);
  }

  /**
   * Get event statistics
   */
  getEventStats(): {
    totalEvents: number;
    eventsByType: Record<string, number>;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
  } {
    return this.eventStore.getStats();
  }

  /**
   * Replay events to listeners
   */
  replay(query: EventQuery, listener?: (event: AllMemoryEvents) => void): number {
    const events = this.eventStore.query(query);

    for (const event of events) {
      if (listener) {
        listener(event);
      } else {
        // Re-emit to current listeners
        super.emit(event);
      }
    }

    return events.length;
  }

  /**
   * Clean up old events
   */
  cleanupOldEvents(): number {
    const cutoff = Date.now() - (this.maxAgeDays * 24 * 60 * 60 * 1000);
    return this.eventStore.deleteOlderThan(cutoff);
  }

  /**
   * Delete events by session
   */
  deleteSessionEvents(sessionId: string): number {
    return this.eventStore.deleteBySession(sessionId);
  }

  /**
   * Get audit log for a specific memory item
   */
  getAuditLog(options: {
    type?: MemoryEventType | MemoryEventType[];
    since?: number;
    until?: number;
    sessionId?: string;
    limit?: number;
  }): AllMemoryEvents[] {
    return this.eventStore.query({
      types: Array.isArray(options.type) ? options.type : options.type ? [options.type] : undefined,
      type: typeof options.type === 'string' ? options.type : undefined,
      since: options.since,
      until: options.until,
      sessionId: options.sessionId,
      limit: options.limit,
    });
  }
}
