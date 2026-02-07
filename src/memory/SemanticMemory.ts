/**
 * Semantic Memory - Long-term memory for facts, procedures, and knowledge
 */

import { v7 as uuidv7 } from 'uuid';
import type { SqliteStorage } from '../storage/SqliteStorage.js';
import type {
  SemanticEntity,
  SemanticEntityInput,
  SemanticRelation,
  SemanticQuery,
  Procedure,
} from './types.js';

export class SemanticMemory {
  private storage: SqliteStorage;

  constructor(storage: SqliteStorage) {
    this.storage = storage;
  }

  /**
   * Create a new semantic entity
   */
  create(input: SemanticEntityInput): SemanticEntity {
    const now = Date.now();

    const entity: SemanticEntity = {
      id: uuidv7(),
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

    this.storage.createEntity(entity);
    return entity;
  }

  /**
   * Get an entity by ID or name
   */
  get(identifier: string): SemanticEntity | null {
    return this.storage.getEntity(identifier);
  }

  /**
   * Search for entities
   */
  search(query: SemanticQuery): SemanticEntity[] {
    return this.storage.searchEntities(query);
  }

  /**
   * Update an entity
   */
  update(identifier: string, updates: Partial<Omit<SemanticEntity, 'id' | 'name' | 'createdAt'>>): boolean {
    const entity = this.storage.getEntity(identifier);
    if (!entity) return false;

    return this.storage.updateEntity(entity.id, updates);
  }

  /**
   * Add an observation to an entity
   */
  addObservation(identifier: string, observation: string): boolean {
    const entity = this.storage.getEntity(identifier);
    if (!entity) return false;

    const observations = [...entity.observations, observation];
    return this.storage.updateEntity(entity.id, { observations });
  }

  /**
   * Add multiple observations to an entity
   */
  addObservations(identifier: string, observations: string[]): boolean {
    const entity = this.storage.getEntity(identifier);
    if (!entity) return false;

    const updatedObservations = [...entity.observations, ...observations];
    return this.storage.updateEntity(entity.id, { observations: updatedObservations });
  }

  /**
   * Update entity confidence
   */
  updateConfidence(identifier: string, confidence: number): boolean {
    const entity = this.storage.getEntity(identifier);
    if (!entity) return false;

    return this.storage.updateEntity(entity.id, {
      confidence: Math.max(0, Math.min(1, confidence)),
    });
  }

  /**
   * Update entity procedure
   */
  updateProcedure(identifier: string, procedure: Procedure): boolean {
    const entity = this.storage.getEntity(identifier);
    if (!entity) return false;

    return this.storage.updateEntity(entity.id, { procedure });
  }

  /**
   * Create a relation between two entities
   */
  relate(
    fromIdentifier: string,
    toIdentifier: string,
    relationType: string,
    strength: number = 1.0,
    metadata?: Record<string, unknown>
  ): SemanticRelation | null {
    const fromEntity = this.storage.getEntity(fromIdentifier);
    const toEntity = this.storage.getEntity(toIdentifier);

    if (!fromEntity || !toEntity) return null;

    const relation: SemanticRelation = {
      id: uuidv7(),
      from: fromEntity.id,
      to: toEntity.id,
      relationType,
      strength: Math.max(0, Math.min(1, strength)),
      metadata,
      createdAt: Date.now(),
    };

    this.storage.createRelation(relation);
    return relation;
  }

  /**
   * Get all relations for an entity
   */
  getRelations(identifier: string): SemanticRelation[] {
    const entity = this.storage.getEntity(identifier);
    if (!entity) return [];

    return this.storage.getRelations(entity.id);
  }

  /**
   * Get related entities
   */
  getRelated(identifier: string): SemanticEntity[] {
    const entity = this.storage.getEntity(identifier);
    if (!entity) return [];

    const relations = this.storage.getRelations(entity.id);
    const relatedIds = relations.map(r => r.from === entity.id ? r.to : r.from);

    return relatedIds
      .map(id => this.storage.getEntity(id))
      .filter((e): e is SemanticEntity => e !== null);
  }

  /**
   * Get related entities with relation strength (for spreading activation)
   */
  getRelatedWithStrength(identifier: string): Array<{ entity: SemanticEntity; strength: number; relationType: string }> {
    const entity = this.storage.getEntity(identifier);
    if (!entity) return [];

    const relations = this.storage.getRelations(entity.id);
    const results: Array<{ entity: SemanticEntity; strength: number; relationType: string }> = [];

    for (const relation of relations) {
      const relatedId = relation.from === entity.id ? relation.to : relation.from;
      const relatedEntity = this.storage.getEntity(relatedId);
      if (relatedEntity) {
        results.push({
          entity: relatedEntity,
          strength: relation.strength,
          relationType: relation.relationType,
        });
      }
    }

    return results;
  }

  /**
   * Get entities by type
   */
  getByType(type: SemanticEntity['type'], limit?: number): SemanticEntity[] {
    return this.storage.searchEntities({ type, limit });
  }

  /**
   * Get all procedures
   */
  getProcedures(limit?: number): SemanticEntity[] {
    return this.storage.searchEntities({ type: 'procedure', limit });
  }

  /**
   * Get all facts
   */
  getFacts(limit?: number): SemanticEntity[] {
    return this.storage.searchEntities({ type: 'fact', limit });
  }

  /**
   * Get all preferences
   */
  getPreferences(limit?: number): SemanticEntity[] {
    return this.storage.searchEntities({ type: 'preference', limit });
  }

  /**
   * Check if an entity exists
   */
  exists(identifier: string): boolean {
    return this.storage.getEntity(identifier) !== null;
  }

  /**
   * Get the knowledge graph (all entities and relations)
   */
  getGraph(): { entities: SemanticEntity[]; relations: SemanticRelation[] } {
    const entities = this.storage.searchEntities({});
    const relations: SemanticRelation[] = [];
    const seenRelations = new Set<string>();

    for (const entity of entities) {
      const entityRelations = this.storage.getRelations(entity.id);
      for (const relation of entityRelations) {
        if (!seenRelations.has(relation.id)) {
          relations.push(relation);
          seenRelations.add(relation.id);
        }
      }
    }

    return { entities, relations };
  }
}
