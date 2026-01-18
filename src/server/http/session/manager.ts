/**
 * Session Manager for HTTP MCP Server
 * Manages per-client MemoryManager and McpServer instances
 */

import { randomUUID } from 'crypto';
import { join } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MemoryManager } from '../../../memory/MemoryManager.js';
import { createMcpServer } from '../../common/mcpServer.js';

export interface Session {
  id: string;
  clientId: string;
  mcpServer: McpServer;
  memoryManager: MemoryManager;
  createdAt: number;
  lastAccess: number;
}

export interface SessionManagerConfig {
  /** Base data path for client storage */
  dataPath: string;
  /** Session timeout in ms (default: 30 minutes) */
  sessionTimeout?: number;
  /** Cleanup interval in ms (default: 5 minutes) */
  cleanupInterval?: number;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private clientSessions: Map<string, Set<string>> = new Map();
  private readonly config: Required<SessionManagerConfig>;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config: SessionManagerConfig) {
    this.config = {
      dataPath: config.dataPath,
      sessionTimeout: config.sessionTimeout ?? 30 * 60 * 1000, // 30 minutes
      cleanupInterval: config.cleanupInterval ?? 5 * 60 * 1000, // 5 minutes
    };

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupInterval);
  }

  /**
   * Get or create a session for a client
   */
  getOrCreate(sessionId: string | undefined, clientId: string): Session {
    // Try to get existing session
    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      // Verify client ID matches
      if (session.clientId === clientId) {
        session.lastAccess = Date.now();
        return session;
      }
      // Client ID mismatch - create new session
    }

    // Create new session
    const id = randomUUID();
    const dataPath = join(this.config.dataPath, 'clients', clientId);

    const memoryManager = new MemoryManager({
      dataPath,
      cleanupInterval: 5 * 60 * 1000, // 5 minutes
    });

    const mcpServer = createMcpServer({
      memoryManager,
      storage: memoryManager.getStorage(),
      serverName: `cc-memory-${clientId}`,
    });

    const session: Session = {
      id,
      clientId,
      mcpServer,
      memoryManager,
      createdAt: Date.now(),
      lastAccess: Date.now(),
    };

    this.sessions.set(id, session);

    // Track session by client ID
    if (!this.clientSessions.has(clientId)) {
      this.clientSessions.set(clientId, new Set());
    }
    this.clientSessions.get(clientId)!.add(id);

    return session;
  }

  /**
   * Get session by ID
   */
  get(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastAccess = Date.now();
    }
    return session;
  }

  /**
   * Get all sessions for a client
   */
  getByClient(clientId: string): Session[] {
    const sessionIds = this.clientSessions.get(clientId);
    if (!sessionIds) {
      return [];
    }

    return Array.from(sessionIds)
      .map(id => this.sessions.get(id))
      .filter((s): s is Session => s !== undefined);
  }

  /**
   * Remove a session
   */
  remove(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Close memory manager
      session.memoryManager.close();

      // Remove from client sessions
      const clientSessions = this.clientSessions.get(session.clientId);
      if (clientSessions) {
        clientSessions.delete(sessionId);
        if (clientSessions.size === 0) {
          this.clientSessions.delete(session.clientId);
        }
      }

      this.sessions.delete(sessionId);
    }
  }

  /**
   * Cleanup expired sessions
   */
  private cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [id, session] of this.sessions) {
      if (now - session.lastAccess > this.config.sessionTimeout) {
        expired.push(id);
      }
    }

    for (const id of expired) {
      console.log(`[SessionManager] Cleaning up expired session: ${id}`);
      this.remove(id);
    }
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get client count
   */
  getClientCount(): number {
    return this.clientSessions.size;
  }

  /**
   * Get all session IDs
   */
  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Close all sessions and stop cleanup timer
   */
  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    for (const session of this.sessions.values()) {
      try {
        session.memoryManager.close();
      } catch (error) {
        console.error(`[SessionManager] Error closing session ${session.id}:`, error);
      }
    }

    this.sessions.clear();
    this.clientSessions.clear();
  }
}
