/**
 * AgentCoordinator Tests
 *
 * Tests for multi-agent coordination and directory sync functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { SqliteStorage } from '../../src/storage/SqliteStorage.js';
import { AgentCoordinator, type AgentStorage } from '../../src/agents/AgentCoordinator.js';
import type { AgentRole, AgentProfile, ParallelizationExport } from '../../src/memory/types.js';

// Test adapter implementing AgentStorage
class TestAgentStorage implements AgentStorage {
  constructor(
    private manager: MemoryManager,
    private storage: SqliteStorage
  ) {}

  async registerAgent(profile: Omit<AgentProfile, 'id' | 'createdAt' | 'lastActiveAt'>): Promise<string> {
    const agent = this.storage.createAgent(profile);
    return agent.id;
  }

  async getAgent(id: string): Promise<AgentProfile | null> {
    return this.storage.getAgent(id);
  }

  async listAgents(filter?: { role?: AgentRole }): Promise<AgentProfile[]> {
    return this.storage.listAgents(filter);
  }

  async updateAgentActivity(id: string): Promise<void> {
    this.storage.updateAgentActivity(id);
  }

  async tachikomaInit(config: { name?: string }): Promise<{ id: string; name: string }> {
    const result = this.storage.initTachikoma(undefined, config.name);
    return { id: result.id, name: result.name ?? result.id };
  }

  async tachikomaExport(config: { outputPath?: string; sinceTimestamp?: number }): Promise<unknown> {
    return this.storage.exportDelta(config.sinceTimestamp);
  }

  async tachikomaImport(config: { data: unknown; strategy?: string; autoResolve?: boolean }): Promise<{
    merged: { working: number; episodic: number };
    conflicts: number;
  }> {
    const result = this.storage.importDelta(
      config.data as ParallelizationExport,
      {
        strategy: config.strategy as any,
        autoResolve: config.autoResolve,
      }
    );
    return {
      merged: {
        working: result.merged.working,
        episodic: result.merged.episodic,
      },
      conflicts: result.conflicts.length,
    };
  }

  async tachikomaStatus(): Promise<{
    id: string;
    name?: string;
    syncSeq: number;
    lastSyncAt?: number;
  }> {
    const profile = this.storage.getTachikomaProfile();
    if (!profile) throw new Error('Tachikoma not initialized');
    return {
      id: profile.id,
      name: profile.name,
      syncSeq: profile.syncSeq,
      lastSyncAt: profile.lastSyncAt,
    };
  }

  async setWorkingMemory(key: string, value: unknown, type: string): Promise<void> {
    this.manager.working.set({
      key,
      value,
      type: type as 'task_state' | 'decision' | 'context' | 'scratch',
      priority: 'medium',
      tags: [],
    });
  }

  async getWorkingMemory(key: string): Promise<unknown | null> {
    const item = this.manager.working.get(key);
    return item?.value ?? null;
  }

  async listWorkingMemory(filter?: { type?: string; tags?: string[] }): Promise<Array<{ key: string; value: unknown }>> {
    const items = this.manager.working.list({
      type: filter?.type as any,
      tags: filter?.tags,
    });
    return items.map(item => ({ key: item.key, value: item.value }));
  }

  async recordEpisode(episode: {
    type: string;
    summary: string;
    details: string;
    context?: Record<string, unknown>;
    outcome?: { status: string; learnings: string[] };
    importance?: number;
    tags?: string[];
  }): Promise<string> {
    return this.manager.episodic.record({
      type: episode.type as any,
      summary: episode.summary,
      details: episode.details,
      context: episode.context as any,
      outcome: episode.outcome as any,
      importance: episode.importance,
      tags: episode.tags,
    });
  }
}

describe('AgentCoordinator', () => {
  let memoryManager: MemoryManager;
  let sqliteStorage: SqliteStorage;
  let storage: TestAgentStorage;
  let coordinator: AgentCoordinator;
  let testDataPath: string;
  let syncDir: string;

  beforeEach(async () => {
    testDataPath = join(tmpdir(), 'cc-memory-coordinator-test-' + Date.now());
    syncDir = join(testDataPath, 'sync');
    mkdirSync(syncDir, { recursive: true });

    memoryManager = new MemoryManager({
      dataPath: testDataPath,
      sessionId: 'test-session-001',
    });
    await memoryManager.ready();

    sqliteStorage = (memoryManager as any).storage;
    storage = new TestAgentStorage(memoryManager, sqliteStorage);
    coordinator = new AgentCoordinator(storage, { syncDir, autoSync: false });
  });

  afterEach(() => {
    memoryManager.close();
    if (existsSync(testDataPath)) {
      rmSync(testDataPath, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    it('should initialize coordinator', async () => {
      await coordinator.initialize('test-coordinator');

      const status = await coordinator.getStatus();
      expect(status.tachikomaName).toBe('test-coordinator');
      expect(status.agentCount).toBe(0);
    });
  });

  describe('agent management', () => {
    beforeEach(async () => {
      await coordinator.initialize('agent-test');
    });

    it('should register an agent', async () => {
      const agent = await coordinator.registerAgent(
        'test-agent',
        'backend',
        [{ name: 'code_review', description: 'Review code', available: true }]
      );

      expect(agent.id).toBeDefined();
      expect(agent.name).toBe('test-agent');
      expect(agent.role).toBe('backend');
    });

    it('should find agent by role', async () => {
      await coordinator.registerAgent('be-agent', 'backend', []);
      await coordinator.registerAgent('fe-agent', 'frontend', []);

      const backend = coordinator.findAgentForRole('backend');
      expect(backend?.name).toBe('be-agent');

      const frontend = coordinator.findAgentForRole('frontend');
      expect(frontend?.name).toBe('fe-agent');
    });

    it('should find agent by capability', async () => {
      await coordinator.registerAgent(
        'reviewer',
        'backend',
        [{ name: 'code_review', description: 'Review code', available: true }]
      );

      const agent = coordinator.findAgentForCapability('code_review');
      expect(agent?.name).toBe('reviewer');
    });
  });

  describe('syncFromDirectory', () => {
    beforeEach(async () => {
      await coordinator.initialize('sync-test');
    });

    it('should return empty result for non-existent directory', async () => {
      const nonExistentDir = join(testDataPath, 'does-not-exist');

      const result = await coordinator.syncFromDirectory(nonExistentDir);

      expect(result.filesProcessed).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it('should return empty result for empty directory', async () => {
      const result = await coordinator.syncFromDirectory(syncDir);

      expect(result.filesProcessed).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it('should skip invalid format files', async () => {
      // Create invalid JSON file
      writeFileSync(join(syncDir, 'invalid.json'), JSON.stringify({ invalid: true }));

      const result = await coordinator.syncFromDirectory(syncDir);

      expect(result.filesProcessed).toBe(0);
      expect(result.errors.some(e => e.includes('invalid format'))).toBe(true);
    });

    it('should skip self-exports', async () => {
      const status = await coordinator.getStatus();
      const tachikomaId = status.tachikomaId;

      // Create export from self
      const selfExport: ParallelizationExport = {
        version: '1.0.0',
        format: 'tachikoma-parallelize-delta',
        tachikomaId: tachikomaId!,
        tachikomaName: 'sync-test',
        exportedAt: Date.now(),
        syncVector: {},
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
      writeFileSync(join(syncDir, 'self_export.json'), JSON.stringify(selfExport));

      const result = await coordinator.syncFromDirectory(syncDir);

      expect(result.filesProcessed).toBe(0);

      // File should be renamed to .imported.json
      const files = readdirSync(syncDir);
      expect(files.some(f => f.endsWith('.imported.json'))).toBe(true);
    });

    it('should import valid delta files', async () => {
      // Create valid export from another Tachikoma
      const otherExport: ParallelizationExport = {
        version: '1.0.0',
        format: 'tachikoma-parallelize-delta',
        tachikomaId: 'other-tachikoma-id',
        tachikomaName: 'other-tachikoma',
        exportedAt: Date.now(),
        syncVector: { 'other-tachikoma-id': 1 },
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
      writeFileSync(join(syncDir, 'other_export.json'), JSON.stringify(otherExport));

      const result = await coordinator.syncFromDirectory(syncDir);

      expect(result.filesProcessed).toBe(1);

      // File should be renamed to .imported.json
      const files = readdirSync(syncDir);
      expect(files.some(f => f === 'other_export.imported.json')).toBe(true);
    });

    it('should use configured sync directory when not specified', async () => {
      // Create export file in configured sync dir
      const otherExport: ParallelizationExport = {
        version: '1.0.0',
        format: 'tachikoma-parallelize-delta',
        tachikomaId: 'another-tachikoma',
        tachikomaName: 'another',
        exportedAt: Date.now(),
        syncVector: {},
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
      writeFileSync(join(syncDir, 'test_export.json'), JSON.stringify(otherExport));

      // Call without directory argument - should use configured syncDir
      const result = await coordinator.syncFromDirectory();

      expect(result.filesProcessed).toBe(1);
    });

    it('should throw error if no sync directory configured', async () => {
      const coordWithoutSync = new AgentCoordinator(storage);
      await coordWithoutSync.initialize('no-sync');

      await expect(coordWithoutSync.syncFromDirectory()).rejects.toThrow('No sync directory configured');
    });
  });

  describe('task management', () => {
    beforeEach(async () => {
      await coordinator.initialize('task-test');
    });

    it('should create a task', async () => {
      const task = await coordinator.createTask('Test task', 'A test task description');

      expect(task.id).toBeDefined();
      expect(task.summary).toBe('Test task');
      expect(task.status).toBe('submitted');
    });

    it('should delegate task to agent', async () => {
      const agent = await coordinator.registerAgent('worker', 'backend', []);
      const task = await coordinator.createTask('Work task');

      const result = await coordinator.delegateTask(task.id, agent.id);

      expect(result.success).toBe(true);
      expect(result.assignedTo).toBe(agent.id);
    });
  });
});
