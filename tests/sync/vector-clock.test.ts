/**
 * VectorClock unit tests
 */

import { describe, it, expect } from 'vitest';
import { VectorClock, PriorityQueue, CRDTMerge } from '../../src/sync/VectorClock.js';

describe('VectorClock', () => {
  describe('basic operations', () => {
    it('starts with empty clock', () => {
      const clock = new VectorClock();
      expect(clock.getLogicalTime()).toBe(0);
      expect(clock.toObject()).toEqual({});
    });

    it('increments for a node', () => {
      const clock = new VectorClock();
      clock.increment('node-1');
      expect(clock.get('node-1')).toBe(1);
      expect(clock.getLogicalTime()).toBe(1);

      clock.increment('node-1');
      expect(clock.get('node-1')).toBe(2);
      expect(clock.getLogicalTime()).toBe(2);
    });

    it('tracks multiple nodes independently', () => {
      const clock = new VectorClock();
      clock.increment('node-1');
      clock.increment('node-1');
      clock.increment('node-2');

      expect(clock.get('node-1')).toBe(2);
      expect(clock.get('node-2')).toBe(1);
      expect(clock.getLogicalTime()).toBe(3);
    });
  });

  describe('comparison', () => {
    it('equal clocks are equal', () => {
      const clock1 = new VectorClock();
      clock1.increment('node-1');

      const clock2 = new VectorClock();
      clock2.increment('node-1');

      expect(clock1.compare(clock2)).toBe('equal');
    });

    it('detects before relationship', () => {
      const clock1 = new VectorClock();
      clock1.increment('node-1');

      const clock2 = new VectorClock();
      clock2.increment('node-1');
      clock2.increment('node-1');

      expect(clock1.compare(clock2)).toBe('before');
    });

    it('detects after relationship', () => {
      const clock1 = new VectorClock();
      clock1.increment('node-1');
      clock1.increment('node-1');

      const clock2 = new VectorClock();
      clock2.increment('node-1');

      expect(clock1.compare(clock2)).toBe('after');
    });

    it('detects concurrent relationship', () => {
      const clock1 = new VectorClock();
      clock1.increment('node-1');

      const clock2 = new VectorClock();
      clock2.increment('node-2');

      expect(clock1.compare(clock2)).toBe('concurrent');
    });

    it('detects concurrent with partial ordering', () => {
      const clock1 = new VectorClock();
      clock1.increment('node-1');
      clock1.increment('node-1');
      clock1.increment('node-2');

      const clock2 = new VectorClock();
      clock2.increment('node-1');
      clock2.increment('node-2');
      clock2.increment('node-2');

      // clock1: {node-1: 2, node-2: 1}
      // clock2: {node-1: 1, node-2: 2}
      // Neither dominates the other
      expect(clock1.compare(clock2)).toBe('concurrent');
    });
  });

  describe('merge', () => {
    it('merges two clocks taking max values', () => {
      const clock1 = new VectorClock();
      clock1.increment('node-1');
      clock1.increment('node-1');
      clock1.increment('node-2');

      const clock2 = new VectorClock();
      clock2.increment('node-1');
      clock2.increment('node-2');
      clock2.increment('node-2');
      clock2.increment('node-3');

      const merged = clock1.merge(clock2);

      expect(merged.get('node-1')).toBe(2);
      expect(merged.get('node-2')).toBe(2);
      expect(merged.get('node-3')).toBe(1);
    });

    it('merge is commutative', () => {
      const clock1 = new VectorClock();
      clock1.increment('node-1');

      const clock2 = new VectorClock();
      clock2.increment('node-2');

      const merged1 = clock1.merge(clock2);
      const merged2 = clock2.merge(clock1);

      expect(merged1.toObject()).toEqual(merged2.toObject());
    });
  });

  describe('clone', () => {
    it('creates independent copy', () => {
      const clock1 = new VectorClock();
      clock1.increment('node-1');

      const clock2 = clock1.clone();
      clock2.increment('node-2');

      expect(clock1.get('node-2')).toBe(0);
      expect(clock2.get('node-2')).toBe(1);
    });
  });

  describe('serialization', () => {
    it('converts to and from JSON', () => {
      const clock1 = new VectorClock();
      clock1.increment('node-1');
      clock1.increment('node-2');

      const json = clock1.toJSON();
      const clock2 = VectorClock.fromJSON(json);

      expect(clock2.get('node-1')).toBe(1);
      expect(clock2.get('node-2')).toBe(1);
      expect(clock1.compare(clock2)).toBe('equal');
    });

    it('converts to and from object', () => {
      const clock1 = new VectorClock();
      clock1.increment('node-1');
      clock1.increment('node-2');

      const obj = clock1.toObject();
      const clock2 = VectorClock.fromObject(obj);

      expect(obj).toEqual({ 'node-1': 1, 'node-2': 1 });
      expect(clock1.compare(clock2)).toBe('equal');
    });
  });
});

