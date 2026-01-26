/**
 * WebSocket Sync Server for real-time memory synchronization
 */

import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import { type Server as HttpServer } from 'http';
import type {
  SyncBatch,
  SyncEvent,
} from '../../sync/EventDrivenSyncManager.js';
import { serializeSyncBatch, deserializeSyncBatch, serializeSyncEvent, deserializeSyncEvent } from '../../sync/EventDrivenSyncManager.js';
import { hashApiKey } from '../http/auth/apiKey.js';
import type { ApiKeyInfoV2, TeamConfig } from '../http/auth/types.js';
import { VectorClock } from '../../sync/VectorClock.js';

// ============================================================================
// Types
// ============================================================================

/**
 * WebSocket message types
 */
export type WSMessageType =
  | 'auth'
  | 'auth_response'
  | 'join_room'
  | 'leave_room'
  | 'sync_event'
  | 'sync_batch'
  | 'sync_request'
  | 'sync_response'
  | 'presence'
  | 'ping'
  | 'pong'
  | 'error';

/**
 * Base WebSocket message
 */
export interface WSMessage {
  type: WSMessageType;
  id: string;
  timestamp: number;
}

/**
 * Authentication message
 */
export interface WSAuthMessage extends WSMessage {
  type: 'auth';
  token: string;
}

/**
 * Authentication response
 */
export interface WSAuthResponse extends WSMessage {
  type: 'auth_response';
  success: boolean;
  clientId?: string;
  team?: string;
  error?: string;
}

/**
 * Join room message
 */
export interface WSJoinRoomMessage extends WSMessage {
  type: 'join_room';
  room: string;
}

/**
 * Leave room message
 */
export interface WSLeaveRoomMessage extends WSMessage {
  type: 'leave_room';
  room: string;
}

/**
 * Sync event message
 */
export interface WSSyncEventMessage extends WSMessage {
  type: 'sync_event';
  event: Record<string, unknown>;
  room?: string;
}

/**
 * Sync batch message
 */
export interface WSSyncBatchMessage extends WSMessage {
  type: 'sync_batch';
  batch: Record<string, unknown>;
  room?: string;
}

/**
 * Sync request message (for P2P sync)
 */
export interface WSSyncRequestMessage extends WSMessage {
  type: 'sync_request';
  targetClientId: string;
  sinceVectorClock?: Record<string, number>;
}

/**
 * Sync response message
 */
export interface WSSyncResponseMessage extends WSMessage {
  type: 'sync_response';
  requestId: string;
  batch: Record<string, unknown>;
}

/**
 * Presence message
 */
export interface WSPresenceMessage extends WSMessage {
  type: 'presence';
  clientId: string;
  status: 'online' | 'offline' | 'away';
  room?: string;
}

/**
 * Error message
 */
export interface WSErrorMessage extends WSMessage {
  type: 'error';
  code: string;
  message: string;
  originalMessageId?: string;
}

/**
 * Authenticated client connection
 */
export interface AuthenticatedClient {
  id: string;
  clientId: string;
  socket: WebSocketLike;
  team?: string;
  rooms: Set<string>;
  authenticated: boolean;
  permissionLevel: string;
  lastActivity: number;
  vectorClock: VectorClock;
}

/**
 * WebSocket-like interface for compatibility
 */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  addEventListener?(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * Configuration for WebSocketSyncServer
 */
export interface SyncServerConfig {
  apiKeys: Map<string, ApiKeyInfoV2>;
  teams: Map<string, TeamConfig>;
  pingInterval?: number;
  connectionTimeout?: number;
  onClientConnect?: (client: AuthenticatedClient) => void;
  onClientDisconnect?: (client: AuthenticatedClient) => void;
  onSyncBatch?: (batch: SyncBatch, client: AuthenticatedClient) => Promise<void>;
}

// ============================================================================
// WebSocket Constants
// ============================================================================

const WS_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
};

// ============================================================================
// WebSocketSyncServer
// ============================================================================

/**
 * WebSocketSyncServer - Real-time sync channel for multi-agent memory sharing
 */
