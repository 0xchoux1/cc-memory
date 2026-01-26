/**
 * API Key authentication middleware for HTTP MCP Server
 * Version 2.0 - Multi-agent permission model with backward compatibility
 */

import type { RequestHandler, Response, NextFunction } from 'express';
import type {
  AuthenticatedRequest,
  ApiKeyConfig,
  ApiKeyInfoV2,
  ApiKeysFile,
  ApiKeysFileV2,
  TeamConfig,
  PermissionLevel,
} from './types.js';
import { isApiKeysFileV2, DEFAULT_SCOPES } from './types.js';
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';

/**
 * Hash an API key for secure comparison
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Normalize a stored key (handle sha256: prefix)
 */
function normalizeStoredKey(key: string): string {
  if (key.startsWith('sha256:')) {
    return key.slice('sha256:'.length).toLowerCase();
  }
  return hashApiKey(key);
}

/**
 * Migrate v1.0 API key to v2.0 format
 */
function migrateV1ToV2(key: string, info: {
  clientId: string;
  scopes?: string[];
  expiresAt?: number;
}): ApiKeyInfoV2 {
  return {
    clientId: info.clientId,
    permissionLevel: 'worker' as PermissionLevel,
    scopes: info.scopes ?? ['memory:read', 'memory:write'],
    team: null,
    createdAt: Date.now(),
    expiresAt: info.expiresAt,
  };
}

/**
 * Load API keys from a JSON file (supports both v1.0 and v2.0 formats)
 */
export function loadApiKeysFromFile(filePath: string): ApiKeyConfig {
  const keys = new Map<string, ApiKeyInfoV2>();
  const teams = new Map<string, TeamConfig>();

  if (!existsSync(filePath)) {
    console.warn(`[Auth] API keys file not found: ${filePath}`);
    return { keys, teams };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as ApiKeysFile;

    if (isApiKeysFileV2(data)) {
      // Load v2.0 format
      console.log(`[Auth] Loading API keys v2.0 format from ${filePath}`);

      // Load teams
      for (const [teamId, teamConfig] of Object.entries(data.teams)) {
        teams.set(teamId, teamConfig);
      }

      // Load keys
      for (const [key, info] of Object.entries(data.keys)) {
        const normalizedKey = normalizeStoredKey(key);
        keys.set(normalizedKey, {
          ...info,
          createdAt: info.createdAt ?? Date.now(),
        });
      }

      console.log(`[Auth] Loaded ${keys.size} API key(s) and ${teams.size} team(s)`);
    } else {
      // Load v1.0 format with migration
      console.log(`[Auth] Loading API keys v1.0 format from ${filePath} (migrating to v2.0)`);

      for (const [key, info] of Object.entries(data)) {
        if (typeof info === 'object' && info !== null && 'clientId' in info) {
          const normalizedKey = normalizeStoredKey(key);
          keys.set(normalizedKey, migrateV1ToV2(key, info as {
            clientId: string;
            scopes?: string[];
            expiresAt?: number;
          }));
        }
      }

      console.log(`[Auth] Migrated ${keys.size} API key(s) to v2.0 format`);
    }
  } catch (error) {
    console.error(`[Auth] Error loading API keys from ${filePath}:`, error);
  }

  return { keys, teams };
}

/**
 * Save API keys to file in v2.0 format
 */
export function saveApiKeysToFile(filePath: string, config: ApiKeyConfig): void {
  const data: ApiKeysFileV2 = {
    version: '2.0',
    teams: Object.fromEntries(config.teams),
    keys: Object.fromEntries(
      Array.from(config.keys.entries()).map(([hash, info]) => [`sha256:${hash}`, info])
    ),
  };

  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Create API key authentication middleware
 */
export function createApiKeyAuth(config: ApiKeyConfig): RequestHandler {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Authorization header required',
      });
      return;
    }

    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid authorization format. Use: Bearer <api_key>',
      });
      return;
    }

    const apiKey = authHeader.slice(7);
    const hashedKey = hashApiKey(apiKey);
    const keyInfo = config.keys.get(hashedKey);

    if (!keyInfo) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid API key',
      });
      return;
    }

    // Check expiration
    if (keyInfo.expiresAt && keyInfo.expiresAt < Date.now()) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'API key has expired',
      });
      return;
    }

    // Get team config if applicable
    let teamConfig: TeamConfig | undefined;
    if (keyInfo.team) {
      teamConfig = config.teams.get(keyInfo.team);
    }

    // Attach auth info to request
    req.auth = {
      token: apiKey,
      clientId: keyInfo.clientId,
      scopes: keyInfo.scopes,
      permissionLevel: keyInfo.permissionLevel,
      team: keyInfo.team ?? undefined,
      teamConfig,
      managedAgents: keyInfo.managedAgents,
      managerId: keyInfo.managerId,
    };

    next();
  };
}

