/**
 * Durable Multi-Agent Integration Tests
 *
 * End-to-end tests combining workflow execution with agent coordination.
 * Tests:
 * - Workflow with Agent Delegation
 * - Memory Synchronization between instances
 * - Recovery after simulated crash
 * - HITL pause and resume across agents
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { SqliteStorage } from '../../src/storage/SqliteStorage.js';
import { WorkflowManager, type WorkflowStorage, type StepExecutor, type ExecutionContext } from '../../src/durable/WorkflowManager.js';
import { AgentCoordinator, type AgentStorage } from '../../src/agents/AgentCoordinator.js';
import { StorageAdapter } from '../../src/durable/adapters/StorageAdapter.js';
import type {
  DurableStep,
  StepExecutionResult,
  WorkflowDefinition,
} from '../../src/durable/types.js';
import type { ParallelizationExport } from '../../src/memory/types.js';

// Step executor that delegates to agents
class AgentDelegatingExecutor implements StepExecutor {
  constructor(private coordinator: AgentCoordinator) {}

  public stepResults: Map<string, unknown> = new Map();
  public waitingSteps: Set<string> = new Set();

  async execute(step: DurableStep, context: ExecutionContext): Promise<StepExecutionResult> {
    const startTime = Date.now();

    // Check if this step should wait
    if (this.waitingSteps.has(step.name)) {
      return {
        stepId: step.id,
        success: true,
        output: { step: step.name, waiting: true },
        durationMs: Date.now() - startTime,
        waiting: true,
        waitingMessage: `Waiting for human approval: ${step.name}`,
      };
    }

    // Try to find an agent for this step
    const agent = step.agentRole
      ? this.coordinator.findAgentForRole(step.agentRole)
      : this.coordinator.findAgentForCapability(step.name);

    const executedBy = agent?.id || step.agent;

    // Get any pre-configured result
    const configuredResult = this.stepResults.get(step.name);

    return {
      stepId: step.id,
      success: true,
      output: configuredResult ?? {
        step: step.name,
        executedBy,
        agent: agent?.name || step.agent,
        previousOutputs: Object.fromEntries(context.previousStepOutputs),
      },
      durationMs: Date.now() - startTime,
      waiting: false,
    };
  }
}

describe('Durable Multi-Agent Integration', () => {
  let memoryManager: MemoryManager;
  let sqliteStorage: SqliteStorage;
  let adapter: StorageAdapter;
  let workflowManager: WorkflowManager;
  let agentCoordinator: AgentCoordinator;
  let executor: AgentDelegatingExecutor;
  let testDataPath: string;
  let syncDir: string;

  beforeEach(async () => {
    testDataPath = join(tmpdir(), 'cc-memory-integration-test-' + Date.now());
    syncDir = join(testDataPath, 'sync');
    mkdirSync(syncDir, { recursive: true });

    memoryManager = new MemoryManager({
      dataPath: testDataPath,
      sessionId: 'integration-test-001',
    });
    await memoryManager.ready();

    sqliteStorage = (memoryManager as any).storage;
    adapter = new StorageAdapter(memoryManager, sqliteStorage);

    agentCoordinator = new AgentCoordinator(adapter, { syncDir });
    await agentCoordinator.initialize('integration-coordinator');

    executor = new AgentDelegatingExecutor(agentCoordinator);
    workflowManager = new WorkflowManager({ storage: adapter, executor });
  });

  afterEach(() => {
    memoryManager.close();
    if (existsSync(testDataPath)) {
      rmSync(testDataPath, { recursive: true, force: true });
    }
  });

  describe('Workflow with Agent Delegation', () => {
    it('should execute workflow steps via registered agents', async () => {
      // Register agents for different roles
      await agentCoordinator.registerAgent(
        'backend-processor',
        'backend',
        [{ name: 'process_data', description: 'Process data', available: true }]
      );
      await agentCoordinator.registerAgent(
        'frontend-renderer',
        'frontend',
        [{ name: 'render_ui', description: 'Render UI', available: true }]
      );

      // Create workflow with role-based steps
      const workflow: WorkflowDefinition = {
        name: 'Multi-Agent Pipeline',
        description: 'A workflow that uses multiple agents',
        steps: [
          { name: 'fetch_data', agent: 'backend-processor', agentRole: 'backend' },
          { name: 'render_ui', agent: 'frontend-renderer', agentRole: 'frontend', dependsOn: ['fetch_data'] },
        ],
      };

      const created = await workflowManager.createWorkflow(workflow);
      const result = await workflowManager.executeWorkflow(created.id);

      expect(result.success).toBe(true);
      expect(result.stepResults.length).toBe(2);

      // Verify agents were used
      const fetchOutput = result.stepResults[0].output as any;
      expect(fetchOutput.agent).toBe('backend-processor');

      const renderOutput = result.stepResults[1].output as any;
      expect(renderOutput.agent).toBe('frontend-renderer');
      // Second step should have access to first step's output
      expect(renderOutput.previousOutputs).toBeDefined();
    });

    it('should create and delegate tasks during workflow', async () => {
      await agentCoordinator.registerAgent(
        'task-worker',
        'backend',
        [{ name: 'process', description: 'Process tasks', available: true }]
      );

      // Create a task and delegate it
      const task = await agentCoordinator.createTask(
        'Process workflow result',
        'Process the output from workflow execution'
      );

      const agents = agentCoordinator.listAgents({ role: 'backend' });
      expect(agents.length).toBe(1);

      const delegation = await agentCoordinator.delegateTask(task.id, agents[0].id);

      expect(delegation.success).toBe(true);
      expect(delegation.assignedTo).toBe(agents[0].id);
    });
  });

  describe('Memory Synchronization', () => {
    it('should sync workflow state between Tachikoma instances', async () => {
      // Create first workflow
      const workflow: WorkflowDefinition = {
        name: 'Sync Test Workflow',
        steps: [{ name: 'step1', agent: 'agent1' }],
      };

      const created = await workflowManager.createWorkflow(workflow);
      await workflowManager.executeWorkflow(created.id);

      // Export state
      const exportData = await agentCoordinator.syncToOtherAgents() as ParallelizationExport;

      expect(exportData.format).toBe('tachikoma-parallelize-delta');
      expect(exportData.tachikomaName).toBe('integration-coordinator');

      // Create a second instance
      const testDataPath2 = join(tmpdir(), 'cc-memory-integration-test2-' + Date.now());
      mkdirSync(testDataPath2, { recursive: true });

      const memoryManager2 = new MemoryManager({
        dataPath: testDataPath2,
        sessionId: 'integration-test-002',
      });
      await memoryManager2.ready();

      const sqliteStorage2 = (memoryManager2 as any).storage;
      const adapter2 = new StorageAdapter(memoryManager2, sqliteStorage2);
      const coordinator2 = new AgentCoordinator(adapter2);
      await coordinator2.initialize('second-coordinator');

      // Import state
      const importResult = await coordinator2.importFromAgent(exportData);

      expect(importResult.merged.episodic).toBeGreaterThan(0);

      // Cleanup second instance
      memoryManager2.close();
      rmSync(testDataPath2, { recursive: true, force: true });
    });

    it('should sync from directory on startup', async () => {
      // Create another coordinator's export
      const otherExport: ParallelizationExport = {
        version: '1.0.0',
        format: 'tachikoma-parallelize-delta',
        tachikomaId: 'other-coordinator-id',
        tachikomaName: 'other-coordinator',
        exportedAt: Date.now(),
        syncVector: { 'other-coordinator-id': 1 },
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

      // Sync from directory
      const result = await agentCoordinator.syncFromDirectory();

      expect(result.filesProcessed).toBe(1);
      expect(result.errors.length).toBe(0);
    });
  });

  describe('Recovery After Crash', () => {
    it('should recover workflow from Episodic Memory after Working Memory loss', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Recovery Test',
        description: 'Workflow for recovery testing',
        steps: [
          { name: 'step1', agent: 'agent1' },
          { name: 'step2', agent: 'agent2' },
        ],
      };

      // Create and execute workflow
      const created = await workflowManager.createWorkflow(workflow);
      await workflowManager.executeWorkflow(created.id);

      // Simulate crash by clearing Working Memory
      await adapter.deleteWorkingMemory(`workflow:${created.id}`);
      for (const step of created.steps) {
        await adapter.deleteWorkingMemory(`step:${step.id}:status`);
      }

      // Verify Working Memory is empty
      const beforeRecovery = await workflowManager.getWorkflow(created.id);
      expect(beforeRecovery).toBeNull();

      // Recover workflow
      const recovered = await workflowManager.recoverWorkflow(created.id);

      expect(recovered).toBeDefined();
      expect(recovered?.id).toBe(created.id);
      expect(recovered?.name).toBe(workflow.name);
      expect(recovered?.status).toBe('completed');
      expect(recovered?.steps.length).toBe(2);

      // All steps should be marked as completed
      for (const step of recovered!.steps) {
        expect(step.status).toBe('completed');
      }
    });

    it('should recover partially completed workflow and continue execution', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Partial Recovery Test',
        steps: [
          { name: 'step1', agent: 'agent1' },
          { name: 'step2', agent: 'agent2' },
          { name: 'step3', agent: 'agent3', dependsOn: ['step1', 'step2'] },
        ],
      };

      const created = await workflowManager.createWorkflow(workflow);

      // Simulate partial completion: manually complete step1
      created.steps[0].status = 'completed';
      created.steps[0].output = { result: 'step1 done' };
      created.steps[0].completedAt = Date.now();
      await adapter.setWorkingMemory(`workflow:${created.id}`, created, 'task_state');

      // Record step1 completion episode
      await adapter.recordEpisode({
        type: 'milestone',
        summary: `Step completed: step1`,
        details: JSON.stringify({
          stepId: created.steps[0].id,
          workflowId: created.id,
          output: created.steps[0].output,
          durationMs: 100,
          completedAt: created.steps[0].completedAt,
        }),
        context: { workflowId: created.id, stepId: created.steps[0].id },
        outcome: { status: 'success', learnings: [] },
        tags: ['step', 'completed', 'step1'],
      });

      // Clear Working Memory
      await adapter.deleteWorkingMemory(`workflow:${created.id}`);

      // Recover
      const recovered = await workflowManager.recoverWorkflow(created.id);

      expect(recovered).toBeDefined();
      expect(recovered?.steps[0].status).toBe('completed');
      expect(recovered?.steps[1].status).toBe('pending');
      expect(recovered?.steps[2].status).toBe('pending');

      // Continue execution - should only run remaining steps
      const result = await workflowManager.executeWorkflow(created.id);

      expect(result.success).toBe(true);

      // Final workflow should be complete
      const final = await workflowManager.getWorkflow(created.id);
      expect(final?.status).toBe('completed');
    });
  });

  describe('HITL Pause and Resume', () => {
    it('should pause workflow for human input and resume', async () => {
      executor.waitingSteps.add('approval');

      const workflow: WorkflowDefinition = {
        name: 'HITL Workflow',
        steps: [
          { name: 'prepare', agent: 'agent1' },
          { name: 'approval', agent: 'human' },
          { name: 'complete', agent: 'agent2', dependsOn: ['approval'] },
        ],
      };

      const created = await workflowManager.createWorkflow(workflow);
      const firstResult = await workflowManager.executeWorkflow(created.id);

      // Should be paused at approval step
      expect(firstResult.paused).toBe(true);
      expect(firstResult.pausedAtStep).toBe(1);

      // Workflow should be paused
      const paused = await workflowManager.getWorkflow(created.id);
      expect(paused?.status).toBe('paused');

      // Clear waiting and resume
      executor.waitingSteps.delete('approval');

      const resumeResult = await workflowManager.resumeWorkflow(created.id, { approved: true });

      expect(resumeResult.success).toBe(true);

      // Workflow should be completed
      const completed = await workflowManager.getWorkflow(created.id);
      expect(completed?.status).toBe('completed');
    });

    it('should handle HITL in parallel execution', async () => {
      executor.waitingSteps.add('review');

      const workflow: WorkflowDefinition = {
        name: 'Parallel HITL',
        steps: [
          { name: 'prepare', agent: 'agent1' },
          { name: 'process', agent: 'agent2' },
          { name: 'review', agent: 'human' },
        ],
      };

      const created = await workflowManager.createWorkflow(workflow);
      const result = await workflowManager.executeWorkflowParallel(created.id);

      // Should pause when hitting review step
      expect(result.paused).toBe(true);

      // At least the first two parallel steps should have completed
      const completedSteps = result.stepResults.filter(sr => sr.success && !sr.waiting);
      expect(completedSteps.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('End-to-End Flow', () => {
    it('should complete full multi-agent workflow with delegation and sync', async () => {
      // 1. Register agents
      await agentCoordinator.registerAgent(
        'data-agent',
        'data',
        [
          { name: 'fetch', description: 'Fetch data', available: true },
          { name: 'transform', description: 'Transform data', available: true },
        ]
      );
      await agentCoordinator.registerAgent(
        'api-agent',
        'backend',
        [{ name: 'publish', description: 'Publish to API', available: true }]
      );

      // 2. Create complex workflow
      const workflow: WorkflowDefinition = {
        name: 'Data Pipeline',
        description: 'End-to-end data processing pipeline',
        steps: [
          { name: 'fetch', agent: 'data-agent', agentRole: 'data' },
          { name: 'transform', agent: 'data-agent', agentRole: 'data', dependsOn: ['fetch'] },
          { name: 'publish', agent: 'api-agent', agentRole: 'backend', dependsOn: ['transform'] },
        ],
      };

      // 3. Execute in parallel mode
      const created = await workflowManager.createWorkflow(workflow, { source: 'database' });
      const result = await workflowManager.executeWorkflowParallel(created.id);

      expect(result.success).toBe(true);
      expect(result.stepResults.length).toBe(3);

      // 4. Create follow-up task
      const task = await agentCoordinator.createTask(
        'Validate pipeline output',
        'Verify the data was published correctly'
      );

      const testingAgent = await agentCoordinator.registerAgent(
        'qa-agent',
        'testing',
        [{ name: 'validate', description: 'Validate results', available: true }]
      );

      const delegation = await agentCoordinator.delegateTask(task.id, testingAgent.id);
      expect(delegation.success).toBe(true);

      // 5. Export state for other agents
      const exportData = await agentCoordinator.syncToOtherAgents();
      expect(exportData).toBeDefined();

      // 6. Get final status
      const status = await agentCoordinator.getStatus();
      expect(status.agentCount).toBe(3); // data, api, qa
      expect(status.pendingTaskCount).toBe(1); // delegated task
    });
  });
});
