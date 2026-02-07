/**
 * Goal Tracking tests (P5)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Goal Tracking (P5)', () => {
  let manager: MemoryManager;
  const testDataPath = join(tmpdir(), 'cc-memory-test-goals-' + Date.now());

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

  describe('createGoal', () => {
    it('should create a goal with basic properties', () => {
      const goal = manager.createGoal({
        name: 'Implement Auth System',
        description: 'Build a complete authentication system with JWT',
        successCriteria: [
          'Login endpoint works',
          'JWT tokens are valid',
          'Refresh token mechanism',
        ],
      });

      expect(goal.id).toBeDefined();
      expect(goal.name).toBe('Implement Auth System');
      expect(goal.type).toBe('goal');
      expect(goal.tags).toContain('goal');
    });

    it('should store success criteria in content', () => {
      const goal = manager.createGoal({
        name: 'Test Goal',
        description: 'Test description',
        successCriteria: ['Criterion 1', 'Criterion 2'],
      });

      const content = goal.content as any;
      expect(content.successCriteria).toHaveLength(2);
      expect(content.status).toBe('active');
      expect(content.progress).toBe(0);
    });

    it('should extract keywords from description', () => {
      const goal = manager.createGoal({
        name: 'Build API',
        description: 'Create REST API endpoints for user management',
        successCriteria: ['Endpoints work'],
      });

      const content = goal.content as any;
      expect(content.keywords).toBeDefined();
      expect(content.keywords.length).toBeGreaterThan(0);
    });

    it('should use provided keywords', () => {
      const goal = manager.createGoal({
        name: 'Custom Keywords',
        description: 'Test',
        successCriteria: ['Done'],
        keywords: ['custom', 'keywords', 'here'],
      });

      const content = goal.content as any;
      expect(content.keywords).toEqual(['custom', 'keywords', 'here']);
    });

    it('should support deadline', () => {
      const deadline = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days from now
      const goal = manager.createGoal({
        name: 'Deadline Goal',
        description: 'Goal with deadline',
        successCriteria: ['Complete by deadline'],
        deadline,
      });

      const content = goal.content as any;
      expect(content.deadline).toBe(deadline);
    });
  });

  describe('getGoal', () => {
    it('should retrieve goal by ID', () => {
      const created = manager.createGoal({
        name: 'Get Test',
        description: 'Test retrieval',
        successCriteria: ['Retrieved'],
      });

      const retrieved = manager.getGoal(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.name).toBe('Get Test');
    });

    it('should return null for non-existent goal', () => {
      const result = manager.getGoal('non-existent-id');
      expect(result).toBeNull();
    });

    it('should not return non-goal entities', () => {
      // Create a non-goal entity
      const entity = manager.semantic.create({
        name: 'Regular Entity',
        type: 'fact',
        description: 'Not a goal',
      });

      const result = manager.getGoal(entity.id);
      expect(result).toBeNull();
    });
  });

  describe('listGoals', () => {
    beforeEach(() => {
      manager.createGoal({
        name: 'Active Goal 1',
        description: 'First active',
        successCriteria: ['Done'],
      });

      manager.createGoal({
        name: 'Active Goal 2',
        description: 'Second active',
        successCriteria: ['Done'],
      });
    });

    it('should list all goals', () => {
      const goals = manager.listGoals();
      expect(goals.length).toBe(2);
    });

    it('should filter by status', () => {
      // Complete one goal
      const goals = manager.listGoals();
      manager.updateGoalStatus(goals[0].id, 'completed');

      const activeGoals = manager.listGoals({ status: 'active' });
      expect(activeGoals.length).toBe(1);

      const completedGoals = manager.listGoals({ status: 'completed' });
      expect(completedGoals.length).toBe(1);
    });

    it('should respect limit', () => {
      // Create more goals
      for (let i = 0; i < 5; i++) {
        manager.createGoal({
          name: `Extra Goal ${i}`,
          description: 'Extra',
          successCriteria: ['Done'],
        });
      }

      const limited = manager.listGoals({ limit: 3 });
      expect(limited.length).toBe(3);
    });
  });

  describe('checkGoalProgress', () => {
    it('should find related episodes by keywords', () => {
      const goal = manager.createGoal({
        name: 'Auth Feature',
        description: 'Implement authentication',
        successCriteria: ['Login works', 'Logout works'],
        keywords: ['authentication', 'login'],
      });

      // Create related episodes
      manager.episodic.record({
        type: 'success',
        summary: 'Implemented login authentication',
        details: 'Added login endpoint',
        tags: ['auth'],
      });

      manager.episodic.record({
        type: 'success',
        summary: 'Fixed authentication bug',
        details: 'Fixed token validation',
        tags: ['auth', 'bug'],
      });

      const progress = manager.checkGoalProgress(goal.id);

      expect(progress).not.toBeNull();
      expect(progress?.relatedEpisodeCount).toBeGreaterThan(0);
    });

    it('should calculate progress from success episodes', () => {
      const goal = manager.createGoal({
        name: 'Build Feature',
        description: 'Build the feature',
        successCriteria: ['Part 1', 'Part 2'],
        keywords: ['feature', 'build'],
      });

      // Create success episodes
      manager.episodic.record({
        type: 'success',
        summary: 'Completed feature part 1',
        details: 'Built first part',
        tags: ['feature'],
      });

      manager.episodic.record({
        type: 'milestone',
        summary: 'Feature milestone reached',
        details: 'Major progress',
        tags: ['feature'],
      });

      const progress = manager.checkGoalProgress(goal.id);

      expect(progress?.progress).toBeGreaterThan(0);
    });

    it('should return recent activity', () => {
      const goal = manager.createGoal({
        name: 'Activity Test',
        description: 'Test activity tracking',
        successCriteria: ['Track activity'],
        keywords: ['activity', 'test'],
      });

      manager.episodic.record({
        type: 'success',
        summary: 'First activity',
        details: 'Details',
        tags: ['activity'],
      });

      manager.episodic.record({
        type: 'success',
        summary: 'Second activity',
        details: 'Details',
        tags: ['activity'],
      });

      const progress = manager.checkGoalProgress(goal.id);

      expect(progress?.recentActivity).toBeDefined();
      expect(progress?.recentActivity.length).toBeGreaterThan(0);
    });

    it('should return null for non-existent goal', () => {
      const progress = manager.checkGoalProgress('non-existent');
      expect(progress).toBeNull();
    });

    it('should estimate completion status', () => {
      const goal = manager.createGoal({
        name: 'Status Test',
        description: 'Test status estimation',
        successCriteria: ['One criterion'],
        keywords: ['status'],
      });

      const progress = manager.checkGoalProgress(goal.id);
      expect(progress?.estimatedCompletion).toBeDefined();
    });
  });

  describe('updateGoalStatus', () => {
    it('should update goal status to completed', () => {
      const goal = manager.createGoal({
        name: 'Status Update Test',
        description: 'Test',
        successCriteria: ['Done'],
      });

      const success = manager.updateGoalStatus(goal.id, 'completed');
      expect(success).toBe(true);

      const updated = manager.getGoal(goal.id);
      const content = updated?.content as any;
      expect(content.status).toBe('completed');
      expect(content.progress).toBe(100);
    });

    it('should update goal status to abandoned', () => {
      const goal = manager.createGoal({
        name: 'Abandon Test',
        description: 'Test',
        successCriteria: ['Never'],
      });

      manager.updateGoalStatus(goal.id, 'abandoned');

      const updated = manager.getGoal(goal.id);
      const content = updated?.content as any;
      expect(content.status).toBe('abandoned');
    });

    it('should return false for non-existent goal', () => {
      const result = manager.updateGoalStatus('non-existent', 'completed');
      expect(result).toBe(false);
    });
  });

  describe('addGoalNote', () => {
    it('should add note to goal observations', () => {
      const goal = manager.createGoal({
        name: 'Note Test',
        description: 'Test notes',
        successCriteria: ['Add notes'],
      });

      const success = manager.addGoalNote(goal.id, 'Made progress on step 1');
      expect(success).toBe(true);

      const updated = manager.getGoal(goal.id);
      expect(updated?.observations).toContain('Made progress on step 1');
    });

    it('should return false for non-existent goal', () => {
      const result = manager.addGoalNote('non-existent', 'Note');
      expect(result).toBe(false);
    });
  });
});
