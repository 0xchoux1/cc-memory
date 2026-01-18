/**
 * AgentCoordinator - Multi-Agent Collaboration Manager
 *
 * Coordinates multiple agents using cc-memory's Tachikoma parallelization
 * for memory synchronization and A2A-inspired task delegation patterns.
 *
 * Key Features:
 * - Agent registration and capability management
 * - Task delegation based on agent capabilities
 * - Memory synchronization between agents via Tachikoma
 * - Step execution delegation for durable workflows
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  AgentCard,
  AgentCapability,
  DurableStep,
  DurableTask,
  TaskStatus,
  TaskMessage,
  TaskMessagePart,
  StepExecutionResult,
} from '../durable/types.js';
import type { AgentRole, AgentProfile } from '../memory/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of task delegation
 */
export interface DelegationResult {
  success: boolean;
  taskId: string;
  assignedTo: string;
  error?: string;
}

/**
 * Sync configuration for Tachikoma
 */
export interface SyncConfig {
  syncDir: string;
  autoSync: boolean;
  syncIntervalMs?: number;
}

/**
 * Storage interface for agent coordination
 */
export interface AgentStorage {
  // Agent operations
  registerAgent(profile: Omit<AgentProfile, 'id' | 'createdAt' | 'lastActiveAt'>): Promise<string>;
  getAgent(id: string): Promise<AgentProfile | null>;
  listAgents(filter?: { role?: AgentRole }): Promise<AgentProfile[]>;
  updateAgentActivity(id: string): Promise<void>;

  // Tachikoma operations
  tachikomaInit(config: { name?: string }): Promise<{ id: string; name: string }>;
  tachikomaExport(config: { outputPath?: string; sinceTimestamp?: number }): Promise<unknown>;
  tachikomaImport(config: { data: unknown; strategy?: string; autoResolve?: boolean }): Promise<{
    merged: { working: number; episodic: number };
    conflicts: number;
  }>;
  tachikomaStatus(): Promise<{
    id: string;
    name?: string;
    syncSeq: number;
    lastSyncAt?: number;
  }>;

  // Working Memory for task state
  setWorkingMemory(key: string, value: unknown, type: string): Promise<void>;
  getWorkingMemory(key: string): Promise<unknown | null>;
  listWorkingMemory(filter?: { type?: string; tags?: string[] }): Promise<Array<{ key: string; value: unknown }>>;

  // Episodic Memory for task history
  recordEpisode(episode: {
    type: string;
    summary: string;
    details: string;
    context?: Record<string, unknown>;
    outcome?: { status: string; learnings: string[] };
    importance?: number;
    tags?: string[];
  }): Promise<string>;
}

/**
 * Step executor that delegates to agents
 */
export interface AgentStepExecutor {
  (step: DurableStep, agentId: string, context: unknown): Promise<StepExecutionResult>;
}

// ============================================================================
// AgentCoordinator Class
// ============================================================================

/**
 * Coordinates multi-agent collaboration with memory synchronization
 */
export class AgentCoordinator {
  private storage: AgentStorage;
  private syncConfig?: SyncConfig;
  private stepExecutor?: AgentStepExecutor;
  private agentCards: Map<string, AgentCard> = new Map();
  private pendingTasks: Map<string, DurableTask> = new Map();
  private tachikomaId?: string;
  private tachikomaName?: string;

