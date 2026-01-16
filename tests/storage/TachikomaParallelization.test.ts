/**
 * Tachikoma Parallelization Tests
 * タチコマ並列化機能のユニットテスト
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/SqliteStorage.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

describe('Tachikoma Parallelization', () => {
  let storage: SqliteStorage;
  const testDataPath = join(process.cwd(), '.test-tachikoma');

  beforeEach(async () => {
    if (existsSync(testDataPath)) {
      rmSync(testDataPath, { recursive: true });
    }
    mkdirSync(testDataPath, { recursive: true });
    storage = new SqliteStorage({ dataPath: testDataPath });
    await storage.initialize();
  });

  afterEach(() => {
    storage.close();
    if (existsSync(testDataPath)) {
      rmSync(testDataPath, { recursive: true });
    }
  });

  describe('initTachikoma', () => {
    it('should initialize with custom ID and name', () => {
      const profile = storage.initTachikoma('my-tachi', 'My Tachikoma');

      expect(profile.id).toBe('my-tachi');
      expect(profile.name).toBe('My Tachikoma');
      expect(profile.syncSeq).toBe(0);
      expect(profile.syncVector).toEqual({ 'my-tachi': 0 });
    });

    it('should auto-generate ID if not provided', () => {
      const profile = storage.initTachikoma();

      expect(profile.id).toMatch(/^tachi_\d+_\w+$/);
      expect(profile.syncSeq).toBe(0);
    });

    it('should return existing profile if same name is used', () => {
      const profile1 = storage.initTachikoma('test-id', 'Test');
      const profile2 = storage.initTachikoma('different-id', 'Test'); // Same name

      // Should return the existing one with the same name
      expect(profile2.id).toBe('test-id');
      expect(profile2.name).toBe('Test');
    });

    it('should create different profiles for different names', () => {
      const profile1 = storage.initTachikoma('test-id', 'Alpha');
      const profile2 = storage.initTachikoma('different-id', 'Beta');

      // Should create separate profiles
      expect(profile1.id).toBe('test-id');
      expect(profile1.name).toBe('Alpha');
      expect(profile2.id).toBe('different-id');
      expect(profile2.name).toBe('Beta');
    });
  });

  describe('getTachikomaProfile', () => {
    it('should return null if not initialized', () => {
      const profile = storage.getTachikomaProfile();
      expect(profile).toBeNull();
    });

    it('should return profile after initialization', () => {
      storage.initTachikoma('test-tachi', 'Test');
      const profile = storage.getTachikomaProfile();

      expect(profile).not.toBeNull();
      expect(profile?.id).toBe('test-tachi');
    });
  });

  describe('exportDelta', () => {
    it('should throw if not initialized', () => {
      expect(() => storage.exportDelta()).toThrow('Tachikoma not initialized');
    });

    it('should export with correct format', () => {
      storage.initTachikoma('exporter', 'Exporter');
      const exported = storage.exportDelta();

      expect(exported.version).toBe('1.0.0');
      expect(exported.format).toBe('tachikoma-parallelize-delta');
      expect(exported.tachikomaId).toBe('exporter');
      expect(exported.tachikomaName).toBe('Exporter');
      expect(exported.delta).toBeDefined();
      expect(exported.deleted).toBeDefined();
    });

    it('should increment syncSeq on export', () => {
      storage.initTachikoma('test', 'Test');

      const export1 = storage.exportDelta();
      expect(export1.syncVector['test']).toBe(1);

      const export2 = storage.exportDelta();
      expect(export2.syncVector['test']).toBe(2);
    });

    it('should export only items since timestamp', async () => {
      storage.initTachikoma('test', 'Test');

      // Create some semantic entities
      storage.createSemanticEntity({
        name: 'old-entity',
        type: 'fact',
        description: 'Old entity',
      });

      const timestamp = Date.now();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      storage.createSemanticEntity({
        name: 'new-entity',
        type: 'fact',
        description: 'New entity',
      });

      const exported = storage.exportDelta(timestamp);

      // Should only include the new entity
      expect(exported.delta.semantic.entities.length).toBe(1);
      expect(exported.delta.semantic.entities[0].name).toBe('new-entity');
    });
  });

  describe('importDelta', () => {
    it('should throw if not initialized', () => {
      const dummyExport = {
        version: '1.0.0',
        format: 'tachikoma-parallelize-delta' as const,
        tachikomaId: 'other',
        exportedAt: Date.now(),
        syncVector: { 'other': 1 },
        delta: {
          working: [],
          episodic: [],
          semantic: { entities: [], relations: [] },
        },
        deleted: {
          working: [],
          episodic: [],
          semantic: { entities: [], relations: [] },
        },
      };

      expect(() => storage.importDelta(dummyExport)).toThrow('Tachikoma not initialized');
    });

    it('should import and merge successfully', async () => {
      // Setup storage A
      storage.initTachikoma('tachi-a', 'Tachikoma A');

      // Create entity in A
      storage.createSemanticEntity({
        name: 'entity-a',
        type: 'fact',
        description: 'From A',
      });

      const exportFromA = storage.exportDelta();

      // Setup storage B
      const storageB_Path = join(process.cwd(), '.test-tachikoma-b');
      if (existsSync(storageB_Path)) {
        rmSync(storageB_Path, { recursive: true });
      }
      mkdirSync(storageB_Path, { recursive: true });
      const storageB = new SqliteStorage({ dataPath: storageB_Path });
      await storageB.initialize();
      storageB.initTachikoma('tachi-b', 'Tachikoma B');

      // Import to B
      const result = storageB.importDelta(exportFromA);

      expect(result.success).toBe(true);
      expect(result.merged.semantic.entities).toBe(1);
      expect(result.syncVector['tachi-a']).toBe(1);

      // Cleanup B
      storageB.close();
      rmSync(storageB_Path, { recursive: true });
    });

    it('should handle conflicts with merge_learnings strategy', async () => {
      // This tests episodic memory conflict resolution
      storage.initTachikoma('tachi-a', 'Tachikoma A');

      // Add an episode
      const episodeId = storage.addEpisode({
        type: 'success',
        summary: 'Test episode',
        details: 'Details',
        context: { sessionId: 'test' },
        importance: 5,
        tags: [],
      });

      // Update with some learnings
      storage.updateEpisode(episodeId, {
        outcome: {
          status: 'success',
          learnings: ['Learning A'],
        },
      });

      const exportData = storage.exportDelta();

      // Modify the export to simulate different learnings
      if (exportData.delta.episodic.length > 0) {
        exportData.delta.episodic[0].outcome = {
          status: 'success',
          learnings: ['Learning B'],
        };
      }

      // Import back with merge_learnings
      const result = storage.importDelta(exportData, {
        strategy: 'merge_learnings',
        autoResolve: true,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('sync history', () => {
    it('should record sync history on import', async () => {
      storage.initTachikoma('tachi-a', 'Tachikoma A');

      const dummyExport = {
        version: '1.0.0',
        format: 'tachikoma-parallelize-delta' as const,
        tachikomaId: 'tachi-remote',
        tachikomaName: 'Remote Tachikoma',
        exportedAt: Date.now(),
        syncVector: { 'tachi-remote': 1 },
        delta: {
          working: [],
          episodic: [],
          semantic: { entities: [], relations: [] },
        },
        deleted: {
          working: [],
          episodic: [],
          semantic: { entities: [], relations: [] },
        },
      };

      storage.importDelta(dummyExport);

      const history = storage.listSyncHistory(10);
      expect(history.length).toBe(1);
      expect(history[0].remoteTachikomaId).toBe('tachi-remote');
      expect(history[0].syncType).toBe('import');
    });
  });

  describe('conflicts', () => {
    it('should create conflict when manual resolution required', async () => {
      storage.initTachikoma('tachi-a', 'Tachikoma A');

      // Create an entity
      storage.createSemanticEntity({
        name: 'shared-entity',
        type: 'fact',
        description: 'Original',
        observations: ['obs1'],
      });

      // Create export with same entity but different content
      const exportData = {
        version: '1.0.0',
        format: 'tachikoma-parallelize-delta' as const,
        tachikomaId: 'tachi-remote',
        exportedAt: Date.now(),
        syncVector: { 'tachi-remote': 1 },
        delta: {
          working: [],
          episodic: [],
          semantic: {
            entities: [{
              id: 'different-id',
              name: 'shared-entity',
              type: 'fact' as const,
              description: 'Modified',
              content: null,
              observations: ['obs2'],
              confidence: 0.9,
              source: 'user' as const,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              version: 1,
              tags: [],
            }],
            relations: [],
          },
        },
        deleted: {
          working: [],
          episodic: [],
          semantic: { entities: [], relations: [] },
        },
      };

      // Import with manual strategy
      const result = storage.importDelta(exportData, {
        strategy: 'manual',
        autoResolve: false,
      });

      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].memoryType).toBe('semantic');

      // Check that conflict is in the list
      const conflicts = storage.listConflicts(true);
      expect(conflicts.length).toBe(1);
    });

    it('should resolve conflict', () => {
      storage.initTachikoma('test', 'Test');

      // Add a conflict manually
      const conflict = storage.addConflict({
        memoryType: 'semantic',
        localItem: { id: 'local' },
        remoteItem: { id: 'remote' },
        strategy: 'manual',
      });

      expect(conflict.resolvedAt).toBeUndefined();

      storage.resolveConflict(conflict.id, 'local');

      const resolved = storage.listConflicts(false);
      const found = resolved.find(c => c.id === conflict.id);
      expect(found?.resolution).toBe('local');
      expect(found?.resolvedAt).toBeDefined();
    });
  });
});
