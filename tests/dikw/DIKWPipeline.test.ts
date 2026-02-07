/**
 * DIKW Pipeline tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { SqliteStorage } from '../../src/storage/SqliteStorage.js';
import { DIKWPipeline, DEFAULT_DIKW_CONFIG } from '../../src/dikw/DIKWPipeline.js';

describe('DIKWPipeline', () => {
  let manager: MemoryManager;
  let storage: SqliteStorage;
  let pipeline: DIKWPipeline;
  const testDir = join(tmpdir(), 'cc-memory-dikw-test-' + Date.now());

  beforeEach(async () => {
    manager = new MemoryManager({
      dataPath: testDir,
      sessionId: 'test-session-dikw',
    });
    // Wait for storage initialization
    await new Promise(resolve => setTimeout(resolve, 100));

    // Access storage for pipeline
    storage = manager.getStorage();
    pipeline = new DIKWPipeline(storage);
  });

  afterEach(() => {
    manager.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('detectPatternCandidates', () => {
    it('should detect pattern from similar episodes', () => {
      // Create episodes with similar tags
      for (let i = 0; i < 4; i++) {
        manager.episodic.record({
          type: 'success',
          summary: `Fixed bug #${i}`,
          details: 'Fixed a bug in the authentication module',
          importance: 6,
          tags: ['bugfix', 'authentication', 'security'],
        });
      }

      const candidates = pipeline.detectPatternCandidates();

      // Should detect a pattern from the 4 similar episodes
      expect(candidates.length).toBeGreaterThanOrEqual(1);
      expect(candidates[0].episodeCount).toBe(4);
      expect(candidates[0].commonTags).toContain('bugfix');
      expect(candidates[0].confidence).toBeGreaterThan(0);
    });

    it('should not detect pattern with too few episodes', () => {
      // Create only 2 episodes (below threshold of 3)
      for (let i = 0; i < 2; i++) {
        manager.episodic.record({
          type: 'success',
          summary: `Task ${i}`,
          details: 'Did something',
          tags: ['rare-tag'],
        });
      }

      const candidates = pipeline.detectPatternCandidates();

      // Should not find patterns with only 2 episodes
      const rareTagPattern = candidates.find(c =>
        c.commonTags.includes('rare-tag')
      );
      expect(rareTagPattern).toBeUndefined();
    });

    it('should not detect duplicate patterns', () => {
      // Create episodes
      for (let i = 0; i < 3; i++) {
        manager.episodic.record({
          type: 'success',
          summary: `Task ${i}`,
          details: 'Work',
          tags: ['testing', 'unit-test'],
        });
      }

      // First detection
      const candidates1 = pipeline.detectPatternCandidates();
      expect(candidates1.length).toBeGreaterThanOrEqual(1);

      // Create pattern from candidate
      pipeline.createPatternFromCandidate(candidates1[0]);

      // Second detection should not return the same pattern
      const candidates2 = pipeline.detectPatternCandidates();
      const samePattern = candidates2.find(c =>
        c.commonTags.includes('testing') && c.commonTags.includes('unit-test')
      );
      expect(samePattern).toBeUndefined();
    });
  });

  describe('detectInsightCandidates', () => {
    it('should detect insight from high-frequency patterns', () => {
      // Create a confirmed pattern with high frequency
      const pattern = storage.createPattern({
        pattern: 'Test pattern for insight detection',
        supportingEpisodes: ['ep1', 'ep2', 'ep3'],
        relatedTags: ['testing'],
        confidence: 0.8,
      });

      // Set status to confirmed
      storage.updatePatternStatus(pattern.id, 'confirmed');

      // Increase frequency
      storage.incrementPatternFrequency(pattern.id);
      storage.incrementPatternFrequency(pattern.id);

      const candidates = pipeline.detectInsightCandidates();

      // Should detect an insight candidate
      expect(candidates.length).toBeGreaterThanOrEqual(1);
      expect(candidates[0].sourcePattern.id).toBe(pattern.id);
      expect(candidates[0].confidence).toBeGreaterThan(0);
    });
  });

  describe('incrementPatternFrequency', () => {
    it('should increment pattern frequency for matching episodes', () => {
      // Create a pattern
      const pattern = storage.createPattern({
        pattern: 'Auth-related pattern',
        supportingEpisodes: [],
        relatedTags: ['auth', 'security'],
        confidence: 0.7,
      });

      // Record a new episode with matching tags
      const episode = manager.episodic.record({
        type: 'success',
        summary: 'Added OAuth support',
        details: 'Implemented OAuth 2.0',
        tags: ['auth', 'oauth'],
      });

      // Increment pattern frequency
      const updated = pipeline.incrementPatternFrequency(episode.id);

      // Pattern should be updated
      expect(updated.length).toBeGreaterThanOrEqual(1);
      const updatedPattern = storage.getPattern(pattern.id);
      expect(updatedPattern?.frequency).toBe(2);
      expect(updatedPattern?.supportingEpisodes).toContain(episode.id);
    });
  });

  describe('analyze', () => {
    it('should run full analysis and return stats', () => {
      // Create some episodes
      for (let i = 0; i < 3; i++) {
        manager.episodic.record({
          type: 'success',
          summary: `Task ${i}`,
          details: 'Work done',
          tags: ['backend', 'api'],
        });
      }

      const result = pipeline.analyze();

      expect(result.stats.episodesAnalyzed).toBe(3);
      expect(result.stats.timestamp).toBeDefined();
      expect(result.patternCandidates).toBeDefined();
      expect(result.insightCandidates).toBeDefined();
      expect(result.wisdomCandidates).toBeDefined();
    });
  });

  describe('configuration', () => {
    it('should use custom configuration', () => {
      const customPipeline = new DIKWPipeline(storage, {
        minEpisodesForPattern: 5,
        tagOverlapThreshold: 0.7,
      });

      // Create 4 episodes (below custom threshold of 5)
      for (let i = 0; i < 4; i++) {
        manager.episodic.record({
          type: 'success',
          summary: `Task ${i}`,
          details: 'Work',
          tags: ['custom-test'],
        });
      }

      const candidates = customPipeline.detectPatternCandidates();

      // Should not detect pattern with custom threshold of 5
      const customPattern = candidates.find(c =>
        c.commonTags.includes('custom-test')
      );
      expect(customPattern).toBeUndefined();
    });
  });
});
