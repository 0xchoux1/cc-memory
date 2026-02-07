/**
 * Ebbinghaus Forgetting Curve tests (N1)
 *
 * Tests the spaced repetition-based memory decay:
 * - R = e^(-t/S) where S = baseStability * (stabilityGrowthFactor ^ accessCount)
 * - Frequently accessed memories decay slower
 * - Old memories without access decay faster
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import type { SqliteStorage } from '../../src/storage/SqliteStorage.js';

describe('EbbinghausDecay', () => {
  let manager: MemoryManager;
  let storage: SqliteStorage;
  const testDir = join(tmpdir(), 'cc-memory-ebbinghaus-test-' + Date.now());

  beforeEach(async () => {
    manager = new MemoryManager({
      dataPath: testDir,
      sessionId: 'test-ebbinghaus',
    });
    await manager.ready();
    storage = manager.getStorage();
  });

  afterEach(() => {
    manager.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('applyEbbinghausDecay', () => {
    it('should decay old memories that have not been accessed', async () => {
      // Create an episode with a past timestamp
      const oldTime = Date.now() - (10 * 24 * 60 * 60 * 1000); // 10 days ago
      const episode = manager.episodic.record({
        type: 'success',
        summary: 'Old memory',
        details: 'This memory has not been accessed',
        importance: 8,
        tags: ['decay-test'],
      });

      // Manually update lastAccessed to simulate an old memory
      storage.updateEpisode(episode.id, {
        lastAccessed: oldTime,
        accessCount: 0,
      });

      // Apply decay
      const result = manager.applyEbbinghausDecay({
        olderThanDays: 1,
        baseStability: 1,
        minImportance: 1,
      });

      // Should have decayed
      expect(result.updated).toBeGreaterThan(0);
      expect(result.decayed.length).toBeGreaterThan(0);

      // Verify the decay was applied
      const decayedEpisode = result.decayed.find(d => d.id === episode.id);
      expect(decayedEpisode).toBeDefined();
      expect(decayedEpisode?.to).toBeLessThan(8);
    });

    it('should not decay frequently accessed memories as much', async () => {
      const oldTime = Date.now() - (10 * 24 * 60 * 60 * 1000); // 10 days ago

      // Create episode with no access
      const lowAccessEpisode = manager.episodic.record({
        type: 'success',
        summary: 'Low access memory',
        details: 'This memory has not been accessed much',
        importance: 8,
        tags: ['decay-test', 'low-access'],
      });

      // Create episode with high access count
      const highAccessEpisode = manager.episodic.record({
        type: 'success',
        summary: 'High access memory',
        details: 'This memory has been accessed many times',
        importance: 8,
        tags: ['decay-test', 'high-access'],
      });

      // Update both to old lastAccessed time, but different access counts
      storage.updateEpisode(lowAccessEpisode.id, {
        lastAccessed: oldTime,
        accessCount: 0,
      });
      storage.updateEpisode(highAccessEpisode.id, {
        lastAccessed: oldTime,
        accessCount: 10, // 10 accesses
      });

      // Apply decay
      const result = manager.applyEbbinghausDecay({
        olderThanDays: 1,
        baseStability: 1,
        stabilityGrowthFactor: 1.5,
        minImportance: 1,
      });

      // Find the decayed entries
      const lowAccessDecay = result.decayed.find(d => d.id === lowAccessEpisode.id);
      const highAccessDecay = result.decayed.find(d => d.id === highAccessEpisode.id);

      // Low access memory should decay more
      expect(lowAccessDecay).toBeDefined();
      expect(lowAccessDecay?.to).toBeLessThan(8);

      // High access memory should either not decay or decay less
      // With 10 accesses, stability = 1 * 1.5^10 = ~57.6 days
      // Retention for 10 days = e^(-10/57.6) = 0.84, so importance 8 -> ~7
      if (highAccessDecay) {
        expect(highAccessDecay.to).toBeGreaterThan((lowAccessDecay?.to ?? 0));
      }
    });

    it('should respect minImportance floor', async () => {
      const veryOldTime = Date.now() - (365 * 24 * 60 * 60 * 1000); // 1 year ago

      const episode = manager.episodic.record({
        type: 'success',
        summary: 'Very old memory',
        details: 'This memory is very old and should decay to minimum',
        importance: 5,
        tags: ['decay-test', 'floor'],
      });

      storage.updateEpisode(episode.id, {
        lastAccessed: veryOldTime,
        accessCount: 0,
      });

      // Apply decay with minImportance = 2
      const result = manager.applyEbbinghausDecay({
        olderThanDays: 1,
        baseStability: 1,
        minImportance: 2,
      });

      const decayedEpisode = result.decayed.find(d => d.id === episode.id);
      expect(decayedEpisode).toBeDefined();
      expect(decayedEpisode?.to).toBe(2); // Should not go below min
    });

    it('should not decay recent memories', async () => {
      // Create a fresh episode
      const episode = manager.episodic.record({
        type: 'success',
        summary: 'Recent memory',
        details: 'This memory was just created',
        importance: 8,
        tags: ['decay-test', 'recent'],
      });

      // Apply decay for memories older than 7 days
      const result = manager.applyEbbinghausDecay({
        olderThanDays: 7,
        baseStability: 1,
        minImportance: 1,
      });

      // Should not have decayed the recent memory
      const decayedEpisode = result.decayed.find(d => d.id === episode.id);
      expect(decayedEpisode).toBeUndefined();
    });

    it('should calculate stability correctly based on access count', async () => {
      // Mathematical verification:
      // stability = baseStability * (stabilityGrowthFactor ^ accessCount)
      // For baseStability=2, stabilityGrowthFactor=1.5, accessCount=3:
      // stability = 2 * 1.5^3 = 2 * 3.375 = 6.75 days

      // With time=7 days and stability=6.75:
      // retention = e^(-7/6.75) = e^(-1.037) ≈ 0.355
      // importance = 10 * 0.355 ≈ 4

      const oldTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days ago

      const episode = manager.episodic.record({
        type: 'success',
        summary: 'Stability test',
        details: 'Testing stability calculation',
        importance: 10,
        tags: ['stability-test'],
      });

      storage.updateEpisode(episode.id, {
        lastAccessed: oldTime,
        accessCount: 3,
      });

      const result = manager.applyEbbinghausDecay({
        olderThanDays: 1,
        baseStability: 2,
        stabilityGrowthFactor: 1.5,
        minImportance: 1,
      });

      const decayedEpisode = result.decayed.find(d => d.id === episode.id);
      expect(decayedEpisode).toBeDefined();
      // Should be around 4 (10 * 0.355 = 3.55, rounded to 4)
      expect(decayedEpisode?.to).toBeGreaterThanOrEqual(3);
      expect(decayedEpisode?.to).toBeLessThanOrEqual(5);
    });
  });

  describe('legacy applyImportanceDecay', () => {
    it('should apply uniform decay to all old memories', async () => {
      const oldTime = Date.now() - (10 * 24 * 60 * 60 * 1000);

      const episode = manager.episodic.record({
        type: 'success',
        summary: 'Legacy decay test',
        details: 'Testing legacy uniform decay',
        importance: 10,
        tags: ['legacy-decay-test'],
      });

      storage.updateEpisode(episode.id, {
        lastAccessed: oldTime,
      });

      // Apply legacy decay with 0.9 factor (10% reduction)
      const result = manager.applyImportanceDecay({
        decayFactor: 0.9,
        olderThanDays: 1,
        minImportance: 1,
      });

      expect(result.updated).toBeGreaterThan(0);
      // Should decay from 10 to 9 (10 * 0.9 = 9)
      const decayedEpisode = manager.episodic.search({ tags: ['legacy-decay-test'] })[0];
      expect(decayedEpisode.importance).toBe(9);
    });
  });

  describe('applyAccessBoost', () => {
    it('should boost frequently accessed memories', () => {
      // Create episode with high access count
      const episode = manager.episodic.record({
        type: 'success',
        summary: 'Frequently accessed memory',
        details: 'This memory has been accessed many times',
        importance: 5,
        tags: ['boost-test'],
      });

      // Set high access count
      storage.updateEpisode(episode.id, {
        accessCount: 10,
      });

      // Apply boost
      const result = manager.applyAccessBoost({
        boostFactor: 1.5,
        minAccessCount: 5,
        maxImportance: 10,
      });

      expect(result.updated).toBeGreaterThan(0);

      // Verify boost was applied (5 * 1.5 = 7.5 -> 8)
      const boostedEpisode = manager.episodic.search({ tags: ['boost-test'] })[0];
      expect(boostedEpisode.importance).toBeGreaterThan(5);
    });

    it('should not boost beyond maxImportance', () => {
      const episode = manager.episodic.record({
        type: 'milestone',
        summary: 'High importance memory',
        details: 'Already at max importance',
        importance: 10,
        tags: ['max-boost-test'],
      });

      storage.updateEpisode(episode.id, {
        accessCount: 20,
      });

      const result = manager.applyAccessBoost({
        boostFactor: 1.5,
        minAccessCount: 5,
        maxImportance: 10,
      });

      // Should not have been updated since already at max
      const boostedEpisode = manager.episodic.search({ tags: ['max-boost-test'] })[0];
      expect(boostedEpisode.importance).toBe(10);
    });
  });
});
