import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { nanoid } from "nanoid";
import { CONNECTION_STATE, MESSAGE_TYPES } from "../collaboration/protocol";
// Imported directly rather than through ../hooks, which re-exports useCollab
// and would make this module circular.
import useAuth from "../hooks/useAuth";

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c"];

// The tab keeps a stable client ID and color; the display name always comes
// from the signed-in account, and the server enforces that on join.
function getLocalIdentity() {
  const stored = sessionStorage.getItem("drawdb-collaboration-identity");
  if (stored) {
    try {
      const identity = JSON.parse(stored);
      if (identity?.clientId && identity?.color) return identity;
    } catch {
      // Fall through and mint a fresh identity.
    }
    sessionStorage.removeItem("drawdb-collaboration-identity");
  }
  const identity = {
    clientId: nanoid(),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
  sessionStorage.setItem(
    "drawdb-collaboration-identity",
    JSON.stringify(identity),
  );
  return identity;
}

// Close code the server uses when this account loses access to the diagram.
const ACCESS_REVOKED = 4403;

export const CollabContext = createContext(null);

export default function CollabContextProvider({ children }) {
  const { user } = useAuth();
  const identityRef = useRef({
    ...getLocalIdentity(),
    displayName: user?.username ?? "Guest",
  });
  const [identity, setIdentity] = useState(identityRef.current);
  const socketRef = useRef(null);
  const reconnectRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const sessionRef = useRef(null);
  const pendingRef = useRef(new Map());
  const versionRef = useRef(0);
  const isApplyingRemoteRef = useRef(false);
  const cursorSentAtRef = useRef(0);
  const previewThrottleRef = useRef(new Map());
  const pendingLocksRef = useRef(new Map());
  const pendingLocksByTableRef = useRef(new Map());
  const heldLocksRef = useRef(new Map());
  const retainedLocksRef = useRef(new Map());
  const [connectionState, setConnectionState] = useState(
    CONNECTION_STATE.DISCONNECTED,
  );
  const [participants, setParticipants] = useState([]);
  const [remoteCursors, setRemoteCursors] = useState({});
  const [tableLocks, setTableLocks] = useState({});

  const handleMessage = useCallback((event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === MESSAGE_TYPES.JOINED) {
      versionRef.current = message.version;
      setConnectionState(CONNECTION_STATE.CONNECTED);
      reconnectAttemptsRef.current = 0;
      if (message.role) sessionRef.current?.onAccess?.(message.role);
      return;
    }
    if (message.type === MESSAGE_TYPES.ACCESS) {
      sessionRef.current?.onAccess?.(message.role);
      return;
    }
    if (message.type === MESSAGE_TYPES.ERROR) {
      const pending = pendingRef.current.get(message.operationId);
      if (pending) {
        pendingRef.current.delete(message.operationId);
        pending.reject(
          Object.assign(new Error(message.message), { code: message.code }),
        );
      }
      const lock = pendingLocksRef.current.get(message.requestId);
      if (lock) {
        pendingLocksRef.current.delete(message.requestId);
        pendingLocksByTableRef.current.delete(lock.tableId);
        lock.resolve(false);
      }
      return;
    }
    if (
      message.type === MESSAGE_TYPES.SNAPSHOT ||
      message.type === MESSAGE_TYPES.RESYNC_REQUIRED
    ) {
      versionRef.current = message.version;
      sessionRef.current?.onSnapshot?.(message);
      if (message.type === MESSAGE_TYPES.RESYNC_REQUIRED) {
        for (const pending of pendingRef.current.values())
          pending.reject(message);
        pendingRef.current.clear();
      }
      return;
    }
    if (message.type === MESSAGE_TYPES.OPERATION_APPLIED) {
      versionRef.current = message.version;
      const pending = pendingRef.current.get(message.operationId);
      if (pending) {
        pending.resolve(message);
        pendingRef.current.delete(message.operationId);
      } else if (message.clientId !== identityRef.current.clientId) {
        sessionRef.current?.onSnapshot?.({
          ...message.operation.payload,
          version: message.version,
        });
      }
      return;
    }
    if (message.type === MESSAGE_TYPES.PRESENCE) {
      setParticipants(message.participants || []);
      return;
    }
    if (message.type === MESSAGE_TYPES.TABLE_LOCK_STATE) {
      const nextLocks = Object.fromEntries(
        (message.locks || []).map((lock) => [lock.tableId, lock]),
      );
      setTableLocks(nextLocks);
      for (const [tableId, held] of heldLocksRef.current) {
        const current = nextLocks[tableId];
        if (
          !current ||
          current.clientId !== identityRef.current.clientId ||
          current.token !== held.token
        ) {
          heldLocksRef.current.delete(tableId);
        }
      }
      return;
    }
    if (
      message.type === MESSAGE_TYPES.TABLE_LOCK_GRANTED ||
      message.type === MESSAGE_TYPES.TABLE_LOCK_DENIED
    ) {
      const pending = pendingLocksRef.current.get(message.requestId);
      if (!pending) return;
      pendingLocksRef.current.delete(message.requestId);
      pendingLocksByTableRef.current.delete(pending.tableId);
      if (message.type === MESSAGE_TYPES.TABLE_LOCK_GRANTED) {
        heldLocksRef.current.set(pending.tableId, message.lock);
        pending.resolve(true);
      } else {
        pending.resolve(false);
      }
      return;
    }
    if (
      message.type === MESSAGE_TYPES.OPERATION_PREVIEW &&
      message.clientId !== identityRef.current.clientId
    ) {
      sessionRef.current?.onDelta?.(message.operation);
      return;
    }
    if (message.type === MESSAGE_TYPES.CURSOR) {
      setRemoteCursors((current) => ({
        ...current,
        [message.clientId]: {
          x: message.x,
          y: message.y,
          selected: message.selected,
        },
      }));
    }
  }, []);

  const openSocket = useCallback(
    (session) => {
      if (!session || socketRef.current?.readyState === WebSocket.OPEN) return;
      setConnectionState(CONNECTION_STATE.CONNECTING);
      const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(
        `${scheme}//${window.location.host}/ws/diagrams/${encodeURIComponent(session.diagramId)}`,
      );
      socketRef.current = socket;
      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: MESSAGE_TYPES.JOIN,
            diagramId: session.diagramId,
            participant: identityRef.current,
            lastVersion: versionRef.current,
          }),
        );
      };
      socket.onmessage = handleMessage;
      socket.onclose = (event) => {
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        for (const pending of pendingRef.current.values()) {
          pending.reject(new Error("Collaboration connection closed"));
        }
        pendingRef.current.clear();
        if (event.code === ACCESS_REVOKED) {
          // Signed out, account disabled, diagram deleted or unshared:
          // reconnecting would only be refused again.
          setConnectionState(CONNECTION_STATE.DISCONNECTED);
          setParticipants([]);
          setRemoteCursors({});
          setTableLocks({});
          sessionRef.current?.onAccess?.("none");
          return;
        }
        setConnectionState(CONNECTION_STATE.CONNECTING);
        const delay = Math.min(
          1000 * 2 ** reconnectAttemptsRef.current,
          15_000,
        );
        reconnectAttemptsRef.current += 1;
        reconnectRef.current = window.setTimeout(
          () => openSocket(sessionRef.current),
          delay,
        );
      };
      socket.onerror = () => socket.close();
    },
    [handleMessage],
  );

  const connect = useCallback(
    ({ diagramId, version, onSnapshot, onDelta, onAccess }) => {
      if (sessionRef.current?.diagramId === diagramId) {
        sessionRef.current.onSnapshot = onSnapshot;
        sessionRef.current.onDelta = onDelta;
        sessionRef.current.onAccess = onAccess;
        versionRef.current = version;
        if (!socketRef.current) {
          // The server closed the previous connection (for instance when
          // access was revoked and then granted again): open a new one.
          window.clearTimeout(reconnectRef.current);
          openSocket(sessionRef.current);
        }
        return;
      }
      window.clearTimeout(reconnectRef.current);
      socketRef.current?.close();
      sessionRef.current = { diagramId, onSnapshot, onDelta, onAccess };
      versionRef.current = version;
      setRemoteCursors({});
      setTableLocks({});
      openSocket(sessionRef.current);
    },
    [openSocket],
  );

  const disconnect = useCallback(() => {
    sessionRef.current = null;
    window.clearTimeout(reconnectRef.current);
    const socket = socketRef.current;
    socketRef.current = null;
    socket?.close();
    setConnectionState(CONNECTION_STATE.DISCONNECTED);
    setParticipants([]);
    setRemoteCursors({});
    setTableLocks({});
    for (const preview of previewThrottleRef.current.values()) {
      window.clearTimeout(preview.timer);
    }
    previewThrottleRef.current.clear();
    for (const pending of pendingLocksRef.current.values()) {
      pending.resolve(false);
    }
    pendingLocksRef.current.clear();
    pendingLocksByTableRef.current.clear();
    heldLocksRef.current.clear();
    retainedLocksRef.current.clear();
  }, []);

  const sendSnapshot = useCallback((name, document) => {
    const socket = socketRef.current;
    const session = sessionRef.current;
    if (!session || socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new Error("Collaboration connection is unavailable"),
      );
    }
    const operationId = nanoid();
    return new Promise((resolve, reject) => {
      pendingRef.current.set(operationId, { resolve, reject });
      socket.send(
        JSON.stringify({
          type: MESSAGE_TYPES.OPERATION,
          diagramId: session.diagramId,
          clientId: identityRef.current.clientId,
          operationId,
          baseVersion: versionRef.current,
          operation: { type: "snapshot.replace", payload: { name, document } },
        }),
      );
      window.setTimeout(() => {
        if (!pendingRef.current.has(operationId)) return;
        pendingRef.current.delete(operationId);
        reject(new Error("Save acknowledgement timed out"));
      }, 10_000);
    });
  }, []);

  const emitAwareness = useCallback((awareness) => {
    const now = Date.now();
    if (now - cursorSentAtRef.current < 50) return;
    const socket = socketRef.current;
    const session = sessionRef.current;
    if (!session || socket?.readyState !== WebSocket.OPEN) return;
    if (!Number.isFinite(awareness.x) || !Number.isFinite(awareness.y)) return;
    cursorSentAtRef.current = now;
    socket.send(
      JSON.stringify({
        type: MESSAGE_TYPES.CURSOR,
        diagramId: session.diagramId,
        x: awareness.x,
        y: awareness.y,
        selected: awareness.selected ?? null,
      }),
    );
  }, []);

  const emitDelta = useCallback((delta) => {
    if (
      delta?.target !== "table" ||
      delta.action !== "update" ||
      delta.data?.length !== 2
    ) {
      return;
    }
    const [id, values] = delta.data;
    if (!Number.isFinite(values?.x) || !Number.isFinite(values?.y)) return;

    const sendPreview = (payload) => {
      const socket = socketRef.current;
      const session = sessionRef.current;
      if (!session || socket?.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          type: MESSAGE_TYPES.OPERATION_PREVIEW,
          diagramId: session.diagramId,
          operation: { type: "table.move", payload },
        }),
      );
    };

    const now = Date.now();
    const current = previewThrottleRef.current.get(id) ?? {
      lastSent: 0,
      timer: null,
      payload: null,
    };
    current.payload = { id, x: values.x, y: values.y };
    const remaining = 50 - (now - current.lastSent);
    if (remaining <= 0) {
      window.clearTimeout(current.timer);
      current.timer = null;
      current.lastSent = now;
      sendPreview(current.payload);
    } else if (current.timer === null) {
      current.timer = window.setTimeout(() => {
        current.timer = null;
        current.lastSent = Date.now();
        sendPreview(current.payload);
      }, remaining);
    }
    previewThrottleRef.current.set(id, current);
  }, []);

  const acquireTableLock = useCallback((tableId) => {
    if (heldLocksRef.current.has(tableId)) return Promise.resolve(true);
    const existingRequest = pendingLocksByTableRef.current.get(tableId);
    if (existingRequest) return existingRequest;

    const socket = socketRef.current;
    const session = sessionRef.current;
    if (!session || socket?.readyState !== WebSocket.OPEN) {
      return Promise.resolve(false);
    }
    const requestId = nanoid();
    const request = new Promise((resolve) => {
      pendingLocksRef.current.set(requestId, { tableId, resolve });
      socket.send(
        JSON.stringify({
          type: MESSAGE_TYPES.TABLE_LOCK_ACQUIRE,
          diagramId: session.diagramId,
          tableId,
          requestId,
        }),
      );
      window.setTimeout(() => {
        const pending = pendingLocksRef.current.get(requestId);
        if (!pending) return;
        pendingLocksRef.current.delete(requestId);
        pendingLocksByTableRef.current.delete(tableId);
        pending.resolve(false);
      }, 5_000);
    });
    pendingLocksByTableRef.current.set(tableId, request);
    return request;
  }, []);

  const acquireTableLocks = useCallback(
    async (tableIds) => {
      const acquired = [];
      for (const tableId of [...new Set(tableIds)]) {
        if (await acquireTableLock(tableId)) {
          acquired.push(tableId);
          continue;
        }
        const socket = socketRef.current;
        const session = sessionRef.current;
        for (const acquiredTableId of acquired) {
          const lock = heldLocksRef.current.get(acquiredTableId);
          if (!lock) continue;
          socket?.send(
            JSON.stringify({
              type: MESSAGE_TYPES.TABLE_LOCK_RELEASE,
              diagramId: session?.diagramId,
              tableId: acquiredTableId,
              token: lock.token,
            }),
          );
          heldLocksRef.current.delete(acquiredTableId);
        }
        return false;
      }
      return true;
    },
    [acquireTableLock],
  );

  const releaseTableLocks = useCallback((tableIds) => {
    const socket = socketRef.current;
    const session = sessionRef.current;
    if (!session || socket?.readyState !== WebSocket.OPEN) return;
    for (const tableId of [...new Set(tableIds)]) {
      if ((retainedLocksRef.current.get(tableId) ?? 0) > 0) continue;
      const lock = heldLocksRef.current.get(tableId);
      if (!lock) continue;
      socket.send(
        JSON.stringify({
          type: MESSAGE_TYPES.TABLE_LOCK_RELEASE,
          diagramId: session.diagramId,
          tableId,
          token: lock.token,
        }),
      );
      heldLocksRef.current.delete(tableId);
    }
  }, []);

  const retainTableLock = useCallback((tableId) => {
    retainedLocksRef.current.set(
      tableId,
      (retainedLocksRef.current.get(tableId) ?? 0) + 1,
    );
  }, []);

  const releaseTableLockRetention = useCallback((tableId) => {
    const count = retainedLocksRef.current.get(tableId) ?? 0;
    if (count <= 1) retainedLocksRef.current.delete(tableId);
    else retainedLocksRef.current.set(tableId, count - 1);
  }, []);

  const isTableLockedByOther = useCallback(
    (tableId) => {
      const lock = tableLocks[tableId];
      return Boolean(lock && lock.clientId !== identityRef.current.clientId);
    },
    [tableLocks],
  );

  const hasTableLock = useCallback(
    (tableId) => tableLocks[tableId]?.clientId === identityRef.current.clientId,
    [tableLocks],
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      const socket = socketRef.current;
      const session = sessionRef.current;
      if (!session || socket?.readyState !== WebSocket.OPEN) return;
      for (const [tableId, lock] of heldLocksRef.current) {
        socket.send(
          JSON.stringify({
            type: MESSAGE_TYPES.TABLE_LOCK_RENEW,
            diagramId: session.diagramId,
            tableId,
            token: lock.token,
          }),
        );
      }
    }, 4_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => disconnect, [disconnect]);

  useEffect(() => {
    const displayName = user?.username;
    if (!displayName || identityRef.current.displayName === displayName) return;
    identityRef.current = { ...identityRef.current, displayName };
    setIdentity(identityRef.current);
  }, [user]);

  const value = useMemo(
    () => ({
      connect,
      disconnect,
      sendSnapshot,
      connectionState,
      participants,
      remoteCursors,
      tableLocks,
      identity,
      versionRef,
      emitDelta,
      emitAwareness,
      acquireTableLock,
      acquireTableLocks,
      releaseTableLocks,
      retainTableLock,
      releaseTableLockRetention,
      isTableLockedByOther,
      hasTableLock,
      isApplyingRemoteRef,
    }),
    [
      connect,
      acquireTableLock,
      acquireTableLocks,
      connectionState,
      disconnect,
      emitDelta,
      emitAwareness,
      hasTableLock,
      identity,
      isTableLockedByOther,
      participants,
      remoteCursors,
      releaseTableLockRetention,
      releaseTableLocks,
      retainTableLock,
      sendSnapshot,
      tableLocks,
    ],
  );
  return (
    <CollabContext.Provider value={value}>{children}</CollabContext.Provider>
  );
}
