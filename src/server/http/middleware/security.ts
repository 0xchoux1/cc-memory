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

    // Extract hostname (without port)
    const hostname = host.split(':')[0];

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
 */
export function createCorsMiddleware(allowedOrigins?: string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;

    // No origin = same-origin or non-browser request
    if (!origin) {
      next();
      return;
    }

    // Check if origin is allowed
    const isAllowed = !allowedOrigins ||
      allowedOrigins.includes('*') ||
      allowedOrigins.includes(origin);

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
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
