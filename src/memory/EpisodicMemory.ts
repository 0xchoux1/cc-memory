/**
 * Episodic Memory - Long-term memory for past events, incidents, and interactions
 */

import { v4 as uuidv4 } from 'uuid';
import type { SqliteStorage } from '../storage/SqliteStorage.js';
import type {
  EpisodicMemory as EpisodicMemoryType,
  EpisodicMemoryInput,
  EpisodeQuery,
  EpisodeOutcome,
} from './types.js';

export class EpisodicMemory {
  private storage: SqliteStorage;
  private sessionId: string;

  constructor(storage: SqliteStorage, sessionId: string) {
    this.storage = storage;
    this.sessionId = sessionId;
  }

  /**
   * Record a new episode
   */
  record(input: EpisodicMemoryInput): EpisodicMemoryType {
    const now = Date.now();

    const episode: EpisodicMemoryType = {
      id: uuidv4(),
      timestamp: now,
      type: input.type,
      summary: input.summary,
      details: input.details,
      context: {
        sessionId: this.sessionId,
        ...input.context,
      },
      outcome: input.outcome,
      relatedEpisodes: [],
      relatedEntities: [],
      importance: input.importance ?? 5,
      accessCount: 0,
      lastAccessed: now,
      tags: input.tags || [],
    };

    this.storage.createEpisode(episode);
    return episode;
  }

  /**
   * Get an episode by ID
   */
  get(id: string): EpisodicMemoryType | null {
    return this.storage.getEpisode(id);
  }

  /**
   * Get multiple episodes by IDs
   */
  getByIds(ids: string[]): EpisodicMemoryType[] {
    return ids
      .map(id => this.storage.getEpisode(id))
      .filter((e): e is EpisodicMemoryType => e !== null);
  }

  /**
   * Search episodes
   */
  search(query: EpisodeQuery): EpisodicMemoryType[] {
    return this.storage.searchEpisodes(query);
  }

  /**
   * Get recent episodes
   */
  getRecent(limit: number = 10): EpisodicMemoryType[] {
    return this.storage.getRecentEpisodes(limit);
  }

  /**
   * Update an episode's outcome
   */
  updateOutcome(id: string, outcome: EpisodeOutcome): boolean {
    return this.storage.updateEpisode(id, { outcome });
  }

  /**
   * Add learnings to an episode
   */
  addLearnings(id: string, learnings: string[]): boolean {
    const episode = this.storage.getEpisode(id);
    if (!episode) return false;

    const currentLearnings = episode.outcome?.learnings || [];
    const updatedOutcome: EpisodeOutcome = {
      status: episode.outcome?.status || 'success',
      learnings: [...currentLearnings, ...learnings],
      resolution: episode.outcome?.resolution,
    };

    return this.storage.updateEpisode(id, { outcome: updatedOutcome });
  }

  /**
   * Update episode importance
   */
  updateImportance(id: string, importance: number): boolean {
    return this.storage.updateEpisode(id, { importance: Math.max(1, Math.min(10, importance)) });
  }

  /**
   * Relate two episodes
   */
  relate(episodeId: string, relatedId: string): boolean {
    const episode = this.storage.getEpisode(episodeId);
    if (!episode) return false;

    const relatedEpisodes = [...new Set([...episode.relatedEpisodes, relatedId])];
    return this.storage.updateEpisode(episodeId, { relatedEpisodes });
  }

  /**
   * Link episode to a semantic entity
   */
  linkToEntity(episodeId: string, entityId: string): boolean {
    const episode = this.storage.getEpisode(episodeId);
    if (!episode) return false;

    const relatedEntities = [...new Set([...episode.relatedEntities, entityId])];
    return this.storage.updateEpisode(episodeId, { relatedEntities });
  }

  /**
   * Find similar episodes based on tags and type
   */
  findSimilar(episodeId: string, limit: number = 5): EpisodicMemoryType[] {
    const episode = this.storage.getEpisode(episodeId);
    if (!episode) return [];

    return this.storage.searchEpisodes({
      type: episode.type,
      tags: episode.tags,
      limit: limit + 1, // +1 to exclude the original
    }).filter(e => e.id !== episodeId).slice(0, limit);
  }

  /**
   * Get episodes by type
   */
  getByType(type: EpisodicMemoryType['type'], limit?: number): EpisodicMemoryType[] {
    return this.storage.searchEpisodes({ type, limit });
  }

  /**
   * Get episodes within a date range
   */
  getByDateRange(start: number, end: number, limit?: number): EpisodicMemoryType[] {
    return this.storage.searchEpisodes({
      dateRange: { start, end },
      limit,
    });
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Set a new session ID
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }
}
