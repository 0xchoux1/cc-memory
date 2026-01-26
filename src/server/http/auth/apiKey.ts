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

// ============================================================================
// Invite Code Management
// ============================================================================

import type {
  InviteCode,
  CreateInviteRequest,
  RegisterRequest,
  RegisterResponse,
} from './types.js';

/** In-memory storage for invite codes (also persisted to file) */
const inviteCodes = new Map<string, InviteCode>();

/**
 * Generate a unique invite code
 */
export function generateInviteCode(): string {
  const randomPart = createHash('sha256')
    .update(Math.random().toString() + Date.now().toString() + Math.random().toString())
    .digest('hex')
    .slice(0, 24);
  return `inv_${randomPart}`;
}

/**
 * Load invite codes from file
 */
export function loadInviteCodes(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    if (data.invites && typeof data.invites === 'object') {
      for (const [code, invite] of Object.entries(data.invites)) {
        inviteCodes.set(code, invite as InviteCode);
      }
      console.log(`[Auth] Loaded ${inviteCodes.size} invite code(s)`);
    }
  } catch (error) {
    console.error(`[Auth] Error loading invite codes:`, error);
  }
}

/**
 * Save invite codes to file (merged with existing api-keys.json)
 */
export function saveInviteCodes(filePath: string): void {
  let data: Record<string, unknown> = {};

  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      data = JSON.parse(content);
    } catch {
      // Start fresh if file is corrupted
    }
  }

  data.invites = Object.fromEntries(inviteCodes);

  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Create a new invite code
 */
export function createInviteCode(
  teamId: string,
  createdBy: string,
  options: CreateInviteRequest = {},
  apiKeysFilePath?: string
): InviteCode {
  const code = generateInviteCode();
  const now = Date.now();

  const invite: InviteCode = {
    code,
    teamId,
    permissionLevel: options.level ?? 'worker',
    createdBy,
    createdAt: now,
    expiresAt: options.expiresInHours != null
      ? now + options.expiresInHours * 60 * 60 * 1000
      : null,
    maxUses: options.maxUses ?? null,
    useCount: 0,
    active: true,
    description: options.description,
    usedBy: [],
  };

  inviteCodes.set(code, invite);

  // Persist to file
  if (apiKeysFilePath) {
    saveInviteCodes(apiKeysFilePath);
  }

  return invite;
}

/**
 * List invite codes for a team (manager view)
 */
export function listInviteCodes(teamId: string, includeExpired = false): InviteCode[] {
  const result: InviteCode[] = [];
  const now = Date.now();

  for (const invite of inviteCodes.values()) {
    if (invite.teamId !== teamId) continue;

    const isExpired = invite.expiresAt != null && invite.expiresAt < now;
    const isExhausted = invite.maxUses != null && invite.useCount >= invite.maxUses;

    if (!includeExpired && (isExpired || isExhausted || !invite.active)) {
      continue;
    }

    result.push(invite);
  }

  return result;
}

/**
 * Get an invite code by its code string
 */
export function getInviteCode(code: string): InviteCode | undefined {
  return inviteCodes.get(code);
}

/**
 * Validate an invite code for use
 */
export function validateInviteCode(code: string): {
  valid: boolean;
  invite?: InviteCode;
  error?: string;
} {
  const invite = inviteCodes.get(code);

  if (!invite) {
    return { valid: false, error: 'Invalid invite code' };
  }

  if (!invite.active) {
    return { valid: false, error: 'Invite code has been revoked' };
  }

  const now = Date.now();
  if (invite.expiresAt != null && invite.expiresAt < now) {
    return { valid: false, error: 'Invite code has expired' };
  }

  if (invite.maxUses != null && invite.useCount >= invite.maxUses) {
    return { valid: false, error: 'Invite code has reached maximum uses' };
  }

  return { valid: true, invite };
}

/**
 * Use an invite code to register a new agent
 */
export function useInviteCode(
  code: string,
  request: RegisterRequest,
  config: ApiKeyConfig,
  apiKeysFilePath: string
): RegisterResponse {
  // Validate the invite
  const validation = validateInviteCode(code);
  if (!validation.valid || !validation.invite) {
    return { success: false, error: validation.error };
  }

  const invite = validation.invite;

  // Check if clientId already exists
  if (getApiKeyByClientId(config, request.clientId)) {
    return { success: false, error: 'Client ID already exists' };
  }

  // Get team config
  const teamConfig = config.teams.get(invite.teamId);
  if (!teamConfig) {
    return { success: false, error: 'Team not found' };
  }

  // Create the API key based on permission level
  let rawKey: string;
  let keyInfo: ApiKeyInfoV2;

  switch (invite.permissionLevel) {
    case 'manager': {
      const result = createManagerKey(request.clientId, invite.teamId, []);
      rawKey = result.rawKey;
      keyInfo = result.keyInfo;
      break;
    }
    case 'observer': {
      const result = createObserverKey(
        request.clientId,
        invite.teamId,
        teamConfig.managerId
      );
      rawKey = result.rawKey;
      keyInfo = result.keyInfo;
      break;
    }
    case 'worker':
    default: {
      const result = createWorkerKey(
        request.clientId,
        invite.teamId,
        teamConfig.managerId
      );
      rawKey = result.rawKey;
      keyInfo = result.keyInfo;
      break;
    }
  }

  // Apply custom scopes if specified
  if (invite.scopes && invite.scopes.length > 0) {
    keyInfo.scopes = invite.scopes;
  }

  // Add metadata if provided
  if (request.metadata) {
    keyInfo.metadata = request.metadata;
  }

  // Add the new key to config
  addApiKey(config, rawKey, keyInfo);

  // Update manager's managedAgents list if not a manager
  if (invite.permissionLevel !== 'manager') {
    for (const info of config.keys.values()) {
      if (info.clientId === teamConfig.managerId && info.managedAgents) {
        info.managedAgents.push(request.clientId);
        break;
      }
    }
  }

  // Update invite usage
  invite.useCount++;
  invite.usedBy.push(request.clientId);

  // Save everything
  saveApiKeysToFile(apiKeysFilePath, config);
  saveInviteCodes(apiKeysFilePath);

  return {
    success: true,
    apiKey: rawKey,
    clientId: request.clientId,
    team: invite.teamId,
    permissionLevel: invite.permissionLevel,
    scopes: keyInfo.scopes,
  };
}

/**
 * Revoke an invite code
 */
export function revokeInviteCode(code: string, apiKeysFilePath?: string): boolean {
  const invite = inviteCodes.get(code);
  if (!invite) {
    return false;
  }

  invite.active = false;

  if (apiKeysFilePath) {
    saveInviteCodes(apiKeysFilePath);
  }

  return true;
}

/**
 * Delete an invite code entirely
 */
export function deleteInviteCode(code: string, apiKeysFilePath?: string): boolean {
  const deleted = inviteCodes.delete(code);

  if (deleted && apiKeysFilePath) {
    saveInviteCodes(apiKeysFilePath);
  }

  return deleted;
}

/**
 * Get invite codes created by a specific manager
 */
export function getInvitesByCreator(createdBy: string): InviteCode[] {
  const result: InviteCode[] = [];
  for (const invite of inviteCodes.values()) {
    if (invite.createdBy === createdBy) {
      result.push(invite);
    }
  }
  return result;
}
