/* global process */
import { WebSocketServer, WebSocket } from "ws";
import { parseCookies, SESSION_COOKIE } from "./auth.js";
import {
  CLIENT_ID_PATTERN,
  DIAGRAM_ID_PATTERN,
  isValidEntityId,
  isPlainObject,
  isValidOperationPreview,
  isValidParticipant,
  MESSAGE_TYPES,
} from "./protocol.js";
import { createTableLockManager } from "./tableLocks.js";
import { canEdit, canView } from "./database.js";

const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

function originAllowed(request) {
  const origin = request.headers.origin;
  if (!origin) return true; // non-browser clients (tests, CLI tools)
  if (EXTRA_ORIGINS.includes(origin.replace(/\/$/, ""))) return true;
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  try {
    return new URL(origin).host === String(host).split(",")[0].trim();
  } catch {
    return false;
  }
}

// Close code sent when someone loses access to a diagram they have open.
export const ACCESS_REVOKED = 4403;

export function attachCollaborationServer(server, { store, auth, diagrams }) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
  });
  const rooms = new Map();
  const tableLocks = createTableLockManager();

  const broadcast = (diagramId, message, except = null) => {
    for (const client of rooms.get(diagramId) || []) {
      if (client !== except) send(client, message);
    }
  };

  const broadcastPresence = (diagramId) => {
    const participants = [...(rooms.get(diagramId) || [])]
      .map((client) => client.participant)
      .filter(Boolean);
    broadcast(diagramId, {
      type: MESSAGE_TYPES.PRESENCE,
      diagramId,
      participants,
    });
  };

  const broadcastTableLocks = (diagramId) => {
    broadcast(diagramId, {
      type: MESSAGE_TYPES.TABLE_LOCK_STATE,
      diagramId,
      locks: tableLocks.list(diagramId),
    });
  };

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, "http://localhost");
    const match = url.pathname.match(/^\/ws\/diagrams\/([^/]+)$/);
    const diagramId = match?.[1];
    if (!diagramId || !DIAGRAM_ID_PATTERN.test(diagramId)) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    // Browsers always send Origin on WebSocket handshakes. Rejecting foreign
    // origins stops another site from riding the user's session cookie.
    if (!originAllowed(request)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    const session = auth.resolveSession(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (!session) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const diagram = store.get(diagramId);
    if (!diagram) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    const role = store.roleFor(diagram, session.user);
    if (!canView(role)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.diagramId = diagramId;
      ws.user = session.user;
      ws.role = role;
      ws.ip = request.socket.remoteAddress;
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (socket) => {
    const diagramId = socket.diagramId;
    if (!rooms.has(diagramId)) rooms.set(diagramId, new Set());
    rooms.get(diagramId).add(socket);
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        send(socket, {
          type: MESSAGE_TYPES.ERROR,
          message: "Invalid JSON message",
        });
        return;
      }
      if (!isPlainObject(message) || message.diagramId !== diagramId) {
        send(socket, {
          type: MESSAGE_TYPES.ERROR,
          message: "Invalid diagram message",
        });
        return;
      }

      if (message.type === MESSAGE_TYPES.JOIN) {
        if (!isValidParticipant(message.participant)) {
          send(socket, {
            type: MESSAGE_TYPES.ERROR,
            message: "Invalid participant",
          });
          return;
        }
        // The signed-in account, not the client, decides the shown identity.
        socket.participant = {
          ...message.participant,
          userId: socket.user.id,
          displayName: socket.user.username,
        };
        const diagram = store.get(diagramId);
        send(socket, {
          type: MESSAGE_TYPES.JOINED,
          diagramId,
          version: diagram.version,
          role: socket.role,
        });
        if (message.lastVersion !== diagram.version) {
          send(socket, { type: MESSAGE_TYPES.SNAPSHOT, diagramId, ...diagram });
        }
        send(socket, {
          type: MESSAGE_TYPES.TABLE_LOCK_STATE,
          diagramId,
          locks: tableLocks.list(diagramId),
        });
        broadcastPresence(diagramId);
        return;
      }

      if (!socket.participant) {
        send(socket, {
          type: MESSAGE_TYPES.ERROR,
          message: "Join is required",
        });
        return;
      }

      // Viewers follow along (presence, cursors) but cannot change anything.
      const changes = [
        MESSAGE_TYPES.OPERATION,
        MESSAGE_TYPES.OPERATION_PREVIEW,
        MESSAGE_TYPES.TABLE_LOCK_ACQUIRE,
        MESSAGE_TYPES.TABLE_LOCK_RENEW,
      ];
      if (changes.includes(message.type) && !canEdit(socket.role)) {
        send(socket, {
          type: MESSAGE_TYPES.ERROR,
          code: "read_only",
          // Echoed so the client can settle the request it is waiting on.
          ...(CLIENT_ID_PATTERN.test(message.operationId || "") && {
            operationId: message.operationId,
          }),
          ...(CLIENT_ID_PATTERN.test(message.requestId || "") && {
            requestId: message.requestId,
          }),
          message: "You can only view this diagram",
        });
        return;
      }

      if (message.type === MESSAGE_TYPES.OPERATION) {
        const valid =
          CLIENT_ID_PATTERN.test(message.clientId || "") &&
          message.clientId === socket.participant.clientId &&
          CLIENT_ID_PATTERN.test(message.operationId || "") &&
          Number.isInteger(message.baseVersion) &&
          isPlainObject(message.operation) &&
          message.operation.type === "snapshot.replace" &&
          isPlainObject(message.operation.payload?.document);
        if (!valid) {
          send(socket, {
            type: MESSAGE_TYPES.ERROR,
            message: "Invalid operation",
          });
          return;
        }
        const result = diagrams.update({
          id: diagramId,
          name: message.operation.payload.name,
          document: message.operation.payload.document,
          baseVersion: message.baseVersion,
          operationId: message.operationId,
          user: socket.user,
          ip: socket.ip,
        });
        if (result.status === "invalid") {
          send(socket, {
            type: MESSAGE_TYPES.ERROR,
            code: "invalid_document",
            operationId: message.operationId,
            message: `Invalid diagram: ${result.error}`,
          });
          return;
        }
        if (result.status === "not_found") {
          socket.close(ACCESS_REVOKED, "Diagram deleted");
          return;
        }
        if (result.status === "conflict") {
          send(socket, {
            type: MESSAGE_TYPES.RESYNC_REQUIRED,
            diagramId,
            ...result.diagram,
          });
          return;
        }
        const applied = {
          type: MESSAGE_TYPES.OPERATION_APPLIED,
          diagramId,
          clientId: message.clientId,
          operationId: message.operationId,
          version: result.diagram.version,
          operation: {
            type: "snapshot.replace",
            payload: {
              name: result.diagram.name,
              document: result.diagram.document,
            },
          },
        };
        broadcast(diagramId, applied);
        return;
      }

      if (message.type === MESSAGE_TYPES.OPERATION_PREVIEW) {
        if (!isValidOperationPreview(message.operation)) {
          send(socket, {
            type: MESSAGE_TYPES.ERROR,
            message: "Invalid operation preview",
          });
          return;
        }
        if (
          !tableLocks.owns(
            diagramId,
            message.operation.payload.tableId ?? message.operation.payload.id,
            socket.participant.clientId,
          )
        ) {
          send(socket, {
            type: MESSAGE_TYPES.ERROR,
            message: "A table edit lock is required",
          });
          return;
        }
        broadcast(
          diagramId,
          {
            type: MESSAGE_TYPES.OPERATION_PREVIEW,
            diagramId,
            clientId: socket.participant.clientId,
            operation: message.operation,
          },
          socket,
        );
        return;
      }

      if (message.type === MESSAGE_TYPES.TABLE_LOCK_ACQUIRE) {
        if (
          !isValidEntityId(message.tableId) ||
          !CLIENT_ID_PATTERN.test(message.requestId || "")
        ) {
          send(socket, {
            type: MESSAGE_TYPES.ERROR,
            message: "Invalid table lock request",
          });
          return;
        }
        const result = tableLocks.acquire(
          diagramId,
          message.tableId,
          socket.participant,
        );
        send(socket, {
          type: result.granted
            ? MESSAGE_TYPES.TABLE_LOCK_GRANTED
            : MESSAGE_TYPES.TABLE_LOCK_DENIED,
          diagramId,
          requestId: message.requestId,
          lock: result.lock,
        });
        if (result.granted) broadcastTableLocks(diagramId);
        return;
      }

      if (message.type === MESSAGE_TYPES.TABLE_LOCK_RENEW) {
        if (
          isValidEntityId(message.tableId) &&
          Number.isInteger(message.token) &&
          tableLocks.renew(
            diagramId,
            message.tableId,
            socket.participant.clientId,
            message.token,
          )
        ) {
          broadcastTableLocks(diagramId);
        }
        return;
      }

      if (message.type === MESSAGE_TYPES.TABLE_LOCK_RELEASE) {
        if (
          isValidEntityId(message.tableId) &&
          Number.isInteger(message.token) &&
          tableLocks.release(
            diagramId,
            message.tableId,
            socket.participant.clientId,
            message.token,
          )
        ) {
          broadcastTableLocks(diagramId);
        }
        return;
      }

      if (message.type === MESSAGE_TYPES.CURSOR) {
        const { x, y, selected } = message;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        broadcast(
          diagramId,
          {
            type: MESSAGE_TYPES.CURSOR,
            diagramId,
            clientId: socket.participant.clientId,
            x,
            y,
            selected: typeof selected === "string" ? selected : null,
          },
          socket,
        );
        return;
      }

      if (message.type === MESSAGE_TYPES.PING) {
        send(socket, { type: MESSAGE_TYPES.PONG, diagramId });
        return;
      }
      send(socket, {
        type: MESSAGE_TYPES.ERROR,
        message: "Unsupported message type",
      });
    });

    socket.on("close", () => {
      const room = rooms.get(diagramId);
      room?.delete(socket);
      const releasedLocks = socket.participant
        ? tableLocks.releaseClient(diagramId, socket.participant.clientId)
        : false;
      if (room?.size === 0) rooms.delete(diagramId);
      else {
        broadcastPresence(diagramId);
        if (releasedLocks) broadcastTableLocks(diagramId);
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30_000);
  heartbeat.unref();
  const lockSweep = setInterval(() => {
    for (const diagramId of tableLocks.sweep()) {
      broadcastTableLocks(diagramId);
    }
  }, 2_000);
  lockSweep.unref();
  wss.on("close", () => clearInterval(heartbeat));
  wss.on("close", () => clearInterval(lockSweep));

  // A snapshot written outside the socket layer — a git pull, for instance —
  // still has to reach everyone who has the diagram open.
  wss.broadcastSnapshot = (diagramId, diagram) => {
    broadcast(diagramId, {
      type: MESSAGE_TYPES.SNAPSHOT,
      diagramId,
      ...diagram,
    });
  };
  diagrams.setBroadcaster(wss.broadcastSnapshot);

  /**
   * After sharing settings change (or the diagram is deleted), everyone with
   * it open gets their new role; those left without access are disconnected.
   */
  wss.refreshAccess = (diagramId) => {
    const diagram = store.get(diagramId);
    let locksChanged = false;
    for (const socket of [...(rooms.get(diagramId) ?? [])]) {
      const role = diagram ? store.roleFor(diagram, socket.user) : "none";
      if (!canView(role)) {
        send(socket, { type: MESSAGE_TYPES.ACCESS, diagramId, role: "none" });
        socket.close(ACCESS_REVOKED, "Access revoked");
        continue;
      }
      if (role === socket.role) continue;
      socket.role = role;
      if (!canEdit(role) && socket.participant) {
        locksChanged =
          tableLocks.releaseClient(diagramId, socket.participant.clientId) ||
          locksChanged;
      }
      send(socket, { type: MESSAGE_TYPES.ACCESS, diagramId, role });
    }
    if (locksChanged) broadcastTableLocks(diagramId);
  };

  /** Disconnects every socket of an account (disabled, deleted, new password). */
  wss.closeUser = (userId) => {
    for (const socket of wss.clients) {
      if (socket.user?.id === userId) {
        socket.close(ACCESS_REVOKED, "Signed out");
      }
    }
  };
  return wss;
}
