/**
 * API Key authentication middleware for HTTP MCP Server
 */

import type { RequestHandler, Response, NextFunction } from 'express';
import type { AuthenticatedRequest, ApiKeyConfig, ApiKeyInfo } from './types.js';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';

/**
 * Hash an API key for secure comparison
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Load API keys from a JSON file
 */
export function loadApiKeysFromFile(filePath: string): Map<string, ApiKeyInfo> {
  const keys = new Map<string, ApiKeyInfo>();

  if (!existsSync(filePath)) {
    console.warn(`[Auth] API keys file not found: ${filePath}`);
    return keys;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as Record<string, {
      clientId: string;
      scopes?: string[];
      expiresAt?: number;
    }>;

    for (const [key, info] of Object.entries(data)) {
      keys.set(key, {
        clientId: info.clientId,
        scopes: info.scopes ?? ['memory:read', 'memory:write'],
        createdAt: Date.now(),
        expiresAt: info.expiresAt,
      });
    }

    console.log(`[Auth] Loaded ${keys.size} API key(s) from ${filePath}`);
  } catch (error) {
    console.error(`[Auth] Error loading API keys from ${filePath}:`, error);
  }

  return keys;
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
    const keyInfo = config.keys.get(apiKey);

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

    // Attach auth info to request
    req.auth = {
      token: apiKey,
      clientId: keyInfo.clientId,
      scopes: keyInfo.scopes,
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
