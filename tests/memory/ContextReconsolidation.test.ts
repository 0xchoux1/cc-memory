/**
 * Context-Dependent Retrieval and Reconsolidation tests (N6+N7)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Context-Dependent Retrieval and Reconsolidation', () => {
  let manager: MemoryManager;
  const testDataPath = join(tmpdir(), 'cc-memory-test-context-' + Date.now());

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

  describe('N6: Context-Dependent Retrieval', () => {
    it('should apply context bonus when projectPath matches', () => {
      // Create episodes with different contexts
      const ep1 = manager.episodic.record({
        type: 'success',
        summary: 'Fixed auth bug',
        details: 'Fixed authentication bug in login module',
        context: {
          projectPath: '/home/user/my-project',
          branch: 'main',
        },
        tags: ['auth', 'bug'],
      });

      const ep2 = manager.episodic.record({
        type: 'success',
        summary: 'Fixed auth error',
        details: 'Fixed authentication error in signup',
        context: {
          projectPath: '/home/user/other-project',
          branch: 'develop',
        },
        tags: ['auth', 'error'],
      });

      // Search with matching context
      const resultsWithContext = manager.smartRecall('auth', {
        currentContext: {
          projectPath: '/home/user/my-project',
          branch: 'main',
        },
        includeWorking: false,
        includeSemantic: false,
      });

      // The episode with matching context should have higher score
      const ep1Result = resultsWithContext.episodic.find(e => e.id === ep1.id);
      const ep2Result = resultsWithContext.episodic.find(e => e.id === ep2.id);

      expect(ep1Result).toBeDefined();
      expect(ep2Result).toBeDefined();
      expect(ep1Result!.relevanceScore).toBeGreaterThan(ep2Result!.relevanceScore);
    });

    it('should apply partial context bonus when only branch matches', () => {
      const ep1 = manager.episodic.record({
        type: 'success',
        summary: 'Implemented feature',
        details: 'Added new feature to auth module',
        context: {
          projectPath: '/home/user/project-a',
          branch: 'feature-login',
        },
        tags: ['feature'],
      });

      const ep2 = manager.episodic.record({
        type: 'success',
        summary: 'Another feature',
        details: 'Added another feature to system',
        context: {
          projectPath: '/home/user/project-b',
          branch: 'feature-login',
        },
        tags: ['feature'],
      });

      const ep3 = manager.episodic.record({
        type: 'success',
        summary: 'Different branch feature',
        details: 'Feature on different branch',
        context: {
          projectPath: '/home/user/project-c',
          branch: 'different-branch',
        },
        tags: ['feature'],
      });

      // Search with context that partially matches ep1 and ep2
      const results = manager.smartRecall('feature', {
        currentContext: {
          projectPath: '/home/user/project-a',
          branch: 'feature-login',
        },
        includeWorking: false,
        includeSemantic: false,
      });

      const ep1Result = results.episodic.find(e => e.id === ep1.id);
      const ep2Result = results.episodic.find(e => e.id === ep2.id);
      const ep3Result = results.episodic.find(e => e.id === ep3.id);

      // ep1 should have highest score (both match)
      // ep2 should have higher score than ep3 (branch matches)
      expect(ep1Result!.relevanceScore).toBeGreaterThan(ep2Result!.relevanceScore);
      expect(ep2Result!.relevanceScore).toBeGreaterThan(ep3Result!.relevanceScore);
    });

    it('should give full context bonus for same session', () => {
      const ep1 = manager.episodic.record({
        type: 'success',
        summary: 'Current session work',
        details: 'Work done in current session',
        tags: ['work'],
      });

      // Create episode in different session
      const originalSession = manager.getSessionId();
      manager.setSessionId('different-session');

      const ep2 = manager.episodic.record({
        type: 'success',
        summary: 'Different session work',
        details: 'Work done in different session',
        tags: ['work'],
      });

      // Restore and search
      manager.setSessionId(originalSession);

      const results = manager.smartRecall('work', {
        currentContext: {
          sessionId: originalSession,
        },
        includeWorking: false,
        includeSemantic: false,
      });

      const ep1Result = results.episodic.find(e => e.id === ep1.id);
      const ep2Result = results.episodic.find(e => e.id === ep2.id);

      // Same session should have higher score
      expect(ep1Result!.relevanceScore).toBeGreaterThan(ep2Result!.relevanceScore);
    });

    it('should work without context (no bonus applied)', () => {
      manager.episodic.record({
        type: 'success',
        summary: 'Test episode',
        details: 'Testing without context',
        tags: ['test'],
      });

      // Search without context should still work
      const results = manager.smartRecall('test', {
        includeWorking: false,
        includeSemantic: false,
      });

      expect(results.episodic.length).toBe(1);
      expect(results.episodic[0].relevanceScore).toBeGreaterThan(0);
    });

    it('should respect custom contextMatchMultiplier', () => {
      const ep = manager.episodic.record({
        type: 'success',
        summary: 'Custom multiplier test',
        details: 'Testing custom context multiplier',
        context: {
          projectPath: '/test/project',
        },
        tags: ['test'],
      });

      // Get baseline score without context
      const baseResults = manager.smartRecall('test', {
        includeWorking: false,
        includeSemantic: false,
      });
      const baseScore = baseResults.episodic[0].relevanceScore;

      // Get score with context and custom multiplier
      const boostedResults = manager.smartRecall('test', {
        currentContext: { projectPath: '/test/project' },
        contextMatchMultiplier: 1.5,
        includeWorking: false,
        includeSemantic: false,
      });
      const boostedScore = boostedResults.episodic[0].relevanceScore;

      // Boosted score should be higher (approximately 1.5x for full match)
      expect(boostedScore).toBeGreaterThan(baseScore);
    });
  });

  describe('N7: Reconsolidation', () => {
    describe('findReconsolidationCandidates', () => {
      it('should find candidates with overlapping tags', () => {
        const source = manager.episodic.record({
          type: 'error',
          summary: 'Auth bug found',
          details: 'Found a bug in authentication',
          tags: ['auth', 'bug', 'security'],
        });

        manager.episodic.record({
          type: 'error',
          summary: 'Another auth issue',
          details: 'Different auth problem',
          tags: ['auth', 'issue', 'security'],
        });

        manager.episodic.record({
          type: 'error',
          summary: 'Unrelated error',
          details: 'Something unrelated',
          tags: ['database', 'connection'],
        });

        const candidates = manager.findReconsolidationCandidates(source.id);

        // Should find the auth issue but not the database error
        expect(candidates.length).toBeGreaterThanOrEqual(1);
        expect(candidates[0].mergeReasons.some(r => r.includes('Tag overlap'))).toBe(true);
      });

      it('should find candidates with matching context', () => {
        const source = manager.episodic.record({
          type: 'success',
          summary: 'Feature completed',
          details: 'Completed auth feature',
          context: {
            projectPath: '/home/user/project',
            branch: 'feature-auth',
          },
          tags: ['feature'],
        });

        manager.episodic.record({
          type: 'success',
          summary: 'Related work',
          details: 'More auth work',
          context: {
            projectPath: '/home/user/project',
            branch: 'feature-auth',
          },
          tags: ['work'],
        });

        const candidates = manager.findReconsolidationCandidates(source.id);

        expect(candidates.length).toBeGreaterThanOrEqual(1);
        expect(candidates[0].mergeReasons.some(r => r.includes('Context match'))).toBe(true);
      });

      it('should respect newerOnly option', () => {
        // Create older episode first
        const older = manager.episodic.record({
          type: 'error',
          summary: 'Older issue',
          details: 'An older issue',
          tags: ['test'],
        });

        // Wait a bit to ensure different timestamps
        const newer = manager.episodic.record({
          type: 'error',
          summary: 'Newer issue',
          details: 'A newer issue',
          tags: ['test'],
        });

        // From older's perspective, newer should be a candidate
        const candidatesFromOlder = manager.findReconsolidationCandidates(older.id, {
          newerOnly: true,
        });
        expect(candidatesFromOlder.some(c => c.episode.id === newer.id)).toBe(true);

        // From newer's perspective with newerOnly=true, older should NOT be a candidate
        const candidatesFromNewer = manager.findReconsolidationCandidates(newer.id, {
          newerOnly: true,
        });
        expect(candidatesFromNewer.some(c => c.episode.id === older.id)).toBe(false);

        // From newer's perspective with newerOnly=false, older SHOULD be a candidate
        const candidatesIncludingOlder = manager.findReconsolidationCandidates(newer.id, {
          newerOnly: false,
        });
        expect(candidatesIncludingOlder.some(c => c.episode.id === older.id)).toBe(true);
      });

      it('should not include already related episodes', () => {
        const ep1 = manager.episodic.record({
          type: 'error',
          summary: 'First error',
          details: 'First error details',
          tags: ['error', 'auth'],
        });

        const ep2 = manager.episodic.record({
          type: 'error',
          summary: 'Second error',
          details: 'Second error details',
          tags: ['error', 'auth'],
        });

        // Relate them
        manager.episodic.relate(ep1.id, ep2.id);

        // ep2 should not appear as candidate (already related)
        const candidates = manager.findReconsolidationCandidates(ep1.id);
        expect(candidates.some(c => c.episode.id === ep2.id)).toBe(false);
      });

      it('should calculate similarity correctly', () => {
        const source = manager.episodic.record({
          type: 'success',
          summary: 'Implemented authentication',
          details: 'Added JWT authentication to the API',
          context: {
            projectPath: '/project',
            branch: 'feature',
          },
          tags: ['auth', 'jwt', 'api'],
        });

        manager.episodic.record({
          type: 'success',
          summary: 'Added authentication tests',
          details: 'Wrote tests for JWT authentication',
          context: {
            projectPath: '/project',
            branch: 'feature',
          },
          tags: ['auth', 'jwt', 'tests'],
        });

        const candidates = manager.findReconsolidationCandidates(source.id);

        expect(candidates.length).toBe(1);
        expect(candidates[0].similarity).toBeGreaterThan(0.5); // High similarity
        expect(candidates[0].mergeReasons.length).toBeGreaterThanOrEqual(2);
      });

      it('should respect limit option', () => {
        const source = manager.episodic.record({
          type: 'error',
          summary: 'Source error',
          details: 'Source details',
          tags: ['common'],
        });

        // Create many similar episodes
        for (let i = 0; i < 10; i++) {
          manager.episodic.record({
            type: 'error',
            summary: `Error ${i}`,
            details: `Details ${i}`,
            tags: ['common'],
          });
        }

        const candidates = manager.findReconsolidationCandidates(source.id, { limit: 3 });
        expect(candidates.length).toBeLessThanOrEqual(3);
      });
    });

    describe('mergeEpisodes', () => {
      it('should combine learnings from both episodes', () => {
        const target = manager.episodic.record({
          type: 'error',
          summary: 'Target error',
          details: 'Target details',
          outcome: {
            status: 'success',
            learnings: ['Learning A'],
          },
          tags: ['test'],
        });

        const merge = manager.episodic.record({
          type: 'error',
          summary: 'Merge error',
          details: 'Merge details',
          outcome: {
            status: 'success',
            learnings: ['Learning B', 'Learning C'],
          },
          tags: ['test'],
        });

        const success = manager.mergeEpisodes(target.id, merge.id);
        expect(success).toBe(true);

        const updated = manager.episodic.get(target.id);
        expect(updated?.outcome?.learnings).toContain('Learning A');
        expect(updated?.outcome?.learnings).toContain('Learning B');
        expect(updated?.outcome?.learnings).toContain('Learning C');
      });

      it('should relate the two episodes', () => {
        const target = manager.episodic.record({
          type: 'success',
          summary: 'Target',
          details: 'Details',
          tags: ['test'],
        });

        const merge = manager.episodic.record({
          type: 'success',
          summary: 'Merge',
          details: 'Details',
          tags: ['test'],
        });

        manager.mergeEpisodes(target.id, merge.id);

        const updated = manager.episodic.get(target.id);
        expect(updated?.relatedEpisodes).toContain(merge.id);
      });

      it('should reduce importance of merged episode', () => {
        const target = manager.episodic.record({
          type: 'success',
          summary: 'Target',
          details: 'Details',
          importance: 7,
          tags: ['test'],
        });

        const merge = manager.episodic.record({
          type: 'success',
          summary: 'Merge',
          details: 'Details',
          importance: 8,
          tags: ['test'],
        });

        manager.mergeEpisodes(target.id, merge.id, {
          mergedImportanceReduction: 0.5,
        });

        const updatedMerge = manager.episodic.get(merge.id);
        expect(updatedMerge?.importance).toBe(4); // 8 * 0.5 = 4
      });

      it('should return false for non-existent episodes', () => {
        const target = manager.episodic.record({
          type: 'success',
          summary: 'Target',
          details: 'Details',
          tags: ['test'],
        });

        expect(manager.mergeEpisodes(target.id, 'non-existent')).toBe(false);
        expect(manager.mergeEpisodes('non-existent', target.id)).toBe(false);
      });

      it('should not duplicate learnings', () => {
        const target = manager.episodic.record({
          type: 'error',
          summary: 'Target',
          details: 'Details',
          outcome: {
            status: 'success',
            learnings: ['Same learning', 'Unique to target'],
          },
          tags: ['test'],
        });

        const merge = manager.episodic.record({
          type: 'error',
          summary: 'Merge',
          details: 'Details',
          outcome: {
            status: 'success',
            learnings: ['Same learning', 'Unique to merge'],
          },
          tags: ['test'],
        });

        manager.mergeEpisodes(target.id, merge.id);

        const updated = manager.episodic.get(target.id);
        const learnings = updated?.outcome?.learnings || [];

        // Should not have duplicate 'Same learning'
        const sameCount = learnings.filter(l => l === 'Same learning').length;
        expect(sameCount).toBe(1);

        // Should have all unique learnings
        expect(learnings).toContain('Unique to target');
        expect(learnings).toContain('Unique to merge');
      });
    });
  });
});
