/**
 * Durable Workflow HTTP API Routes
 *
 * Provides HTTP endpoints for workflow execution and agent coordination.
 *
 * Endpoints:
 * - POST   /api/durable/workflows              # Create workflow
 * - GET    /api/durable/workflows              # List workflows
 * - GET    /api/durable/workflows/:id          # Get workflow
 * - POST   /api/durable/workflows/:id/execute  # Execute workflow
 * - POST   /api/durable/workflows/:id/resume   # Resume paused workflow
 * - POST   /api/durable/workflows/:id/pause    # Pause workflow
 * - POST   /api/durable/workflows/:id/cancel   # Cancel workflow
 * - POST   /api/durable/agents                 # Register agent
 * - GET    /api/durable/agents                 # List agents
 * - GET    /api/durable/agents/:id             # Get agent
 * - POST   /api/durable/tasks                  # Create task
 * - POST   /api/durable/tasks/:id/delegate     # Delegate task
 * - GET    /api/durable/status                 # Get coordinator status
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { WorkflowManager } from '../../../durable/WorkflowManager.js';
import type { AgentCoordinator } from '../../../agents/AgentCoordinator.js';
import type { WorkflowDefinition, WorkflowMetadata, AgentCapability } from '../../../durable/types.js';
import type { AgentRole } from '../../../memory/types.js';

export interface DurableRouterOptions {
  workflowManager: WorkflowManager;
  agentCoordinator: AgentCoordinator;
}

// Helper to extract string from param (handles express type)
function getParam(params: Request['params'], name: string): string {
  const value = params[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Creates Express router for durable workflow endpoints
 */
