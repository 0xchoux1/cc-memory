/**
 * WorkflowManager - Durable Execution Engine using cc-memory
 *
 * This module provides durable workflow execution capabilities by leveraging
 * cc-memory's persistence layers:
 * - Working Memory: Step status and intermediate state
 * - Episodic Memory: Step completion records for durability
 * - Tachikoma: Multi-agent synchronization
 *
 * Key Features:
 * - Resume from last completed step after crash
 * - HITL (Human-in-the-Loop) pause and resume
 * - Step-level persistence for fault tolerance
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  DurableWorkflow,
  DurableStep,
  StepStatus,
  WorkflowStatus,
  WorkflowDefinition,
  StepDefinition,
  StepExecutionResult,
  WorkflowExecutionResult,
  StepError,
  WorkflowMetadata,
} from './types.js';
import type { AgentRole } from '../memory/types.js';

// Storage interface for cc-memory integration
export interface WorkflowStorage {
  // Working Memory operations
  setWorkingMemory(key: string, value: unknown, type: string): Promise<void>;
  getWorkingMemory(key: string): Promise<unknown | null>;
  deleteWorkingMemory(key: string): Promise<void>;
  listWorkingMemory(filter?: { type?: string }): Promise<Array<{ key: string; value: unknown }>>;

  // Episodic Memory operations
  recordEpisode(episode: {
    type: string;
    summary: string;
    details: string;
    context?: Record<string, unknown>;
    outcome?: { status: string; learnings: string[] };
    importance?: number;
    tags?: string[];
  }): Promise<string>;
  searchEpisodes(query: {
    query?: string;
    type?: string;
    tags?: string[];
    limit?: number;
  }): Promise<Array<{ id: string; summary: string; details: string }>>;
}

// Step executor interface
export interface StepExecutor {
  execute(step: DurableStep, context: ExecutionContext): Promise<StepExecutionResult>;
}

// Execution context passed to step executors
export interface ExecutionContext {
  workflowId: string;
  contextId: string;
  previousStepOutputs: Map<string, unknown>;
  metadata?: WorkflowMetadata;
}

// Workflow Manager configuration
export interface WorkflowManagerConfig {
  storage: WorkflowStorage;
  executor?: StepExecutor;
  defaultTimeout?: number;
  defaultMaxRetries?: number;
}

// Internal types for recovery
interface WorkflowCreationDetails {
  workflowId: string;
  contextId: string;
  name: string;
  description?: string;
  stepCount: number;
  steps: Array<{
    id: string;
    name: string;
    agent: string;
    agentRole?: string;
    dependsOn?: string[];
    maxRetries?: number;
    timeout?: number;
  }>;
  input?: unknown;
  metadata?: WorkflowMetadata;
  createdAt: number;
}

interface StepCompletionDetails {
  stepId: string;
  workflowId: string;
  output?: unknown;
  durationMs: number;
  completedAt: number;
  startedAt?: number;
}

/**
 * Manages durable workflow execution with cc-memory persistence
 */
export class WorkflowManager {
  private storage: WorkflowStorage;
  private executor?: StepExecutor;
  private defaultTimeout: number;
  private defaultMaxRetries: number;

  constructor(config: WorkflowManagerConfig) {
    this.storage = config.storage;
    this.executor = config.executor;
    this.defaultTimeout = config.defaultTimeout ?? 300000; // 5 minutes
    this.defaultMaxRetries = config.defaultMaxRetries ?? 3;
  }

  // ============================================================================
  // Workflow Creation
  // ============================================================================

