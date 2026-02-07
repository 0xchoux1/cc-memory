/**
 * Repository tests (A1)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseConnection } from '../../src/storage/DatabaseConnection.js';
import {
  WorkingMemoryRepository,
  EpisodicRepository,
  SemanticRepository,
} from '../../src/storage/repositories/index.js';

describe('Repositories (A1)', () => {
  let connection: DatabaseConnection;
  const testDataPath = path.join(process.cwd(), 'test-data-repos');

  beforeEach(async () => {
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true });
    }
    fs.mkdirSync(testDataPath, { recursive: true });

    connection = new DatabaseConnection({ dataPath: testDataPath });
    await connection.ready();
  });

  afterEach(() => {
    connection.close();
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true });
    }
  });

  describe('WorkingMemoryRepository', () => {
    let repo: WorkingMemoryRepository;

    beforeEach(() => {
      repo = new WorkingMemoryRepository(connection);
      repo.createTable();
    });

    it('should set and get an item', () => {
      const now = Date.now();
      const item = {
        id: 'test-id',
        key: 'test-key',
        type: 'context' as const,
        value: { data: 'test' },
        metadata: {
          sessionId: 'session-1',
          priority: 'medium' as const,
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 60000,
        },
        tags: ['tag1', 'tag2'],
      };

      repo.set(item);
      const retrieved = repo.get('test-key');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.key).toBe('test-key');
      expect(retrieved?.value).toEqual({ data: 'test' });
      expect(retrieved?.tags).toEqual(['tag1', 'tag2']);
    });

    it('should return null for non-existent item', () => {
      const result = repo.get('non-existent');
      expect(result).toBeNull();
    });

    it('should return null for expired item', () => {
      const now = Date.now();
      const item = {
        id: 'expired-id',
        key: 'expired-key',
        type: 'context' as const,
        value: 'expired',
        metadata: {
          sessionId: 'session-1',
          priority: 'medium' as const,
          createdAt: now - 120000,
          updatedAt: now - 120000,
          expiresAt: now - 60000, // Already expired
        },
        tags: [],
      };

      repo.set(item);
      const retrieved = repo.get('expired-key');

      expect(retrieved).toBeNull();
    });

    it('should list items', () => {
      const now = Date.now();
      repo.set({
        id: 'item-1',
        key: 'key-1',
        type: 'context' as const,
        value: 'value-1',
        metadata: {
          sessionId: 'session-1',
          priority: 'medium' as const,
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 60000,
        },
        tags: [],
      });

      repo.set({
        id: 'item-2',
        key: 'key-2',
        type: 'task_state' as const,
        value: 'value-2',
        metadata: {
          sessionId: 'session-1',
          priority: 'high' as const,
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 60000,
        },
        tags: [],
      });

      const items = repo.list();
      expect(items).toHaveLength(2);
    });

    it('should filter by type', () => {
      const now = Date.now();
      repo.set({
        id: 'item-1',
        key: 'key-1',
        type: 'context' as const,
        value: 'value-1',
        metadata: {
          sessionId: 'session-1',
          priority: 'medium' as const,
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 60000,
        },
        tags: [],
      });

      repo.set({
        id: 'item-2',
        key: 'key-2',
        type: 'task_state' as const,
        value: 'value-2',
        metadata: {
          sessionId: 'session-1',
          priority: 'high' as const,
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 60000,
        },
        tags: [],
      });

      const items = repo.list({ type: 'context' });
      expect(items).toHaveLength(1);
      expect(items[0].key).toBe('key-1');
    });

    it('should delete an item', () => {
      const now = Date.now();
      repo.set({
        id: 'delete-me',
        key: 'delete-key',
        type: 'context' as const,
        value: 'to delete',
        metadata: {
          sessionId: 'session-1',
          priority: 'medium' as const,
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 60000,
        },
        tags: [],
      });

      const deleted = repo.delete('delete-key');
      expect(deleted).toBe(true);

      const retrieved = repo.get('delete-key');
      expect(retrieved).toBeNull();
    });

    it('should clear expired items', () => {
      const now = Date.now();
      repo.set({
        id: 'fresh',
        key: 'fresh-key',
        type: 'context' as const,
        value: 'fresh',
        metadata: {
          sessionId: 'session-1',
          priority: 'medium' as const,
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 60000,
        },
        tags: [],
      });

      repo.set({
        id: 'stale',
        key: 'stale-key',
        type: 'context' as const,
        value: 'stale',
        metadata: {
          sessionId: 'session-1',
          priority: 'medium' as const,
          createdAt: now - 120000,
          updatedAt: now - 120000,
          expiresAt: now - 60000,
        },
        tags: [],
      });

      const cleared = repo.clearExpired();
      expect(cleared).toBe(1);

      const items = repo.list({ includeExpired: true });
      expect(items).toHaveLength(1);
      expect(items[0].key).toBe('fresh-key');
    });
  });

  describe('EpisodicRepository', () => {
    let repo: EpisodicRepository;

    beforeEach(() => {
      repo = new EpisodicRepository(connection);
      repo.createTables();
    });

    it('should record and get an episode', () => {
      const episode = repo.record({
        type: 'success',
        summary: 'Test episode',
        details: 'Detailed description',
        importance: 7,
        tags: ['test', 'success'],
      });

      expect(episode.id).toBeDefined();
      expect(episode.summary).toBe('Test episode');

      const retrieved = repo.get(episode.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.summary).toBe('Test episode');
      expect(retrieved?.accessCount).toBe(1); // Incremented on get
    });

    it('should search episodes', () => {
      repo.record({
        type: 'success',
        summary: 'First success',
        details: 'Details 1',
        importance: 7,
      });

      repo.record({
        type: 'error',
        summary: 'An error occurred',
        details: 'Error details',
        importance: 8,
      });

      repo.record({
        type: 'success',
        summary: 'Second success',
        details: 'Details 2',
        importance: 6,
      });

      const allEpisodes = repo.search({});
      expect(allEpisodes).toHaveLength(3);

      const successes = repo.search({ type: 'success' });
      expect(successes).toHaveLength(2);

      const highImportance = repo.search({ minImportance: 7 });
      expect(highImportance).toHaveLength(2);
    });

    it('should update an episode', () => {
      const episode = repo.record({
        type: 'success',
        summary: 'To update',
        details: 'Original details',
        importance: 5,
      });

      const updated = repo.update(episode.id, {
        importance: 9,
        tags: ['updated'],
      });

      expect(updated).toBe(true);

      const retrieved = repo.get(episode.id);
      expect(retrieved?.importance).toBe(9);
      expect(retrieved?.tags).toContain('updated');
    });

    it('should delete an episode', () => {
      const episode = repo.record({
        type: 'success',
        summary: 'To delete',
        details: 'Will be deleted',
        importance: 5,
      });

      const deleted = repo.delete(episode.id);
      expect(deleted).toBe(true);

      const retrieved = repo.get(episode.id);
      expect(retrieved).toBeNull();
    });

    it('should handle transcripts', () => {
      const episode = repo.record({
        type: 'interaction',
        summary: 'Conversation',
        details: 'A conversation transcript',
        importance: 5,
      });

      const transcript = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there!' },
      ];

      repo.setTranscript(episode.id, transcript);

      const retrieved = repo.getTranscript(episode.id);
      expect(retrieved).toHaveLength(2);
      expect(retrieved?.[0].content).toBe('Hello');

      const metadata = repo.getTranscriptMetadata(episode.id);
      expect(metadata?.messageCount).toBe(2);
      expect(metadata?.totalChars).toBe(14); // "Hello" (5) + "Hi there!" (9)
    });

    it('should set emotional valence/arousal based on type', () => {
      const error = repo.record({
        type: 'error',
        summary: 'Error',
        details: 'An error',
        importance: 5,
      });

      const success = repo.record({
        type: 'success',
        summary: 'Success',
        details: 'A success',
        importance: 5,
      });

      expect(error.valence).toBeLessThan(0); // Negative
      expect(error.arousal).toBeGreaterThan(0.5); // High arousal

      expect(success.valence).toBeGreaterThan(0); // Positive
      expect(success.arousal).toBeGreaterThan(0.5); // High arousal
    });
  });

  describe('SemanticRepository', () => {
    let repo: SemanticRepository;

    beforeEach(() => {
      repo = new SemanticRepository(connection);
      repo.createTables();
    });

    it('should create and get an entity', () => {
      const entity = repo.create({
        name: 'test-entity',
        type: 'fact',
        description: 'A test fact',
        confidence: 0.9,
        tags: ['test'],
      });

      expect(entity.id).toBeDefined();
      expect(entity.name).toBe('test-entity');

      const byId = repo.getById(entity.id);
      expect(byId).not.toBeNull();
      expect(byId?.name).toBe('test-entity');

      const byName = repo.getByName('test-entity');
      expect(byName).not.toBeNull();
      expect(byName?.id).toBe(entity.id);
    });

    it('should search entities', () => {
      repo.create({
        name: 'fact-1',
        type: 'fact',
        description: 'First fact',
        confidence: 0.9,
      });

      repo.create({
        name: 'preference-1',
        type: 'preference',
        description: 'User preference',
        confidence: 0.8,
      });

      repo.create({
        name: 'fact-2',
        type: 'fact',
        description: 'Second fact',
        confidence: 0.95,
      });

      const allEntities = repo.search({});
      expect(allEntities).toHaveLength(3);

      const facts = repo.search({ type: 'fact' });
      expect(facts).toHaveLength(2);

      const highConfidence = repo.search({ minConfidence: 0.9 });
      expect(highConfidence).toHaveLength(2);
    });

    it('should update an entity', () => {
      const entity = repo.create({
        name: 'to-update',
        type: 'fact',
        description: 'Original description',
        confidence: 0.5,
      });

      const updated = repo.update(entity.id, {
        description: 'Updated description',
        confidence: 0.9,
      });

      expect(updated).toBe(true);

      const retrieved = repo.getById(entity.id);
      expect(retrieved?.description).toBe('Updated description');
      expect(retrieved?.confidence).toBe(0.9);
      expect(retrieved?.version).toBe(2);
    });

    it('should add observations', () => {
      const entity = repo.create({
        name: 'observable',
        type: 'fact',
        description: 'An observable entity',
        observations: ['Initial observation'],
      });

      repo.addObservation(entity.id, 'Second observation');

      const retrieved = repo.getById(entity.id);
      expect(retrieved?.observations).toHaveLength(2);
      expect(retrieved?.observations).toContain('Second observation');
    });

    it('should create and get relations', () => {
      const entity1 = repo.create({
        name: 'entity-1',
        type: 'fact',
        description: 'First entity',
      });

      const entity2 = repo.create({
        name: 'entity-2',
        type: 'fact',
        description: 'Second entity',
      });

      const relation = repo.createRelation(
        entity1.id,
        entity2.id,
        'related_to',
        0.8
      );

      expect(relation.id).toBeDefined();
      expect(relation.from).toBe(entity1.id);
      expect(relation.to).toBe(entity2.id);
      expect(relation.strength).toBe(0.8);

      const relations = repo.getRelations(entity1.id);
      expect(relations).toHaveLength(1);

      const allRelations = repo.getAllRelations();
      expect(allRelations).toHaveLength(1);
    });

    it('should delete an entity and its relations', () => {
      const entity1 = repo.create({
        name: 'to-delete',
        type: 'fact',
        description: 'Will be deleted',
      });

      const entity2 = repo.create({
        name: 'related',
        type: 'fact',
        description: 'Related entity',
      });

      repo.createRelation(entity1.id, entity2.id, 'related_to');

      const deleted = repo.delete(entity1.id);
      expect(deleted).toBe(true);

      const retrieved = repo.getById(entity1.id);
      expect(retrieved).toBeNull();

      // Relations should also be deleted
      const relations = repo.getRelations(entity2.id);
      expect(relations).toHaveLength(0);
    });
  });

  describe('Transaction Support', () => {
    it('should commit transaction on success', () => {
      const repo = new WorkingMemoryRepository(connection);
      repo.createTable();

      connection.transaction(() => {
        const now = Date.now();
        repo.set({
          id: 'tx-item',
          key: 'tx-key',
          type: 'context',
          value: 'transaction value',
          metadata: {
            sessionId: 'session-1',
            priority: 'medium',
            createdAt: now,
            updatedAt: now,
            expiresAt: now + 60000,
          },
          tags: [],
        });
      });

      const item = repo.get('tx-key');
      expect(item).not.toBeNull();
    });

    it('should rollback transaction on error', () => {
      const repo = new WorkingMemoryRepository(connection);
      repo.createTable();

      try {
        connection.transaction(() => {
          const now = Date.now();
          repo.set({
            id: 'rollback-item',
            key: 'rollback-key',
            type: 'context',
            value: 'will rollback',
            metadata: {
              sessionId: 'session-1',
              priority: 'medium',
              createdAt: now,
              updatedAt: now,
              expiresAt: now + 60000,
            },
            tags: [],
          });
          throw new Error('Intentional error');
        });
      } catch {
        // Expected
      }

      const item = repo.get('rollback-key');
      expect(item).toBeNull();
    });
  });
});
