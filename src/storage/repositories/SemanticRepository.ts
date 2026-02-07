/**
 * SemanticRepository - Handles semantic memory storage operations
 */

import { BaseRepository } from './BaseRepository.js';
import type { DatabaseConnection } from '../DatabaseConnection.js';
import type {
  SemanticEntity,
  SemanticEntityInput,
  SemanticRelation,
  SemanticQuery,
  EntitySource,
} from '../../memory/types.js';
import { v4 as uuidv4 } from 'uuid';

export class SemanticRepository extends BaseRepository {
  constructor(connection: DatabaseConnection) {
    super(connection);
  }

  /**
   * Initialize semantic memory tables
   */
  createTables(): void {
    const db = this.connection.getDatabase();
    if (!db) return;

    // Semantic Entities table
    db.run(`
      CREATE TABLE IF NOT EXISTS semantic_entities (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        content TEXT,
        procedure TEXT,
        observations TEXT,
        confidence REAL DEFAULT 1.0,
        source TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        version INTEGER DEFAULT 1,
        tags TEXT
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_semantic_name ON semantic_entities(name)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_semantic_type ON semantic_entities(type)`);

    // Semantic Relations table
    db.run(`
      CREATE TABLE IF NOT EXISTS semantic_relations (
        id TEXT PRIMARY KEY,
        from_entity TEXT NOT NULL,
        to_entity TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        strength REAL DEFAULT 1.0,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (from_entity) REFERENCES semantic_entities(id),
        FOREIGN KEY (to_entity) REFERENCES semantic_entities(id)
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_relation_from ON semantic_relations(from_entity)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_relation_to ON semantic_relations(to_entity)`);
  }

  /**
   * Create a new entity
   */
  create(input: SemanticEntityInput): SemanticEntity {
    const now = Date.now();
    const id = uuidv4();

    const entity: SemanticEntity = {
      id,
      name: input.name,
      type: input.type,
      description: input.description,
      content: input.content,
      procedure: input.procedure,
      observations: input.observations || [],
      confidence: input.confidence ?? 1.0,
      source: input.source || 'user',
      createdAt: now,
      updatedAt: now,
      version: 1,
      tags: input.tags || [],
    };

    this.run(`
      INSERT INTO semantic_entities
      (id, name, type, description, content, procedure, observations, confidence, source, created_at, updated_at, version, tags)
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
      JSON.stringify(entity.source),
      entity.createdAt,
      entity.updatedAt,
      entity.version,
      JSON.stringify(entity.tags),
    ]);

    return entity;
  }

  /**
   * Get an entity by ID
   */
  getById(id: string): SemanticEntity | null {
    const result = this.exec('SELECT * FROM semantic_entities WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToEntity(result[0].columns, result[0].values[0]);
  }

  /**
   * Get an entity by name
   */
  getByName(name: string): SemanticEntity | null {
    const result = this.exec('SELECT * FROM semantic_entities WHERE name = ?', [name]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToEntity(result[0].columns, result[0].values[0]);
  }

  /**
   * Search entities
   */
  search(query: SemanticQuery): SemanticEntity[] {
    let sql = 'SELECT * FROM semantic_entities WHERE 1=1';
    const params: (string | number)[] = [];

    if (query.query) {
      sql += ' AND (name LIKE ? OR description LIKE ?)';
      const pattern = `%${query.query}%`;
      params.push(pattern, pattern);
    }

    if (query.type) {
      sql += ' AND type = ?';
      params.push(query.type);
    }

    if (query.minConfidence) {
      sql += ' AND confidence >= ?';
      params.push(query.minConfidence);
    }

    if (query.tags && query.tags.length > 0) {
      const tagConditions = query.tags.map(() =>
        `EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = ?)`
      ).join(' AND ');
      sql += ` AND (${tagConditions})`;
      params.push(...query.tags);
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

    const result = this.exec(sql, params);
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToEntity(result[0].columns, row));
  }

  /**
   * Update an entity
   */
  update(id: string, updates: Partial<SemanticEntityInput>): boolean {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];

    if (updates.description !== undefined) {
      sets.push('description = ?');
      params.push(updates.description);
    }
    if (updates.content !== undefined) {
      sets.push('content = ?');
      params.push(JSON.stringify(updates.content));
    }
    if (updates.procedure !== undefined) {
      sets.push('procedure = ?');
      params.push(JSON.stringify(updates.procedure));
    }
    if (updates.observations !== undefined) {
      sets.push('observations = ?');
      params.push(JSON.stringify(updates.observations));
    }
    if (updates.confidence !== undefined) {
      sets.push('confidence = ?');
      params.push(updates.confidence);
    }
    if (updates.tags !== undefined) {
      sets.push('tags = ?');
      params.push(JSON.stringify(updates.tags));
    }

    if (sets.length === 0) return false;

    sets.push('updated_at = ?');
    params.push(Date.now());
    sets.push('version = version + 1');

    params.push(id);
    this.run(`UPDATE semantic_entities SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.getRowsModified() > 0;
  }

