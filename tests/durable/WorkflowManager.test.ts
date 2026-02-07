/**
 * WorkflowManager Integration Tests
 *
 * Tests for durable workflow execution with cc-memory persistence.
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
  private executedSteps: string[] = [];
  private stepResults: Map<string, Partial<StepExecutionResult>> = new Map();

  setStepResult(stepName: string, result: Partial<StepExecutionResult>): void {
    this.stepResults.set(stepName, result);
  }

  getExecutedSteps(): string[] {
    return [...this.executedSteps];
  }

  clearExecutedSteps(): void {
    this.executedSteps = [];
  }

  async execute(step: DurableStep, context: ExecutionContext): Promise<StepExecutionResult> {
    const startTime = Date.now();
    this.executedSteps.push(step.name);

    const customResult = this.stepResults.get(step.name);
    if (customResult) {
      return {
        stepId: step.id,
        success: customResult.success ?? true,
        output: customResult.output,
        error: customResult.error,
        durationMs: Date.now() - startTime,
        waiting: customResult.waiting ?? false,
        waitingMessage: customResult.waitingMessage,
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
}

describe('WorkflowManager', () => {
  let memoryManager: MemoryManager;
  let adapter: TestStorageAdapter;
  let executor: TestStepExecutor;
  let manager: WorkflowManager;
  let testDataPath: string;

  const simpleWorkflow: WorkflowDefinition = {
    name: 'Test Workflow',
    description: 'A simple test workflow',
    steps: [
      { name: 'step1', agent: 'agent1' },
      { name: 'step2', agent: 'agent2' },
      { name: 'step3', agent: 'agent1' },
    ],
  };

  beforeEach(async () => {
    testDataPath = join(tmpdir(), 'cc-memory-workflow-test-' + Date.now());

    // Initialize MemoryManager
    memoryManager = new MemoryManager({
      dataPath: testDataPath,
      sessionId: 'test-session-001',
    });
    await memoryManager.ready();

    // Increase working memory capacity for workflow tests
    // Each workflow stores 1 workflow item + N step items
    memoryManager.working.setCapacity(100);

    // Initialize components
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

  describe('createWorkflow', () => {
    it('should create a workflow with correct structure', async () => {
      const workflow = await manager.createWorkflow(simpleWorkflow, { input: 'test' });

      expect(workflow.id).toBeDefined();
      expect(workflow.contextId).toBeDefined();
      expect(workflow.name).toBe('Test Workflow');
      expect(workflow.status).toBe('pending');
      expect(workflow.steps).toHaveLength(3);
      expect(workflow.currentStepIndex).toBe(0);
      expect(workflow.input).toEqual({ input: 'test' });
    });

    it('should persist workflow to storage', async () => {
      const workflow = await manager.createWorkflow(simpleWorkflow);

      const retrieved = await manager.getWorkflow(workflow.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(workflow.id);
      expect(retrieved?.name).toBe(workflow.name);
    });

    it('should record creation in episodic memory', async () => {
      const workflow = await manager.createWorkflow(simpleWorkflow);

      const episodes = await adapter.searchEpisodes({
        tags: ['workflow', 'created'],
        limit: 1,
      });

      expect(episodes.length).toBeGreaterThan(0);
      expect(episodes[0].summary).toContain(workflow.name);
    });
  });

  describe('executeWorkflow', () => {
    it('should execute all steps in order', async () => {
      const workflow = await manager.createWorkflow(simpleWorkflow);
      const result = await manager.executeWorkflow(workflow.id);

      expect(result.success).toBe(true);
      expect(result.paused).toBe(false);
      expect(result.stepResults).toHaveLength(3);

      const executedSteps = executor.getExecutedSteps();
      expect(executedSteps).toEqual(['step1', 'step2', 'step3']);
    });

    it('should update workflow status to completed', async () => {
      const workflow = await manager.createWorkflow(simpleWorkflow);
      await manager.executeWorkflow(workflow.id);

      const updated = await manager.getWorkflow(workflow.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.completedAt).toBeDefined();
    });

    it('should handle step failure', async () => {
      executor.setStepResult('step2', {
        success: false,
        error: {
          code: 'TEST_ERROR',
          message: 'Test failure',
          retryable: false,
        },
      });

      const workflow = await manager.createWorkflow(simpleWorkflow);
      const result = await manager.executeWorkflow(workflow.id);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TEST_ERROR');

      const updated = await manager.getWorkflow(workflow.id);
      expect(updated?.status).toBe('failed');
    });

    it('should pause on waiting step', async () => {
      executor.setStepResult('step2', {
        success: true,
        waiting: true,
        waitingMessage: 'Waiting for input',
      });

      const workflow = await manager.createWorkflow(simpleWorkflow);
      const result = await manager.executeWorkflow(workflow.id);

      expect(result.success).toBe(false);
      expect(result.paused).toBe(true);
      expect(result.pausedAtStep).toBe(1);

      const updated = await manager.getWorkflow(workflow.id);
      expect(updated?.status).toBe('paused');
    });
  });

  describe('resumeWorkflow', () => {
    it('should resume from paused step', async () => {
      // First execution - pause at step2
      executor.setStepResult('step2', {
        success: true,
        waiting: true,
        waitingMessage: 'Waiting for input',
      });

      const workflow = await manager.createWorkflow(simpleWorkflow);
      await manager.executeWorkflow(workflow.id);

      // Clear step results and executed steps for resume
      executor.setStepResult('step2', { success: true });
      executor.clearExecutedSteps();

      // Resume
      const result = await manager.resumeWorkflow(workflow.id, { approved: true });

      expect(result.success).toBe(true);
      expect(result.paused).toBe(false);

      // Should execute step2 and step3
      const executedSteps = executor.getExecutedSteps();
      expect(executedSteps).toEqual(['step2', 'step3']);
    });

    it('should throw error for non-paused workflow', async () => {
      const workflow = await manager.createWorkflow(simpleWorkflow);
      await manager.executeWorkflow(workflow.id);

      await expect(manager.resumeWorkflow(workflow.id)).rejects.toThrow('not paused');
    });
  });

  describe('pauseWorkflow', () => {
    it('should pause a running workflow', async () => {
      const workflow = await manager.createWorkflow(simpleWorkflow);

      // Start workflow (will complete quickly with test executor)
      // For this test, we manually set status to running
      const running = await manager.getWorkflow(workflow.id);
      if (running) {
        running.status = 'running';
        await adapter.setWorkingMemory(`workflow:${running.id}`, running, 'task_state');
      }

      await manager.pauseWorkflow(workflow.id, 'Manual pause');

      const paused = await manager.getWorkflow(workflow.id);
      expect(paused?.status).toBe('paused');
    });
  });

  describe('cancelWorkflow', () => {
    it('should cancel a workflow', async () => {
      const workflow = await manager.createWorkflow(simpleWorkflow);
      await manager.cancelWorkflow(workflow.id, 'No longer needed');

      const cancelled = await manager.getWorkflow(workflow.id);
      expect(cancelled?.status).toBe('cancelled');
      expect(cancelled?.completedAt).toBeDefined();
    });
  });

  describe('listWorkflows', () => {
    it('should list all workflows', async () => {
      await manager.createWorkflow(simpleWorkflow);
      await manager.createWorkflow({ ...simpleWorkflow, name: 'Workflow 2' });
      await manager.createWorkflow({ ...simpleWorkflow, name: 'Workflow 3' });

      const workflows = await manager.listWorkflows();
      expect(workflows).toHaveLength(3);
    });

    it('should filter by status', async () => {
      const w1 = await manager.createWorkflow(simpleWorkflow);
      const w2 = await manager.createWorkflow({ ...simpleWorkflow, name: 'Workflow 2' });

      await manager.executeWorkflow(w1.id);

      const completed = await manager.listWorkflows({ status: 'completed' });
      const pending = await manager.listWorkflows({ status: 'pending' });

      expect(completed).toHaveLength(1);
      expect(pending).toHaveLength(1);
    });
  });

  describe('Durable Execution', () => {
    it('should resume from last completed step after simulated crash', async () => {
      const workflow = await manager.createWorkflow(simpleWorkflow);

      // Execute first step
      const step = workflow.steps[0];
      step.status = 'completed';
      step.output = { result: 'step1 done' };
      step.completedAt = Date.now();

      workflow.currentStepIndex = 1;
      workflow.status = 'running';
      await adapter.setWorkingMemory(`workflow:${workflow.id}`, workflow, 'task_state');
      await adapter.setWorkingMemory(`step:${step.id}:status`, {
        stepId: step.id,
        status: 'completed',
        output: step.output,
      }, 'task_state');

      // Create new manager (simulating restart)
      const newManager = new WorkflowManager({ storage: adapter, executor });
      executor.clearExecutedSteps();

      // Resume execution
      const result = await newManager.executeWorkflow(workflow.id);

      expect(result.success).toBe(true);

      // Should only execute step2 and step3
      const executedSteps = executor.getExecutedSteps();
      expect(executedSteps).toEqual(['step2', 'step3']);
    });

    it('should persist step results for recovery', async () => {
      const workflow = await manager.createWorkflow(simpleWorkflow);
      await manager.executeWorkflow(workflow.id);

      // Check that step statuses are persisted
      for (const step of workflow.steps) {
        const stepData = await adapter.getWorkingMemory(`step:${step.id}:status`);
        expect(stepData).toBeDefined();
        expect((stepData as { status: string }).status).toBe('completed');
      }
    });

    it('should record step completions in episodic memory', async () => {
      const workflow = await manager.createWorkflow(simpleWorkflow);
      await manager.executeWorkflow(workflow.id);

      const episodes = await adapter.searchEpisodes({
        tags: ['step', 'completed'],
        limit: 10,
      });

      // Should have 3 step completion episodes
      expect(episodes.length).toBeGreaterThanOrEqual(3);
    });
  });
});
