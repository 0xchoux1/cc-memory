/**
 * EpisodicRepository - Handles episodic memory storage operations
 */

import { BaseRepository } from './BaseRepository.js';
import type { DatabaseConnection } from '../DatabaseConnection.js';
import type {
  EpisodicMemory,
  EpisodicMemoryInput,
  EpisodeQuery,
  Transcript,
  TranscriptMetadata,
} from '../../memory/types.js';
import { v4 as uuidv4 } from 'uuid';

export class EpisodicRepository extends BaseRepository {
  constructor(connection: DatabaseConnection) {
    super(connection);
  }

  /**
   * Initialize episodic memory tables
   */
  createTables(): void {
    const db = this.connection.getDatabase();
    if (!db) return;

    // Episodic Memory table
    db.run(`
      CREATE TABLE IF NOT EXISTS episodic_memory (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT NOT NULL,
        context TEXT,
        outcome TEXT,
        related_episodes TEXT,
        related_entities TEXT,
        importance INTEGER DEFAULT 5,
        access_count INTEGER DEFAULT 0,
        last_accessed INTEGER,
        tags TEXT,
        stability REAL DEFAULT 1.0,
        valence REAL DEFAULT 0.0,
        arousal REAL DEFAULT 0.5
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_episodic_type ON episodic_memory(type)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_episodic_timestamp ON episodic_memory(timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_episodic_importance ON episodic_memory(importance)`);

    // Transcript table (separate from episodic_memory for large text)
    db.run(`
      CREATE TABLE IF NOT EXISTS episode_transcripts (
        episode_id TEXT PRIMARY KEY,
        transcript TEXT NOT NULL,
        message_count INTEGER DEFAULT 0,
        total_chars INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES episodic_memory(id) ON DELETE CASCADE
      )
    `);
  }

