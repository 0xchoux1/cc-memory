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

// Transcript types for recording full conversation history
export interface TranscriptMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  toolCalls?: Array<{
    name: string;
    input?: unknown;
    output?: unknown;
  }>;
}

export type Transcript = TranscriptMessage[];

export interface TranscriptMetadata {
  messageCount: number;
  totalChars: number;
  hasTranscript: boolean;
}

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
  transcriptMetadata?: TranscriptMetadata;
  /** Emotional valence: -1.0 (negative) to +1.0 (positive) */
  valence: number;
  /** Emotional arousal: 0.0 (calm) to 1.0 (excited) */
  arousal: number;
}

export interface EpisodicMemoryInput {
  type: EpisodeType;
  summary: string;
  details: string;
  context?: Partial<EpisodeContext>;
  outcome?: EpisodeOutcome;
  importance?: number;
  tags?: string[];
  transcript?: Transcript;
  /** Emotional valence: -1.0 (negative) to +1.0 (positive). Auto-set based on type if not provided. */
  valence?: number;
  /** Emotional arousal: 0.0 (calm) to 1.0 (excited). Auto-set based on type if not provided. */
  arousal?: number;
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
  searchTranscript?: boolean;
}

// ============================================================================
// Semantic Memory Types
// ============================================================================

export type SemanticEntityType = 'procedure' | 'fact' | 'config' | 'preference' | 'pattern' | 'skill' | 'goal';
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

export interface MemoryDashboard {
  /** Top N most frequently accessed memories */
  topAccessed: Array<{
    type: 'episodic' | 'semantic';
    id: string;
    name: string;
    accessCount: number;
    lastAccessed: number;
  }>;
  /** Entity/episode counts by type */
  countsByType: {
    episodic: Record<string, number>;
    semantic: Record<string, number>;
  };
  /** Recently added items */
  recentAdditions: Array<{
    type: 'working' | 'episodic' | 'semantic';
    id: string;
    name: string;
    createdAt: number;
  }>;
  /** Memories near decay threshold (importance < 3) */
  nearDecayThreshold: Array<{
    type: 'episodic';
    id: string;
    summary: string;
    importance: number;
  }>;
  /** Orphaned semantic entities (no relations) */
  orphanedEntities: Array<{
    id: string;
    name: string;
    type: string;
  }>;
  /** Knowledge graph statistics */
  graphStats: {
    totalNodes: number;
    totalEdges: number;
    averageDegree: number;
    density: number;
  };
  /** General statistics */
  stats: MemoryStats;
  /** Dashboard generation timestamp */
  generatedAt: number;
}

export interface MemoryExport {
  version: string;
  exportedAt: number;
  working: WorkingMemoryItem[];
  episodic: EpisodicMemory[];
  transcripts?: Record<string, Transcript>;
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

// ============================================================================
// Agent Types (for multi-agent collaboration)
// ============================================================================

export type AgentRole =
  | 'frontend'      // フロントエンド開発
  | 'backend'       // バックエンド開発
  | 'security'      // セキュリティ
  | 'testing'       // テスト・QA
  | 'devops'        // インフラ・運用
  | 'architecture'  // アーキテクチャ設計
  | 'data'          // データエンジニアリング
  | 'general';      // 汎用

export interface AgentProfile {
  id: string;
  name: string;
  role: AgentRole;
  specializations: string[];  // より詳細な専門領域
  capabilities: string[];     // 実行可能なタスク
  knowledgeDomains: string[]; // 知識ドメイン
  createdAt: number;
  lastActiveAt: number;
}

export interface AgentProfileInput {
  name: string;
  role: AgentRole;
  specializations?: string[];
  capabilities?: string[];
  knowledgeDomains?: string[];
}

export interface AgentContext {
  agentId: string;
  role: AgentRole;
  sessionId: string;
  currentTask?: string;
}

// ============================================================================
// Tachikoma Parallelization Types
// ============================================================================

/** タチコマ個体を識別するユニークなID */
export type TachikomaId = string;

/** 並列化の同期ベクター（論理クロック） */
export interface SyncVector {
  [tachikomaId: TachikomaId]: number;
}

/** 並列化メタデータ */
export interface ParallelizationMeta {
  originId: TachikomaId;       // 記憶を生成した個体のID
  originName?: string;         // 個体の名前
  syncSeq: number;             // この記憶のシーケンス番号
  syncedAt?: number;           // 最後に同期された時刻
  syncVector: SyncVector;      // 同期時点のベクタークロック
}

/** タチコマプロファイル */
export interface TachikomaProfile {
  id: TachikomaId;
  name?: string;
  syncSeq: number;
  syncVector: SyncVector;
  lastSyncAt?: number;
  createdAt: number;
}

/** 競合解決戦略 */
export type ConflictStrategy =
  | 'newer_wins'           // 新しい方を採用
  | 'higher_importance'    // importance が高い方を採用（Episodic）
  | 'higher_confidence'    // confidence が高い方を採用（Semantic）
  | 'merge_observations'   // observations を統合（Semantic）
  | 'merge_learnings'      // learnings を統合（Episodic）
  | 'manual';              // 手動解決が必要

/** 競合レコード */
export interface ConflictRecord {
  id: string;
  memoryType: 'working' | 'episodic' | 'semantic';
  localItem: unknown;
  remoteItem: unknown;
  strategy: ConflictStrategy;
  createdAt: number;
  resolvedAt?: number;
  resolution?: 'local' | 'remote' | 'merged';
}

/** 並列化差分エクスポート形式 */
export interface ParallelizationExport {
  version: string;
  format: 'tachikoma-parallelize-delta';
  tachikomaId: TachikomaId;
  tachikomaName?: string;
  exportedAt: number;
  syncVector: SyncVector;

