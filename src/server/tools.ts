/**
 * MCP Tool definitions for the memory server
 */

import { z } from 'zod';
import * as fs from 'fs';
import type { MemoryManager } from '../memory/MemoryManager.js';
import type { SqliteStorage } from '../storage/SqliteStorage.js';
import type { AuthInfo } from './http/auth/types.js';

// Schema definitions
export const WorkingSetSchema = z.object({
  key: z.string().describe('Unique key for the memory item'),
  value: z.unknown().describe('Value to store (JSON-compatible)'),
  type: z.enum(['task_state', 'decision', 'context', 'scratch']).optional()
    .describe('Type of working memory'),
  ttl: z.number().optional().describe('Time-to-live in milliseconds'),
  priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority level'),
  tags: z.array(z.string()).optional().describe('Tags for filtering'),
});

export const WorkingGetSchema = z.object({
  key: z.string().describe('Key to retrieve'),
});

export const WorkingDeleteSchema = z.object({
  key: z.string().describe('Key to delete'),
});

export const WorkingListSchema = z.object({
  type: z.enum(['task_state', 'decision', 'context', 'scratch']).optional()
    .describe('Filter by type'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
});

export const WorkingClearSchema = z.object({
  expired_only: z.boolean().optional().default(true)
    .describe('If true, only clear expired items'),
});

export const TranscriptMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.number().optional(),
  toolCalls: z.array(z.object({
    name: z.string(),
    input: z.unknown(),
    output: z.unknown().optional(),
  })).optional(),
});

