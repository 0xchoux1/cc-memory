/**
 * DIKW Wisdom Hierarchy Tests
 * 知恵昇華機能（DIKW階層）のユニットテスト
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/SqliteStorage.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

describe('DIKW Wisdom Hierarchy', () => {
  let storage: SqliteStorage;
  const testDataPath = join(process.cwd(), '.test-dikw');

  beforeEach(async () => {
    if (existsSync(testDataPath)) {
      rmSync(testDataPath, { recursive: true });
    }
    mkdirSync(testDataPath, { recursive: true });
    storage = new SqliteStorage({ dataPath: testDataPath });
    await storage.initialize();
  });

  afterEach(() => {
    storage.close();
    if (existsSync(testDataPath)) {
      rmSync(testDataPath, { recursive: true });
    }
  });

  describe('Agent Registration', () => {
    it('should create an agent', () => {
      const agent = storage.createAgent({
        name: 'Test Agent',
        role: 'frontend',
        specializations: ['React', 'TypeScript'],
        capabilities: ['UI開発'],
        knowledgeDomains: ['Web'],
      });

      expect(agent.id).toMatch(/^agent_/);
      expect(agent.name).toBe('Test Agent');
      expect(agent.role).toBe('frontend');
      expect(agent.specializations).toEqual(['React', 'TypeScript']);
    });

    it('should get agent by ID', () => {
      const created = storage.createAgent({
        name: 'Find Me',
        role: 'backend',
      });

      const found = storage.getAgent(created.id);
      expect(found).not.toBeNull();
      expect(found?.name).toBe('Find Me');
    });

    it('should list agents by role', () => {
      storage.createAgent({ name: 'Frontend 1', role: 'frontend' });
      storage.createAgent({ name: 'Frontend 2', role: 'frontend' });
      storage.createAgent({ name: 'Backend 1', role: 'backend' });

      const frontendAgents = storage.listAgents({ role: 'frontend' });
      expect(frontendAgents.length).toBe(2);

      const backendAgents = storage.listAgents({ role: 'backend' });
      expect(backendAgents.length).toBe(1);
    });

    it('should update last active time', () => {
      const agent = storage.createAgent({
        name: 'Active Agent',
        role: 'general',
      });

      const initialTime = agent.lastActiveAt;

      // Wait a bit
      const updatedAgent = storage.updateAgentActivity(agent.id);

      expect(updatedAgent?.lastActiveAt).toBeGreaterThanOrEqual(initialTime);
    });
  });

  describe('Pattern (DIKW Level 2)', () => {
    it('should create a pattern', () => {
      const pattern = storage.createPattern({
        pattern: 'Always use pagination for list APIs',
        supportingEpisodes: ['ep1', 'ep2'],
        relatedTags: ['API', 'performance'],
        confidence: 0.8,
      });

      expect(pattern.id).toMatch(/^pattern_/);
      expect(pattern.pattern).toBe('Always use pagination for list APIs');
      expect(pattern.confidence).toBe(0.8);
      expect(pattern.status).toBe('candidate');
      expect(pattern.frequency).toBe(1);
    });

    it('should get pattern by ID', () => {
      const created = storage.createPattern({
        pattern: 'Test pattern',
        confidence: 0.5,
      });

      const found = storage.getPattern(created.id);
      expect(found).not.toBeNull();
      expect(found?.pattern).toBe('Test pattern');
    });

    it('should list patterns with filters', () => {
      storage.createPattern({
        pattern: 'High confidence pattern',
        confidence: 0.9,
      });
      storage.createPattern({
        pattern: 'Low confidence pattern',
        confidence: 0.3,
      });

      const highConfidence = storage.listPatterns({ minConfidence: 0.8 });
      expect(highConfidence.length).toBe(1);
      expect(highConfidence[0].pattern).toContain('High');

      const all = storage.listPatterns();
      expect(all.length).toBe(2);
    });

    it('should update pattern status', () => {
      const pattern = storage.createPattern({
        pattern: 'Pending confirmation',
        confidence: 0.7,
      });

      expect(pattern.status).toBe('candidate');

      storage.updatePatternStatus(pattern.id, 'confirmed');
      const updated = storage.getPattern(pattern.id);
      expect(updated?.status).toBe('confirmed');
    });

    it('should increment pattern frequency', () => {
      const pattern = storage.createPattern({
        pattern: 'Frequent pattern',
        confidence: 0.6,
      });

      expect(pattern.frequency).toBe(1);

      storage.incrementPatternFrequency(pattern.id, 'new-episode');
      const updated = storage.getPattern(pattern.id);
      expect(updated?.frequency).toBe(2);
      expect(updated?.supportingEpisodes).toContain('new-episode');
    });

    it('should search patterns by query', () => {
      storage.createPattern({ pattern: 'API pagination best practice' });
      storage.createPattern({ pattern: 'Error handling guidelines' });
      storage.createPattern({ pattern: 'API rate limiting' });

      const apiPatterns = storage.listPatterns({ query: 'API' });
      expect(apiPatterns.length).toBe(2);
    });
  });

  describe('Insight (DIKW Level 3)', () => {
    it('should create an insight', () => {
      const insight = storage.createInsight({
        insight: 'Unbounded data fetch causes both UI and server issues',
        reasoning: 'Observed in multiple incidents',
        sourcePatterns: ['pattern1', 'pattern2'],
        domains: ['API', 'Performance'],
        confidence: 0.85,
      });

      expect(insight.id).toMatch(/^insight_/);
      expect(insight.insight).toContain('Unbounded');
      expect(insight.confidence).toBe(0.85);
      expect(insight.status).toBe('candidate');
      expect(insight.knowledgeLevel).toBe('insight');
    });

    it('should get insight by ID', () => {
      const created = storage.createInsight({
        insight: 'Test insight',
        confidence: 0.7,
      });

      const found = storage.getInsight(created.id);
      expect(found).not.toBeNull();
      expect(found?.insight).toBe('Test insight');
    });

    it('should list insights with filters', () => {
      storage.createInsight({
        insight: 'Validated insight',
        confidence: 0.9,
      });
      storage.updateInsightStatus(
        storage.listInsights()[0].id,
        'validated'
      );

      storage.createInsight({
        insight: 'Candidate insight',
        confidence: 0.6,
      });

      const validated = storage.listInsights({ status: 'validated' });
      expect(validated.length).toBe(1);
      expect(validated[0].insight).toContain('Validated');
    });

    it('should update insight status with validator', () => {
      const insight = storage.createInsight({
        insight: 'Needs validation',
        confidence: 0.7,
      });

      expect(insight.status).toBe('candidate');
      expect(insight.validatedBy).toEqual([]);

      storage.updateInsightStatus(insight.id, 'validated', 'validator-agent');
      const updated = storage.getInsight(insight.id);
      expect(updated?.status).toBe('validated');
      expect(updated?.validatedBy).toContain('validator-agent');
    });
  });

  describe('Wisdom (DIKW Level 4)', () => {
    it('should create wisdom', () => {
      const wisdom = storage.createWisdom({
        name: 'Default Limits Principle',
        principle: 'All collection APIs should have default pagination',
        description: 'Detailed explanation...',
        derivedFromInsights: ['insight1'],
        derivedFromPatterns: ['pattern1', 'pattern2'],
        applicableDomains: ['API Design', 'REST'],
        applicableContexts: ['New API development'],
        limitations: ['May not apply to internal APIs'],
        tags: ['API', 'design'],
      }, 'creator-agent');

      expect(wisdom.id).toMatch(/^wisdom_/);
      expect(wisdom.name).toBe('Default Limits Principle');
      expect(wisdom.confidenceScore).toBe(0.5); // Initial
      expect(wisdom.createdBy).toBe('creator-agent');
      expect(wisdom.contributingAgents).toContain('creator-agent');
      expect(wisdom.version).toBe(1);
    });

    it('should get wisdom by ID or name', () => {
      const created = storage.createWisdom({
        name: 'Unique Wisdom Name',
        principle: 'Test principle',
        description: 'Test description',
      });

      // By ID
      const byId = storage.getWisdom(created.id);
      expect(byId).not.toBeNull();

      // By name
      const byName = storage.getWisdom('Unique Wisdom Name');
      expect(byName).not.toBeNull();
      expect(byName?.id).toBe(created.id);
    });

    it('should search wisdom', () => {
      storage.createWisdom({
        name: 'API Design Wisdom',
        principle: 'API principle',
        description: 'About APIs',
        applicableDomains: ['API'],
      });
      storage.createWisdom({
        name: 'Database Wisdom',
        principle: 'DB principle',
        description: 'About databases',
        applicableDomains: ['Database'],
      });

      const apiWisdom = storage.listWisdom({ query: 'API' });
      expect(apiWisdom.length).toBe(1);
      expect(apiWisdom[0].name).toContain('API');
    });

    it('should record and track wisdom application', () => {
      const wisdom = storage.createWisdom({
        name: 'Test Wisdom',
        principle: 'Test principle',
        description: 'Test description',
      });

      expect(wisdom.validationCount).toBe(0);
      expect(wisdom.successfulApplications).toBe(0);

      // Record successful application
      const app1 = storage.recordWisdomApplication({
        wisdomId: wisdom.id,
        context: 'Code review',
        result: 'success',
        feedback: 'Worked well',
      });

      expect(app1.id).toMatch(/^wapp_/);

      // Check updated wisdom
      const updated1 = storage.getWisdom(wisdom.id);
      expect(updated1?.validationCount).toBe(1);
      expect(updated1?.successfulApplications).toBe(1);
      expect(updated1?.failedApplications).toBe(0);

      // Record failed application
      storage.recordWisdomApplication({
        wisdomId: wisdom.id,
        context: 'Different context',
        result: 'failure',
        feedback: 'Did not apply',
      });

      const updated2 = storage.getWisdom(wisdom.id);
      expect(updated2?.validationCount).toBe(2);
      expect(updated2?.successfulApplications).toBe(1);
      expect(updated2?.failedApplications).toBe(1);
    });

    it('should update confidence based on success rate', () => {
      const wisdom = storage.createWisdom({
        name: 'Confidence Test',
        principle: 'Test',
        description: 'Test',
      });

      // Record multiple successful applications
      for (let i = 0; i < 5; i++) {
        storage.recordWisdomApplication({
          wisdomId: wisdom.id,
          context: `Context ${i}`,
          result: 'success',
        });
      }

      const updated = storage.getWisdom(wisdom.id);
      // With 100% success rate, confidence should be high
      // Formula: 0.3 * 0.5 + 0.7 * successRate = 0.15 + 0.7 = 0.85
      expect(updated?.confidenceScore).toBeCloseTo(0.85, 2);
    });
  });

  describe('DIKW Flow Integration', () => {
    it('should support full DIKW hierarchy flow', () => {
      // Level 1: Raw experiences (Episodic - already tested elsewhere)

      // Level 2: Create patterns from observations
      const pattern1 = storage.createPattern({
        pattern: 'Large API responses slow down UI',
        supportingEpisodes: ['ep1'],
        confidence: 0.8,
      });

      const pattern2 = storage.createPattern({
        pattern: 'Unbounded queries exhaust DB connections',
        supportingEpisodes: ['ep2'],
        confidence: 0.85,
      });

      // Confirm patterns
      storage.updatePatternStatus(pattern1.id, 'confirmed');
      storage.updatePatternStatus(pattern2.id, 'confirmed');

      // Level 3: Create insight from patterns
      const insight = storage.createInsight({
        insight: 'Both frontend and backend suffer from unbounded data fetching',
        reasoning: 'Cross-domain analysis of patterns',
        sourcePatterns: [pattern1.id, pattern2.id],
        domains: ['API', 'Performance', 'UX'],
        confidence: 0.9,
      });

      // Validate insight
      storage.updateInsightStatus(insight.id, 'validated', 'architecture-agent');

      // Level 4: Sublimate to wisdom
      const wisdom = storage.createWisdom({
        name: 'API Default Limits Principle',
        principle: 'All collection APIs must have default pagination and limits',
        description: 'Unbounded data fetching causes cascading failures across the stack',
        derivedFromInsights: [insight.id],
        derivedFromPatterns: [pattern1.id, pattern2.id],
        applicableDomains: ['API Design', 'REST', 'GraphQL'],
        applicableContexts: ['New API development', 'API review', 'Performance optimization'],
        limitations: ['Internal batch processing may need exceptions'],
        tags: ['API', 'performance', 'best-practice'],
      }, 'architecture-agent');

      // Apply wisdom
      storage.recordWisdomApplication({
        wisdomId: wisdom.id,
        context: 'New user list API design',
        result: 'success',
        feedback: 'Implemented pagination, prevented performance issues',
      });

      // Verify the hierarchy
      const finalWisdom = storage.getWisdom(wisdom.id);
      expect(finalWisdom?.derivedFromInsights).toContain(insight.id);
      expect(finalWisdom?.derivedFromPatterns).toContain(pattern1.id);
      expect(finalWisdom?.validationCount).toBe(1);
      expect(finalWisdom?.successfulApplications).toBe(1);
    });
  });
});
