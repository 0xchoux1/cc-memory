/**
 * ScopedMemoryManager - Permission-aware memory access wrapper
 * Provides scoped access to private and shared memory with audit logging
 */

import type { MemoryManager } from './MemoryManager.js';
import { SharedMemoryManager, type SharedMemoryItem, type SharedMemoryFilter, type SetOptions } from './SharedMemoryManager.js';
import type { AuditLogger } from '../audit/AuditLogger.js';
import { permissionValidator, canAccessAgentMemory, canWriteAgentMemory, canAccessSharedMemory } from '../server/http/auth/permissionValidator.js';
import type { PermissionLevel, AuthInfo } from '../server/http/auth/types.js';
import { hasScope } from '../server/http/auth/types.js';
import type {
  WorkingMemoryItem,
  WorkingMemoryFilter,
  EpisodicMemory,
  EpisodeQuery,
  SemanticEntity,
  SemanticQuery,
  MemoryExport,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for ScopedMemoryManager
 */
export interface ScopedMemoryConfig {
  clientId: string;
  permissionLevel: PermissionLevel;
  scopes: string[];
  team?: string;
  managedAgents?: string[];
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  success: boolean;
  merged: {
    working: number;
    episodic: number;
    semantic: number;
  };
  conflicts: number;
  errors: string[];
}

/**
 * Options for cross-agent memory access
 */
export interface CrossAgentOptions {
  agentId: string;
  reason?: string;
}

// ============================================================================
// ScopedMemoryManager
// ============================================================================

/**
 * ScopedMemoryManager - Provides permission-controlled access to memory
 */
export class ScopedMemoryManager {
  private config: ScopedMemoryConfig;
  private privateMemory: MemoryManager;
  private sharedPool: SharedMemoryManager;
  private auditLog: AuditLogger;

  // Cache of agent memory managers for cross-agent access
  private agentMemoryCache: Map<string, MemoryManager> = new Map();

  constructor(
    config: ScopedMemoryConfig,
    privateMemory: MemoryManager,
    sharedPool: SharedMemoryManager,
    auditLog: AuditLogger
  ) {
    this.config = config;
    this.privateMemory = privateMemory;
    this.sharedPool = sharedPool;
    this.auditLog = auditLog;

    // Register managed agents in permission validator
    if (config.managedAgents) {
      permissionValidator.registerManagedAgents(config.clientId, config.managedAgents);
    }
  }

  /**
   * Create an AuthInfo object from config
   */
  private getAuthInfo(): AuthInfo {
    return {
      token: '',
      clientId: this.config.clientId,
      scopes: this.config.scopes,
      permissionLevel: this.config.permissionLevel,
      team: this.config.team,
      managedAgents: this.config.managedAgents,
    };
  }

  // ============================================================================
  // Private Memory Access (always allowed for own data)
  // ============================================================================

  /**
   * Get an item from private working memory
   */
  async getPrivate(key: string): Promise<WorkingMemoryItem | null> {
    const item = this.privateMemory.working.get(key);

    await this.auditLog.log({
      actor: this.config.clientId,
      actorPermissionLevel: this.config.permissionLevel,
      action: 'read',
      resource: `working:${key}`,
      resourceType: 'working_memory',
      result: item ? 'success' : 'success', // Not finding is not an error
      team: this.config.team,
    });

    return item;
  }

  /**
   * Set an item in private working memory
   */
  async setPrivate(key: string, value: unknown, options?: {
    type?: 'task_state' | 'decision' | 'context' | 'scratch';
    ttl?: number;
    priority?: 'high' | 'medium' | 'low';
    tags?: string[];
  }): Promise<WorkingMemoryItem> {
    if (!hasScope(this.config.scopes, 'memory:write') && !hasScope(this.config.scopes, 'memory:*')) {
      await this.auditLog.log({
        actor: this.config.clientId,
        actorPermissionLevel: this.config.permissionLevel,
        action: 'write',
        resource: `working:${key}`,
        resourceType: 'working_memory',
        result: 'denied',
        reason: 'Missing memory:write scope',
        team: this.config.team,
      });
      throw new Error('Permission denied: missing memory:write scope');
    }

    const item = this.privateMemory.working.set({
      key,
      value,
      type: options?.type,
      ttl: options?.ttl,
      priority: options?.priority,
      tags: options?.tags,
    });

    await this.auditLog.log({
      actor: this.config.clientId,
      actorPermissionLevel: this.config.permissionLevel,
      action: 'write',
      resource: `working:${key}`,
      resourceType: 'working_memory',
      result: 'success',
      team: this.config.team,
    });

    return item;
  }

  /**
   * Delete an item from private working memory
   */
  async deletePrivate(key: string): Promise<boolean> {
    if (!hasScope(this.config.scopes, 'memory:write') && !hasScope(this.config.scopes, 'memory:*')) {
      await this.auditLog.log({
        actor: this.config.clientId,
        actorPermissionLevel: this.config.permissionLevel,
        action: 'delete',
        resource: `working:${key}`,
        resourceType: 'working_memory',
        result: 'denied',
        reason: 'Missing memory:write scope',
        team: this.config.team,
      });
      throw new Error('Permission denied: missing memory:write scope');
    }

    const deleted = this.privateMemory.working.delete(key);

    await this.auditLog.log({
      actor: this.config.clientId,
      actorPermissionLevel: this.config.permissionLevel,
      action: 'delete',
      resource: `working:${key}`,
      resourceType: 'working_memory',
      result: 'success',
      team: this.config.team,
    });

    return deleted;
  }

  /**
   * List private working memory items
   */
  async listPrivate(filter?: WorkingMemoryFilter): Promise<WorkingMemoryItem[]> {
    return this.privateMemory.working.list(filter);
  }

  // ============================================================================
  // Episodic Memory Access
  // ============================================================================

  /**
   * Get an episode by ID
   */
  async getEpisode(id: string): Promise<EpisodicMemory | null> {
    const episode = this.privateMemory.episodic.get(id);

    await this.auditLog.log({
      actor: this.config.clientId,
      actorPermissionLevel: this.config.permissionLevel,
      action: 'read',
      resource: `episodic:${id}`,
      resourceType: 'episodic_memory',
      result: 'success',
      team: this.config.team,
    });

    return episode;
  }

  /**
   * Search episodes
   */
  async searchEpisodes(query: EpisodeQuery): Promise<EpisodicMemory[]> {
    return this.privateMemory.episodic.search(query);
  }

  // ============================================================================
  // Semantic Memory Access
  // ============================================================================

  /**
   * Get a semantic entity by ID or name
   */
  async getEntity(identifier: string): Promise<SemanticEntity | null> {
    const entity = this.privateMemory.semantic.get(identifier);

    await this.auditLog.log({
      actor: this.config.clientId,
      actorPermissionLevel: this.config.permissionLevel,
      action: 'read',
      resource: `semantic:${identifier}`,
      resourceType: 'semantic_memory',
      result: 'success',
      team: this.config.team,
    });

    return entity;
  }

  /**
   * Search semantic entities
   */
  async searchEntities(query: SemanticQuery): Promise<SemanticEntity[]> {
    return this.privateMemory.semantic.search(query);
  }

  // ============================================================================
  // Shared Pool Access (scope-controlled)
  // ============================================================================

  /**
   * Get an item from the shared memory pool
   */
  async getShared(key: string): Promise<SharedMemoryItem | null> {
    const auth = this.getAuthInfo();

    if (!canAccessSharedMemory(auth, 'read')) {
      await this.auditLog.log({
        actor: this.config.clientId,
        actorPermissionLevel: this.config.permissionLevel,
        action: 'read',
        resource: `shared:${key}`,
        resourceType: 'shared_memory',
        result: 'denied',
        reason: 'Missing memory:share:read scope',
        team: this.config.team,
      });
      throw new Error('Permission denied: missing memory:share:read scope');
    }

    const namespace = this.getSharedNamespace();
    const item = await this.sharedPool.get(namespace, key, this.config.clientId, this.config.team);

    await this.auditLog.log({
      actor: this.config.clientId,
      actorPermissionLevel: this.config.permissionLevel,
      action: 'shared_memory_access',
      resource: `shared:${namespace}:${key}`,
      resourceType: 'shared_memory',
      result: 'success',
      team: this.config.team,
    });

    return item;
  }

  /**
   * Set an item in the shared memory pool
   */
  async setShared(key: string, value: unknown, options?: SetOptions): Promise<SharedMemoryItem> {
    const auth = this.getAuthInfo();

    if (!canAccessSharedMemory(auth, 'write')) {
      await this.auditLog.log({
        actor: this.config.clientId,
        actorPermissionLevel: this.config.permissionLevel,
        action: 'write',
        resource: `shared:${key}`,
        resourceType: 'shared_memory',
        result: 'denied',
        reason: 'Missing memory:share:write scope',
        team: this.config.team,
      });
      throw new Error('Permission denied: missing memory:share:write scope');
    }

    const namespace = this.getSharedNamespace();

    // Adjust visibility based on permission level
    const effectiveOptions = { ...options };
    if (this.config.permissionLevel !== 'manager' && options?.visibility?.includes('*')) {
      // Non-managers can't set global visibility
      effectiveOptions.visibility = this.config.team ? [`team:${this.config.team}`] : [this.config.clientId];
    }

    const item = await this.sharedPool.set(namespace, key, value, this.config.clientId, effectiveOptions);

    await this.auditLog.log({
      actor: this.config.clientId,
      actorPermissionLevel: this.config.permissionLevel,
      action: 'write',
      resource: `shared:${namespace}:${key}`,
      resourceType: 'shared_memory',
      result: 'success',
      team: this.config.team,
      metadata: { visibility: item.visibility },
    });

    return item;
  }

  /**
   * Delete an item from the shared memory pool
   */
  async deleteShared(key: string): Promise<boolean> {
    const auth = this.getAuthInfo();

    if (!canAccessSharedMemory(auth, 'write')) {
      await this.auditLog.log({
        actor: this.config.clientId,
        actorPermissionLevel: this.config.permissionLevel,
        action: 'delete',
        resource: `shared:${key}`,
        resourceType: 'shared_memory',
        result: 'denied',
        reason: 'Missing memory:share:write scope',
        team: this.config.team,
      });
      throw new Error('Permission denied: missing memory:share:write scope');
    }

    const namespace = this.getSharedNamespace();
    const isManager = this.config.permissionLevel === 'manager';
    const deleted = await this.sharedPool.delete(namespace, key, this.config.clientId, isManager);

    await this.auditLog.log({
      actor: this.config.clientId,
      actorPermissionLevel: this.config.permissionLevel,
      action: 'delete',
      resource: `shared:${namespace}:${key}`,
      resourceType: 'shared_memory',
      result: deleted ? 'success' : 'error',
      reason: deleted ? undefined : 'Item not found or permission denied',
      team: this.config.team,
    });

    return deleted;
  }

  /**
   * List items in the shared memory pool
   */
  async listShared(filter?: SharedMemoryFilter): Promise<SharedMemoryItem[]> {
    const auth = this.getAuthInfo();

    if (!canAccessSharedMemory(auth, 'read')) {
      throw new Error('Permission denied: missing memory:share:read scope');
    }

    const namespace = this.getSharedNamespace();
    return this.sharedPool.list(namespace, this.config.clientId, this.config.team, filter);
  }

  /**
   * Search in the shared memory pool
   */
  async searchShared(query: string, limit?: number): Promise<SharedMemoryItem[]> {
    const auth = this.getAuthInfo();

    if (!canAccessSharedMemory(auth, 'read')) {
      throw new Error('Permission denied: missing memory:share:read scope');
    }

    const namespace = this.getSharedNamespace();
    return this.sharedPool.search(namespace, query, this.config.clientId, this.config.team, limit);
  }

  /**
   * Get the shared namespace for this agent's team
   */
  private getSharedNamespace(): string {
    return this.config.team ? `team:${this.config.team}` : `agent:${this.config.clientId}`;
  }

  // ============================================================================
  // Cross-Agent Memory Access (manager only)
  // ============================================================================

  /**
   * Get working memory from another agent (manager only)
   */
  async getAgentMemory(agentId: string, key: string): Promise<WorkingMemoryItem | null> {
    const auth = this.getAuthInfo();

    if (!canAccessAgentMemory(auth, agentId)) {
      await this.auditLog.log({
        actor: this.config.clientId,
        actorPermissionLevel: this.config.permissionLevel,
        action: 'cross_agent_access',
        resource: `working:${key}`,
        resourceType: 'agent_memory',
        target: agentId,
        result: 'denied',
        reason: `Cannot access agent ${agentId} memory`,
        team: this.config.team,
      });
      throw new Error(`Permission denied: cannot access agent ${agentId} memory`);
    }

    // Get agent's memory manager
    const agentMemory = this.getAgentMemoryManager(agentId);
    if (!agentMemory) {
      throw new Error(`Agent ${agentId} memory not available`);
    }

    const item = agentMemory.working.get(key);

    await this.auditLog.log({
      actor: this.config.clientId,
      actorPermissionLevel: this.config.permissionLevel,
      action: 'cross_agent_access',
      resource: `working:${key}`,
      resourceType: 'agent_memory',
      target: agentId,
      result: 'success',
      team: this.config.team,
    });

    return item;
  }

  /**
   * Sync data to another agent (manager only)
   */
  async syncToAgent(agentId: string, data: MemoryExport): Promise<SyncResult> {
    const auth = this.getAuthInfo();

    if (!canWriteAgentMemory(auth, agentId)) {
      await this.auditLog.log({
        actor: this.config.clientId,
        actorPermissionLevel: this.config.permissionLevel,
        action: 'sync',
        resource: 'memory_export',
        resourceType: 'agent_memory',
        target: agentId,
        result: 'denied',
        reason: `Cannot write to agent ${agentId} memory`,
        team: this.config.team,
      });
      throw new Error(`Permission denied: cannot write to agent ${agentId} memory`);
    }

    // Get agent's memory manager
    const agentMemory = this.getAgentMemoryManager(agentId);
    if (!agentMemory) {
      return {
        success: false,
        merged: { working: 0, episodic: 0, semantic: 0 },
        conflicts: 0,
        errors: [`Agent ${agentId} memory not available`],
      };
    }

    const errors: string[] = [];
    let workingMerged = 0;
    let episodicMerged = 0;
    let semanticMerged = 0;

    // Import working memory
    for (const item of data.working) {
      try {
        agentMemory.working.set({
          key: item.key,
          value: item.value,
          type: item.type,
          priority: item.metadata.priority,
          tags: item.tags,
        });
        workingMerged++;
      } catch (e) {
        errors.push(`Working memory ${item.key}: ${e}`);
      }
    }

    // Import episodic memory
    for (const episode of data.episodic) {
      try {
        agentMemory.episodic.record({
          type: episode.type,
          summary: episode.summary,
          details: episode.details,
          context: episode.context,
          outcome: episode.outcome,
          importance: episode.importance,
          tags: episode.tags,
        });
        episodicMerged++;
      } catch (e) {
        errors.push(`Episodic ${episode.id}: ${e}`);
      }
    }

    // Import semantic entities
    for (const entity of data.semantic.entities) {
      try {
        agentMemory.semantic.create({
          name: entity.name,
          type: entity.type,
          description: entity.description,
          content: entity.content,
          procedure: entity.procedure,
          observations: entity.observations,
          confidence: entity.confidence,
          tags: entity.tags,
        });
        semanticMerged++;
      } catch (e) {
        errors.push(`Semantic ${entity.name}: ${e}`);
      }
    }

    await this.auditLog.log({
      actor: this.config.clientId,
      actorPermissionLevel: this.config.permissionLevel,
      action: 'sync',
      resource: 'memory_export',
      resourceType: 'agent_memory',
      target: agentId,
      result: errors.length === 0 ? 'success' : 'error',
      team: this.config.team,
      metadata: {
        workingMerged,
        episodicMerged,
        semanticMerged,
        errorCount: errors.length,
      },
    });

    return {
      success: errors.length === 0,
      merged: {
        working: workingMerged,
        episodic: episodicMerged,
        semantic: semanticMerged,
      },
      conflicts: 0,
      errors,
    };
  }

  /**
   * Register an agent's memory manager for cross-agent access
   */
  registerAgentMemory(agentId: string, memory: MemoryManager): void {
    this.agentMemoryCache.set(agentId, memory);
  }

  /**
   * Unregister an agent's memory manager
   */
  unregisterAgentMemory(agentId: string): void {
    this.agentMemoryCache.delete(agentId);
  }

  /**
   * Get an agent's memory manager
   */
  private getAgentMemoryManager(agentId: string): MemoryManager | undefined {
    return this.agentMemoryCache.get(agentId);
  }

  // ============================================================================
  // Recall Across All Memory Layers
  // ============================================================================

  /**
   * Recall from all accessible memory (private + shared)
   */
  async recall(query: string, options?: {
    includePrivate?: boolean;
    includeShared?: boolean;
    limit?: number;
  }): Promise<{
    private: Array<{ type: 'working' | 'episodic' | 'semantic'; item: unknown }>;
    shared: SharedMemoryItem[];
  }> {
    const includePrivate = options?.includePrivate !== false;
    const includeShared = options?.includeShared !== false;
    const limit = options?.limit ?? 10;

    const privateResults: Array<{ type: 'working' | 'episodic' | 'semantic'; item: unknown }> = [];
    let sharedResults: SharedMemoryItem[] = [];

    if (includePrivate) {
      const recallResults = await this.privateMemory.recall(query, {
        includeWorking: true,
        includeEpisodic: true,
        includeSemantic: true,
        limit,
      });

      for (const result of recallResults.working) {
        privateResults.push({ type: 'working', item: result });
      }
      for (const result of recallResults.episodic) {
        privateResults.push({ type: 'episodic', item: result });
      }
      for (const result of recallResults.semantic) {
        privateResults.push({ type: 'semantic', item: result });
      }
    }

    if (includeShared && canAccessSharedMemory(this.getAuthInfo(), 'read')) {
      sharedResults = await this.searchShared(query, limit);
    }

    return {
      private: privateResults,
      shared: sharedResults,
    };
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get the current configuration
   */
  getConfig(): ScopedMemoryConfig {
    return { ...this.config };
  }

  /**
   * Check if this manager has a specific scope
   */
  hasScope(scope: string): boolean {
    return hasScope(this.config.scopes, scope);
  }

  /**
   * Get the client ID
   */
  getClientId(): string {
    return this.config.clientId;
  }

  /**
   * Get the permission level
   */
  getPermissionLevel(): PermissionLevel {
    return this.config.permissionLevel;
  }

  /**
   * Get the team ID
   */
  getTeam(): string | undefined {
    return this.config.team;
  }

  /**
   * Check if this is a manager
   */
  isManager(): boolean {
    return this.config.permissionLevel === 'manager';
  }

  /**
   * Get managed agent IDs (for managers)
   */
  getManagedAgents(): string[] {
    return this.config.managedAgents ?? [];
  }
}

/**
 * Factory function to create a ScopedMemoryManager from AuthInfo
 */
export function createScopedMemoryManager(
  auth: AuthInfo,
  privateMemory: MemoryManager,
  sharedPool: SharedMemoryManager,
  auditLog: AuditLogger
): ScopedMemoryManager {
  return new ScopedMemoryManager(
    {
      clientId: auth.clientId,
      permissionLevel: auth.permissionLevel,
      scopes: auth.scopes,
      team: auth.team,
      managedAgents: auth.managedAgents,
    },
    privateMemory,
    sharedPool,
    auditLog
  );
}
