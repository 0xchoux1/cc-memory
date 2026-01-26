/**
 * Permission Validator for multi-agent memory access control
 * Implements hierarchical permission model with team-based access
 */

import type { RequestHandler, Response, NextFunction } from 'express';
import type {
  AuthenticatedRequest,
  AuthInfo,
  PermissionLevel,
  PermissionCheckRequest,
  PermissionCheckResult,
  ResourceType,
  ActionType,
  TeamConfig,
} from './types.js';
import { hasScope } from './types.js';

/**
 * Permission matrix defining required scopes for resource/action combinations
 */
const PERMISSION_MATRIX: Record<ResourceType, Record<ActionType, string>> = {
  working_memory: {
    read: 'memory:read',
    write: 'memory:write',
    delete: 'memory:write',
    manage: 'memory:manage',
  },
  episodic_memory: {
    read: 'memory:read',
    write: 'memory:write',
    delete: 'memory:write',
    manage: 'memory:manage',
  },
  semantic_memory: {
    read: 'memory:read',
    write: 'memory:write',
    delete: 'memory:write',
    manage: 'memory:manage',
  },
  shared_memory: {
    read: 'memory:share:read',
    write: 'memory:share:write',
    delete: 'memory:share:write',
    manage: 'memory:manage',
  },
  agent_memory: {
    read: 'memory:team:read',
    write: 'memory:team:write',
    delete: 'memory:team:write',
    manage: 'memory:manage',
  },
  team: {
    read: 'memory:read',
    write: 'memory:manage',
    delete: 'memory:manage',
    manage: 'memory:manage',
  },
  permission: {
    read: 'memory:manage',
    write: 'memory:manage',
    delete: 'memory:manage',
    manage: 'memory:manage',
  },
  audit_log: {
    read: 'memory:manage',
    write: 'memory:manage',
    delete: 'memory:manage',
    manage: 'memory:manage',
  },
};

/**
 * PermissionValidator class for checking and enforcing access control
 */
export class PermissionValidator {
  private managedAgentsCache: Map<string, Set<string>> = new Map();
  private teamMembersCache: Map<string, Set<string>> = new Map();