  /**
   * Create a new workflow from a definition
   */
  async createWorkflow(
    definition: WorkflowDefinition,
    input?: unknown,
    metadata?: WorkflowMetadata
  ): Promise<DurableWorkflow> {
    const now = Date.now();
    const workflowId = uuidv4();
    const contextId = metadata?.properties?.contextId as string ?? uuidv4();

    const steps: DurableStep[] = definition.steps.map((stepDef, index) => ({
      id: `${workflowId}-step-${index}`,
      name: stepDef.name,
      agent: stepDef.agent,
      agentRole: stepDef.agentRole,
      status: 'pending' as StepStatus,
      maxRetries: stepDef.maxRetries ?? this.defaultMaxRetries,
      timeout: stepDef.timeout ?? this.defaultTimeout,
      dependsOn: stepDef.dependsOn,
    }));

    const workflow: DurableWorkflow = {
      id: workflowId,
      contextId,
      name: definition.name,
      description: definition.description,
      steps,
      currentStepIndex: 0,
      status: 'pending',
      input,
      createdAt: now,
      updatedAt: now,
      metadata: {
        ...definition.defaultMetadata,
        ...metadata,
      },
    };

    // Persist workflow to Working Memory
    await this.persistWorkflow(workflow);

    // Record workflow creation in Episodic Memory with full recovery data
    await this.storage.recordEpisode({
      type: 'milestone',
      summary: `Workflow created: ${workflow.name}`,
      details: JSON.stringify({
        workflowId: workflow.id,
        contextId: workflow.contextId,
        name: workflow.name,
        description: workflow.description,
        stepCount: steps.length,
        steps: steps.map(s => ({
          id: s.id,
          name: s.name,
          agent: s.agent,
          agentRole: s.agentRole,
          dependsOn: s.dependsOn,
          maxRetries: s.maxRetries,
          timeout: s.timeout,
        })),
        input: workflow.input,
        metadata: workflow.metadata,
        createdAt: workflow.createdAt,
      }),
      context: { workflowId: workflow.id, contextId: workflow.contextId },
      importance: 5,
      tags: ['workflow', 'created', workflow.name],
    });

    return workflow;
  }

  /**
   * Persist workflow state to Working Memory
   */
  private async persistWorkflow(workflow: DurableWorkflow): Promise<void> {
    await this.storage.setWorkingMemory(
      `workflow:${workflow.id}`,
      workflow,
      'task_state'
    );

    // Also persist each step status separately for granular recovery
    for (const step of workflow.steps) {
      await this.storage.setWorkingMemory(
        `step:${step.id}:status`,
        {
          stepId: step.id,
          workflowId: workflow.id,
          status: step.status,
          output: step.output,
          error: step.error,
          startedAt: step.startedAt,
          completedAt: step.completedAt,
        },
        'task_state'
      );
    }
  }

  // ============================================================================
  // Workflow Retrieval
  // ============================================================================

  /**
   * Get a workflow by ID
   */
  async getWorkflow(workflowId: string): Promise<DurableWorkflow | null> {
    const data = await this.storage.getWorkingMemory(`workflow:${workflowId}`);
    return data as DurableWorkflow | null;
  }

  /**
   * Get workflow status
   */
  async getWorkflowStatus(workflowId: string): Promise<WorkflowStatus | null> {
    const workflow = await this.getWorkflow(workflowId);
    return workflow?.status ?? null;
  }

  /**
   * List all workflows
   */
  async listWorkflows(filter?: { status?: WorkflowStatus; limit?: number }): Promise<DurableWorkflow[]> {
    const items = await this.storage.listWorkingMemory({ type: 'task_state' });
    const workflows: DurableWorkflow[] = [];

    for (const item of items) {
      if (item.key.startsWith('workflow:') && !item.key.includes('step:')) {
        const workflow = item.value as DurableWorkflow;
        if (!filter?.status || workflow.status === filter.status) {
          workflows.push(workflow);
        }
      }
    }

    const sorted = workflows.sort((a, b) => b.updatedAt - a.updatedAt);
    return filter?.limit ? sorted.slice(0, filter.limit) : sorted;
  }

  // ============================================================================
  // Workflow Execution
  // ============================================================================

