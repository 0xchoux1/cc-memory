/**
 * MCP Tool definitions for the memory server
 */

import { z } from 'zod';
import type { MemoryManager } from '../memory/MemoryManager.js';

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
});

export const EpisodeGetSchema = z.object({
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
});

export const MemoryDecaySchema = z.object({
  decay_factor: z.number().min(0).max(1).optional().default(0.95)
    .describe('Decay multiplier (0.95 = 5% decay)'),
  min_importance: z.number().min(1).max(10).optional().default(1)
    .describe('Minimum importance to decay to'),
  older_than_days: z.number().optional().default(7)
    .describe('Only decay memories older than this many days'),
});

export const MemoryBoostSchema = z.object({
  boost_factor: z.number().min(1).max(2).optional().default(1.1)
    .describe('Boost multiplier (1.1 = 10% boost)'),
  max_importance: z.number().min(1).max(10).optional().default(10)
    .describe('Maximum importance to boost to'),
  min_access_count: z.number().optional().default(5)
    .describe('Minimum access count to qualify for boost'),
});

// Tool handler factory
export function createToolHandlers(memoryManager: MemoryManager) {
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
      });
      return { success: true, episode };
    },

    episode_get: (args: z.infer<typeof EpisodeGetSchema>) => {
      const episode = memoryManager.episodic.get(args.id);
      return episode ? { success: true, episode } : { success: false, error: 'Episode not found' };
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
      });
      return {
        success: true,
        ...result,
        total: result.working.length + result.episodic.length + result.semantic.length,
      };
    },

    memory_decay: (args: z.infer<typeof MemoryDecaySchema>) => {
      const result = memoryManager.applyImportanceDecay({
        decayFactor: args.decay_factor,
        minImportance: args.min_importance,
        olderThanDays: args.older_than_days,
      });
      return { success: true, ...result };
    },

    memory_boost: (args: z.infer<typeof MemoryBoostSchema>) => {
      const result = memoryManager.applyAccessBoost({
        boostFactor: args.boost_factor,
        maxImportance: args.max_importance,
        minAccessCount: args.min_access_count,
      });
      return { success: true, ...result };
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
];
