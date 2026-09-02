import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { createDiagramStore, openDatabase } from "./database.js";
import { createApplication } from "./index.js";
import { isValidOperationPreview } from "./protocol.js";
import { createTableLockManager } from "./tableLocks.js";

function waitForMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, 2_000);
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function openSocket(url, cookie) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      url,
      cookie ? { headers: { Cookie: cookie } } : undefined,
    );
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function listen(application) {
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  return application.server.address().port;
}

function sessionCookieFrom(response) {
  const header = response.headers.get("set-cookie");
  assert.ok(header, "expected a session cookie");
  return header.split(";")[0];
}

const PASSWORD = "correct-horse-9";
const JSON_HEADERS = { "Content-Type": "application/json" };

async function registerAdmin(port, username, password = PASSWORD) {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 201);
  return sessionCookieFrom(response);
}

/**
 * Registration closes after the first account, so every later user is created
 * by the administrator and then signs in to get their own session cookie.
 */
async function createUsers(port, usernames) {
  const base = `http://127.0.0.1:${port}`;
  const [first, ...rest] = usernames;
  const cookies = { [first]: await registerAdmin(port, first) };
  for (const username of rest) {
    const created = await fetch(`${base}/api/admin/users`, {
      method: "POST",
      headers: { ...JSON_HEADERS, Cookie: cookies[first] },
      body: JSON.stringify({ username, password: PASSWORD }),
    });
    assert.equal(created.status, 201);
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ username, password: PASSWORD }),
    });
    assert.equal(login.status, 200);
    cookies[username] = sessionCookieFrom(login);
  }
  return cookies;
}

test("diagram persistence enforces optimistic versions and operation IDs", () => {
  const database = openDatabase(":memory:");
  const store = createDiagramStore(database);

  const created = store.create({
    id: "diagram-1",
    name: "One",
    document: { tables: [] },
  });
  assert.equal(created.version, 1);

  const updated = store.updateSnapshot({
    id: "diagram-1",
    name: "Updated",
    document: { tables: [{ id: "table-1" }] },
    baseVersion: 1,
    operationId: "operation-1",
  });
  assert.equal(updated.status, "updated");
  assert.equal(updated.diagram.version, 2);

  const duplicate = store.updateSnapshot({
    id: "diagram-1",
    name: "Duplicate",
    document: {},
    baseVersion: 1,
    operationId: "operation-1",
  });
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.diagram.name, "Updated");

  const conflict = store.updateSnapshot({
    id: "diagram-1",
    name: "Stale",
    document: {},
    baseVersion: 1,
    operationId: "operation-2",
  });
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.diagram.version, 2);
  database.close();
});

test("validates ephemeral table movement previews", () => {
  assert.equal(
    isValidOperationPreview({
      type: "table.move",
      payload: { id: 0, x: 10, y: 20 },
    }),
    true,
  );
  assert.equal(
    isValidOperationPreview({
      type: "table.move",
      payload: { id: "table-1", x: 120.5, y: -40 },
    }),
    true,
  );
  assert.equal(
    isValidOperationPreview({
      type: "table.move",
      payload: { id: "../table", x: 1, y: 2 },
    }),
    false,
  );
  assert.equal(
    isValidOperationPreview({
      type: "table.move",
      payload: { id: "table-1", x: Number.NaN, y: 2 },
    }),
    false,
  );
});

test("table edit leases are exclusive and expire", () => {
  let currentTime = 1_000;
  const locks = createTableLockManager({
    leaseMs: 100,
    now: () => currentTime,
  });
  const participantA = {
    clientId: "client-a",
    displayName: "A",
    color: "#000",
  };
  const participantB = {
    clientId: "client-b",
    displayName: "B",
    color: "#fff",
  };

  const acquired = locks.acquire("diagram-1", "table-1", participantA);
  assert.equal(acquired.granted, true);
  assert.equal(locks.owns("diagram-1", "table-1", "client-a"), true);

  const denied = locks.acquire("diagram-1", "table-1", participantB);
  assert.equal(denied.granted, false);
  assert.equal(denied.lock.clientId, "client-a");

  currentTime += 101;
  const acquiredAfterExpiry = locks.acquire(
    "diagram-1",
    "table-1",
    participantB,
  );
  assert.equal(acquiredAfterExpiry.granted, true);
  assert.notEqual(acquiredAfterExpiry.lock.token, acquired.lock.token);
});