  /**
   * Add an observation to an entity
   */
  addObservation(id: string, observation: string): boolean {
    const entity = this.getById(id);
    if (!entity) return false;

    const observations = [...entity.observations, observation];
    return this.update(id, { observations });
  }

  /**
   * Delete an entity
   */
  delete(id: string): boolean {
    // Delete relations first
    this.run('DELETE FROM semantic_relations WHERE from_entity = ? OR to_entity = ?', [id, id]);
    // Then delete entity
    this.run('DELETE FROM semantic_entities WHERE id = ?', [id]);
    return this.getRowsModified() > 0;
  }

  // ============================================================================
  // Relation Operations
  // ============================================================================

  /**
   * Create a relation between entities
   */
  createRelation(
    fromId: string,
    toId: string,
    relationType: string,
    strength: number = 1.0,
    metadata?: Record<string, unknown>
  ): SemanticRelation {
    const id = uuidv4();
    const now = Date.now();

    this.run(`
      INSERT INTO semantic_relations
      (id, from_entity, to_entity, relation_type, strength, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      fromId,
      toId,
      relationType,
      strength,
      metadata ? JSON.stringify(metadata) : null,
      now,
    ]);

    return {
      id,
      from: fromId,
      to: toId,
      relationType,
      strength,
      metadata,
      createdAt: now,
    };
  }

  /**
   * Get relations for an entity
   */
  getRelations(entityId: string): SemanticRelation[] {
    const result = this.exec(
      'SELECT * FROM semantic_relations WHERE from_entity = ? OR to_entity = ?',
      [entityId, entityId]
    );

    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToRelation(result[0].columns, row));
  }

  /**
   * Get all relations
   */
  getAllRelations(): SemanticRelation[] {
    const result = this.exec('SELECT * FROM semantic_relations');
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToRelation(result[0].columns, row));
  }

  /**
   * Delete a relation
   */
  deleteRelation(relationId: string): boolean {
    this.run('DELETE FROM semantic_relations WHERE id = ?', [relationId]);
    return this.getRowsModified() > 0;
  }

  /**
   * Convert a database row to a SemanticEntity
   */
  private rowToEntity(columns: string[], row: unknown[]): SemanticEntity {
    const obj = this.rowToObject(columns, row);
    return {
      id: obj.id as string,
      name: obj.name as string,
      type: obj.type as SemanticEntity['type'],
      description: obj.description as string,
      content: this.safeJsonParse(obj.content as string | null, undefined),
      procedure: this.safeJsonParse(obj.procedure as string | null, undefined),
      observations: this.safeJsonParse(obj.observations as string, []),
      confidence: obj.confidence as number,
      source: (obj.source as EntitySource) || 'user',
      createdAt: obj.created_at as number,
      updatedAt: obj.updated_at as number,
      version: obj.version as number,
      tags: this.safeJsonParse(obj.tags as string, []),
    };
  }

  /**
   * Convert a database row to a SemanticRelation
   */
  private rowToRelation(columns: string[], row: unknown[]): SemanticRelation {
    const obj = this.rowToObject(columns, row);
    return {
      id: obj.id as string,
      from: obj.from_entity as string,
      to: obj.to_entity as string,
      relationType: obj.relation_type as string,
      strength: obj.strength as number,
      metadata: this.safeJsonParse(obj.metadata as string | null, undefined),
      createdAt: obj.created_at as number,
    };
  }
}
