/**
 * CRDT-based Vector Clock implementation for conflict resolution
 * in distributed multi-agent memory systems.
 */

export type NodeId = string;

export interface VectorClockState {
  [nodeId: NodeId]: number;
}

export type ClockComparison = 'before' | 'after' | 'concurrent' | 'equal';

/**
 * Vector Clock for tracking causality in distributed systems.
 * Used for CRDT-based conflict detection and resolution.
 */
export class VectorClock {
  private clock: Map<NodeId, number>;

  constructor(initial?: VectorClockState) {
    this.clock = new Map();
    if (initial) {
      for (const [nodeId, time] of Object.entries(initial)) {
        this.clock.set(nodeId, time);
      }
    }
  }

  /**
   * Increment the clock for a specific node
   */
  increment(nodeId: NodeId): void {
    const current = this.clock.get(nodeId) ?? 0;
    this.clock.set(nodeId, current + 1);
  }

  /**
   * Get the time for a specific node
   */
  get(nodeId: NodeId): number {
    return this.clock.get(nodeId) ?? 0;
  }

  /**
   * Set the time for a specific node
   */
  set(nodeId: NodeId, time: number): void {
    this.clock.set(nodeId, time);
  }

  /**
   * Merge with another vector clock, taking the maximum of each component
   */
  merge(other: VectorClock): VectorClock {
    const result = new VectorClock(this.toObject());

    for (const [nodeId, time] of other.entries()) {
      const currentTime = result.get(nodeId);
      if (time > currentTime) {
        result.set(nodeId, time);
      }
    }

    return result;
  }

  /**
   * Merge in place with another vector clock
   */
  mergeInPlace(other: VectorClock): void {
    for (const [nodeId, time] of other.entries()) {
      const currentTime = this.get(nodeId);
      if (time > currentTime) {
        this.set(nodeId, time);
      }
    }
  }

  /**
   * Compare this clock with another clock.
   * Returns:
   * - 'before': this clock happened before the other
   * - 'after': this clock happened after the other
   * - 'concurrent': clocks are concurrent (neither happened before the other)
   * - 'equal': clocks are identical
   */
  compare(other: VectorClock): ClockComparison {
    let thisLessThanOther = false;
    let otherLessThanThis = false;

    // Collect all nodes from both clocks
    const allNodes = new Set([...this.clock.keys(), ...other.clock.keys()]);

    for (const nodeId of allNodes) {
      const thisTime = this.get(nodeId);
      const otherTime = other.get(nodeId);

      if (thisTime < otherTime) {
        thisLessThanOther = true;
      } else if (thisTime > otherTime) {
        otherLessThanThis = true;
      }
    }

    if (thisLessThanOther && !otherLessThanThis) {
      return 'before';
    } else if (otherLessThanThis && !thisLessThanOther) {
      return 'after';
    } else if (!thisLessThanOther && !otherLessThanThis) {
      return 'equal';
    } else {
      return 'concurrent';
    }
  }

  /**
   * Check if this clock causally precedes another
   */
  happenedBefore(other: VectorClock): boolean {
    return this.compare(other) === 'before';
  }

  /**
   * Check if this clock is concurrent with another (no causal relationship)
   */
  isConcurrentWith(other: VectorClock): boolean {
    return this.compare(other) === 'concurrent';
  }

  /**
   * Get the logical time (sum of all components)
   * Useful for LWW-Register implementations
   */
  getLogicalTime(): number {
    let sum = 0;
    for (const time of this.clock.values()) {
      sum += time;
    }
    return sum;
  }

  /**
   * Get the maximum component value
   */
  getMaxTime(): number {
    let max = 0;
    for (const time of this.clock.values()) {
      if (time > max) {
        max = time;
      }
    }
    return max;
  }

  /**
   * Get iterator over clock entries
   */
  entries(): IterableIterator<[NodeId, number]> {
    return this.clock.entries();
  }

  /**
   * Get the number of nodes tracked
   */
  size(): number {
    return this.clock.size;
  }

  /**
   * Check if clock is empty
   */
  isEmpty(): boolean {
    return this.clock.size === 0;
  }

  /**
   * Convert to plain object for serialization
   */
  toObject(): VectorClockState {
    const obj: VectorClockState = {};
    for (const [nodeId, time] of this.clock.entries()) {
      obj[nodeId] = time;
    }
    return obj;
  }

  /**
   * Create from plain object (deserialization)
   */
  static fromObject(obj: VectorClockState): VectorClock {
    return new VectorClock(obj);
  }