  /**
   * Execute a workflow from the beginning or resume from last completed step
   */
  async executeWorkflow(workflowId: string): Promise<WorkflowExecutionResult> {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const startTime = Date.now();
    const stepResults: StepExecutionResult[] = [];

    // Determine starting point (resume from last completed step)
    const startIndex = this.findResumeIndex(workflow);

    // Update workflow status
    workflow.status = 'running';
    workflow.startedAt = workflow.startedAt ?? startTime;
    workflow.updatedAt = startTime;
    await this.persistWorkflow(workflow);

    // Build execution context
    const context: ExecutionContext = {
      workflowId: workflow.id,
      contextId: workflow.contextId,
      previousStepOutputs: this.buildPreviousOutputsMap(workflow, startIndex),
      metadata: workflow.metadata,
    };

    // Execute steps sequentially
    for (let i = startIndex; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      workflow.currentStepIndex = i;

      // Check dependencies
      if (!this.areDependenciesMet(step, workflow)) {
        const error: StepError = {
          code: 'DEPENDENCIES_NOT_MET',
          message: `Dependencies not met for step ${step.name}`,
          retryable: false,
        };
        step.status = 'failed';
        step.error = error;
        await this.persistWorkflow(workflow);

        return this.buildWorkflowResult(workflow, stepResults, startTime, error);
      }

      // Execute step
      const stepResult = await this.executeStep(step, context);
      stepResults.push(stepResult);

      // Update step in workflow
      step.status = stepResult.success
        ? (stepResult.waiting ? 'waiting' : 'completed')
        : 'failed';
      step.output = stepResult.output;
      step.error = stepResult.error;
      step.completedAt = stepResult.waiting ? undefined : Date.now();

      // Update context with step output
      if (stepResult.output !== undefined) {
        context.previousStepOutputs.set(step.id, stepResult.output);
      }

      // Persist updated state
      workflow.updatedAt = Date.now();
      await this.persistWorkflow(workflow);

      // Check if workflow should pause
      if (stepResult.waiting) {
        workflow.status = 'paused';
        await this.persistWorkflow(workflow);

        await this.storage.recordEpisode({
          type: 'interaction',
          summary: `Workflow paused at step: ${step.name}`,
          details: stepResult.waitingMessage ?? 'Waiting for input',
          context: { workflowId: workflow.id, stepId: step.id },
          importance: 6,
          tags: ['workflow', 'paused', 'hitl'],
        });

        return this.buildWorkflowResult(workflow, stepResults, startTime, undefined, true, i);
      }

      // Check if step failed
      if (!stepResult.success) {
        workflow.status = 'failed';
        workflow.error = stepResult.error;
        workflow.completedAt = Date.now();
        await this.persistWorkflow(workflow);

        await this.storage.recordEpisode({
          type: 'error',
          summary: `Workflow failed at step: ${step.name}`,
          details: JSON.stringify(stepResult.error),
          context: { workflowId: workflow.id, stepId: step.id },
          outcome: { status: 'failure', learnings: [] },
          importance: 8,
          tags: ['workflow', 'failed', step.name],
        });

        return this.buildWorkflowResult(workflow, stepResults, startTime, stepResult.error);
      }

      // Record step completion with recovery data
      await this.storage.recordEpisode({
        type: 'milestone',
        summary: `Step completed: ${step.name}`,
        details: JSON.stringify({
          stepId: step.id,
          workflowId: workflow.id,
          output: stepResult.output,
          durationMs: stepResult.durationMs,
          completedAt: step.completedAt ?? Date.now(),
          startedAt: step.startedAt,
        } satisfies StepCompletionDetails),
        context: { workflowId: workflow.id, stepId: step.id },
        outcome: { status: 'success', learnings: [] },
        importance: 4,
        tags: ['step', 'completed', step.name],
      });
    }

    // Workflow completed successfully
    workflow.status = 'completed';
    workflow.output = stepResults[stepResults.length - 1]?.output;
    workflow.completedAt = Date.now();
    await this.persistWorkflow(workflow);

    await this.storage.recordEpisode({
      type: 'success',
      summary: `Workflow completed: ${workflow.name}`,
      details: JSON.stringify({
        workflowId: workflow.id,
        totalSteps: workflow.steps.length,
        totalDurationMs: Date.now() - startTime,
      }),
      context: { workflowId: workflow.id },
      outcome: { status: 'success', learnings: [] },
      importance: 7,
      tags: ['workflow', 'completed', workflow.name],
    });

    return this.buildWorkflowResult(workflow, stepResults, startTime);
  }