  delta: {
    working: WorkingMemoryItem[];
    episodic: EpisodicMemory[];
    semantic: {
      entities: SemanticEntity[];
      relations: SemanticRelation[];
    };
  };

  deleted: {
    working: string[];
    episodic: string[];
    semantic: {
      entities: string[];
      relations: string[];
    };
  };
}

/** 並列化の結果 */
export interface ParallelizationResult {
  success: boolean;
  merged: {
    working: number;
    episodic: number;
    semantic: { entities: number; relations: number };
  };
  conflicts: ConflictRecord[];
  skipped: number;
  syncVector: SyncVector;
}

/** 並列化設定 */
export interface ParallelizationConfig {
  conflictStrategy: {
    working: ConflictStrategy;
    episodic: ConflictStrategy;
    semantic: ConflictStrategy;
  };
  autoResolve: boolean;
  preserveIndividuality: boolean;
}

export const DEFAULT_PARALLELIZATION_CONFIG: ParallelizationConfig = {
  conflictStrategy: {
    working: 'newer_wins',
    episodic: 'merge_learnings',
    semantic: 'merge_observations',
  },
  autoResolve: true,
  preserveIndividuality: true,
};

// ============================================================================
// Knowledge Level Types (DIKW Model)
// ============================================================================

/** 知識レベル（DIKW モデル） */
export type KnowledgeLevel =
  | 'raw_experience'  // 生の体験（Level 1）
  | 'pattern'         // パターン（Level 2）
  | 'insight'         // 洞察（Level 3）
  | 'wisdom';         // 知恵（Level 4）

/** 知識レベルメタデータ */
export interface KnowledgeLevelMetadata {
  level: KnowledgeLevel;
  derivedFrom?: string[];      // 導出元の記憶ID
  derivedCount?: number;       // 導出に使用した記憶の数
  abstractionDepth?: number;   // 抽象化の深さ
  validationScore?: number;    // 検証スコア（0-1）
  applicabilityScope?: string[]; // 適用可能なスコープ
}

// ============================================================================
// Pattern Types
// ============================================================================

export type PatternStatus = 'candidate' | 'confirmed' | 'rejected';

export interface Pattern {
  id: string;
  pattern: string;              // パターンの説明
  frequency: number;            // 出現頻度
  confidence: number;           // 信頼度（0-1）
  supportingEpisodes: string[]; // 根拠となるエピソードID
  relatedTags: string[];        // 関連タグ
  agentRoles: AgentRole[];      // 発見に貢献したエージェントロール
  sourceAgentId?: string;       // 発見したエージェントID
  status: PatternStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PatternInput {
  pattern: string;
  supportingEpisodes?: string[];
  relatedTags?: string[];
  confidence?: number;
}

export interface PatternQuery {
  query?: string;
  status?: PatternStatus;
  minConfidence?: number;
  minFrequency?: number;
  agentRoles?: AgentRole[];
  limit?: number;
}

// ============================================================================
// Insight Types
// ============================================================================

export type InsightStatus = 'candidate' | 'validated' | 'rejected';

export interface Insight {
  id: string;
  insight: string;              // 洞察の内容
  reasoning: string;            // 導出の理由
  sourcePatterns: string[];     // 導出元のパターンID
  confidence: number;           // 信頼度（0-1）
  novelty: number;              // 新規性スコア（0-1）
  utility: number;              // 有用性スコア（0-1）
  domains: string[];            // 適用ドメイン
  sourceAgentId?: string;       // 生成したエージェントID
  validatedBy: string[];        // 検証したエージェントID
  status: InsightStatus;
  knowledgeLevel: KnowledgeLevel;
  createdAt: number;
  updatedAt: number;
}

export interface InsightInput {
  insight: string;
  reasoning?: string;
  sourcePatterns?: string[];
  domains?: string[];
  confidence?: number;
}

export interface InsightQuery {
  query?: string;
  status?: InsightStatus;
  domains?: string[];
  minConfidence?: number;
  limit?: number;
}

// ============================================================================
// Wisdom Types
// ============================================================================

export interface WisdomEntity {
  id: string;
  name: string;
  principle: string;            // 知恵の本質（一文で表現）
  description: string;          // 詳細な説明

