/**
 * Multi-agent integration tests
 * Tests the core flow of multi-agent memory operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { AuditLogger, InMemoryAuditStorage } from '../../src/audit/AuditLogger.js';
import { PermissionValidator, permissionValidator as globalPermissionValidator, canAccessAgentMemory, canWriteAgentMemory, canAccessSharedMemory } from '../../src/server/http/auth/permissionValidator.js';
import { EventDrivenSyncManager } from '../../src/sync/EventDrivenSyncManager.js';
import { VectorClock, CRDTMerge } from '../../src/sync/VectorClock.js';
import type { AuthInfo } from '../../src/server/http/auth/types.js';

describe('Multi-agent integration', () => {
  let tempDir: string;

  let worker1Memory: MemoryManager;
  let worker2Memory: MemoryManager;

  let auditStorage: InMemoryAuditStorage;
  let auditLogger: AuditLogger;
  let permissionValidator: PermissionValidator;

  const managerAuth: AuthInfo = {
    clientId: 'manager-001',
    permissionLevel: 'manager',
    scopes: ['memory:read', 'memory:write', 'memory:share:read', 'memory:share:write', 'memory:team:read', 'memory:team:write', 'memory:manage'],
    team: 'project-alpha',
    managedAgents: ['worker-001', 'worker-002', 'observer-001'],
  };

  const worker1Auth: AuthInfo = {
    clientId: 'worker-001',
    permissionLevel: 'worker',
    scopes: ['memory:read', 'memory:write', 'memory:share:read', 'memory:share:write'],
    team: 'project-alpha',
    managerId: 'manager-001',
  };

  const worker2Auth: AuthInfo = {
    clientId: 'worker-002',
    permissionLevel: 'worker',
    scopes: ['memory:read', 'memory:write', 'memory:share:read', 'memory:share:write'],
    team: 'project-alpha',
    managerId: 'manager-001',
  };

  const observerAuth: AuthInfo = {
    clientId: 'observer-001',
    permissionLevel: 'observer',
    scopes: ['memory:read', 'memory:share:read'],
    team: 'project-alpha',
    managerId: 'manager-001',
  };

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-memory-integration-'));

    // Create memory managers for each agent
    worker1Memory = new MemoryManager({ dataPath: join(tempDir, 'worker1') });
    worker2Memory = new MemoryManager({ dataPath: join(tempDir, 'worker2') });

    await worker1Memory.ready();
    await worker2Memory.ready();

    // Create shared components
    auditStorage = new InMemoryAuditStorage();
    auditLogger = new AuditLogger(auditStorage);
    permissionValidator = new PermissionValidator();

    // Register managed agents on both local and global validators
    permissionValidator.registerManagedAgents('manager-001', ['worker-001', 'worker-002', 'observer-001']);
    globalPermissionValidator.registerManagedAgents('manager-001', ['worker-001', 'worker-002', 'observer-001']);
  });

  afterEach(async () => {
    try {
      if (worker1Memory) worker1Memory.close();
      if (worker2Memory) worker2Memory.close();
    } catch {
      // Ignore close errors
    }
    try {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Private memory isolation', () => {
    it('each agent has separate memory storage', () => {
      // Verify memory managers are separate instances
      expect(worker1Memory).not.toBe(worker2Memory);
      expect(worker1Memory.working).not.toBe(worker2Memory.working);
    });

    it('permission check allows manager to access worker memory', () => {
      // Manager can access worker's memory (via permission check)
      expect(canAccessAgentMemory(managerAuth, 'worker-001')).toBe(true);
      expect(canWriteAgentMemory(managerAuth, 'worker-001')).toBe(true);
    });

    it('permission check denies worker cross-access', () => {
      // Worker cannot access other worker's memory
      expect(canAccessAgentMemory(worker1Auth, 'worker-002')).toBe(false);
      expect(canWriteAgentMemory(worker1Auth, 'worker-002')).toBe(false);
    });
  });

  describe('Shared memory permissions', () => {
    it('workers can access shared pool', () => {
      expect(canAccessSharedMemory(worker1Auth, 'read')).toBe(true);
      expect(canAccessSharedMemory(worker1Auth, 'write')).toBe(true);
    });

    it('observer can read but not write to shared pool', () => {
      expect(canAccessSharedMemory(observerAuth, 'read')).toBe(true);
      expect(canAccessSharedMemory(observerAuth, 'write')).toBe(false);
    });
  });

  describe('Audit logging', () => {
    it('logs memory access', async () => {
      await auditLogger.log({
        actor: 'manager-001',
        action: 'read',
        resource: 'worker-001:memory:task-result',
        resourceType: 'working_memory',
        target: 'worker-001',
        result: 'success',
      });

      const entries = await auditLogger.getAgentActivity('manager-001');
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('read');
      expect(entries[0].target).toBe('worker-001');
    });

    it('logs permission denied attempts', async () => {
      // Log a denied access attempt
      await auditLogger.log({
        actor: 'worker-002',
        action: 'read',
        resource: 'worker-001:memory:secret',
        resourceType: 'working_memory',
        target: 'worker-001',
        result: 'denied',
        reason: 'Permission level worker cannot access other agents memories',
      });

      const entries = await auditLogger.getAgentActivity('worker-002');
      const deniedEntry = entries.find(e => e.result === 'denied');
      expect(deniedEntry).toBeDefined();
      expect(deniedEntry?.reason).toContain('cannot access');
    });
  });

  describe('Event-driven sync', () => {
    it('creates and processes sync events', async () => {
      const syncManager1 = new EventDrivenSyncManager({
        nodeId: 'worker-001',
        batchInterval: 100,
        maxBatchSize: 100,
        maxRetries: 3,
        conflictStrategy: 'merge_learnings',
      });

      // Emit event from worker 1
      const event = syncManager1.emitEvent('create', {
        type: 'working',
        key: 'sync-test',
        value: { data: 'from-worker-001' },
        timestamp: Date.now(),
      }, 'shared', 'normal');

      expect(event.id).toBeDefined();
      expect(event.source).toBe('worker-001');
      expect(event.type).toBe('create');
    });

    it('receives and processes batches', async () => {
      const syncManager2 = new EventDrivenSyncManager({
        nodeId: 'worker-002',
        batchInterval: 100,
        maxBatchSize: 100,
        maxRetries: 3,
        conflictStrategy: 'merge_learnings',
      });

      const event = {
        id: 'evt-1',
        type: 'create' as const,
        source: 'worker-001',
        target: 'shared' as const,
        data: {
          type: 'working' as const,
          key: 'sync-test',
          value: { data: 'from-worker-001' },
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
        priority: 'normal' as const,
        vectorClock: new VectorClock(),
      };

      const batch = {
        sourceId: 'worker-001',
        events: [event],
        vectorClock: new VectorClock(),
        timestamp: Date.now(),
      };

      const result = await syncManager2.receiveBatch(batch);
      expect(result.processed).toBe(1);
      expect(result.conflicts).toHaveLength(0);
    });
  });

  describe('Permission validation', () => {
    it('validates manager permissions correctly', () => {
      const result = permissionValidator.checkPermission({
        actor: managerAuth.clientId,
        permissionLevel: managerAuth.permissionLevel,
        scopes: managerAuth.scopes,
        resource: 'agent_memory',
        resourceOwner: 'worker-001',
        action: 'read',
        team: managerAuth.team,
      });

      expect(result.allowed).toBe(true);
    });

    it('denies worker cross-agent access', () => {
      const result = permissionValidator.checkPermission({
        actor: worker1Auth.clientId,
        permissionLevel: worker1Auth.permissionLevel,
        scopes: worker1Auth.scopes,
        resource: 'agent_memory',
        resourceOwner: 'worker-002',
        action: 'read',
        team: worker1Auth.team,
      });

      expect(result.allowed).toBe(false);
    });

    it('allows worker shared pool access', () => {
      const result = permissionValidator.checkPermission({
        actor: worker1Auth.clientId,
        permissionLevel: worker1Auth.permissionLevel,
        scopes: worker1Auth.scopes,
        resource: 'shared_memory',
        action: 'write',
      });

      expect(result.allowed).toBe(true);
    });

    it('denies observer write access', () => {
      const result = permissionValidator.checkPermission({
        actor: observerAuth.clientId,
        permissionLevel: observerAuth.permissionLevel,
        scopes: observerAuth.scopes,
        resource: 'shared_memory',
        action: 'write',
      });

      expect(result.allowed).toBe(false);
    });
  });

  describe('CRDT conflict resolution', () => {
    it('merges arrays using union', () => {
      const localObservations = ['obs-1', 'obs-2'];
      const remoteObservations = ['obs-2', 'obs-3'];

      const result = CRDTMerge.mergeStringArrays(localObservations, remoteObservations);

      // Both observations should be present (union)
      expect(result).toContain('obs-1');
      expect(result).toContain('obs-2');
      expect(result).toContain('obs-3');
    });

    it('merges learnings using union', () => {
      const localLearnings = ['learn-1'];
      const remoteLearnings = ['learn-2'];

      const result = CRDTMerge.mergeStringArrays(localLearnings, remoteLearnings);

      expect(result).toContain('learn-1');
      expect(result).toContain('learn-2');
    });

    it('lww scalar uses vector clock comparison', () => {
      const clock1 = new VectorClock();
      clock1.increment('worker-001');

      const clock2 = new VectorClock();
      clock2.increment('worker-001');
      clock2.increment('worker-001');

      const result = CRDTMerge.lwwScalar('old', 'new', clock1, clock2);
      expect(result.value).toBe('new');
    });

    it('vector clocks detect concurrent updates', () => {
      const clock1 = new VectorClock();
      clock1.increment('worker-001');

      const clock2 = new VectorClock();
      clock2.increment('worker-002');

      // Neither clock dominates the other
      expect(clock1.compare(clock2)).toBe('concurrent');
    });

    it('vector clocks detect causal ordering', () => {
      const clock1 = new VectorClock();
      clock1.increment('worker-001');

      const clock2 = clock1.clone();
      clock2.increment('worker-002');

      // clock1 happened before clock2
      expect(clock1.compare(clock2)).toBe('before');
      expect(clock2.compare(clock1)).toBe('after');
    });
  });
});
