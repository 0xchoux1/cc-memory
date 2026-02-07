/**
 * Memory Manager - Orchestrates all memory layers
 */

import { v7 as uuidv7 } from 'uuid';
import { SqliteStorage } from '../storage/SqliteStorage.js';
import { WorkingMemory, type WorkingMemoryConfig } from './WorkingMemory.js';
import { EpisodicMemory } from './EpisodicMemory.js';
import { SemanticMemory } from './SemanticMemory.js';
import { DIKWPipeline } from '../dikw/DIKWPipeline.js';
import type {
  StorageConfig,
  MemoryStats,
  MemoryExport,
  MemoryDashboard,
  WorkingMemoryItem,
  EpisodicMemory as EpisodicMemoryType,
  SemanticEntity,
  GoalInput,
  GoalContent,
  GoalProgress,
  GoalStatus,
} from './types.js';

export interface MemoryManagerConfig extends StorageConfig {
  sessionId?: string;
}

export interface RecallResult {
  working: WorkingMemoryItem[];
  episodic: EpisodicMemoryType[];
  semantic: SemanticEntity[];
}

export interface ScoredRecallResult {
  working: Array<WorkingMemoryItem & { relevanceScore: number }>;
  episodic: Array<EpisodicMemoryType & { relevanceScore: number }>;
  semantic: Array<SemanticEntity & { relevanceScore: number }>;
}

export class MemoryManager {
  public readonly working: WorkingMemory;
  public readonly episodic: EpisodicMemory;
  public readonly semantic: SemanticMemory;

