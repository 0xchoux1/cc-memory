/**
 * MemoryEventEmitter - Central event bus for memory events
 */

import type {
  MemoryEvent,
  MemoryEventType,
  MemoryEventListener,
  AllMemoryEvents,
} from './types.js';

export class MemoryEventEmitter {
  private listeners: Map<string, Set<MemoryEventListener>> = new Map();
  private globalListeners: Set<MemoryEventListener> = new Set();
  private eventHistory: AllMemoryEvents[] = [];
  private historyLimit: number = 1000;

  /**
   * Subscribe to a specific event type
   */
  on<T extends AllMemoryEvents>(
    eventType: T['type'],
    listener: MemoryEventListener<T>
  ): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener as MemoryEventListener);

    // Return unsubscribe function
    return () => {
      this.listeners.get(eventType)?.delete(listener as MemoryEventListener);
    };
  }

  /**
   * Subscribe to all events
   */
  onAny(listener: MemoryEventListener<AllMemoryEvents>): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  /**
   * Subscribe to multiple event types
   */
  onMany<T extends AllMemoryEvents>(
    eventTypes: T['type'][],
    listener: MemoryEventListener<T>
  ): () => void {
    const unsubscribes = eventTypes.map(type => this.on(type, listener));
    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }

  /**
   * Emit an event
   */
  emit<T extends AllMemoryEvents>(event: Omit<T, 'timestamp'> & { timestamp?: number }): void {
    const fullEvent = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    } as AllMemoryEvents;

    // Add to history
    this.eventHistory.push(fullEvent);
    if (this.eventHistory.length > this.historyLimit) {
      this.eventHistory.shift();
    }

    // Notify type-specific listeners
    const typeListeners = this.listeners.get(fullEvent.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        try {
          listener(fullEvent);
        } catch (error) {
          console.error(`[EventEmitter] Error in listener for ${fullEvent.type}:`, error);
        }
      }
    }

    // Notify global listeners
    for (const listener of this.globalListeners) {
      try {
        listener(fullEvent);
      } catch (error) {
        console.error(`[EventEmitter] Error in global listener:`, error);
      }
    }
  }

  /**
   * Get recent event history
   */
  getHistory(options?: {
    type?: MemoryEventType;
    limit?: number;
    since?: number;
  }): AllMemoryEvents[] {
    let events = [...this.eventHistory];

    if (options?.type) {
      events = events.filter(e => e.type === options.type);
    }

    if (options?.since) {
      events = events.filter(e => e.timestamp >= options.since!);
    }

    if (options?.limit) {
      events = events.slice(-options.limit);
    }

    return events;
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(): void {
    this.listeners.clear();
    this.globalListeners.clear();
  }

  /**
   * Get listener count for a specific event type
   */
  listenerCount(eventType?: MemoryEventType): number {
    if (eventType) {
      return (this.listeners.get(eventType)?.size ?? 0) + this.globalListeners.size;
    }
    let count = this.globalListeners.size;
    for (const listeners of this.listeners.values()) {
      count += listeners.size;
    }
    return count;
  }

  /**
   * Set history limit
   */
  setHistoryLimit(limit: number): void {
    this.historyLimit = limit;
    while (this.eventHistory.length > limit) {
      this.eventHistory.shift();
    }
  }
}

// Singleton instance
let globalEmitter: MemoryEventEmitter | null = null;

/**
 * Get the global event emitter instance
 */
export function getGlobalEmitter(): MemoryEventEmitter {
  if (!globalEmitter) {
    globalEmitter = new MemoryEventEmitter();
  }
  return globalEmitter;
}

/**
 * Reset the global emitter (useful for testing)
 */
export function resetGlobalEmitter(): void {
  if (globalEmitter) {
    globalEmitter.removeAllListeners();
    globalEmitter.clearHistory();
  }
  globalEmitter = null;
}
