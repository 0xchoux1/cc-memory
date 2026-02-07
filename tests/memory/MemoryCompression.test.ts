/**
 * Memory Summarization and Compression tests (P3)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Memory Summarization and Compression (P3)', () => {
  let manager: MemoryManager;
  const testDataPath = join(tmpdir(), 'cc-memory-test-compression-' + Date.now());

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

  describe('clusterSimilarEpisodes', () => {
    it('should cluster episodes with overlapping tags', () => {
      // Create episodes with similar tags
      for (let i = 0; i < 5; i++) {
        manager.episodic.record({
          type: 'error',
          summary: `Auth error ${i}`,
          details: `Authentication error details ${i}`,
          tags: ['auth', 'error', 'security'],
        });
      }

      // Create unrelated episodes
      for (let i = 0; i < 3; i++) {
        manager.episodic.record({
          type: 'error',
          summary: `Database error ${i}`,
          details: `Database connection error ${i}`,
          tags: ['database', 'connection'],
        });
      }

      const clusters = manager.clusterSimilarEpisodes({
        type: 'error',
        minClusterSize: 3,
      });

      expect(clusters.length).toBeGreaterThanOrEqual(1);
      expect(clusters[0].episodes.length).toBeGreaterThanOrEqual(3);
    });

    it('should respect minimum cluster size', () => {
      // Create only 2 similar episodes (below min cluster size of 3)
      manager.episodic.record({
        type: 'success',
        summary: 'Success 1',
        details: 'Details 1',
        tags: ['feature', 'api'],
      });

      manager.episodic.record({
        type: 'success',
        summary: 'Success 2',
        details: 'Details 2',
        tags: ['feature', 'api'],
      });

      const clusters = manager.clusterSimilarEpisodes({
        minClusterSize: 3,
      });

      expect(clusters.length).toBe(0);
    });

    it('should identify centroid tags correctly', () => {
      // Create cluster with overlapping tags
      const commonTags = ['auth', 'jwt', 'api'];

      for (let i = 0; i < 4; i++) {
        manager.episodic.record({
          type: 'success',
          summary: `Feature ${i}`,
          details: `Details ${i}`,
          tags: [...commonTags, `unique-${i}`],
        });
      }

      const clusters = manager.clusterSimilarEpisodes({
        minClusterSize: 3,
      });

      expect(clusters.length).toBe(1);
      expect(clusters[0].centroidTags).toContain('auth');
      expect(clusters[0].centroidTags).toContain('jwt');
      expect(clusters[0].centroidTags).toContain('api');
    });

    it('should not include episodes tagged as summary', () => {
      // Create regular episodes
      for (let i = 0; i < 4; i++) {
        manager.episodic.record({
          type: 'success',
          summary: `Episode ${i}`,
          details: `Details ${i}`,
          tags: ['common', 'tag'],
        });
      }

      // Create a summary episode
      manager.episodic.record({
        type: 'success',
        summary: 'Summary episode',
        details: 'This is a summary',
        tags: ['common', 'tag', 'summary'],
      });

      const clusters = manager.clusterSimilarEpisodes({
        minClusterSize: 3,
      });

      // Summary should not be included in any cluster
      for (const cluster of clusters) {
        const summaryInCluster = cluster.episodes.some(
          ep => ep.tags.includes('summary')
        );
        expect(summaryInCluster).toBe(false);
      }
    });

    it('should filter by episode type', () => {
      // Create error episodes
      for (let i = 0; i < 4; i++) {
        manager.episodic.record({
          type: 'error',
          summary: `Error ${i}`,
          details: `Error details ${i}`,
          tags: ['common'],
        });
      }

      // Create success episodes
      for (let i = 0; i < 4; i++) {
        manager.episodic.record({
          type: 'success',
          summary: `Success ${i}`,
          details: `Success details ${i}`,
          tags: ['common'],
        });
      }

      // Only cluster errors
      const errorClusters = manager.clusterSimilarEpisodes({
        type: 'error',
        minClusterSize: 3,
      });

      expect(errorClusters.length).toBe(1);
      expect(errorClusters[0].commonType).toBe('error');
      expect(errorClusters[0].episodes.every(ep => ep.type === 'error')).toBe(true);
    });
  });

  describe('summarizeCluster', () => {
    it('should create a summary episode from a cluster', () => {
      // Create cluster episodes
      const episodes = [];
      for (let i = 0; i < 4; i++) {
        episodes.push(manager.episodic.record({
          type: 'error',
          summary: `Bug fix ${i}`,
          details: `Fixed bug in module ${i}`,
          tags: ['bug', 'fix'],
          importance: 5,
        }));
      }

      const clusters = manager.clusterSimilarEpisodes({
        minClusterSize: 3,
      });

      expect(clusters.length).toBe(1);

      const summary = manager.summarizeCluster(clusters[0]);

      expect(summary.tags).toContain('summary');
      expect(summary.tags).toContain('compressed');
      expect(summary.summary).toContain('errors');
      expect(summary.details).toContain('Summarized from');
    });

    it('should combine learnings from all episodes', () => {
      manager.episodic.record({
        type: 'error',
        summary: 'Error 1',
        details: 'Details 1',
        tags: ['common'],
        outcome: {
          status: 'success',
          learnings: ['Learning A', 'Learning B'],
        },
      });

      manager.episodic.record({
        type: 'error',
        summary: 'Error 2',
        details: 'Details 2',
        tags: ['common'],
        outcome: {
          status: 'success',
          learnings: ['Learning C'],
        },
      });

      manager.episodic.record({
        type: 'error',
        summary: 'Error 3',
        details: 'Details 3',
        tags: ['common'],
        outcome: {
          status: 'success',
          learnings: ['Learning A'], // Duplicate
        },
      });

      const clusters = manager.clusterSimilarEpisodes({
        minClusterSize: 3,
      });

      const summary = manager.summarizeCluster(clusters[0]);

      expect(summary.outcome?.learnings).toContain('Learning A');
      expect(summary.outcome?.learnings).toContain('Learning B');
      expect(summary.outcome?.learnings).toContain('Learning C');
      // No duplicates
      expect(summary.outcome?.learnings?.filter(l => l === 'Learning A').length).toBe(1);
    });

    it('should reduce importance of original episodes', () => {
      const originalImportance = 8;
      const episodes = [];

      for (let i = 0; i < 3; i++) {
        episodes.push(manager.episodic.record({
          type: 'success',
          summary: `Feature ${i}`,
          details: `Details ${i}`,
          tags: ['common'],
          importance: originalImportance,
        }));
      }

      const clusters = manager.clusterSimilarEpisodes({
        minClusterSize: 3,
      });

      manager.summarizeCluster(clusters[0], {
        originalImportanceReduction: 0.5,
      });

      // Check that original episodes have reduced importance
      for (const ep of episodes) {
        const updated = manager.episodic.get(ep.id);
        expect(updated?.importance).toBe(Math.floor(originalImportance * 0.5));
      }
    });

    it('should link all original episodes to the summary', () => {
      const episodes = [];

      for (let i = 0; i < 3; i++) {
        episodes.push(manager.episodic.record({
          type: 'milestone',
          summary: `Milestone ${i}`,
          details: `Details ${i}`,
          tags: ['release'],
        }));
      }

      const clusters = manager.clusterSimilarEpisodes({
        minClusterSize: 3,
      });

      const summary = manager.summarizeCluster(clusters[0]);

      // Check that all original episodes are related to the summary
      for (const ep of episodes) {
        const updated = manager.episodic.get(ep.id);
        expect(updated?.relatedEpisodes).toContain(summary.id);
      }
    });
  });

  describe('compressMemories', () => {
    it('should find and compress multiple clusters', () => {
      // Create first cluster
      for (let i = 0; i < 4; i++) {
        manager.episodic.record({
          type: 'error',
          summary: `Auth error ${i}`,
          details: `Auth details ${i}`,
          tags: ['auth', 'error'],
        });
      }

      // Create second cluster
      for (let i = 0; i < 4; i++) {
        manager.episodic.record({
          type: 'success',
          summary: `API success ${i}`,
          details: `API details ${i}`,
          tags: ['api', 'success'],
        });
      }

      const result = manager.compressMemories({
        minClusterSize: 3,
      });

      expect(result.clustersFound).toBe(2);
      expect(result.episodesCompressed).toBe(8);
      expect(result.summariesCreated.length).toBe(2);
    });

    it('should return summary information', () => {
      for (let i = 0; i < 5; i++) {
        manager.episodic.record({
          type: 'error',
          summary: `Error ${i}`,
          details: `Details ${i}`,
          tags: ['common'],
        });
      }

      const result = manager.compressMemories({
        minClusterSize: 3,
      });

      expect(result.summariesCreated.length).toBe(1);
      expect(result.summariesCreated[0].id).toBeDefined();
      expect(result.summariesCreated[0].summary).toBeDefined();
      expect(result.summariesCreated[0].episodeCount).toBe(5);
    });

    it('should not create summaries when no clusters found', () => {
      // Create unrelated episodes
      manager.episodic.record({
        type: 'error',
        summary: 'Error',
        details: 'Details',
        tags: ['unique1'],
      });

      manager.episodic.record({
        type: 'success',
        summary: 'Success',
        details: 'Details',
        tags: ['unique2'],
      });

      const result = manager.compressMemories({
        minClusterSize: 3,
      });

      expect(result.clustersFound).toBe(0);
      expect(result.episodesCompressed).toBe(0);
      expect(result.summariesCreated.length).toBe(0);
    });

    it('should respect type filter', () => {
      // Create error cluster
      for (let i = 0; i < 4; i++) {
        manager.episodic.record({
          type: 'error',
          summary: `Error ${i}`,
          details: `Details ${i}`,
          tags: ['common'],
        });
      }

      // Create success cluster
      for (let i = 0; i < 4; i++) {
        manager.episodic.record({
          type: 'success',
          summary: `Success ${i}`,
          details: `Details ${i}`,
          tags: ['common'],
        });
      }

      // Only compress errors
      const result = manager.compressMemories({
        type: 'error',
        minClusterSize: 3,
      });

      expect(result.clustersFound).toBe(1);
      expect(result.episodesCompressed).toBe(4);

      // Verify the summary is for errors
      const summary = manager.episodic.get(result.summariesCreated[0].id);
      expect(summary?.type).toBe('error');
    });
  });
});
