/**
 * EpisodicMemory unit tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('EpisodicMemory', () => {
  let manager: MemoryManager;
  const testDataPath = join(tmpdir(), 'cc-memory-test-episodic-' + Date.now());

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

  describe('record', () => {
    it('should record a new episode', () => {
      const episode = manager.episodic.record({
        type: 'success',
        summary: 'Completed feature implementation',
        details: 'Successfully implemented the user authentication module',
      });

      expect(episode.id).toBeDefined();
      expect(episode.type).toBe('success');
      expect(episode.summary).toBe('Completed feature implementation');
      expect(episode.importance).toBe(5); // default
      expect(episode.context.sessionId).toBe('test-session-001');
    });

    it('should record episode with custom importance', () => {
      const episode = manager.episodic.record({
        type: 'error',
        summary: 'Critical bug found',
        details: 'Memory leak in production',
        importance: 9,
      });

      expect(episode.importance).toBe(9);
    });

    it('should record episode with tags', () => {
      const episode = manager.episodic.record({
        type: 'milestone',
        summary: 'Version 1.0 released',
        details: 'First stable release',
        tags: ['release', 'v1.0', 'milestone'],
      });

      expect(episode.tags).toEqual(['release', 'v1.0', 'milestone']);
    });

    it('should record episode with outcome', () => {
      const episode = manager.episodic.record({
        type: 'incident',
        summary: 'Server downtime',
        details: 'Production server was down for 30 minutes',
        outcome: {
          status: 'success',
          learnings: ['Need better monitoring', 'Implement auto-recovery'],
          resolution: 'Restarted the service and added health checks',
        },
      });

      expect(episode.outcome?.status).toBe('success');
      expect(episode.outcome?.learnings.length).toBe(2);
    });

    it('should record episode with context', () => {
      const episode = manager.episodic.record({
        type: 'interaction',
        summary: 'User reported bug',
        details: 'Bug in login form validation',
        context: {
          projectPath: '/home/user/project',
          branch: 'feature/login',
          files: ['src/login.ts', 'src/validation.ts'],
        },
      });

      expect(episode.context.projectPath).toBe('/home/user/project');
      expect(episode.context.branch).toBe('feature/login');
      expect(episode.context.files?.length).toBe(2);
    });
  });

  describe('get', () => {
    it('should retrieve episode by ID', () => {
      const created = manager.episodic.record({
        type: 'success',
        summary: 'Test episode',
        details: 'Test details',
      });

      const retrieved = manager.episodic.get(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.summary).toBe('Test episode');
    });

    it('should return null for non-existent ID', () => {
      const result = manager.episodic.get('non-existent-id');
      expect(result).toBeNull();
    });

    it('should increment access count on get', () => {
      const created = manager.episodic.record({
        type: 'success',
        summary: 'Access test',
        details: 'Testing access count',
      });

      expect(created.accessCount).toBe(0);

      manager.episodic.get(created.id);
      manager.episodic.get(created.id);

      const retrieved = manager.episodic.get(created.id);
      expect(retrieved?.accessCount).toBeGreaterThan(0);
    });
  });

  describe('getByIds', () => {
    it('should retrieve multiple episodes by IDs', () => {
      const ep1 = manager.episodic.record({
        type: 'success',
        summary: 'Episode 1',
        details: 'Details 1',
      });

      const ep2 = manager.episodic.record({
        type: 'error',
        summary: 'Episode 2',
        details: 'Details 2',
      });

      const results = manager.episodic.getByIds([ep1.id, ep2.id]);
      expect(results.length).toBe(2);
    });

    it('should skip non-existent IDs', () => {
      const ep = manager.episodic.record({
        type: 'success',
        summary: 'Episode',
        details: 'Details',
      });

      const results = manager.episodic.getByIds([ep.id, 'non-existent']);
      expect(results.length).toBe(1);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      manager.episodic.record({
        type: 'success',
        summary: 'Feature completed',
        details: 'Implemented authentication',
        importance: 7,
        tags: ['feature', 'auth'],
      });

      manager.episodic.record({
        type: 'error',
        summary: 'Bug found',
        details: 'Critical security issue in authentication',
        importance: 9,
        tags: ['bug', 'security', 'auth'],
      });

      manager.episodic.record({
        type: 'milestone',
        summary: 'Project kickoff',
        details: 'Started the project',
        importance: 5,
        tags: ['milestone'],
      });
    });

    it('should search by text query', () => {
      const results = manager.episodic.search({ query: 'authentication' });
      expect(results.length).toBe(2);
    });

    it('should filter by type', () => {
      const results = manager.episodic.search({ type: 'error' });
      expect(results.length).toBe(1);
      expect(results[0].type).toBe('error');
    });

    it('should filter by minimum importance', () => {
      const results = manager.episodic.search({ minImportance: 7 });
      expect(results.length).toBe(2);
    });

    it('should filter by tags', () => {
      const results = manager.episodic.search({ tags: ['auth'] });
      expect(results.length).toBe(2);
    });

    it('should limit results', () => {
      const results = manager.episodic.search({ limit: 1 });
      expect(results.length).toBe(1);
    });
  });

  describe('getRecent', () => {
    it('should get recent episodes', () => {
      for (let i = 0; i < 5; i++) {
        manager.episodic.record({
          type: 'success',
          summary: `Episode ${i}`,
          details: `Details ${i}`,
        });
      }

      const recent = manager.episodic.getRecent(3);
      expect(recent.length).toBe(3);
    });
  });

  describe('updateOutcome', () => {
    it('should update episode outcome', () => {
      const episode = manager.episodic.record({
        type: 'incident',
        summary: 'Incident',
        details: 'Details',
      });

      const success = manager.episodic.updateOutcome(episode.id, {
        status: 'success',
        learnings: ['Lesson learned'],
        resolution: 'Issue resolved',
      });

      expect(success).toBe(true);

      const updated = manager.episodic.get(episode.id);
      expect(updated?.outcome?.status).toBe('success');
      expect(updated?.outcome?.learnings).toContain('Lesson learned');
    });
  });

  describe('addLearnings', () => {
    it('should add learnings to episode', () => {
      const episode = manager.episodic.record({
        type: 'error',
        summary: 'Error',
        details: 'Details',
        outcome: {
          status: 'success',
          learnings: ['First learning'],
        },
      });

      const success = manager.episodic.addLearnings(episode.id, ['Second learning', 'Third learning']);
      expect(success).toBe(true);

      const updated = manager.episodic.get(episode.id);
      expect(updated?.outcome?.learnings.length).toBe(3);
    });

    it('should create outcome if not exists', () => {
      const episode = manager.episodic.record({
        type: 'incident',
        summary: 'Incident',
        details: 'Details',
      });

      manager.episodic.addLearnings(episode.id, ['New learning']);

      const updated = manager.episodic.get(episode.id);
      expect(updated?.outcome?.learnings).toContain('New learning');
    });
  });

  describe('updateImportance', () => {
    it('should update episode importance', () => {
      const episode = manager.episodic.record({
        type: 'success',
        summary: 'Success',
        details: 'Details',
        importance: 5,
      });

      manager.episodic.updateImportance(episode.id, 8);

      const updated = manager.episodic.get(episode.id);
      expect(updated?.importance).toBe(8);
    });

    it('should clamp importance to valid range', () => {
      const episode = manager.episodic.record({
        type: 'success',
        summary: 'Success',
        details: 'Details',
      });

      manager.episodic.updateImportance(episode.id, 15);
      let updated = manager.episodic.get(episode.id);
      expect(updated?.importance).toBeLessThanOrEqual(10);

      manager.episodic.updateImportance(episode.id, -5);
      updated = manager.episodic.get(episode.id);
      expect(updated?.importance).toBeGreaterThanOrEqual(1);
    });
  });

  describe('relate', () => {
    it('should relate two episodes', () => {
      const ep1 = manager.episodic.record({
        type: 'error',
        summary: 'Bug found',
        details: 'Found bug',
      });

      const ep2 = manager.episodic.record({
        type: 'success',
        summary: 'Bug fixed',
        details: 'Fixed the bug',
      });

      const success = manager.episodic.relate(ep1.id, ep2.id);
      expect(success).toBe(true);

      const updated = manager.episodic.get(ep1.id);
      expect(updated?.relatedEpisodes).toContain(ep2.id);
    });
  });

  describe('findSimilar', () => {
    it('should find similar episodes', () => {
      const ep1 = manager.episodic.record({
        type: 'error',
        summary: 'Auth error',
        details: 'Authentication failed',
        tags: ['auth', 'error'],
      });

      manager.episodic.record({
        type: 'error',
        summary: 'Another auth error',
        details: 'Token expired',
        tags: ['auth', 'error'],
      });

      manager.episodic.record({
        type: 'success',
        summary: 'Unrelated',
        details: 'Different thing',
        tags: ['other'],
      });

      const similar = manager.episodic.findSimilar(ep1.id);
      expect(similar.length).toBeGreaterThan(0);
    });
  });

  describe('getByType', () => {
    it('should get episodes by type', () => {
      manager.episodic.record({ type: 'error', summary: 'E1', details: 'D1' });
      manager.episodic.record({ type: 'error', summary: 'E2', details: 'D2' });
      manager.episodic.record({ type: 'success', summary: 'S1', details: 'D3' });

      const errors = manager.episodic.getByType('error');
      expect(errors.length).toBe(2);
      expect(errors.every(e => e.type === 'error')).toBe(true);
    });
  });

  describe('getByDateRange', () => {
    it('should get episodes within date range', async () => {
      const start = Date.now();

      manager.episodic.record({ type: 'success', summary: 'E1', details: 'D1' });

      await new Promise(resolve => setTimeout(resolve, 50));

      const end = Date.now();

      const results = manager.episodic.getByDateRange(start, end);
      expect(results.length).toBe(1);
    });
  });
});
