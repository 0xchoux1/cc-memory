/**
 * Durable HTTP Routes Tests
 *
 * Tests for the durable workflow HTTP API endpoints.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express, { type Express } from 'express';
import request from 'supertest';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { WorkflowManager, type WorkflowStorage, type StepExecutor, type ExecutionContext } from '../../src/durable/WorkflowManager.js';
import { AgentCoordinator, type AgentStorage } from '../../src/agents/AgentCoordinator.js';
import { SqliteStorage } from '../../src/storage/SqliteStorage.js';
import { createDurableRouter } from '../../src/server/http/routes/durable.js';
import type { DurableStep, StepExecutionResult, ParallelizationExport, AgentProfile, AgentRole } from '../../src/memory/types.js';

// Combined storage adapter for both Workflow and Agent
class TestStorageAdapter implements WorkflowStorage, AgentStorage {
  constructor(
    private manager: MemoryManager,
    private storage: SqliteStorage
  ) {}

  // WorkflowStorage methods
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

  async deleteWorkingMemory(key: string): Promise<void> {
    this.manager.working.delete(key);
  }

  async listWorkingMemory(filter?: { type?: string }): Promise<Array<{ key: string; value: unknown }>> {
    const items = this.manager.working.list({
      type: filter?.type as 'task_state' | 'decision' | 'context' | 'scratch',
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
    const recorded = this.manager.episodic.record({
      type: episode.type as 'incident' | 'interaction' | 'milestone' | 'error' | 'success',
      summary: episode.summary,
      details: episode.details,
      context: episode.context as any,
      outcome: episode.outcome as any,
      importance: episode.importance,
      tags: episode.tags,
    });
    return recorded.id;
  }

  async searchEpisodes(query: {
    query?: string;
    type?: string;
    tags?: string[];
    limit?: number;
  }): Promise<Array<{ id: string; summary: string; details: string }>> {
    const episodes = this.manager.episodic.search({
      query: query.query,
      type: query.type as any,
      tags: query.tags,
      limit: query.limit,
    });
    return episodes.map(ep => ({
      id: ep.id,
      summary: ep.summary,
      details: ep.details,
    }));
  }

  // AgentStorage methods
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
}

// Simple step executor for testing
class SimpleTestExecutor implements StepExecutor {
  async execute(step: DurableStep, context: ExecutionContext): Promise<StepExecutionResult> {
    return {
      stepId: step.id,
      success: true,
      output: { step: step.name, executed: true },
      durationMs: 10,
      waiting: false,
    };
  }
}

describe('Durable HTTP Routes', () => {
  let memoryManager: MemoryManager;
  let sqliteStorage: SqliteStorage;
  let adapter: TestStorageAdapter;
  let workflowManager: WorkflowManager;
  let agentCoordinator: AgentCoordinator;
  let app: Express;
  let testDataPath: string;

  beforeEach(async () => {
    testDataPath = join(tmpdir(), 'cc-memory-http-test-' + Date.now());

    memoryManager = new MemoryManager({
      dataPath: testDataPath,
      sessionId: 'test-session-001',
    });
    await memoryManager.ready();

    sqliteStorage = (memoryManager as any).storage;
    adapter = new TestStorageAdapter(memoryManager, sqliteStorage);

    const executor = new SimpleTestExecutor();
    workflowManager = new WorkflowManager({ storage: adapter, executor });
    agentCoordinator = new AgentCoordinator(adapter);
    await agentCoordinator.initialize('http-test');

    // Create Express app with routes
    app = express();
    app.use(express.json());
    const router = createDurableRouter({ workflowManager, agentCoordinator });
    app.use('/api/durable', router);
  });

  afterEach(() => {
    memoryManager.close();
    if (existsSync(testDataPath)) {
      rmSync(testDataPath, { recursive: true, force: true });
    }
  });

  describe('POST /api/durable/workflows', () => {
    it('should create a workflow', async () => {
      const response = await request(app)
        .post('/api/durable/workflows')
        .send({
          definition: {
            name: 'Test Workflow',
            steps: [
              { name: 'step1', agent: 'agent1' },
            ],
          },
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.name).toBe('Test Workflow');
      expect(response.body.status).toBe('pending');
      expect(response.body.stepCount).toBe(1);
    });

    it('should return 400 for invalid definition', async () => {
      const response = await request(app)
        .post('/api/durable/workflows')
        .send({ definition: {} })
        .expect(400);

      expect(response.body.error).toBe('bad_request');
    });
  });

  describe('GET /api/durable/workflows', () => {
    it('should list workflows', async () => {
      // Create a workflow first
      await request(app)
        .post('/api/durable/workflows')
        .send({
          definition: {
            name: 'List Test',
            steps: [{ name: 'step1', agent: 'agent1' }],
          },
        });

      const response = await request(app)
        .get('/api/durable/workflows')
        .expect(200);

      expect(response.body.workflows).toBeInstanceOf(Array);
      expect(response.body.count).toBeGreaterThanOrEqual(1);
    });

    it('should filter by status', async () => {
      const response = await request(app)
        .get('/api/durable/workflows?status=completed')
        .expect(200);

      expect(response.body.workflows).toBeInstanceOf(Array);
    });
  });

  describe('GET /api/durable/workflows/:id', () => {
    it('should get workflow details', async () => {
      const createRes = await request(app)
        .post('/api/durable/workflows')
        .send({
          definition: {
            name: 'Get Test',
            steps: [{ name: 'step1', agent: 'agent1' }],
          },
        });

      const response = await request(app)
        .get(`/api/durable/workflows/${createRes.body.id}`)
        .expect(200);

      expect(response.body.id).toBe(createRes.body.id);
      expect(response.body.name).toBe('Get Test');
      expect(response.body.steps).toBeInstanceOf(Array);
    });

    it('should return 404 for non-existent workflow', async () => {
      await request(app)
        .get('/api/durable/workflows/non-existent-id')
        .expect(404);
    });
  });

  describe('POST /api/durable/workflows/:id/execute', () => {
    it('should execute a workflow', async () => {
      const createRes = await request(app)
        .post('/api/durable/workflows')
        .send({
          definition: {
            name: 'Execute Test',
            steps: [{ name: 'step1', agent: 'agent1' }],
          },
        });

      const response = await request(app)
        .post(`/api/durable/workflows/${createRes.body.id}/execute`)
        .send({})
        .expect(200);

      expect(response.body.workflowId).toBe(createRes.body.id);
      expect(response.body.success).toBe(true);
    });

    it('should execute in parallel mode', async () => {
      const createRes = await request(app)
        .post('/api/durable/workflows')
        .send({
          definition: {
            name: 'Parallel Execute Test',
            steps: [
              { name: 'step1', agent: 'agent1' },
              { name: 'step2', agent: 'agent2' },
            ],
          },
        });

      const response = await request(app)
        .post(`/api/durable/workflows/${createRes.body.id}/execute`)
        .send({ parallel: true })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/durable/agents', () => {
    it('should register an agent', async () => {
      const response = await request(app)
        .post('/api/durable/agents')
        .send({
          name: 'test-agent',
          role: 'backend',
          capabilities: [
            { name: 'code_review', description: 'Review code' },
          ],
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.name).toBe('test-agent');
      expect(response.body.role).toBe('backend');
    });

    it('should return 400 for missing required fields', async () => {
      await request(app)
        .post('/api/durable/agents')
        .send({ name: 'test' })
        .expect(400);
    });
  });

  describe('GET /api/durable/agents', () => {
    it('should list agents', async () => {
      await request(app)
        .post('/api/durable/agents')
        .send({ name: 'list-test', role: 'frontend' });

      const response = await request(app)
        .get('/api/durable/agents')
        .expect(200);

      expect(response.body.agents).toBeInstanceOf(Array);
    });

    it('should filter by role', async () => {
      await request(app)
        .post('/api/durable/agents')
        .send({ name: 'backend-agent', role: 'backend' });

      const response = await request(app)
        .get('/api/durable/agents?role=backend')
        .expect(200);

      expect(response.body.agents.every((a: any) => a.role === 'backend')).toBe(true);
    });
  });

  describe('GET /api/durable/agents/:id', () => {
    it('should get agent details', async () => {
      const createRes = await request(app)
        .post('/api/durable/agents')
        .send({ name: 'get-test', role: 'testing' });

      const response = await request(app)
        .get(`/api/durable/agents/${createRes.body.id}`)
        .expect(200);

      expect(response.body.id).toBe(createRes.body.id);
      expect(response.body.name).toBe('get-test');
    });

    it('should return 404 for non-existent agent', async () => {
      await request(app)
        .get('/api/durable/agents/non-existent-id')
        .expect(404);
    });
  });

  describe('POST /api/durable/tasks', () => {
    it('should create a task', async () => {
      const response = await request(app)
        .post('/api/durable/tasks')
        .send({
          summary: 'Test task',
          description: 'A test task description',
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.summary).toBe('Test task');
      expect(response.body.status).toBe('submitted');
    });

    it('should return 400 for missing summary', async () => {
      await request(app)
        .post('/api/durable/tasks')
        .send({ description: 'No summary' })
        .expect(400);
    });
  });

  describe('POST /api/durable/tasks/:id/delegate', () => {
    it('should delegate task to agent', async () => {
      // Create agent
      const agentRes = await request(app)
        .post('/api/durable/agents')
        .send({ name: 'delegate-target', role: 'backend' });

      // Create task
      const taskRes = await request(app)
        .post('/api/durable/tasks')
        .send({ summary: 'Delegated task' });

      // Delegate
      const response = await request(app)
        .post(`/api/durable/tasks/${taskRes.body.id}/delegate`)
        .send({ agentId: agentRes.body.id })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.assignedTo).toBe(agentRes.body.id);
    });

    it('should return 400 for missing agentId', async () => {
      const taskRes = await request(app)
        .post('/api/durable/tasks')
        .send({ summary: 'Task' });

      await request(app)
        .post(`/api/durable/tasks/${taskRes.body.id}/delegate`)
        .send({})
        .expect(400);
    });
  });

  describe('GET /api/durable/status', () => {
    it('should get coordinator status', async () => {
      const response = await request(app)
        .get('/api/durable/status')
        .expect(200);

      expect(response.body.tachikomaName).toBe('http-test');
      expect(response.body.agentCount).toBeDefined();
      expect(response.body.pendingTaskCount).toBeDefined();
    });
  });

  describe('workflow lifecycle', () => {
    it('should handle workflow cancel', async () => {
      const createRes = await request(app)
        .post('/api/durable/workflows')
        .send({
          definition: {
            name: 'Cancel Test',
            steps: [{ name: 'step1', agent: 'agent1' }],
          },
        });

      const response = await request(app)
        .post(`/api/durable/workflows/${createRes.body.id}/cancel`)
        .send({ reason: 'Testing cancellation' })
        .expect(200);

      expect(response.body.status).toBe('cancelled');
    });
  });
});
