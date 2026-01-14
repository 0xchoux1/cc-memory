/**
 * SemanticMemory unit tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SemanticMemory', () => {
  let manager: MemoryManager;
  const testDataPath = join(tmpdir(), 'cc-memory-test-semantic-' + Date.now());

  beforeEach(async () => {
    manager = new MemoryManager({
      dataPath: testDataPath,
      sessionId: 'test-session-001',
    });
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(() => {
    manager.close();
    if (existsSync(testDataPath)) {
      rmSync(testDataPath, { recursive: true, force: true });
    }
  });

  describe('create', () => {
    it('should create a new fact entity', () => {
      const entity = manager.semantic.create({
        name: 'project-language',
        type: 'fact',
        description: 'The project uses TypeScript',
      });

      expect(entity.id).toBeDefined();
      expect(entity.name).toBe('project-language');
      expect(entity.type).toBe('fact');
      expect(entity.confidence).toBe(1.0);
      expect(entity.version).toBe(1);
    });

    it('should create a procedure entity', () => {
      const entity = manager.semantic.create({
        name: 'deploy-process',
        type: 'procedure',
        description: 'How to deploy the application',
        procedure: {
          steps: ['Build the project', 'Run tests', 'Push to registry', 'Deploy to server'],
          preconditions: ['All tests must pass', 'Branch is main'],
          postconditions: ['Application is running', 'Health check passes'],
        },
      });

      expect(entity.procedure).toBeDefined();
      expect(entity.procedure?.steps.length).toBe(4);
      expect(entity.procedure?.preconditions?.length).toBe(2);
    });

    it('should create entity with custom confidence', () => {
      const entity = manager.semantic.create({
        name: 'hypothesis',
        type: 'pattern',
        description: 'Possible pattern detected',
        confidence: 0.6,
      });

      expect(entity.confidence).toBe(0.6);
    });

    it('should create entity with content', () => {
      const entity = manager.semantic.create({
        name: 'user-config',
        type: 'config',
        description: 'User configuration settings',
        content: {
          theme: 'dark',
          language: 'en',
          notifications: true,
        },
      });

      expect(entity.content).toEqual({
        theme: 'dark',
        language: 'en',
        notifications: true,
      });
    });

    it('should create entity with observations', () => {
      const entity = manager.semantic.create({
        name: 'user-preference',
        type: 'preference',
        description: 'User prefers TypeScript',
        observations: ['Used TypeScript in last 5 projects', 'Has TypeScript in skillset'],
      });

      expect(entity.observations.length).toBe(2);
    });

    it('should create entity with tags', () => {
      const entity = manager.semantic.create({
        name: 'tagged-skill',
        type: 'skill',
        description: 'JavaScript expertise',
        tags: ['programming', 'web', 'frontend'],
      });

      expect(entity.tags).toEqual(['programming', 'web', 'frontend']);
    });
  });

  describe('get', () => {
    it('should retrieve entity by ID', () => {
      const created = manager.semantic.create({
        name: 'test-entity',
        type: 'fact',
        description: 'Test description',
      });

      const retrieved = manager.semantic.get(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
    });

    it('should retrieve entity by name', () => {
      manager.semantic.create({
        name: 'unique-name',
        type: 'fact',
        description: 'Test description',
      });

      const retrieved = manager.semantic.get('unique-name');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('unique-name');
    });

    it('should return null for non-existent identifier', () => {
      const result = manager.semantic.get('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('search', () => {
    beforeEach(() => {
      manager.semantic.create({
        name: 'typescript-fact',
        type: 'fact',
        description: 'TypeScript is a typed superset of JavaScript',
        confidence: 1.0,
        tags: ['language', 'typing'],
      });

      manager.semantic.create({
        name: 'react-skill',
        type: 'skill',
        description: 'React development expertise',
        confidence: 0.9,
        tags: ['frontend', 'library'],
      });

      manager.semantic.create({
        name: 'deploy-procedure',
        type: 'procedure',
        description: 'Deployment procedure for the application',
        confidence: 0.8,
        tags: ['devops', 'deployment'],
      });
    });

    it('should search by text query', () => {
      const results = manager.semantic.search({ query: 'typescript' });
      expect(results.length).toBeGreaterThan(0);
    });

    it('should filter by type', () => {
      const results = manager.semantic.search({ type: 'fact' });
      expect(results.length).toBe(1);
      expect(results[0].type).toBe('fact');
    });

    it('should filter by minimum confidence', () => {
      const results = manager.semantic.search({ minConfidence: 0.85 });
      expect(results.length).toBe(2);
    });

    it('should filter by tags', () => {
      const results = manager.semantic.search({ tags: ['frontend'] });
      expect(results.length).toBe(1);
    });

    it('should limit results', () => {
      const results = manager.semantic.search({ limit: 1 });
      expect(results.length).toBe(1);
    });
  });

  describe('update', () => {
    it('should update entity description', () => {
      const entity = manager.semantic.create({
        name: 'update-test',
        type: 'fact',
        description: 'Original description',
      });

      const success = manager.semantic.update(entity.id, {
        description: 'Updated description',
      });

      expect(success).toBe(true);

      const updated = manager.semantic.get(entity.id);
      expect(updated?.description).toBe('Updated description');
      expect(updated?.version).toBe(2);
    });

    it('should update entity content', () => {
      const entity = manager.semantic.create({
        name: 'content-test',
        type: 'config',
        description: 'Config',
        content: { key: 'value1' },
      });

      manager.semantic.update(entity.id, {
        content: { key: 'value2', newKey: 'newValue' },
      });

      const updated = manager.semantic.get(entity.id);
      expect(updated?.content).toEqual({ key: 'value2', newKey: 'newValue' });
    });

    it('should update entity confidence', () => {
      const entity = manager.semantic.create({
        name: 'confidence-test',
        type: 'pattern',
        description: 'Pattern',
        confidence: 0.5,
      });

      manager.semantic.update(entity.id, { confidence: 0.8 });

      const updated = manager.semantic.get(entity.id);
      expect(updated?.confidence).toBe(0.8);
    });

    it('should return false for non-existent entity', () => {
      const success = manager.semantic.update('non-existent', {
        description: 'New description',
      });

      expect(success).toBe(false);
    });
  });

  describe('addObservation', () => {
    it('should add observation to entity', () => {
      const entity = manager.semantic.create({
        name: 'observation-test',
        type: 'fact',
        description: 'Test fact',
        observations: ['First observation'],
      });

      const success = manager.semantic.addObservation(entity.id, 'Second observation');
      expect(success).toBe(true);

      const updated = manager.semantic.get(entity.id);
      expect(updated?.observations.length).toBe(2);
      expect(updated?.observations).toContain('Second observation');
    });
  });

  describe('addObservations', () => {
    it('should add multiple observations', () => {
      const entity = manager.semantic.create({
        name: 'multi-observation-test',
        type: 'fact',
        description: 'Test fact',
      });

      manager.semantic.addObservations(entity.id, ['Obs 1', 'Obs 2', 'Obs 3']);

      const updated = manager.semantic.get(entity.id);
      expect(updated?.observations.length).toBe(3);
    });
  });

  describe('updateConfidence', () => {
    it('should update confidence score', () => {
      const entity = manager.semantic.create({
        name: 'conf-update-test',
        type: 'pattern',
        description: 'Test pattern',
        confidence: 0.5,
      });

      manager.semantic.updateConfidence(entity.id, 0.75);

      const updated = manager.semantic.get(entity.id);
      expect(updated?.confidence).toBe(0.75);
    });

    it('should clamp confidence to valid range', () => {
      const entity = manager.semantic.create({
        name: 'conf-clamp-test',
        type: 'fact',
        description: 'Test',
      });

      manager.semantic.updateConfidence(entity.id, 1.5);
      let updated = manager.semantic.get(entity.id);
      expect(updated?.confidence).toBeLessThanOrEqual(1);

      manager.semantic.updateConfidence(entity.id, -0.5);
      updated = manager.semantic.get(entity.id);
      expect(updated?.confidence).toBeGreaterThanOrEqual(0);
    });
  });

  describe('updateProcedure', () => {
    it('should update procedure', () => {
      const entity = manager.semantic.create({
        name: 'proc-update-test',
        type: 'procedure',
        description: 'Test procedure',
        procedure: {
          steps: ['Step 1'],
        },
      });

      manager.semantic.updateProcedure(entity.id, {
        steps: ['Step 1', 'Step 2', 'Step 3'],
        preconditions: ['Must be authenticated'],
      });

      const updated = manager.semantic.get(entity.id);
      expect(updated?.procedure?.steps.length).toBe(3);
      expect(updated?.procedure?.preconditions?.length).toBe(1);
    });
  });

  describe('relations', () => {
    let entity1: ReturnType<typeof manager.semantic.create>;
    let entity2: ReturnType<typeof manager.semantic.create>;

    beforeEach(() => {
      entity1 = manager.semantic.create({
        name: 'entity-one',
        type: 'fact',
        description: 'First entity',
      });

      entity2 = manager.semantic.create({
        name: 'entity-two',
        type: 'fact',
        description: 'Second entity',
      });
    });

    describe('relate', () => {
      it('should create relation between entities', () => {
        const relation = manager.semantic.relate(
          entity1.id,
          entity2.id,
          'depends_on'
        );

        expect(relation).not.toBeNull();
        expect(relation?.from).toBe(entity1.id);
        expect(relation?.to).toBe(entity2.id);
        expect(relation?.relationType).toBe('depends_on');
      });

      it('should create relation with custom strength', () => {
        const relation = manager.semantic.relate(
          entity1.id,
          entity2.id,
          'related_to',
          0.7
        );

        expect(relation?.strength).toBe(0.7);
      });

      it('should create relation with metadata', () => {
        const relation = manager.semantic.relate(
          entity1.id,
          entity2.id,
          'part_of',
          1.0,
          { reason: 'Structural relationship' }
        );

        expect(relation?.metadata).toEqual({ reason: 'Structural relationship' });
      });

      it('should return null for non-existent entities', () => {
        const relation = manager.semantic.relate(
          'non-existent',
          entity2.id,
          'depends_on'
        );

        expect(relation).toBeNull();
      });
    });

    describe('getRelations', () => {
      it('should get all relations for an entity', () => {
        manager.semantic.relate(entity1.id, entity2.id, 'depends_on');

        const entity3 = manager.semantic.create({
          name: 'entity-three',
          type: 'fact',
          description: 'Third entity',
        });

        manager.semantic.relate(entity1.id, entity3.id, 'related_to');

        const relations = manager.semantic.getRelations(entity1.id);
        expect(relations.length).toBe(2);
      });
    });

    describe('getRelated', () => {
      it('should get related entities', () => {
        manager.semantic.relate(entity1.id, entity2.id, 'depends_on');

        const related = manager.semantic.getRelated(entity1.id);
        expect(related.length).toBe(1);
        expect(related[0].id).toBe(entity2.id);
      });
    });
  });

  describe('getByType', () => {
    it('should get entities by type', () => {
      manager.semantic.create({ name: 'f1', type: 'fact', description: 'Fact 1' });
      manager.semantic.create({ name: 'f2', type: 'fact', description: 'Fact 2' });
      manager.semantic.create({ name: 's1', type: 'skill', description: 'Skill 1' });

      const facts = manager.semantic.getByType('fact');
      expect(facts.length).toBe(2);
      expect(facts.every(e => e.type === 'fact')).toBe(true);
    });
  });

  describe('getProcedures', () => {
    it('should get all procedures', () => {
      manager.semantic.create({
        name: 'proc1',
        type: 'procedure',
        description: 'Procedure 1',
      });

      manager.semantic.create({
        name: 'proc2',
        type: 'procedure',
        description: 'Procedure 2',
      });

      const procedures = manager.semantic.getProcedures();
      expect(procedures.length).toBe(2);
    });
  });

  describe('getFacts', () => {
    it('should get all facts', () => {
      manager.semantic.create({ name: 'fact1', type: 'fact', description: 'F1' });
      manager.semantic.create({ name: 'fact2', type: 'fact', description: 'F2' });

      const facts = manager.semantic.getFacts();
      expect(facts.length).toBe(2);
    });
  });

  describe('getPreferences', () => {
    it('should get all preferences', () => {
      manager.semantic.create({
        name: 'pref1',
        type: 'preference',
        description: 'Preference 1',
      });

      const preferences = manager.semantic.getPreferences();
      expect(preferences.length).toBe(1);
    });
  });

  describe('exists', () => {
    it('should return true for existing entity', () => {
      const entity = manager.semantic.create({
        name: 'exists-test',
        type: 'fact',
        description: 'Test',
      });

      expect(manager.semantic.exists(entity.id)).toBe(true);
      expect(manager.semantic.exists('exists-test')).toBe(true);
    });

    it('should return false for non-existent entity', () => {
      expect(manager.semantic.exists('non-existent')).toBe(false);
    });
  });

  describe('getGraph', () => {
    it('should get the knowledge graph', () => {
      const e1 = manager.semantic.create({ name: 'n1', type: 'fact', description: 'D1' });
      const e2 = manager.semantic.create({ name: 'n2', type: 'fact', description: 'D2' });
      manager.semantic.relate(e1.id, e2.id, 'related_to');

      const graph = manager.semantic.getGraph();
      expect(graph.entities.length).toBe(2);
      expect(graph.relations.length).toBe(1);
    });
  });
});