/**
 * Create a middleware that allows unauthenticated access (for development)
 */
export function createNoAuth(defaultClientId: string = 'anonymous'): RequestHandler {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    req.auth = {
      token: 'anonymous',
      clientId: defaultClientId,
      scopes: ['memory:read', 'memory:write'],
      permissionLevel: 'worker',
    };
    next();
  };
}

/**
 * Require specific scopes for an endpoint
 */
export function requireScopes(...requiredScopes: string[]): RequestHandler {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    // Check for wildcard scope
    if (req.auth.scopes.includes('memory:*')) {
      next();
      return;
    }

    const missingScopes = requiredScopes.filter(s => !req.auth!.scopes.includes(s));
    if (missingScopes.length > 0) {
      res.status(403).json({
        error: 'forbidden',
        message: `Missing required scopes: ${missingScopes.join(', ')}`,
      });
      return;
    }

    next();
  };
}

/**
 * Require specific permission level
 */
export function requirePermissionLevel(...levels: PermissionLevel[]): RequestHandler {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    if (!levels.includes(req.auth.permissionLevel)) {
      res.status(403).json({
        error: 'forbidden',
        message: `Required permission level: ${levels.join(' or ')}`,
      });
      return;
    }

    next();
  };
}

/**
 * Generate a new API key
 */
export function generateApiKey(): string {
  const randomPart = createHash('sha256')
    .update(Math.random().toString() + Date.now().toString())
    .digest('hex')
    .slice(0, 32);
  return `ccm_${randomPart}`;
}

/**
 * Create a new API key entry for a manager
 */
export function createManagerKey(
  clientId: string,
  team: string,
  managedAgents: string[] = [],
  expiresAt?: number
): { rawKey: string; keyInfo: ApiKeyInfoV2 } {
  const rawKey = generateApiKey();
  const keyInfo: ApiKeyInfoV2 = {
    clientId,
    permissionLevel: 'manager',
    scopes: ['memory:*'],
    team,
    managedAgents,
    createdAt: Date.now(),
    expiresAt,
  };
  return { rawKey, keyInfo };
}

/**
 * Create a new API key entry for a worker
 */
export function createWorkerKey(
  clientId: string,
  team: string,
  managerId: string,
  expiresAt?: number
): { rawKey: string; keyInfo: ApiKeyInfoV2 } {
  const rawKey = generateApiKey();
  const keyInfo: ApiKeyInfoV2 = {
    clientId,
    permissionLevel: 'worker',
    scopes: DEFAULT_SCOPES.worker,
    team,
    managerId,
    createdAt: Date.now(),
    expiresAt,
  };
  return { rawKey, keyInfo };
}

/**
 * Create a new API key entry for an observer
 */
export function createObserverKey(
  clientId: string,
  team: string,
  managerId: string,
  expiresAt?: number
): { rawKey: string; keyInfo: ApiKeyInfoV2 } {
  const rawKey = generateApiKey();
  const keyInfo: ApiKeyInfoV2 = {
    clientId,
    permissionLevel: 'observer',
    scopes: DEFAULT_SCOPES.observer,
    team,
    managerId,
    createdAt: Date.now(),
    expiresAt,
  };
  return { rawKey, keyInfo };
}

/**
 * Create a new team configuration
 */
export function createTeamConfig(
  managerId: string,
  options?: Partial<TeamConfig>
): TeamConfig {
  return {
    managerId,
    sharedPoolId: `shared-pool-${Date.now().toString(36)}`,
    syncPolicy: {
      mode: 'event-driven',
      batchInterval: 5000,
      conflictResolution: 'merge_learnings',
    },
    createdAt: Date.now(),
    ...options,
  };
}

/**
 * Add a new API key to the configuration
 */
export function addApiKey(config: ApiKeyConfig, rawKey: string, keyInfo: ApiKeyInfoV2): void {
  const hashedKey = hashApiKey(rawKey);
  config.keys.set(hashedKey, keyInfo);
}

/**
 * Remove an API key from the configuration
 */
export function removeApiKey(config: ApiKeyConfig, clientId: string): boolean {
  for (const [hash, info] of config.keys.entries()) {
    if (info.clientId === clientId) {
      config.keys.delete(hash);
      return true;
    }
  }
  return false;
}

/**
 * Get API key info by client ID
 */
export function getApiKeyByClientId(config: ApiKeyConfig, clientId: string): ApiKeyInfoV2 | undefined {
  for (const info of config.keys.values()) {
    if (info.clientId === clientId) {
      return info;
    }
  }
  return undefined;
}

/**
 * List all agents in a team
 */
export function listTeamAgents(config: ApiKeyConfig, teamId: string): ApiKeyInfoV2[] {
  const agents: ApiKeyInfoV2[] = [];
  for (const info of config.keys.values()) {
    if (info.team === teamId) {
      agents.push(info);
    }
  }
  return agents;
}
