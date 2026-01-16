/**
 * WorkingMemory unit tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('WorkingMemory', () => {
  let manager: MemoryManager;
  const testDataPath = join(tmpdir(), 'cc-memory-test-working-' + Date.now());

  beforeEach(async () => {
    manager = new MemoryManager({
      dataPath: testDataPath,
      sessionId: 'test-session-001',
    });
    // Wait for storage initialization
    await manager.ready();
  });

  afterEach(() => {
    manager.close();
    if (existsSync(testDataPath)) {
      rmSync(testDataPath, { recursive: true, force: true });
    }
  });

  describe('set and get', () => {
    it('should store and retrieve a simple value', () => {
      const item = manager.working.set({
        key: 'test-key',
        value: { foo: 'bar' },
      });

      expect(item.key).toBe('test-key');
      expect(item.value).toEqual({ foo: 'bar' });
      expect(item.type).toBe('context'); // default type

      const retrieved = manager.working.get('test-key');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.value).toEqual({ foo: 'bar' });
    });

    it('should store with custom type', () => {
      const item = manager.working.set({
        key: 'task-key',
        value: { taskId: '123' },
        type: 'task_state',
      });

      expect(item.type).toBe('task_state');
    });

    it('should store with custom TTL', () => {
      const ttl = 5000; // 5 seconds
      const item = manager.working.set({
        key: 'short-lived',
        value: 'temporary',
        ttl,
      });

      const now = Date.now();
      expect(item.metadata.expiresAt).toBeGreaterThan(now);
      expect(item.metadata.expiresAt).toBeLessThanOrEqual(now + ttl + 100);
    });

    it('should store with priority', () => {
      const item = manager.working.set({
        key: 'important',
        value: 'critical data',
        priority: 'high',
      });

      expect(item.metadata.priority).toBe('high');
    });

    it('should store with tags', () => {
      const item = manager.working.set({
        key: 'tagged-item',
        value: 'data',
        tags: ['tag1', 'tag2'],
      });

      expect(item.tags).toEqual(['tag1', 'tag2']);
    });

    it('should update existing item', () => {
      manager.working.set({
        key: 'update-test',
        value: 'original',
      });

      const updated = manager.working.set({
        key: 'update-test',
        value: 'updated',
      });

      expect(updated.value).toBe('updated');

      const retrieved = manager.working.get('update-test');
      expect(retrieved?.value).toBe('updated');
    });

    it('should return null for non-existent key', () => {
      const result = manager.working.get('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete an existing item', () => {
      manager.working.set({ key: 'to-delete', value: 'data' });

      const deleted = manager.working.delete('to-delete');
      expect(deleted).toBe(true);

      const retrieved = manager.working.get('to-delete');
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent item', () => {
      const deleted = manager.working.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('list', () => {
    beforeEach(() => {
      manager.working.set({ key: 'item1', value: 'v1', type: 'context', tags: ['a'] });
      manager.working.set({ key: 'item2', value: 'v2', type: 'task_state', tags: ['b'] });
      manager.working.set({ key: 'item3', value: 'v3', type: 'context', tags: ['a', 'c'] });
    });

    it('should list all items', () => {
      const items = manager.working.list();
      expect(items.length).toBe(3);
    });

    it('should filter by type', () => {
      const items = manager.working.list({ type: 'context' });
      expect(items.length).toBe(2);
      expect(items.every(i => i.type === 'context')).toBe(true);
    });

    it('should filter by tags', () => {
      const items = manager.working.list({ tags: ['a'] });
      expect(items.length).toBe(2);
    });
  });

  describe('has', () => {
    it('should return true for existing item', () => {
      manager.working.set({ key: 'exists', value: 'data' });
      expect(manager.working.has('exists')).toBe(true);
    });

    it('should return false for non-existent item', () => {
      expect(manager.working.has('not-exists')).toBe(false);
    });
  });

  describe('touch', () => {
    it('should extend TTL of existing item', () => {
      const item = manager.working.set({
        key: 'touch-test',
        value: 'data',
        ttl: 1000,
      });

      const originalExpiry = item.metadata.expiresAt;

      // Wait a bit then touch
      const touched = manager.working.touch('touch-test', 10000);
      expect(touched).toBe(true);

      const updated = manager.working.get('touch-test');
      expect(updated?.metadata.expiresAt).toBeGreaterThan(originalExpiry);
    });

    it('should return false for non-existent item', () => {
      const result = manager.working.touch('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('clearExpired', () => {
    it('should clear expired items', async () => {
      // Create item with very short TTL
      manager.working.set({
        key: 'expired-soon',
        value: 'temp',
        ttl: 1, // 1ms
      });

      manager.working.set({
        key: 'not-expired',
        value: 'persistent',
        ttl: 60000,
      });

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 50));

      const cleared = manager.working.clearExpired();
      expect(cleared).toBeGreaterThanOrEqual(1);

      // Verify expired item is gone
      expect(manager.working.has('expired-soon')).toBe(false);
      expect(manager.working.has('not-expired')).toBe(true);
    });
  });

  describe('clearAll', () => {
    it('should clear all items', () => {
      manager.working.set({ key: 'item1', value: 'v1' });
      manager.working.set({ key: 'item2', value: 'v2' });

      const cleared = manager.working.clearAll();
      expect(cleared).toBe(2);

      const items = manager.working.list();
      expect(items.length).toBe(0);
    });
  });

  describe('session management', () => {
    it('should get current session ID', () => {
      expect(manager.working.getSessionId()).toBe('test-session-001');
    });

    it('should get items by session', () => {
      manager.working.set({ key: 'session-item', value: 'data' });

      const items = manager.working.getBySession();
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].metadata.sessionId).toBe('test-session-001');
    });
  });
});