  private storage: SqliteStorage;
  private sessionId: string;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: MemoryManagerConfig) {
    this.sessionId = config.sessionId || uuidv7();
    this.storage = new SqliteStorage(config);

    this.working = new WorkingMemory(this.storage, this.sessionId, {
      capacity: 7,
      onEvict: (item) => {
        // Auto-consolidate evicted items to episodic memory
        this.episodic.record({
          type: 'interaction',
          summary: `Working memory evicted: ${item.key}`,
          details: JSON.stringify(item.value, null, 2),
          importance: item.metadata.priority === 'high' ? 6 : item.metadata.priority === 'medium' ? 4 : 2,
          tags: [...item.tags, 'auto-consolidated', 'capacity-eviction'],
        });
      },
    });
    this.episodic = new EpisodicMemory(this.storage, this.sessionId);
    this.semantic = new SemanticMemory(this.storage);

    // Start cleanup interval
    if (config.cleanupInterval) {
      this.startCleanup(config.cleanupInterval);
    }
  }

  /**
   * Get the underlying storage instance for direct access to extended features
   * (Tachikoma, Agents, Patterns, Insights, Wisdom)
   */
  getStorage(): SqliteStorage {
    return this.storage;
  }

  /**
   * Wait for storage initialization to complete
   */
  async ready(): Promise<void> {
    await this.storage.ready();
  }

  /**
   * Start automatic cleanup of expired working memory
   */
  private startCleanup(interval: number): void {
    this.cleanupInterval = setInterval(() => {
      this.working.clearExpired();
    }, interval);
  }

  /**
   * Consolidate working memory to episodic or semantic memory
   */
  consolidateToEpisodic(
    workingKey: string,
    metadata: {
      type: EpisodicMemoryType['type'];
      summary: string;
      details?: string;
      importance?: number;
      tags?: string[];
    }
  ): EpisodicMemoryType | null {
    const workingItem = this.working.get(workingKey);
    if (!workingItem) return null;

    const episode = this.episodic.record({
      type: metadata.type,
      summary: metadata.summary,
      details: metadata.details || JSON.stringify(workingItem.value, null, 2),
      importance: metadata.importance,
      tags: [...(metadata.tags || []), ...workingItem.tags],
    });

    // Delete the working memory item after consolidation
    this.working.delete(workingKey);

    return episode;
  }

  /**
   * Consolidate working memory to semantic memory
   */
  consolidateToSemantic(
    workingKey: string,
    metadata: {
      name: string;
      type: SemanticEntity['type'];
      description: string;
      tags?: string[];
    }
  ): SemanticEntity | null {
    const workingItem = this.working.get(workingKey);
    if (!workingItem) return null;

    const entity = this.semantic.create({
      name: metadata.name,
      type: metadata.type,
      description: metadata.description,
      content: workingItem.value,
      tags: [...(metadata.tags || []), ...workingItem.tags],
    });

    // Delete the working memory item after consolidation
    this.working.delete(workingKey);

    return entity;
  }

  /**
   * Intelligent recall across all memory layers
   */
  recall(query: string, options?: {
    includeWorking?: boolean;
    includeEpisodic?: boolean;
    includeSemantic?: boolean;
    limit?: number;
  }): RecallResult {
    const {
      includeWorking = true,
      includeEpisodic = true,
      includeSemantic = true,
      limit = 10,
    } = options || {};

    const result: RecallResult = {
      working: [],
      episodic: [],
      semantic: [],
    };

    if (includeWorking) {
      // For working memory, we search by tags that might match the query
      const workingItems = this.working.list();
      result.working = workingItems.filter(item => {
        const valueStr = JSON.stringify(item.value).toLowerCase();
        const queryLower = query.toLowerCase();
        return (
          item.key.toLowerCase().includes(queryLower) ||
          valueStr.includes(queryLower) ||
          item.tags.some(tag => tag.toLowerCase().includes(queryLower))
        );
      }).slice(0, limit);
    }

    if (includeEpisodic) {
      result.episodic = this.episodic.search({ query, limit });
    }

    if (includeSemantic) {
      result.semantic = this.semantic.search({ query, limit });
    }

    return result;
  }

  /**
   * Get formatted context for recall (useful for prompts)
   */
  async getFormattedContext(query: string): Promise<string> {
    const recall = this.recall(query);
    const parts: string[] = [];

    if (recall.working.length > 0) {
      parts.push('## Current Context (Working Memory)');
      for (const item of recall.working) {
        parts.push(`- **${item.key}** (${item.type}): ${JSON.stringify(item.value)}`);
      }
    }

    if (recall.episodic.length > 0) {
      parts.push('\n## Relevant Past Events (Episodic Memory)');
      for (const episode of recall.episodic) {
        parts.push(`- **${episode.summary}** (${episode.type}, importance: ${episode.importance})`);
        if (episode.outcome) {
          parts.push(`  - Outcome: ${episode.outcome.status}`);
          if (episode.outcome.learnings.length > 0) {
            parts.push(`  - Learnings: ${episode.outcome.learnings.join(', ')}`);
          }
        }
      }
    }

    if (recall.semantic.length > 0) {
      parts.push('\n## Relevant Knowledge (Semantic Memory)');
      for (const entity of recall.semantic) {
        parts.push(`- **${entity.name}** (${entity.type}): ${entity.description}`);
        if (entity.observations.length > 0) {
          parts.push(`  - Observations: ${entity.observations.slice(0, 3).join('; ')}`);
        }
      }
    }

    return parts.length > 0 ? parts.join('\n') : 'No relevant memories found.';
  }

  /**
   * Get memory statistics
   */
  getStats(): MemoryStats {
    return this.storage.getStats();
  }

  /**
   * Get memory dashboard with comprehensive statistics and insights
   *
   * The dashboard provides:
   * - Top 5 most accessed memories (episodic only, as semantic doesn't track access)
   * - Entity/episode counts by type
   * - Recent additions (last 5)
   * - Memories near decay threshold (importance < 3)
   * - Orphaned entities (no relations)
   * - Knowledge graph density metrics
   */
  getDashboard(): MemoryDashboard {
    const stats = this.getStats();
    const now = Date.now();

    // Get all data for analysis
    const allEpisodes = this.storage.searchEpisodes({});
    const allEntities = this.storage.searchEntities({});
    const exportData = this.storage.export();
    const allRelations = exportData.semantic.relations;
    const workingItems = this.working.list();

    // Top 5 most accessed memories (episodic only - semantic doesn't track accessCount)
    const topAccessed = allEpisodes
      .filter(e => e.accessCount > 0)
      .map(e => ({
        type: 'episodic' as const,
        id: e.id,
        name: e.summary,
        accessCount: e.accessCount,
        lastAccessed: e.lastAccessed || e.timestamp,
      }))
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, 5);

    // Counts by type
    const countsByType = {
      episodic: stats.episodic.byType as Record<string, number>,
      semantic: stats.semantic.byType as Record<string, number>,
    };

    // Recent additions (last 5 across all types)
    const recentWorking = workingItems.map(w => ({
      type: 'working' as const,
      id: w.id,
      name: w.key,
      createdAt: w.metadata.createdAt,
    }));

    const recentEpisodic = allEpisodes.map(e => ({
      type: 'episodic' as const,
      id: e.id,
      name: e.summary,
      createdAt: e.timestamp,
    }));

    const recentSemantic = allEntities.map(e => ({
      type: 'semantic' as const,
      id: e.id,
      name: e.name,
      createdAt: e.createdAt,
    }));

    const recentAdditions = [...recentWorking, ...recentEpisodic, ...recentSemantic]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);

    // Memories near decay threshold (importance < 3)
    const nearDecayThreshold = allEpisodes
      .filter(e => e.importance < 3)
      .map(e => ({
        type: 'episodic' as const,
        id: e.id,
        summary: e.summary,
        importance: e.importance,
      }))
      .sort((a, b) => a.importance - b.importance)
      .slice(0, 10);

    // Orphaned entities (no incoming or outgoing relations)
    const connectedEntityIds = new Set<string>();
    for (const rel of allRelations) {
      connectedEntityIds.add(rel.from);
      connectedEntityIds.add(rel.to);
    }

    const orphanedEntities = allEntities
      .filter(e => !connectedEntityIds.has(e.id))
      .map(e => ({
        id: e.id,
        name: e.name,
        type: e.type,
      }))
      .slice(0, 10);

    // Knowledge graph statistics
    const totalNodes = allEntities.length;
    const totalEdges = allRelations.length;
    const averageDegree = totalNodes > 0 ? (2 * totalEdges) / totalNodes : 0;
    // Density = actual edges / max possible edges (for undirected graph: n*(n-1)/2)
    const maxPossibleEdges = totalNodes > 1 ? (totalNodes * (totalNodes - 1)) / 2 : 0;
    const density = maxPossibleEdges > 0 ? totalEdges / maxPossibleEdges : 0;

    return {
      topAccessed,
      countsByType,
      recentAdditions,
      nearDecayThreshold,
      orphanedEntities,
      graphStats: {
        totalNodes,
        totalEdges,
        averageDegree: Math.round(averageDegree * 100) / 100,
        density: Math.round(density * 1000) / 1000,
      },
      stats,
      generatedAt: now,
    };
  }

  /**
   * Export all memory data
   */
  export(): MemoryExport {
    return this.storage.export();
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Set a new session ID (updates all memory layers)
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
    this.working.setSessionId(sessionId);
    this.episodic.setSessionId(sessionId);
  }

  /**
   * Import memory data from an export
   */
  import(data: MemoryExport, options?: {
    overwrite?: boolean;
    skipWorking?: boolean;
    skipEpisodic?: boolean;
    skipSemantic?: boolean;
  }): { imported: { working: number; episodic: number; semantic: { entities: number; relations: number } }; skipped: number } {
    return this.storage.import(data, options);
  }

  /**
   * Smart recall with relevance scoring and optional spreading activation.
   *
   * Spreading activation mimics human associative memory: when an entity is activated,
   * related entities are also partially activated based on relation strength and distance.
   * This allows searching for "authentication" to also return "JWT", "OAuth" entities.
   *
   * Context-dependent encoding (N6): When the current context matches the episode's
   * encoding context (projectPath, branch), a 1.2x bonus is applied to the relevance score.
   * This mimics how human memory recall is enhanced when in the same context as encoding.
   */
  smartRecall(query: string, options?: {
    includeWorking?: boolean;
    includeEpisodic?: boolean;
    includeSemantic?: boolean;
    limit?: number;
    recencyWeight?: number;
    importanceWeight?: number;
    confidenceWeight?: number;
    /** Enable spreading activation through semantic relations graph */
    spreadingActivation?: boolean;
    /** Decay factor per hop in spreading activation (default: 0.5) */
    activationDecay?: number;
    /** Maximum hops for spreading activation (default: 2) */
    maxSpreadingHops?: number;
    /** Current context for context-dependent encoding bonus (1.2x when matching) */
    currentContext?: {
      projectPath?: string;
      branch?: string;
      sessionId?: string;
    };
    /** Context match multiplier (default: 1.2) */
    contextMatchMultiplier?: number;
  }): ScoredRecallResult {
    const {
      includeWorking = true,
      includeEpisodic = true,
      includeSemantic = true,
      limit = 10,
      recencyWeight = 0.3,
      importanceWeight = 0.4,
      confidenceWeight = 0.3,
      spreadingActivation = true,
      activationDecay = 0.5,
      maxSpreadingHops = 2,
      currentContext,
      contextMatchMultiplier = 1.2,
    } = options || {};

    const result: ScoredRecallResult = {
      working: [],
      episodic: [],
      semantic: [],
    };

    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);
    const now = Date.now();

    // Score working memory items
    if (includeWorking) {
      const workingItems = this.working.list();
      result.working = workingItems
        .map(item => {
          const valueStr = JSON.stringify(item.value).toLowerCase();
          const textMatch = this.calculateTextMatch(queryTerms, [
            item.key.toLowerCase(),
            valueStr,
            ...item.tags.map(t => t.toLowerCase()),
          ]);

          // Recency score (within TTL)
          const age = now - item.metadata.updatedAt;
          const maxAge = item.metadata.expiresAt - item.metadata.createdAt;
          const recencyScore = Math.max(0, 1 - (age / maxAge));

          // Priority score
          const priorityScore = { high: 1, medium: 0.6, low: 0.3 }[item.metadata.priority];

          const relevanceScore = textMatch > 0
            ? (textMatch * 0.5) + (recencyScore * recencyWeight) + (priorityScore * (1 - recencyWeight))
            : 0;

          return { ...item, relevanceScore };
        })
        .filter(item => item.relevanceScore > 0)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, limit);
    }

    // Score episodic memories
    if (includeEpisodic) {
      const episodes = this.episodic.search({ query, limit: limit * 2 });
      result.episodic = episodes
        .map(episode => {
          const textMatch = this.calculateTextMatch(queryTerms, [
            episode.summary.toLowerCase(),
            episode.details.toLowerCase(),
            ...episode.tags.map(t => t.toLowerCase()),
          ]);

          // Recency score (decays over weeks)
          const ageInWeeks = (now - episode.timestamp) / (7 * 24 * 60 * 60 * 1000);
          const recencyScore = Math.pow(0.95, ageInWeeks); // 5% decay per week

          // Importance score (normalized to 0-1)
          const importanceScore = episode.importance / 10;

          // Access frequency boost
          const accessBoost = Math.min(1, episode.accessCount * 0.1);

          // Emotional arousal multiplier: high arousal memories are more memorable
          // Arousal ranges from 0 to 1, multiplier ranges from 1.0 to 1.3
          const arousalMultiplier = 1 + (episode.arousal * 0.3);

          // Context-dependent encoding bonus (N6):
          // When current context matches the episode's encoding context, apply bonus
          // This mimics context-dependent memory in human cognition
          let contextMultiplier = 1.0;
          if (currentContext) {
            const matchingFields: boolean[] = [];

            // Check projectPath match
            if (currentContext.projectPath && episode.context.projectPath) {
              matchingFields.push(currentContext.projectPath === episode.context.projectPath);
            }

            // Check branch match
            if (currentContext.branch && episode.context.branch) {
              matchingFields.push(currentContext.branch === episode.context.branch);
            }

            // Check sessionId match (same session = strongest context match)
            if (currentContext.sessionId && episode.context.sessionId) {
              if (currentContext.sessionId === episode.context.sessionId) {
                // Same session gets full bonus
                contextMultiplier = contextMatchMultiplier;
              } else if (matchingFields.length > 0 && matchingFields.some(m => m)) {
                // Partial context match: scale multiplier by proportion of matching fields
                const matchRatio = matchingFields.filter(m => m).length / matchingFields.length;
                contextMultiplier = 1.0 + (contextMatchMultiplier - 1.0) * matchRatio;
              }
            } else if (matchingFields.length > 0 && matchingFields.some(m => m)) {
              // No session to compare, use field matching
              const matchRatio = matchingFields.filter(m => m).length / matchingFields.length;
              contextMultiplier = 1.0 + (contextMatchMultiplier - 1.0) * matchRatio;
            }
          }

          const baseScore = textMatch > 0
            ? (textMatch * 0.4) +
              (recencyScore * recencyWeight) +
              (importanceScore * importanceWeight) +
              (accessBoost * 0.1)
            : 0;

          // Apply arousal multiplier and context multiplier
          const relevanceScore = baseScore * arousalMultiplier * contextMultiplier;

          return { ...episode, relevanceScore };
        })
        .filter(ep => ep.relevanceScore > 0)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, limit);
    }

    // Score semantic entities
    if (includeSemantic) {
      const entities = this.semantic.search({ query, limit: limit * 2 });

      // Score helper function
      const scoreEntity = (entity: SemanticEntity, baseScore?: number): number => {
        const textMatch = this.calculateTextMatch(queryTerms, [
          entity.name.toLowerCase(),
          entity.description.toLowerCase(),
          ...entity.tags.map(t => t.toLowerCase()),
          ...entity.observations.map(o => o.toLowerCase()),
        ]);

        // Confidence score
        const confidenceScore = entity.confidence;

        // Freshness score (decays slower than episodic)
        const ageInMonths = (now - entity.updatedAt) / (30 * 24 * 60 * 60 * 1000);
        const freshnessScore = Math.pow(0.98, ageInMonths);

        // Version maturity (higher versions = more refined)
        const maturityScore = Math.min(1, entity.version * 0.2);

        // If there's a base score from spreading activation, use it as minimum
        const textScore = textMatch > 0
          ? (textMatch * 0.4) +
            (confidenceScore * confidenceWeight) +
            (freshnessScore * (1 - confidenceWeight) * 0.5) +
            (maturityScore * 0.1)
          : 0;

        // Return max of text score and base score (from spreading activation)
        return Math.max(textScore, baseScore || 0);
      };

      // First pass: score directly matched entities
      const scoredEntities = new Map<string, { entity: SemanticEntity; relevanceScore: number }>();

      for (const entity of entities) {
        const score = scoreEntity(entity);
        if (score > 0) {
          scoredEntities.set(entity.id, { entity, relevanceScore: score });
        }
      }

      // Spreading activation: traverse relations graph
      if (spreadingActivation && scoredEntities.size > 0) {
        const activatedEntities = new Map(scoredEntities);
        const toProcess: Array<{ entityId: string; score: number; hop: number }> = [];

        // Initialize with directly matched entities
        for (const [id, { relevanceScore }] of scoredEntities) {
          toProcess.push({ entityId: id, score: relevanceScore, hop: 0 });
        }

        // BFS through relation graph with decaying activation
        while (toProcess.length > 0) {
          const { entityId, score, hop } = toProcess.shift()!;

          // Stop if we've reached max hops
          if (hop >= maxSpreadingHops) continue;

          // Get related entities with their relation strengths
          const relatedWithStrength = this.semantic.getRelatedWithStrength(entityId);

          for (const { entity: related, strength } of relatedWithStrength) {
            // Calculate activation score: parent score * relation strength * decay per hop
            const activationScore = score * strength * Math.pow(activationDecay, hop + 1);

            // Skip if activation is too weak
            if (activationScore < 0.05) continue;

            const existing = activatedEntities.get(related.id);
            if (existing) {
              // Keep the higher score
              if (activationScore > existing.relevanceScore) {
                existing.relevanceScore = activationScore;
              }
            } else {
              // Add new activated entity
              activatedEntities.set(related.id, {
                entity: related,
                relevanceScore: activationScore,
              });

              // Continue spreading from this entity
              toProcess.push({
                entityId: related.id,
                score: activationScore,
                hop: hop + 1,
              });
            }
          }
        }

        // Convert to array, sort, and limit
        result.semantic = Array.from(activatedEntities.values())
          .sort((a, b) => b.relevanceScore - a.relevanceScore)
          .slice(0, limit)
          .map(({ entity, relevanceScore }) => ({ ...entity, relevanceScore }));
      } else {
        // No spreading activation: just use directly matched entities
        result.semantic = Array.from(scoredEntities.values())
          .sort((a, b) => b.relevanceScore - a.relevanceScore)
          .slice(0, limit)
          .map(({ entity, relevanceScore }) => ({ ...entity, relevanceScore }));
      }
    }

    return result;
  }

  /**
   * Calculate text match score
   */
  private calculateTextMatch(queryTerms: string[], texts: string[]): number {
    if (queryTerms.length === 0) return 0;

    let matchCount = 0;
    const combinedText = texts.join(' ');

    for (const term of queryTerms) {
      if (combinedText.includes(term)) {
        matchCount++;
      }
    }

    return matchCount / queryTerms.length;
  }

  /**
   * Find reconsolidation candidates for an episode (N7).
   *
   * Reconsolidation is a memory process where retrieved memories become labile
   * and can be updated with new information. This method finds similar episodes
   * that could potentially be merged to reduce redundancy.
   *
   * @param episodeId - The episode to find reconsolidation candidates for
   * @param options - Configuration options
   * @returns Array of candidate episodes with similarity scores and merge suggestions
   */
  findReconsolidationCandidates(episodeId: string, options?: {
    /** Minimum tag overlap ratio to consider (default: 0.3) */
    minTagOverlap?: number;
    /** Consider only episodes newer than this (default: true) */
    newerOnly?: boolean;
    /** Maximum number of candidates to return (default: 5) */
    limit?: number;
    /** Include context matching in similarity (default: true) */
    matchContext?: boolean;
  }): Array<{
    episode: EpisodicMemoryType;
    similarity: number;
    mergeReasons: string[];
  }> {
    const {
      minTagOverlap = 0.3,
      newerOnly = true,
      limit = 5,
      matchContext = true,
    } = options || {};

    const sourceEpisode = this.episodic.get(episodeId);
    if (!sourceEpisode) return [];

    // Search for similar episodes
    const candidates = this.episodic.search({
      type: sourceEpisode.type,
      limit: 50, // Get more to filter
    });

    const results: Array<{
      episode: EpisodicMemoryType;
      similarity: number;
      mergeReasons: string[];
    }> = [];

    for (const candidate of candidates) {
      // Skip self
      if (candidate.id === episodeId) continue;

      // Skip older or same-age episodes if newerOnly (strictly newer)
      if (newerOnly && candidate.timestamp <= sourceEpisode.timestamp) continue;

      // Skip already related episodes
      if (sourceEpisode.relatedEpisodes.includes(candidate.id)) continue;

      let similarity = 0;
      const mergeReasons: string[] = [];

      // Calculate tag overlap
      if (sourceEpisode.tags.length > 0 && candidate.tags.length > 0) {
        const sourceTagSet = new Set(sourceEpisode.tags);
        const commonTags = candidate.tags.filter(t => sourceTagSet.has(t));
        const tagOverlap = commonTags.length / Math.max(sourceEpisode.tags.length, candidate.tags.length);

        if (tagOverlap >= minTagOverlap) {
          similarity += tagOverlap * 0.4;
          mergeReasons.push(`Tag overlap: ${commonTags.join(', ')} (${Math.round(tagOverlap * 100)}%)`);
        }
      }

      // Context matching
      if (matchContext) {
        const contextMatches: string[] = [];

        if (sourceEpisode.context.projectPath &&
            sourceEpisode.context.projectPath === candidate.context.projectPath) {
          contextMatches.push('same project');
          similarity += 0.2;
        }

        if (sourceEpisode.context.branch &&
            sourceEpisode.context.branch === candidate.context.branch) {
          contextMatches.push('same branch');
          similarity += 0.15;
        }

        if (sourceEpisode.context.taskId &&
            sourceEpisode.context.taskId === candidate.context.taskId) {
          contextMatches.push('same task');
          similarity += 0.15;
        }

        if (contextMatches.length > 0) {
          mergeReasons.push(`Context match: ${contextMatches.join(', ')}`);
        }
      }

      // Text similarity (simple word overlap)
      const sourceWords = new Set(
        `${sourceEpisode.summary} ${sourceEpisode.details}`
          .toLowerCase()
          .split(/\s+/)
          .filter(w => w.length > 3)
      );
      const candidateText = `${candidate.summary} ${candidate.details}`.toLowerCase();
      const matchingWords = [...sourceWords].filter(w => candidateText.includes(w));
      if (matchingWords.length > 0 && sourceWords.size > 0) {
        const textOverlap = matchingWords.length / sourceWords.size;
        if (textOverlap > 0.2) {
          similarity += textOverlap * 0.1;
          mergeReasons.push(`Content similarity: ${Math.round(textOverlap * 100)}%`);
        }
      }

      // Only include if there are merge reasons
      if (mergeReasons.length > 0 && similarity > 0) {
        results.push({
          episode: candidate,
          similarity,
          mergeReasons,
        });
      }
    }

    // Sort by similarity and limit
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Merge two episodes into one (reconsolidation).
   *
   * The source episode is updated with information from the merge episode,
   * and the merge episode's importance is reduced.
   *
   * @param targetId - The episode to merge into
   * @param mergeId - The episode to merge from
   * @param options - Merge options
   * @returns Whether the merge was successful
   */
  mergeEpisodes(targetId: string, mergeId: string, options?: {
    /** Combine learnings from both episodes (default: true) */
    combineLearnings?: boolean;
    /** Add merge episode tags to target (default: true) */
    combineTags?: boolean;
    /** Reduce merged episode importance by this factor (default: 0.5) */
    mergedImportanceReduction?: number;
  }): boolean {
    const {
      combineLearnings = true,
      combineTags = true,
      mergedImportanceReduction = 0.5,
    } = options || {};

    const target = this.episodic.get(targetId);
    const merge = this.episodic.get(mergeId);

    if (!target || !merge) return false;

    // Combine learnings
    if (combineLearnings && merge.outcome?.learnings) {
      const existingLearnings = target.outcome?.learnings || [];
      const newLearnings = merge.outcome.learnings.filter(
        l => !existingLearnings.includes(l)
      );
      if (newLearnings.length > 0) {
        this.episodic.addLearnings(targetId, newLearnings);
      }
    }

    // Relate the episodes
    this.episodic.relate(targetId, mergeId);

    // Note: Tag combination would require a new method in EpisodicMemory
    // For now, we just relate them and reduce merged episode importance

    // Reduce importance of merged episode
    const newImportance = Math.max(1, Math.floor(merge.importance * mergedImportanceReduction));
    this.episodic.updateImportance(mergeId, newImportance);

    return true;
  }

  /**
   * Apply importance decay to episodic memories
   * Call this periodically to naturally age memories
   * @deprecated Use applyEbbinghausDecay for more accurate memory modeling
   */
  applyImportanceDecay(options?: {
    decayFactor?: number;
    minImportance?: number;
    olderThanDays?: number;
  }): { updated: number } {
    const {
      decayFactor = 0.95,
      minImportance = 1,
      olderThanDays = 7,
    } = options || {};

    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const episodes = this.episodic.search({ limit: 1000 });
    let updated = 0;

    for (const episode of episodes) {
      // Use lastAccessed to determine staleness (same as Ebbinghaus decay)
      if (episode.lastAccessed < cutoffTime && episode.importance > minImportance) {
        const newImportance = Math.max(
          minImportance,
          Math.floor(episode.importance * decayFactor)
        );

        if (newImportance !== episode.importance) {
          this.episodic.updateImportance(episode.id, newImportance);
          updated++;
        }
      }
    }

    return { updated };
  }

  /**
   * Apply Ebbinghaus forgetting curve with SM-2 style spaced repetition.
   * Memories that are accessed more frequently decay much slower.
   *
   * The retention formula: R = e^(-t / S)
   * Where:
   *   - t = time since last access (in days)
   *   - S = stability (derived from access count)
   *
   * Stability increases with each access, making memories more resistant to decay.
   */
  applyEbbinghausDecay(options?: {
    minImportance?: number;
    olderThanDays?: number;
    baseStability?: number;
    stabilityGrowthFactor?: number;
  }): { updated: number; decayed: Array<{ id: string; from: number; to: number }> } {
    const {
      minImportance = 1,
      olderThanDays = 1,
      baseStability = 1,           // Base stability in days
      stabilityGrowthFactor = 1.5, // Stability multiplier per access
    } = options || {};

    const now = Date.now();
    const cutoffTime = now - (olderThanDays * 24 * 60 * 60 * 1000);
    const episodes = this.episodic.search({ limit: 1000 });
    let updated = 0;
    const decayed: Array<{ id: string; from: number; to: number }> = [];

    for (const episode of episodes) {
      // Only decay memories older than the threshold
      if (episode.lastAccessed < cutoffTime && episode.importance > minImportance) {
        // Calculate stability: S = baseStability * (stabilityGrowthFactor ^ accessCount)
        // More accesses = higher stability = slower decay
        const stability = baseStability * Math.pow(stabilityGrowthFactor, episode.accessCount);

        // Time since last access in days
        const timeSinceAccess = (now - episode.lastAccessed) / (24 * 60 * 60 * 1000);

        // Ebbinghaus retention: R = e^(-t/S)
        // We scale importance by retention
        const retention = Math.exp(-timeSinceAccess / stability);

        // Apply retention to importance
        const newImportance = Math.max(
          minImportance,
          Math.round(episode.importance * retention)
        );

        if (newImportance < episode.importance) {
          this.episodic.updateImportance(episode.id, newImportance);
          decayed.push({ id: episode.id, from: episode.importance, to: newImportance });
          updated++;
        }
      }
    }

    return { updated, decayed };
  }

  /**
   * Boost importance of frequently accessed memories
   */
  applyAccessBoost(options?: {
    boostFactor?: number;
    maxImportance?: number;
    minAccessCount?: number;
  }): { updated: number } {
    const {
      boostFactor = 1.1,
      maxImportance = 10,
      minAccessCount = 5,
    } = options || {};

    const episodes = this.episodic.search({ limit: 1000 });
    let updated = 0;

    for (const episode of episodes) {
      if (episode.accessCount >= minAccessCount && episode.importance < maxImportance) {
        const newImportance = Math.min(
          maxImportance,
          Math.ceil(episode.importance * boostFactor)
        );

        if (newImportance !== episode.importance) {
          this.episodic.updateImportance(episode.id, newImportance);
          updated++;
        }
      }
    }

    return { updated };
  }

  /**
   * Consolidate high-priority working memory to episodic memory on session end.
   * Mimics the brain's "sleep consolidation" where important short-term memories
   * are transferred to long-term storage.
   */
  consolidateOnSessionEnd(): { consolidated: number; items: string[] } {
    const workingItems = this.working.list();
    const consolidated: string[] = [];

    for (const item of workingItems) {
      // Only consolidate high and medium priority items
      if (item.metadata.priority === 'high' || item.metadata.priority === 'medium') {
        const importance = item.metadata.priority === 'high' ? 7 : 5;

        this.episodic.record({
          type: 'interaction',
          summary: `Session end consolidation: ${item.key}`,
          details: typeof item.value === 'string'
            ? item.value
            : JSON.stringify(item.value, null, 2),
          importance,
          tags: [...item.tags, 'session-consolidated', `priority-${item.metadata.priority}`],
        });

        this.working.delete(item.key);
        consolidated.push(item.key);
      }
    }

    return { consolidated: consolidated.length, items: consolidated };
  }

  /**
   * Run DIKW pattern detection on session end (N4+P7).
   * Automatically detects patterns from recent episodes and creates pattern candidates.
   * This mimics the brain's offline processing during sleep that strengthens patterns.
   *
   * @param options Configuration for auto-DIKW
   * @returns Created patterns count
   */
  runSessionEndDIKW(options?: {
    /** Minimum confidence for auto-creating patterns (default: 0.6) */
    minConfidence?: number;
    /** Maximum age of episodes to consider in days (default: 7) */
    maxAgeDays?: number;
    /** Whether to only analyze or also create (default: true = create) */
    autoCreate?: boolean;
  }): {
    patternsAnalyzed: number;
    patternsCreated: number;
    insightsCreated: number;
    wisdomCreated: number;
  } {
    const {
      minConfidence = 0.6,
      maxAgeDays = 7,
      autoCreate = true,
    } = options ?? {};

    const pipeline = new DIKWPipeline(this.storage, {
      maxEpisodeAgeDays: maxAgeDays,
    });

    const analysis = pipeline.analyze();
    const result = {
      patternsAnalyzed: analysis.patternCandidates.length,
      patternsCreated: 0,
      insightsCreated: 0,
      wisdomCreated: 0,
    };

    if (autoCreate) {
      // Auto-create high-confidence patterns
      for (const candidate of analysis.patternCandidates) {
        if (candidate.confidence >= minConfidence) {
          pipeline.createPatternFromCandidate(candidate);
          result.patternsCreated++;
        }
      }

      // Auto-create insights from high-frequency patterns
      for (const candidate of analysis.insightCandidates) {
        if (candidate.confidence >= minConfidence) {
          pipeline.createInsightFromCandidate(candidate);
          result.insightsCreated++;
        }
      }

      // Auto-create wisdom from validated insights
      for (const candidate of analysis.wisdomCandidates) {
        if (candidate.confidence >= minConfidence) {
          pipeline.createWisdomFromCandidate(candidate);
          result.wisdomCreated++;
        }
      }
    }

    return result;
  }

  /**
   * Cluster similar episodes based on tags, type, and content (P3).
   *
   * This method groups episodes that share common characteristics,
   * preparing them for summarization and compression.
   *
   * @param options Configuration for clustering
   * @returns Array of episode clusters
   */
  clusterSimilarEpisodes(options?: {
    /** Episode type to cluster (all types if not specified) */
    type?: EpisodicMemoryType['type'];
    /** Minimum tag overlap ratio to group episodes (default: 0.4) */
    minTagOverlap?: number;
    /** Minimum cluster size (default: 3) */
    minClusterSize?: number;
    /** Maximum age of episodes to consider in days (default: 30) */
    maxAgeDays?: number;
    /** Maximum number of episodes to analyze (default: 200) */
    limit?: number;
  }): Array<{
    centroidTags: string[];
    episodes: EpisodicMemoryType[];
    avgImportance: number;
    commonType: EpisodicMemoryType['type'];
  }> {
    const {
      type,
      minTagOverlap = 0.4,
      minClusterSize = 3,
      maxAgeDays = 30,
      limit = 200,
    } = options || {};

    const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

    // Get episodes to cluster
    const episodes = this.episodic.search({
      type,
      limit,
    }).filter(ep =>
      ep.timestamp >= cutoffTime &&
      ep.tags.length > 0 &&
      !ep.tags.includes('summary') // Exclude existing summaries
    );

    if (episodes.length < minClusterSize) {
      return [];
    }

    // Simple greedy clustering based on tag overlap
    const clusters: Array<{
      centroidTags: string[];
      episodes: EpisodicMemoryType[];
      avgImportance: number;
      commonType: EpisodicMemoryType['type'];
    }> = [];

    const clustered = new Set<string>();

    for (const episode of episodes) {
      if (clustered.has(episode.id)) continue;

      // Find all episodes with sufficient tag overlap
      const clusterMembers: EpisodicMemoryType[] = [episode];
      const episodeTags = new Set(episode.tags);

      for (const other of episodes) {
        if (other.id === episode.id || clustered.has(other.id)) continue;
        if (other.type !== episode.type) continue;

        // Calculate tag overlap
        const otherTags = new Set(other.tags);
        const commonTags = [...episodeTags].filter(t => otherTags.has(t));
        const overlap = commonTags.length / Math.max(episodeTags.size, otherTags.size);

        if (overlap >= minTagOverlap) {
          clusterMembers.push(other);
        }
      }

      if (clusterMembers.length >= minClusterSize) {
        // Mark all as clustered
        for (const member of clusterMembers) {
          clustered.add(member.id);
        }

        // Find centroid tags (tags that appear in majority of cluster)
        const tagCounts = new Map<string, number>();
        for (const member of clusterMembers) {
          for (const tag of member.tags) {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
          }
        }

        const centroidTags = [...tagCounts.entries()]
          .filter(([_, count]) => count >= clusterMembers.length * 0.5)
          .sort((a, b) => b[1] - a[1])
          .map(([tag]) => tag);

        const avgImportance = clusterMembers.reduce((sum, e) => sum + e.importance, 0) / clusterMembers.length;

        clusters.push({
          centroidTags,
          episodes: clusterMembers,
          avgImportance,
          commonType: episode.type,
        });
      }
    }

    return clusters;
  }

  /**
   * Create a summary episode from a cluster of similar episodes (P3).
   *
   * The summary combines key information from all episodes in the cluster,
   * and links back to the original episodes.
   *
   * @param cluster The cluster to summarize
   * @param options Summary options
   * @returns The created summary episode
   */
  summarizeCluster(cluster: {
    centroidTags: string[];
    episodes: EpisodicMemoryType[];
    avgImportance: number;
    commonType: EpisodicMemoryType['type'];
  }, options?: {
    /** Custom summary (auto-generated if not provided) */
    customSummary?: string;
    /** Reduce original episode importance by this factor (default: 0.4) */
    originalImportanceReduction?: number;
  }): EpisodicMemoryType {
    const {
      customSummary,
      originalImportanceReduction = 0.4,
    } = options || {};

    // Collect all unique learnings from the cluster
    const allLearnings: string[] = [];
    for (const episode of cluster.episodes) {
      if (episode.outcome?.learnings) {
        for (const learning of episode.outcome.learnings) {
          if (!allLearnings.includes(learning)) {
            allLearnings.push(learning);
          }
        }
      }
    }

    // Generate summary text
    const typeDescriptions: Record<string, string> = {
      success: 'successes',
      error: 'errors',
      milestone: 'milestones',
      incident: 'incidents',
      interaction: 'interactions',
    };

    const summary = customSummary ||
      `Summary: ${cluster.episodes.length} ${typeDescriptions[cluster.commonType] || 'episodes'} related to ${cluster.centroidTags.slice(0, 3).join(', ')}`;

    // Combine details from top episodes
    const topEpisodes = cluster.episodes
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 5);

    const details = [
      `Summarized from ${cluster.episodes.length} episodes`,
      '',
      'Key episodes:',
      ...topEpisodes.map((ep, i) => `${i + 1}. ${ep.summary}`),
    ].join('\n');

    // Determine appropriate importance (slightly higher than average)
    const summaryImportance = Math.min(10, Math.ceil(cluster.avgImportance * 1.2));

    // Create the summary episode
    const summaryEpisode = this.episodic.record({
      type: cluster.commonType,
      summary,
      details,
      importance: summaryImportance,
      tags: [...cluster.centroidTags, 'summary', 'compressed'],
      outcome: allLearnings.length > 0 ? {
        status: 'success',
        learnings: allLearnings,
      } : undefined,
    });

    // Link all original episodes to the summary and reduce their importance
    for (const episode of cluster.episodes) {
      this.episodic.relate(episode.id, summaryEpisode.id);

      const newImportance = Math.max(1, Math.floor(episode.importance * originalImportanceReduction));
      if (newImportance !== episode.importance) {
        this.episodic.updateImportance(episode.id, newImportance);
      }
    }

    return summaryEpisode;
  }

  /**
   * Compress episodic memory by clustering and summarizing similar episodes (P3).
   *
   * This mimics how human memory schematizes related experiences into
   * general patterns while forgetting specific details. It helps reduce
   * noise during recall by grouping similar episodes under summaries.
   *
   * @param options Compression options
   * @returns Compression results
   */
  compressMemories(options?: {
    /** Episode type to compress (all types if not specified) */
    type?: EpisodicMemoryType['type'];
    /** Minimum tag overlap ratio (default: 0.4) */
    minTagOverlap?: number;
    /** Minimum cluster size (default: 3) */
    minClusterSize?: number;
    /** Maximum age of episodes to consider (default: 30 days) */
    maxAgeDays?: number;
    /** Reduce original episode importance (default: 0.4) */
    originalImportanceReduction?: number;
  }): {
    clustersFound: number;
    episodesCompressed: number;
    summariesCreated: Array<{ id: string; summary: string; episodeCount: number }>;
  } {
    const {
      type,
      minTagOverlap,
      minClusterSize,
      maxAgeDays,
      originalImportanceReduction,
    } = options || {};

    // Find clusters
    const clusters = this.clusterSimilarEpisodes({
      type,
      minTagOverlap,
      minClusterSize,
      maxAgeDays,
    });

    const summariesCreated: Array<{ id: string; summary: string; episodeCount: number }> = [];
    let episodesCompressed = 0;

    // Create summaries for each cluster
    for (const cluster of clusters) {
      const summaryEpisode = this.summarizeCluster(cluster, {
        originalImportanceReduction,
      });

      summariesCreated.push({
        id: summaryEpisode.id,
        summary: summaryEpisode.summary,
        episodeCount: cluster.episodes.length,
      });

      episodesCompressed += cluster.episodes.length;
    }

    return {
      clustersFound: clusters.length,
      episodesCompressed,
      summariesCreated,
    };
  }

  // ============================================================================
  // Goal Tracking (P5)
  // ============================================================================

  /**
   * Create a new goal (P5).
   *
   * Goals are stored as semantic entities with type 'goal' and can be
   * tracked over time by searching for related episodes.
   *
   * @param input Goal input data
   * @returns The created goal entity
   */
  createGoal(input: GoalInput): SemanticEntity {
    const keywords = input.keywords || this.extractKeywords(input.description);

    const content: GoalContent = {
      description: input.description,
      successCriteria: input.successCriteria,
      deadline: input.deadline,
      status: 'active',
      progress: 0,
      relatedEpisodes: [],
      keywords,
      lastChecked: Date.now(),
    };

    return this.semantic.create({
      name: input.name,
      type: 'goal',
      description: input.description,
      content,
      tags: [...(input.tags || []), 'goal'],
      confidence: 1.0,
      source: 'user',
    });
  }

  /**
   * Extract keywords from a description for goal searching.
   */
  private extractKeywords(text: string): string[] {
    // Simple keyword extraction: split by spaces, filter common words
    const commonWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
      'to', 'of', 'in', 'for', 'on', 'with', 'as', 'at', 'by', 'from',
      'this', 'that', 'these', 'those', 'it', 'its', 'be', 'have', 'has',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
    ]);

    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3 && !commonWords.has(word))
      .slice(0, 10);
  }

  /**
   * Get a goal by ID.
   */
  getGoal(goalId: string): SemanticEntity | null {
    const entity = this.semantic.get(goalId);
    if (entity && entity.type === 'goal') {
      return entity;
    }
    return null;
  }

  /**
   * List all goals.
   */
  listGoals(options?: {
    status?: GoalStatus;
    limit?: number;
  }): SemanticEntity[] {
    const { status, limit = 50 } = options || {};

    const goals = this.semantic.search({
      type: 'goal',
      limit,
    });

    if (status) {
      return goals.filter(g => {
        const content = g.content as GoalContent | undefined;
        return content?.status === status;
      });
    }

    return goals;
  }

  /**
   * Check goal progress by searching for related episodes (P5).
   *
   * This method:
   * 1. Searches for episodes matching the goal's keywords
   * 2. Updates the goal's related episodes list
   * 3. Estimates progress based on episode outcomes
   *
   * @param goalId Goal ID to check
   * @returns Goal progress information
   */
  checkGoalProgress(goalId: string): GoalProgress | null {
    const goal = this.getGoal(goalId);
    if (!goal) return null;

    const content = goal.content as GoalContent;
    if (!content) return null;

    // Search for related episodes using keywords
    const keywordQuery = content.keywords.join(' ');
    const episodes = this.episodic.search({
      query: keywordQuery,
      limit: 50,
    });

    // Also search in tags
    const tagEpisodes = this.episodic.search({
      tags: goal.tags,
      limit: 50,
    });

    // Combine and deduplicate
    const allEpisodeIds = new Set<string>();
    const allEpisodes: EpisodicMemoryType[] = [];

    for (const ep of [...episodes, ...tagEpisodes]) {
      if (!allEpisodeIds.has(ep.id)) {
        allEpisodeIds.add(ep.id);
        allEpisodes.push(ep);
      }
    }

    // Update related episodes
    const relatedEpisodes = allEpisodes.map(e => e.id);

    // Calculate progress based on episodes
    const successCount = allEpisodes.filter(e =>
      e.type === 'success' || e.type === 'milestone'
    ).length;
    const errorCount = allEpisodes.filter(e =>
      e.type === 'error' || e.type === 'incident'
    ).length;

    // Progress heuristic: more successes relative to criteria = more progress
    const criteriaCount = content.successCriteria.length || 1;
    const progressPerCriteria = 100 / criteriaCount;
    const estimatedProgress = Math.min(
      100,
      Math.round((successCount / criteriaCount) * progressPerCriteria)
    );

    // Estimate completion status
    let estimatedCompletion: GoalProgress['estimatedCompletion'];
    if (estimatedProgress >= 100) {
      estimatedCompletion = 'completed';
    } else if (content.deadline) {
      const now = Date.now();
      const remaining = content.deadline - now;
      const elapsed = now - goal.createdAt;
      const expectedProgress = elapsed / (elapsed + remaining) * 100;

      if (estimatedProgress >= expectedProgress - 10) {
        estimatedCompletion = 'on_track';
      } else if (estimatedProgress >= expectedProgress - 30) {
        estimatedCompletion = 'at_risk';
      } else {
        estimatedCompletion = 'behind';
      }
    } else {
      estimatedCompletion = estimatedProgress > 0 ? 'on_track' : 'at_risk';
    }

    // Get recent activity (last 5 related episodes)
    const recentEpisodes = allEpisodes
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);
    const recentActivity = recentEpisodes.map(e => e.summary);

    // Update the goal entity with new progress
    const updatedContent: GoalContent = {
      ...content,
      progress: estimatedProgress,
      relatedEpisodes,
      lastChecked: Date.now(),
      status: estimatedProgress >= 100 ? 'completed' : content.status,
    };

    this.semantic.update(goalId, {
      content: updatedContent,
    });

    return {
      goalId,
      name: goal.name,
      status: updatedContent.status,
      progress: estimatedProgress,
      relatedEpisodeCount: relatedEpisodes.length,
      recentActivity,
      estimatedCompletion,
    };
  }

  /**
   * Update goal status.
   */
  updateGoalStatus(goalId: string, status: GoalStatus): boolean {
    const goal = this.getGoal(goalId);
    if (!goal) return false;

    const content = goal.content as GoalContent;
    if (!content) return false;

    const updatedContent: GoalContent = {
      ...content,
      status,
      progress: status === 'completed' ? 100 : content.progress,
    };

    return this.semantic.update(goalId, { content: updatedContent });
  }

  /**
   * Add observation to a goal (notes, updates, etc.)
   */
  addGoalNote(goalId: string, note: string): boolean {
    const goal = this.getGoal(goalId);
    if (!goal) return false;

    return this.semantic.addObservation(goalId, note);
  }

  /**
   * Close the memory manager and release resources.
   * Automatically consolidates high-priority working memory before closing,
   * and runs DIKW pattern detection to capture session learnings.
   */
  close(): void {
    // Consolidate important working memory before shutdown (N4)
    const consolidation = this.consolidateOnSessionEnd();
    if (consolidation.consolidated > 0) {
      console.error(`[cc-memory] Session end: consolidated ${consolidation.consolidated} working memory items`);
    }

    // Run DIKW pattern detection on session end (P7)
    try {
      const dikwResult = this.runSessionEndDIKW();
      if (dikwResult.patternsCreated > 0 || dikwResult.insightsCreated > 0) {
        console.error(`[cc-memory] Session end DIKW: ${dikwResult.patternsCreated} patterns, ${dikwResult.insightsCreated} insights created`);
      }
    } catch (error) {
      // Don't fail shutdown on DIKW errors
      console.error(`[cc-memory] DIKW analysis error: ${(error as Error).message}`);
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.storage.close();
  }
}
