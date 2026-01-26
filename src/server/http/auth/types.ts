/**
 * Authentication types for HTTP MCP Server
 * Version 2.0 - Multi-agent permission model
 */

import type { Request } from 'express';

// ============================================================================
// Permission Levels
// ============================================================================

/**
 * Permission levels for multi-agent access control
 */
export type PermissionLevel = 'manager' | 'worker' | 'observer';

/**
 * Available scopes for memory access
 */
export type MemoryScope =
  | 'memory:read'         // Read own memories
  | 'memory:write'        // Write own memories
  | 'memory:share:read'   // Read shared pool
  | 'memory:share:write'  // Write to shared pool
  | 'memory:team:read'    // Read team members' memories (manager only)
  | 'memory:team:write'   // Write to team members' memories (manager only)
  | 'memory:manage'       // Manage permissions and teams (manager only)
  | 'memory:*';           // All permissions

/**
 * Default scopes by permission level
 */
export const DEFAULT_SCOPES: Record<PermissionLevel, MemoryScope[]> = {
  manager: [
    'memory:read',
    'memory:write',
    'memory:share:read',
    'memory:share:write',
    'memory:team:read',
    'memory:team:write',
    'memory:manage',
  ],
  worker: [
    'memory:read',
    'memory:write',
    'memory:share:read',
    'memory:share:write',
  ],
  observer: [
    'memory:read',
    'memory:share:read',
  ],
};

// ============================================================================
// Team Configuration
// ============================================================================

/**
 * Sync policy configuration for teams
 */
export interface SyncPolicy {
  /** Sync mode: event-driven (real-time) or polling */
  mode: 'event-driven' | 'polling';
  /** Batch interval in milliseconds for batched updates */
  batchInterval: number;
  /** Default conflict resolution strategy */
  conflictResolution: 'newer_wins' | 'higher_importance' | 'higher_confidence' | 'merge_observations' | 'merge_learnings' | 'manual';
}

/**
 * Team configuration
 */
export interface TeamConfig {
  /** ID of the manager agent for this team */
  managerId: string;
  /** ID of the shared memory pool */
  sharedPoolId: string;
  /** Sync policy settings */
  syncPolicy: SyncPolicy;
  /** Team creation timestamp */
  createdAt?: number;
  /** Optional team description */
  description?: string;
}

// ============================================================================
// API Key Configuration (v2.0)
// ============================================================================

/**
 * Extended API key info for v2.0 schema
 */
export interface ApiKeyInfoV2 {
  /** Unique client identifier */
  clientId: string;
  /** Permission level */
  permissionLevel: PermissionLevel;
  /** Granted scopes */
  scopes: string[];
  /** Team this agent belongs to (null for individual mode) */
  team: string | null;
  /** For managers: list of managed agent IDs */
  managedAgents?: string[];
  /** For workers/observers: manager agent ID */
  managerId?: string;
  /** Creation timestamp */
  createdAt?: number;
  /** Expiration timestamp */
  expiresAt?: number;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Legacy API key info (v1.0 compatibility)
 */
export interface ApiKeyInfo {
  clientId: string;
  scopes: string[];
  createdAt?: number;
  expiresAt?: number;
}

/**
 * API keys configuration file schema (v2.0)
 */
export interface ApiKeysFileV2 {
  version: '2.0';
  teams: Record<string, TeamConfig>;
  keys: Record<string, ApiKeyInfoV2>;
}

/**
 * Legacy API keys configuration file schema (v1.0)
 */
export interface ApiKeysFileV1 {
  [key: string]: {
    clientId: string;
    scopes?: string[];
    expiresAt?: number;
  };
}

/**
 * Combined API keys file type
 */
export type ApiKeysFile = ApiKeysFileV1 | ApiKeysFileV2;

/**
 * API key configuration for middleware
 */
export interface ApiKeyConfig {
  /** Map of hashed API keys to their configuration */
  keys: Map<string, ApiKeyInfoV2>;
  /** Map of team configurations */
  teams: Map<string, TeamConfig>;
}

// ============================================================================
// Authentication Info
// ============================================================================

/**
 * Extended auth info attached to authenticated requests
 */
export interface AuthInfo {
  /** Raw API token */
  token: string;
  /** Client identifier */
  clientId: string;
  /** Granted scopes */
  scopes: string[];
  /** Permission level */
  permissionLevel: PermissionLevel;
  /** Team ID if agent belongs to a team */
  team?: string;
  /** Team configuration if applicable */
  teamConfig?: TeamConfig;
  /** For managers: list of managed agent IDs */
  managedAgents?: string[];
  /** For workers/observers: manager ID */
  managerId?: string;
}

/**
 * Express request with authentication info
 */
export interface AuthenticatedRequest extends Request {
  auth?: AuthInfo;
}

// ============================================================================
// Permission Check Types
// ============================================================================

/**
 * Resource types that can be accessed
 */
export type ResourceType =
  | 'working_memory'
  | 'episodic_memory'
  | 'semantic_memory'
  | 'shared_memory'
  | 'agent_memory'
  | 'team'
  | 'permission'
  | 'audit_log';

/**
 * Action types that can be performed
 */
export type ActionType = 'read' | 'write' | 'delete' | 'manage';

/**
 * Permission check request
 */
export interface PermissionCheckRequest {
  /** Actor requesting the action */
  actor: string;
  /** Actor's permission level */
  permissionLevel: PermissionLevel;
  /** Actor's scopes */
  scopes: string[];
  /** Resource being accessed */
  resource: ResourceType;
  /** Resource owner (for cross-agent access) */
  resourceOwner?: string;
  /** Action being performed */
  action: ActionType;
  /** Team context */
  team?: string;
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  requiredScope?: string;
}

// ============================================================================
// Auth Mode
// ============================================================================

export type AuthMode = 'apikey' | 'none';

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if an API keys file is v2.0 format
 */
export function isApiKeysFileV2(file: ApiKeysFile): file is ApiKeysFileV2 {
  return 'version' in file && file.version === '2.0';
}

/**
 * Check if a scope string matches a pattern (supports wildcards)
 */
export function scopeMatches(scope: string, pattern: string): boolean {
  if (pattern === 'memory:*') {
    return scope.startsWith('memory:');
  }
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -1);
    return scope.startsWith(prefix);
  }
  return scope === pattern;
}

/**
 * Check if an array of scopes includes a required scope
 */
export function hasScope(scopes: string[], required: string): boolean {
  return scopes.some(scope => scopeMatches(required, scope));
}
