/**
 * Session Manager for HTTP MCP Server
 * Manages per-client MemoryManager and McpServer instances
 */

import { randomUUID } from 'crypto';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MemoryManager } from '../../../memory/MemoryManager.js';
import { SqliteStorage } from '../../../storage/SqliteStorage.js';
import { createMcpServer } from '../../common/mcpServer.js';
import type { AuthInfo } from '../auth/types.js';

export interface Session {
  id: string;
  clientId: string;
  mcpServer: McpServer;
  memoryManager: MemoryManager;
  sharedStorage: SqliteStorage | null;
  auth?: AuthInfo;
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
  /** Callback invoked after a session is removed */
  onRemoveSession?: (sessionId: string) => void | Promise<void>;
  /** Path to API keys file for invite code operations */
  apiKeysFilePath?: string;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private clientSessions: Map<string, Set<string>> = new Map();
  private clientManagers: Map<string, MemoryManager> = new Map();
  /** Team-shared storage instances (one per team) */
  private teamStorages: Map<string, SqliteStorage> = new Map();
  /** Track which clients use each team storage for cleanup */
  private teamClients: Map<string, Set<string>> = new Map();
  private readonly config: Required<Omit<SessionManagerConfig, 'apiKeysFilePath'>> & Pick<SessionManagerConfig, 'apiKeysFilePath'>;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config: SessionManagerConfig) {
    this.config = {
      dataPath: config.dataPath,
      sessionTimeout: config.sessionTimeout ?? 30 * 60 * 1000, // 30 minutes
      cleanupInterval: config.cleanupInterval ?? 5 * 60 * 1000, // 5 minutes
      onRemoveSession: config.onRemoveSession ?? (() => undefined),
      apiKeysFilePath: config.apiKeysFilePath,
    };

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupInterval);
  }

  private sanitizeClientId(clientId: string): string {
    const sanitized = clientId.replace(/[^a-zA-Z0-9._-]/g, '_');
    return sanitized.length > 0 ? sanitized : 'anonymous';
  }

  /**
   * Get or create a session for a client
   */
  getOrCreate(sessionId: string | undefined, clientId: string, auth?: AuthInfo): Session {
    // Try to get existing session
    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      // Verify client ID matches
      if (session.clientId === clientId) {
        session.lastAccess = Date.now();
        // Update auth info if provided (in case permissions changed)
        if (auth) {
          session.auth = auth;
        }
        return session;
      }
      // Client ID mismatch - create new session
    }

    // Create new session
    const id = randomUUID();
    let memoryManager = this.clientManagers.get(clientId);
    if (!memoryManager) {
      const safeClientId = this.sanitizeClientId(clientId);
      const dataPath = join(this.config.dataPath, 'clients', safeClientId);
      memoryManager = new MemoryManager({
        dataPath,
        sessionId: clientId,
        cleanupInterval: 5 * 60 * 1000, // 5 minutes
      });
      this.clientManagers.set(clientId, memoryManager);
    }

    // Get or create team-shared storage if client belongs to a team
    let sharedStorage: SqliteStorage | null = null;
    const teamId = auth?.team;
    if (teamId) {
      sharedStorage = this.teamStorages.get(teamId) ?? null;
      if (!sharedStorage) {
        const teamDataPath = join(this.config.dataPath, 'teams', teamId);
        mkdirSync(teamDataPath, { recursive: true });
        sharedStorage = new SqliteStorage({ dataPath: teamDataPath });
        this.teamStorages.set(teamId, sharedStorage);
        this.teamClients.set(teamId, new Set());
      }
      this.teamClients.get(teamId)!.add(clientId);
    }

    const mcpServer = createMcpServer({
      memoryManager,
      storage: memoryManager.getStorage(),
      sharedStorage,
      serverName: `cc-memory-${clientId}`,
      auth,
      apiKeysFilePath: this.config.apiKeysFilePath,
    });

    const session: Session = {
      id,
      clientId,
      mcpServer,
      memoryManager,
      sharedStorage,
      auth,
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
      // Remove from client sessions
      const clientSessions = this.clientSessions.get(session.clientId);
      if (clientSessions) {
        clientSessions.delete(sessionId);
        if (clientSessions.size === 0) {
          this.clientSessions.delete(session.clientId);
          const manager = this.clientManagers.get(session.clientId);
          if (manager) {
            manager.close();
            this.clientManagers.delete(session.clientId);
          }

          // Clean up team storage reference if this was the last client in the team
          const teamId = session.auth?.team;
          if (teamId) {
            const teamClients = this.teamClients.get(teamId);
            if (teamClients) {
              teamClients.delete(session.clientId);
              if (teamClients.size === 0) {
                this.teamClients.delete(teamId);
                const teamStorage = this.teamStorages.get(teamId);
                if (teamStorage) {
                  teamStorage.close();
                  this.teamStorages.delete(teamId);
                }
              }
            }
          }
        }
      }

      this.sessions.delete(sessionId);
      void this.config.onRemoveSession(sessionId);
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

    for (const manager of this.clientManagers.values()) {
      try {
        manager.close();
      } catch (error) {
        console.error('[SessionManager] Error closing memory manager:', error);
      }
    }

    // Close team shared storages
    for (const storage of this.teamStorages.values()) {
      try {
        storage.close();
      } catch (error) {
        console.error('[SessionManager] Error closing team storage:', error);
      }
    }

    this.sessions.clear();
    this.clientSessions.clear();
    this.clientManagers.clear();
    this.teamStorages.clear();
    this.teamClients.clear();
  }
}