  // ============================================================================
  // Parallel Execution
  // ============================================================================

  /**
   * Execute workflow with parallel step support
   *
   * This method executes steps in parallel when their dependencies are satisfied.
   * Steps without dependencies or with all dependencies completed can run concurrently.
   *
   * The algorithm:
   * 1. Build a dependency graph from step definitions
   * 2. Find all steps whose dependencies are satisfied
   * 3. Execute those steps in parallel
   * 4. Repeat until all steps are completed or a failure occurs
   */
  async executeWorkflowParallel(workflowId: string): Promise<WorkflowExecutionResult> {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const startTime = Date.now();
    const stepResults: StepExecutionResult[] = [];

    // Update workflow status
    workflow.status = 'running';
    workflow.startedAt = workflow.startedAt ?? startTime;
    workflow.updatedAt = startTime;
    await this.persistWorkflow(workflow);

    // Build execution context
    const context: ExecutionContext = {
      workflowId: workflow.id,
      contextId: workflow.contextId,
      previousStepOutputs: new Map(),
      metadata: workflow.metadata,
    };

    // Track step completion status
    const completed = new Set<string>();
    const failed = new Set<string>();
    const waiting = new Set<string>();

    // Restore already completed steps
    for (const step of workflow.steps) {
      if (step.status === 'completed') {
        completed.add(step.id);
        if (step.output !== undefined) {
          context.previousStepOutputs.set(step.id, step.output);
        }
      }
    }

    // Execute until all steps complete, fail, or pause
    while (completed.size + failed.size + waiting.size < workflow.steps.length) {
      // Find ready steps (dependencies met, not yet executed)
      const readySteps = workflow.steps.filter(step => {
        if (completed.has(step.id) || failed.has(step.id) || waiting.has(step.id)) {
          return false;
        }
        return this.areDependenciesMet(step, workflow);
      });

      if (readySteps.length === 0) {
        // No more steps can be executed - check for deadlock
        const remaining = workflow.steps.filter(
          s => !completed.has(s.id) && !failed.has(s.id) && !waiting.has(s.id)
        );
        if (remaining.length > 0) {
          // Steps remain but none are ready - dependency failure
          const error: StepError = {
            code: 'PARALLEL_DEADLOCK',
            message: 'No steps can be executed due to unmet dependencies',
            retryable: false,
          };
          workflow.status = 'failed';
          workflow.error = error;
          workflow.completedAt = Date.now();
          await this.persistWorkflow(workflow);
          return this.buildWorkflowResult(workflow, stepResults, startTime, error);
        }
        break;
      }

      // Execute ready steps in parallel
      const parallelResults = await Promise.all(
        readySteps.map(async step => {
          try {
            return await this.executeStep(step, context);
          } catch (error) {
            return {
              stepId: step.id,
              success: false,
              error: {
                code: 'EXECUTION_ERROR',
                message: error instanceof Error ? error.message : String(error),
                retryable: false,
              },
              durationMs: 0,
              waiting: false,
            } as StepExecutionResult;
          }
        })
      );

      // Process results
      for (let i = 0; i < readySteps.length; i++) {
        const step = readySteps[i];
        const result = parallelResults[i];
        stepResults.push(result);

        // Update step status
        step.output = result.output;
        step.error = result.error;
        step.completedAt = result.waiting ? undefined : Date.now();

        if (result.success && !result.waiting) {
          completed.add(step.id);
          step.status = 'completed';
          if (result.output !== undefined) {
            context.previousStepOutputs.set(step.id, result.output);
          }

          // Record step completion
          await this.storage.recordEpisode({
            type: 'milestone',
            summary: `Step completed (parallel): ${step.name}`,
            details: JSON.stringify({
              stepId: step.id,
              workflowId: workflow.id,
              output: result.output,
              durationMs: result.durationMs,
              completedAt: step.completedAt ?? Date.now(),
              startedAt: step.startedAt,
            } satisfies StepCompletionDetails),
            context: { workflowId: workflow.id, stepId: step.id },
            outcome: { status: 'success', learnings: [] },
            importance: 4,
            tags: ['step', 'completed', 'parallel', step.name],
          });
        } else if (result.waiting) {
          waiting.add(step.id);
          step.status = 'waiting';

          // Pause workflow for HITL
          workflow.status = 'paused';
          workflow.updatedAt = Date.now();
          await this.persistWorkflow(workflow);

          await this.storage.recordEpisode({
            type: 'interaction',
            summary: `Workflow paused (parallel) at step: ${step.name}`,
            details: result.waitingMessage ?? 'Waiting for input',
            context: { workflowId: workflow.id, stepId: step.id },
            importance: 6,
            tags: ['workflow', 'paused', 'parallel', 'hitl'],
          });

          return this.buildWorkflowResult(
            workflow,
            stepResults,
            startTime,
            undefined,
            true,
            workflow.steps.indexOf(step)
          );
        } else {
          failed.add(step.id);
          step.status = 'failed';

          // Record failure
          await this.storage.recordEpisode({
            type: 'error',
            summary: `Step failed (parallel): ${step.name}`,
            details: JSON.stringify(result.error),
            context: { workflowId: workflow.id, stepId: step.id },
            outcome: { status: 'failure', learnings: [] },
            importance: 8,
            tags: ['step', 'failed', 'parallel', step.name],
          });
        }
      }

      workflow.updatedAt = Date.now();
      await this.persistWorkflow(workflow);
    }

    // Determine final status
    if (failed.size > 0) {
      workflow.status = 'failed';
      const failedStep = workflow.steps.find(s => failed.has(s.id));
      workflow.error = failedStep?.error;
      workflow.completedAt = Date.now();
      await this.persistWorkflow(workflow);

      await this.storage.recordEpisode({
        type: 'error',
        summary: `Workflow failed (parallel): ${workflow.name}`,
        details: JSON.stringify({
          workflowId: workflow.id,
          failedSteps: Array.from(failed).length,
          completedSteps: completed.size,
        }),
        context: { workflowId: workflow.id },
        outcome: { status: 'failure', learnings: [] },
        importance: 8,
        tags: ['workflow', 'failed', 'parallel'],
      });

      return this.buildWorkflowResult(workflow, stepResults, startTime, workflow.error);
    }

    // Success
    workflow.status = 'completed';
    workflow.output = stepResults[stepResults.length - 1]?.output;
    workflow.completedAt = Date.now();
    await this.persistWorkflow(workflow);

    await this.storage.recordEpisode({
      type: 'success',
      summary: `Workflow completed (parallel): ${workflow.name}`,
      details: JSON.stringify({
        workflowId: workflow.id,
        totalSteps: workflow.steps.length,
        totalDurationMs: Date.now() - startTime,
        parallelBatches: this.countParallelBatches(workflow),
      }),
      context: { workflowId: workflow.id },
      outcome: { status: 'success', learnings: [] },
      importance: 7,
      tags: ['workflow', 'completed', 'parallel', workflow.name],
    });

    return this.buildWorkflowResult(workflow, stepResults, startTime);
  }