  /**
   * Convert to JSON string
   */
  toJSON(): string {
    return JSON.stringify(this.toObject());
  }

  /**
   * Parse from JSON string
   */
  static fromJSON(json: string): VectorClock {
    const obj = JSON.parse(json) as VectorClockState;
    return VectorClock.fromObject(obj);
  }

  /**
   * Clone this vector clock
   */
  clone(): VectorClock {
    return new VectorClock(this.toObject());
  }

  /**
   * Get a human-readable string representation
   */
  toString(): string {
    const entries = Array.from(this.clock.entries())
      .map(([nodeId, time]) => `${nodeId}:${time}`)
      .join(', ');
    return `VectorClock{${entries}}`;
  }
}

/**
 * Priority Queue for sync events based on logical time
 */
export interface PriorityQueueItem<T> {
  item: T;
  priority: number;
}

export class PriorityQueue<T> {
  private heap: PriorityQueueItem<T>[] = [];

  /**
   * Add an item with a priority (lower number = higher priority)
   */
  enqueue(item: T, priority: number): void {
    this.heap.push({ item, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  /**
   * Remove and return the highest priority item
   */
  dequeue(): T | undefined {
    if (this.heap.length === 0) return undefined;

    const result = this.heap[0];
    const last = this.heap.pop()!;

    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }

    return result.item;
  }

  /**
   * Peek at the highest priority item without removing it
   */
  peek(): T | undefined {
    return this.heap[0]?.item;
  }

  /**
   * Get the priority of the highest priority item
   */
  peekPriority(): number | undefined {
    return this.heap[0]?.priority;
  }

  /**
   * Get the number of items in the queue
   */
  size(): number {
    return this.heap.length;
  }

  /**
   * Check if the queue is empty
   */
  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /**
   * Clear all items from the queue
   */
  clear(): void {
    this.heap = [];
  }

  /**
   * Get all items as an array (does not modify the queue)
   */
  toArray(): T[] {
    return this.heap.map(item => item.item);
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.heap[parentIndex].priority <= this.heap[index].priority) {
        break;
      }
      this.swap(parentIndex, index);
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length;

    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let smallest = index;

      if (leftChild < length && this.heap[leftChild].priority < this.heap[smallest].priority) {
        smallest = leftChild;
      }

      if (rightChild < length && this.heap[rightChild].priority < this.heap[smallest].priority) {
        smallest = rightChild;
      }

      if (smallest === index) break;

      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(i: number, j: number): void {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
  }
}

/**
 * Merge strategies for CRDT-based conflict resolution
 */
export type MergeStrategy =
  | 'lww_wins'           // Last-Write-Wins by vector clock
  | 'merge_observations' // Merge observation lists
  | 'merge_learnings'    // Merge learning lists
  | 'higher_importance'  // Higher importance wins
  | 'higher_confidence'  // Higher confidence wins
  | 'union_tags';        // Union of all tags

export interface MergeResult<T> {
  merged: T;
  hadConflict: boolean;
  strategy: MergeStrategy;
  localWon?: boolean;
}

/**
 * CRDT Merge utilities
 */
export const CRDTMerge = {
  /**
   * Merge two arrays by taking the union (no duplicates)
   */
  unionArray<T>(local: T[], remote: T[]): T[] {
    const set = new Set([...local, ...remote]);
    return Array.from(set);
  },

  /**
   * Merge two string arrays (for observations, learnings, tags)
   */
  mergeStringArrays(local: string[], remote: string[]): string[] {
    return CRDTMerge.unionArray(local, remote);
  },

  /**
   * LWW merge for scalar values based on timestamp
   */
  lwwScalar<T>(
    local: T,
    remote: T,
    localClock: VectorClock,
    remoteClock: VectorClock
  ): { value: T; localWon: boolean } {
    const comparison = localClock.compare(remoteClock);

    if (comparison === 'after' || comparison === 'equal') {
      return { value: local, localWon: true };
    } else if (comparison === 'before') {
      return { value: remote, localWon: false };
    } else {
      // Concurrent: use logical time as tiebreaker
      const localTime = localClock.getLogicalTime();
      const remoteTime = remoteClock.getLogicalTime();

      if (localTime >= remoteTime) {
        return { value: local, localWon: true };
      } else {
        return { value: remote, localWon: false };
      }
    }
  },

  /**
   * Merge by taking the higher numeric value
   */
  maxValue(local: number, remote: number): number {
    return Math.max(local, remote);
  },

  /**
   * Merge by taking the average
   */
  averageValue(local: number, remote: number): number {
    return (local + remote) / 2;
  },
};
