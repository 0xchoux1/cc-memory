/**
 * Security middleware for HTTP MCP Server
 */

import type { RequestHandler, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';

export interface SecurityConfig {
  /** Allowed hosts for Host header validation */
  allowedHosts?: string[];
  /** Whether HTTPS is required (for production) */
  requireHttps?: boolean;
  /** Trusted proxy setting */
  trustProxy?: boolean | string | number;
}

/**
 * Create helmet security middleware
 */
export function createHelmetMiddleware(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // Allow SSE
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin for MCP
  });
}

/**
 * Create Host header validation middleware (DNS rebinding protection)
 */
export function createHostValidation(config: SecurityConfig): RequestHandler {
  const allowedHosts = config.allowedHosts ?? ['127.0.0.1', 'localhost'];

  return (req: Request, res: Response, next: NextFunction) => {
    const host = req.headers.host;

    if (!host) {
      res.status(400).json({
        error: 'bad_request',
        message: 'Host header required',
      });
      return;
    }

    // Extract hostname (without port), handling IPv6 addresses like [::1]:3000
    let hostname: string;
    if (host.startsWith('[')) {
      // IPv6 address: [::1]:3000 or [::1]
      const closingBracket = host.indexOf(']');
      hostname = closingBracket > 0 ? host.slice(1, closingBracket) : host.slice(1);
    } else {
      // IPv4 or hostname: 127.0.0.1:3000 or localhost:3000
      const colonIndex = host.lastIndexOf(':');
      // Only treat as port separator if there's something after it that looks like a port
      if (colonIndex > 0 && /^\d+$/.test(host.slice(colonIndex + 1))) {
        hostname = host.slice(0, colonIndex);
      } else {
        hostname = host;
      }
    }

    const isAllowed = allowedHosts.some(allowed => {
      if (allowed.startsWith('*.')) {
        // Wildcard subdomain matching
        const domain = allowed.slice(2);
        return hostname === domain || hostname.endsWith('.' + domain);
      }
      return hostname === allowed;
    });

    if (!isAllowed) {
      res.status(403).json({
        error: 'forbidden',
        message: 'Invalid host header',
      });
      return;
    }

    next();
  };
}

/**
 * Create HTTPS enforcement middleware
 */
export function createHttpsEnforcement(config: SecurityConfig): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.requireHttps) {
      next();
      return;
    }

    // Check if request is HTTPS (directly or via proxy)
    const isHttps =
      req.secure ||
      req.headers['x-forwarded-proto'] === 'https' ||
      req.headers['x-forwarded-ssl'] === 'on';

    if (!isHttps) {
      res.status(403).json({
        error: 'https_required',
        message: 'HTTPS is required in production',
      });
      return;
    }

    next();
  };
}

/**
 * Create CORS middleware for MCP
 *
 * Security: If allowedOrigins is not specified, CORS headers are NOT sent.
 * This prevents credential leakage to arbitrary origins.
 * To enable CORS, explicitly provide an allowlist of origins.
 */
export function createCorsMiddleware(allowedOrigins?: string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;

    // No origin = same-origin or non-browser request
    if (!origin) {
      next();
      return;
    }

    // If no allowedOrigins configured, deny CORS (secure default)
    if (!allowedOrigins || allowedOrigins.length === 0) {
      // Handle preflight without CORS headers (browser will block)
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
      return;
    }

    // Check if origin is allowed
    const isAllowed = allowedOrigins.includes('*') || allowedOrigins.includes(origin);

    if (isAllowed) {
      // For wildcard, don't send credentials (browsers block this anyway)
      if (allowedOrigins.includes('*')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        // Note: Cannot use credentials with wildcard origin
      } else {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
      res.setHeader('Access-Control-Max-Age', '86400');
    }

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}

/**
 * Create request logging middleware
 */
export function createRequestLogger(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const timestamp = new Date().toISOString();
    const method = req.method;
    const path = req.path;
    const sessionId = req.headers['mcp-session-id'] || '-';

    console.log(`[${timestamp}] ${method} ${path} (session: ${sessionId})`);
    next();
  };
}
