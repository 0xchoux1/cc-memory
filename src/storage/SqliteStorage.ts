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
  EpisodeOutcome,
  SemanticEntity,
  SemanticRelation,
  SemanticQuery,
  StorageConfig,
  MemoryStats,
  MemoryExport,
  AgentProfile,
  AgentProfileInput,
  AgentRole,
  TachikomaProfile,
  TachikomaId,
  SyncVector,
  ConflictRecord,
  ConflictStrategy,
  SyncHistoryEntry,
  SyncType,
  ParallelizationExport,
  ParallelizationResult,
  Pattern,
  PatternInput,
  PatternQuery,
  PatternStatus,
  Insight,
  InsightInput,
  InsightQuery,
  InsightStatus,
  WisdomEntity,
  WisdomEntityInput,
  WisdomQuery,
  WisdomApplication,
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

  /**
   * Wait for storage initialization to complete
   */
  async ready(): Promise<void> {
    await this.ensureInitialized();
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

    // ============================================================================
    // Agent Tables (for multi-agent collaboration)
    // ============================================================================

    this.db.run(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        specializations TEXT,
        capabilities TEXT,
        knowledge_domains TEXT,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_agents_role ON agents(role)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_agents_active ON agents(last_active_at)`);

    // ============================================================================
    // Tachikoma Parallelization Tables
    // ============================================================================

    this.db.run(`
      CREATE TABLE IF NOT EXISTS parallelization_meta (
        id TEXT PRIMARY KEY,
        tachikoma_id TEXT UNIQUE NOT NULL,
        tachikoma_name TEXT,
        sync_seq INTEGER NOT NULL DEFAULT 0,
        sync_vector TEXT NOT NULL DEFAULT '{}',
        last_sync_at INTEGER,
        created_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS sync_history (
        id TEXT PRIMARY KEY,
        remote_tachikoma_id TEXT NOT NULL,
        remote_tachikoma_name TEXT,
        sync_type TEXT NOT NULL,
        items_count INTEGER NOT NULL,
        conflicts_count INTEGER NOT NULL,
        sync_vector TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS conflicts (
        id TEXT PRIMARY KEY,
        memory_type TEXT NOT NULL,
        local_item TEXT NOT NULL,
        remote_item TEXT NOT NULL,
        strategy TEXT NOT NULL,
        resolved_at INTEGER,
        resolution TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_conflicts_resolved ON conflicts(resolved_at)`);

    // ============================================================================
    // Pattern Tables (Knowledge Level 2)
    // ============================================================================

    this.db.run(`
      CREATE TABLE IF NOT EXISTS patterns (
        id TEXT PRIMARY KEY,
        pattern TEXT NOT NULL,
        frequency INTEGER DEFAULT 1,
        confidence REAL DEFAULT 0.5,
        supporting_episodes TEXT,
        related_tags TEXT,
        agent_roles TEXT,
        source_agent_id TEXT,
        status TEXT DEFAULT 'candidate',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_patterns_status ON patterns(status)`);

    // ============================================================================
    // Insight Tables (Knowledge Level 3)
    // ============================================================================

    this.db.run(`
      CREATE TABLE IF NOT EXISTS insights (
        id TEXT PRIMARY KEY,
        insight TEXT NOT NULL,
        reasoning TEXT,
        source_patterns TEXT,
        confidence REAL DEFAULT 0.5,
        novelty REAL DEFAULT 0.5,
        utility REAL DEFAULT 0.5,
        domains TEXT,
        source_agent_id TEXT,
        validated_by TEXT,
        status TEXT DEFAULT 'candidate',
        knowledge_level TEXT DEFAULT 'insight',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_insights_confidence ON insights(confidence)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_insights_status ON insights(status)`);

    // ============================================================================
    // Wisdom Tables (Knowledge Level 4)
    // ============================================================================

    this.db.run(`
      CREATE TABLE IF NOT EXISTS wisdom (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        principle TEXT NOT NULL,
        description TEXT NOT NULL,
        derived_from_insights TEXT,
        derived_from_patterns TEXT,
        evidence_episodes TEXT,
        applicable_domains TEXT,
        applicable_contexts TEXT,
        limitations TEXT,
        validation_count INTEGER DEFAULT 0,
        successful_applications INTEGER DEFAULT 0,
        failed_applications INTEGER DEFAULT 0,
        confidence_score REAL DEFAULT 0.5,
        created_by TEXT,
        contributing_agents TEXT,
        version INTEGER DEFAULT 1,
        tags TEXT,
        related_wisdom TEXT,
        contradictory_wisdom TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_wisdom_name ON wisdom(name)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_wisdom_confidence ON wisdom(confidence_score)`);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS wisdom_applications (
        id TEXT PRIMARY KEY,
        wisdom_id TEXT NOT NULL,
        episode_id TEXT,
        context TEXT NOT NULL,
        result TEXT NOT NULL,
        feedback TEXT,
        applied_by TEXT,
        applied_at INTEGER NOT NULL,
        FOREIGN KEY (wisdom_id) REFERENCES wisdom(id) ON DELETE CASCADE
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_wisdom_app_wisdom ON wisdom_applications(wisdom_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_wisdom_app_result ON wisdom_applications(result)`);

    // ============================================================================
    // Extended columns for existing tables (migration)
    // ============================================================================

    // Add agent/parallelization columns to episodic_memory
    this.addColumnIfNotExists('episodic_memory', 'agent_id', 'TEXT');
    this.addColumnIfNotExists('episodic_memory', 'agent_role', 'TEXT');
    this.addColumnIfNotExists('episodic_memory', 'contributing_agents', 'TEXT');
    this.addColumnIfNotExists('episodic_memory', 'knowledge_level', 'TEXT DEFAULT \'raw_experience\'');
    this.addColumnIfNotExists('episodic_memory', 'derived_patterns', 'TEXT');
    this.addColumnIfNotExists('episodic_memory', 'origin_id', 'TEXT');
    this.addColumnIfNotExists('episodic_memory', 'origin_name', 'TEXT');
    this.addColumnIfNotExists('episodic_memory', 'sync_seq', 'INTEGER DEFAULT 0');

    // Add agent/parallelization columns to semantic_entities
    this.addColumnIfNotExists('semantic_entities', 'source_agent_id', 'TEXT');
    this.addColumnIfNotExists('semantic_entities', 'source_agent_role', 'TEXT');
    this.addColumnIfNotExists('semantic_entities', 'validated_by', 'TEXT');
    this.addColumnIfNotExists('semantic_entities', 'cross_domain_relevance', 'TEXT');
    this.addColumnIfNotExists('semantic_entities', 'knowledge_level', 'TEXT DEFAULT \'pattern\'');
    this.addColumnIfNotExists('semantic_entities', 'derived_from', 'TEXT');
    this.addColumnIfNotExists('semantic_entities', 'origin_id', 'TEXT');
    this.addColumnIfNotExists('semantic_entities', 'origin_name', 'TEXT');
    this.addColumnIfNotExists('semantic_entities', 'sync_seq', 'INTEGER DEFAULT 0');

    // Add parallelization columns to working_memory
    this.addColumnIfNotExists('working_memory', 'origin_id', 'TEXT');
    this.addColumnIfNotExists('working_memory', 'origin_name', 'TEXT');
    this.addColumnIfNotExists('working_memory', 'sync_seq', 'INTEGER DEFAULT 0');

    this.save();
  }

  /**
   * Add a column to a table if it doesn't already exist
   * SQLite doesn't have a native IF NOT EXISTS for ALTER TABLE ADD COLUMN,
   * so we check the table info first
   */
  private addColumnIfNotExists(table: string, column: string, type: string): void {
    if (!this.db) return;

    try {
      const result = this.db.exec(`PRAGMA table_info(${table})`);
      if (result.length > 0) {
        const columns = result[0].values.map((row) => row[1] as string);
        if (!columns.includes(column)) {
          this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        }
      }
    } catch (error) {
      // Column might already exist or table doesn't exist yet
      console.error(`Failed to add column ${column} to ${table}:`, error);
    }
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

  /**
   * Helper method to add an episode with minimal input (generates ID and timestamps)
   */
  addEpisode(input: {
    type: EpisodicMemory['type'];
    summary: string;
    details: string;
    context?: Partial<EpisodicMemory['context']>;
    outcome?: EpisodicMemory['outcome'];
    importance?: number;
    tags?: string[];
  }): string {
    const now = Date.now();
    const id = `ep_${now}_${Math.random().toString(36).substr(2, 9)}`;

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
    };

    return this.createEpisode(episode);
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
    const params: (string | number | null)[] = [];

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

  /**
   * Helper method to create a semantic entity with minimal input (generates ID and timestamps)
   */
  createSemanticEntity(input: {
    name: string;
    type: SemanticEntity['type'];
    description: string;
    content?: SemanticEntity['content'];
    procedure?: SemanticEntity['procedure'];
    observations?: string[];
    confidence?: number;
    tags?: string[];
  }): SemanticEntity {
    const now = Date.now();
    const id = `se_${now}_${Math.random().toString(36).substr(2, 9)}`;

    const entity: SemanticEntity = {
      id,
      name: input.name,
      type: input.type,
      description: input.description,
      content: input.content || null,
      procedure: input.procedure,
      observations: input.observations || [],
      confidence: input.confidence ?? 1.0,
      source: 'user',
      createdAt: now,
      updatedAt: now,
      version: 1,
      tags: input.tags || [],
    };

    this.createEntity(entity);
    return entity;
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
    const params: (string | number | null)[] = [Date.now()];

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

  // ============================================================================
  // Agent Operations
  // ============================================================================

  createAgent(input: AgentProfileInput): AgentProfile {
    if (!this.db) throw new Error('Database not initialized');

    const now = Date.now();
    const id = `agent_${now}_${Math.random().toString(36).substr(2, 9)}`;

    const agent: AgentProfile = {
      id,
      name: input.name,
      role: input.role,
      specializations: input.specializations || [],
      capabilities: input.capabilities || [],
      knowledgeDomains: input.knowledgeDomains || [],
      createdAt: now,
      lastActiveAt: now,
    };

    this.db.run(`
      INSERT INTO agents (id, name, role, specializations, capabilities, knowledge_domains, created_at, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      agent.id,
      agent.name,
      agent.role,
      JSON.stringify(agent.specializations),
      JSON.stringify(agent.capabilities),
      JSON.stringify(agent.knowledgeDomains),
      agent.createdAt,
      agent.lastActiveAt,
    ]);

    this.save();
    return agent;
  }

  getAgent(id: string): AgentProfile | null {
    if (!this.db) return null;

    const result = this.db.exec('SELECT * FROM agents WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.rowToAgent(result[0].columns, result[0].values[0]);
  }

  getAgentByName(name: string): AgentProfile | null {
    if (!this.db) return null;

    const result = this.db.exec('SELECT * FROM agents WHERE name = ?', [name]);
    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.rowToAgent(result[0].columns, result[0].values[0]);
  }

  listAgents(filter?: { role?: AgentRole; activeWithinMs?: number }): AgentProfile[] {
    if (!this.db) return [];

    let sql = 'SELECT * FROM agents WHERE 1=1';
    const params: (string | number | null)[] = [];

    if (filter?.role) {
      sql += ' AND role = ?';
      params.push(filter.role);
    }

    if (filter?.activeWithinMs) {
      sql += ' AND last_active_at > ?';
      params.push(Date.now() - filter.activeWithinMs);
    }

    sql += ' ORDER BY last_active_at DESC';

    const result = this.db.exec(sql, params);
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToAgent(result[0].columns, row));
  }

  updateAgentActivity(id: string): AgentProfile | undefined {
    if (!this.db) return undefined;

    this.db.run('UPDATE agents SET last_active_at = ? WHERE id = ?', [Date.now(), id]);
    this.save();
    return this.getAgent(id) ?? undefined;
  }

  deleteAgent(id: string): boolean {
    if (!this.db) return false;

    this.db.run('DELETE FROM agents WHERE id = ?', [id]);
    const changes = this.db.getRowsModified();
    this.save();
    return changes > 0;
  }

  private rowToAgent(columns: string[], values: unknown[]): AgentProfile {
    const row = this.arrayToObject(columns, values);
    return {
      id: row.id as string,
      name: row.name as string,
      role: row.role as AgentRole,
      specializations: JSON.parse(row.specializations as string || '[]'),
      capabilities: JSON.parse(row.capabilities as string || '[]'),
      knowledgeDomains: JSON.parse(row.knowledge_domains as string || '[]'),
      createdAt: row.created_at as number,
      lastActiveAt: row.last_active_at as number,
    };
  }

  // ============================================================================
  // Tachikoma Parallelization Operations
  // ============================================================================

  initTachikoma(id?: TachikomaId, name?: string): TachikomaProfile {
    if (!this.db) throw new Error('Database not initialized');

    const now = Date.now();
    const tachikomaId = id || `tachi_${now}_${Math.random().toString(36).substr(2, 9)}`;

    // Check if already exists
    const existing = this.getTachikomaProfile();
    if (existing) {
      return existing;
    }

    const profile: TachikomaProfile = {
      id: tachikomaId,
      name,
      syncSeq: 0,
      syncVector: { [tachikomaId]: 0 },
      createdAt: now,
    };

    this.db.run(`
      INSERT INTO parallelization_meta (id, tachikoma_id, tachikoma_name, sync_seq, sync_vector, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      `meta_${tachikomaId}`,
      profile.id,
      profile.name || null,
      profile.syncSeq,
      JSON.stringify(profile.syncVector),
      profile.createdAt,
    ]);

    this.save();
    return profile;
  }

  getTachikomaProfile(): TachikomaProfile | null {
    if (!this.db) return null;

    const result = this.db.exec('SELECT * FROM parallelization_meta LIMIT 1');
    if (result.length === 0 || result[0].values.length === 0) return null;

    const row = this.arrayToObject(result[0].columns, result[0].values[0]);
    return {
      id: row.tachikoma_id as TachikomaId,
      name: row.tachikoma_name as string | undefined,
      syncSeq: row.sync_seq as number,
      syncVector: JSON.parse(row.sync_vector as string),
      lastSyncAt: row.last_sync_at as number | undefined,
      createdAt: row.created_at as number,
    };
  }

  updateTachikomaProfile(updates: Partial<Pick<TachikomaProfile, 'name' | 'syncSeq' | 'syncVector' | 'lastSyncAt'>>): void {
    if (!this.db) return;

    const profile = this.getTachikomaProfile();
    if (!profile) return;

    const setClauses: string[] = [];
    const params: (string | number | null)[] = [];

    if (updates.name !== undefined) {
      setClauses.push('tachikoma_name = ?');
      params.push(updates.name);
    }
    if (updates.syncSeq !== undefined) {
      setClauses.push('sync_seq = ?');
      params.push(updates.syncSeq);
    }
    if (updates.syncVector !== undefined) {
      setClauses.push('sync_vector = ?');
      params.push(JSON.stringify(updates.syncVector));
    }
    if (updates.lastSyncAt !== undefined) {
      setClauses.push('last_sync_at = ?');
      params.push(updates.lastSyncAt);
    }

    if (setClauses.length > 0) {
      params.push(profile.id);
      this.db.run(`UPDATE parallelization_meta SET ${setClauses.join(', ')} WHERE tachikoma_id = ?`, params);
      this.save();
    }
  }

  incrementSyncSeq(): number {
    const profile = this.getTachikomaProfile();
    if (!profile) return 0;

    const newSeq = profile.syncSeq + 1;
    this.updateTachikomaProfile({ syncSeq: newSeq });
    return newSeq;
  }

  // Sync History
  addSyncHistory(entry: Omit<SyncHistoryEntry, 'id' | 'createdAt'>): SyncHistoryEntry {
    if (!this.db) throw new Error('Database not initialized');

    const now = Date.now();
    const id = `sync_${now}_${Math.random().toString(36).substr(2, 9)}`;

    const historyEntry: SyncHistoryEntry = {
      id,
      ...entry,
      createdAt: now,
    };

    this.db.run(`
      INSERT INTO sync_history (id, remote_tachikoma_id, remote_tachikoma_name, sync_type, items_count, conflicts_count, sync_vector, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      historyEntry.id,
      historyEntry.remoteTachikomaId,
      historyEntry.remoteTachikomaName || null,
      historyEntry.syncType,
      historyEntry.itemsCount,
      historyEntry.conflictsCount,
      JSON.stringify(historyEntry.syncVector),
      historyEntry.createdAt,
    ]);

    this.save();
    return historyEntry;
  }

  listSyncHistory(limit: number = 10): SyncHistoryEntry[] {
    if (!this.db) return [];

    const result = this.db.exec('SELECT * FROM sync_history ORDER BY created_at DESC LIMIT ?', [limit]);
    if (result.length === 0) return [];

    return result[0].values.map(row => {
      const r = this.arrayToObject(result[0].columns, row);
      return {
        id: r.id as string,
        remoteTachikomaId: r.remote_tachikoma_id as TachikomaId,
        remoteTachikomaName: r.remote_tachikoma_name as string | undefined,
        syncType: r.sync_type as SyncType,
        itemsCount: r.items_count as number,
        conflictsCount: r.conflicts_count as number,
        syncVector: JSON.parse(r.sync_vector as string),
        createdAt: r.created_at as number,
      };
    });
  }

  // Conflicts
  addConflict(conflict: Omit<ConflictRecord, 'id' | 'createdAt'>): ConflictRecord {
    if (!this.db) throw new Error('Database not initialized');

    const now = Date.now();
    const id = `conflict_${now}_${Math.random().toString(36).substr(2, 9)}`;

    const record: ConflictRecord = {
      id,
      ...conflict,
      createdAt: now,
    };

    this.db.run(`
      INSERT INTO conflicts (id, memory_type, local_item, remote_item, strategy, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      record.id,
      record.memoryType,
      JSON.stringify(record.localItem),
      JSON.stringify(record.remoteItem),
      record.strategy,
      record.createdAt,
    ]);

    this.save();
    return record;
  }

  listConflicts(unresolvedOnly: boolean = true): ConflictRecord[] {
    if (!this.db) return [];

    const sql = unresolvedOnly
      ? 'SELECT * FROM conflicts WHERE resolved_at IS NULL ORDER BY created_at DESC'
      : 'SELECT * FROM conflicts ORDER BY created_at DESC';

    const result = this.db.exec(sql);
    if (result.length === 0) return [];

    return result[0].values.map(row => {
      const r = this.arrayToObject(result[0].columns, row);
      return {
        id: r.id as string,
        memoryType: r.memory_type as ConflictRecord['memoryType'],
        localItem: JSON.parse(r.local_item as string),
        remoteItem: JSON.parse(r.remote_item as string),
        strategy: r.strategy as ConflictRecord['strategy'],
        createdAt: r.created_at as number,
        resolvedAt: r.resolved_at as number | undefined,
        resolution: r.resolution as ConflictRecord['resolution'] | undefined,
      };
    });
  }

  resolveConflict(id: string, resolution: ConflictRecord['resolution']): void {
    if (!this.db) return;

    this.db.run('UPDATE conflicts SET resolved_at = ?, resolution = ? WHERE id = ?', [Date.now(), resolution || null, id]);
    this.save();
  }

  // ============================================================================
  // Pattern Operations
  // ============================================================================

  createPattern(input: PatternInput, agentId?: string, agentRoles?: AgentRole[]): Pattern {
    if (!this.db) throw new Error('Database not initialized');

    const now = Date.now();
    const id = `pattern_${now}_${Math.random().toString(36).substr(2, 9)}`;

    const pattern: Pattern = {
      id,
      pattern: input.pattern,
      frequency: 1,
      confidence: input.confidence || 0.5,
      supportingEpisodes: input.supportingEpisodes || [],
      relatedTags: input.relatedTags || [],
      agentRoles: agentRoles || [],
      sourceAgentId: agentId,
      status: 'candidate',
      createdAt: now,
      updatedAt: now,
    };

    this.db.run(`
      INSERT INTO patterns (id, pattern, frequency, confidence, supporting_episodes, related_tags, agent_roles, source_agent_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      pattern.id,
      pattern.pattern,
      pattern.frequency,
      pattern.confidence,
      JSON.stringify(pattern.supportingEpisodes),
      JSON.stringify(pattern.relatedTags),
      JSON.stringify(pattern.agentRoles),
      pattern.sourceAgentId || null,
      pattern.status,
      pattern.createdAt,
      pattern.updatedAt,
    ]);

    this.save();
    return pattern;
  }

  getPattern(id: string): Pattern | null {
    if (!this.db) return null;

    const result = this.db.exec('SELECT * FROM patterns WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.rowToPattern(result[0].columns, result[0].values[0]);
  }

  listPatterns(query?: PatternQuery): Pattern[] {
    if (!this.db) return [];

    let sql = 'SELECT * FROM patterns WHERE 1=1';
    const params: (string | number | null)[] = [];

    if (query?.status) {
      sql += ' AND status = ?';
      params.push(query.status);
    }
    if (query?.minConfidence) {
      sql += ' AND confidence >= ?';
      params.push(query.minConfidence);
    }
    if (query?.minFrequency) {
      sql += ' AND frequency >= ?';
      params.push(query.minFrequency);
    }
    if (query?.query) {
      sql += ' AND pattern LIKE ?';
      params.push(`%${query.query}%`);
    }

    sql += ' ORDER BY confidence DESC, frequency DESC';

    if (query?.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    const result = this.db.exec(sql, params);
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToPattern(result[0].columns, row));
  }

  updatePatternStatus(id: string, status: PatternStatus): void {
    if (!this.db) return;

    this.db.run('UPDATE patterns SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), id]);
    this.save();
  }

  incrementPatternFrequency(id: string, episodeId?: string): void {
    if (!this.db) return;

    const pattern = this.getPattern(id);
    if (!pattern) return;

    const episodes = episodeId
      ? [...new Set([...pattern.supportingEpisodes, episodeId])]
      : pattern.supportingEpisodes;

    this.db.run(`
      UPDATE patterns SET frequency = frequency + 1, supporting_episodes = ?, updated_at = ? WHERE id = ?
    `, [JSON.stringify(episodes), Date.now(), id]);

    this.save();
  }

  private rowToPattern(columns: string[], values: unknown[]): Pattern {
    const row = this.arrayToObject(columns, values);
    return {
      id: row.id as string,
      pattern: row.pattern as string,
      frequency: row.frequency as number,
      confidence: row.confidence as number,
      supportingEpisodes: JSON.parse(row.supporting_episodes as string || '[]'),
      relatedTags: JSON.parse(row.related_tags as string || '[]'),
      agentRoles: JSON.parse(row.agent_roles as string || '[]'),
      sourceAgentId: row.source_agent_id as string | undefined,
      status: row.status as PatternStatus,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  // ============================================================================
  // Insight Operations
  // ============================================================================

  createInsight(input: InsightInput, agentId?: string): Insight {
    if (!this.db) throw new Error('Database not initialized');

    const now = Date.now();
    const id = `insight_${now}_${Math.random().toString(36).substr(2, 9)}`;

    const insight: Insight = {
      id,
      insight: input.insight,
      reasoning: input.reasoning || '',
      sourcePatterns: input.sourcePatterns || [],
      confidence: input.confidence || 0.5,
      novelty: 0.5,
      utility: 0.5,
      domains: input.domains || [],
      sourceAgentId: agentId,
      validatedBy: [],
      status: 'candidate',
      knowledgeLevel: 'insight',
      createdAt: now,
      updatedAt: now,
    };

    this.db.run(`
      INSERT INTO insights (id, insight, reasoning, source_patterns, confidence, novelty, utility, domains, source_agent_id, validated_by, status, knowledge_level, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      insight.id,
      insight.insight,
      insight.reasoning,
      JSON.stringify(insight.sourcePatterns),
      insight.confidence,
      insight.novelty,
      insight.utility,
      JSON.stringify(insight.domains),
      insight.sourceAgentId || null,
      JSON.stringify(insight.validatedBy),
      insight.status,
      insight.knowledgeLevel,
      insight.createdAt,
      insight.updatedAt,
    ]);

    this.save();
    return insight;
  }

  getInsight(id: string): Insight | null {
    if (!this.db) return null;

    const result = this.db.exec('SELECT * FROM insights WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.rowToInsight(result[0].columns, result[0].values[0]);
  }

  listInsights(query?: InsightQuery): Insight[] {
    if (!this.db) return [];

    let sql = 'SELECT * FROM insights WHERE 1=1';
    const params: (string | number | null)[] = [];

    if (query?.status) {
      sql += ' AND status = ?';
      params.push(query.status);
    }
    if (query?.minConfidence) {
      sql += ' AND confidence >= ?';
      params.push(query.minConfidence);
    }
    if (query?.query) {
      sql += ' AND (insight LIKE ? OR reasoning LIKE ?)';
      params.push(`%${query.query}%`, `%${query.query}%`);
    }

    sql += ' ORDER BY confidence DESC, created_at DESC';

    if (query?.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    const result = this.db.exec(sql, params);
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToInsight(result[0].columns, row));
  }

  updateInsightStatus(id: string, status: InsightStatus, validatorId?: string): void {
    if (!this.db) return;

    const insight = this.getInsight(id);
    if (!insight) return;

    const validatedBy = validatorId
      ? [...new Set([...insight.validatedBy, validatorId])]
      : insight.validatedBy;

    this.db.run(`
      UPDATE insights SET status = ?, validated_by = ?, updated_at = ? WHERE id = ?
    `, [status, JSON.stringify(validatedBy), Date.now(), id]);

    this.save();
  }

  private rowToInsight(columns: string[], values: unknown[]): Insight {
    const row = this.arrayToObject(columns, values);
    return {
      id: row.id as string,
      insight: row.insight as string,
      reasoning: row.reasoning as string || '',
      sourcePatterns: JSON.parse(row.source_patterns as string || '[]'),
      confidence: row.confidence as number,
      novelty: row.novelty as number,
      utility: row.utility as number,
      domains: JSON.parse(row.domains as string || '[]'),
      sourceAgentId: row.source_agent_id as string | undefined,
      validatedBy: JSON.parse(row.validated_by as string || '[]'),
      status: row.status as InsightStatus,
      knowledgeLevel: row.knowledge_level as Insight['knowledgeLevel'],
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  // ============================================================================
  // Wisdom Operations
  // ============================================================================

  createWisdom(input: WisdomEntityInput, createdBy?: string): WisdomEntity {
    if (!this.db) throw new Error('Database not initialized');

    const now = Date.now();
    const id = `wisdom_${now}_${Math.random().toString(36).substr(2, 9)}`;

    const wisdom: WisdomEntity = {
      id,
      name: input.name,
      principle: input.principle,
      description: input.description,
      derivedFromInsights: input.derivedFromInsights || [],
      derivedFromPatterns: input.derivedFromPatterns || [],
      evidenceEpisodes: input.evidenceEpisodes || [],
      applicableDomains: input.applicableDomains || [],
      applicableContexts: input.applicableContexts || [],
      limitations: input.limitations || [],
      validationCount: 0,
      successfulApplications: 0,
      failedApplications: 0,
      confidenceScore: 0.5,
      createdBy,
      contributingAgents: createdBy ? [createdBy] : [],
      version: 1,
      tags: input.tags || [],
      relatedWisdom: [],
      contradictoryWisdom: [],
      createdAt: now,
      updatedAt: now,
    };

    this.db.run(`
      INSERT INTO wisdom (id, name, principle, description, derived_from_insights, derived_from_patterns, evidence_episodes, applicable_domains, applicable_contexts, limitations, validation_count, successful_applications, failed_applications, confidence_score, created_by, contributing_agents, version, tags, related_wisdom, contradictory_wisdom, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      wisdom.id,
      wisdom.name,
      wisdom.principle,
      wisdom.description,
      JSON.stringify(wisdom.derivedFromInsights),
      JSON.stringify(wisdom.derivedFromPatterns),
      JSON.stringify(wisdom.evidenceEpisodes),
      JSON.stringify(wisdom.applicableDomains),
      JSON.stringify(wisdom.applicableContexts),
      JSON.stringify(wisdom.limitations),
      wisdom.validationCount,
      wisdom.successfulApplications,
      wisdom.failedApplications,
      wisdom.confidenceScore,
      wisdom.createdBy || null,
      JSON.stringify(wisdom.contributingAgents),
      wisdom.version,
      JSON.stringify(wisdom.tags),
      JSON.stringify(wisdom.relatedWisdom),
      JSON.stringify(wisdom.contradictoryWisdom),
      wisdom.createdAt,
      wisdom.updatedAt,
    ]);

    this.save();
    return wisdom;
  }

  getWisdom(idOrName: string): WisdomEntity | null {
    if (!this.db) return null;

    const result = this.db.exec('SELECT * FROM wisdom WHERE id = ? OR name = ?', [idOrName, idOrName]);
    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.rowToWisdom(result[0].columns, result[0].values[0]);
  }

  listWisdom(query?: WisdomQuery): WisdomEntity[] {
    if (!this.db) return [];

    let sql = 'SELECT * FROM wisdom WHERE 1=1';
    const params: (string | number | null)[] = [];

    if (query?.minConfidence) {
      sql += ' AND confidence_score >= ?';
      params.push(query.minConfidence);
    }
    if (query?.query) {
      sql += ' AND (name LIKE ? OR principle LIKE ? OR description LIKE ?)';
      params.push(`%${query.query}%`, `%${query.query}%`, `%${query.query}%`);
    }

    sql += ' ORDER BY confidence_score DESC, created_at DESC';

    if (query?.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    const result = this.db.exec(sql, params);
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToWisdom(result[0].columns, row));
  }

  recordWisdomApplication(application: Omit<WisdomApplication, 'id' | 'appliedAt'>): WisdomApplication {
    if (!this.db) throw new Error('Database not initialized');

    const now = Date.now();
    const id = `wapp_${now}_${Math.random().toString(36).substr(2, 9)}`;

    const app: WisdomApplication = {
      id,
      ...application,
      appliedAt: now,
    };

    this.db.run(`
      INSERT INTO wisdom_applications (id, wisdom_id, episode_id, context, result, feedback, applied_by, applied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      app.id,
      app.wisdomId,
      app.episodeId || null,
      app.context,
      app.result,
      app.feedback || null,
      app.appliedBy || null,
      app.appliedAt,
    ]);

    // Update wisdom statistics
    const wisdom = this.getWisdom(application.wisdomId);
    if (wisdom) {
      const updates: string[] = ['validation_count = validation_count + 1', 'updated_at = ?'];
      const params: (string | number | null)[] = [now];

      if (application.result === 'success') {
        updates.push('successful_applications = successful_applications + 1');
      } else if (application.result === 'failure') {
        updates.push('failed_applications = failed_applications + 1');
      }

      params.push(wisdom.id);
      this.db.run(`UPDATE wisdom SET ${updates.join(', ')} WHERE id = ?`, params);

      // Update confidence score based on success rate
      this.updateWisdomConfidence(wisdom.id);
    }

    this.save();
    return app;
  }

  private updateWisdomConfidence(wisdomId: string): void {
    if (!this.db) return;

    const wisdom = this.getWisdom(wisdomId);
    if (!wisdom || wisdom.validationCount === 0) return;

    // Calculate confidence based on success rate
    const total = wisdom.successfulApplications + wisdom.failedApplications;
    if (total === 0) return;

    const successRate = wisdom.successfulApplications / total;
    // Blend initial confidence with observed success rate
    const newConfidence = 0.3 * 0.5 + 0.7 * successRate;

    this.db.run('UPDATE wisdom SET confidence_score = ? WHERE id = ?', [newConfidence, wisdomId]);
  }

  private rowToWisdom(columns: string[], values: unknown[]): WisdomEntity {
    const row = this.arrayToObject(columns, values);
    return {
      id: row.id as string,
      name: row.name as string,
      principle: row.principle as string,
      description: row.description as string,
      derivedFromInsights: JSON.parse(row.derived_from_insights as string || '[]'),
      derivedFromPatterns: JSON.parse(row.derived_from_patterns as string || '[]'),
      evidenceEpisodes: JSON.parse(row.evidence_episodes as string || '[]'),
      applicableDomains: JSON.parse(row.applicable_domains as string || '[]'),
      applicableContexts: JSON.parse(row.applicable_contexts as string || '[]'),
      limitations: JSON.parse(row.limitations as string || '[]'),
      validationCount: row.validation_count as number,
      successfulApplications: row.successful_applications as number,
      failedApplications: row.failed_applications as number,
      confidenceScore: row.confidence_score as number,
      createdBy: row.created_by as string | undefined,
      contributingAgents: JSON.parse(row.contributing_agents as string || '[]'),
      version: row.version as number,
      tags: JSON.parse(row.tags as string || '[]'),
      relatedWisdom: JSON.parse(row.related_wisdom as string || '[]'),
      contradictoryWisdom: JSON.parse(row.contradictory_wisdom as string || '[]'),
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  // ============================================================================
  // Tachikoma Parallelization - Delta Export/Import
  // ============================================================================

  /**
   * Export memories as delta since a specific sync sequence or timestamp
   */
  exportDelta(sinceTimestamp?: number): ParallelizationExport {
    if (!this.db) throw new Error('Database not initialized');

    const profile = this.getTachikomaProfile();
    if (!profile) throw new Error('Tachikoma not initialized. Run tachikoma_init first.');

    const since = sinceTimestamp || 0;
    const now = Date.now();

    // Get working memory items created/updated since timestamp
    const workingResult = this.db.exec(
      'SELECT * FROM working_memory WHERE updated_at > ?',
      [since]
    );
    const workingItems: WorkingMemoryItem[] = workingResult.length > 0
      ? workingResult[0].values.map(row => {
          const r = this.arrayToObject(workingResult[0].columns, row);
          return {
            id: r.id as string,
            type: r.type as WorkingMemoryItem['type'],
            key: r.key as string,
            value: JSON.parse(r.value as string),
            metadata: {
              createdAt: r.created_at as number,
              updatedAt: r.updated_at as number,
              expiresAt: r.expires_at as number,
              sessionId: r.session_id as string,
              priority: r.priority as WorkingMemoryItem['metadata']['priority'],
            },
            tags: JSON.parse(r.tags as string || '[]'),
          };
        })
      : [];

    // Get episodic memories created/updated since timestamp
    const episodicResult = this.db.exec(
      'SELECT * FROM episodic_memory WHERE last_accessed > ? OR created_at > ?',
      [since, since]
    );
    const episodicItems: EpisodicMemory[] = episodicResult.length > 0
      ? episodicResult[0].values.map(row => this.rowToEpisode(episodicResult[0].columns, row))
      : [];

    // Get semantic entities created/updated since timestamp
    const semanticResult = this.db.exec(
      'SELECT * FROM semantic_entities WHERE updated_at > ?',
      [since]
    );
    const semanticEntities: SemanticEntity[] = semanticResult.length > 0
      ? semanticResult[0].values.map(row => {
          const r = this.arrayToObject(semanticResult[0].columns, row);
          return {
            id: r.id as string,
            name: r.name as string,
            type: r.type as SemanticEntity['type'],
            description: r.description as string,
            content: r.content ? JSON.parse(r.content as string) : null,
            procedure: r.procedure ? JSON.parse(r.procedure as string) : undefined,
            observations: JSON.parse(r.observations as string || '[]'),
            confidence: r.confidence as number,
            source: r.source as SemanticEntity['source'],
            createdAt: r.created_at as number,
            updatedAt: r.updated_at as number,
            version: r.version as number,
            tags: JSON.parse(r.tags as string || '[]'),
          };
        })
      : [];

    // Get semantic relations created since timestamp
    const relationsResult = this.db.exec(
      'SELECT * FROM semantic_relations WHERE created_at > ?',
      [since]
    );
    const semanticRelations: SemanticRelation[] = relationsResult.length > 0
      ? relationsResult[0].values.map(row => {
          const r = this.arrayToObject(relationsResult[0].columns, row);
          return {
            id: r.id as string,
            from: r.from_entity as string,
            to: r.to_entity as string,
            relationType: r.relation_type as string,
            strength: r.strength as number,
            metadata: r.metadata ? JSON.parse(r.metadata as string) : undefined,
            createdAt: r.created_at as number,
          };
        })
      : [];

    // Increment sync sequence
    const newSeq = profile.syncSeq + 1;
    const newSyncVector = { ...profile.syncVector, [profile.id]: newSeq };
    this.updateTachikomaProfile({ syncSeq: newSeq, syncVector: newSyncVector });

    return {
      version: '1.0.0',
      format: 'tachikoma-parallelize-delta',
      tachikomaId: profile.id,
      tachikomaName: profile.name,
      exportedAt: now,
      syncVector: newSyncVector,
      delta: {
        working: workingItems,
        episodic: episodicItems,
        semantic: {
          entities: semanticEntities,
          relations: semanticRelations,
        },
      },
      deleted: {
        working: [],
        episodic: [],
        semantic: { entities: [], relations: [] },
      },
    };
  }

  /**
   * Import delta data from another Tachikoma with conflict resolution
   */
  importDelta(
    data: ParallelizationExport,
    options?: {
      strategy?: ConflictStrategy;
      autoResolve?: boolean;
    }
  ): ParallelizationResult {
    if (!this.db) throw new Error('Database not initialized');

    const profile = this.getTachikomaProfile();
    if (!profile) throw new Error('Tachikoma not initialized. Run tachikoma_init first.');

    const strategy = options?.strategy || 'merge_learnings';
    const autoResolve = options?.autoResolve !== false;

    const result: ParallelizationResult = {
      success: true,
      merged: {
        working: 0,
        episodic: 0,
        semantic: { entities: 0, relations: 0 },
      },
      conflicts: [],
      skipped: 0,
      syncVector: { ...profile.syncVector },
    };

    // Import working memory
    for (const item of data.delta.working) {
      const existing = this.getWorkingMemory(item.key);
      if (existing) {
        if (item.metadata.updatedAt > existing.metadata.updatedAt) {
          this.updateWorkingMemory(item.key, item.value, item.tags);
          result.merged.working++;
        } else {
          result.skipped++;
        }
      } else {
        this.setWorkingMemory(item);
        result.merged.working++;
      }
    }

    // Import episodic memory with conflict handling
    for (const episode of data.delta.episodic) {
      const existing = this.getEpisodeById(episode.id);
      if (existing) {
        // Conflict detected
        if (autoResolve && strategy === 'merge_learnings') {
          // Merge learnings from both
          const mergedLearnings = [...new Set([
            ...(existing.outcome?.learnings || []),
            ...(episode.outcome?.learnings || []),
          ])];
          const mergedOutcome: EpisodeOutcome = {
            status: episode.outcome?.status || existing.outcome?.status || 'partial',
            learnings: mergedLearnings,
            resolution: episode.outcome?.resolution || existing.outcome?.resolution,
          };
          this.updateEpisode(existing.id, {
            outcome: mergedOutcome,
            importance: Math.max(existing.importance, episode.importance),
          });
          result.merged.episodic++;
        } else if (autoResolve && strategy === 'higher_importance') {
          if (episode.importance > existing.importance) {
            this.replaceEpisodeForDelta(episode);
            result.merged.episodic++;
          } else {
            result.skipped++;
          }
        } else if (autoResolve && strategy === 'newer_wins') {
          if (episode.lastAccessed > existing.lastAccessed) {
            this.replaceEpisodeForDelta(episode);
            result.merged.episodic++;
          } else {
            result.skipped++;
          }
        } else {
          // Add to conflicts for manual resolution
          const conflict = this.addConflict({
            memoryType: 'episodic',
            localItem: existing,
            remoteItem: episode,
            strategy,
          });
          result.conflicts.push(conflict);
        }
      } else {
        this.insertEpisodeForDelta(episode);
        result.merged.episodic++;
      }
    }

    // Import semantic entities with conflict handling
    for (const entity of data.delta.semantic.entities) {
      const existing = this.getSemanticEntityById(entity.id) || this.getSemanticEntityByNameForDelta(entity.name);
      if (existing) {
        if (autoResolve && strategy === 'merge_observations') {
          const mergedObservations = [...new Set([
            ...existing.observations,
            ...entity.observations,
          ])];
          this.updateSemanticEntityForDelta(existing.id, {
            observations: mergedObservations,
            confidence: Math.max(existing.confidence, entity.confidence),
          });
          result.merged.semantic.entities++;
        } else if (autoResolve && strategy === 'higher_confidence') {
          if (entity.confidence > existing.confidence) {
            this.replaceSemanticEntityForDelta(entity);
            result.merged.semantic.entities++;
          } else {
            result.skipped++;
          }
        } else if (autoResolve && strategy === 'newer_wins') {
          if (entity.updatedAt > existing.updatedAt) {
            this.replaceSemanticEntityForDelta(entity);
            result.merged.semantic.entities++;
          } else {
            result.skipped++;
          }
        } else {
          const conflict = this.addConflict({
            memoryType: 'semantic',
            localItem: existing,
            remoteItem: entity,
            strategy,
          });
          result.conflicts.push(conflict);
        }
      } else {
        this.insertSemanticEntityForDelta(entity);
        result.merged.semantic.entities++;
      }
    }

    // Import semantic relations
    for (const relation of data.delta.semantic.relations) {
      const existing = this.getSemanticRelationForDelta(relation.id);
      if (!existing) {
        this.insertSemanticRelationForDelta(relation);
        result.merged.semantic.relations++;
      } else {
        result.skipped++;
      }
    }

    // Update sync vector
    result.syncVector = {
      ...profile.syncVector,
      [data.tachikomaId]: data.syncVector[data.tachikomaId] || 0,
    };
    this.updateTachikomaProfile({ syncVector: result.syncVector });

    // Record sync history
    this.addSyncHistory({
      remoteTachikomaId: data.tachikomaId,
      remoteTachikomaName: data.tachikomaName,
      syncType: 'import',
      itemsCount: result.merged.working + result.merged.episodic + result.merged.semantic.entities + result.merged.semantic.relations,
      conflictsCount: result.conflicts.length,
      syncVector: result.syncVector,
    });

    this.save();
    return result;
  }

  // Helper methods for import/export
  private getWorkingMemory(key: string): WorkingMemoryItem | null {
    if (!this.db) return null;
    const result = this.db.exec('SELECT * FROM working_memory WHERE key = ?', [key]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    const r = this.arrayToObject(result[0].columns, result[0].values[0]);
    return {
      id: r.id as string,
      type: r.type as WorkingMemoryItem['type'],
      key: r.key as string,
      value: JSON.parse(r.value as string),
      metadata: {
        createdAt: r.created_at as number,
        updatedAt: r.updated_at as number,
        expiresAt: r.expires_at as number,
        sessionId: r.session_id as string,
        priority: r.priority as WorkingMemoryItem['metadata']['priority'],
      },
      tags: JSON.parse(r.tags as string || '[]'),
    };
  }

  private setWorkingMemory(item: WorkingMemoryItem): void {
    if (!this.db) return;
    this.db.run(`
      INSERT OR REPLACE INTO working_memory (id, type, key, value, session_id, priority, tags, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      item.id,
      item.type,
      item.key,
      JSON.stringify(item.value),
      item.metadata.sessionId,
      item.metadata.priority,
      JSON.stringify(item.tags),
      item.metadata.createdAt,
      item.metadata.updatedAt,
      item.metadata.expiresAt,
    ]);
  }

  private updateWorkingMemory(key: string, value: unknown, tags?: string[]): void {
    if (!this.db) return;
    const now = Date.now();
    this.db.run(
      'UPDATE working_memory SET value = ?, tags = ?, updated_at = ? WHERE key = ?',
      [JSON.stringify(value), JSON.stringify(tags || []), now, key]
    );
  }

  // Private helper to get episode without updating access count (for delta operations)
  private getEpisodeById(id: string): EpisodicMemory | null {
    if (!this.db) return null;
    const result = this.db.exec('SELECT * FROM episodic_memory WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToEpisode(result[0].columns, result[0].values[0]);
  }

  private insertEpisodeForDelta(episode: EpisodicMemory): void {
    if (!this.db) return;
    this.db.run(`
      INSERT INTO episodic_memory (id, timestamp, type, summary, details, context, outcome, related_episodes, related_entities, importance, access_count, last_accessed, tags, created_at)
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
      episode.timestamp,
    ]);
  }

  private replaceEpisodeForDelta(episode: EpisodicMemory): void {
    if (!this.db) return;
    this.db.run('DELETE FROM episodic_memory WHERE id = ?', [episode.id]);
    this.insertEpisodeForDelta(episode);
  }

  // Private helper to get semantic entity by ID (for delta operations)
  private getSemanticEntityById(id: string): SemanticEntity | null {
    if (!this.db) return null;
    const result = this.db.exec('SELECT * FROM semantic_entities WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    const r = this.arrayToObject(result[0].columns, result[0].values[0]);
    return {
      id: r.id as string,
      name: r.name as string,
      type: r.type as SemanticEntity['type'],
      description: r.description as string,
      content: r.content ? JSON.parse(r.content as string) : null,
      procedure: r.procedure ? JSON.parse(r.procedure as string) : undefined,
      observations: JSON.parse(r.observations as string || '[]'),
      confidence: r.confidence as number,
      source: r.source as SemanticEntity['source'],
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
      version: r.version as number,
      tags: JSON.parse(r.tags as string || '[]'),
    };
  }

  private getSemanticEntityByNameForDelta(name: string): SemanticEntity | null {
    if (!this.db) return null;
    const result = this.db.exec('SELECT * FROM semantic_entities WHERE name = ?', [name]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    const r = this.arrayToObject(result[0].columns, result[0].values[0]);
    return {
      id: r.id as string,
      name: r.name as string,
      type: r.type as SemanticEntity['type'],
      description: r.description as string,
      content: r.content ? JSON.parse(r.content as string) : null,
      procedure: r.procedure ? JSON.parse(r.procedure as string) : undefined,
      observations: JSON.parse(r.observations as string || '[]'),
      confidence: r.confidence as number,
      source: r.source as SemanticEntity['source'],
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
      version: r.version as number,
      tags: JSON.parse(r.tags as string || '[]'),
    };
  }

  private insertSemanticEntityForDelta(entity: SemanticEntity): void {
    if (!this.db) return;
    this.db.run(`
      INSERT INTO semantic_entities (id, name, type, description, content, procedure, observations, confidence, source, created_at, updated_at, version, tags)
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
      entity.createdAt,
      entity.updatedAt,
      entity.version,
      JSON.stringify(entity.tags),
    ]);
  }

  private replaceSemanticEntityForDelta(entity: SemanticEntity): void {
    if (!this.db) return;
    this.db.run('DELETE FROM semantic_entities WHERE id = ?', [entity.id]);
    this.insertSemanticEntityForDelta(entity);
  }

  private updateSemanticEntityForDelta(id: string, updates: { observations?: string[]; confidence?: number }): void {
    if (!this.db) return;
    const setClauses: string[] = ['updated_at = ?'];
    const params: (string | number | null)[] = [Date.now()];

    if (updates.observations) {
      setClauses.push('observations = ?');
      params.push(JSON.stringify(updates.observations));
    }
    if (updates.confidence !== undefined) {
      setClauses.push('confidence = ?');
      params.push(updates.confidence);
    }

    params.push(id);
    this.db.run(`UPDATE semantic_entities SET ${setClauses.join(', ')} WHERE id = ?`, params);
  }

  private getSemanticRelationForDelta(id: string): SemanticRelation | null {
    if (!this.db) return null;
    const result = this.db.exec('SELECT * FROM semantic_relations WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    const r = this.arrayToObject(result[0].columns, result[0].values[0]);
    return {
      id: r.id as string,
      from: r.from_entity as string,
      to: r.to_entity as string,
      relationType: r.relation_type as string,
      strength: r.strength as number,
      metadata: r.metadata ? JSON.parse(r.metadata as string) : undefined,
      createdAt: r.created_at as number,
    };
  }

  private insertSemanticRelationForDelta(relation: SemanticRelation): void {
    if (!this.db) return;
    this.db.run(`
      INSERT INTO semantic_relations (id, from_entity, to_entity, relation_type, strength, metadata, created_at)
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
  }
}
