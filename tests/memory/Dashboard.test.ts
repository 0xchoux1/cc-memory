/**
 * Memory Dashboard tests (P6)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Memory Dashboard (P6)', () => {
  let memoryManager: MemoryManager;
  const testDataPath = path.join(process.cwd(), 'test-data-dashboard');

  beforeEach(async () => {
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true });
    }
    fs.mkdirSync(testDataPath, { recursive: true });

    memoryManager = new MemoryManager({
      dataPath: testDataPath,
      sessionId: 'test-session',
    });

    // Wait for storage initialization
    await memoryManager.ready();
  });

  afterEach(() => {
    memoryManager.close();
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true });
    }
  });

  describe('Basic Dashboard', () => {
    it('should return dashboard with all required fields', () => {
      const dashboard = memoryManager.getDashboard();

      expect(dashboard).toHaveProperty('topAccessed');
      expect(dashboard).toHaveProperty('countsByType');
      expect(dashboard).toHaveProperty('recentAdditions');
      expect(dashboard).toHaveProperty('nearDecayThreshold');
      expect(dashboard).toHaveProperty('orphanedEntities');
      expect(dashboard).toHaveProperty('graphStats');
      expect(dashboard).toHaveProperty('stats');
      expect(dashboard).toHaveProperty('generatedAt');
    });

    it('should return empty arrays for fresh database', () => {
      const dashboard = memoryManager.getDashboard();

      expect(dashboard.topAccessed).toEqual([]);
      expect(dashboard.recentAdditions).toEqual([]);
      expect(dashboard.nearDecayThreshold).toEqual([]);
      expect(dashboard.orphanedEntities).toEqual([]);
    });

    it('should return zero graph stats for empty database', () => {
      const dashboard = memoryManager.getDashboard();

      expect(dashboard.graphStats.totalNodes).toBe(0);
      expect(dashboard.graphStats.totalEdges).toBe(0);
      expect(dashboard.graphStats.averageDegree).toBe(0);
      expect(dashboard.graphStats.density).toBe(0);
    });
  });

  describe('Recent Additions', () => {
    it('should show working memory items in recent additions', () => {
      memoryManager.working.set({
        key: 'test-key',
        value: 'test-value',
        type: 'context',
      });

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.recentAdditions.length).toBe(1);
      expect(dashboard.recentAdditions[0].type).toBe('working');
      expect(dashboard.recentAdditions[0].name).toBe('test-key');
    });

    it('should show episodic memories in recent additions', () => {
      memoryManager.episodic.record({
        type: 'success',
        summary: 'Test episode',
        details: 'Test details',
        importance: 5,
      });

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.recentAdditions.some(r =>
        r.type === 'episodic' && r.name === 'Test episode'
      )).toBe(true);
    });

    it('should show semantic entities in recent additions', () => {
      memoryManager.semantic.create({
        name: 'test-entity',
        type: 'fact',
        description: 'Test entity',
      });

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.recentAdditions.some(r =>
        r.type === 'semantic' && r.name === 'test-entity'
      )).toBe(true);
    });

    it('should sort by creation time (most recent first)', async () => {
      memoryManager.semantic.create({
        name: 'entity-1',
        type: 'fact',
        description: 'First entity',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      memoryManager.episodic.record({
        type: 'success',
        summary: 'Episode 1',
        details: 'First episode',
        importance: 5,
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      memoryManager.working.set({
        key: 'working-1',
        value: 'Most recent',
        type: 'context',
      });

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.recentAdditions[0].name).toBe('working-1');
      expect(dashboard.recentAdditions[1].name).toBe('Episode 1');
      expect(dashboard.recentAdditions[2].name).toBe('entity-1');
    });

    it('should limit to 5 recent additions', () => {
      for (let i = 0; i < 10; i++) {
        memoryManager.episodic.record({
          type: 'success',
          summary: `Episode ${i}`,
          details: `Details ${i}`,
          importance: 5,
        });
      }

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.recentAdditions.length).toBe(5);
    });
  });

  describe('Top Accessed Memories', () => {
    it('should track accessed episodes', () => {
      const episode = memoryManager.episodic.record({
        type: 'success',
        summary: 'Frequently accessed',
        details: 'This will be accessed multiple times',
        importance: 5,
      });

      // Access the episode multiple times
      memoryManager.episodic.get(episode.id);
      memoryManager.episodic.get(episode.id);
      memoryManager.episodic.get(episode.id);

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.topAccessed.length).toBe(1);
      expect(dashboard.topAccessed[0].accessCount).toBe(3);
      expect(dashboard.topAccessed[0].name).toBe('Frequently accessed');
    });

    it('should sort by access count (most accessed first)', () => {
      const episode1 = memoryManager.episodic.record({
        type: 'success',
        summary: 'Less accessed',
        details: 'Details',
        importance: 5,
      });

      const episode2 = memoryManager.episodic.record({
        type: 'success',
        summary: 'More accessed',
        details: 'Details',
        importance: 5,
      });

      // Access episode1 twice
      memoryManager.episodic.get(episode1.id);
      memoryManager.episodic.get(episode1.id);

      // Access episode2 five times
      for (let i = 0; i < 5; i++) {
        memoryManager.episodic.get(episode2.id);
      }

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.topAccessed[0].name).toBe('More accessed');
      expect(dashboard.topAccessed[0].accessCount).toBe(5);
      expect(dashboard.topAccessed[1].name).toBe('Less accessed');
      expect(dashboard.topAccessed[1].accessCount).toBe(2);
    });

    it('should limit to 5 top accessed', () => {
      for (let i = 0; i < 10; i++) {
        const episode = memoryManager.episodic.record({
          type: 'success',
          summary: `Episode ${i}`,
          details: 'Details',
          importance: 5,
        });
        // Access each one
        memoryManager.episodic.get(episode.id);
      }

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.topAccessed.length).toBe(5);
    });
  });

  describe('Near Decay Threshold', () => {
    it('should list episodes with importance < 3', () => {
      memoryManager.episodic.record({
        type: 'success',
        summary: 'High importance',
        details: 'Details',
        importance: 8,
      });

      memoryManager.episodic.record({
        type: 'success',
        summary: 'Low importance',
        details: 'Details',
        importance: 2,
      });

      memoryManager.episodic.record({
        type: 'success',
        summary: 'Very low importance',
        details: 'Details',
        importance: 1,
      });

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.nearDecayThreshold.length).toBe(2);
      expect(dashboard.nearDecayThreshold.every(e => e.importance < 3)).toBe(true);
    });

    it('should sort by importance (lowest first)', () => {
      memoryManager.episodic.record({
        type: 'success',
        summary: 'Importance 2',
        details: 'Details',
        importance: 2,
      });

      memoryManager.episodic.record({
        type: 'success',
        summary: 'Importance 1',
        details: 'Details',
        importance: 1,
      });

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.nearDecayThreshold[0].importance).toBe(1);
      expect(dashboard.nearDecayThreshold[1].importance).toBe(2);
    });

    it('should limit to 10 near decay items', () => {
      for (let i = 0; i < 15; i++) {
        memoryManager.episodic.record({
          type: 'success',
          summary: `Low importance ${i}`,
          details: 'Details',
          importance: 1,
        });
      }

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.nearDecayThreshold.length).toBe(10);
    });
  });

  describe('Orphaned Entities', () => {
    it('should list entities without relations', () => {
      memoryManager.semantic.create({
        name: 'orphan-entity',
        type: 'fact',
        description: 'Entity without relations',
      });

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.orphanedEntities.length).toBe(1);
      expect(dashboard.orphanedEntities[0].name).toBe('orphan-entity');
    });

    it('should not list connected entities', () => {
      const entity1 = memoryManager.semantic.create({
        name: 'connected-1',
        type: 'fact',
        description: 'Connected entity 1',
      });

      const entity2 = memoryManager.semantic.create({
        name: 'connected-2',
        type: 'fact',
        description: 'Connected entity 2',
      });

      memoryManager.semantic.create({
        name: 'orphan',
        type: 'fact',
        description: 'Orphan entity',
      });

      // Create relation between entity1 and entity2
      memoryManager.semantic.relate(entity1!.id, entity2!.id, 'related_to');

      const dashboard = memoryManager.getDashboard();

      // Only the orphan should be listed
      expect(dashboard.orphanedEntities.length).toBe(1);
      expect(dashboard.orphanedEntities[0].name).toBe('orphan');
    });

    it('should limit to 10 orphaned entities', () => {
      for (let i = 0; i < 15; i++) {
        memoryManager.semantic.create({
          name: `orphan-${i}`,
          type: 'fact',
          description: `Orphan entity ${i}`,
        });
      }

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.orphanedEntities.length).toBe(10);
    });
  });

  describe('Graph Statistics', () => {
    it('should calculate correct node count', () => {
      memoryManager.semantic.create({
        name: 'entity-1',
        type: 'fact',
        description: 'Entity 1',
      });

      memoryManager.semantic.create({
        name: 'entity-2',
        type: 'fact',
        description: 'Entity 2',
      });

      memoryManager.semantic.create({
        name: 'entity-3',
        type: 'fact',
        description: 'Entity 3',
      });

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.graphStats.totalNodes).toBe(3);
    });

    it('should calculate correct edge count', () => {
      const entity1 = memoryManager.semantic.create({
        name: 'entity-1',
        type: 'fact',
        description: 'Entity 1',
      });

      const entity2 = memoryManager.semantic.create({
        name: 'entity-2',
        type: 'fact',
        description: 'Entity 2',
      });

      const entity3 = memoryManager.semantic.create({
        name: 'entity-3',
        type: 'fact',
        description: 'Entity 3',
      });

      memoryManager.semantic.relate(entity1!.id, entity2!.id, 'related_to');
      memoryManager.semantic.relate(entity2!.id, entity3!.id, 'related_to');

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.graphStats.totalEdges).toBe(2);
    });

    it('should calculate average degree', () => {
      const entity1 = memoryManager.semantic.create({
        name: 'entity-1',
        type: 'fact',
        description: 'Entity 1',
      });

      const entity2 = memoryManager.semantic.create({
        name: 'entity-2',
        type: 'fact',
        description: 'Entity 2',
      });

      const entity3 = memoryManager.semantic.create({
        name: 'entity-3',
        type: 'fact',
        description: 'Entity 3',
      });

      // Create 2 edges: 1-2, 2-3
      memoryManager.semantic.relate(entity1!.id, entity2!.id, 'related_to');
      memoryManager.semantic.relate(entity2!.id, entity3!.id, 'related_to');

      const dashboard = memoryManager.getDashboard();

      // Average degree = 2 * edges / nodes = 2 * 2 / 3 = 1.33
      expect(dashboard.graphStats.averageDegree).toBeCloseTo(1.33, 1);
    });

    it('should calculate density correctly', () => {
      const entity1 = memoryManager.semantic.create({
        name: 'entity-1',
        type: 'fact',
        description: 'Entity 1',
      });

      const entity2 = memoryManager.semantic.create({
        name: 'entity-2',
        type: 'fact',
        description: 'Entity 2',
      });

      const entity3 = memoryManager.semantic.create({
        name: 'entity-3',
        type: 'fact',
        description: 'Entity 3',
      });

      // Max edges for 3 nodes = 3 * 2 / 2 = 3
      // With 2 edges, density = 2/3 = 0.667
      memoryManager.semantic.relate(entity1!.id, entity2!.id, 'related_to');
      memoryManager.semantic.relate(entity2!.id, entity3!.id, 'related_to');

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.graphStats.density).toBeCloseTo(0.667, 2);
    });
  });

  describe('Counts by Type', () => {
    it('should show episodic counts by type', () => {
      memoryManager.episodic.record({
        type: 'success',
        summary: 'Success 1',
        details: 'Details',
        importance: 5,
      });

      memoryManager.episodic.record({
        type: 'success',
        summary: 'Success 2',
        details: 'Details',
        importance: 5,
      });

      memoryManager.episodic.record({
        type: 'error',
        summary: 'Error 1',
        details: 'Details',
        importance: 5,
      });

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.countsByType.episodic.success).toBe(2);
      expect(dashboard.countsByType.episodic.error).toBe(1);
    });

    it('should show semantic counts by type', () => {
      memoryManager.semantic.create({
        name: 'fact-1',
        type: 'fact',
        description: 'Fact 1',
      });

      memoryManager.semantic.create({
        name: 'fact-2',
        type: 'fact',
        description: 'Fact 2',
      });

      memoryManager.semantic.create({
        name: 'preference-1',
        type: 'preference',
        description: 'Preference 1',
      });

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.countsByType.semantic.fact).toBe(2);
      expect(dashboard.countsByType.semantic.preference).toBe(1);
    });
  });

  describe('Stats Integration', () => {
    it('should include full stats in dashboard', () => {
      memoryManager.working.set({
        key: 'test',
        value: 'test',
        type: 'context',
      });

      memoryManager.episodic.record({
        type: 'success',
        summary: 'Test',
        details: 'Test',
        importance: 5,
      });

      memoryManager.semantic.create({
        name: 'test',
        type: 'fact',
        description: 'Test',
      });

      const dashboard = memoryManager.getDashboard();

      expect(dashboard.stats.working.total).toBe(1);
      expect(dashboard.stats.episodic.total).toBe(1);
      expect(dashboard.stats.semantic.entities).toBe(1);
    });
  });

  describe('Timestamp', () => {
    it('should include generation timestamp', () => {
      const before = Date.now();
      const dashboard = memoryManager.getDashboard();
      const after = Date.now();

      expect(dashboard.generatedAt).toBeGreaterThanOrEqual(before);
      expect(dashboard.generatedAt).toBeLessThanOrEqual(after);
    });
  });
});