describe('PriorityQueue', () => {
  it('dequeues in priority order (lower priority number = higher priority)', () => {
    const queue = new PriorityQueue<string>();

    queue.enqueue('low', 2);
    queue.enqueue('high', 0);
    queue.enqueue('normal', 1);

    expect(queue.dequeue()).toBe('high');
    expect(queue.dequeue()).toBe('normal');
    expect(queue.dequeue()).toBe('low');
  });

  it('returns undefined when empty', () => {
    const queue = new PriorityQueue<number>();
    expect(queue.dequeue()).toBeUndefined();
  });

  it('reports correct size', () => {
    const queue = new PriorityQueue<number>();
    expect(queue.size()).toBe(0);

    queue.enqueue(1, 1);
    queue.enqueue(2, 2);
    expect(queue.size()).toBe(2);

    queue.dequeue();
    expect(queue.size()).toBe(1);
  });

  it('peek returns without removing', () => {
    const queue = new PriorityQueue<number>();
    queue.enqueue(5, 5);
    queue.enqueue(3, 3);

    expect(queue.peek()).toBe(3);
    expect(queue.peek()).toBe(3);
    expect(queue.size()).toBe(2);
  });

  it('isEmpty returns correct state', () => {
    const queue = new PriorityQueue<number>();
    expect(queue.isEmpty()).toBe(true);

    queue.enqueue(1, 1);
    expect(queue.isEmpty()).toBe(false);

    queue.dequeue();
    expect(queue.isEmpty()).toBe(true);
  });
});

describe('CRDTMerge', () => {
  describe('unionArray', () => {
    it('performs union of arrays', () => {
      const result = CRDTMerge.unionArray([1, 2, 3], [2, 3, 4]);
      expect(result.sort()).toEqual([1, 2, 3, 4]);
    });

    it('handles string arrays', () => {
      const result = CRDTMerge.unionArray(['a', 'b'], ['b', 'c']);
      expect(result.sort()).toEqual(['a', 'b', 'c']);
    });

    it('handles empty arrays', () => {
      expect(CRDTMerge.unionArray([], [1, 2])).toEqual([1, 2]);
      expect(CRDTMerge.unionArray([1, 2], [])).toEqual([1, 2]);
      expect(CRDTMerge.unionArray([], [])).toEqual([]);
    });
  });

  describe('mergeStringArrays', () => {
    it('merges string arrays', () => {
      const result = CRDTMerge.mergeStringArrays(['a', 'b'], ['b', 'c']);
      expect(result.sort()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('lwwScalar', () => {
    it('uses vector clock for LWW', () => {
      const clock1 = new VectorClock();
      clock1.increment('node-1');

      const clock2 = new VectorClock();
      clock2.increment('node-1');
      clock2.increment('node-1');

      const result = CRDTMerge.lwwScalar('old', 'new', clock1, clock2);
      expect(result.value).toBe('new');
      expect(result.localWon).toBe(false);
    });

    it('prefers local when equal', () => {
      const clock1 = new VectorClock();
      clock1.increment('node-1');

      const clock2 = new VectorClock();
      clock2.increment('node-1');

      const result = CRDTMerge.lwwScalar('local', 'remote', clock1, clock2);
      expect(result.value).toBe('local');
      expect(result.localWon).toBe(true);
    });
  });

  describe('maxValue', () => {
    it('returns max of two numbers', () => {
      expect(CRDTMerge.maxValue(5, 10)).toBe(10);
      expect(CRDTMerge.maxValue(10, 5)).toBe(10);
    });
  });

  describe('averageValue', () => {
    it('returns average of two numbers', () => {
      expect(CRDTMerge.averageValue(4, 8)).toBe(6);
    });
  });
});
