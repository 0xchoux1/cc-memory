/**
 * Episodic Memory - Long-term memory for past events, incidents, and interactions
 */

import { v7 as uuidv7 } from 'uuid';
import type { SqliteStorage } from '../storage/SqliteStorage.js';
import type {
  EpisodicMemory as EpisodicMemoryType,
  EpisodicMemoryInput,
  EpisodeQuery,
  EpisodeOutcome,
  Transcript,
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

    // Calculate valence and arousal based on episode type if not provided
    const { valence, arousal } = this.calculateEmotionalValues(input);

    const episode: EpisodicMemoryType = {
      id: uuidv7(),
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
      transcriptMetadata: input.transcript ? {
        messageCount: input.transcript.length,
        totalChars: JSON.stringify(input.transcript).length,
        hasTranscript: true,
      } : undefined,
      valence,
      arousal,
    };

    this.storage.createEpisode(episode);

    // Save transcript separately if provided
    if (input.transcript && input.transcript.length > 0) {
      this.storage.saveTranscript(episode.id, input.transcript);
    }

    return episode;
  }

  /**
   * Calculate emotional valence and arousal based on episode type.
   *
   * Valence: -1.0 (negative) to +1.0 (positive)
   * Arousal: 0.0 (calm) to 1.0 (excited)
   *
   * Type mappings:
   * - error: negative valence (-0.7), high arousal (0.8)
   * - incident: negative valence (-0.5), medium-high arousal (0.7)
   * - success: positive valence (0.8), high arousal (0.7)
   * - milestone: very positive valence (0.9), very high arousal (0.9)
   * - interaction: neutral valence (0), medium arousal (0.5)
   */
  private calculateEmotionalValues(input: EpisodicMemoryInput): { valence: number; arousal: number } {
    // Use provided values if available
    if (input.valence !== undefined && input.arousal !== undefined) {
      return {
        valence: Math.max(-1, Math.min(1, input.valence)),
        arousal: Math.max(0, Math.min(1, input.arousal)),
      };
    }

    // Auto-calculate based on episode type
    const emotionalMapping: Record<string, { valence: number; arousal: number }> = {
      error: { valence: -0.7, arousal: 0.8 },
      incident: { valence: -0.5, arousal: 0.7 },
      success: { valence: 0.8, arousal: 0.7 },
      milestone: { valence: 0.9, arousal: 0.9 },
      interaction: { valence: 0, arousal: 0.5 },
    };

    const defaults = emotionalMapping[input.type] || { valence: 0, arousal: 0.5 };

    return {
      valence: input.valence ?? defaults.valence,
      arousal: input.arousal ?? defaults.arousal,
    };
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

  /**
   * Get transcript for an episode
   */
  getTranscript(episodeId: string): Transcript | null {
    return this.storage.getTranscript(episodeId);
  }

  /**
   * Add messages to an existing transcript
   */
  addToTranscript(episodeId: string, messages: Transcript): boolean {
    const existing = this.storage.getTranscript(episodeId);
    const updated = [...(existing || []), ...messages];
    this.storage.deleteTranscript(episodeId);
    this.storage.saveTranscript(episodeId, updated);
    return true;
  }
}
