/**
 * Authentication types for HTTP MCP Server
 */

import type { Request } from 'express';

export interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthInfo;
}

export interface ApiKeyConfig {
  /** Map of API keys to their configuration */
  keys: Map<string, ApiKeyInfo>;
}

export interface ApiKeyInfo {
  clientId: string;
  scopes: string[];
  createdAt?: number;
  expiresAt?: number;
}

export type AuthMode = 'apikey' | 'none';
