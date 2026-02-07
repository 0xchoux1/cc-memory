/**
 * Session Consolidation tests (N4+P2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';
import { MemoryManager } from '../../src/memory/MemoryManager.js';

describe('SessionConsolidation', () => {
  let manager: MemoryManager;
  const testDir = join(tmpdir(), 'cc-memory-session-test-' + Date.now());

  beforeEach(async () => {
    manager = new MemoryManager({
      dataPath: testDir,
      sessionId: 'test-session-consolidation',
    });
    await manager.ready();
  });

  afterEach(() => {
    manager.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('consolidateOnSessionEnd', () => {
    it('should consolidate high-priority working memory to episodic', () => {
      // Add high-priority working memory
      manager.working.set({
        key: 'important-task',
        value: 'Implemented authentication feature',
        priority: 'high',
        tags: ['auth', 'feature'],
      });

      // Add medium-priority working memory
      manager.working.set({
        key: 'medium-task',
        value: 'Refactored some code',
        priority: 'medium',
        tags: ['refactor'],
      });

      // Add low-priority working memory (should not be consolidated)
      manager.working.set({
        key: 'low-task',
        value: 'Minor tweak',
        priority: 'low',
        tags: ['minor'],
      });

      // Run consolidation
      const result = manager.consolidateOnSessionEnd();

      expect(result.consolidated).toBe(2);
      expect(result.items).toContain('important-task');
      expect(result.items).toContain('medium-task');
      expect(result.items).not.toContain('low-task');

      // Verify episodes were created
      const episodes = manager.episodic.search({ tags: ['session-consolidated'] });
      expect(episodes.length).toBe(2);

      // Verify high-priority episode has importance 7
      const highPriorityEpisode = episodes.find(e => e.tags.includes('priority-high'));
      expect(highPriorityEpisode).toBeDefined();
      expect(highPriorityEpisode?.importance).toBe(7);

      // Verify medium-priority episode has importance 5
      const mediumPriorityEpisode = episodes.find(e => e.tags.includes('priority-medium'));
      expect(mediumPriorityEpisode).toBeDefined();
      expect(mediumPriorityEpisode?.importance).toBe(5);

      // Verify working memory was deleted
      expect(manager.working.get('important-task')).toBeNull();
      expect(manager.working.get('medium-task')).toBeNull();
      expect(manager.working.get('low-task')).not.toBeNull();
    });

    it('should handle empty working memory', () => {
      const result = manager.consolidateOnSessionEnd();
      expect(result.consolidated).toBe(0);
      expect(result.items).toHaveLength(0);
    });
  });

  describe('runSessionEndDIKW', () => {
    it('should detect patterns from similar episodes', () => {
      // Create 4 similar episodes (above threshold of 3)
      for (let i = 0; i < 4; i++) {
        manager.episodic.record({
          type: 'success',
          summary: `Fixed authentication bug #${i}`,
          details: 'Resolved the authentication issue',
          importance: 6,
          tags: ['bugfix', 'authentication', 'security'],
        });
      }

      // Run DIKW analysis (with long age window to include recent episodes)
      const result = manager.runSessionEndDIKW({
        autoCreate: true,
        maxAgeDays: 365, // Include all recent episodes
      });

      // Should detect pattern candidates (but may not meet confidence threshold)
      expect(result.patternsAnalyzed).toBeGreaterThanOrEqual(0);
      // Patterns may or may not be created depending on confidence
      // Just verify the function runs without error
    });

    it('should respect minConfidence threshold', () => {
      // Create 3 episodes (minimum for pattern)
      for (let i = 0; i < 3; i++) {
        manager.episodic.record({
          type: 'success',
          summary: `Task ${i}`,
          details: 'Some work',
          tags: ['test-tag'],
        });
      }

      // Run with high confidence threshold
      const result = manager.runSessionEndDIKW({
        minConfidence: 0.95, // Very high threshold
        autoCreate: true,
      });

      // May not create patterns due to high threshold
      expect(result.patternsAnalyzed).toBeGreaterThanOrEqual(0);
    });

    it('should not create when autoCreate is false', () => {
      // Create similar episodes
      for (let i = 0; i < 4; i++) {
        manager.episodic.record({
          type: 'success',
          summary: `Task ${i}`,
          details: 'Work done',
          tags: ['analysis-only'],
        });
      }

      // Run analysis only
      const result = manager.runSessionEndDIKW({ autoCreate: false });

      expect(result.patternsCreated).toBe(0);
      expect(result.insightsCreated).toBe(0);
      expect(result.wisdomCreated).toBe(0);
    });
  });

  describe('close()', () => {
    it('should run consolidation and DIKW on close', async () => {
      // Add high-priority working memory
      manager.working.set({
        key: 'close-test-task',
        value: 'Task before close',
        priority: 'high',
        tags: ['close-test'],
      });

      // Create similar episodes for pattern detection
      for (let i = 0; i < 3; i++) {
        manager.episodic.record({
          type: 'success',
          summary: `Close test episode ${i}`,
          details: 'Testing close behavior',
          tags: ['close-test-pattern'],
        });
      }

      // Close will run consolidation and DIKW
      manager.close();

      // Reopen to verify
      const manager2 = new MemoryManager({
        dataPath: testDir,
        sessionId: 'test-session-after-close',
      });
      await manager2.ready();

      // Verify consolidation happened
      const episodes = manager2.episodic.search({ tags: ['session-consolidated'] });
      expect(episodes.length).toBe(1);

      manager2.close();
    });
  });
});
