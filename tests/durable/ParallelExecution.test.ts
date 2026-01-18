/**
 * Parallel Step Execution Tests
 *
 * Tests for executing workflow steps in parallel based on dependency graph.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

// Configurable step executor for testing parallel execution
class ParallelTestExecutor implements StepExecutor {
  public executionOrder: string[] = [];
  public executionTimes: Map<string, { start: number; end: number }> = new Map();
  public stepBehaviors: Map<string, {
    delay?: number;
    shouldFail?: boolean;
    shouldWait?: boolean;
    waitingMessage?: string;
  }> = new Map();

  async execute(step: DurableStep, context: ExecutionContext): Promise<StepExecutionResult> {
    const startTime = Date.now();
    this.executionTimes.set(step.id, { start: startTime, end: 0 });
    this.executionOrder.push(step.id);

    const behavior = this.stepBehaviors.get(step.name) ?? {};

    // Simulate processing time
    if (behavior.delay) {
      await new Promise(resolve => setTimeout(resolve, behavior.delay));
    }

    this.executionTimes.set(step.id, { start: startTime, end: Date.now() });

    // Check for failure
    if (behavior.shouldFail) {
      return {
        stepId: step.id,
        success: false,
        error: {
          code: 'TEST_FAILURE',
          message: `Step ${step.name} failed as configured`,
          retryable: false,
        },
        durationMs: Date.now() - startTime,
        waiting: false,
      };
    }

    // Check for HITL wait
    if (behavior.shouldWait) {
      return {
        stepId: step.id,
        success: true,
        output: { step: step.name, waiting: true },
        durationMs: Date.now() - startTime,
        waiting: true,
        waitingMessage: behavior.waitingMessage ?? 'Waiting for input',
      };
    }

    return {
      stepId: step.id,
      success: true,
      output: { step: step.name, executed: true },
      durationMs: Date.now() - startTime,
      waiting: false,
    };
  }

  reset(): void {
    this.executionOrder = [];
    this.executionTimes.clear();
    this.stepBehaviors.clear();
  }
}

describe('Parallel Step Execution', () => {
  let memoryManager: MemoryManager;
  let adapter: TestStorageAdapter;
  let executor: ParallelTestExecutor;
  let manager: WorkflowManager;
  let testDataPath: string;

  beforeEach(async () => {
    testDataPath = join(tmpdir(), 'cc-memory-parallel-test-' + Date.now());

    memoryManager = new MemoryManager({
      dataPath: testDataPath,
      sessionId: 'test-session-001',
    });
    await memoryManager.ready();

    adapter = new TestStorageAdapter(memoryManager);
    executor = new ParallelTestExecutor();
    manager = new WorkflowManager({ storage: adapter, executor });
  });

  afterEach(() => {
    memoryManager.close();
    if (existsSync(testDataPath)) {
      rmSync(testDataPath, { recursive: true, force: true });
    }
  });

  describe('basic parallel execution', () => {
    it('should execute independent steps in parallel', async () => {
      // Three independent steps with no dependencies
      const workflow: WorkflowDefinition = {
        name: 'Parallel Independent Steps',
        description: 'All steps can run in parallel',
        steps: [
          { name: 'stepA', agent: 'agent1' },
          { name: 'stepB', agent: 'agent2' },
          { name: 'stepC', agent: 'agent3' },
        ],
      };

      // Add delays to observe parallelism
      executor.stepBehaviors.set('stepA', { delay: 50 });
      executor.stepBehaviors.set('stepB', { delay: 50 });
      executor.stepBehaviors.set('stepC', { delay: 50 });

      const created = await manager.createWorkflow(workflow);
      const startTime = Date.now();
      const result = await manager.executeWorkflowParallel(created.id);
      const totalTime = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.stepResults.length).toBe(3);

      // All three should have executed
      expect(executor.executionOrder).toHaveLength(3);
      expect(executor.executionOrder).toContain(created.steps[0].id);
      expect(executor.executionOrder).toContain(created.steps[1].id);
      expect(executor.executionOrder).toContain(created.steps[2].id);

      // Total time should be close to single step time (parallel), not 3x
      // Allow some overhead margin
      expect(totalTime).toBeLessThan(200); // Much less than 150ms sequential
    });

    it('should execute steps with dependencies in correct order', async () => {
      // stepB depends on stepA, stepC depends on stepB
      const workflow: WorkflowDefinition = {
        name: 'Sequential Dependencies',
        description: 'Chain of dependent steps',
        steps: [
          { name: 'stepA', agent: 'agent1' },
          { name: 'stepB', agent: 'agent2', dependsOn: ['stepA'] },
          { name: 'stepC', agent: 'agent3', dependsOn: ['stepB'] },
        ],
      };

      const created = await manager.createWorkflow(workflow);
      const result = await manager.executeWorkflowParallel(created.id);

      expect(result.success).toBe(true);
      expect(result.stepResults.length).toBe(3);

      // Verify execution order: A before B before C
      const orderA = executor.executionOrder.indexOf(created.steps[0].id);
      const orderB = executor.executionOrder.indexOf(created.steps[1].id);
      const orderC = executor.executionOrder.indexOf(created.steps[2].id);

      expect(orderA).toBeLessThan(orderB);
      expect(orderB).toBeLessThan(orderC);
    });

    it('should execute steps with partial parallelism', async () => {
      // stepA and stepB independent, stepC depends on both
      const workflow: WorkflowDefinition = {
        name: 'Diamond Pattern',
        description: 'A and B parallel, C waits for both',
        steps: [
          { name: 'stepA', agent: 'agent1' },
          { name: 'stepB', agent: 'agent2' },
          { name: 'stepC', agent: 'agent3', dependsOn: ['stepA', 'stepB'] },
        ],
      };

      executor.stepBehaviors.set('stepA', { delay: 30 });
      executor.stepBehaviors.set('stepB', { delay: 30 });

      const created = await manager.createWorkflow(workflow);
      const result = await manager.executeWorkflowParallel(created.id);

      expect(result.success).toBe(true);
      expect(result.stepResults.length).toBe(3);

      // stepA and stepB should execute before stepC
      const orderA = executor.executionOrder.indexOf(created.steps[0].id);
      const orderB = executor.executionOrder.indexOf(created.steps[1].id);
      const orderC = executor.executionOrder.indexOf(created.steps[2].id);

      expect(orderC).toBeGreaterThan(orderA);
      expect(orderC).toBeGreaterThan(orderB);
    });
  });

  describe('failure handling', () => {
    it('should handle step failure during parallel execution', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Parallel With Failure',
        steps: [
          { name: 'stepA', agent: 'agent1' },
          { name: 'stepB', agent: 'agent2' },
          { name: 'stepC', agent: 'agent3' },
        ],
      };

      executor.stepBehaviors.set('stepB', { shouldFail: true });

      const created = await manager.createWorkflow(workflow);
      const result = await manager.executeWorkflowParallel(created.id);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('TEST_FAILURE');

      // Workflow should be marked as failed
      const updated = await manager.getWorkflow(created.id);
      expect(updated?.status).toBe('failed');
    });

    it('should stop execution when a depended-upon step fails', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Failure Blocks Dependents',
        steps: [
          { name: 'stepA', agent: 'agent1' },
          { name: 'stepB', agent: 'agent2', dependsOn: ['stepA'] },
        ],
      };

      executor.stepBehaviors.set('stepA', { shouldFail: true });

      const created = await manager.createWorkflow(workflow);
      const result = await manager.executeWorkflowParallel(created.id);

      expect(result.success).toBe(false);

      // stepB should not have executed
      const stepBExecuted = executor.executionOrder.includes(created.steps[1].id);
      expect(stepBExecuted).toBe(false);
    });
  });

  describe('HITL pause handling', () => {
    it('should pause workflow when a step waits for input', async () => {
      const workflow: WorkflowDefinition = {
        name: 'HITL Parallel',
        steps: [
          { name: 'stepA', agent: 'agent1' },
          { name: 'stepB', agent: 'agent2' },
        ],
      };

      executor.stepBehaviors.set('stepB', {
        shouldWait: true,
        waitingMessage: 'Need user approval',
      });

      const created = await manager.createWorkflow(workflow);
      const result = await manager.executeWorkflowParallel(created.id);

      // When paused, success is false (workflow hasn't completed)
      // but paused flag indicates it's waiting for input
      expect(result.success).toBe(false);
      expect(result.paused).toBe(true);

      // Workflow should be paused
      const updated = await manager.getWorkflow(created.id);
      expect(updated?.status).toBe('paused');

      // Check pause was recorded
      const episodes = await adapter.searchEpisodes({
        tags: ['workflow', 'paused', 'parallel'],
        limit: 1,
      });
      expect(episodes.length).toBeGreaterThan(0);
    });
  });

  describe('deadlock detection', () => {
    it('should detect deadlock with circular dependencies', async () => {
      // Note: This is a contrived example - in practice, circular deps
      // should be validated during workflow creation
      const workflow: WorkflowDefinition = {
        name: 'Deadlock Test',
        steps: [
          { name: 'stepA', agent: 'agent1', dependsOn: ['stepC'] },
          { name: 'stepB', agent: 'agent2', dependsOn: ['stepA'] },
          { name: 'stepC', agent: 'agent3', dependsOn: ['stepB'] },
        ],
      };

      const created = await manager.createWorkflow(workflow);
      const result = await manager.executeWorkflowParallel(created.id);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PARALLEL_DEADLOCK');

      // Workflow should be failed
      const updated = await manager.getWorkflow(created.id);
      expect(updated?.status).toBe('failed');
    });

    it('should detect missing dependency', async () => {
      // Step depends on non-existent step
      const workflow: WorkflowDefinition = {
        name: 'Missing Dependency',
        steps: [
          { name: 'stepA', agent: 'agent1', dependsOn: ['nonExistent'] },
        ],
      };

      const created = await manager.createWorkflow(workflow);
      const result = await manager.executeWorkflowParallel(created.id);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PARALLEL_DEADLOCK');
    });
  });

  describe('complex DAG execution', () => {
    it('should handle complex dependency graph', async () => {
      /**
       * Dependency graph:
       *
       *     A ──┬──> C ──> E
       *         │         ↑
       *     B ──┴──> D ───┘
       *
       * Expected batches:
       * Batch 1: A, B (parallel)
       * Batch 2: C, D (parallel, after A,B complete)
       * Batch 3: E (after C,D complete)
       */
      const workflow: WorkflowDefinition = {
        name: 'Complex DAG',
        steps: [
          { name: 'stepA', agent: 'agent1' },
          { name: 'stepB', agent: 'agent2' },
          { name: 'stepC', agent: 'agent3', dependsOn: ['stepA', 'stepB'] },
          { name: 'stepD', agent: 'agent4', dependsOn: ['stepA', 'stepB'] },
          { name: 'stepE', agent: 'agent5', dependsOn: ['stepC', 'stepD'] },
        ],
      };

      const created = await manager.createWorkflow(workflow);
      const result = await manager.executeWorkflowParallel(created.id);

      expect(result.success).toBe(true);
      expect(result.stepResults.length).toBe(5);

      // Verify order constraints
      const order = new Map<string, number>();
      executor.executionOrder.forEach((id, idx) => order.set(id, idx));

      // A and B must be before C and D
      const idA = created.steps[0].id;
      const idB = created.steps[1].id;
      const idC = created.steps[2].id;
      const idD = created.steps[3].id;
      const idE = created.steps[4].id;

      expect(order.get(idA)!).toBeLessThan(order.get(idC)!);
      expect(order.get(idA)!).toBeLessThan(order.get(idD)!);
      expect(order.get(idB)!).toBeLessThan(order.get(idC)!);
      expect(order.get(idB)!).toBeLessThan(order.get(idD)!);

      // C and D must be before E
      expect(order.get(idC)!).toBeLessThan(order.get(idE)!);
      expect(order.get(idD)!).toBeLessThan(order.get(idE)!);
    });

    it('should maximize parallelism', async () => {
      // Wide parallel graph: many independent steps
      const workflow: WorkflowDefinition = {
        name: 'Wide Parallel',
        steps: [
          { name: 'step1', agent: 'agent1' },
          { name: 'step2', agent: 'agent2' },
          { name: 'step3', agent: 'agent3' },
          { name: 'step4', agent: 'agent4' },
          { name: 'step5', agent: 'agent5' },
          { name: 'final', agent: 'agent6', dependsOn: ['step1', 'step2', 'step3', 'step4', 'step5'] },
        ],
      };

      // Add delays to measure parallelism
      for (let i = 1; i <= 5; i++) {
        executor.stepBehaviors.set(`step${i}`, { delay: 20 });
      }

      const created = await manager.createWorkflow(workflow);
      const startTime = Date.now();
      const result = await manager.executeWorkflowParallel(created.id);
      const totalTime = Date.now() - startTime;

      expect(result.success).toBe(true);

      // Should execute in ~2 batches (5 parallel + 1 final)
      // Sequential would be 6*20ms = 120ms
      // Parallel should be ~40ms (20ms*2 batches)
      expect(totalTime).toBeLessThan(100);
    });
  });

  describe('episode recording', () => {
    it('should record parallel execution completion in episodic memory', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Parallel Recording Test',
        steps: [
          { name: 'stepA', agent: 'agent1' },
          { name: 'stepB', agent: 'agent2' },
        ],
      };

      const created = await manager.createWorkflow(workflow);
      await manager.executeWorkflowParallel(created.id);

      // Check for completion episode
      const episodes = await adapter.searchEpisodes({
        tags: ['workflow', 'completed', 'parallel'],
        limit: 1,
      });

      expect(episodes.length).toBeGreaterThan(0);
      expect(episodes[0].summary).toContain('completed (parallel)');

      // Check details contain parallelBatches
      const details = JSON.parse(episodes[0].details);
      expect(details.parallelBatches).toBeDefined();
    });

    it('should record individual step completions with parallel tag', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Step Recording Test',
        steps: [
          { name: 'stepA', agent: 'agent1' },
        ],
      };

      const created = await manager.createWorkflow(workflow);
      await manager.executeWorkflowParallel(created.id);

      // Check for step completion episode
      // Search for more episodes since workflow completion may be returned first
      const episodes = await adapter.searchEpisodes({
        tags: ['step', 'completed', 'parallel'],
        limit: 10,
      });

      expect(episodes.length).toBeGreaterThan(0);
      // Find the step completion episode
      const stepEpisode = episodes.find(ep => ep.summary.includes('Step completed (parallel)'));
      expect(stepEpisode).toBeDefined();
      expect(stepEpisode!.summary).toContain('stepA');
    });
  });

  describe('resume partially completed workflow', () => {
    it('should skip already completed steps when resuming', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Resume Test',
        steps: [
          { name: 'stepA', agent: 'agent1' },
          { name: 'stepB', agent: 'agent2' },
          { name: 'stepC', agent: 'agent3', dependsOn: ['stepA', 'stepB'] },
        ],
      };

      const created = await manager.createWorkflow(workflow);

      // Manually mark stepA as completed
      created.steps[0].status = 'completed';
      created.steps[0].output = { result: 'done' };
      created.steps[0].completedAt = Date.now();
      await adapter.setWorkingMemory(`workflow:${created.id}`, created, 'task_state');

      // Execute workflow
      executor.reset();
      const result = await manager.executeWorkflowParallel(created.id);

      expect(result.success).toBe(true);

      // stepA should NOT have been executed again
      const stepAExecuted = executor.executionOrder.includes(created.steps[0].id);
      expect(stepAExecuted).toBe(false);

      // stepB and stepC should have executed
      expect(executor.executionOrder).toContain(created.steps[1].id);
      expect(executor.executionOrder).toContain(created.steps[2].id);
    });
  });
});