export function createDurableRouter(options: DurableRouterOptions): Router {
  const { workflowManager, agentCoordinator } = options;
  const router = Router();

  // Error handler wrapper
  const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
    return (req: Request, res: Response, next: NextFunction) => {
      fn(req, res, next).catch(next);
    };
  };

  // ============================================================================
  // Workflow Routes
  // ============================================================================

  /**
   * POST /api/durable/workflows
   * Create a new workflow
   */
  router.post('/workflows', asyncHandler(async (req, res) => {
    const { definition, input, metadata } = req.body as {
      definition: WorkflowDefinition;
      input?: Record<string, unknown>;
      metadata?: WorkflowMetadata;
    };

    if (!definition || !definition.name || !definition.steps) {
      res.status(400).json({
        error: 'bad_request',
        message: 'definition with name and steps is required',
      });
      return;
    }

    const workflow = await workflowManager.createWorkflow(definition, input, metadata);

    res.status(201).json({
      id: workflow.id,
      contextId: workflow.contextId,
      name: workflow.name,
      status: workflow.status,
      stepCount: workflow.steps.length,
      createdAt: workflow.createdAt,
    });
  }));

  /**
   * GET /api/durable/workflows
   * List all workflows
   */
  router.get('/workflows', asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const limitStr = req.query.limit as string | undefined;
    const limit = limitStr ? parseInt(limitStr, 10) : 20;

    const workflows = await workflowManager.listWorkflows({
      status: status as 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled',
      limit,
    });

    res.json({
      workflows: workflows.map(w => ({
        id: w.id,
        contextId: w.contextId,
        name: w.name,
        status: w.status,
        stepCount: w.steps.length,
        currentStepIndex: w.currentStepIndex,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      })),
      count: workflows.length,
    });
  }));

  /**
   * GET /api/durable/workflows/:id
   * Get workflow details
   */
  router.get('/workflows/:id', asyncHandler(async (req, res) => {
    const id = getParam(req.params, 'id');
    const workflow = await workflowManager.getWorkflow(id);

    if (!workflow) {
      res.status(404).json({
        error: 'not_found',
        message: `Workflow not found: ${id}`,
      });
      return;
    }

    res.json({
      id: workflow.id,
      contextId: workflow.contextId,
      name: workflow.name,
      description: workflow.description,
      status: workflow.status,
      input: workflow.input,
      output: workflow.output,
      error: workflow.error,
      metadata: workflow.metadata,
      steps: workflow.steps.map(s => ({
        id: s.id,
        name: s.name,
        agent: s.agent,
        agentRole: s.agentRole,
        status: s.status,
        dependsOn: s.dependsOn,
        output: s.output,
        error: s.error,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      })),
      currentStepIndex: workflow.currentStepIndex,
      createdAt: workflow.createdAt,
      startedAt: workflow.startedAt,
      completedAt: workflow.completedAt,
      updatedAt: workflow.updatedAt,
    });
  }));

  /**
   * POST /api/durable/workflows/:id/execute
   * Execute a workflow
   */
  router.post('/workflows/:id/execute', asyncHandler(async (req, res) => {
    const id = getParam(req.params, 'id');
    const { parallel } = req.body as { parallel?: boolean };

    const workflow = await workflowManager.getWorkflow(id);
    if (!workflow) {
      res.status(404).json({
        error: 'not_found',
        message: `Workflow not found: ${id}`,
      });
      return;
    }

    if (workflow.status !== 'pending' && workflow.status !== 'paused') {
      res.status(400).json({
        error: 'bad_request',
        message: `Cannot execute workflow in ${workflow.status} status`,
      });
      return;
    }

    const result = parallel
      ? await workflowManager.executeWorkflowParallel(id)
      : await workflowManager.executeWorkflow(id);

    res.json({
      workflowId: result.workflowId,
      success: result.success,
      output: result.output,
      error: result.error,
      durationMs: result.durationMs,
      stepResults: result.stepResults.map(sr => ({
        stepId: sr.stepId,
        success: sr.success,
        output: sr.output,
        error: sr.error,
        durationMs: sr.durationMs,
        waiting: sr.waiting,
      })),
      paused: result.paused,
      pausedAtStep: result.pausedAtStep,
    });
  }));

  /**
   * POST /api/durable/workflows/:id/resume
   * Resume a paused workflow
   */
  router.post('/workflows/:id/resume', asyncHandler(async (req, res) => {
    const id = getParam(req.params, 'id');
    const { stepInput } = req.body as { stepInput?: unknown };

    const workflow = await workflowManager.getWorkflow(id);
    if (!workflow) {
      res.status(404).json({
        error: 'not_found',
        message: `Workflow not found: ${id}`,
      });
      return;
    }

    if (workflow.status !== 'paused') {
      res.status(400).json({
        error: 'bad_request',
        message: `Cannot resume workflow in ${workflow.status} status`,
      });
      return;
    }

    const result = await workflowManager.resumeWorkflow(id, stepInput);

    res.json({
      workflowId: result.workflowId,
      success: result.success,
      output: result.output,
      error: result.error,
      durationMs: result.durationMs,
      paused: result.paused,
      pausedAtStep: result.pausedAtStep,
    });
  }));

  /**
   * POST /api/durable/workflows/:id/pause
   * Pause a running workflow
   */
  router.post('/workflows/:id/pause', asyncHandler(async (req, res) => {
    const id = getParam(req.params, 'id');

    const workflow = await workflowManager.getWorkflow(id);
    if (!workflow) {
      res.status(404).json({
        error: 'not_found',
        message: `Workflow not found: ${id}`,
      });
      return;
    }

    if (workflow.status !== 'running') {
      res.status(400).json({
        error: 'bad_request',
        message: `Cannot pause workflow in ${workflow.status} status`,
      });
      return;
    }

    await workflowManager.pauseWorkflow(id);
    const updated = await workflowManager.getWorkflow(id);

    res.json({
      id: updated!.id,
      status: updated!.status,
      pausedAt: updated!.updatedAt,
    });
  }));

  /**
   * POST /api/durable/workflows/:id/cancel
   * Cancel a workflow
   */
  router.post('/workflows/:id/cancel', asyncHandler(async (req, res) => {
    const id = getParam(req.params, 'id');
    const { reason } = req.body as { reason?: string };

    const workflow = await workflowManager.getWorkflow(id);
    if (!workflow) {
      res.status(404).json({
        error: 'not_found',
        message: `Workflow not found: ${id}`,
      });
      return;
    }

    if (workflow.status === 'completed' || workflow.status === 'cancelled' || workflow.status === 'failed') {
      res.status(400).json({
        error: 'bad_request',
        message: `Cannot cancel workflow in ${workflow.status} status`,
      });
      return;
    }

    await workflowManager.cancelWorkflow(id, reason);
    const updated = await workflowManager.getWorkflow(id);

    res.json({
      id: updated!.id,
      status: updated!.status,
      cancelledAt: updated!.completedAt,
    });
  }));

  // ============================================================================
  // Agent Routes
  // ============================================================================

  /**
   * POST /api/durable/agents
   * Register a new agent
   */
  router.post('/agents', asyncHandler(async (req, res) => {
    const { name, role, capabilities, specializations, knowledgeDomains } = req.body as {
      name: string;
      role: AgentRole;
      capabilities?: Array<{ name: string; description: string; available?: boolean }>;
      specializations?: string[];
      knowledgeDomains?: string[];
    };

    if (!name || !role) {
      res.status(400).json({
        error: 'bad_request',
        message: 'name and role are required',
      });
      return;
    }

    // Ensure capabilities have required 'available' field
    const normalizedCapabilities: AgentCapability[] = (capabilities ?? []).map(c => ({
      name: c.name,
      description: c.description,
      available: c.available ?? true,
    }));

    const agent = await agentCoordinator.registerAgent(
      name,
      role,
      normalizedCapabilities,
      specializations,
      knowledgeDomains
    );

    res.status(201).json({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      description: agent.description,
      capabilities: agent.capabilities,
      lastActiveAt: agent.lastActiveAt,
    });
  }));

  /**
   * GET /api/durable/agents
   * List all agents
   */
  router.get('/agents', asyncHandler(async (req, res) => {
    const role = req.query.role as AgentRole | undefined;
    // listAgents is synchronous but we wrap in async handler for consistency
    const agents = agentCoordinator.listAgents(role ? { role } : undefined);

    res.json({
      agents: agents.map(a => ({
        id: a.id,
        name: a.name,
        role: a.role,
        description: a.description,
        capabilities: a.capabilities,
        active: a.active,
        lastActiveAt: a.lastActiveAt,
      })),
      count: agents.length,
    });
  }));

  /**
   * GET /api/durable/agents/:id
   * Get agent details
   */
  router.get('/agents/:id', asyncHandler(async (req, res) => {
    const id = getParam(req.params, 'id');
    const agent = await agentCoordinator.getAgent(id);

    if (!agent) {
      res.status(404).json({
        error: 'not_found',
        message: `Agent not found: ${id}`,
      });
      return;
    }

    res.json(agent);
  }));

  // ============================================================================
  // Task Routes
  // ============================================================================

  /**
   * POST /api/durable/tasks
   * Create a new task
   */
  router.post('/tasks', asyncHandler(async (req, res) => {
    const { summary, description, contextId } = req.body as {
      summary: string;
      description?: string;
      contextId?: string;
    };

    if (!summary) {
      res.status(400).json({
        error: 'bad_request',
        message: 'summary is required',
      });
      return;
    }

    const task = await agentCoordinator.createTask(summary, description, contextId);

    res.status(201).json({
      id: task.id,
      contextId: task.contextId,
      summary: task.summary,
      status: task.status,
      createdBy: task.createdBy,
      createdAt: task.createdAt,
    });
  }));

  /**
   * POST /api/durable/tasks/:id/delegate
   * Delegate task to an agent
   */
  router.post('/tasks/:id/delegate', asyncHandler(async (req, res) => {
    const id = getParam(req.params, 'id');
    const { agentId } = req.body as {
      agentId: string;
    };

    if (!agentId) {
      res.status(400).json({
        error: 'bad_request',
        message: 'agentId is required',
      });
      return;
    }

    const result = await agentCoordinator.delegateTask(id, agentId);

    res.json({
      success: result.success,
      taskId: id,
      assignedTo: result.assignedTo,
      error: result.error,
    });
  }));

  // ============================================================================
  // Status Route
  // ============================================================================

  /**
   * GET /api/durable/status
   * Get coordinator status
   */
  router.get('/status', asyncHandler(async (_req, res) => {
    const status = await agentCoordinator.getStatus();

    res.json({
      tachikomaId: status.tachikomaId,
      tachikomaName: status.tachikomaName,
      agentCount: status.agentCount,
      pendingTaskCount: status.pendingTaskCount,
      syncStatus: status.syncStatus,
    });
  }));

  return router;
}

export default createDurableRouter;