  /**
   * Check if an action is permitted
   */
  checkPermission(request: PermissionCheckRequest): PermissionCheckResult {
    const { actor, permissionLevel, scopes, resource, resourceOwner, action, team } = request;

    // 1. Check if the required scope is present
    const requiredScope = PERMISSION_MATRIX[resource]?.[action];
    if (!requiredScope) {
      return {
        allowed: false,
        reason: `Unknown resource/action combination: ${resource}/${action}`,
      };
    }

    // Check for wildcard scope first
    if (hasScope(scopes, 'memory:*')) {
      return { allowed: true };
    }

    if (!hasScope(scopes, requiredScope)) {
      return {
        allowed: false,
        reason: `Missing required scope: ${requiredScope}`,
        requiredScope,
      };
    }

    // 2. For own resources, allow if scope is present
    if (!resourceOwner || resourceOwner === actor) {
      return { allowed: true };
    }

    // 3. For shared resources, check share scopes
    if (resource === 'shared_memory') {
      const shareScope = action === 'read' ? 'memory:share:read' : 'memory:share:write';
      if (hasScope(scopes, shareScope)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Missing scope for shared memory access: ${shareScope}`,
        requiredScope: shareScope,
      };
    }

    // 4. For cross-agent access, check permission level and team membership
    if (resource === 'agent_memory') {
      return this.checkCrossAgentAccess(actor, permissionLevel, scopes, resourceOwner, action, team);
    }

    // 5. Default deny for unknown scenarios
    return {
      allowed: false,
      reason: 'Access denied by default policy',
    };
  }

  /**
   * Check cross-agent memory access
   */
  private checkCrossAgentAccess(
    actor: string,
    permissionLevel: PermissionLevel,
    scopes: string[],
    targetAgent: string,
    action: ActionType,
    team?: string
  ): PermissionCheckResult {
    // Managers can access all team members' memories
    if (permissionLevel === 'manager') {
      const teamScope = action === 'read' ? 'memory:team:read' : 'memory:team:write';
      if (hasScope(scopes, teamScope)) {
        // Check if target is a managed agent
        if (this.isManagedAgent(actor, targetAgent)) {
          return { allowed: true };
        }
        return {
          allowed: false,
          reason: `Agent ${targetAgent} is not managed by ${actor}`,
        };
      }
    }

    // Workers and observers cannot access other agents' private memories
    return {
      allowed: false,
      reason: `Permission level '${permissionLevel}' cannot access other agents' memories`,
      requiredScope: 'memory:team:read',
    };
  }

  /**
   * Register managed agents for a manager
   */
  registerManagedAgents(managerId: string, agentIds: string[]): void {
    this.managedAgentsCache.set(managerId, new Set(agentIds));
  }

  /**
   * Add a managed agent to a manager
   */
  addManagedAgent(managerId: string, agentId: string): void {
    const managed = this.managedAgentsCache.get(managerId) ?? new Set();
    managed.add(agentId);
    this.managedAgentsCache.set(managerId, managed);
  }

  /**
   * Remove a managed agent from a manager
   */
  removeManagedAgent(managerId: string, agentId: string): void {
    const managed = this.managedAgentsCache.get(managerId);
    if (managed) {
      managed.delete(agentId);
    }
  }

  /**
   * Check if an agent is managed by a manager
   */
  isManagedAgent(managerId: string, agentId: string): boolean {
    const managed = this.managedAgentsCache.get(managerId);
    return managed?.has(agentId) ?? false;
  }

  /**
   * Register team members
   */
  registerTeamMembers(teamId: string, memberIds: string[]): void {
    this.teamMembersCache.set(teamId, new Set(memberIds));
  }

  /**
   * Check if an agent is a member of a team
   */
  isTeamMember(teamId: string, agentId: string): boolean {
    const members = this.teamMembersCache.get(teamId);
    return members?.has(agentId) ?? false;
  }

  /**
   * Get all members of a team
   */
  getTeamMembers(teamId: string): string[] {
    const members = this.teamMembersCache.get(teamId);
    return members ? Array.from(members) : [];
  }

  /**
   * Clear caches
   */
  clearCaches(): void {
    this.managedAgentsCache.clear();
    this.teamMembersCache.clear();
  }
}

/**
 * Global permission validator instance
 */
export const permissionValidator = new PermissionValidator();

/**
 * Middleware to require specific permission for an endpoint
 */
export function requirePermission(
  resource: ResourceType,
  action: ActionType,
  getResourceOwner?: (req: AuthenticatedRequest) => string | undefined
): RequestHandler {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    const resourceOwner = getResourceOwner?.(req);

    const result = permissionValidator.checkPermission({
      actor: req.auth.clientId,
      permissionLevel: req.auth.permissionLevel,
      scopes: req.auth.scopes,
      resource,
      resourceOwner,
      action,
      team: req.auth.team,
    });

    if (!result.allowed) {
      res.status(403).json({
        error: 'forbidden',
        message: result.reason,
        requiredScope: result.requiredScope,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware to require manager permission level
 */
export function requireManager(): RequestHandler {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    if (req.auth.permissionLevel !== 'manager') {
      res.status(403).json({
        error: 'forbidden',
        message: 'Manager permission level required',
      });
      return;
    }

    next();
  };
}

/**
 * Middleware to require team membership
 */
export function requireTeamMembership(getTeamId: (req: AuthenticatedRequest) => string): RequestHandler {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    const teamId = getTeamId(req);

    // Check if user is in the team
    if (req.auth.team !== teamId && !permissionValidator.isTeamMember(teamId, req.auth.clientId)) {
      res.status(403).json({
        error: 'forbidden',
        message: `Not a member of team: ${teamId}`,
      });
      return;
    }

    next();
  };
}

/**
 * Check if the authenticated user can access a specific agent's memory
 */
export function canAccessAgentMemory(auth: AuthInfo, targetAgentId: string): boolean {
  // Can always access own memory
  if (auth.clientId === targetAgentId) {
    return true;
  }

  // Managers can access managed agents' memory
  if (auth.permissionLevel === 'manager') {
    if (hasScope(auth.scopes, 'memory:team:read') || hasScope(auth.scopes, 'memory:*')) {
      return permissionValidator.isManagedAgent(auth.clientId, targetAgentId);
    }
  }

  return false;
}

/**
 * Check if the authenticated user can write to a specific agent's memory
 */
export function canWriteAgentMemory(auth: AuthInfo, targetAgentId: string): boolean {
  // Can always write to own memory
  if (auth.clientId === targetAgentId) {
    return hasScope(auth.scopes, 'memory:write') || hasScope(auth.scopes, 'memory:*');
  }

  // Managers can write to managed agents' memory
  if (auth.permissionLevel === 'manager') {
    if (hasScope(auth.scopes, 'memory:team:write') || hasScope(auth.scopes, 'memory:*')) {
      return permissionValidator.isManagedAgent(auth.clientId, targetAgentId);
    }
  }

  return false;
}

/**
 * Check if the authenticated user can access the shared memory pool
 */
export function canAccessSharedMemory(auth: AuthInfo, action: 'read' | 'write'): boolean {
  if (hasScope(auth.scopes, 'memory:*')) {
    return true;
  }

  const requiredScope = action === 'read' ? 'memory:share:read' : 'memory:share:write';
  return hasScope(auth.scopes, requiredScope);
}

/**
 * Check if the authenticated user can manage permissions
 */
export function canManagePermissions(auth: AuthInfo): boolean {
  return auth.permissionLevel === 'manager' &&
    (hasScope(auth.scopes, 'memory:manage') || hasScope(auth.scopes, 'memory:*'));
}

/**
 * Get the effective visibility for a shared memory item based on auth
 */
export function getEffectiveVisibility(auth: AuthInfo, requestedVisibility?: string[]): string[] {
  // Managers can set arbitrary visibility
  if (auth.permissionLevel === 'manager') {
    return requestedVisibility ?? ['*'];
  }

  // Workers can only set visibility to their team or themselves
  if (auth.permissionLevel === 'worker') {
    if (!requestedVisibility || requestedVisibility.includes('*')) {
      // Default to team-wide visibility for workers
      return auth.team ? [`team:${auth.team}`] : [auth.clientId];
    }
    // Filter visibility to only include valid targets
    return requestedVisibility.filter(v =>
      v === auth.clientId ||
      v === `team:${auth.team}` ||
      v.startsWith('team:') && auth.team === v.slice(5)
    );
  }

  // Observers cannot write, but if they somehow get here, restrict to self
  return [auth.clientId];
}
