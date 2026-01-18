#!/usr/bin/env node
/**
 * CC-Memory HTTP MCP Server
 * Remote MCP server for cross-hardware memory sharing
 */

import express from 'express';
import { createServer } from 'http';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { SessionManager } from './server/http/session/manager.js';
import {
  createApiKeyAuth,
  createNoAuth,
  loadApiKeysFromFile,
} from './server/http/auth/apiKey.js';
import type { AuthenticatedRequest } from './server/http/auth/types.js';
import {
  createHelmetMiddleware,
  createHostValidation,
  createHttpsEnforcement,
  createCorsMiddleware,
  createRequestLogger,
} from './server/http/middleware/security.js';
import { createRateLimiter } from './server/http/middleware/rateLimit.js';

// Configuration from environment
const PORT = parseInt(process.env.CC_MEMORY_PORT || '3000', 10);
const HOST = process.env.CC_MEMORY_HOST || '127.0.0.1';
const DATA_PATH = process.env.CC_MEMORY_DATA_PATH || join(homedir(), '.claude-memory');
const AUTH_MODE = process.env.CC_MEMORY_AUTH_MODE || 'apikey'; // 'apikey' or 'none'
const API_KEYS_FILE = process.env.CC_MEMORY_API_KEYS_FILE || join(DATA_PATH, 'api-keys.json');
const ALLOWED_HOSTS = (process.env.CC_MEMORY_ALLOWED_HOSTS || '127.0.0.1,localhost').split(',');
const CORS_ORIGINS = process.env.CC_MEMORY_CORS_ORIGINS?.split(',');
const REQUIRE_HTTPS = process.env.CC_MEMORY_REQUIRE_HTTPS === 'true';
const SESSION_TIMEOUT = parseInt(process.env.CC_MEMORY_SESSION_TIMEOUT || '1800000', 10); // 30 minutes

// Initialize Express app
const app = express();

// Trust proxy if behind reverse proxy
if (process.env.CC_MEMORY_TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

// Security middleware
app.use(createHelmetMiddleware());
app.use(createHostValidation({ allowedHosts: ALLOWED_HOSTS }));
app.use(createHttpsEnforcement({ requireHttps: REQUIRE_HTTPS }));
app.use(createCorsMiddleware(CORS_ORIGINS));
app.use(createRequestLogger());

// Rate limiting
app.use(createRateLimiter({ windowMs: 60000, max: 100 }));

// Authentication
const authMiddleware = AUTH_MODE === 'none'
  ? createNoAuth()
  : createApiKeyAuth({ keys: loadApiKeysFromFile(API_KEYS_FILE) });

// Session manager
const sessionManager = new SessionManager({
  dataPath: DATA_PATH,
  sessionTimeout: SESSION_TIMEOUT,
});

// Map to store transports for each session
const transports = new Map<string, StreamableHTTPServerTransport>();

// MCP endpoint (handles POST for requests and GET for SSE)
app.all('/mcp', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const clientId = req.auth?.clientId || 'anonymous';

  try {
    // Handle different HTTP methods
    if (req.method === 'POST') {
      // Check if this is an initialize request
      const body = req.body;
      const isInit = isInitializeRequest(body);

      if (isInit) {
        // Create new session and transport
        const session = sessionManager.getOrCreate(undefined, clientId);

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => session.id,
          onsessioninitialized: (newSessionId) => {
            console.log(`[MCP] Session initialized: ${newSessionId} (client: ${clientId})`);
          },
        });

        transports.set(session.id, transport);

        // Connect transport to MCP server
        await session.mcpServer.connect(transport);

        // Handle the request
        await transport.handleRequest(req, res, body);
      } else if (sessionId) {
        // Existing session - get transport
        const transport = transports.get(sessionId);
        if (!transport) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Invalid session ID. Session may have expired.',
            },
            id: null,
          });
          return;
        }

        await transport.handleRequest(req, res, body);
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Session ID required for non-initialize requests',
          },
          id: null,
        });
      }
    } else if (req.method === 'GET') {
      // SSE connection for server-to-client notifications
      if (!sessionId) {
        res.status(400).json({
          error: 'bad_request',
          message: 'Session ID required for SSE connection',
        });
        return;
      }

      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(400).json({
          error: 'bad_request',
          message: 'Invalid session ID',
        });
        return;
      }

      await transport.handleRequest(req, res);
    } else if (req.method === 'DELETE') {
      // Close session
      if (sessionId) {
        const transport = transports.get(sessionId);
        if (transport) {
          await transport.close();
          transports.delete(sessionId);
        }
        sessionManager.remove(sessionId);
        res.status(204).end();
      } else {
        res.status(400).json({
          error: 'bad_request',
          message: 'Session ID required',
        });
      }
    } else {
      res.status(405).json({
        error: 'method_not_allowed',
        message: 'Only GET, POST, and DELETE are supported',
      });
    }
  } catch (error) {
    console.error('[MCP] Error handling request:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal server error',
      },
      id: null,
    });
  }
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    version: '1.0.0',
    sessions: sessionManager.getSessionCount(),
    clients: sessionManager.getClientCount(),
    uptime: process.uptime(),
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down...');

  // Close all transports
  for (const [sessionId, transport] of transports) {
    try {
      await transport.close();
    } catch (error) {
      console.error(`[Server] Error closing transport ${sessionId}:`, error);
    }
  }
  transports.clear();

  sessionManager.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Server] Received SIGTERM, shutting down...');

  for (const [sessionId, transport] of transports) {
    try {
      await transport.close();
    } catch (error) {
      console.error(`[Server] Error closing transport ${sessionId}:`, error);
    }
  }
  transports.clear();

  sessionManager.close();
  process.exit(0);
});

// Start server
const server = createServer(app);

server.listen(PORT, HOST, () => {
  console.log(`CC-Memory HTTP MCP Server started`);
  console.log(`  URL: http://${HOST}:${PORT}/mcp`);
  console.log(`  Auth: ${AUTH_MODE}`);
  console.log(`  Data: ${DATA_PATH}`);
  console.log(`  Allowed hosts: ${ALLOWED_HOSTS.join(', ')}`);
  if (REQUIRE_HTTPS) {
    console.log(`  HTTPS: required`);
  }
  console.log('');
  console.log('Client configuration:');
  console.log(JSON.stringify({
    mcpServers: {
      'cc-memory-remote': {
        type: 'streamable-http',
        url: `http://${HOST}:${PORT}/mcp`,
        headers: {
          Authorization: 'Bearer YOUR_API_KEY',
        },
      },
    },
  }, null, 2));
});
