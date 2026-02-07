/**
 * Core Tools (P1: Reduced tool surface)
 *
 * This module defines the core set of ~15 high-level tools that are registered
 * by default in MCP. The full set of 60+ detailed tools remains available via
 * the HTTP API or by setting CC_MEMORY_TOOL_MODE=full.
 *
 * Core tools are designed for agent usability:
 * - Fewer choices = less decision fatigue
 * - Unified interfaces that auto-select the right memory layer
 * - High-level operations that combine multiple low-level actions
 */

import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

// Define which tools are in the core set
export const CORE_TOOLS = new Set([
  // Unified memory operations (auto-select layer)
  'memory_store',       // Store to any layer (auto-selects working/episodic/semantic)
  'memory_recall',      // Recall from all layers
  'smart_recall',       // Recall with spreading activation
  'memory_update',      // Update any memory by ID
  'memory_forget',      // Delete or decay memories
  'memory_consolidate', // Promote working to long-term
  'memory_stats',       // Get statistics
  'memory_export',      // Export all data
  'memory_import',      // Import data
  'memory_decay',       // Apply importance decay

  // Agent management
  'agent_register',     // Register agent
  'agent_list',         // List agents

  // Tachikoma sync (simplified)
  'tachikoma_init',     // Initialize Tachikoma
  'tachikoma_status',   // Get sync status

  // DIKW pipeline (high-level)
  'dikw_analyze',       // Detect patterns/insights/wisdom
  'dikw_auto_promote',  // Auto-create from candidates
]);

// Tools that should only be available in 'full' mode
export const ADVANCED_TOOLS = new Set([
  // Low-level working memory
  'working_set',
  'working_get',
  'working_delete',
  'working_list',
  'working_clear',

  // Low-level episodic memory
  'episode_record',
  'episode_get',
  'episode_get_transcript',
  'episode_search',
  'episode_update',
  'episode_relate',

  // Low-level semantic memory
  'semantic_create',
  'semantic_get',
  'semantic_search',
  'semantic_add_observation',
  'semantic_relate',
  'semantic_update',

  // Advanced memory operations
  'memory_boost',
  'reconsolidation_candidates',
  'merge_episodes',
  'cluster_episodes',
  'compress_memories',

  // Goal tracking
  'goal_create',
  'goal_get',
  'goal_list',
  'goal_check',
  'goal_update_status',
  'goal_add_note',

  // Tachikoma advanced
  'tachikoma_export',
  'tachikoma_import',
  'tachikoma_conflicts',
  'tachikoma_resolve_conflict',

  // Agent advanced
  'agent_get',

  // DIKW low-level
  'pattern_create',
  'pattern_get',
  'pattern_list',
  'pattern_confirm',
  'insight_create',
  'insight_get',
  'insight_list',
  'insight_validate',
  'wisdom_create',
  'wisdom_get',
  'wisdom_search',
  'wisdom_apply',

  // Shared memory (multi-agent)
  'shared_memory_set',
  'shared_memory_get',
  'shared_memory_delete',
  'shared_memory_list',
  'shared_memory_search',
  'team_sync_request',
  'agent_memory_read',
  'permission_grant',
  'audit_query',

  // Invite codes
  'invite_create',
  'invite_list',
  'invite_get',
  'invite_revoke',
]);

export type ToolMode = 'core' | 'full' | 'minimal';

/**
 * Get the tool mode from environment variable
 */
export function getToolMode(): ToolMode {
  const mode = process.env.CC_MEMORY_TOOL_MODE?.toLowerCase();
  if (mode === 'full' || mode === 'minimal') {
    return mode;
  }
  return 'core'; // Default
}

/**
 * Check if a tool should be registered based on current mode
 */
export function shouldRegisterTool(toolName: string, mode: ToolMode = getToolMode()): boolean {
  switch (mode) {
    case 'minimal':
      // Only the most essential tools
      return ['memory_store', 'memory_recall', 'memory_stats'].includes(toolName);
    case 'full':
      // All tools
      return true;
    case 'core':
    default:
      // Core tools only
      return CORE_TOOLS.has(toolName);
  }
}

/**
 * Helper to create a tool registration function that respects the tool mode
 */
export function createToolRegistrar<T extends {
  tool: (name: string, description: string, schema: Record<string, ZodTypeAny>, handler: (args: unknown) => Promise<{ content: { type: string; text: string }[] }>) => void;
}>(server: T, mode: ToolMode = getToolMode()) {
  return function registerTool(
    name: string,
    description: string,
    schema: z.ZodObject<z.ZodRawShape>,
    handler: (args: unknown) => Promise<{ content: { type: string; text: string }[] }>
  ) {
    if (shouldRegisterTool(name, mode)) {
      server.tool(name, description, schema.shape, handler);
      return true;
    }
    return false;
  };
}

/**
 * Get statistics about tool registration
 */
export function getToolStats(mode: ToolMode = getToolMode()): {
  mode: ToolMode;
  coreCount: number;
  advancedCount: number;
  totalAvailable: number;
  registered: number;
} {
  const coreCount = CORE_TOOLS.size;
  const advancedCount = ADVANCED_TOOLS.size;
  const totalAvailable = coreCount + advancedCount;

  let registered: number;
  switch (mode) {
    case 'minimal':
      registered = 3;
      break;
    case 'full':
      registered = totalAvailable;
      break;
    case 'core':
    default:
      registered = coreCount;
  }

  return { mode, coreCount, advancedCount, totalAvailable, registered };
}