test("WebSocket table locks reject concurrent edits", async (t) => {
  const application = createApplication({ databasePath: ":memory:" });
  application.store.create({
    id: "diagram-lock-test",
    name: "Lock test",
    document: { tables: [{ id: 0, x: 0, y: 0 }] },
  });
  const port = await listen(application);
  const url = `ws://127.0.0.1:${port}/ws/diagrams/diagram-lock-test`;
  const cookies = await createUsers(port, ["client-a", "client-b"]);
  const clientA = await openSocket(url, cookies["client-a"]);
  const clientB = await openSocket(url, cookies["client-b"]);
  t.after(() => {
    clientA.close();
    clientB.close();
    application.websocket.close();
    application.server.close();
    application.database.close();
  });

  const join = async (socket, clientId) => {
    const joined = waitForMessage(
      socket,
      (message) => message.type === "joined",
    );
    socket.send(
      JSON.stringify({
        type: "join",
        diagramId: "diagram-lock-test",
        lastVersion: 1,
        participant: { clientId, displayName: clientId, color: "#000" },
      }),
    );
    await joined;
  };
  await join(clientA, "client-a");
  await join(clientB, "client-b");

  const grantedA = waitForMessage(
    clientA,
    (message) => message.type === "table_lock_granted",
  );
  const releasedState = waitForMessage(
    clientB,
    (message) =>
      message.type === "table_lock_state" && message.locks.length === 0,
  );
  clientA.send(
    JSON.stringify({
      type: "table_lock_acquire",
      diagramId: "diagram-lock-test",
      tableId: 0,
      requestId: "request-a",
    }),
  );
  const lockA = (await grantedA).lock;

  const deniedB = waitForMessage(
    clientB,
    (message) => message.type === "table_lock_denied",
  );
  clientB.send(
    JSON.stringify({
      type: "table_lock_acquire",
      diagramId: "diagram-lock-test",
      tableId: 0,
      requestId: "request-b",
    }),
  );
  assert.equal((await deniedB).lock.clientId, "client-a");

  const previewRejected = waitForMessage(
    clientB,
    (message) =>
      message.type === "error" &&
      message.message === "A table edit lock is required",
  );
  clientB.send(
    JSON.stringify({
      type: "operation_preview",
      diagramId: "diagram-lock-test",
      operation: {
        type: "table.move",
        payload: { id: 0, x: 10, y: 20 },
      },
    }),
  );
  await previewRejected;

  clientA.send(
    JSON.stringify({
      type: "table_lock_release",
      diagramId: "diagram-lock-test",
      tableId: 0,
      token: lockA.token,
    }),
  );
  await releasedState;
  const grantedB = waitForMessage(
    clientB,
    (message) => message.type === "table_lock_granted",
  );
  clientB.send(
    JSON.stringify({
      type: "table_lock_acquire",
      diagramId: "diagram-lock-test",
      tableId: 0,
      requestId: "request-b-after-release",
    }),
  );
  assert.equal((await grantedB).lock.clientId, "client-b");
});

test("diagram endpoints reject unauthenticated callers", async (t) => {
  const application = createApplication({ databasePath: ":memory:" });
  application.store.create({
    id: "diagram-auth-test",
    name: "Auth test",
    document: { tables: [] },
  });
  const port = await listen(application);
  t.after(() => {
    application.websocket.close();
    application.server.close();
    application.database.close();
  });
  const base = `http://127.0.0.1:${port}`;

  for (const path of ["/api/diagrams", "/api/diagrams/diagram-auth-test"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 401);
  }

  await assert.rejects(
    openSocket(`ws://127.0.0.1:${port}/ws/diagrams/diagram-auth-test`),
    /401/,
  );

  const cookie = await registerAdmin(port, "reader");
  const authorized = await fetch(`${base}/api/diagrams`, {
    headers: { Cookie: cookie },
  });
  assert.equal(authorized.status, 200);
});