  /**
   * Count the number of parallel execution batches that would be needed
   */
  private countParallelBatches(workflow: DurableWorkflow): number {
    const completedIds = new Set<string>();
    const completedNames = new Set<string>();
    let batches = 0;

    while (completedIds.size < workflow.steps.length) {
      const ready = workflow.steps.filter(step => {
        if (completedIds.has(step.id)) return false;
        if (!step.dependsOn || step.dependsOn.length === 0) return true;
        // Check if dependency is in completed set by ID or name
        return step.dependsOn.every(dep =>
          completedIds.has(dep) || completedNames.has(dep)
        );
      });

      if (ready.length === 0) break;

      for (const step of ready) {
        completedIds.add(step.id);
        completedNames.add(step.name);
      }
      batches++;
    }

    return batches;
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: DurableStep,
    context: ExecutionContext
  ): Promise<StepExecutionResult> {
    const startTime = Date.now();

    // Update step status
    step.status = 'in_progress';
    step.startedAt = startTime;
    step.retryCount = (step.retryCount ?? 0);

    // Persist step start
    await this.storage.setWorkingMemory(
      `step:${step.id}:status`,
      { stepId: step.id, status: 'in_progress', startedAt: startTime },
      'task_state'
    );

    try {
      // Execute using executor if available
      if (this.executor) {
        return await this.executor.execute(step, context);
      }

      // Default execution: just mark as completed
      // In real usage, this would delegate to the appropriate agent
      return {
        stepId: step.id,
        success: true,
        output: { executed: true, agent: step.agent },
        durationMs: Date.now() - startTime,
        waiting: false,
      };
    } catch (error) {
      const stepError: StepError = {
        code: 'EXECUTION_ERROR',
        message: error instanceof Error ? error.message : String(error),
        details: error,
        retryable: step.retryCount < (step.maxRetries ?? this.defaultMaxRetries),
      };

      return {
        stepId: step.id,
        success: false,
        error: stepError,
        durationMs: Date.now() - startTime,
        waiting: false,
      };
    }
  }