  constructor(
    storage: AgentStorage,
    syncConfig?: SyncConfig,
    stepExecutor?: AgentStepExecutor
  ) {
    this.storage = storage;
    this.syncConfig = syncConfig;
    this.stepExecutor = stepExecutor;
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the coordinator with Tachikoma
   */
  async initialize(name?: string): Promise<void> {
    const result = await this.storage.tachikomaInit({ name });
    this.tachikomaId = result.id;
    this.tachikomaName = result.name;

    // Load existing agents
    const agents = await this.storage.listAgents();
    for (const agent of agents) {
      this.agentCards.set(agent.id, this.profileToCard(agent));
    }

    // Record initialization
    await this.storage.recordEpisode({
      type: 'milestone',
      summary: `AgentCoordinator initialized: ${this.tachikomaName}`,
      details: JSON.stringify({
        tachikomaId: this.tachikomaId,
        agentCount: this.agentCards.size,
      }),
      importance: 5,
      tags: ['coordinator', 'initialized'],
    });
  }

  /**
   * Get coordinator status
   */
  async getStatus(): Promise<{
    tachikomaId?: string;
    tachikomaName?: string;
    agentCount: number;
    pendingTaskCount: number;
    syncStatus: unknown;
  }> {
    const syncStatus = await this.storage.tachikomaStatus();
    return {
      tachikomaId: this.tachikomaId,
      tachikomaName: this.tachikomaName,
      agentCount: this.agentCards.size,
      pendingTaskCount: this.pendingTasks.size,
      syncStatus,
    };
  }

  // ============================================================================
  // Agent Management
  // ============================================================================

  /**
   * Register a new agent
   */
  async registerAgent(
    name: string,
    role: AgentRole,
    capabilities: AgentCapability[],
    specializations: string[] = [],
    knowledgeDomains: string[] = []
  ): Promise<AgentCard> {
    // Register in storage
    const agentId = await this.storage.registerAgent({
      name,
      role,
      specializations,
      capabilities: capabilities.map(c => c.name),
      knowledgeDomains,
    });

    // Create agent card
    const card: AgentCard = {
      id: agentId,
      name,
      role,
      description: `${role} agent: ${name}`,
      capabilities,
      specializations,
      knowledgeDomains,
      active: true,
      lastActiveAt: Date.now(),
    };

    this.agentCards.set(agentId, card);

    // Record registration
    await this.storage.recordEpisode({
      type: 'milestone',
      summary: `Agent registered: ${name}`,
      details: JSON.stringify({
        agentId,
        role,
        capabilities: capabilities.map(c => c.name),
      }),
      importance: 5,
      tags: ['agent', 'registered', role],
    });

    return card;
  }

  /**
   * Get an agent card by ID (sync, from cache)
   */
  getAgentCard(agentId: string): AgentCard | undefined {
    return this.agentCards.get(agentId);
  }

  /**
   * Get an agent by ID (async, from storage)
   */
  async getAgent(agentId: string): Promise<AgentCard | null> {
    // Check cache first
    const cached = this.agentCards.get(agentId);
    if (cached) return cached;

    // Fetch from storage
    const profile = await this.storage.getAgent(agentId);
    if (!profile) return null;

    const card = this.profileToCard(profile);
    this.agentCards.set(agentId, card);
    return card;
  }

  /**
   * List all agents (sync, from cache)
   */
  listAgents(filter?: { role?: AgentRole; active?: boolean }): AgentCard[] {
    let agents = Array.from(this.agentCards.values());

    if (filter?.role) {
      agents = agents.filter(a => a.role === filter.role);
    }

    if (filter?.active !== undefined) {
      agents = agents.filter(a => a.active === filter.active);
    }

    return agents;
  }

  /**
   * Find best agent for a capability
   */
  findAgentForCapability(capabilityName: string): AgentCard | undefined {
    for (const agent of this.agentCards.values()) {
      if (agent.active) {
        const hasCapability = agent.capabilities.some(
          c => c.name === capabilityName && c.available
        );
        if (hasCapability) {
          return agent;
        }
      }
    }
    return undefined;
  }

  /**
   * Find best agent for a role
   */
  findAgentForRole(role: AgentRole): AgentCard | undefined {
    for (const agent of this.agentCards.values()) {
      if (agent.active && agent.role === role) {
        return agent;
      }
    }
    return undefined;
  }

  /**
   * Convert AgentProfile to AgentCard
   */
  private profileToCard(profile: AgentProfile): AgentCard {
    return {
      id: profile.id,
      name: profile.name,
      role: profile.role,
      description: `${profile.role} agent: ${profile.name}`,
      capabilities: profile.capabilities?.map(c => ({
        name: c,
        description: c,
        available: true,
      })) ?? [],
      specializations: profile.specializations ?? [],
      knowledgeDomains: profile.knowledgeDomains ?? [],
      active: true,
      lastActiveAt: profile.lastActiveAt,
    };
  }

  // ============================================================================
  // Task Delegation (A2A-inspired)
  // ============================================================================

  /**
   * Create a new task
   */
  async createTask(
    summary: string,
    description?: string,
    contextId?: string
  ): Promise<DurableTask> {
    const now = Date.now();
    const task: DurableTask = {
      id: uuidv4(),
      contextId: contextId ?? uuidv4(),
      status: 'submitted',
      summary,
      description,
      createdBy: this.tachikomaId ?? 'unknown',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    this.pendingTasks.set(task.id, task);

    // Persist to working memory
    await this.storage.setWorkingMemory(
      `task:${task.id}`,
      task,
      'task_state'
    );

    return task;
  }

  /**
   * Delegate a task to an agent
   */
  async delegateTask(
    taskId: string,
    agentId: string
  ): Promise<DelegationResult> {
    const task = this.pendingTasks.get(taskId);
    if (!task) {
      return {
        success: false,
        taskId,
        assignedTo: agentId,
        error: 'Task not found',
      };
    }

    const agent = this.agentCards.get(agentId);
    if (!agent) {
      return {
        success: false,
        taskId,
        assignedTo: agentId,
        error: 'Agent not found',
      };
    }

    // Update task
    task.assignedTo = agentId;
    task.delegatedFrom = this.tachikomaId;
    task.status = 'working';
    task.updatedAt = Date.now();

    // Add delegation message
    const message: TaskMessage = {
      id: uuidv4(),
      role: 'agent',
      agentId: this.tachikomaId,
      parts: [
        {
          type: 'text',
          content: `Task delegated to agent: ${agent.name}`,
        },
      ],
      timestamp: Date.now(),
    };
    task.messages.push(message);

    // Persist
    await this.storage.setWorkingMemory(
      `task:${task.id}`,
      task,
      'task_state'
    );

    // Record delegation
    await this.storage.recordEpisode({
      type: 'interaction',
      summary: `Task delegated: ${task.summary}`,
      details: JSON.stringify({
        taskId: task.id,
        assignedTo: agentId,
        agentName: agent.name,
      }),
      context: { taskId: task.id, contextId: task.contextId },
      importance: 4,
      tags: ['task', 'delegated', agent.role],
    });

    return {
      success: true,
      taskId,
      assignedTo: agentId,
    };
  }

  /**
   * Delegate a workflow step to the appropriate agent
   */
  async delegateStep(
    step: DurableStep,
    context: unknown
  ): Promise<StepExecutionResult> {
    const startTime = Date.now();

    // Find agent for this step
    let agent: AgentCard | undefined;

    if (step.agentRole) {
      agent = this.findAgentForRole(step.agentRole);
    }

    if (!agent && step.agent) {
      // Try to find by agent name or ID
      agent = this.agentCards.get(step.agent);
      if (!agent) {
        for (const a of this.agentCards.values()) {
          if (a.name === step.agent) {
            agent = a;
            break;
          }
        }
      }
    }

    if (!agent) {
      return {
        stepId: step.id,
        success: false,
        error: {
          code: 'AGENT_NOT_FOUND',
          message: `No agent found for step: ${step.name}`,
          retryable: false,
        },
        durationMs: Date.now() - startTime,
        waiting: false,
      };
    }

    // Update agent activity
    await this.storage.updateAgentActivity(agent.id);
    agent.lastActiveAt = Date.now();

    // Execute step using executor if available
    if (this.stepExecutor) {
      try {
        const result = await this.stepExecutor(step, agent.id, context);

        // Sync after step execution
        if (this.syncConfig?.autoSync) {
          await this.syncToOtherAgents();
        }

        return result;
      } catch (error) {
        return {
          stepId: step.id,
          success: false,
          error: {
            code: 'EXECUTION_ERROR',
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          },
          durationMs: Date.now() - startTime,
          waiting: false,
        };
      }
    }

    // Default: return success with agent info
    return {
      stepId: step.id,
      success: true,
      output: {
        executed: true,
        agent: agent.name,
        agentId: agent.id,
        role: agent.role,
      },
      durationMs: Date.now() - startTime,
      waiting: false,
    };
  }

  /**
   * Update task status
   */
  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    output?: unknown
  ): Promise<void> {
    const task = this.pendingTasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.status = status;
    task.updatedAt = Date.now();

    if (status === 'completed' || status === 'failed') {
      // Add completion message
      const message: TaskMessage = {
        id: uuidv4(),
        role: 'agent',
        agentId: task.assignedTo,
        parts: [
          {
            type: 'text',
            content: status === 'completed'
              ? 'Task completed successfully'
              : 'Task failed',
          },
          ...(output ? [{
            type: 'data' as const,
            content: JSON.stringify(output),
          }] : []),
        ],
        timestamp: Date.now(),
      };
      task.messages.push(message);

      // Record completion
      await this.storage.recordEpisode({
        type: status === 'completed' ? 'success' : 'error',
        summary: `Task ${status}: ${task.summary}`,
        details: JSON.stringify({ taskId: task.id, output }),
        context: { taskId: task.id, contextId: task.contextId },
        outcome: {
          status: status === 'completed' ? 'success' : 'failure',
          learnings: [],
        },
        importance: 5,
        tags: ['task', status],
      });
    }

    // Persist
    await this.storage.setWorkingMemory(
      `task:${task.id}`,
      task,
      'task_state'
    );
  }

  /**
   * Add a message to a task
   */
  async addTaskMessage(
    taskId: string,
    role: 'user' | 'agent',
    content: string,
    agentId?: string
  ): Promise<void> {
    const task = this.pendingTasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const message: TaskMessage = {
      id: uuidv4(),
      role,
      agentId,
      parts: [{ type: 'text', content }],
      timestamp: Date.now(),
    };

    task.messages.push(message);
    task.updatedAt = Date.now();

    // Persist
    await this.storage.setWorkingMemory(
      `task:${task.id}`,
      task,
      'task_state'
    );
  }

  // ============================================================================
  // Memory Synchronization
  // ============================================================================

  /**
   * Sync memories to other agents via Tachikoma
   */
  async syncToOtherAgents(outputPath?: string): Promise<unknown> {
    const path = outputPath ?? this.syncConfig?.syncDir;
    if (!path) {
      throw new Error('No sync path configured');
    }

    const exportPath = `${path}/${this.tachikomaName ?? this.tachikomaId}-export.json`;
    const exportData = await this.storage.tachikomaExport({ outputPath: exportPath });

    await this.storage.recordEpisode({
      type: 'interaction',
      summary: 'Memory exported for sync',
      details: JSON.stringify({ path: exportPath }),
      importance: 3,
      tags: ['sync', 'export'],
    });

    return exportData;
  }

  /**
   * Import memories from another agent
   */
  async importFromAgent(
    data: unknown,
    strategy: string = 'merge_learnings'
  ): Promise<{ merged: { working: number; episodic: number }; conflicts: number }> {
    const result = await this.storage.tachikomaImport({
      data,
      strategy,
      autoResolve: true,
    });

    await this.storage.recordEpisode({
      type: 'interaction',
      summary: 'Memory imported from other agent',
      details: JSON.stringify(result),
      importance: 4,
      tags: ['sync', 'import'],
    });

    return result;
  }

  /**
   * Sync with a specific directory (import all files)
   *
   * This method reads all .json files from the sync directory,
   * validates the Tachikoma delta format, and imports them.
   * Processed files are renamed to .imported.json to prevent reprocessing.
   */
  async syncFromDirectory(syncDir?: string): Promise<{
    filesProcessed: number;
    itemsImported: { working: number; episodic: number };
    conflicts: number;
    errors: string[];
  }> {
    const dir = syncDir ?? this.syncConfig?.syncDir;
    if (!dir) {
      throw new Error('No sync directory configured');
    }

    const { existsSync, readdirSync, readFileSync, renameSync } = await import('fs');
    const { join } = await import('path');

    const result = {
      filesProcessed: 0,
      itemsImported: { working: 0, episodic: 0 },
      conflicts: 0,
      errors: [] as string[],
    };

    if (!existsSync(dir)) {
      return result;
    }

    // Find all .json files (excluding .imported files)
    let files: string[];
    try {
      files = readdirSync(dir)
        .filter(f => f.endsWith('.json') && !f.endsWith('.imported.json'));
    } catch (error) {
      result.errors.push(`Failed to read directory: ${(error as Error).message}`);
      return result;
    }

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);

        // Validate format
        if (data.format !== 'tachikoma-parallelize-delta') {
          result.errors.push(`Skipping ${file}: invalid format`);
          continue;
        }

        // Skip self-exports
        if (this.tachikomaId && data.tachikomaId === this.tachikomaId) {
          this.markAsImported(filePath, renameSync);
          continue;
        }

        // Import the data
        const importResult = await this.importFromAgent(data);
        result.itemsImported.working += importResult.merged.working;
        result.itemsImported.episodic += importResult.merged.episodic;
        result.conflicts += importResult.conflicts;

        // Mark as imported
        this.markAsImported(filePath, renameSync);
        result.filesProcessed++;
      } catch (error) {
        result.errors.push(`Error processing ${file}: ${(error as Error).message}`);
      }
    }

    // Record sync operation
    if (result.filesProcessed > 0) {
      await this.storage.recordEpisode({
        type: 'interaction',
        summary: `Synced from directory: ${result.filesProcessed} files`,
        details: JSON.stringify({
          directory: dir,
          ...result,
        }),
        importance: 4,
        tags: ['sync', 'import', 'directory'],
      });
    }

    return result;
  }

  /**
   * Mark a file as imported by renaming to .imported.json
   */
  private markAsImported(
    filePath: string,
    renameFn: (oldPath: string, newPath: string) => void
  ): void {
    try {
      renameFn(filePath, filePath.replace('.json', '.imported.json'));
    } catch (error) {
      console.error(`Failed to mark as imported: ${filePath}`, error);
    }
  }
}

export default AgentCoordinator;