test("registration, login and logout manage the session cookie", async (t) => {
  const application = createApplication({ databasePath: ":memory:" });
  const port = await listen(application);
  t.after(() => {
    application.websocket.close();
    application.server.close();
    application.database.close();
  });
  const base = `http://127.0.0.1:${port}`;
  const json = { "Content-Type": "application/json" };

  const short = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ username: "bob", password: "short" }),
  });
  assert.equal(short.status, 400);

  const cookie = await registerAdmin(port, "alice", "long-enough-secret");

  const duplicate = await fetch(`${base}/api/admin/users`, {
    method: "POST",
    headers: { ...json, Cookie: cookie },
    body: JSON.stringify({ username: "ALICE", password: "long-enough-secret" }),
  });
  assert.equal(duplicate.status, 409);

  const me = await fetch(`${base}/api/auth/me`, {
    headers: { Cookie: cookie },
  });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.username, "alice");

  const wrongPassword = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ username: "alice", password: "wrong-password-1" }),
  });
  assert.equal(wrongPassword.status, 401);

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ username: "alice", password: "long-enough-secret" }),
  });
  assert.equal(login.status, 200);
  const secondCookie = sessionCookieFrom(login);

  const logout = await fetch(`${base}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: secondCookie },
  });
  assert.equal(logout.status, 204);

  const afterLogout = await fetch(`${base}/api/auth/me`, {
    headers: { Cookie: secondCookie },
  });
  assert.equal(afterLogout.status, 401);

  // Logging out one session must not invalidate the other.
  const stillValid = await fetch(`${base}/api/auth/me`, {
    headers: { Cookie: cookie },
  });
  assert.equal(stillValid.status, 200);
});

test("diagram listing is scoped to the owner and only owners delete", async (t) => {
  const application = createApplication({ databasePath: ":memory:" });
  const port = await listen(application);
  t.after(() => {
    application.websocket.close();
    application.server.close();
    application.database.close();
  });
  const base = `http://127.0.0.1:${port}`;
  const cookies = await createUsers(port, ["owner", "other"]);
  const ownerCookie = cookies.owner;
  const otherCookie = cookies.other;

  // Predates authentication: no owner, so it stays visible to everyone.
  application.store.create({
    id: "legacy-diagram",
    name: "Legacy",
    document: { tables: [] },
  });

  const created = await fetch(`${base}/api/diagrams`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({
      id: "owned-diagram",
      name: "Owned",
      document: { tables: [] },
    }),
  });
  assert.equal(created.status, 201);

  const listFor = async (cookie) => {
    const response = await fetch(`${base}/api/diagrams`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    return (await response.json()).diagrams.map((diagram) => diagram.id).sort();
  };
  assert.deepEqual(await listFor(ownerCookie), [
    "legacy-diagram",
    "owned-diagram",
  ]);
  assert.deepEqual(await listFor(otherCookie), ["legacy-diagram"]);

  // Link sharing: a non-owner can still open and edit the diagram.
  const read = await fetch(`${base}/api/diagrams/owned-diagram`, {
    headers: { Cookie: otherCookie },
  });
  assert.equal(read.status, 200);
  const edit = await fetch(`${base}/api/diagrams/owned-diagram`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: otherCookie },
    body: JSON.stringify({
      name: "Edited by other",
      document: { tables: [] },
      baseVersion: 1,
    }),
  });
  assert.equal(edit.status, 200);

  const forbidden = await fetch(`${base}/api/diagrams/owned-diagram`, {
    method: "DELETE",
    headers: { Cookie: otherCookie },
  });
  assert.equal(forbidden.status, 403);

  const deleted = await fetch(`${base}/api/diagrams/owned-diagram`, {
    method: "DELETE",
    headers: { Cookie: ownerCookie },
  });
  assert.equal(deleted.status, 204);
});

test("registration closes after the first account claims the instance", async (t) => {
  const application = createApplication({ databasePath: ":memory:" });
  const port = await listen(application);
  t.after(() => {
    application.websocket.close();
    application.server.close();
    application.database.close();
  });
  const base = `http://127.0.0.1:${port}`;

  const before = await fetch(`${base}/api/auth/status`);
  assert.deepEqual(await before.json(), { setupRequired: true });

  const adminCookie = await registerAdmin(port, "root");

  const after = await fetch(`${base}/api/auth/status`);
  assert.deepEqual(await after.json(), { setupRequired: false });

  const second = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ username: "intruder", password: PASSWORD }),
  });
  assert.equal(second.status, 403);

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ username: "intruder", password: PASSWORD }),
  });
  assert.equal(login.status, 401);

  const me = await fetch(`${base}/api/auth/me`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal((await me.json()).user.isAdmin, true);
});

test("only the administrator can create accounts", async (t) => {
  const application = createApplication({ databasePath: ":memory:" });
  const port = await listen(application);
  t.after(() => {
    application.websocket.close();
    application.server.close();
    application.database.close();
  });
  const base = `http://127.0.0.1:${port}`;
  const cookies = await createUsers(port, ["root", "member"]);

  const listed = await fetch(`${base}/api/admin/users`, {
    headers: { Cookie: cookies.root },
  });
  assert.equal(listed.status, 200);
  const { users } = await listed.json();
  assert.deepEqual(
    users.map((user) => [user.username, user.isAdmin]),
    [
      ["root", true],
      ["member", false],
    ],
  );

  for (const method of ["GET", "POST"]) {
    const response = await fetch(`${base}/api/admin/users`, {
      method,
      headers: { ...JSON_HEADERS, Cookie: cookies.member },
      body:
        method === "POST"
          ? JSON.stringify({ username: "sneaky", password: PASSWORD })
          : undefined,
    });
    assert.equal(response.status, 403);
  }

  const anonymous = await fetch(`${base}/api/admin/users`);
  assert.equal(anonymous.status, 401);

  // Administrator status is not handed out through this endpoint.
  const escalation = await fetch(`${base}/api/admin/users`, {
    method: "POST",
    headers: { ...JSON_HEADERS, Cookie: cookies.root },
    body: JSON.stringify({
      username: "wannabe",
      password: PASSWORD,
      isAdmin: true,
    }),
  });
  assert.equal(escalation.status, 201);
  assert.equal((await escalation.json()).user.isAdmin, false);
});
