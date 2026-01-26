#!/usr/bin/env node
/**
 * CC-Memory HTTP MCP Server
 * Remote MCP server for cross-hardware memory sharing
 */

import express, { type Response } from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { homedir } from 'os';
import { join } from 'path';
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
import { WebSocketSyncServer } from './server/websocket/SyncServer.js';

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

// WebSocket configuration
const WS_ENABLED = process.env.CC_MEMORY_WS_ENABLED !== 'false'; // Default enabled
const WS_PING_INTERVAL = parseInt(process.env.CC_MEMORY_WS_PING_INTERVAL || '30000', 10);
const WS_CONNECTION_TIMEOUT = parseInt(process.env.CC_MEMORY_WS_CONNECTION_TIMEOUT || '60000', 10);

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
const apiKeyConfig = loadApiKeysFromFile(API_KEYS_FILE);
const authMiddleware = AUTH_MODE === 'none'
  ? createNoAuth()
  : createApiKeyAuth(apiKeyConfig);

function hasScopes(req: AuthenticatedRequest, res: Response, scopes: string[]): boolean {
  // Check for wildcard scope
  if (req.auth?.scopes?.includes('memory:*')) {
    return true;
  }

  const missing = scopes.filter(scope => !req.auth?.scopes?.includes(scope));
  if (missing.length > 0) {
    res.status(403).json({
      error: 'forbidden',
      message: `Missing required scopes: ${missing.join(', ')}`,
    });
    return false;
  }
  return true;
}

function closeTransport(transports: Map<string, StreamableHTTPServerTransport>, sessionId: string): void {
  const transport = transports.get(sessionId);
  if (transport) {
    void transport.close();
    transports.delete(sessionId);
  }
}

const WRITE_TOOLS = new Set([
  'working_set',
  'working_delete',
  'working_clear',
  'episode_record',
  'episode_update',
  'episode_relate',
  'semantic_create',
  'semantic_add_observation',
  'semantic_relate',
  'semantic_update',
  'memory_consolidate',
  'memory_import',
  'memory_decay',
  'memory_boost',
  'tachikoma_init',
  'tachikoma_import',
  'tachikoma_resolve_conflict',
  'agent_register',
  'pattern_create',
  'pattern_confirm',
  'insight_create',
  'insight_validate',
  'wisdom_create',
  'wisdom_apply',
]);

function requiredScopesForRequest(body: unknown): string[] {
  const requests = Array.isArray(body) ? body : [body];
  let needsWrite = false;

  for (const request of requests) {
    if (!request || typeof request !== 'object') {
      continue;
    }

    const method = (request as { method?: string }).method;
    const params = (request as { params?: Record<string, unknown> }).params;

    if (method === 'tools/call') {
      const toolName = typeof params?.name === 'string' ? params.name : '';
      if (WRITE_TOOLS.has(toolName)) {
        needsWrite = true;
      }
      continue;
    }
  }

  return needsWrite ? ['memory:write'] : ['memory:read'];
}

// Map to store transports for each session
const transports = new Map<string, StreamableHTTPServerTransport>();

// WebSocket Sync Server (initialized later if enabled)
let wsSyncServer: WebSocketSyncServer | undefined;

// Session manager
const sessionManager = new SessionManager({
  dataPath: DATA_PATH,
  sessionTimeout: SESSION_TIMEOUT,
  onRemoveSession: (sessionId) => closeTransport(transports, sessionId),
});

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
        if (!hasScopes(req, res, ['memory:read'])) {
          return;
        }

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
        const requiredScopes = requiredScopesForRequest(body);
        if (!hasScopes(req, res, requiredScopes)) {
          return;
        }

        // Existing session - get transport
        const session = sessionManager.get(sessionId);
        if (!session || session.clientId !== clientId) {
          closeTransport(transports, sessionId);
          res.status(403).json({
            jsonrpc: '2.0',
            error: {
              code: -32600,
              message: 'Invalid session ID or client mismatch',
            },
            id: null,
          });
          return;
        }

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

      if (!hasScopes(req, res, ['memory:read'])) {
        return;
      }

      const session = sessionManager.get(sessionId);
      if (!session || session.clientId !== clientId) {
        closeTransport(transports, sessionId);
        res.status(403).json({
          error: 'forbidden',
          message: 'Invalid session ID or client mismatch',
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
        if (!hasScopes(req, res, ['memory:write'])) {
          return;
        }

        const session = sessionManager.get(sessionId);
        if (!session || session.clientId !== clientId) {
          closeTransport(transports, sessionId);
          res.status(403).json({
            error: 'forbidden',
            message: 'Invalid session ID or client mismatch',
          });
          return;
        }

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
  const healthData: Record<string, unknown> = {
    status: 'healthy',
    version: '1.0.0',
    sessions: sessionManager.getSessionCount(),
    clients: sessionManager.getClientCount(),
    uptime: process.uptime(),
  };

  // Add WebSocket stats if enabled
  if (WS_ENABLED && wsSyncServer) {
    healthData.websocket = {
      enabled: true,
      connectedClients: wsSyncServer.getConnectedClients().length,
      rooms: wsSyncServer.getRooms().length,
    };
  } else {
    healthData.websocket = { enabled: false };
  }

  res.json(healthData);
});

// Graceful shutdown
async function shutdown() {
  console.log('\n[Server] Shutting down...');

  // Close WebSocket server
  if (wsSyncServer) {
    console.log('[Server] Stopping WebSocket sync server...');
    wsSyncServer.stop();
  }

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
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
const server = createServer(app);

if (WS_ENABLED) {
  // Create WebSocket server attached to HTTP server
  const wss = new WebSocketServer({ server, path: '/sync' });

  // Initialize WebSocketSyncServer
  wsSyncServer = new WebSocketSyncServer({
    apiKeys: apiKeyConfig.keys,
    teams: apiKeyConfig.teams,
    pingInterval: WS_PING_INTERVAL,
    connectionTimeout: WS_CONNECTION_TIMEOUT,
    onClientConnect: (client) => {
      console.log(`[WebSocket] Client connected: ${client.clientId} (team: ${client.team || 'none'})`);
    },
    onClientDisconnect: (client) => {
      console.log(`[WebSocket] Client disconnected: ${client.clientId}`);
    },
  });

  // Handle WebSocket connections
  wss.on('connection', (ws) => {
    const connectionId = wsSyncServer!.handleConnection(ws);
    console.log(`[WebSocket] New connection: ${connectionId}`);
  });

  // Start the sync server (ping interval, cleanup)
  wsSyncServer.start();
}

server.listen(PORT, HOST, () => {
  console.log(`CC-Memory HTTP MCP Server started`);
  console.log(`  URL: http://${HOST}:${PORT}/mcp`);
  console.log(`  Auth: ${AUTH_MODE}`);
  console.log(`  Data: ${DATA_PATH}`);
  console.log(`  Allowed hosts: ${ALLOWED_HOSTS.join(', ')}`);
  if (WS_ENABLED) {
    console.log(`  WebSocket: ws://${HOST}:${PORT}/sync`);
  }
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
    ...(WS_ENABLED ? {
      sync: {
        websocket: `ws://${HOST}:${PORT}/sync`,
      },
    } : {}),
  }, null, 2));
});
