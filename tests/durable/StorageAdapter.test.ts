/**
 * StorageAdapter Tests
 *
 * Tests for the unified storage adapter that implements both
 * WorkflowStorage and AgentStorage interfaces.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { SqliteStorage } from '../../src/storage/SqliteStorage.js';
import { StorageAdapter } from '../../src/durable/adapters/StorageAdapter.js';

describe('StorageAdapter', () => {
  let memoryManager: MemoryManager;
  let sqliteStorage: SqliteStorage;
  let adapter: StorageAdapter;
  let testDataPath: string;

  beforeEach(async () => {
    testDataPath = join(tmpdir(), 'cc-memory-storage-adapter-test-' + Date.now());

    // Initialize MemoryManager
    memoryManager = new MemoryManager({
      dataPath: testDataPath,
      sessionId: 'test-session-001',
    });
    await memoryManager.ready();

    // Get SqliteStorage from MemoryManager internals
    // Note: In production, you might expose this differently
    sqliteStorage = (memoryManager as any).storage;

    // Initialize adapter
    adapter = new StorageAdapter(memoryManager, sqliteStorage);
  });

  afterEach(() => {
    memoryManager.close();
    if (existsSync(testDataPath)) {
      rmSync(testDataPath, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // WorkflowStorage Interface Tests
  // ============================================================================

  describe('WorkflowStorage interface', () => {
    describe('setWorkingMemory / getWorkingMemory', () => {
      it('should store and retrieve a value', async () => {
        await adapter.setWorkingMemory('test-key', { foo: 'bar' }, 'task_state');
        const result = await adapter.getWorkingMemory('test-key');

        expect(result).toEqual({ foo: 'bar' });
      });

      it('should return null for non-existent key', async () => {
        const result = await adapter.getWorkingMemory('non-existent');
        expect(result).toBeNull();
      });

      it('should overwrite existing value', async () => {
        await adapter.setWorkingMemory('key1', { v: 1 }, 'task_state');
        await adapter.setWorkingMemory('key1', { v: 2 }, 'task_state');

        const result = await adapter.getWorkingMemory('key1');
        expect(result).toEqual({ v: 2 });
      });
    });

    describe('deleteWorkingMemory', () => {
      it('should delete a value', async () => {
        await adapter.setWorkingMemory('to-delete', 'value', 'task_state');
        await adapter.deleteWorkingMemory('to-delete');

        const result = await adapter.getWorkingMemory('to-delete');
        expect(result).toBeNull();
      });
    });

    describe('listWorkingMemory', () => {
      it('should list all items', async () => {
        await adapter.setWorkingMemory('key1', 'v1', 'task_state');
        await adapter.setWorkingMemory('key2', 'v2', 'task_state');

        const items = await adapter.listWorkingMemory();
        expect(items.length).toBeGreaterThanOrEqual(2);
      });

      it('should filter by type', async () => {
        await adapter.setWorkingMemory('task-key', 'v1', 'task_state');
        await adapter.setWorkingMemory('decision-key', 'v2', 'decision');

        const taskItems = await adapter.listWorkingMemory({ type: 'task_state' });
        const hasTaskKey = taskItems.some(i => i.key === 'task-key');
        expect(hasTaskKey).toBe(true);
      });
    });

    describe('recordEpisode / searchEpisodes', () => {
      it('should record and search episodes', async () => {
        const id = await adapter.recordEpisode({
          type: 'milestone',
          summary: 'Test milestone',
          details: 'Test details',
          importance: 5,
          tags: ['test', 'unit'],
        });

        expect(id).toBeDefined();

        const episodes = await adapter.searchEpisodes({
          tags: ['test'],
          limit: 10,
        });

        expect(episodes.length).toBeGreaterThan(0);
        expect(episodes[0].summary).toBe('Test milestone');
      });

      it('should record episode with outcome', async () => {
        const id = await adapter.recordEpisode({
          type: 'success',
          summary: 'Task completed',
          details: 'Details here',
          outcome: {
            status: 'success',
            learnings: ['Learning 1', 'Learning 2'],
          },
          tags: ['outcome-test'],
        });

        expect(id).toBeDefined();
      });
    });
  });

  // ============================================================================
  // AgentStorage Interface Tests
  // ============================================================================

  describe('AgentStorage interface', () => {
    describe('registerAgent / getAgent', () => {
      it('should register and retrieve an agent', async () => {
        const id = await adapter.registerAgent({
          name: 'test-agent',
          role: 'backend',
          specializations: ['api', 'database'],
          capabilities: ['code_review'],
          knowledgeDomains: ['typescript'],
        });

        expect(id).toBeDefined();

        const agent = await adapter.getAgent(id);
        expect(agent).toBeDefined();
        expect(agent?.name).toBe('test-agent');
        expect(agent?.role).toBe('backend');
      });

      it('should return null for non-existent agent', async () => {
        const agent = await adapter.getAgent('non-existent-id');
        expect(agent).toBeNull();
      });
    });

    describe('listAgents', () => {
      it('should list all agents', async () => {
        await adapter.registerAgent({
          name: 'agent-1',
          role: 'frontend',
          specializations: [],
          capabilities: [],
          knowledgeDomains: [],
        });
        await adapter.registerAgent({
          name: 'agent-2',
          role: 'backend',
          specializations: [],
          capabilities: [],
          knowledgeDomains: [],
        });

        const agents = await adapter.listAgents();
        expect(agents.length).toBeGreaterThanOrEqual(2);
      });

      it('should filter by role', async () => {
        await adapter.registerAgent({
          name: 'fe-agent',
          role: 'frontend',
          specializations: [],
          capabilities: [],
          knowledgeDomains: [],
        });
        await adapter.registerAgent({
          name: 'be-agent',
          role: 'backend',
          specializations: [],
          capabilities: [],
          knowledgeDomains: [],
        });

        const frontendAgents = await adapter.listAgents({ role: 'frontend' });
        const allFrontend = frontendAgents.every(a => a.role === 'frontend');
        expect(allFrontend).toBe(true);
      });
    });

    describe('updateAgentActivity', () => {
      it('should update agent activity', async () => {
        const id = await adapter.registerAgent({
          name: 'activity-test',
          role: 'general',
          specializations: [],
          capabilities: [],
          knowledgeDomains: [],
        });

        const before = await adapter.getAgent(id);
        const beforeTime = before?.lastActiveAt ?? 0;

        // Wait a bit to ensure time difference
        await new Promise(r => setTimeout(r, 10));

        await adapter.updateAgentActivity(id);

        const after = await adapter.getAgent(id);
        expect(after?.lastActiveAt).toBeGreaterThanOrEqual(beforeTime);
      });
    });

    describe('Tachikoma operations', () => {
      it('should initialize Tachikoma', async () => {
        const result = await adapter.tachikomaInit({ name: 'test-tachikoma' });

        expect(result.id).toBeDefined();
        expect(result.name).toBe('test-tachikoma');
      });

      it('should get Tachikoma status', async () => {
        await adapter.tachikomaInit({ name: 'status-test' });
        const status = await adapter.tachikomaStatus();

        expect(status.id).toBeDefined();
        expect(status.name).toBe('status-test');
        expect(typeof status.syncSeq).toBe('number');
      });

      it('should export and import data', async () => {
        await adapter.tachikomaInit({ name: 'export-test' });

        // Add some data
        await adapter.setWorkingMemory('export-key', 'export-value', 'task_state');

        // Export
        const exported = await adapter.tachikomaExport({});
        expect(exported).toBeDefined();

        // Import (into same instance for test)
        const importResult = await adapter.tachikomaImport({
          data: exported,
          strategy: 'merge_learnings',
          autoResolve: true,
        });

        expect(importResult.merged).toBeDefined();
        expect(typeof importResult.conflicts).toBe('number');
      });
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration', () => {
    it('should work with WorkflowManager', async () => {
      const { WorkflowManager } = await import('../../src/durable/WorkflowManager.js');

      const workflowManager = new WorkflowManager({ storage: adapter });

      const workflow = await workflowManager.createWorkflow({
        name: 'Integration Test Workflow',
        steps: [
          { name: 'step1', agent: 'test-agent' },
        ],
      });

      expect(workflow.id).toBeDefined();
      expect(workflow.name).toBe('Integration Test Workflow');

      // Retrieve workflow
      const retrieved = await workflowManager.getWorkflow(workflow.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(workflow.id);
    });

    it('should work with AgentCoordinator', async () => {
      const { AgentCoordinator } = await import('../../src/agents/AgentCoordinator.js');

      const coordinator = new AgentCoordinator(adapter);
      await coordinator.initialize('integration-test');

      const agent = await coordinator.registerAgent(
        'coord-test-agent',
        'backend',
        [{ name: 'test-capability', description: 'Test', available: true }]
      );

      expect(agent.id).toBeDefined();
      expect(agent.name).toBe('coord-test-agent');

      const status = await coordinator.getStatus();
      expect(status.agentCount).toBeGreaterThanOrEqual(1);
    });
  });
});
