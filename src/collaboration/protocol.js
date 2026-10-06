export const MESSAGE_TYPES = Object.freeze({
  JOIN: "join",
  JOINED: "joined",
  OPERATION: "operation",
  OPERATION_APPLIED: "operation_applied",
  OPERATION_PREVIEW: "operation_preview",
  SNAPSHOT: "snapshot",
  RESYNC_REQUIRED: "resync_required",
  PRESENCE: "presence",
  CURSOR: "cursor",
  TABLE_LOCK_ACQUIRE: "table_lock_acquire",
  TABLE_LOCK_GRANTED: "table_lock_granted",
  TABLE_LOCK_DENIED: "table_lock_denied",
  TABLE_LOCK_RENEW: "table_lock_renew",
  TABLE_LOCK_RELEASE: "table_lock_release",
  TABLE_LOCK_STATE: "table_lock_state",
  ACCESS: "access",
  ERROR: "error",
  PING: "ping",
  PONG: "pong",
});

export const CONNECTION_STATE = Object.freeze({
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
});