  // ============================================================================
  // Resume and Pause
  // ============================================================================

  /**
   * Find the index to resume execution from
   */
  private findResumeIndex(workflow: DurableWorkflow): number {
    // Find the first non-completed step
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      if (step.status !== 'completed') {
        return i;
      }
    }
    return workflow.steps.length; // All steps completed
  }

  /**
   * Resume a paused workflow
   */
  async resumeWorkflow(workflowId: string, input?: unknown): Promise<WorkflowExecutionResult> {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (workflow.status !== 'paused') {
      throw new Error(`Workflow is not paused: ${workflow.status}`);
    }

    // Find the waiting step and provide input
    const waitingStepIndex = workflow.steps.findIndex(s => s.status === 'waiting');
    if (waitingStepIndex >= 0 && input !== undefined) {
      workflow.steps[waitingStepIndex].input = input;
      workflow.steps[waitingStepIndex].status = 'pending'; // Reset to pending for re-execution
    }

    // Continue execution
    return this.executeWorkflow(workflowId);
  }

  /**
   * Pause a running workflow
   */
  async pauseWorkflow(workflowId: string, reason?: string): Promise<void> {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    workflow.status = 'paused';
    workflow.updatedAt = Date.now();

    // Mark current step as waiting
    const currentStep = workflow.steps[workflow.currentStepIndex];
    if (currentStep && currentStep.status === 'in_progress') {
      currentStep.status = 'waiting';
    }

    await this.persistWorkflow(workflow);

    await this.storage.recordEpisode({
      type: 'interaction',
      summary: `Workflow manually paused: ${workflow.name}`,
      details: reason ?? 'Manual pause requested',
      context: { workflowId: workflow.id },
      importance: 5,
      tags: ['workflow', 'paused', 'manual'],
    });
  }

  /**
   * Cancel a workflow
   */
  async cancelWorkflow(workflowId: string, reason?: string): Promise<void> {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    workflow.status = 'cancelled';
    workflow.completedAt = Date.now();
    workflow.updatedAt = Date.now();
    await this.persistWorkflow(workflow);

    await this.storage.recordEpisode({
      type: 'interaction',
      summary: `Workflow cancelled: ${workflow.name}`,
      details: reason ?? 'Workflow was cancelled',
      context: { workflowId: workflow.id },
      importance: 6,
      tags: ['workflow', 'cancelled'],
    });
  }

  // ============================================================================
  // Recovery
  // ============================================================================

  /**
   * Recover workflow state from Episodic Memory (for disaster recovery)
   *
   * This method attempts to reconstruct a workflow from Episodic Memory when
   * the Working Memory data is lost (e.g., after a crash or data corruption).
   *
   * Recovery process:
   * 1. Try Working Memory first (fast path)
   * 2. Search for workflow creation episode
   * 3. Rebuild workflow structure from creation data
   * 4. Search for step completion episodes to restore state
   * 5. Persist recovered workflow to Working Memory
   */
  async recoverWorkflow(workflowId: string): Promise<DurableWorkflow | null> {
    // Try Working Memory first
    const workflowFromMemory = await this.getWorkflow(workflowId);
    if (workflowFromMemory) {
      return workflowFromMemory;
    }

    // Search Episodic Memory for workflow creation event
    const creationEpisodes = await this.storage.searchEpisodes({
      query: workflowId,
      type: 'milestone',
      tags: ['workflow', 'created'],
      limit: 10, // Search more to handle potential duplicates
    });

    // Find the matching creation episode
    const creationEpisode = creationEpisodes.find(ep => {
      try {
        const details = JSON.parse(ep.details);
        return details.workflowId === workflowId;
      } catch {
        return false;
      }
    });

    if (!creationEpisode) {
      return null;
    }

    // Parse workflow from episode details
    try {
      const creationDetails = JSON.parse(creationEpisode.details) as WorkflowCreationDetails;

      // Rebuild workflow structure
      const workflow = this.rebuildWorkflowFromEpisodic(creationDetails);

      // Search for step completion episodes to restore state
      const stepEpisodes = await this.storage.searchEpisodes({
        query: workflowId,
        type: 'milestone',
        tags: ['step', 'completed'],
        limit: 100,
      });

      // Restore step states from completion episodes
      for (const episode of stepEpisodes) {
        try {
          const stepDetails = JSON.parse(episode.details) as StepCompletionDetails;
          if (stepDetails.workflowId === workflowId) {
            this.restoreStepState(workflow, stepDetails);
          }
        } catch {
          // Skip invalid episodes
        }
      }

      // Check for workflow completion episode
      const completionEpisodes = await this.storage.searchEpisodes({
        query: workflowId,
        type: 'success',
        tags: ['workflow', 'completed'],
        limit: 5,
      });

      const completionEpisode = completionEpisodes.find(ep => {
        try {
          const details = JSON.parse(ep.details);
          return details.workflowId === workflowId;
        } catch {
          return false;
        }
      });

      if (completionEpisode) {
        workflow.status = 'completed';
        try {
          const details = JSON.parse(completionEpisode.details);
          workflow.completedAt = details.completedAt || Date.now();
        } catch {
          workflow.completedAt = Date.now();
        }
      }

      // Check for workflow failure episode
      const failureEpisodes = await this.storage.searchEpisodes({
        query: workflowId,
        type: 'error',
        tags: ['workflow', 'failed'],
        limit: 5,
      });

      const failureEpisode = failureEpisodes.find(ep => {
        try {
          const details = JSON.parse(ep.details);
          return details.workflowId === workflowId;
        } catch {
          return false;
        }
      });

      if (failureEpisode) {
        workflow.status = 'failed';
        try {
          const details = JSON.parse(failureEpisode.details);
          workflow.error = details.error;
          workflow.completedAt = details.completedAt || Date.now();
        } catch {
          workflow.completedAt = Date.now();
        }
      }

      // Update currentStepIndex based on completed steps
      workflow.currentStepIndex = workflow.steps.filter(s => s.status === 'completed').length;

      // Persist recovered workflow to Working Memory
      await this.persistWorkflow(workflow);

      // Record recovery in Episodic Memory
      await this.storage.recordEpisode({
        type: 'milestone',
        summary: `Workflow recovered: ${workflow.name}`,
        details: JSON.stringify({
          workflowId: workflow.id,
          recoveredSteps: workflow.steps.filter(s => s.status === 'completed').length,
          totalSteps: workflow.steps.length,
          status: workflow.status,
        }),
        context: { workflowId: workflow.id },
        importance: 6,
        tags: ['workflow', 'recovered'],
      });

      return workflow;
    } catch (error) {
      // Log recovery failure
      console.error('Failed to recover workflow:', workflowId, error);
      return null;
    }
  }

  /**
   * Rebuild workflow structure from creation episode details
   */
  private rebuildWorkflowFromEpisodic(details: WorkflowCreationDetails): DurableWorkflow {
    const steps: DurableStep[] = details.steps.map((stepData) => ({
      id: stepData.id,
      name: stepData.name,
      agent: stepData.agent,
      agentRole: stepData.agentRole as AgentRole | undefined,
      status: 'pending' as StepStatus,
      maxRetries: stepData.maxRetries ?? this.defaultMaxRetries,
      timeout: stepData.timeout ?? this.defaultTimeout,
      dependsOn: stepData.dependsOn,
      retryCount: 0,
    }));

    return {
      id: details.workflowId,
      contextId: details.contextId,
      name: details.name,
      description: details.description,
      steps,
      currentStepIndex: 0,
      status: 'pending',
      input: details.input,
      createdAt: details.createdAt,
      updatedAt: Date.now(),
      metadata: details.metadata,
    };
  }

  /**
   * Restore step state from completion episode details
   */
  private restoreStepState(workflow: DurableWorkflow, stepDetails: StepCompletionDetails): void {
    const step = workflow.steps.find(s => s.id === stepDetails.stepId);
    if (step) {
      step.status = 'completed';
      step.output = stepDetails.output;
      step.completedAt = stepDetails.completedAt;
      step.startedAt = stepDetails.startedAt;
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Build map of previous step outputs
   */
  private buildPreviousOutputsMap(
    workflow: DurableWorkflow,
    upToIndex: number
  ): Map<string, unknown> {
    const outputs = new Map<string, unknown>();

    for (let i = 0; i < upToIndex; i++) {
      const step = workflow.steps[i];
      if (step.status === 'completed' && step.output !== undefined) {
        outputs.set(step.id, step.output);
      }
    }

    return outputs;
  }

  /**
   * Check if step dependencies are met
   * Dependencies can be specified by step ID or step name
   */
  private areDependenciesMet(step: DurableStep, workflow: DurableWorkflow): boolean {
    if (!step.dependsOn || step.dependsOn.length === 0) {
      return true;
    }

    return step.dependsOn.every(depIdOrName => {
      // Match by ID or by name
      const depStep = workflow.steps.find(s => s.id === depIdOrName || s.name === depIdOrName);
      return depStep?.status === 'completed';
    });
  }

  /**
   * Build workflow execution result
   */
  private buildWorkflowResult(
    workflow: DurableWorkflow,
    stepResults: StepExecutionResult[],
    startTime: number,
    error?: StepError,
    paused = false,
    pausedAtStep?: number
  ): WorkflowExecutionResult {
    return {
      workflowId: workflow.id,
      success: workflow.status === 'completed',
      output: workflow.output,
      error,
      durationMs: Date.now() - startTime,
      stepResults,
      paused,
      pausedAtStep,
    };
  }
}

export default WorkflowManager;
