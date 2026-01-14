/**
 * MemoryManager unit tests - Cross-memory operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('MemoryManager', () => {
  let manager: MemoryManager;
  const testDataPath = join(tmpdir(), 'cc-memory-test-manager-' + Date.now());

  beforeEach(async () => {
    manager = new MemoryManager({
      dataPath: testDataPath,
      sessionId: 'test-session-001',
    });
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(() => {
    manager.close();
    if (existsSync(testDataPath)) {
      rmSync(testDataPath, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    it('should initialize with default session ID', async () => {
      const newManager = new MemoryManager({
        dataPath: join(tmpdir(), 'cc-memory-test-init-' + Date.now()),
      });
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(newManager.getSessionId()).toBeDefined();
      expect(newManager.getSessionId().length).toBeGreaterThan(0);

      newManager.close();
    });

    it('should initialize with custom session ID', () => {
      expect(manager.getSessionId()).toBe('test-session-001');
    });

    it('should provide access to all memory layers', () => {
      expect(manager.working).toBeDefined();
      expect(manager.episodic).toBeDefined();
      expect(manager.semantic).toBeDefined();
    });
  });

  describe('consolidateToEpisodic', () => {
    it('should consolidate working memory to episodic', () => {
      manager.working.set({
        key: 'task-result',
        value: { result: 'success', data: [1, 2, 3] },
        tags: ['task', 'important'],
      });

      const episode = manager.consolidateToEpisodic('task-result', {
        type: 'success',
        summary: 'Task completed successfully',
        importance: 8,
        tags: ['consolidation'],
      });

      expect(episode).not.toBeNull();
      expect(episode?.type).toBe('success');
      expect(episode?.summary).toBe('Task completed successfully');
      expect(episode?.importance).toBe(8);
      expect(episode?.tags).toContain('task');
      expect(episode?.tags).toContain('consolidation');
    });

    it('should return null for non-existent working key', () => {
      const episode = manager.consolidateToEpisodic('non-existent', {
        type: 'error',
        summary: 'Test',
      });

      expect(episode).toBeNull();
    });

    it('should include working memory value in details', () => {
      manager.working.set({
        key: 'debug-info',
        value: { debug: 'data' },
      });

      const episode = manager.consolidateToEpisodic('debug-info', {
        type: 'incident',
        summary: 'Debug information captured',
      });

      expect(episode?.details).toContain('debug');
    });
  });

  describe('consolidateToSemantic', () => {
    it('should consolidate working memory to semantic', () => {
      manager.working.set({
        key: 'learned-pattern',
        value: { pattern: 'always use TypeScript for new projects' },
        tags: ['pattern', 'typescript'],
      });

      const entity = manager.consolidateToSemantic('learned-pattern', {
        name: 'typescript-preference',
        type: 'preference',
        description: 'User prefers TypeScript for new projects',
        tags: ['consolidation'],
      });

      expect(entity).not.toBeNull();
      expect(entity?.name).toBe('typescript-preference');
      expect(entity?.type).toBe('preference');
      expect(entity?.content).toEqual({ pattern: 'always use TypeScript for new projects' });
      expect(entity?.tags).toContain('pattern');
      expect(entity?.tags).toContain('consolidation');
    });

    it('should return null for non-existent working key', () => {
      const entity = manager.consolidateToSemantic('non-existent', {
        name: 'test',
        type: 'fact',
        description: 'Test',
      });

      expect(entity).toBeNull();
    });
  });

  describe('recall', () => {
    beforeEach(() => {
      // Add working memory items
      manager.working.set({
        key: 'current-task',
        value: 'Implementing authentication',
        tags: ['auth', 'task'],
      });

      // Add episodic memories
      manager.episodic.record({
        type: 'success',
        summary: 'Implemented OAuth2 authentication',
        details: 'Successfully added OAuth2 support',
        tags: ['auth', 'oauth'],
      });

      // Add semantic entities
      manager.semantic.create({
        name: 'auth-best-practice',
        type: 'pattern',
        description: 'Always use HTTPS for authentication',
        tags: ['auth', 'security'],
      });
    });

    it('should recall from all memory layers', () => {
      const result = manager.recall('auth');

      expect(result.working.length).toBeGreaterThan(0);
      expect(result.episodic.length).toBeGreaterThan(0);
      expect(result.semantic.length).toBeGreaterThan(0);
    });

    it('should recall only from working memory', () => {
      const result = manager.recall('auth', {
        includeWorking: true,
        includeEpisodic: false,
        includeSemantic: false,
      });

      expect(result.working.length).toBeGreaterThan(0);
      expect(result.episodic.length).toBe(0);
      expect(result.semantic.length).toBe(0);
    });

    it('should recall only from episodic memory', () => {
      const result = manager.recall('OAuth', {
        includeWorking: false,
        includeEpisodic: true,
        includeSemantic: false,
      });

      expect(result.working.length).toBe(0);
      expect(result.episodic.length).toBeGreaterThan(0);
      expect(result.semantic.length).toBe(0);
    });

    it('should recall only from semantic memory', () => {
      const result = manager.recall('security', {
        includeWorking: false,
        includeEpisodic: false,
        includeSemantic: true,
      });

      expect(result.working.length).toBe(0);
      expect(result.episodic.length).toBe(0);
      expect(result.semantic.length).toBeGreaterThan(0);
    });

    it('should respect limit', () => {
      // Add more items
      for (let i = 0; i < 5; i++) {
        manager.working.set({
          key: `auth-item-${i}`,
          value: `Authentication data ${i}`,
          tags: ['auth'],
        });
      }

      const result = manager.recall('auth', { limit: 2 });
      expect(result.working.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getFormattedContext', () => {
    beforeEach(() => {
      manager.working.set({
        key: 'current-project',
        value: 'Memory System',
        type: 'context',
      });

      manager.episodic.record({
        type: 'success',
        summary: 'Built working memory module',
        details: 'Completed implementation',
        outcome: {
          status: 'success',
          learnings: ['SQLite works well for this use case'],
        },
      });

      manager.semantic.create({
        name: 'project-architecture',
        type: 'pattern',
        description: 'Hierarchical memory architecture',
        observations: ['Three-layer design is effective'],
      });
    });

    it('should return formatted context string', async () => {
      const context = await manager.getFormattedContext('memory');

      expect(context).toContain('Working Memory');
      expect(context).toContain('Episodic Memory');
      expect(context).toContain('Semantic Memory');
    });

    it('should return no memories message when no matches', async () => {
      const context = await manager.getFormattedContext('zzzznonexistent');

      expect(context).toContain('No relevant memories found');
    });
  });

  describe('getStats', () => {
    it('should return memory statistics', () => {
      manager.working.set({ key: 'w1', value: 'v1', type: 'context' });
      manager.working.set({ key: 'w2', value: 'v2', type: 'task_state' });

      manager.episodic.record({ type: 'success', summary: 'S1', details: 'D1' });
      manager.episodic.record({ type: 'error', summary: 'E1', details: 'D2' });

      manager.semantic.create({ name: 'f1', type: 'fact', description: 'Fact' });

      const stats = manager.getStats();

      expect(stats.working.total).toBe(2);
      expect(stats.episodic.total).toBe(2);
      expect(stats.semantic.entities).toBe(1);
    });
  });

  describe('export', () => {
    it('should export all memory data', () => {
      manager.working.set({ key: 'w1', value: 'v1' });
      manager.episodic.record({ type: 'success', summary: 'S1', details: 'D1' });

      const e1 = manager.semantic.create({ name: 'e1', type: 'fact', description: 'F1' });
      const e2 = manager.semantic.create({ name: 'e2', type: 'fact', description: 'F2' });
      manager.semantic.relate(e1.id, e2.id, 'related_to');

      const exportData = manager.export();

      expect(exportData.version).toBe('1.0.0');
      expect(exportData.exportedAt).toBeDefined();
      expect(exportData.working.length).toBe(1);
      expect(exportData.episodic.length).toBe(1);
      expect(exportData.semantic.entities.length).toBe(2);
      expect(exportData.semantic.relations.length).toBe(1);
    });
  });

  describe('session management', () => {
    it('should get session ID', () => {
      expect(manager.getSessionId()).toBe('test-session-001');
    });

    it('should set session ID and propagate to memory layers', () => {
      manager.setSessionId('new-session-002');

      expect(manager.getSessionId()).toBe('new-session-002');
      expect(manager.working.getSessionId()).toBe('new-session-002');
      expect(manager.episodic.getSessionId()).toBe('new-session-002');
    });
  });

  describe('cleanup', () => {
    it('should start automatic cleanup with interval', async () => {
      const cleanupManager = new MemoryManager({
        dataPath: join(tmpdir(), 'cc-memory-test-cleanup-' + Date.now()),
        cleanupInterval: 100, // 100ms
      });
      await new Promise(resolve => setTimeout(resolve, 100));

      // Add item with very short TTL
      cleanupManager.working.set({
        key: 'short-lived',
        value: 'temp',
        ttl: 1,
      });

      // Wait for cleanup to run
      await new Promise(resolve => setTimeout(resolve, 200));

      // Item should be cleaned up
      expect(cleanupManager.working.has('short-lived')).toBe(false);

      cleanupManager.close();
    });
  });

  describe('close', () => {
    it('should close without errors', () => {
      expect(() => manager.close()).not.toThrow();
    });

    it('should be safe to call multiple times', () => {
      manager.close();
      expect(() => manager.close()).not.toThrow();
    });
  });
});
