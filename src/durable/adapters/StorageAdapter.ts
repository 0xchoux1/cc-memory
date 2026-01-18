/**
 * StorageAdapter - Unified Storage Interface for Durable Workflows and Agent Coordination
 *
 * This adapter implements both WorkflowStorage and AgentStorage interfaces,
 * bridging MemoryManager and SqliteStorage to the durable execution layer.
 *
 * Usage:
 *   const adapter = new StorageAdapter(memoryManager, sqliteStorage);
 *   const workflowManager = new WorkflowManager({ storage: adapter });
 *   const agentCoordinator = new AgentCoordinator(adapter);
 */

import type { MemoryManager } from '../../memory/MemoryManager.js';
import type { SqliteStorage } from '../../storage/SqliteStorage.js';
import type { WorkflowStorage } from '../WorkflowManager.js';
import type { AgentStorage } from '../../agents/AgentCoordinator.js';
import type { AgentRole, AgentProfile } from '../../memory/types.js';

/**
 * Unified storage adapter that implements both WorkflowStorage and AgentStorage
 */
export class StorageAdapter implements WorkflowStorage, AgentStorage {
  constructor(
    private manager: MemoryManager,
    private storage: SqliteStorage
  ) {}

  // ============================================================================
  // WorkflowStorage Implementation
  // ============================================================================

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

  async listWorkingMemory(filter?: { type?: string; tags?: string[] }): Promise<Array<{ key: string; value: unknown }>> {
    const items = this.manager.working.list({
      type: filter?.type as 'task_state' | 'decision' | 'context' | 'scratch',
      tags: filter?.tags,
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
      context: episode.context as { projectPath?: string; branch?: string; taskId?: string; files?: string[] },
      outcome: episode.outcome ? {
        status: episode.outcome.status as 'success' | 'failure' | 'partial',
        learnings: episode.outcome.learnings,
      } : undefined,
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

  // ============================================================================
  // AgentStorage Implementation
  // ============================================================================

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
    return {
      id: result.id,
      name: result.name ?? result.id,
    };
  }

  async tachikomaExport(config: { outputPath?: string; sinceTimestamp?: number }): Promise<unknown> {
    const delta = this.storage.exportDelta(config.sinceTimestamp);

    // If outputPath is specified, write to file
    if (config.outputPath) {
      const { writeFileSync, mkdirSync } = await import('fs');
      const { dirname } = await import('path');

      try {
        mkdirSync(dirname(config.outputPath), { recursive: true });
        writeFileSync(config.outputPath, JSON.stringify(delta, null, 2));
      } catch (error) {
        console.error('Failed to write export file:', error);
      }
    }

    return delta;
  }

  async tachikomaImport(config: { data: unknown; strategy?: string; autoResolve?: boolean }): Promise<{
    merged: { working: number; episodic: number };
    conflicts: number;
  }> {
    const result = this.storage.importDelta(
      config.data as Parameters<typeof this.storage.importDelta>[0],
      {
        strategy: config.strategy as 'newer_wins' | 'higher_importance' | 'higher_confidence' | 'merge_observations' | 'merge_learnings' | 'manual',
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
    if (!profile) {
      throw new Error('Tachikoma not initialized');
    }
    return {
      id: profile.id,
      name: profile.name,
      syncSeq: profile.syncSeq,
      lastSyncAt: profile.lastSyncAt,
    };
  }
}

export default StorageAdapter;
