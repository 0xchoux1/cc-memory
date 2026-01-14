/**
 * SQLite storage implementation using sql.js (WASM-based, no native compilation needed)
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type {
  WorkingMemoryItem,
  WorkingMemoryFilter,
  EpisodicMemory,
  EpisodeQuery,
  SemanticEntity,
  SemanticRelation,
  SemanticQuery,
  StorageConfig,
  MemoryStats,
  MemoryExport,
} from '../memory/types.js';

export class SqliteStorage {
  private db: SqlJsDatabase | null = null;
  private config: StorageConfig;
  private dbPath: string;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor(config: StorageConfig) {
    this.config = config;
    this.dbPath = join(config.dataPath, 'memory.db');

    // Ensure data directory exists
    const dbDir = dirname(this.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // Start initialization
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    const SQL = await initSqlJs();

    // Try to load existing database
    if (existsSync(this.dbPath)) {
      try {
        const buffer = readFileSync(this.dbPath);
        this.db = new SQL.Database(buffer);
      } catch {
        // Create new database if loading fails
        this.db = new SQL.Database();
      }
    } else {
      this.db = new SQL.Database();
    }

    this.createTables();
    this.initialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized && this.initPromise) {
      await this.initPromise;
    }
  }

  private createTables(): void {
    if (!this.db) return;

    // Working Memory table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS working_memory (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        session_id TEXT NOT NULL,
        priority TEXT DEFAULT 'medium',
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_working_key ON working_memory(key)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_working_expires ON working_memory(expires_at)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_working_session ON working_memory(session_id)`);

    // Episodic Memory table
    this.db.run(`
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
        created_at INTEGER NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_episode_timestamp ON episodic_memory(timestamp)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_episode_type ON episodic_memory(type)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_episode_importance ON episodic_memory(importance)`);

    // Semantic Entities table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS semantic_entities (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        content TEXT,
        procedure TEXT,
        observations TEXT,
        confidence REAL DEFAULT 1.0,
        source TEXT DEFAULT 'user',
        version INTEGER DEFAULT 1,
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_semantic_name ON semantic_entities(name)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_semantic_type ON semantic_entities(type)`);

    // Semantic Relations table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS semantic_relations (
        id TEXT PRIMARY KEY,
        from_entity TEXT NOT NULL,
        to_entity TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        strength REAL DEFAULT 1.0,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (from_entity) REFERENCES semantic_entities(id) ON DELETE CASCADE,
        FOREIGN KEY (to_entity) REFERENCES semantic_entities(id) ON DELETE CASCADE
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_relation_from ON semantic_relations(from_entity)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_relation_to ON semantic_relations(to_entity)`);

    this.save();
  }

  private save(): void {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      writeFileSync(this.dbPath, buffer);
    } catch (error) {
      console.error('Failed to save database:', error);
    }
  }

  // ============================================================================
  // Working Memory Operations
  // ============================================================================

  setWorkingItem(item: WorkingMemoryItem): void {
    if (!this.db) return;

    this.db.run(`
      INSERT OR REPLACE INTO working_memory
      (id, key, type, value, session_id, priority, tags, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      item.id,
      item.key,
      item.type,
      JSON.stringify(item.value),
      item.metadata.sessionId,
      item.metadata.priority,
      JSON.stringify(item.tags),
      item.metadata.createdAt,
      item.metadata.updatedAt,
      item.metadata.expiresAt,
    ]);

    this.save();
  }

  getWorkingItem(key: string): WorkingMemoryItem | null {
    if (!this.db) return null;

    const result = this.db.exec(`
      SELECT * FROM working_memory WHERE key = ? AND expires_at > ?
    `, [key, Date.now()]);

    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.rowToWorkingItem(result[0].columns, result[0].values[0]);
  }

  deleteWorkingItem(key: string): boolean {
    if (!this.db) return false;

    this.db.run('DELETE FROM working_memory WHERE key = ?', [key]);
    const changes = this.db.getRowsModified();
    this.save();
    return changes > 0;
  }

  listWorkingItems(filter?: WorkingMemoryFilter): WorkingMemoryItem[] {
    if (!this.db) return [];

    let sql = 'SELECT * FROM working_memory WHERE 1=1';
    const params: (string | number)[] = [];

    if (!filter?.includeExpired) {
      sql += ' AND expires_at > ?';
      params.push(Date.now());
    }

    if (filter?.type) {
      sql += ' AND type = ?';
      params.push(filter.type);
    }

    if (filter?.sessionId) {
      sql += ' AND session_id = ?';
      params.push(filter.sessionId);
    }

    if (filter?.tags && filter.tags.length > 0) {
      const tagConditions = filter.tags.map(() => 'tags LIKE ?').join(' OR ');
      sql += ` AND (${tagConditions})`;
      params.push(...filter.tags.map(tag => `%"${tag}"%`));
    }

    sql += ' ORDER BY updated_at DESC';

    const result = this.db.exec(sql, params);
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToWorkingItem(result[0].columns, row));
  }

  clearExpiredWorking(): number {
    if (!this.db) return 0;

    this.db.run('DELETE FROM working_memory WHERE expires_at <= ?', [Date.now()]);
    const changes = this.db.getRowsModified();
    this.save();
    return changes;
  }

  clearAllWorking(): number {
    if (!this.db) return 0;

    this.db.run('DELETE FROM working_memory');
    const changes = this.db.getRowsModified();
    this.save();
    return changes;
  }

  private rowToWorkingItem(columns: string[], values: unknown[]): WorkingMemoryItem {
    const row = this.arrayToObject(columns, values);
    return {
      id: row.id as string,
      key: row.key as string,
      type: row.type as WorkingMemoryItem['type'],
      value: JSON.parse(row.value as string),
      metadata: {
        createdAt: row.created_at as number,
        updatedAt: row.updated_at as number,
        expiresAt: row.expires_at as number,
        sessionId: row.session_id as string,
        priority: row.priority as WorkingMemoryItem['metadata']['priority'],
      },
      tags: JSON.parse(row.tags as string || '[]'),
    };
  }

  // ============================================================================
  // Episodic Memory Operations
  // ============================================================================

  createEpisode(episode: EpisodicMemory): string {
    if (!this.db) return episode.id;

    this.db.run(`
      INSERT INTO episodic_memory
      (id, timestamp, type, summary, details, context, outcome, related_episodes,
       related_entities, importance, access_count, last_accessed, tags, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      Date.now(),
    ]);

    this.save();
    return episode.id;
  }

  getEpisode(id: string): EpisodicMemory | null {
    if (!this.db) return null;

    const result = this.db.exec('SELECT * FROM episodic_memory WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;

    // Update access count
    this.db.run(`
      UPDATE episodic_memory SET access_count = access_count + 1, last_accessed = ? WHERE id = ?
    `, [Date.now(), id]);
    this.save();

    return this.rowToEpisode(result[0].columns, result[0].values[0]);
  }

  searchEpisodes(query: EpisodeQuery): EpisodicMemory[] {
    if (!this.db) return [];

    let sql = 'SELECT * FROM episodic_memory WHERE 1=1';
    const params: (string | number)[] = [];

    if (query.query) {
      // Simple text search (LIKE-based since FTS5 is not available in sql.js by default)
      sql += ' AND (summary LIKE ? OR details LIKE ?)';
      params.push(`%${query.query}%`, `%${query.query}%`);
    }

    if (query.type) {
      sql += ' AND type = ?';
      params.push(query.type);
    }

    if (query.dateRange?.start) {
      sql += ' AND timestamp >= ?';
      params.push(query.dateRange.start);
    }

    if (query.dateRange?.end) {
      sql += ' AND timestamp <= ?';
      params.push(query.dateRange.end);
    }

    if (query.minImportance !== undefined) {
      sql += ' AND importance >= ?';
      params.push(query.minImportance);
    }

    if (query.tags && query.tags.length > 0) {
      const tagConditions = query.tags.map(() => 'tags LIKE ?').join(' OR ');
      sql += ` AND (${tagConditions})`;
      params.push(...query.tags.map(tag => `%"${tag}"%`));
    }

    sql += ' ORDER BY timestamp DESC';

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    const result = this.db.exec(sql, params);
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToEpisode(result[0].columns, row));
  }

  updateEpisode(id: string, updates: Partial<EpisodicMemory>): boolean {
    if (!this.db) return false;

    const fields: string[] = [];
    const params: unknown[] = [];

    if (updates.outcome !== undefined) {
      fields.push('outcome = ?');
      params.push(JSON.stringify(updates.outcome));
    }

    if (updates.importance !== undefined) {
      fields.push('importance = ?');
      params.push(updates.importance);
    }

    if (updates.relatedEpisodes !== undefined) {
      fields.push('related_episodes = ?');
      params.push(JSON.stringify(updates.relatedEpisodes));
    }

    if (updates.relatedEntities !== undefined) {
      fields.push('related_entities = ?');
      params.push(JSON.stringify(updates.relatedEntities));
    }

    if (updates.tags !== undefined) {
      fields.push('tags = ?');
      params.push(JSON.stringify(updates.tags));
    }

    if (fields.length === 0) return false;

    params.push(id);
    this.db.run(`UPDATE episodic_memory SET ${fields.join(', ')} WHERE id = ?`, params as (string | number)[]);
    const changes = this.db.getRowsModified();
    this.save();
    return changes > 0;
  }

  getRecentEpisodes(limit: number): EpisodicMemory[] {
    if (!this.db) return [];

    const result = this.db.exec(`
      SELECT * FROM episodic_memory ORDER BY timestamp DESC LIMIT ?
    `, [limit]);

    if (result.length === 0) return [];
    return result[0].values.map(row => this.rowToEpisode(result[0].columns, row));
  }

  private rowToEpisode(columns: string[], values: unknown[]): EpisodicMemory {
    const row = this.arrayToObject(columns, values);
    return {
      id: row.id as string,
      timestamp: row.timestamp as number,
      type: row.type as EpisodicMemory['type'],
      summary: row.summary as string,
      details: row.details as string,
      context: JSON.parse(row.context as string || '{}'),
      outcome: row.outcome ? JSON.parse(row.outcome as string) : undefined,
      relatedEpisodes: JSON.parse(row.related_episodes as string || '[]'),
      relatedEntities: JSON.parse(row.related_entities as string || '[]'),
      importance: row.importance as number,
      accessCount: row.access_count as number,
      lastAccessed: row.last_accessed as number,
      tags: JSON.parse(row.tags as string || '[]'),
    };
  }

  // ============================================================================
  // Semantic Memory Operations
  // ============================================================================

  createEntity(entity: SemanticEntity): string {
    if (!this.db) return entity.id;

    this.db.run(`
      INSERT INTO semantic_entities
      (id, name, type, description, content, procedure, observations,
       confidence, source, version, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      entity.id,
      entity.name,
      entity.type,
      entity.description,
      entity.content ? JSON.stringify(entity.content) : null,
      entity.procedure ? JSON.stringify(entity.procedure) : null,
      JSON.stringify(entity.observations),
      entity.confidence,
      entity.source,
      entity.version,
      JSON.stringify(entity.tags),
      entity.createdAt,
      entity.updatedAt,
    ]);

    this.save();
    return entity.id;
  }

  getEntity(identifier: string): SemanticEntity | null {
    if (!this.db) return null;

    // Try by ID first
    let result = this.db.exec('SELECT * FROM semantic_entities WHERE id = ?', [identifier]);

    // Then by name
    if (result.length === 0 || result[0].values.length === 0) {
      result = this.db.exec('SELECT * FROM semantic_entities WHERE name = ?', [identifier]);
    }

    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.rowToEntity(result[0].columns, result[0].values[0]);
  }

  searchEntities(query: SemanticQuery): SemanticEntity[] {
    if (!this.db) return [];

    let sql = 'SELECT * FROM semantic_entities WHERE 1=1';
    const params: (string | number)[] = [];

    if (query.query) {
      sql += ' AND (name LIKE ? OR description LIKE ? OR observations LIKE ?)';
      params.push(`%${query.query}%`, `%${query.query}%`, `%${query.query}%`);
    }

    if (query.type) {
      sql += ' AND type = ?';
      params.push(query.type);
    }

    if (query.minConfidence !== undefined) {
      sql += ' AND confidence >= ?';
      params.push(query.minConfidence);
    }

    if (query.tags && query.tags.length > 0) {
      const tagConditions = query.tags.map(() => 'tags LIKE ?').join(' OR ');
      sql += ` AND (${tagConditions})`;
      params.push(...query.tags.map(tag => `%"${tag}"%`));
    }

    sql += ' ORDER BY updated_at DESC';

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    const result = this.db.exec(sql, params);
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToEntity(result[0].columns, row));
  }

  updateEntity(id: string, updates: Partial<SemanticEntity>): boolean {
    if (!this.db) return false;

    const fields: string[] = ['updated_at = ?'];
    const params: unknown[] = [Date.now()];

    // Increment version
    fields.push('version = version + 1');

    if (updates.description !== undefined) {
      fields.push('description = ?');
      params.push(updates.description);
    }

    if (updates.content !== undefined) {
      fields.push('content = ?');
      params.push(JSON.stringify(updates.content));
    }

    if (updates.procedure !== undefined) {
      fields.push('procedure = ?');
      params.push(JSON.stringify(updates.procedure));
    }

    if (updates.observations !== undefined) {
      fields.push('observations = ?');
      params.push(JSON.stringify(updates.observations));
    }

    if (updates.confidence !== undefined) {
      fields.push('confidence = ?');
      params.push(updates.confidence);
    }

    if (updates.tags !== undefined) {
      fields.push('tags = ?');
      params.push(JSON.stringify(updates.tags));
    }

    params.push(id);
    this.db.run(`UPDATE semantic_entities SET ${fields.join(', ')} WHERE id = ?`, params as (string | number)[]);
    const changes = this.db.getRowsModified();
    this.save();
    return changes > 0;
  }

  createRelation(relation: SemanticRelation): string {
    if (!this.db) return relation.id;

    this.db.run(`
      INSERT INTO semantic_relations
      (id, from_entity, to_entity, relation_type, strength, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      relation.id,
      relation.from,
      relation.to,
      relation.relationType,
      relation.strength,
      relation.metadata ? JSON.stringify(relation.metadata) : null,
      relation.createdAt,
    ]);

    this.save();
    return relation.id;
  }

  getRelations(entityId: string): SemanticRelation[] {
    if (!this.db) return [];

    const result = this.db.exec(`
      SELECT * FROM semantic_relations WHERE from_entity = ? OR to_entity = ?
    `, [entityId, entityId]);

    if (result.length === 0) return [];
    return result[0].values.map(row => this.rowToRelation(result[0].columns, row));
  }

  private rowToEntity(columns: string[], values: unknown[]): SemanticEntity {
    const row = this.arrayToObject(columns, values);
    return {
      id: row.id as string,
      name: row.name as string,
      type: row.type as SemanticEntity['type'],
      description: row.description as string,
      content: row.content ? JSON.parse(row.content as string) : undefined,
      procedure: row.procedure ? JSON.parse(row.procedure as string) : undefined,
      observations: JSON.parse(row.observations as string || '[]'),
      confidence: row.confidence as number,
      source: row.source as SemanticEntity['source'],
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      version: row.version as number,
      tags: JSON.parse(row.tags as string || '[]'),
    };
  }

  private rowToRelation(columns: string[], values: unknown[]): SemanticRelation {
    const row = this.arrayToObject(columns, values);
    return {
      id: row.id as string,
      from: row.from_entity as string,
      to: row.to_entity as string,
      relationType: row.relation_type as string,
      strength: row.strength as number,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      createdAt: row.created_at as number,
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private arrayToObject(columns: string[], values: unknown[]): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = values[i];
    });
    return obj;
  }

  // ============================================================================
  // Statistics and Export
  // ============================================================================

  getStats(): MemoryStats {
    if (!this.db) {
      return {
        working: { total: 0, expired: 0, byType: {} as MemoryStats['working']['byType'] },
        episodic: { total: 0, byType: {} as MemoryStats['episodic']['byType'], averageImportance: 0 },
        semantic: { entities: 0, relations: 0, byType: {} as MemoryStats['semantic']['byType'] },
      };
    }

    const now = Date.now();

    // Working memory stats
    const workingTotalResult = this.db.exec('SELECT COUNT(*) as count FROM working_memory WHERE expires_at > ?', [now]);
    const workingTotal = workingTotalResult.length > 0 ? workingTotalResult[0].values[0][0] as number : 0;

    const workingExpiredResult = this.db.exec('SELECT COUNT(*) as count FROM working_memory WHERE expires_at <= ?', [now]);
    const workingExpired = workingExpiredResult.length > 0 ? workingExpiredResult[0].values[0][0] as number : 0;

    const workingByTypeResult = this.db.exec('SELECT type, COUNT(*) as count FROM working_memory WHERE expires_at > ? GROUP BY type', [now]);
    const workingByType: Record<string, number> = {};
    if (workingByTypeResult.length > 0) {
      workingByTypeResult[0].values.forEach(row => {
        workingByType[row[0] as string] = row[1] as number;
      });
    }

    // Episodic memory stats
    const episodicTotalResult = this.db.exec('SELECT COUNT(*) as count FROM episodic_memory');
    const episodicTotal = episodicTotalResult.length > 0 ? episodicTotalResult[0].values[0][0] as number : 0;

    const episodicByTypeResult = this.db.exec('SELECT type, COUNT(*) as count FROM episodic_memory GROUP BY type');
    const episodicByType: Record<string, number> = {};
    if (episodicByTypeResult.length > 0) {
      episodicByTypeResult[0].values.forEach(row => {
        episodicByType[row[0] as string] = row[1] as number;
      });
    }

    const avgImportanceResult = this.db.exec('SELECT AVG(importance) as avg FROM episodic_memory');
    const avgImportance = avgImportanceResult.length > 0 && avgImportanceResult[0].values[0][0] !== null
      ? avgImportanceResult[0].values[0][0] as number : 0;

    // Semantic memory stats
    const semanticEntitiesResult = this.db.exec('SELECT COUNT(*) as count FROM semantic_entities');
    const semanticEntities = semanticEntitiesResult.length > 0 ? semanticEntitiesResult[0].values[0][0] as number : 0;

    const semanticRelationsResult = this.db.exec('SELECT COUNT(*) as count FROM semantic_relations');
    const semanticRelations = semanticRelationsResult.length > 0 ? semanticRelationsResult[0].values[0][0] as number : 0;

    const semanticByTypeResult = this.db.exec('SELECT type, COUNT(*) as count FROM semantic_entities GROUP BY type');
    const semanticByType: Record<string, number> = {};
    if (semanticByTypeResult.length > 0) {
      semanticByTypeResult[0].values.forEach(row => {
        semanticByType[row[0] as string] = row[1] as number;
      });
    }

    return {
      working: {
        total: workingTotal,
        expired: workingExpired,
        byType: workingByType as MemoryStats['working']['byType'],
      },
      episodic: {
        total: episodicTotal,
        byType: episodicByType as MemoryStats['episodic']['byType'],
        averageImportance: avgImportance,
      },
      semantic: {
        entities: semanticEntities,
        relations: semanticRelations,
        byType: semanticByType as MemoryStats['semantic']['byType'],
      },
    };
  }

  export(): MemoryExport {
    const working = this.listWorkingItems({ includeExpired: false });

    let episodic: EpisodicMemory[] = [];
    if (this.db) {
      const episodicResult = this.db.exec('SELECT * FROM episodic_memory');
      if (episodicResult.length > 0) {
        episodic = episodicResult[0].values.map(row => this.rowToEpisode(episodicResult[0].columns, row));
      }
    }

    let entities: SemanticEntity[] = [];
    let relations: SemanticRelation[] = [];
    if (this.db) {
      const entitiesResult = this.db.exec('SELECT * FROM semantic_entities');
      if (entitiesResult.length > 0) {
        entities = entitiesResult[0].values.map(row => this.rowToEntity(entitiesResult[0].columns, row));
      }

      const relationsResult = this.db.exec('SELECT * FROM semantic_relations');
      if (relationsResult.length > 0) {
        relations = relationsResult[0].values.map(row => this.rowToRelation(relationsResult[0].columns, row));
      }
    }

    return {
      version: '1.0.0',
      exportedAt: Date.now(),
      working,
      episodic,
      semantic: {
        entities,
        relations,
      },
    };
  }

  close(): void {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
    }
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
    const result = {
      imported: { working: 0, episodic: 0, semantic: { entities: 0, relations: 0 } },
      skipped: 0,
    };

    if (!this.db) return result;

    const { overwrite = false, skipWorking = false, skipEpisodic = false, skipSemantic = false } = options || {};

    // Import working memory
    if (!skipWorking && data.working) {
      for (const item of data.working) {
        const existing = this.getWorkingItem(item.key);
        if (existing && !overwrite) {
          result.skipped++;
          continue;
        }
        this.setWorkingItem(item);
        result.imported.working++;
      }
    }

    // Import episodic memory
    if (!skipEpisodic && data.episodic) {
      for (const episode of data.episodic) {
        const existing = this.getEpisode(episode.id);
        if (existing && !overwrite) {
          result.skipped++;
          continue;
        }
        if (existing) {
          // Update existing
          this.updateEpisode(episode.id, episode);
        } else {
          this.createEpisode(episode);
        }
        result.imported.episodic++;
      }
    }

    // Import semantic memory
    if (!skipSemantic && data.semantic) {
      // Import entities first
      if (data.semantic.entities) {
        for (const entity of data.semantic.entities) {
          const existing = this.getEntity(entity.id) || this.getEntity(entity.name);
          if (existing && !overwrite) {
            result.skipped++;
            continue;
          }
          if (existing) {
            this.updateEntity(existing.id, entity);
          } else {
            this.createEntity(entity);
          }
          result.imported.semantic.entities++;
        }
      }

      // Then import relations
      if (data.semantic.relations) {
        for (const relation of data.semantic.relations) {
          // Check if both entities exist
          const fromExists = this.getEntity(relation.from);
          const toExists = this.getEntity(relation.to);
          if (!fromExists || !toExists) {
            result.skipped++;
            continue;
          }
          this.createRelation(relation);
          result.imported.semantic.relations++;
        }
      }
    }

    this.save();
    return result;
  }

  /**
   * Delete an episode by ID
   */
  deleteEpisode(id: string): boolean {
    if (!this.db) return false;

    this.db.run('DELETE FROM episodic_memory WHERE id = ?', [id]);
    const changes = this.db.getRowsModified();
    this.save();
    return changes > 0;
  }

  /**
   * Delete a semantic entity by ID
   */
  deleteEntity(id: string): boolean {
    if (!this.db) return false;

    // Delete related relations first
    this.db.run('DELETE FROM semantic_relations WHERE from_entity = ? OR to_entity = ?', [id, id]);

    // Delete the entity
    this.db.run('DELETE FROM semantic_entities WHERE id = ?', [id]);
    const changes = this.db.getRowsModified();
    this.save();
    return changes > 0;
  }
}
