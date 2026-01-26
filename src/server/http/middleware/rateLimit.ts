/**
 * Rate limiting middleware for HTTP MCP Server
 */

import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/types.js';

export interface RateLimitConfig {
  /** Time window in ms (default: 1 minute) */
  windowMs?: number;
  /** Max requests per window (default: 100) */
  max?: number;
  /** Whether to skip rate limiting for certain clients */
  skipFailedRequests?: boolean;
}

/**
 * Create rate limiting middleware
 */
export function createRateLimiter(config: RateLimitConfig = {}) {
  return rateLimit({
    windowMs: config.windowMs ?? 60 * 1000, // 1 minute
    max: config.max ?? 100, // 100 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    skipFailedRequests: config.skipFailedRequests ?? false,

    // Use client ID if authenticated, otherwise use IP
    keyGenerator: (req: Request) => {
      const authReq = req as AuthenticatedRequest;
      if (authReq.auth?.clientId) {
        return authReq.auth.clientId;
      }
      // Use IP with proper handling for IPv6
      const ip = req.ip || req.socket?.remoteAddress || 'unknown';
      // Normalize IPv6 mapped IPv4 addresses
      if (ip.startsWith('::ffff:')) {
        return ip.slice(7);
      }
      return ip;
    },

    // Disable the IP-related validations since we handle them ourselves
    validate: { xForwardedForHeader: false, ip: false },

    // Custom response
    handler: (_req, res) => {
      res.status(429).json({
        error: 'rate_limited',
        message: 'Too many requests, please try again later',
      });
    },
  });
}

/**
 * Create a stricter rate limiter for sensitive endpoints
 */
export function createStrictRateLimiter(config: RateLimitConfig = {}) {
  return rateLimit({
    windowMs: config.windowMs ?? 60 * 1000, // 1 minute
    max: config.max ?? 10, // 10 requests per minute
    standardHeaders: true,
    legacyHeaders: false,

    keyGenerator: (req: Request) => {
      const authReq = req as AuthenticatedRequest;
      if (authReq.auth?.clientId) {
        return authReq.auth.clientId;
      }
      const ip = req.ip || req.socket?.remoteAddress || 'unknown';
      if (ip.startsWith('::ffff:')) {
        return ip.slice(7);
      }
      return ip;
    },

    validate: { xForwardedForHeader: false, ip: false },

    handler: (_req, res) => {
      res.status(429).json({
        error: 'rate_limited',
        message: 'Too many requests to this endpoint, please try again later',
      });
    },
  });
}