  // 導出情報
  derivedFromInsights: string[];
  derivedFromPatterns: string[];
  evidenceEpisodes: string[];

  // 適用性
  applicableDomains: string[];
  applicableContexts: string[];
  limitations: string[];

  // 検証情報
  validationCount: number;
  successfulApplications: number;
  failedApplications: number;
  confidenceScore: number;      // 0-1

  // メタデータ
  createdBy?: string;           // 作成エージェントID
  contributingAgents: string[];
  version: number;
  tags: string[];
  relatedWisdom: string[];
  contradictoryWisdom: string[];

  createdAt: number;
  updatedAt: number;
}

export interface WisdomEntityInput {
  name: string;
  principle: string;
  description: string;
  derivedFromInsights?: string[];
  derivedFromPatterns?: string[];
  evidenceEpisodes?: string[];
  applicableDomains?: string[];
  applicableContexts?: string[];
  limitations?: string[];
  tags?: string[];
}

export interface WisdomQuery {
  query?: string;
  domains?: string[];
  minConfidence?: number;
  limit?: number;
}

export interface WisdomApplication {
  id: string;
  wisdomId: string;
  episodeId?: string;
  context: string;
  result: 'success' | 'failure' | 'partial';
  feedback?: string;
  appliedBy?: string;
  appliedAt: number;
}

// ============================================================================
// Extended Memory Types (with agent/parallelization metadata)
// ============================================================================

/** エピソード記憶の拡張（エージェント情報付き） */
export interface ExtendedEpisodicMemory extends EpisodicMemory {
  agentId?: string;
  agentRole?: AgentRole;
  contributingAgents?: string[];
  knowledgeLevel: KnowledgeLevel;
  derivedPatterns?: string[];
  // Parallelization metadata
  originId?: TachikomaId;
  originName?: string;
  syncSeq?: number;
}

/** セマンティック実体の拡張（エージェント情報付き） */
export interface ExtendedSemanticEntity extends SemanticEntity {
  sourceAgentId?: string;
  sourceAgentRole?: AgentRole;
  validatedBy?: string[];
  crossDomainRelevance?: { domain: string; relevance: number }[];
  knowledgeLevel: KnowledgeLevel;
  derivedFrom?: string[];
  // Parallelization metadata
  originId?: TachikomaId;
  originName?: string;
  syncSeq?: number;
}

// ============================================================================
// Sync History Types
// ============================================================================

export type SyncType = 'export' | 'import' | 'merge';

export interface SyncHistoryEntry {
  id: string;
  remoteTachikomaId: TachikomaId;
  remoteTachikomaName?: string;
  syncType: SyncType;
  itemsCount: number;
  conflictsCount: number;
  syncVector: SyncVector;
  createdAt: number;
}

// ============================================================================
// Goal Tracking Types (P5)
// ============================================================================

export type GoalStatus = 'active' | 'completed' | 'abandoned';

export interface GoalContent {
  /** Description of the goal */
  description: string;
  /** Success criteria for the goal */
  successCriteria: string[];
  /** Optional deadline timestamp */
  deadline?: number;
  /** Current status */
  status: GoalStatus;
  /** Progress percentage (0-100) */
  progress: number;
  /** Related episode IDs that contribute to this goal */
  relatedEpisodes: string[];
  /** Keywords for searching related episodes */
  keywords: string[];
  /** Last time progress was checked */
  lastChecked: number;
}

export interface GoalInput {
  /** Name/title of the goal */
  name: string;
  /** Description of what needs to be achieved */
  description: string;
  /** Criteria that define success */
  successCriteria: string[];
  /** Optional deadline */
  deadline?: number;
  /** Keywords to search for related episodes */
  keywords?: string[];
  /** Tags for categorization */
  tags?: string[];
}

export interface GoalProgress {
  /** Goal ID */
  goalId: string;
  /** Goal name */
  name: string;
  /** Current status */
  status: GoalStatus;
  /** Progress percentage (0-100) */
  progress: number;
  /** Number of related episodes found */
  relatedEpisodeCount: number;
  /** Summary of recent activity */
  recentActivity: string[];
  /** Estimated completion based on trajectory */
  estimatedCompletion?: 'on_track' | 'at_risk' | 'behind' | 'completed';
}