export class WebSocketSyncServer extends EventEmitter {
  private config: SyncServerConfig;
  private clients: Map<string, AuthenticatedClient> = new Map();
  private rooms: Map<string, Set<string>> = new Map(); // room -> clientIds
  private clientIdToConnectionId: Map<string, string> = new Map();
  private pingInterval?: NodeJS.Timeout;
  private pendingSyncRequests: Map<string, {
    resolve: (batch: SyncBatch) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  constructor(config: SyncServerConfig) {
    super();
    this.config = {
      pingInterval: 30000,
      connectionTimeout: 60000,
      ...config,
    };
  }

  /**
   * Generate a unique message ID
   */
  private generateId(): string {
    return `msg_${Date.now()}_${randomBytes(4).toString('hex')}`;
  }

  /**
   * Start the ping interval
   */
  start(): void {
    if (this.pingInterval) return;

    this.pingInterval = setInterval(() => {
      this.pingClients();
      this.cleanupStaleClients();
    }, this.config.pingInterval!);
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }

    // Close all connections
    for (const client of this.clients.values()) {
      this.disconnectClient(client.id);
    }
  }

  /**
   * Handle a new WebSocket connection
   */
  handleConnection(socket: WebSocketLike): string {
    const connectionId = `conn_${Date.now()}_${randomBytes(4).toString('hex')}`;

    const client: AuthenticatedClient = {
      id: connectionId,
      clientId: '',
      socket,
      rooms: new Set(),
      authenticated: false,
      permissionLevel: '',
      lastActivity: Date.now(),
      vectorClock: new VectorClock(),
    };

    this.clients.set(connectionId, client);

    // Set up message handler
    const messageHandler = (data: unknown) => {
      try {
        const message = typeof data === 'string' ? JSON.parse(data) : data;
        this.handleMessage(connectionId, message as WSMessage);
      } catch (error) {
        this.sendError(client, 'INVALID_MESSAGE', 'Failed to parse message');
      }
    };

    // Support both Node.js ws and browser WebSocket APIs
    if (socket.on) {
      socket.on('message', messageHandler);
      socket.on('close', () => this.handleDisconnect(connectionId));
      socket.on('error', () => this.handleDisconnect(connectionId));
    } else if (socket.addEventListener) {
      socket.addEventListener('message', (event: unknown) => {
        const msgEvent = event as { data: unknown };
        messageHandler(msgEvent.data);
      });
      socket.addEventListener('close', () => this.handleDisconnect(connectionId));
      socket.addEventListener('error', () => this.handleDisconnect(connectionId));
    }

    return connectionId;
  }

