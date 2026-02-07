/**
 * Memory Manager - Orchestrates all memory layers
 */

import { v4 as uuidv4 } from 'uuid';
import { SqliteStorage } from '../storage/SqliteStorage.js';
import { WorkingMemory, type WorkingMemoryConfig } from './WorkingMemory.js';
import { EpisodicMemory } from './EpisodicMemory.js';
import { SemanticMemory } from './SemanticMemory.js';
import type {
  StorageConfig,
  MemoryStats,
  MemoryExport,
  WorkingMemoryItem,
  EpisodicMemory as EpisodicMemoryType,
  SemanticEntity,
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
    this.sessionId = config.sessionId || uuidv4();
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
   * Smart recall with relevance scoring
   */
  smartRecall(query: string, options?: {
    includeWorking?: boolean;
    includeEpisodic?: boolean;
    includeSemantic?: boolean;
    limit?: number;
    recencyWeight?: number;
    importanceWeight?: number;
    confidenceWeight?: number;
  }): ScoredRecallResult {
    const {
      includeWorking = true,
      includeEpisodic = true,
      includeSemantic = true,
      limit = 10,
      recencyWeight = 0.3,
      importanceWeight = 0.4,
      confidenceWeight = 0.3,
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

          const relevanceScore = textMatch > 0
            ? (textMatch * 0.4) +
              (recencyScore * recencyWeight) +
              (importanceScore * importanceWeight) +
              (accessBoost * 0.1)
            : 0;

          return { ...episode, relevanceScore };
        })
        .filter(ep => ep.relevanceScore > 0)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, limit);
    }

    // Score semantic entities
    if (includeSemantic) {
      const entities = this.semantic.search({ query, limit: limit * 2 });
      result.semantic = entities
        .map(entity => {
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

          const relevanceScore = textMatch > 0
            ? (textMatch * 0.4) +
              (confidenceScore * confidenceWeight) +
              (freshnessScore * (1 - confidenceWeight) * 0.5) +
              (maturityScore * 0.1)
            : 0;

          return { ...entity, relevanceScore };
        })
        .filter(ent => ent.relevanceScore > 0)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, limit);
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
      if (episode.timestamp < cutoffTime && episode.importance > minImportance) {
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
   * Close the memory manager and release resources.
   * Automatically consolidates high-priority working memory before closing.
   */
  close(): void {
    // Consolidate important working memory before shutdown
    this.consolidateOnSessionEnd();

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.storage.close();
  }
}