  /**
   * Create a new episode
   */
  create(episode: EpisodicMemory): string {
    this.run(`
      INSERT INTO episodic_memory
      (id, timestamp, type, summary, details, context, outcome, related_episodes, related_entities, importance, access_count, last_accessed, tags, stability, valence, arousal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      episode.id,
      episode.timestamp,
      episode.type,
      episode.summary,
      episode.details,
      JSON.stringify(episode.context),
      episode.outcome ? JSON.stringify(episode.outcome) : null,
      JSON.stringify(episode.relatedEpisodes),
      JSON.stringify(episode.relatedEntities),
      episode.importance,
      episode.accessCount,
      episode.lastAccessed,
      JSON.stringify(episode.tags),
      1.0, // stability
      episode.valence ?? 0,
      episode.arousal ?? 0.5,
    ]);

    return episode.id;
  }

  /**
   * Record a new episode from input
   */
  record(input: EpisodicMemoryInput): EpisodicMemory {
    const now = Date.now();
    const id = uuidv4();

    // Calculate emotional defaults based on type
    const emotionalDefaults: Record<string, { valence: number; arousal: number }> = {
      error: { valence: -0.7, arousal: 0.8 },
      incident: { valence: -0.5, arousal: 0.7 },
      success: { valence: 0.8, arousal: 0.7 },
      milestone: { valence: 0.9, arousal: 0.9 },
      interaction: { valence: 0, arousal: 0.5 },
    };
    const defaults = emotionalDefaults[input.type] || { valence: 0, arousal: 0.5 };

    const episode: EpisodicMemory = {
      id,
      timestamp: now,
      type: input.type,
      summary: input.summary,
      details: input.details,
      context: {
        sessionId: input.context?.sessionId || `session_${now}`,
        ...input.context,
      },
      outcome: input.outcome,
      relatedEpisodes: [],
      relatedEntities: [],
      importance: input.importance ?? 5,
      accessCount: 0,
      lastAccessed: now,
      tags: input.tags || [],
      valence: input.valence ?? defaults.valence,
      arousal: input.arousal ?? defaults.arousal,
    };

    this.create(episode);
    return episode;
  }

  /**
   * Get an episode by ID (and update access count)
   */
  get(id: string): EpisodicMemory | null {
    const result = this.exec('SELECT * FROM episodic_memory WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;

    const now = Date.now();

    // Update access count
    this.run(`
      UPDATE episodic_memory SET access_count = access_count + 1, last_accessed = ? WHERE id = ?
    `, [now, id]);

    // Convert row to episode and manually update the access count
    const episode = this.rowToEpisode(result[0].columns, result[0].values[0]);
    episode.accessCount += 1;
    episode.lastAccessed = now;

    return episode;
  }

  /**
   * Search episodes
   */
  search(query: EpisodeQuery): EpisodicMemory[] {
    let sql: string;
    const params: (string | number)[] = [];

    // Use LEFT JOIN when searching transcripts, otherwise simple query
    if (query.searchTranscript && query.query) {
      sql = 'SELECT DISTINCT em.* FROM episodic_memory em LEFT JOIN episode_transcripts et ON em.id = et.episode_id WHERE 1=1';
    } else {
      sql = 'SELECT * FROM episodic_memory em WHERE 1=1';
    }

    if (query.query) {
      if (query.searchTranscript) {
        sql += ' AND (em.summary LIKE ? OR em.details LIKE ? OR et.transcript LIKE ?)';
        const pattern = `%${query.query}%`;
        params.push(pattern, pattern, pattern);
      } else {
        sql += ' AND (em.summary LIKE ? OR em.details LIKE ?)';
        const pattern = `%${query.query}%`;
        params.push(pattern, pattern);
      }
    }

    if (query.type) {
      sql += ' AND em.type = ?';
      params.push(query.type);
    }

    if (query.dateRange?.start) {
      sql += ' AND em.timestamp >= ?';
      params.push(query.dateRange.start);
    }

    if (query.dateRange?.end) {
      sql += ' AND em.timestamp <= ?';
      params.push(query.dateRange.end);
    }

    if (query.minImportance) {
      sql += ' AND em.importance >= ?';
      params.push(query.minImportance);
    }

    if (query.tags && query.tags.length > 0) {
      const tagConditions = query.tags.map(() =>
        `EXISTS (SELECT 1 FROM json_each(em.tags) WHERE json_each.value = ?)`
      ).join(' AND ');
      sql += ` AND (${tagConditions})`;
      params.push(...query.tags);
    }

    sql += ' ORDER BY em.timestamp DESC';

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    const result = this.exec(sql, params);
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToEpisode(result[0].columns, row));
  }

  /**
   * Update an episode
   */
  update(id: string, updates: Partial<EpisodicMemory>): boolean {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];

    if (updates.outcome !== undefined) {
      sets.push('outcome = ?');
      params.push(JSON.stringify(updates.outcome));
    }
    if (updates.importance !== undefined) {
      sets.push('importance = ?');
      params.push(updates.importance);
    }
    if (updates.tags !== undefined) {
      sets.push('tags = ?');
      params.push(JSON.stringify(updates.tags));
    }
    if (updates.relatedEpisodes !== undefined) {
      sets.push('related_episodes = ?');
      params.push(JSON.stringify(updates.relatedEpisodes));
    }
    if (updates.relatedEntities !== undefined) {
      sets.push('related_entities = ?');
      params.push(JSON.stringify(updates.relatedEntities));
    }

    if (sets.length === 0) return false;

    params.push(id);
    this.run(`UPDATE episodic_memory SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.getRowsModified() > 0;
  }

  /**
   * Delete an episode
   */
  delete(id: string): boolean {
    // Delete transcript first
    this.run('DELETE FROM episode_transcripts WHERE episode_id = ?', [id]);
    // Then delete episode
    this.run('DELETE FROM episodic_memory WHERE id = ?', [id]);
    return this.getRowsModified() > 0;
  }

  /**
   * Apply decay to old episodes
   */
  applyDecay(options: {
    olderThanDays?: number;
    decayFactor?: number;
    minImportance?: number;
  } = {}): number {
    const {
      olderThanDays = 7,
      decayFactor = 0.95,
      minImportance = 1,
    } = options;

    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);

    this.run(`
      UPDATE episodic_memory
      SET importance = MAX(?, importance * ?)
      WHERE timestamp < ?
    `, [minImportance, decayFactor, cutoffTime]);

    return this.getRowsModified();
  }

