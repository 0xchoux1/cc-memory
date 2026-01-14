/**
 * Type definitions for the hierarchical memory system
 */

// ============================================================================
// Working Memory Types
// ============================================================================

export type WorkingMemoryType = 'task_state' | 'decision' | 'context' | 'scratch';
export type Priority = 'high' | 'medium' | 'low';

export interface WorkingMemoryItem {
  id: string;
  type: WorkingMemoryType;
  key: string;
  value: unknown;
  metadata: {
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
    sessionId: string;
    priority: Priority;
  };
  tags: string[];
}

export interface WorkingMemoryInput {
  key: string;
  value: unknown;
  type?: WorkingMemoryType;
  ttl?: number;
  priority?: Priority;
  tags?: string[];
}

export interface WorkingMemoryFilter {
  type?: WorkingMemoryType;
  tags?: string[];
  sessionId?: string;
  includeExpired?: boolean;
}

// Default TTL configurations (in milliseconds)
export const WORKING_MEMORY_TTL: Record<WorkingMemoryType, number> = {
  task_state: 24 * 60 * 60 * 1000,    // 24 hours
  decision: 4 * 60 * 60 * 1000,       // 4 hours
  context: 1 * 60 * 60 * 1000,        // 1 hour
  scratch: 30 * 60 * 1000,            // 30 minutes
};

// ============================================================================
// Episodic Memory Types
// ============================================================================

export type EpisodeType = 'incident' | 'interaction' | 'milestone' | 'error' | 'success';
export type OutcomeStatus = 'success' | 'failure' | 'partial';

export interface EpisodeContext {
  projectPath?: string;
  branch?: string;
  taskId?: string;
  sessionId: string;
  files?: string[];
}

export interface EpisodeOutcome {
  status: OutcomeStatus;
  learnings: string[];
  resolution?: string;
}

export interface EpisodicMemory {
  id: string;
  timestamp: number;
  type: EpisodeType;
  summary: string;
  details: string;
  context: EpisodeContext;
  outcome?: EpisodeOutcome;
  relatedEpisodes: string[];
  relatedEntities: string[];
  importance: number;
  accessCount: number;
  lastAccessed: number;
  tags: string[];
}

export interface EpisodicMemoryInput {
  type: EpisodeType;
  summary: string;
  details: string;
  context?: Partial<EpisodeContext>;
  outcome?: EpisodeOutcome;
  importance?: number;
  tags?: string[];
}

export interface EpisodeQuery {
  query?: string;
  type?: EpisodeType;
  dateRange?: {
    start?: number;
    end?: number;
  };
  tags?: string[];
  minImportance?: number;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Semantic Memory Types
// ============================================================================

export type SemanticEntityType = 'procedure' | 'fact' | 'config' | 'preference' | 'pattern' | 'skill';
export type EntitySource = 'user' | 'inferred' | 'system';

export interface Procedure {
  steps: string[];
  preconditions?: string[];
  postconditions?: string[];
}

export interface SemanticEntity {
  id: string;
  name: string;
  type: SemanticEntityType;
  description: string;
  content: unknown;
  procedure?: Procedure;
  observations: string[];
  confidence: number;
  source: EntitySource;
  createdAt: number;
  updatedAt: number;
  version: number;
  tags: string[];
}

export interface SemanticEntityInput {
  name: string;
  type: SemanticEntityType;
  description: string;
  content?: unknown;
  procedure?: Procedure;
  observations?: string[];
  confidence?: number;
  source?: EntitySource;
  tags?: string[];
}

export interface SemanticRelation {
  id: string;
  from: string;
  to: string;
  relationType: string;
  strength: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface SemanticQuery {
  query?: string;
  type?: SemanticEntityType;
  tags?: string[];
  minConfidence?: number;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Storage Types
// ============================================================================

export interface StorageConfig {
  dataPath: string;
  backupInterval?: number;
  cleanupInterval?: number;
}

export interface MemoryStats {
  working: {
    total: number;
    expired: number;
    byType: Record<WorkingMemoryType, number>;
  };
  episodic: {
    total: number;
    byType: Record<EpisodeType, number>;
    averageImportance: number;
  };
  semantic: {
    entities: number;
    relations: number;
    byType: Record<SemanticEntityType, number>;
  };
}

export interface MemoryExport {
  version: string;
  exportedAt: number;
  working: WorkingMemoryItem[];
  episodic: EpisodicMemory[];
  semantic: {
    entities: SemanticEntity[];
    relations: SemanticRelation[];
  };
}

// ============================================================================
// Retention Policy Types
// ============================================================================

export interface RetentionPolicy {
  working: {
    cleanupInterval: number;
    defaultTTL: number;
  };
  episodic: {
    maxEntries: number;
    minImportance: number;
    ageDecayFactor: number;
    accessBoostFactor: number;
  };
  semantic: {
    versionHistory: number;
    confidenceThreshold: number;
  };
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  working: {
    cleanupInterval: 5 * 60 * 1000,  // 5 minutes
    defaultTTL: 60 * 60 * 1000,      // 1 hour
  },
  episodic: {
    maxEntries: 1000,
    minImportance: 3,
    ageDecayFactor: 0.95,            // 5% decay per week
    accessBoostFactor: 1.1,          // 10% boost per access
  },
  semantic: {
    versionHistory: 5,
    confidenceThreshold: 0.3,
  },
};