export const EpisodeRecordSchema = z.object({
  type: z.enum(['incident', 'interaction', 'milestone', 'error', 'success'])
    .describe('Type of episode'),
  summary: z.string().describe('Brief summary of the episode'),
  details: z.string().describe('Detailed description'),
  context: z.object({
    projectPath: z.string().optional(),
    branch: z.string().optional(),
    taskId: z.string().optional(),
    files: z.array(z.string()).optional(),
  }).optional().describe('Contextual information'),
  outcome: z.object({
    status: z.enum(['success', 'failure', 'partial']),
    learnings: z.array(z.string()),
    resolution: z.string().optional(),
  }).optional().describe('Outcome of the episode'),
  importance: z.number().min(1).max(10).optional().describe('Importance level (1-10)'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  transcript: z.array(TranscriptMessageSchema).optional()
    .describe('Full conversation transcript (user and assistant messages)'),
});

export const EpisodeGetSchema = z.object({
  id: z.string().describe('Episode ID'),
});

export const EpisodeGetTranscriptSchema = z.object({
  id: z.string().describe('Episode ID'),
});

export const EpisodeSearchSchema = z.object({
  query: z.string().optional().describe('Full-text search query'),
  type: z.enum(['incident', 'interaction', 'milestone', 'error', 'success']).optional()
    .describe('Filter by episode type'),
  date_start: z.number().optional().describe('Start timestamp'),
  date_end: z.number().optional().describe('End timestamp'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  min_importance: z.number().optional().describe('Minimum importance level'),
  limit: z.number().optional().default(10).describe('Maximum results'),
  search_transcript: z.boolean().optional().default(false)
    .describe('Also search within transcript content (slower)'),
});

export const EpisodeUpdateSchema = z.object({
  id: z.string().describe('Episode ID'),
  outcome: z.object({
    status: z.enum(['success', 'failure', 'partial']),
    learnings: z.array(z.string()),
    resolution: z.string().optional(),
  }).optional().describe('Updated outcome'),
  learnings: z.array(z.string()).optional().describe('Additional learnings to add'),
  importance: z.number().min(1).max(10).optional().describe('Updated importance'),
});

export const EpisodeRelateSchema = z.object({
  episode_id: z.string().describe('Source episode ID'),
  related_id: z.string().describe('Related episode ID'),
});

export const SemanticCreateSchema = z.object({
  name: z.string().describe('Unique name for the entity'),
  type: z.enum(['procedure', 'fact', 'config', 'preference', 'pattern', 'skill'])
    .describe('Type of semantic entity'),
  description: z.string().describe('Description of the entity'),
  content: z.unknown().optional().describe('Structured content (JSON)'),
  procedure: z.object({
    steps: z.array(z.string()),
    preconditions: z.array(z.string()).optional(),
    postconditions: z.array(z.string()).optional(),
  }).optional().describe('Procedure definition'),
  observations: z.array(z.string()).optional().describe('Initial observations'),
  confidence: z.number().min(0).max(1).optional().describe('Confidence score (0-1)'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
});

export const SemanticGetSchema = z.object({
  identifier: z.string().describe('Entity ID or name'),
});

export const SemanticSearchSchema = z.object({
  query: z.string().optional().describe('Full-text search query'),
  type: z.enum(['procedure', 'fact', 'config', 'preference', 'pattern', 'skill']).optional()
    .describe('Filter by entity type'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  min_confidence: z.number().optional().describe('Minimum confidence score'),
  limit: z.number().optional().default(10).describe('Maximum results'),
});

export const SemanticAddObservationSchema = z.object({
  identifier: z.string().describe('Entity ID or name'),
  observation: z.string().describe('Observation to add'),
});

export const SemanticRelateSchema = z.object({
  from: z.string().describe('Source entity ID or name'),
  to: z.string().describe('Target entity ID or name'),
  relation_type: z.string().describe('Type of relation (e.g., "depends_on", "part_of")'),
  strength: z.number().min(0).max(1).optional().default(1.0)
    .describe('Relation strength (0-1)'),
});

export const SemanticUpdateSchema = z.object({
  identifier: z.string().describe('Entity ID or name'),
  description: z.string().optional().describe('Updated description'),
  content: z.unknown().optional().describe('Updated content'),
  confidence: z.number().min(0).max(1).optional().describe('Updated confidence'),
  tags: z.array(z.string()).optional().describe('Updated tags'),
});

export const MemoryConsolidateSchema = z.object({
  working_key: z.string().describe('Working memory key to consolidate'),
  target_type: z.enum(['episodic', 'semantic']).describe('Target memory type'),
  metadata: z.object({
    // For episodic
    episode_type: z.enum(['incident', 'interaction', 'milestone', 'error', 'success']).optional(),
    summary: z.string().optional(),
    details: z.string().optional(),
    importance: z.number().optional(),
    // For semantic
    name: z.string().optional(),
    entity_type: z.enum(['procedure', 'fact', 'config', 'preference', 'pattern', 'skill']).optional(),
    description: z.string().optional(),
    // Common
    tags: z.array(z.string()).optional(),
  }).describe('Metadata for the target memory'),
});

export const MemoryRecallSchema = z.object({
  query: z.string().describe('Search query'),
  include_working: z.boolean().optional().default(true),
  include_episodic: z.boolean().optional().default(true),
  include_semantic: z.boolean().optional().default(true),
  limit: z.number().optional().default(10),
});

export const MemoryImportSchema = z.object({
  data: z.object({
    version: z.string(),
    exportedAt: z.number(),
    working: z.array(z.unknown()).optional(),
    episodic: z.array(z.unknown()).optional(),
    semantic: z.object({
      entities: z.array(z.unknown()).optional(),
      relations: z.array(z.unknown()).optional(),
    }).optional(),
  }).describe('Memory export data to import'),
  overwrite: z.boolean().optional().default(false)
    .describe('Overwrite existing items with same ID'),
  skip_working: z.boolean().optional().default(false)
    .describe('Skip importing working memory'),
  skip_episodic: z.boolean().optional().default(false)
    .describe('Skip importing episodic memory'),
  skip_semantic: z.boolean().optional().default(false)
    .describe('Skip importing semantic memory'),
});

export const MemoryExportSchema = z.object({
  include_working: z.boolean().optional().default(true)
    .describe('Include working memory in export'),
  include_episodic: z.boolean().optional().default(true)
    .describe('Include episodic memory in export'),
  include_semantic: z.boolean().optional().default(true)
    .describe('Include semantic memory in export'),
});

export const SmartRecallSchema = z.object({
  query: z.string().describe('Search query'),
  include_working: z.boolean().optional().default(true),
  include_episodic: z.boolean().optional().default(true),
  include_semantic: z.boolean().optional().default(true),
  limit: z.number().optional().default(10),
  recency_weight: z.number().min(0).max(1).optional().default(0.3)
    .describe('Weight for recency in scoring (0-1)'),
  importance_weight: z.number().min(0).max(1).optional().default(0.4)
    .describe('Weight for importance in scoring (0-1)'),
  confidence_weight: z.number().min(0).max(1).optional().default(0.3)
    .describe('Weight for confidence in scoring (0-1)'),
  spreading_activation: z.boolean().optional().default(true)
    .describe('Enable spreading activation through semantic relations graph'),
  activation_decay: z.number().min(0).max(1).optional().default(0.5)
    .describe('Decay factor per hop in spreading activation (0-1)'),
  max_spreading_hops: z.number().min(1).max(5).optional().default(2)
    .describe('Maximum hops for spreading activation (1-5)'),
  current_context: z.object({
    project_path: z.string().optional().describe('Current project path'),
    branch: z.string().optional().describe('Current git branch'),
    session_id: z.string().optional().describe('Current session ID'),
  }).optional().describe('Current context for context-dependent encoding bonus (N6)'),
  context_match_multiplier: z.number().min(1).max(2).optional().default(1.2)
    .describe('Multiplier applied when context matches (default: 1.2)'),
});

export const ReconsolidationCandidatesSchema = z.object({
  episode_id: z.string().describe('Episode ID to find reconsolidation candidates for'),
  min_tag_overlap: z.number().min(0).max(1).optional().default(0.3)
    .describe('Minimum tag overlap ratio to consider (0-1)'),
  newer_only: z.boolean().optional().default(true)
    .describe('Only consider episodes newer than the source'),
  limit: z.number().optional().default(5)
    .describe('Maximum number of candidates to return'),
  match_context: z.boolean().optional().default(true)
    .describe('Include context matching in similarity calculation'),
});

export const MergeEpisodesSchema = z.object({
  target_id: z.string().describe('Episode ID to merge into'),
  merge_id: z.string().describe('Episode ID to merge from'),
  combine_learnings: z.boolean().optional().default(true)
    .describe('Combine learnings from both episodes'),
  combine_tags: z.boolean().optional().default(true)
    .describe('Add merge episode tags to target'),
  merged_importance_reduction: z.number().min(0).max(1).optional().default(0.5)
    .describe('Factor to reduce merged episode importance by'),
});

export const MemoryDecaySchema = z.object({
  use_ebbinghaus: z.boolean().optional().default(true)
    .describe('Use Ebbinghaus forgetting curve (recommended). If false, uses legacy uniform decay.'),
  decay_factor: z.number().min(0).max(1).optional().default(0.95)
    .describe('Legacy: Decay multiplier (0.95 = 5% decay). Only used if use_ebbinghaus=false.'),
  min_importance: z.number().min(1).max(10).optional().default(1)
    .describe('Minimum importance to decay to'),
  older_than_days: z.number().optional().default(1)
    .describe('Only decay memories older than this many days'),
  base_stability: z.number().min(0.1).max(30).optional().default(1)
    .describe('Base stability in days. Higher = slower initial decay.'),
  stability_growth_factor: z.number().min(1).max(3).optional().default(1.5)
    .describe('How much stability grows per access. 1.5 means each access increases stability by 50%.'),
});

export const MemoryBoostSchema = z.object({
  boost_factor: z.number().min(1).max(2).optional().default(1.1)
    .describe('Boost multiplier (1.1 = 10% boost)'),
  max_importance: z.number().min(1).max(10).optional().default(10)
    .describe('Maximum importance to boost to'),
  min_access_count: z.number().optional().default(5)
    .describe('Minimum access count to qualify for boost'),
});

// ============================================================================
// Unified High-Level Schemas (P1: Reduced tool surface)
// ============================================================================

export const UnifiedMemoryStoreSchema = z.object({
  content: z.string().describe('The content to store'),
  type: z.enum(['working', 'episodic', 'semantic', 'auto']).optional().default('auto')
    .describe('Memory type. Use "auto" for automatic selection based on content.'),
  key: z.string().optional().describe('Key for working memory (required if type=working)'),
  name: z.string().optional().describe('Name for semantic entities (required if type=semantic)'),
  importance: z.number().min(1).max(10).optional().default(5)
    .describe('Importance level (1-10)'),
  tags: z.array(z.string()).optional().default([])
    .describe('Tags for categorization'),
  metadata: z.record(z.unknown()).optional()
    .describe('Additional metadata'),
});

export const UnifiedMemoryUpdateSchema = z.object({
  id: z.string().describe('ID of the memory to update'),
  type: z.enum(['working', 'episodic', 'semantic']).describe('Memory type'),
  updates: z.record(z.unknown()).describe('Fields to update'),
});

export const UnifiedMemoryForgetSchema = z.object({
  id: z.string().optional().describe('ID of specific memory to forget'),
  type: z.enum(['working', 'episodic', 'semantic']).optional().describe('Memory type'),
  key: z.string().optional().describe('Key for working memory'),
  tags: z.array(z.string()).optional().describe('Forget all with these tags'),
  older_than_days: z.number().optional().describe('Forget memories older than N days'),
});

// ============================================================================
// Tachikoma Parallelization Schemas
// ============================================================================

export const TachikomaInitSchema = z.object({
  tachikoma_id: z.string().optional()
    .describe('Tachikoma ID (auto-generated if omitted)'),
  tachikoma_name: z.string().optional()
    .describe('Tachikoma name (e.g., "Tachikoma-Alpha")'),
});

export const TachikomaStatusSchema = z.object({
  include_history: z.boolean().optional().default(false)
    .describe('Include sync history'),
  history_limit: z.number().optional().default(10)
    .describe('Number of history entries to return'),
});

export const TachikomaExportSchema = z.object({
  since_timestamp: z.number().optional()
    .describe('Export memories updated after this timestamp (0 for all)'),
  output_path: z.string().optional()
    .describe('Optional file path to write export (if omitted, returns data directly)'),
});

export const TachikomaImportSchema = z.object({
  data: z.object({
    version: z.string(),
    format: z.literal('tachikoma-parallelize-delta'),
    tachikomaId: z.string(),
    tachikomaName: z.string().optional(),
    exportedAt: z.number(),
    syncVector: z.record(z.number()),
    delta: z.object({
      working: z.array(z.unknown()),
      episodic: z.array(z.unknown()),
      semantic: z.object({
        entities: z.array(z.unknown()),
        relations: z.array(z.unknown()),
      }),
    }),
    deleted: z.object({
      working: z.array(z.string()),
      episodic: z.array(z.string()),
      semantic: z.object({
        entities: z.array(z.string()),
        relations: z.array(z.string()),
      }),
    }),
  }).describe('Parallelization export data from another Tachikoma'),
  strategy: z.enum(['newer_wins', 'higher_importance', 'higher_confidence', 'merge_observations', 'merge_learnings', 'manual']).optional()
    .describe('Conflict resolution strategy (default: merge_learnings)'),
  auto_resolve: z.boolean().optional().default(true)
    .describe('Automatically resolve conflicts'),
});

export const TachikomaConflictsSchema = z.object({
  unresolved_only: z.boolean().optional().default(true)
    .describe('Only show unresolved conflicts'),
});

export const TachikomaResolveConflictSchema = z.object({
  conflict_id: z.string().describe('Conflict ID to resolve'),
  resolution: z.enum(['local', 'remote', 'merged'])
    .describe('Resolution choice'),
});

// ============================================================================
// Agent Management Schemas
// ============================================================================

export const AgentRegisterSchema = z.object({
  name: z.string().describe('Agent name'),
  role: z.enum(['frontend', 'backend', 'security', 'testing', 'devops', 'architecture', 'data', 'general'])
    .describe('Agent role'),
  specializations: z.array(z.string()).optional()
    .describe('Detailed specializations'),
  capabilities: z.array(z.string()).optional()
    .describe('Executable tasks'),
  knowledge_domains: z.array(z.string()).optional()
    .describe('Knowledge domains'),
});

export const AgentGetSchema = z.object({
  id: z.string().describe('Agent ID'),
});

export const AgentListSchema = z.object({
  role: z.enum(['frontend', 'backend', 'security', 'testing', 'devops', 'architecture', 'data', 'general']).optional()
    .describe('Filter by role'),
  active_within_hours: z.number().optional().default(24)
    .describe('Filter agents active within this many hours'),
});

// ============================================================================
// Pattern Schemas
// ============================================================================

export const PatternCreateSchema = z.object({
  pattern: z.string().describe('Pattern description'),
  supporting_episodes: z.array(z.string()).optional()
    .describe('Episode IDs that support this pattern'),
  related_tags: z.array(z.string()).optional()
    .describe('Related tags'),
  confidence: z.number().min(0).max(1).optional()
    .describe('Confidence score (0-1)'),
});

export const PatternGetSchema = z.object({
  id: z.string().describe('Pattern ID'),
});

export const PatternListSchema = z.object({
  query: z.string().optional().describe('Search query'),
  status: z.enum(['candidate', 'confirmed', 'rejected']).optional()
    .describe('Filter by status'),
  min_confidence: z.number().min(0).max(1).optional()
    .describe('Minimum confidence'),
  min_frequency: z.number().optional()
    .describe('Minimum frequency'),
  limit: z.number().optional().default(10),
});

export const PatternConfirmSchema = z.object({
  id: z.string().describe('Pattern ID'),
  confirmed: z.boolean().describe('Confirmation result'),
});

// ============================================================================
// Insight Schemas
// ============================================================================

export const InsightCreateSchema = z.object({
  insight: z.string().describe('Insight content'),
  reasoning: z.string().optional().describe('Derivation reasoning'),
  source_patterns: z.array(z.string()).optional()
    .describe('Source pattern IDs'),
  domains: z.array(z.string()).optional()
    .describe('Applicable domains'),
  confidence: z.number().min(0).max(1).optional()
    .describe('Confidence score'),
});

export const InsightGetSchema = z.object({
  id: z.string().describe('Insight ID'),
});

export const InsightListSchema = z.object({
  query: z.string().optional().describe('Search query'),
  status: z.enum(['candidate', 'validated', 'rejected']).optional()
    .describe('Filter by status'),
  min_confidence: z.number().min(0).max(1).optional()
    .describe('Minimum confidence'),
  limit: z.number().optional().default(10),
});

export const InsightValidateSchema = z.object({
  id: z.string().describe('Insight ID'),
  validated: z.boolean().describe('Validation result'),
});

// ============================================================================
// Wisdom Schemas
// ============================================================================

export const WisdomCreateSchema = z.object({
  name: z.string().describe('Wisdom name (unique)'),
  principle: z.string().describe('Core principle in one sentence'),
  description: z.string().describe('Detailed description'),
  derived_from_insights: z.array(z.string()).optional()
    .describe('Source insight IDs'),
  derived_from_patterns: z.array(z.string()).optional()
    .describe('Source pattern IDs'),
  evidence_episodes: z.array(z.string()).optional()
    .describe('Evidence episode IDs'),
  applicable_domains: z.array(z.string()).optional()
    .describe('Applicable domains'),
  applicable_contexts: z.array(z.string()).optional()
    .describe('Applicable contexts'),
  limitations: z.array(z.string()).optional()
    .describe('Limitations'),
  tags: z.array(z.string()).optional(),
});

export const WisdomGetSchema = z.object({
  identifier: z.string().describe('Wisdom ID or name'),
});

export const WisdomSearchSchema = z.object({
  query: z.string().optional().describe('Search query'),
  domains: z.array(z.string()).optional()
    .describe('Filter by domains'),
  min_confidence: z.number().min(0).max(1).optional()
    .describe('Minimum confidence'),
  limit: z.number().optional().default(10),
});

export const WisdomApplySchema = z.object({
  wisdom_id: z.string().describe('Wisdom ID'),
  context: z.string().describe('Application context'),
  result: z.enum(['success', 'failure', 'partial'])
    .describe('Application result'),
  feedback: z.string().optional().describe('Feedback'),
});

// ============================================================================
// Shared Memory Schemas (Multi-Agent)
// ============================================================================

export const SharedMemorySetSchema = z.object({
  key: z.string().describe('Unique key for the shared memory item'),
  value: z.unknown().describe('Value to store (JSON-compatible)'),
  visibility: z.array(z.string()).optional()
    .describe('Visibility list: ["*"] for all, ["agent-id"] for specific agents, ["team:team-id"] for teams'),
  tags: z.array(z.string()).optional().describe('Tags for filtering'),
  namespace: z.string().optional().describe('Namespace (defaults to team namespace)'),
});

export const SharedMemoryGetSchema = z.object({
  key: z.string().describe('Key to retrieve'),
  namespace: z.string().optional().describe('Namespace (defaults to team namespace)'),
});

export const SharedMemoryDeleteSchema = z.object({
  key: z.string().describe('Key to delete'),
  namespace: z.string().optional().describe('Namespace (defaults to team namespace)'),
});

export const SharedMemoryListSchema = z.object({
  namespace: z.string().optional().describe('Namespace (defaults to team namespace)'),
  owner: z.string().optional().describe('Filter by owner'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  limit: z.number().optional().default(100).describe('Maximum results'),
});

export const SharedMemorySearchSchema = z.object({
  query: z.string().describe('Search query'),
  namespace: z.string().optional().describe('Namespace (defaults to team namespace)'),
  limit: z.number().optional().default(50).describe('Maximum results'),
});

export const TeamSyncRequestSchema = z.object({
  target_agent: z.string().optional().describe('Target agent ID (if omitted, syncs with all team members)'),
  since_timestamp: z.number().optional().describe('Sync changes since this timestamp'),
});

export const AgentMemoryReadSchema = z.object({
  agent_id: z.string().describe('Target agent ID'),
  key: z.string().describe('Memory key to read'),
  memory_type: z.enum(['working', 'episodic', 'semantic']).optional().default('working')
    .describe('Type of memory to read'),
});

export const PermissionGrantSchema = z.object({
  target_agent: z.string().describe('Agent ID to grant permission to'),
  scopes: z.array(z.string()).describe('Scopes to grant'),
  duration_ms: z.number().optional().describe('Duration in milliseconds (optional, permanent if not specified)'),
});

export const AuditQuerySchema = z.object({
  actor: z.string().optional().describe('Filter by actor'),
  action: z.string().optional().describe('Filter by action'),
  resource_type: z.string().optional().describe('Filter by resource type'),
  result: z.enum(['success', 'denied', 'error']).optional().describe('Filter by result'),
  team: z.string().optional().describe('Filter by team'),
  start_time: z.number().optional().describe('Start timestamp'),
  end_time: z.number().optional().describe('End timestamp'),
  limit: z.number().optional().default(100).describe('Maximum results'),
});

// ============================================================================
// Invite Code Schemas (Self-service Registration)
// ============================================================================

export const InviteCreateSchema = z.object({
  level: z.enum(['manager', 'worker', 'observer']).optional().default('worker')
    .describe('Permission level for new agents (default: worker)'),
  max_uses: z.number().nullable().optional()
    .describe('Maximum number of uses (null = unlimited)'),
  expires_in_hours: z.number().nullable().optional().default(24)
    .describe('Expiration in hours (null = never expires, default: 24)'),
  description: z.string().optional()
    .describe('Description/note for this invite'),
});

export const InviteListSchema = z.object({
  include_expired: z.boolean().optional().default(false)
    .describe('Include expired/exhausted invites'),
});

export const InviteRevokeSchema = z.object({
  code: z.string().describe('Invite code to revoke'),
});

export const InviteGetSchema = z.object({
  code: z.string().describe('Invite code to retrieve'),
});

// Import invite functions
import {
  createInviteCode,
  listInviteCodes,
  getInviteCode,
  revokeInviteCode,
} from './http/auth/apiKey.js';

// Context for tool execution
export interface ToolContext {
  auth?: AuthInfo;
  apiKeysFilePath?: string;
  /** Team-shared storage for shared_memory_* operations */
  sharedStorage?: SqliteStorage;
}

// Tool handler factory
export function createToolHandlers(
  memoryManager: MemoryManager,
  storage: SqliteStorage,
  context: ToolContext = {}
) {
  return {
    // Working Memory Tools
    working_set: (args: z.infer<typeof WorkingSetSchema>) => {
      const item = memoryManager.working.set({
        key: args.key,
        value: args.value,
        type: args.type,
        ttl: args.ttl,
        priority: args.priority,
        tags: args.tags,
      });
      return { success: true, item };
    },

    working_get: (args: z.infer<typeof WorkingGetSchema>) => {
      const item = memoryManager.working.get(args.key);
      return item ? { success: true, item } : { success: false, error: 'Item not found' };
    },

    working_delete: (args: z.infer<typeof WorkingDeleteSchema>) => {
      const deleted = memoryManager.working.delete(args.key);
      return { success: deleted };
    },

    working_list: (args: z.infer<typeof WorkingListSchema>) => {
      const items = memoryManager.working.list({
        type: args.type,
        tags: args.tags,
      });
      return { success: true, items, count: items.length };
    },

    working_clear: (args: z.infer<typeof WorkingClearSchema>) => {
      const cleared = args.expired_only
        ? memoryManager.working.clearExpired()
        : memoryManager.working.clearAll();
      return { success: true, cleared };
    },

    // Episodic Memory Tools
    episode_record: (args: z.infer<typeof EpisodeRecordSchema>) => {
      const episode = memoryManager.episodic.record({
        type: args.type,
        summary: args.summary,
        details: args.details,
        context: args.context,
        outcome: args.outcome,
        importance: args.importance,
        tags: args.tags,
        transcript: args.transcript,
      });
      return { success: true, episode };
    },

    episode_get: (args: z.infer<typeof EpisodeGetSchema>) => {
      const episode = memoryManager.episodic.get(args.id);
      return episode ? { success: true, episode } : { success: false, error: 'Episode not found' };
    },

    episode_get_transcript: (args: z.infer<typeof EpisodeGetTranscriptSchema>) => {
      const transcript = memoryManager.episodic.getTranscript(args.id);
      if (!transcript) {
        return { success: false, error: 'Transcript not found' };
      }
      return { success: true, transcript, messageCount: transcript.length };
    },

    episode_search: (args: z.infer<typeof EpisodeSearchSchema>) => {
      const episodes = memoryManager.episodic.search({
        query: args.query,
        type: args.type,
        dateRange: args.date_start || args.date_end ? {
          start: args.date_start,
          end: args.date_end,
        } : undefined,
        tags: args.tags,
        minImportance: args.min_importance,
        limit: args.limit,
        searchTranscript: args.search_transcript,
      });
      return { success: true, episodes, count: episodes.length };
    },

    episode_update: (args: z.infer<typeof EpisodeUpdateSchema>) => {
      let updated = false;

      if (args.outcome) {
        updated = memoryManager.episodic.updateOutcome(args.id, args.outcome) || updated;
      }

      if (args.learnings && args.learnings.length > 0) {
        updated = memoryManager.episodic.addLearnings(args.id, args.learnings) || updated;
      }

      if (args.importance !== undefined) {
        updated = memoryManager.episodic.updateImportance(args.id, args.importance) || updated;
      }

      return { success: updated };
    },

    episode_relate: (args: z.infer<typeof EpisodeRelateSchema>) => {
      const success = memoryManager.episodic.relate(args.episode_id, args.related_id);
      return { success };
    },

    // Semantic Memory Tools
    semantic_create: (args: z.infer<typeof SemanticCreateSchema>) => {
      const entity = memoryManager.semantic.create({
        name: args.name,
        type: args.type,
        description: args.description,
        content: args.content,
        procedure: args.procedure,
        observations: args.observations,
        confidence: args.confidence,
        tags: args.tags,
      });
      return { success: true, entity };
    },

    semantic_get: (args: z.infer<typeof SemanticGetSchema>) => {
      const entity = memoryManager.semantic.get(args.identifier);
      return entity ? { success: true, entity } : { success: false, error: 'Entity not found' };
    },

    semantic_search: (args: z.infer<typeof SemanticSearchSchema>) => {
      const entities = memoryManager.semantic.search({
        query: args.query,
        type: args.type,
        tags: args.tags,
        minConfidence: args.min_confidence,
        limit: args.limit,
      });
      return { success: true, entities, count: entities.length };
    },

    semantic_add_observation: (args: z.infer<typeof SemanticAddObservationSchema>) => {
      const success = memoryManager.semantic.addObservation(args.identifier, args.observation);
      return { success };
    },

    semantic_relate: (args: z.infer<typeof SemanticRelateSchema>) => {
      const relation = memoryManager.semantic.relate(
        args.from,
        args.to,
        args.relation_type,
        args.strength
      );
      return relation ? { success: true, relation } : { success: false, error: 'Failed to create relation' };
    },

    semantic_update: (args: z.infer<typeof SemanticUpdateSchema>) => {
      const success = memoryManager.semantic.update(args.identifier, {
        description: args.description,
        content: args.content,
        confidence: args.confidence,
        tags: args.tags,
      });
      return { success };
    },

    // Cross-Memory Tools
    memory_consolidate: (args: z.infer<typeof MemoryConsolidateSchema>) => {
      if (args.target_type === 'episodic') {
        if (!args.metadata.episode_type || !args.metadata.summary) {
          return { success: false, error: 'episode_type and summary are required for episodic consolidation' };
        }
        const episode = memoryManager.consolidateToEpisodic(args.working_key, {
          type: args.metadata.episode_type,
          summary: args.metadata.summary,
          details: args.metadata.details,
          importance: args.metadata.importance,
          tags: args.metadata.tags,
        });
        return episode ? { success: true, episode } : { success: false, error: 'Working memory item not found' };
      } else {
        if (!args.metadata.name || !args.metadata.entity_type || !args.metadata.description) {
          return { success: false, error: 'name, entity_type, and description are required for semantic consolidation' };
        }
        const entity = memoryManager.consolidateToSemantic(args.working_key, {
          name: args.metadata.name,
          type: args.metadata.entity_type,
          description: args.metadata.description,
          tags: args.metadata.tags,
        });
        return entity ? { success: true, entity } : { success: false, error: 'Working memory item not found' };
      }
    },

    memory_recall: (args: z.infer<typeof MemoryRecallSchema>) => {
      const result = memoryManager.recall(args.query, {
        includeWorking: args.include_working,
        includeEpisodic: args.include_episodic,
        includeSemantic: args.include_semantic,
        limit: args.limit,
      });
      return {
        success: true,
        ...result,
        total: result.working.length + result.episodic.length + result.semantic.length,
      };
    },

    memory_stats: () => {
      const stats = memoryManager.getStats();
      return { success: true, stats };
    },

    memory_import: (args: z.infer<typeof MemoryImportSchema>) => {
      const result = memoryManager.import(args.data as any, {
        overwrite: args.overwrite,
        skipWorking: args.skip_working,
        skipEpisodic: args.skip_episodic,
        skipSemantic: args.skip_semantic,
      });
      return { success: true, ...result };
    },

    memory_export: (args: z.infer<typeof MemoryExportSchema>) => {
      const exportData = memoryManager.export();

      // Filter based on options
      if (!args.include_working) {
        exportData.working = [];
      }
      if (!args.include_episodic) {
        exportData.episodic = [];
      }
      if (!args.include_semantic) {
        exportData.semantic = { entities: [], relations: [] };
      }

      return { success: true, data: exportData };
    },

    smart_recall: (args: z.infer<typeof SmartRecallSchema>) => {
      const result = memoryManager.smartRecall(args.query, {
        includeWorking: args.include_working,
        includeEpisodic: args.include_episodic,
        includeSemantic: args.include_semantic,
        limit: args.limit,
        recencyWeight: args.recency_weight,
        importanceWeight: args.importance_weight,
        confidenceWeight: args.confidence_weight,
        spreadingActivation: args.spreading_activation,
        activationDecay: args.activation_decay,
        maxSpreadingHops: args.max_spreading_hops,
        currentContext: args.current_context ? {
          projectPath: args.current_context.project_path,
          branch: args.current_context.branch,
          sessionId: args.current_context.session_id,
        } : undefined,
        contextMatchMultiplier: args.context_match_multiplier,
      });
      return {
        success: true,
        ...result,
        total: result.working.length + result.episodic.length + result.semantic.length,
      };
    },

    reconsolidation_candidates: (args: z.infer<typeof ReconsolidationCandidatesSchema>) => {
      const candidates = memoryManager.findReconsolidationCandidates(args.episode_id, {
        minTagOverlap: args.min_tag_overlap,
        newerOnly: args.newer_only,
        limit: args.limit,
        matchContext: args.match_context,
      });
      return {
        success: true,
        candidates: candidates.map(c => ({
          episode: c.episode,
          similarity: c.similarity,
          merge_reasons: c.mergeReasons,
        })),
        total: candidates.length,
      };
    },

    merge_episodes: (args: z.infer<typeof MergeEpisodesSchema>) => {
      const success = memoryManager.mergeEpisodes(args.target_id, args.merge_id, {
        combineLearnings: args.combine_learnings,
        combineTags: args.combine_tags,
        mergedImportanceReduction: args.merged_importance_reduction,
      });
      return { success };
    },

    memory_decay: (args: z.infer<typeof MemoryDecaySchema>) => {
      if (args.use_ebbinghaus) {
        // Use Ebbinghaus forgetting curve with spaced repetition
        const result = memoryManager.applyEbbinghausDecay({
          minImportance: args.min_importance,
          olderThanDays: args.older_than_days,
          baseStability: args.base_stability,
          stabilityGrowthFactor: args.stability_growth_factor,
        });
        return { success: true, method: 'ebbinghaus', ...result };
      } else {
        // Legacy uniform decay
        const result = memoryManager.applyImportanceDecay({
          decayFactor: args.decay_factor,
          minImportance: args.min_importance,
          olderThanDays: args.older_than_days,
        });
        return { success: true, method: 'legacy', ...result };
      }
    },

    memory_boost: (args: z.infer<typeof MemoryBoostSchema>) => {
      const result = memoryManager.applyAccessBoost({
        boostFactor: args.boost_factor,
        maxImportance: args.max_importance,
        minAccessCount: args.min_access_count,
      });
      return { success: true, ...result };
    },

    // ============================================================================
    // Unified High-Level Tools (P1: Reduced tool surface)
    // ============================================================================

    /**
     * Unified memory store - automatically selects the appropriate memory layer
     */
    memory_store: (args: z.infer<typeof UnifiedMemoryStoreSchema>) => {
      const { content, type, key, name, importance, tags, metadata } = args;

      // Auto-select memory type based on content characteristics
      let selectedType = type;
      if (type === 'auto') {
        // Heuristics for auto-selection:
        // - Short, key-value like content → working
        // - Event/action description → episodic
        // - Concept/fact/procedure → semantic
        const contentLower = content.toLowerCase();
        if (key || content.length < 100) {
          selectedType = 'working';
        } else if (
          contentLower.includes('learned') ||
          contentLower.includes('completed') ||
          contentLower.includes('error') ||
          contentLower.includes('fixed') ||
          contentLower.includes('implemented')
        ) {
          selectedType = 'episodic';
        } else {
          selectedType = 'semantic';
        }
      }

      switch (selectedType) {
        case 'working': {
          const workingKey = key || `auto_${Date.now()}`;
          const item = memoryManager.working.set({
            key: workingKey,
            value: metadata ? { content, ...metadata } : content,
            priority: importance >= 7 ? 'high' : importance >= 4 ? 'medium' : 'low',
            tags,
          });
          return { success: true, type: 'working', id: item.id, key: workingKey };
        }
        case 'episodic': {
          const episode = memoryManager.episodic.record({
            type: 'interaction',
            summary: content.substring(0, 200),
            details: content,
            importance,
            tags,
          });
          return { success: true, type: 'episodic', id: episode.id };
        }
        case 'semantic': {
          const entityName = name || `entity_${Date.now()}`;
          const entity = memoryManager.semantic.create({
            name: entityName,
            type: 'fact',
            description: content,
            tags,
            confidence: importance / 10,
          });
          return { success: true, type: 'semantic', id: entity.id, name: entityName };
        }
        default:
          return { success: false, error: `Unknown type: ${selectedType}` };
      }
    },

    /**
     * Unified memory update - update any memory type by ID
     */
    memory_update: (args: z.infer<typeof UnifiedMemoryUpdateSchema>) => {
      const { id, type, updates } = args;

      switch (type) {
        case 'working': {
          const existing = memoryManager.working.get(id);
          if (!existing) {
            return { success: false, error: 'Working memory item not found' };
          }
          const updated = memoryManager.working.set({
            key: existing.key,
            value: updates.value !== undefined ? updates.value : existing.value,
            priority: (updates.priority as 'high' | 'medium' | 'low') || existing.metadata.priority,
            tags: (updates.tags as string[]) || existing.tags,
          });
          return { success: true, id: updated.id };
        }
        case 'episodic': {
          const success = memoryManager.getStorage().updateEpisode(id, updates);
          return { success, id };
        }
        case 'semantic': {
          const success = memoryManager.getStorage().updateEntity(id, updates);
          return { success, id };
        }
        default:
          return { success: false, error: `Unknown type: ${type}` };
      }
    },

    /**
     * Unified memory forget - delete or decay memories
     */
    memory_forget: (args: z.infer<typeof UnifiedMemoryForgetSchema>) => {
      const { id, type, key, tags, older_than_days } = args;
      let deleted = 0;

      // Delete by specific ID/key
      if (id && type) {
        switch (type) {
          case 'working':
            if (memoryManager.working.delete(id)) deleted++;
            break;
          case 'episodic':
            if (memoryManager.getStorage().deleteEpisode(id)) deleted++;
            break;
          case 'semantic':
            if (memoryManager.getStorage().deleteEntity(id)) deleted++;
            break;
        }
      } else if (key) {
        if (memoryManager.working.delete(key)) deleted++;
      }

      // Delete by tags (episodic only for now)
      if (tags && tags.length > 0) {
        const episodes = memoryManager.episodic.search({ tags, limit: 1000 });
        for (const ep of episodes) {
          if (memoryManager.getStorage().deleteEpisode(ep.id)) deleted++;
        }
      }

      // Decay old memories
      if (older_than_days) {
        const result = memoryManager.applyEbbinghausDecay({
          olderThanDays: older_than_days,
          minImportance: 1,
        });
        return { success: true, deleted, decayed: result.updated };
      }

      return { success: true, deleted };
    },

    // ============================================================================
    // Tachikoma Parallelization Tools
    // ============================================================================

    tachikoma_init: (args: z.infer<typeof TachikomaInitSchema>) => {
      const profile = storage.initTachikoma(args.tachikoma_id, args.tachikoma_name);
      return { success: true, profile };
    },

    tachikoma_status: (args: z.infer<typeof TachikomaStatusSchema>) => {
      const profile = storage.getTachikomaProfile();
      if (!profile) {
        return { success: false, error: 'Tachikoma not initialized. Run tachikoma_init first.' };
      }

      const result: {
        success: boolean;
        tachikomaId: string;
        tachikomaName?: string;
        syncSeq: number;
        syncVector: Record<string, number>;
        lastSyncAt?: number;
        pendingConflicts: number;
        history?: unknown[];
      } = {
        success: true,
        tachikomaId: profile.id,
        tachikomaName: profile.name,
        syncSeq: profile.syncSeq,
        syncVector: profile.syncVector,
        lastSyncAt: profile.lastSyncAt,
        pendingConflicts: storage.listConflicts(true).length,
      };

      if (args.include_history) {
        result.history = storage.listSyncHistory(args.history_limit);
      }

      return result;
    },

    tachikoma_export: (args: z.infer<typeof TachikomaExportSchema>) => {
      try {
        const exportData = storage.exportDelta(args.since_timestamp);

        // If output_path is specified, write to file
        if (args.output_path) {
          fs.writeFileSync(args.output_path, JSON.stringify(exportData, null, 2), 'utf-8');
        }

        return {
          success: true,
          data: exportData,
          itemCount: {
            working: exportData.delta.working.length,
            episodic: exportData.delta.episodic.length,
            semantic: {
              entities: exportData.delta.semantic.entities.length,
              relations: exportData.delta.semantic.relations.length,
            },
          },
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },

    tachikoma_import: (args: z.infer<typeof TachikomaImportSchema>) => {
      try {
        const result = storage.importDelta(args.data as any, {
          strategy: args.strategy as any,
          autoResolve: args.auto_resolve,
        });
        return result;
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },

    tachikoma_conflicts: (args: z.infer<typeof TachikomaConflictsSchema>) => {
      const conflicts = storage.listConflicts(args.unresolved_only);
      return { success: true, conflicts, count: conflicts.length };
    },

    tachikoma_resolve_conflict: (args: z.infer<typeof TachikomaResolveConflictSchema>) => {
      storage.resolveConflict(args.conflict_id, args.resolution);
      return { success: true };
    },

    // ============================================================================
    // Agent Management Tools
    // ============================================================================

    agent_register: (args: z.infer<typeof AgentRegisterSchema>) => {
      const agent = storage.createAgent({
        name: args.name,
        role: args.role,
        specializations: args.specializations,
        capabilities: args.capabilities,
        knowledgeDomains: args.knowledge_domains,
      });
      return { success: true, agent };
    },

    agent_get: (args: z.infer<typeof AgentGetSchema>) => {
      const agent = storage.getAgent(args.id);
      return agent ? { success: true, agent } : { success: false, error: 'Agent not found' };
    },

    agent_list: (args: z.infer<typeof AgentListSchema>) => {
      const agents = storage.listAgents({
        role: args.role,
        activeWithinMs: args.active_within_hours ? args.active_within_hours * 60 * 60 * 1000 : undefined,
      });
      return { success: true, agents, count: agents.length };
    },

    // ============================================================================
    // Pattern Tools
    // ============================================================================

    pattern_create: (args: z.infer<typeof PatternCreateSchema>) => {
      const pattern = storage.createPattern({
        pattern: args.pattern,
        supportingEpisodes: args.supporting_episodes,
        relatedTags: args.related_tags,
        confidence: args.confidence,
      });
      return { success: true, pattern };
    },

    pattern_get: (args: z.infer<typeof PatternGetSchema>) => {
      const pattern = storage.getPattern(args.id);
      return pattern ? { success: true, pattern } : { success: false, error: 'Pattern not found' };
    },

    pattern_list: (args: z.infer<typeof PatternListSchema>) => {
      const patterns = storage.listPatterns({
        query: args.query,
        status: args.status,
        minConfidence: args.min_confidence,
        minFrequency: args.min_frequency,
        limit: args.limit,
      });
      return { success: true, patterns, count: patterns.length };
    },

    pattern_confirm: (args: z.infer<typeof PatternConfirmSchema>) => {
      storage.updatePatternStatus(args.id, args.confirmed ? 'confirmed' : 'rejected');
      return { success: true };
    },

    // ============================================================================
    // Insight Tools
    // ============================================================================

    insight_create: (args: z.infer<typeof InsightCreateSchema>) => {
      const insight = storage.createInsight({
        insight: args.insight,
        reasoning: args.reasoning,
        sourcePatterns: args.source_patterns,
        domains: args.domains,
        confidence: args.confidence,
      });
      return { success: true, insight };
    },

    insight_get: (args: z.infer<typeof InsightGetSchema>) => {
      const insight = storage.getInsight(args.id);
      return insight ? { success: true, insight } : { success: false, error: 'Insight not found' };
    },

    insight_list: (args: z.infer<typeof InsightListSchema>) => {
      const insights = storage.listInsights({
        query: args.query,
        status: args.status,
        minConfidence: args.min_confidence,
        limit: args.limit,
      });
      return { success: true, insights, count: insights.length };
    },

    insight_validate: (args: z.infer<typeof InsightValidateSchema>) => {
      storage.updateInsightStatus(args.id, args.validated ? 'validated' : 'rejected');
      return { success: true };
    },

    // ============================================================================
    // Wisdom Tools
    // ============================================================================

    wisdom_create: (args: z.infer<typeof WisdomCreateSchema>) => {
      const wisdom = storage.createWisdom({
        name: args.name,
        principle: args.principle,
        description: args.description,
        derivedFromInsights: args.derived_from_insights,
        derivedFromPatterns: args.derived_from_patterns,
        evidenceEpisodes: args.evidence_episodes,
        applicableDomains: args.applicable_domains,
        applicableContexts: args.applicable_contexts,
        limitations: args.limitations,
        tags: args.tags,
      });
      return { success: true, wisdom };
    },

    wisdom_get: (args: z.infer<typeof WisdomGetSchema>) => {
      const wisdom = storage.getWisdom(args.identifier);
      return wisdom ? { success: true, wisdom } : { success: false, error: 'Wisdom not found' };
    },

    wisdom_search: (args: z.infer<typeof WisdomSearchSchema>) => {
      const wisdom = storage.listWisdom({
        query: args.query,
        domains: args.domains,
        minConfidence: args.min_confidence,
        limit: args.limit,
      });
      return { success: true, wisdom, count: wisdom.length };
    },

    wisdom_apply: (args: z.infer<typeof WisdomApplySchema>) => {
      const application = storage.recordWisdomApplication({
        wisdomId: args.wisdom_id,
        context: args.context,
        result: args.result,
        feedback: args.feedback,
      });
      return { success: true, application };
    },

    // ============================================================================
    // Shared Memory Tools (Multi-Agent)
    // Uses team-shared storage if available, otherwise falls back to individual storage
    // ============================================================================

    shared_memory_set: (args: z.infer<typeof SharedMemorySetSchema>) => {
      const sharedStore = context.sharedStorage ?? storage;
      const namespace = args.namespace ?? context.auth?.team ?? 'default';
      const id = `shm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const now = Date.now();

      sharedStore.setSharedMemoryItem({
        id,
        key: args.key,
        namespace,
        value: args.value,
        visibility: args.visibility ?? ['*'],
        owner: context.auth?.clientId ?? 'anonymous',
        vectorClock: {},
        tags: args.tags ?? [],
        createdAt: now,
        updatedAt: now,
        syncSeq: 0,
      });

      return { success: true, id, key: args.key, namespace };
    },

    shared_memory_get: (args: z.infer<typeof SharedMemoryGetSchema>) => {
      const sharedStore = context.sharedStorage ?? storage;
      const namespace = args.namespace ?? context.auth?.team ?? 'default';
      const item = sharedStore.getSharedMemoryItem(namespace, args.key);
      return item
        ? { success: true, item }
        : { success: false, error: 'Item not found' };
    },

    shared_memory_delete: (args: z.infer<typeof SharedMemoryDeleteSchema>) => {
      const sharedStore = context.sharedStorage ?? storage;
      const namespace = args.namespace ?? context.auth?.team ?? 'default';
      const deleted = sharedStore.deleteSharedMemoryItem(namespace, args.key);
      return { success: deleted };
    },

    shared_memory_list: (args: z.infer<typeof SharedMemoryListSchema>) => {
      const sharedStore = context.sharedStorage ?? storage;
      const namespace = args.namespace ?? context.auth?.team ?? 'default';
      const items = sharedStore.listSharedMemoryItems(namespace, {
        owner: args.owner,
        tags: args.tags,
      }).slice(0, args.limit);
      return { success: true, items, count: items.length };
    },

    shared_memory_search: (args: z.infer<typeof SharedMemorySearchSchema>) => {
      const sharedStore = context.sharedStorage ?? storage;
      const namespace = args.namespace ?? context.auth?.team ?? 'default';
      const items = sharedStore.searchSharedMemory(namespace, args.query, args.limit);
      return { success: true, items, count: items.length };
    },

    team_sync_request: (args: z.infer<typeof TeamSyncRequestSchema>) => {
      // This is a placeholder - actual sync is handled by WebSocket/EventDrivenSyncManager
      return {
        success: true,
        message: 'Sync request queued',
        targetAgent: args.target_agent ?? 'all',
        sinceTimestamp: args.since_timestamp ?? 0,
      };
    },

    agent_memory_read: (args: z.infer<typeof AgentMemoryReadSchema>) => {
      // This requires manager permission - checked by scoped manager in production
      // Placeholder implementation returns permission error
      return {
        success: false,
        error: 'Cross-agent memory access requires manager permission level',
        agentId: args.agent_id,
        key: args.key,
      };
    },

    permission_grant: (args: z.infer<typeof PermissionGrantSchema>) => {
      // This requires manager permission - checked by scoped manager in production
      // Placeholder implementation
      return {
        success: false,
        error: 'Permission management requires manager permission level',
        targetAgent: args.target_agent,
        scopes: args.scopes,
      };
    },

    audit_query: (args: z.infer<typeof AuditQuerySchema>) => {
      const entries = storage.queryAuditLog({
        actor: args.actor,
        action: args.action,
        resourceType: args.resource_type,
        result: args.result,
        team: args.team,
        startTime: args.start_time,
        endTime: args.end_time,
        limit: args.limit,
      });
      return { success: true, entries, count: entries.length };
    },

    // ============================================================================
    // Invite Code Tools (Self-service Registration)
    // ============================================================================

    invite_create: (args: z.infer<typeof InviteCreateSchema>) => {
      // Check if caller has manager permission
      if (!context.auth) {
        return { success: false, error: 'Authentication required' };
      }
      if (context.auth.permissionLevel !== 'manager') {
        return { success: false, error: 'Manager permission required to create invites' };
      }
      if (!context.auth.team) {
        return { success: false, error: 'Team membership required to create invites' };
      }

      const invite = createInviteCode(
        context.auth.team,
        context.auth.clientId,
        {
          level: args.level,
          maxUses: args.max_uses,
          expiresInHours: args.expires_in_hours,
          description: args.description,
        },
        context.apiKeysFilePath
      );

      return {
        success: true,
        invite: {
          code: invite.code,
          teamId: invite.teamId,
          permissionLevel: invite.permissionLevel,
          expiresAt: invite.expiresAt,
          maxUses: invite.maxUses,
          description: invite.description,
        },
        message: 'Share this invite code with new agents. They can register at POST /register',
      };
    },

    invite_list: (args: z.infer<typeof InviteListSchema>) => {
      // Check if caller has manager permission
      if (!context.auth) {
        return { success: false, error: 'Authentication required' };
      }
      if (context.auth.permissionLevel !== 'manager') {
        return { success: false, error: 'Manager permission required to list invites' };
      }
      if (!context.auth.team) {
        return { success: false, error: 'Team membership required' };
      }

      const invites = listInviteCodes(context.auth.team, args.include_expired);

      // Return sanitized invite info
      const sanitizedInvites = invites.map(inv => ({
        code: inv.code,
        permissionLevel: inv.permissionLevel,
        createdAt: inv.createdAt,
        expiresAt: inv.expiresAt,
        maxUses: inv.maxUses,
        useCount: inv.useCount,
        active: inv.active,
        description: inv.description,
        usedBy: inv.usedBy,
      }));

      return { success: true, invites: sanitizedInvites, count: sanitizedInvites.length };
    },

    invite_get: (args: z.infer<typeof InviteGetSchema>) => {
      // Check if caller has manager permission
      if (!context.auth) {
        return { success: false, error: 'Authentication required' };
      }
      if (context.auth.permissionLevel !== 'manager') {
        return { success: false, error: 'Manager permission required' };
      }

      const invite = getInviteCode(args.code);
      if (!invite) {
        return { success: false, error: 'Invite code not found' };
      }

      // Verify caller owns this invite
      if (invite.teamId !== context.auth.team) {
        return { success: false, error: 'Invite belongs to a different team' };
      }

      return {
        success: true,
        invite: {
          code: invite.code,
          teamId: invite.teamId,
          permissionLevel: invite.permissionLevel,
          createdBy: invite.createdBy,
          createdAt: invite.createdAt,
          expiresAt: invite.expiresAt,
          maxUses: invite.maxUses,
          useCount: invite.useCount,
          active: invite.active,
          description: invite.description,
          usedBy: invite.usedBy,
        },
      };
    },

    invite_revoke: (args: z.infer<typeof InviteRevokeSchema>) => {
      // Check if caller has manager permission
      if (!context.auth) {
        return { success: false, error: 'Authentication required' };
      }
      if (context.auth.permissionLevel !== 'manager') {
        return { success: false, error: 'Manager permission required to revoke invites' };
      }

      const invite = getInviteCode(args.code);
      if (!invite) {
        return { success: false, error: 'Invite code not found' };
      }

      // Verify caller owns this invite
      if (invite.teamId !== context.auth.team) {
        return { success: false, error: 'Invite belongs to a different team' };
      }

      const success = revokeInviteCode(args.code, context.apiKeysFilePath);
      return { success, message: success ? 'Invite code revoked' : 'Failed to revoke invite' };
    },
  };
}

// Tool definitions for MCP registration
export const toolDefinitions = [
  {
    name: 'working_set',
    description: 'Store a value in working memory with optional TTL',
    inputSchema: WorkingSetSchema,
  },
  {
    name: 'working_get',
    description: 'Retrieve a value from working memory',
    inputSchema: WorkingGetSchema,
  },
  {
    name: 'working_delete',
    description: 'Remove a value from working memory',
    inputSchema: WorkingDeleteSchema,
  },
  {
    name: 'working_list',
    description: 'List all working memory items',
    inputSchema: WorkingListSchema,
  },
  {
    name: 'working_clear',
    description: 'Clear expired or all working memory items',
    inputSchema: WorkingClearSchema,
  },
  {
    name: 'episode_record',
    description: 'Record a new episode in episodic memory',
    inputSchema: EpisodeRecordSchema,
  },
  {
    name: 'episode_get',
    description: 'Retrieve an episode by ID',
    inputSchema: EpisodeGetSchema,
  },
  {
    name: 'episode_search',
    description: 'Search episodes with full-text and filters',
    inputSchema: EpisodeSearchSchema,
  },
  {
    name: 'episode_update',
    description: 'Update episode outcome, learnings, or importance',
    inputSchema: EpisodeUpdateSchema,
  },
  {
    name: 'episode_relate',
    description: 'Create a relation between two episodes',
    inputSchema: EpisodeRelateSchema,
  },
  {
    name: 'semantic_create',
    description: 'Create a new semantic entity (fact, procedure, pattern, etc.)',
    inputSchema: SemanticCreateSchema,
  },
  {
    name: 'semantic_get',
    description: 'Get a semantic entity by ID or name',
    inputSchema: SemanticGetSchema,
  },
  {
    name: 'semantic_search',
    description: 'Search semantic entities with full-text and filters',
    inputSchema: SemanticSearchSchema,
  },
  {
    name: 'semantic_add_observation',
    description: 'Add an observation to a semantic entity',
    inputSchema: SemanticAddObservationSchema,
  },
  {
    name: 'semantic_relate',
    description: 'Create a relation between two semantic entities',
    inputSchema: SemanticRelateSchema,
  },
  {
    name: 'semantic_update',
    description: 'Update a semantic entity',
    inputSchema: SemanticUpdateSchema,
  },
  {
    name: 'memory_consolidate',
    description: 'Promote working memory to episodic or semantic memory',
    inputSchema: MemoryConsolidateSchema,
  },
  {
    name: 'memory_recall',
    description: 'Intelligent recall across all memory layers',
    inputSchema: MemoryRecallSchema,
  },
  {
    name: 'memory_stats',
    description: 'Get memory usage statistics',
    inputSchema: z.object({}),
  },
  // Tachikoma Parallelization Tools
  {
    name: 'tachikoma_init',
    description: 'Initialize Tachikoma parallelization (set individual ID and name)',
    inputSchema: TachikomaInitSchema,
  },
  {
    name: 'tachikoma_status',
    description: 'Get Tachikoma sync status and optionally sync history',
    inputSchema: TachikomaStatusSchema,
  },
  {
    name: 'tachikoma_export',
    description: 'Export memories as delta for parallelization with other Tachikoma instances',
    inputSchema: TachikomaExportSchema,
  },
  {
    name: 'tachikoma_import',
    description: 'Import and merge memories from another Tachikoma instance',
    inputSchema: TachikomaImportSchema,
  },
  {
    name: 'tachikoma_conflicts',
    description: 'List pending conflicts from memory merges',
    inputSchema: TachikomaConflictsSchema,
  },
  {
    name: 'tachikoma_resolve_conflict',
    description: 'Resolve a merge conflict manually',
    inputSchema: TachikomaResolveConflictSchema,
  },
  // Agent Management Tools
  {
    name: 'agent_register',
    description: 'Register a new agent with role and specializations',
    inputSchema: AgentRegisterSchema,
  },
  {
    name: 'agent_get',
    description: 'Get agent profile by ID',
    inputSchema: AgentGetSchema,
  },
  {
    name: 'agent_list',
    description: 'List agents with optional role and activity filters',
    inputSchema: AgentListSchema,
  },
  // Pattern Tools
  {
    name: 'pattern_create',
    description: 'Create a new pattern from episodic observations',
    inputSchema: PatternCreateSchema,
  },
  {
    name: 'pattern_get',
    description: 'Get a pattern by ID',
    inputSchema: PatternGetSchema,
  },
  {
    name: 'pattern_list',
    description: 'List patterns with optional filters',
    inputSchema: PatternListSchema,
  },
  {
    name: 'pattern_confirm',
    description: 'Confirm or reject a pattern',
    inputSchema: PatternConfirmSchema,
  },
  // Insight Tools
  {
    name: 'insight_create',
    description: 'Create an insight from patterns',
    inputSchema: InsightCreateSchema,
  },
  {
    name: 'insight_get',
    description: 'Get an insight by ID',
    inputSchema: InsightGetSchema,
  },
  {
    name: 'insight_list',
    description: 'List insights with optional filters',
    inputSchema: InsightListSchema,
  },
  {
    name: 'insight_validate',
    description: 'Validate or reject an insight',
    inputSchema: InsightValidateSchema,
  },
  // Wisdom Tools
  {
    name: 'wisdom_create',
    description: 'Create wisdom from insights and patterns (DIKW Level 4)',
    inputSchema: WisdomCreateSchema,
  },
  {
    name: 'wisdom_get',
    description: 'Get wisdom by ID or name',
    inputSchema: WisdomGetSchema,
  },
  {
    name: 'wisdom_search',
    description: 'Search wisdom by query and domains',
    inputSchema: WisdomSearchSchema,
  },
  {
    name: 'wisdom_apply',
    description: 'Record wisdom application result',
    inputSchema: WisdomApplySchema,
  },
  // Shared Memory Tools (Multi-Agent)
  {
    name: 'shared_memory_set',
    description: 'Store a value in the shared memory pool (accessible by team members)',
    inputSchema: SharedMemorySetSchema,
  },
  {
    name: 'shared_memory_get',
    description: 'Retrieve a value from the shared memory pool',
    inputSchema: SharedMemoryGetSchema,
  },
  {
    name: 'shared_memory_delete',
    description: 'Delete a value from the shared memory pool',
    inputSchema: SharedMemoryDeleteSchema,
  },
  {
    name: 'shared_memory_list',
    description: 'List items in the shared memory pool',
    inputSchema: SharedMemoryListSchema,
  },
  {
    name: 'shared_memory_search',
    description: 'Search for items in the shared memory pool',
    inputSchema: SharedMemorySearchSchema,
  },
  {
    name: 'team_sync_request',
    description: 'Request synchronization with team members',
    inputSchema: TeamSyncRequestSchema,
  },
  {
    name: 'agent_memory_read',
    description: 'Read another agent\'s memory (manager permission required)',
    inputSchema: AgentMemoryReadSchema,
  },
  {
    name: 'permission_grant',
    description: 'Grant permission to another agent (manager permission required)',
    inputSchema: PermissionGrantSchema,
  },
  {
    name: 'audit_query',
    description: 'Query the audit log for access history',
    inputSchema: AuditQuerySchema,
  },
  // Invite Code Tools (Self-service Registration)
  {
    name: 'invite_create',
    description: 'Create an invite code for new agents to self-register (manager only). Share the code with agents who can then POST to /register endpoint.',
    inputSchema: InviteCreateSchema,
  },
  {
    name: 'invite_list',
    description: 'List all invite codes for your team (manager only)',
    inputSchema: InviteListSchema,
  },
  {
    name: 'invite_get',
    description: 'Get details of a specific invite code (manager only)',
    inputSchema: InviteGetSchema,
  },
  {
    name: 'invite_revoke',
    description: 'Revoke an invite code to prevent further use (manager only)',
    inputSchema: InviteRevokeSchema,
  },
];