  /**
   * Boost frequently accessed episodes
   */
  applyBoost(options: {
    minAccessCount?: number;
    boostFactor?: number;
    maxImportance?: number;
  } = {}): number {
    const {
      minAccessCount = 5,
      boostFactor = 1.1,
      maxImportance = 10,
    } = options;

    this.run(`
      UPDATE episodic_memory
      SET importance = MIN(?, importance * ?)
      WHERE access_count >= ?
    `, [maxImportance, boostFactor, minAccessCount]);

    return this.getRowsModified();
  }

  // ============================================================================
  // Transcript Operations
  // ============================================================================

  /**
   * Store a transcript for an episode
   */
  setTranscript(episodeId: string, transcript: Transcript): void {
    const transcriptJson = JSON.stringify(transcript);
    const messageCount = transcript.length;
    const totalChars = transcript.reduce((sum, msg) => sum + msg.content.length, 0);

    this.run(`
      INSERT OR REPLACE INTO episode_transcripts
      (episode_id, transcript, message_count, total_chars, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, [episodeId, transcriptJson, messageCount, totalChars, Date.now()]);
  }

  /**
   * Get a transcript for an episode
   */
  getTranscript(episodeId: string): Transcript | null {
    const result = this.exec(
      'SELECT transcript FROM episode_transcripts WHERE episode_id = ?',
      [episodeId]
    );

    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.safeJsonParse(result[0].values[0][0] as string, null);
  }

  /**
   * Get transcript metadata (without loading full transcript)
   */
  getTranscriptMetadata(episodeId: string): TranscriptMetadata | null {
    const result = this.exec(
      'SELECT message_count, total_chars FROM episode_transcripts WHERE episode_id = ?',
      [episodeId]
    );

    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }

    const row = result[0].values[0];
    return {
      messageCount: row[0] as number,
      totalChars: row[1] as number,
      hasTranscript: true,
    };
  }

  /**
   * Get all transcripts
   */
  getAllTranscripts(): Record<string, Transcript> {
    const result = this.exec('SELECT episode_id, transcript FROM episode_transcripts');
    if (result.length === 0) return {};

    const transcripts: Record<string, Transcript> = {};
    for (const row of result[0].values) {
      const episodeId = row[0] as string;
      const transcript = this.safeJsonParse<Transcript>(row[1] as string, []);
      if (transcript.length > 0) {
        transcripts[episodeId] = transcript;
      }
    }
    return transcripts;
  }

  /**
   * Delete a transcript
   */
  deleteTranscript(episodeId: string): boolean {
    this.run('DELETE FROM episode_transcripts WHERE episode_id = ?', [episodeId]);
    return this.getRowsModified() > 0;
  }

  /**
   * Convert a database row to an EpisodicMemory object
   */
  private rowToEpisode(columns: string[], row: unknown[]): EpisodicMemory {
    const obj = this.rowToObject(columns, row);

    // Get transcript metadata if available
    const transcriptMeta = this.getTranscriptMetadata(obj.id as string);

    return {
      id: obj.id as string,
      timestamp: obj.timestamp as number,
      type: obj.type as EpisodicMemory['type'],
      summary: obj.summary as string,
      details: obj.details as string,
      context: this.safeJsonParse(obj.context as string, { sessionId: '' }),
      outcome: this.safeJsonParse(obj.outcome as string | null, undefined),
      relatedEpisodes: this.safeJsonParse(obj.related_episodes as string, []),
      relatedEntities: this.safeJsonParse(obj.related_entities as string, []),
      importance: obj.importance as number,
      accessCount: obj.access_count as number,
      lastAccessed: obj.last_accessed as number,
      tags: this.safeJsonParse(obj.tags as string, []),
      transcriptMetadata: transcriptMeta || undefined,
      valence: (obj.valence as number) ?? 0,
      arousal: (obj.arousal as number) ?? 0.5,
    };
  }
}
