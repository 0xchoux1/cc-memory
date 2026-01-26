/**
 * PermissionValidator unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PermissionValidator,
  permissionValidator as globalPermissionValidator,
  canAccessAgentMemory,
  canWriteAgentMemory,
  canAccessSharedMemory,
} from '../../src/server/http/auth/permissionValidator.js';
import type { AuthInfo } from '../../src/server/http/auth/types.js';

describe('PermissionValidator', () => {
  let validator: PermissionValidator;

  const managerAuth: AuthInfo = {
    clientId: 'manager-001',
    permissionLevel: 'manager',
    scopes: ['memory:read', 'memory:write', 'memory:share:read', 'memory:share:write', 'memory:team:read', 'memory:team:write', 'memory:manage'],
    team: 'team-alpha',
    managedAgents: ['worker-001', 'worker-002'],
  };

  const workerAuth: AuthInfo = {
    clientId: 'worker-001',
    permissionLevel: 'worker',
    scopes: ['memory:read', 'memory:write', 'memory:share:read', 'memory:share:write'],
    team: 'team-alpha',
    managerId: 'manager-001',
  };

  const observerAuth: AuthInfo = {
    clientId: 'observer-001',
    permissionLevel: 'observer',
    scopes: ['memory:read', 'memory:share:read'],
    team: 'team-alpha',
    managerId: 'manager-001',
  };

  const externalAuth: AuthInfo = {
    clientId: 'external-001',
    permissionLevel: 'worker',
    scopes: ['memory:read', 'memory:write'],
    team: 'team-beta',
  };

  beforeEach(() => {
    validator = new PermissionValidator();
    validator.registerManagedAgents('manager-001', ['worker-001', 'worker-002', 'observer-001']);
    // Also register on global validator for helper functions
    globalPermissionValidator.registerManagedAgents('manager-001', ['worker-001', 'worker-002', 'observer-001']);
  });

  describe('basic permission checks', () => {
    it('manager can read own memory', () => {
      const result = validator.checkPermission({
        actor: managerAuth.clientId,
        permissionLevel: managerAuth.permissionLevel,
        scopes: managerAuth.scopes,
        resource: 'working_memory',
        action: 'read',
      });
      expect(result.allowed).toBe(true);
    });

    it('worker can write own memory', () => {
      const result = validator.checkPermission({
        actor: workerAuth.clientId,
        permissionLevel: workerAuth.permissionLevel,
        scopes: workerAuth.scopes,
        resource: 'working_memory',
        action: 'write',
      });
      expect(result.allowed).toBe(true);
    });

    it('observer can read but not write own memory', () => {
      const readResult = validator.checkPermission({
        actor: observerAuth.clientId,
        permissionLevel: observerAuth.permissionLevel,
        scopes: observerAuth.scopes,
        resource: 'working_memory',
        action: 'read',
      });
      expect(readResult.allowed).toBe(true);

      const writeResult = validator.checkPermission({
        actor: observerAuth.clientId,
        permissionLevel: observerAuth.permissionLevel,
        scopes: observerAuth.scopes,
        resource: 'working_memory',
        action: 'write',
      });
      expect(writeResult.allowed).toBe(false);
    });
  });

  describe('shared pool access', () => {
    it('manager can read and write shared pool', () => {
      const readResult = validator.checkPermission({
        actor: managerAuth.clientId,
        permissionLevel: managerAuth.permissionLevel,
        scopes: managerAuth.scopes,
        resource: 'shared_memory',
        action: 'read',
      });
      expect(readResult.allowed).toBe(true);

      const writeResult = validator.checkPermission({
        actor: managerAuth.clientId,
        permissionLevel: managerAuth.permissionLevel,
        scopes: managerAuth.scopes,
        resource: 'shared_memory',
        action: 'write',
      });
      expect(writeResult.allowed).toBe(true);
    });

    it('worker can read and write shared pool', () => {
      const readResult = validator.checkPermission({
        actor: workerAuth.clientId,
        permissionLevel: workerAuth.permissionLevel,
        scopes: workerAuth.scopes,
        resource: 'shared_memory',
        action: 'read',
      });
      expect(readResult.allowed).toBe(true);

      const writeResult = validator.checkPermission({
        actor: workerAuth.clientId,
        permissionLevel: workerAuth.permissionLevel,
        scopes: workerAuth.scopes,
        resource: 'shared_memory',
        action: 'write',
      });
      expect(writeResult.allowed).toBe(true);
    });

    it('observer can only read shared pool', () => {
      const readResult = validator.checkPermission({
        actor: observerAuth.clientId,
        permissionLevel: observerAuth.permissionLevel,
        scopes: observerAuth.scopes,
        resource: 'shared_memory',
        action: 'read',
      });
      expect(readResult.allowed).toBe(true);

      const writeResult = validator.checkPermission({
        actor: observerAuth.clientId,
        permissionLevel: observerAuth.permissionLevel,
        scopes: observerAuth.scopes,
        resource: 'shared_memory',
        action: 'write',
      });
      expect(writeResult.allowed).toBe(false);
    });
  });

  describe('cross-agent access', () => {
    it('manager can read worker memory', () => {
      const result = validator.checkPermission({
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

    it('manager can write to worker memory', () => {
      const result = validator.checkPermission({
        actor: managerAuth.clientId,
        permissionLevel: managerAuth.permissionLevel,
        scopes: managerAuth.scopes,
        resource: 'agent_memory',
        resourceOwner: 'worker-001',
        action: 'write',
        team: managerAuth.team,
      });
      expect(result.allowed).toBe(true);
    });

    it('worker cannot read other worker memory', () => {
      const result = validator.checkPermission({
        actor: workerAuth.clientId,
        permissionLevel: workerAuth.permissionLevel,
        scopes: workerAuth.scopes,
        resource: 'agent_memory',
        resourceOwner: 'worker-002',
        action: 'read',
        team: workerAuth.team,
      });
      expect(result.allowed).toBe(false);
    });

    it('observer cannot access worker memory', () => {
      const result = validator.checkPermission({
        actor: observerAuth.clientId,
        permissionLevel: observerAuth.permissionLevel,
        scopes: observerAuth.scopes,
        resource: 'agent_memory',
        resourceOwner: 'worker-001',
        action: 'read',
        team: observerAuth.team,
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe('team boundaries', () => {
    it('manager cannot access external team agent', () => {
      const result = validator.checkPermission({
        actor: managerAuth.clientId,
        permissionLevel: managerAuth.permissionLevel,
        scopes: managerAuth.scopes,
        resource: 'agent_memory',
        resourceOwner: 'external-001',
        action: 'read',
        team: managerAuth.team,
      });
      // external-001 is not in managedAgents, so should be denied
      expect(result.allowed).toBe(false);
    });
  });

  describe('management permissions', () => {
    it('manager can manage permissions', () => {
      const result = validator.checkPermission({
        actor: managerAuth.clientId,
        permissionLevel: managerAuth.permissionLevel,
        scopes: managerAuth.scopes,
        resource: 'permission',
        action: 'write',
      });
      expect(result.allowed).toBe(true);
    });

    it('worker cannot manage permissions', () => {
      const result = validator.checkPermission({
        actor: workerAuth.clientId,
        permissionLevel: workerAuth.permissionLevel,
        scopes: workerAuth.scopes,
        resource: 'permission',
        action: 'write',
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe('managed agents registration', () => {
    it('correctly tracks managed agents', () => {
      expect(validator.isManagedAgent('manager-001', 'worker-001')).toBe(true);
      expect(validator.isManagedAgent('manager-001', 'worker-002')).toBe(true);
      expect(validator.isManagedAgent('manager-001', 'observer-001')).toBe(true);
      expect(validator.isManagedAgent('manager-001', 'external-001')).toBe(false);
    });

    it('can add new managed agents', () => {
      validator.addManagedAgent('manager-001', 'new-worker');
      expect(validator.isManagedAgent('manager-001', 'new-worker')).toBe(true);
    });
  });

  describe('helper functions', () => {
    it('canAccessAgentMemory checks correctly', () => {
      // Manager can access managed agent
      expect(canAccessAgentMemory(managerAuth, 'worker-001')).toBe(true);
      // Worker cannot access other worker
      expect(canAccessAgentMemory(workerAuth, 'worker-002')).toBe(false);
      // Observer cannot access worker
      expect(canAccessAgentMemory(observerAuth, 'worker-001')).toBe(false);
      // Self access is always allowed
      expect(canAccessAgentMemory(workerAuth, 'worker-001')).toBe(true);
    });

    it('canWriteAgentMemory checks correctly', () => {
      // Manager can write to managed agent
      expect(canWriteAgentMemory(managerAuth, 'worker-001')).toBe(true);
      // Worker cannot write to other worker
      expect(canWriteAgentMemory(workerAuth, 'worker-002')).toBe(false);
      // Self write is allowed
      expect(canWriteAgentMemory(workerAuth, 'worker-001')).toBe(true);
    });

    it('canAccessSharedMemory checks correctly', () => {
      expect(canAccessSharedMemory(managerAuth, 'read')).toBe(true);
      expect(canAccessSharedMemory(managerAuth, 'write')).toBe(true);
      expect(canAccessSharedMemory(workerAuth, 'read')).toBe(true);
      expect(canAccessSharedMemory(workerAuth, 'write')).toBe(true);
      expect(canAccessSharedMemory(observerAuth, 'read')).toBe(true);
      expect(canAccessSharedMemory(observerAuth, 'write')).toBe(false);
    });
  });
});
