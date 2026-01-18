/**
 * Workflow Recovery Tests
 *
 * Tests for recovering workflows from Episodic Memory after
 * Working Memory data is lost (e.g., crash, data corruption).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import {
  WorkflowManager,
  type WorkflowStorage,
  type StepExecutor,
  type ExecutionContext,
} from '../../src/durable/WorkflowManager.js';
import type {
  WorkflowDefinition,
  DurableStep,
  StepExecutionResult,
} from '../../src/durable/types.js';

// Storage adapter using MemoryManager
class TestStorageAdapter implements WorkflowStorage {
  constructor(private manager: MemoryManager) {}

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
    return this.manager.episodic.record({
      type: episode.type as 'incident' | 'interaction' | 'milestone' | 'error' | 'success',
      summary: episode.summary,
      details: episode.details,
      context: episode.context as { projectPath?: string; branch?: string; taskId?: string; files?: string[] },
      outcome: episode.outcome ? {
        status: episode.outcome.status as 'success' | 'failure' | 'partial',
        learnings: episode.outcome.learnings,
      } : undefined,
      importance: episode.importance,
      tags: episode.tags,
    });
  }

  async searchEpisodes(query: {
    query?: string;
    type?: string;
    tags?: string[];
    limit?: number;
  }): Promise<Array<{ id: string; summary: string; details: string }>> {
    const episodes = this.manager.episodic.search({
      query: query.query,
      type: query.type as 'incident' | 'interaction' | 'milestone' | 'error' | 'success',
      tags: query.tags,
      limit: query.limit,
    });
    return episodes.map(ep => ({
      id: ep.id,
      summary: ep.summary,
      details: ep.details,
    }));
  }
}

// Simple step executor for testing
class TestStepExecutor implements StepExecutor {
  async execute(step: DurableStep, context: ExecutionContext): Promise<StepExecutionResult> {
    const startTime = Date.now();

    return {
      stepId: step.id,
      success: true,
      output: { step: step.name, executed: true },
      durationMs: Date.now() - startTime,
      waiting: false,
    };
  }
}

describe('Workflow Recovery', () => {
  let memoryManager: MemoryManager;
  let adapter: TestStorageAdapter;
  let executor: TestStepExecutor;
  let manager: WorkflowManager;
  let testDataPath: string;

  const simpleWorkflow: WorkflowDefinition = {
    name: 'Recovery Test Workflow',
    description: 'A workflow for testing recovery',
    steps: [
      { name: 'step1', agent: 'agent1' },
      { name: 'step2', agent: 'agent2' },
      { name: 'step3', agent: 'agent1' },
    ],
  };

  beforeEach(async () => {
    testDataPath = join(tmpdir(), 'cc-memory-recovery-test-' + Date.now());

    memoryManager = new MemoryManager({
      dataPath: testDataPath,
      sessionId: 'test-session-001',
    });
    await memoryManager.ready();

    adapter = new TestStorageAdapter(memoryManager);
    executor = new TestStepExecutor();
    manager = new WorkflowManager({ storage: adapter, executor });
  });

  afterEach(() => {
    memoryManager.close();
    if (existsSync(testDataPath)) {
      rmSync(testDataPath, { recursive: true, force: true });
    }
  });

  describe('recoverWorkflow', () => {
    it('should return workflow from Working Memory if available', async () => {
      const workflow = await manager.createWorkflow(simpleWorkflow);

      const recovered = await manager.recoverWorkflow(workflow.id);

      expect(recovered).toBeDefined();
      expect(recovered?.id).toBe(workflow.id);
      expect(recovered?.name).toBe(workflow.name);
    });

    it('should return null for non-existent workflow', async () => {
      const recovered = await manager.recoverWorkflow('non-existent-id');
      expect(recovered).toBeNull();
    });

    it('should recover workflow from Episodic Memory when Working Memory is cleared', async () => {
      // Create and execute workflow
      const workflow = await manager.createWorkflow(simpleWorkflow, { testInput: 'value' });
      await manager.executeWorkflow(workflow.id);

      // Clear Working Memory to simulate crash
      await adapter.deleteWorkingMemory(`workflow:${workflow.id}`);
      for (const step of workflow.steps) {
        await adapter.deleteWorkingMemory(`step:${step.id}:status`);
      }

      // Verify Working Memory is empty
      const workflowFromMemory = await manager.getWorkflow(workflow.id);
      expect(workflowFromMemory).toBeNull();

      // Recover from Episodic Memory
      const recovered = await manager.recoverWorkflow(workflow.id);

      expect(recovered).toBeDefined();
      expect(recovered?.id).toBe(workflow.id);
      expect(recovered?.name).toBe(simpleWorkflow.name);
      expect(recovered?.description).toBe(simpleWorkflow.description);
      expect(recovered?.steps.length).toBe(3);
    });

    it('should restore step completion states', async () => {
      // Create and execute workflow
      const workflow = await manager.createWorkflow(simpleWorkflow);
      await manager.executeWorkflow(workflow.id);

      // Clear Working Memory
      await adapter.deleteWorkingMemory(`workflow:${workflow.id}`);
      for (const step of workflow.steps) {
        await adapter.deleteWorkingMemory(`step:${step.id}:status`);
      }

      // Recover
      const recovered = await manager.recoverWorkflow(workflow.id);

      expect(recovered).toBeDefined();
      expect(recovered?.status).toBe('completed');

      // All steps should be completed
      const completedSteps = recovered?.steps.filter(s => s.status === 'completed') ?? [];
      expect(completedSteps.length).toBe(3);
    });

    it('should restore input and metadata', async () => {
      const inputData = { key: 'value', nested: { foo: 'bar' } };
      const metadata = { priority: 'high' as const, tags: ['test'] };

      const workflow = await manager.createWorkflow(simpleWorkflow, inputData, metadata);

      // Clear Working Memory
      await adapter.deleteWorkingMemory(`workflow:${workflow.id}`);
      for (const step of workflow.steps) {
        await adapter.deleteWorkingMemory(`step:${step.id}:status`);
      }

      // Recover
      const recovered = await manager.recoverWorkflow(workflow.id);

      expect(recovered?.input).toEqual(inputData);
      expect(recovered?.metadata?.priority).toBe('high');
      expect(recovered?.metadata?.tags).toContain('test');
    });

    it('should record recovery in Episodic Memory', async () => {
      const workflow = await manager.createWorkflow(simpleWorkflow);

      // Clear Working Memory
      await adapter.deleteWorkingMemory(`workflow:${workflow.id}`);

      // Recover
      await manager.recoverWorkflow(workflow.id);

      // Check for recovery episode
      const episodes = await adapter.searchEpisodes({
        tags: ['workflow', 'recovered'],
        limit: 1,
      });

      expect(episodes.length).toBeGreaterThan(0);
      expect(episodes[0].summary).toContain('recovered');
    });

    it('should persist recovered workflow to Working Memory', async () => {
      const workflow = await manager.createWorkflow(simpleWorkflow);

      // Clear Working Memory
      await adapter.deleteWorkingMemory(`workflow:${workflow.id}`);

      // Recover
      await manager.recoverWorkflow(workflow.id);

      // Should now be in Working Memory
      const fromMemory = await manager.getWorkflow(workflow.id);
      expect(fromMemory).toBeDefined();
      expect(fromMemory?.id).toBe(workflow.id);
    });

    it('should be able to continue execution after recovery', async () => {
      // Create workflow but don't execute
      const workflow = await manager.createWorkflow(simpleWorkflow);

      // Clear Working Memory
      await adapter.deleteWorkingMemory(`workflow:${workflow.id}`);

      // Recover
      const recovered = await manager.recoverWorkflow(workflow.id);
      expect(recovered).toBeDefined();

      // Execute the recovered workflow
      const result = await manager.executeWorkflow(workflow.id);

      expect(result.success).toBe(true);
      expect(result.stepResults.length).toBe(3);
    });

    it('should restore currentStepIndex correctly for partially completed workflow', async () => {
      // Create workflow
      const workflow = await manager.createWorkflow(simpleWorkflow);

      // Manually complete first 2 steps and persist
      workflow.steps[0].status = 'completed';
      workflow.steps[0].output = { result: 'step1 done' };
      workflow.steps[0].completedAt = Date.now();
      workflow.steps[0].startedAt = Date.now() - 100;

      workflow.steps[1].status = 'completed';
      workflow.steps[1].output = { result: 'step2 done' };
      workflow.steps[1].completedAt = Date.now();
      workflow.steps[1].startedAt = Date.now() - 50;

      workflow.currentStepIndex = 2;

      // Persist and record step completions
      await adapter.setWorkingMemory(`workflow:${workflow.id}`, workflow, 'task_state');

      for (let i = 0; i < 2; i++) {
        const step = workflow.steps[i];
        await adapter.recordEpisode({
          type: 'milestone',
          summary: `Step completed: ${step.name}`,
          details: JSON.stringify({
            stepId: step.id,
            workflowId: workflow.id,
            output: step.output,
            durationMs: 100,
            completedAt: step.completedAt,
            startedAt: step.startedAt,
          }),
          context: { workflowId: workflow.id, stepId: step.id },
          outcome: { status: 'success', learnings: [] },
          importance: 4,
          tags: ['step', 'completed', step.name],
        });
      }

      // Clear Working Memory
      await adapter.deleteWorkingMemory(`workflow:${workflow.id}`);

      // Recover
      const recovered = await manager.recoverWorkflow(workflow.id);

      expect(recovered).toBeDefined();
      expect(recovered?.currentStepIndex).toBe(2);
      expect(recovered?.steps[0].status).toBe('completed');
      expect(recovered?.steps[1].status).toBe('completed');
      expect(recovered?.steps[2].status).toBe('pending');
    });
  });
});