  /**
   * Handle a message from a client
   */
  private handleMessage(connectionId: string, message: WSMessage): void {
    const client = this.clients.get(connectionId);
    if (!client) return;

    client.lastActivity = Date.now();

    switch (message.type) {
      case 'auth':
        this.handleAuth(client, message as WSAuthMessage);
        break;

      case 'join_room':
        this.handleJoinRoom(client, message as WSJoinRoomMessage);
        break;

      case 'leave_room':
        this.handleLeaveRoom(client, message as WSLeaveRoomMessage);
        break;

      case 'sync_event':
        this.handleSyncEvent(client, message as WSSyncEventMessage);
        break;

      case 'sync_batch':
        this.handleSyncBatch(client, message as WSSyncBatchMessage);
        break;

      case 'sync_request':
        this.handleSyncRequest(client, message as WSSyncRequestMessage);
        break;

      case 'sync_response':
        this.handleSyncResponse(client, message as WSSyncResponseMessage);
        break;

      case 'pong':
        // Update last activity (already done above)
        break;

      default:
        this.sendError(client, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handle authentication
   */
  private handleAuth(client: AuthenticatedClient, message: WSAuthMessage): void {
    const hashedKey = hashApiKey(message.token);
    const keyInfo = this.config.apiKeys.get(hashedKey);

    if (!keyInfo) {
      this.sendMessage(client, {
        type: 'auth_response',
        id: this.generateId(),
        timestamp: Date.now(),
        success: false,
        error: 'Invalid API key',
      } as WSAuthResponse);
      return;
    }

    // Check expiration
    if (keyInfo.expiresAt && keyInfo.expiresAt < Date.now()) {
      this.sendMessage(client, {
        type: 'auth_response',
        id: this.generateId(),
        timestamp: Date.now(),
        success: false,
        error: 'API key expired',
      } as WSAuthResponse);
      return;
    }

    // Set client info
    client.clientId = keyInfo.clientId;
    client.team = keyInfo.team ?? undefined;
    client.permissionLevel = keyInfo.permissionLevel;
    client.authenticated = true;

    // Track clientId to connectionId mapping
    this.clientIdToConnectionId.set(keyInfo.clientId, client.id);

    // Auto-join team room if applicable
    if (client.team) {
      this.joinRoom(client, `team:${client.team}`);
    }

    this.sendMessage(client, {
      type: 'auth_response',
      id: this.generateId(),
      timestamp: Date.now(),
      success: true,
      clientId: client.clientId,
      team: client.team,
    } as WSAuthResponse);

    // Emit connect event
    this.emit('client:connect', client);
    if (this.config.onClientConnect) {
      this.config.onClientConnect(client);
    }

    // Broadcast presence
    this.broadcastPresence(client, 'online');
  }

  /**
   * Handle join room request
   */
  private handleJoinRoom(client: AuthenticatedClient, message: WSJoinRoomMessage): void {
    if (!client.authenticated) {
      this.sendError(client, 'NOT_AUTHENTICATED', 'Must authenticate first', message.id);
      return;
    }

    // Check if client can join the room
    const room = message.room;
    if (room.startsWith('team:')) {
      const teamId = room.slice(5);
      if (client.team !== teamId) {
        this.sendError(client, 'FORBIDDEN', 'Cannot join team room', message.id);
        return;
      }
    }

    this.joinRoom(client, room);
  }

  /**
   * Handle leave room request
   */
  private handleLeaveRoom(client: AuthenticatedClient, message: WSLeaveRoomMessage): void {
    if (!client.authenticated) {
      this.sendError(client, 'NOT_AUTHENTICATED', 'Must authenticate first', message.id);
      return;
    }

    this.leaveRoom(client, message.room);
  }

  /**
   * Handle sync event
   */
  private handleSyncEvent(client: AuthenticatedClient, message: WSSyncEventMessage): void {
    if (!client.authenticated) {
      this.sendError(client, 'NOT_AUTHENTICATED', 'Must authenticate first', message.id);
      return;
    }

    const event = deserializeSyncEvent(message.event);

    // Update client's vector clock
    client.vectorClock.mergeInPlace(event.vectorClock);

    // Broadcast to appropriate targets
    if (message.room) {
      this.broadcastToRoom(message.room, message, client.id);
    } else if (Array.isArray(event.target)) {
      // Send to specific clients
      for (const targetClientId of event.target) {
        this.sendToClient(targetClientId, message);
      }
    } else if (event.target === 'broadcast') {
      // Broadcast to all client's rooms
      for (const room of client.rooms) {
        this.broadcastToRoom(room, message, client.id);
      }
    }

    this.emit('sync:event', event, client);
  }

  /**
   * Handle sync batch
   */
  private async handleSyncBatch(client: AuthenticatedClient, message: WSSyncBatchMessage): Promise<void> {
    if (!client.authenticated) {
      this.sendError(client, 'NOT_AUTHENTICATED', 'Must authenticate first', message.id);
      return;
    }

    const batch = deserializeSyncBatch(message.batch);

    // Update client's vector clock
    client.vectorClock.mergeInPlace(batch.vectorClock);

    // Process batch if handler provided
    if (this.config.onSyncBatch) {
      try {
        await this.config.onSyncBatch(batch, client);
      } catch (error) {
        this.sendError(client, 'SYNC_ERROR', 'Failed to process sync batch', message.id);
        return;
      }
    }

    // Broadcast to room if specified
    if (message.room) {
      this.broadcastToRoom(message.room, message, client.id);
    } else if (client.team) {
      // Default to team room
      this.broadcastToRoom(`team:${client.team}`, message, client.id);
    }

    this.emit('sync:batch', batch, client);
  }

  /**
   * Handle sync request (P2P)
   */
  private handleSyncRequest(client: AuthenticatedClient, message: WSSyncRequestMessage): void {
    if (!client.authenticated) {
      this.sendError(client, 'NOT_AUTHENTICATED', 'Must authenticate first', message.id);
      return;
    }

    // Forward request to target client
    const targetConnectionId = this.clientIdToConnectionId.get(message.targetClientId);
    if (!targetConnectionId) {
      this.sendError(client, 'CLIENT_NOT_FOUND', `Client ${message.targetClientId} not found`, message.id);
      return;
    }

    const targetClient = this.clients.get(targetConnectionId);
    if (!targetClient || !targetClient.authenticated) {
      this.sendError(client, 'CLIENT_NOT_FOUND', `Client ${message.targetClientId} not available`, message.id);
      return;
    }

    // Check if requester can sync with target (same team)
    if (client.team !== targetClient.team) {
      this.sendError(client, 'FORBIDDEN', 'Cannot sync with client outside your team', message.id);
      return;
    }

    // Forward the request
    this.sendMessage(targetClient, {
      ...message,
      id: this.generateId(), // New ID for the forwarded message
    });

    this.emit('sync:request', message, client);
  }

  /**
   * Handle sync response
   */
  private handleSyncResponse(client: AuthenticatedClient, message: WSSyncResponseMessage): void {
    const pending = this.pendingSyncRequests.get(message.requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingSyncRequests.delete(message.requestId);
      const batch = deserializeSyncBatch(message.batch);
      pending.resolve(batch);
    }

    this.emit('sync:response', message, client);
  }

  /**
   * Join a room
   */
  private joinRoom(client: AuthenticatedClient, room: string): void {
    client.rooms.add(room);

    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room)!.add(client.id);

    this.emit('room:join', room, client);
  }

  /**
   * Leave a room
   */
  private leaveRoom(client: AuthenticatedClient, room: string): void {
    client.rooms.delete(room);

    const roomMembers = this.rooms.get(room);
    if (roomMembers) {
      roomMembers.delete(client.id);
      if (roomMembers.size === 0) {
        this.rooms.delete(room);
      }
    }

    this.emit('room:leave', room, client);
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(connectionId: string): void {
    const client = this.clients.get(connectionId);
    if (!client) return;

    // Broadcast offline presence
    if (client.authenticated) {
      this.broadcastPresence(client, 'offline');
    }

    // Leave all rooms
    for (const room of client.rooms) {
      this.leaveRoom(client, room);
    }

    // Clean up mappings
    if (client.clientId) {
      this.clientIdToConnectionId.delete(client.clientId);
    }
    this.clients.delete(connectionId);

    // Emit disconnect event
    this.emit('client:disconnect', client);
    if (this.config.onClientDisconnect) {
      this.config.onClientDisconnect(client);
    }
  }

  /**
   * Disconnect a client
   */
  disconnectClient(connectionId: string, code?: number, reason?: string): void {
    const client = this.clients.get(connectionId);
    if (client) {
      client.socket.close(code, reason);
      this.handleDisconnect(connectionId);
    }
  }

  /**
   * Send a message to a client
   */
  private sendMessage(client: AuthenticatedClient, message: WSMessage): void {
    if (client.socket.readyState === WS_READY_STATE.OPEN) {
      client.socket.send(JSON.stringify(message));
    }
  }

  /**
   * Send an error message to a client
   */
  private sendError(client: AuthenticatedClient, code: string, message: string, originalMessageId?: string): void {
    this.sendMessage(client, {
      type: 'error',
      id: this.generateId(),
      timestamp: Date.now(),
      code,
      message,
      originalMessageId,
    } as WSErrorMessage);
  }

  /**
   * Send a message to a specific clientId
   */
  private sendToClient(clientId: string, message: WSMessage): boolean {
    const connectionId = this.clientIdToConnectionId.get(clientId);
    if (!connectionId) return false;

    const client = this.clients.get(connectionId);
    if (!client || !client.authenticated) return false;

    this.sendMessage(client, message);
    return true;
  }

  /**
   * Broadcast a message to a room
   */
  broadcastToRoom(room: string, message: WSMessage, excludeConnectionId?: string): void {
    const roomMembers = this.rooms.get(room);
    if (!roomMembers) return;

    for (const connectionId of roomMembers) {
      if (connectionId === excludeConnectionId) continue;

      const client = this.clients.get(connectionId);
      if (client && client.authenticated) {
        this.sendMessage(client, message);
      }
    }
  }

  /**
   * Broadcast presence update
   */
  private broadcastPresence(client: AuthenticatedClient, status: 'online' | 'offline' | 'away'): void {
    const presenceMessage: WSPresenceMessage = {
      type: 'presence',
      id: this.generateId(),
      timestamp: Date.now(),
      clientId: client.clientId,
      status,
    };

    for (const room of client.rooms) {
      this.broadcastToRoom(room, presenceMessage, client.id);
    }
  }

  /**
   * Ping all clients
   */
  private pingClients(): void {
    const pingMessage: WSMessage = {
      type: 'ping',
      id: this.generateId(),
      timestamp: Date.now(),
    };

    for (const client of this.clients.values()) {
      if (client.authenticated) {
        this.sendMessage(client, pingMessage);
      }
    }
  }

  /**
   * Clean up stale clients
   */
  private cleanupStaleClients(): void {
    const timeout = this.config.connectionTimeout!;
    const now = Date.now();

    for (const [connectionId, client] of this.clients.entries()) {
      if (now - client.lastActivity > timeout) {
        this.disconnectClient(connectionId, 1000, 'Connection timeout');
      }
    }
  }

  /**
   * Request sync from a specific client
   */
  async requestSync(
    fromClientId: string,
    toClientId: string,
    sinceVectorClock?: VectorClock,
    timeoutMs: number = 30000
  ): Promise<SyncBatch> {
    const fromConnectionId = this.clientIdToConnectionId.get(fromClientId);
    if (!fromConnectionId) {
      throw new Error(`Client ${fromClientId} not connected`);
    }

    const fromClient = this.clients.get(fromConnectionId);
    if (!fromClient || !fromClient.authenticated) {
      throw new Error(`Client ${fromClientId} not authenticated`);
    }

    const requestId = this.generateId();

    const message: WSSyncRequestMessage = {
      type: 'sync_request',
      id: requestId,
      timestamp: Date.now(),
      targetClientId: toClientId,
      sinceVectorClock: sinceVectorClock?.toObject(),
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingSyncRequests.delete(requestId);
        reject(new Error('Sync request timed out'));
      }, timeoutMs);

      this.pendingSyncRequests.set(requestId, { resolve, reject, timeout });
      this.sendMessage(fromClient, message);
    });
  }

  /**
   * Get connected clients
   */
  getConnectedClients(): AuthenticatedClient[] {
    return Array.from(this.clients.values()).filter(c => c.authenticated);
  }

  /**
   * Get clients in a room
   */
  getRoomMembers(room: string): AuthenticatedClient[] {
    const memberIds = this.rooms.get(room);
    if (!memberIds) return [];

    return Array.from(memberIds)
      .map(id => this.clients.get(id))
      .filter((c): c is AuthenticatedClient => c !== undefined && c.authenticated);
  }

  /**
   * Get room list
   */
  getRooms(): string[] {
    return Array.from(this.rooms.keys());
  }

  /**
   * Check if a client is connected
   */
  isClientConnected(clientId: string): boolean {
    const connectionId = this.clientIdToConnectionId.get(clientId);
    if (!connectionId) return false;

    const client = this.clients.get(connectionId);
    return client !== undefined && client.authenticated;
  }
}
