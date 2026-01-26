/**
 * WebSocket module exports
 */

export {
  WebSocketSyncServer,
  type WSMessageType,
  type WSMessage,
  type WSAuthMessage,
  type WSAuthResponse,
  type WSJoinRoomMessage,
  type WSLeaveRoomMessage,
  type WSSyncEventMessage,
  type WSSyncBatchMessage,
  type WSSyncRequestMessage,
  type WSSyncResponseMessage,
  type WSPresenceMessage,
  type WSErrorMessage,
  type AuthenticatedClient,
  type WebSocketLike,
  type SyncServerConfig,
} from './SyncServer.js';
