// End-to-end tests of the HTTP and WebSocket API: sharing and permissions,
// account management, version history, the activity log, shared custom
// types, document validation and backups.
/* global process */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { WebSocket } from "ws";
import { createApplication } from "./index.js";
import { assertValidDocument, documentProblem } from "./document.js";

const PASSWORD = "correct-horse-9";
const SETUP = "feature-setup-code";

const doc = (tables = []) => ({
  database: "postgresql",
  tables,
  references: [],
  notes: [],
  areas: [],
});
const table = (id, name, fields = []) => ({
  id,
  name,
  x: 0,
  y: 0,
  comment: "",
  indices: [],
  color: "#175e7a",
  fields,
});
const field = (id, name, type = "INTEGER") => ({
  id,
  name,
  type,
  default: "",
  check: "",
  primary: false,
  unique: false,
  notNull: false,
  increment: false,
  comment: "",
});

/** A running instance with an administrator and helpers to drive the API. */
async function startInstance(t, { env = {}, ...options } = {}) {
  const saved = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  const application = createApplication({
    databasePath: ":memory:",
    setupCode: SETUP,
    log: () => {},
    ...options,
  });
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  const port = application.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const sockets = [];
  t.after(() => {
    for (const socket of sockets) socket.terminate();
    application.websocket.close();
    application.server.close();
    application.database.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const api = async (method, url, { cookie, body } = {}) => {
    const response = await fetch(base + url, {
      method,
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(cookie && { Cookie: cookie }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (a download)
    }
    return { status: response.status, data, response, text };
  };
  const cookieOf = (response) =>
    response.headers.get("set-cookie")?.split(";")[0];

  const registered = await api("POST", "/api/auth/register", {
    body: { username: "admin", password: PASSWORD, setupCode: SETUP },
  });
  assert.equal(registered.status, 201);
  const admin = {
    cookie: cookieOf(registered.response),
    id: registered.data.user.id,
    username: "admin",
  };

  const login = async (username, password = PASSWORD) => {
    const result = await api("POST", "/api/auth/login", {
      body: { username, password },
    });
    return {
      ...result,
      cookie: cookieOf(result.response),
      id: result.data?.user?.id,
      username,
    };
  };

  const createUser = async (username) => {
    const created = await api("POST", "/api/admin/users", {
      cookie: admin.cookie,
      body: { username, password: PASSWORD },
    });
    assert.equal(created.status, 201);
    const session = await login(username);
    assert.equal(session.status, 200);
    return session;
  };

  const createDiagram = async (owner, name = "Shop", document = doc()) => {
    const created = await api("POST", "/api/diagrams", {
      cookie: owner.cookie,
      body: { name, document },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    return created.data;
  };

  const openSocket = (diagramId, cookie) =>
    new Promise((resolve, reject) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/ws/diagrams/${diagramId}`,
        { headers: { Cookie: cookie } },
      );
      socket.inbox = [];
      socket.on("message", (raw) => socket.inbox.push(JSON.parse(raw)));
      socket.once("open", () => {
        sockets.push(socket);
        resolve(socket);
      });
      socket.once("unexpected-response", (_req, res) =>
        reject(new Error(`HTTP ${res.statusCode}`)),
      );
      socket.once("error", reject);
    });

  const nextMessage = (socket, predicate, timeout = 2_000) =>
    new Promise((resolve, reject) => {
      const found = socket.inbox.find(predicate);
      if (found) {
        socket.inbox.splice(socket.inbox.indexOf(found), 1);
        resolve(found);
        return;
      }
      const timer = setTimeout(() => {
        socket.off("message", onMessage);
        reject(new Error("Timed out waiting for a WebSocket message"));
      }, timeout);
      const onMessage = (raw) => {
        const message = JSON.parse(raw);
        if (!predicate(message)) return;
        clearTimeout(timer);
        socket.off("message", onMessage);
        socket.inbox.splice(socket.inbox.indexOf(message), 1);
        resolve(message);
      };
      socket.on("message", onMessage);
    });

  const join = async (socket, diagramId, clientId) => {
    socket.send(
      JSON.stringify({
        type: "join",
        diagramId,
        lastVersion: -1,
        participant: { clientId, displayName: clientId, color: "#000" },
      }),
    );
    return nextMessage(socket, (m) => m.type === "joined");
  };

  const closed = (socket) =>
    new Promise((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) resolve(socket.closeCode);
      socket.once("close", (code) => resolve(code));
    });

  return {
    application,
    api,
    admin,
    login,
    createUser,
    createDiagram,
    openSocket,
    nextMessage,
    join,
    closed,
  };
}

// --- Sharing and permissions ---------------------------------------------------

test("new diagrams are private until shared", async (t) => {
  const { api, createUser, createDiagram, openSocket } = await startInstance(t);
  const owner = await createUser("owner");
  const other = await createUser("other");
  const diagram = await createDiagram(owner);
  assert.equal(diagram.role, "owner");
  assert.equal(diagram.linkAccess, "none");

  assert.equal(
    (await api("GET", `/api/diagrams/${diagram.id}`, { cookie: other.cookie }))
      .status,
    403,
  );
  const put = await api("PUT", `/api/diagrams/${diagram.id}`, {
    cookie: other.cookie,
    body: { name: "x", document: doc(), baseVersion: 1 },
  });
  assert.equal(put.status, 403);
  await assert.rejects(openSocket(diagram.id, other.cookie), /403/);
  const list = await api("GET", "/api/diagrams", { cookie: other.cookie });
  assert.deepEqual(list.data.diagrams, []);
});

test("viewers read and follow along but cannot change anything", async (t) => {
  const instance = await startInstance(t);
  const { api, createUser, createDiagram, openSocket, join, nextMessage } =
    instance;
  const owner = await createUser("owner");
  const viewer = await createUser("viewer");
  const diagram = await createDiagram(owner, "Shop", doc([table(1, "orders")]));
  const shared = await api(
    "PUT",
    `/api/diagrams/${diagram.id}/members/${viewer.id}`,
    { cookie: owner.cookie, body: { role: "viewer" } },
  );
  assert.equal(shared.status, 200);
  assert.deepEqual(
    shared.data.members.map((m) => [m.username, m.role]),
    [["viewer", "viewer"]],
  );

  const read = await api("GET", `/api/diagrams/${diagram.id}`, {
    cookie: viewer.cookie,
  });
  assert.equal(read.status, 200);
  assert.equal(read.data.role, "viewer");
  const listed = await api("GET", "/api/diagrams", { cookie: viewer.cookie });
  assert.deepEqual(
    listed.data.diagrams.map((d) => [d.id, d.role, d.owner_username]),
    [[diagram.id, "viewer", "owner"]],
  );
  assert.equal(
    (
      await api("PUT", `/api/diagrams/${diagram.id}`, {
        cookie: viewer.cookie,
        body: { document: doc(), baseVersion: 1 },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("DELETE", `/api/diagrams/${diagram.id}`, {
        cookie: viewer.cookie,
      })
    ).status,
    403,
  );

  const socket = await openSocket(diagram.id, viewer.cookie);
  const joined = await join(socket, diagram.id, "viewer-tab");
  assert.equal(joined.role, "viewer");
  socket.send(
    JSON.stringify({
      type: "operation",
      diagramId: diagram.id,
      clientId: "viewer-tab",
      operationId: "op1",
      baseVersion: joined.version,
      operation: {
        type: "snapshot.replace",
        payload: { name: "Hacked", document: doc() },
      },
    }),
  );
  const refused = await nextMessage(socket, (m) => m.type === "error");
  assert.equal(refused.code, "read_only");
  const after = await api("GET", `/api/diagrams/${diagram.id}`, {
    cookie: owner.cookie,
  });
  assert.equal(after.data.name, "Shop");
  assert.equal(after.data.document.tables.length, 1);
});

test("editors edit, owners manage, link access widens the circle", async (t) => {
  const { api, createUser, createDiagram } = await startInstance(t);
  const owner = await createUser("owner");
  const editor = await createUser("editor");
  const stranger = await createUser("stranger");
  const diagram = await createDiagram(owner);
  await api("PUT", `/api/diagrams/${diagram.id}/members/${editor.id}`, {
    cookie: owner.cookie,
    body: { role: "editor" },
  });

  const edited = await api("PUT", `/api/diagrams/${diagram.id}`, {
    cookie: editor.cookie,
    body: { name: "Shop v2", document: doc([table(1, "a")]), baseVersion: 1 },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.version, 2);

  // Editors cannot manage sharing, delete or configure Git.
  for (const [method, url, body] of [
    ["PUT", `/api/diagrams/${diagram.id}/access`, { linkAccess: "editor" }],
    [
      "PUT",
      `/api/diagrams/${diagram.id}/members/${stranger.id}`,
      { role: "viewer" },
    ],
    ["DELETE", `/api/diagrams/${diagram.id}`],
    [
      "PUT",
      `/api/diagrams/${diagram.id}/git`,
      { remoteUrl: "https://example.com/a.git" },
    ],
  ]) {
    const result = await api(method, url, { cookie: editor.cookie, body });
    assert.equal(result.status, 403, `${method} ${url}`);
  }

  // Anyone with the link becomes a viewer, but the diagram is not listed for them.
  await api("PUT", `/api/diagrams/${diagram.id}/access`, {
    cookie: owner.cookie,
    body: { linkAccess: "viewer" },
  });
  const viaLink = await api("GET", `/api/diagrams/${diagram.id}`, {
    cookie: stranger.cookie,
  });
  assert.equal(viaLink.data.role, "viewer");
  const strangerList = await api("GET", "/api/diagrams", {
    cookie: stranger.cookie,
  });
  assert.equal(strangerList.data.diagrams.length, 0);
  // A membership and the link access combine: the higher role wins.
  const editorView = await api("GET", `/api/diagrams/${diagram.id}`, {
    cookie: editor.cookie,
  });
  assert.equal(editorView.data.role, "editor");

  assert.equal(
    (
      await api("PUT", `/api/diagrams/${diagram.id}/access`, {
        cookie: owner.cookie,
        body: { linkAccess: "everyone" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api("PUT", `/api/diagrams/${diagram.id}/members/${owner.id}`, {
        cookie: owner.cookie,
        body: { role: "viewer" },
      })
    ).status,
    400,
  );

  // Members may leave on their own; they cannot remove others.
  assert.equal(
    (
      await api("DELETE", `/api/diagrams/${diagram.id}/members/${editor.id}`, {
        cookie: stranger.cookie,
      })
    ).status,
    403,
  );
  const left = await api(
    "DELETE",
    `/api/diagrams/${diagram.id}/members/${editor.id}`,
    { cookie: editor.cookie },
  );
  assert.equal(left.status, 200);
  assert.equal(left.data.members.length, 0);
});

test("access changes reach open sessions immediately", async (t) => {
  const instance = await startInstance(t);
  const {
    api,
    createUser,
    createDiagram,
    openSocket,
    join,
    nextMessage,
    closed,
  } = instance;
  const owner = await createUser("owner");
  const member = await createUser("member");
  const diagram = await createDiagram(owner);
  await api("PUT", `/api/diagrams/${diagram.id}/members/${member.id}`, {
    cookie: owner.cookie,
    body: { role: "editor" },
  });
  const socket = await openSocket(diagram.id, member.cookie);
  assert.equal((await join(socket, diagram.id, "member-tab")).role, "editor");

  await api("PUT", `/api/diagrams/${diagram.id}/members/${member.id}`, {
    cookie: owner.cookie,
    body: { role: "viewer" },
  });
  const downgraded = await nextMessage(socket, (m) => m.type === "access");
  assert.equal(downgraded.role, "viewer");

  const gone = closed(socket);
  await api("DELETE", `/api/diagrams/${diagram.id}/members/${member.id}`, {
    cookie: owner.cookie,
  });
  assert.equal(
    (await nextMessage(socket, (m) => m.type === "access")).role,
    "none",
  );
  assert.equal(await gone, 4403);
});

test("ownership can be handed over", async (t) => {
  const { api, createUser, createDiagram } = await startInstance(t);
  const owner = await createUser("owner");
  const heir = await createUser("heir");
  const diagram = await createDiagram(owner);
  const moved = await api("PUT", `/api/diagrams/${diagram.id}/owner`, {
    cookie: owner.cookie,
    body: { userId: heir.id },
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.owner.username, "heir");
  assert.deepEqual(
    moved.data.members.map((m) => [m.username, m.role]),
    [["owner", "editor"]],
  );
  const asHeir = await api("GET", `/api/diagrams/${diagram.id}`, {
    cookie: heir.cookie,
  });
  assert.equal(asHeir.data.role, "owner");
  const asFormer = await api("GET", `/api/diagrams/${diagram.id}`, {
    cookie: owner.cookie,
  });
  assert.equal(asFormer.data.role, "editor");
});

test("the administrator sees and manages every diagram", async (t) => {
  const { api, admin, createUser, createDiagram, application } =
    await startInstance(t);
  const owner = await createUser("owner");
  const diagram = await createDiagram(owner);
  application.store.create({
    id: "legacy",
    name: "Legacy",
    document: doc(),
  });
  const list = await api("GET", "/api/diagrams", { cookie: admin.cookie });
  assert.deepEqual(
    list.data.diagrams.map((d) => [d.id, d.role]).sort(),
    [
      [diagram.id, "owner"],
      ["legacy", "owner"],
    ].sort(),
  );
  // Diagrams from before accounts existed stay editable by everyone.
  const legacy = await api("GET", "/api/diagrams/legacy", {
    cookie: owner.cookie,
  });
  assert.equal(legacy.data.role, "editor");
});

// --- Accounts -----------------------------------------------------------------------

test("disabling an account signs it out everywhere until it is enabled again", async (t) => {
  const instance = await startInstance(t);
  const {
    api,
    admin,
    createUser,
    createDiagram,
    openSocket,
    join,
    closed,
    login,
  } = instance;
  const user = await createUser("worker");
  const diagram = await createDiagram(user);
  const socket = await openSocket(diagram.id, user.cookie);
  await join(socket, diagram.id, "worker-tab");
  const gone = closed(socket);

  const disabled = await api("PUT", `/api/admin/users/${user.id}/disabled`, {
    cookie: admin.cookie,
    body: { disabled: true },
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.data.user.disabled, true);
  assert.equal(await gone, 4403);
  assert.equal(
    (await api("GET", "/api/auth/me", { cookie: user.cookie })).status,
    401,
  );
  const refused = await login("worker");
  assert.equal(refused.status, 403);
  assert.match(refused.data.error, /disabled/);
  // A wrong password does not reveal that the account exists but is disabled.
  assert.equal((await login("worker", "wrong-password-1")).status, 401);
  const directory = await api("GET", "/api/users", { cookie: admin.cookie });
  assert.ok(!directory.data.users.some((u) => u.username === "worker"));

  await api("PUT", `/api/admin/users/${user.id}/disabled`, {
    cookie: admin.cookie,
    body: { disabled: false },
  });
  assert.equal((await login("worker")).status, 200);

  // The administrator account itself cannot be disabled or deleted.
  assert.equal(
    (
      await api("PUT", `/api/admin/users/${admin.id}/disabled`, {
        cookie: admin.cookie,
        body: { disabled: true },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api("DELETE", `/api/admin/users/${admin.id}`, {
        cookie: admin.cookie,
      })
    ).status,
    400,
  );
  // Only administrators manage accounts.
  assert.equal(
    (
      await api("PUT", `/api/admin/users/${admin.id}/disabled`, {
        cookie: user.cookie,
        body: { disabled: true },
      })
    ).status,
    401,
  );
});

test("deleting an account hands its diagrams over", async (t) => {
  const { api, admin, createUser, createDiagram, application } =
    await startInstance(t);
  const leaving = await createUser("leaving");
  const heir = await createUser("heir");
  const other = await createUser("other");
  const first = await createDiagram(leaving, "First");
  const second = await createDiagram(leaving, "Second");
  const shared = await createDiagram(other, "Shared");
  await api("PUT", `/api/diagrams/${shared.id}/members/${leaving.id}`, {
    cookie: other.cookie,
    body: { role: "editor" },
  });
  // heir was a member of one of them; as the new owner it no longer needs to be.
  await api("PUT", `/api/diagrams/${first.id}/members/${heir.id}`, {
    cookie: leaving.cookie,
    body: { role: "viewer" },
  });

  assert.equal(
    (
      await api(
        "DELETE",
        `/api/admin/users/${leaving.id}?transferTo=${leaving.id}`,
        {
          cookie: admin.cookie,
        },
      )
    ).status,
    400,
  );
  const deleted = await api(
    "DELETE",
    `/api/admin/users/${leaving.id}?transferTo=${heir.id}`,
    { cookie: admin.cookie },
  );
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.transferred, 2);
  for (const id of [first.id, second.id]) {
    const view = await api("GET", `/api/diagrams/${id}`, {
      cookie: heir.cookie,
    });
    assert.equal(view.data.role, "owner");
  }
  const access = await api("GET", `/api/diagrams/${first.id}/access`, {
    cookie: heir.cookie,
  });
  assert.equal(access.data.members.length, 0);
  const sharedAccess = await api("GET", `/api/diagrams/${shared.id}/access`, {
    cookie: other.cookie,
  });
  assert.equal(sharedAccess.data.members.length, 0);
  const users = await api("GET", "/api/admin/users", { cookie: admin.cookie });
  assert.ok(!users.data.users.some((u) => u.username === "leaving"));
  assert.equal(
    application.database
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?")
      .get(leaving.id).n,
    0,
  );
});

test("the administrator sees when each account last signed in", async (t) => {
  const { api, admin, createUser } = await startInstance(t);
  await createUser("worker");
  const users = await api("GET", "/api/admin/users", { cookie: admin.cookie });
  const worker = users.data.users.find((u) => u.username === "worker");
  assert.ok(Date.parse(worker.lastLoginAt) > Date.now() - 60_000);
  assert.equal(worker.disabled, false);
});

// --- History --------------------------------------------------------------------------

test("edits are kept as versions that can be compared and restored", async (t) => {
  const instance = await startInstance(t, {
    env: { HISTORY_INTERVAL_MINUTES: "0" },
  });
  const { api, createUser, createDiagram, openSocket, join, nextMessage } =
    instance;
  const owner = await createUser("owner");
  const editor = await createUser("editor");
  const diagram = await createDiagram(owner, "Shop", doc([table(1, "orders")]));
  await api("PUT", `/api/diagrams/${diagram.id}/members/${editor.id}`, {
    cookie: owner.cookie,
    body: { role: "editor" },
  });
  const save = (session, document, baseVersion, name = "Shop") =>
    api("PUT", `/api/diagrams/${diagram.id}`, {
      cookie: session.cookie,
      body: { name, document, baseVersion },
    });
  await save(owner, doc([table(1, "orders"), table(2, "items")]), 1);
  await save(editor, doc([table(2, "items")]), 2, "Shop renamed");

  const history = await api("GET", `/api/diagrams/${diagram.id}/versions`, {
    cookie: editor.cookie,
  });
  assert.equal(history.status, 200);
  assert.equal(history.data.current, 3);
  assert.deepEqual(
    history.data.versions.map((v) => [v.version, v.username, v.label]),
    [
      [3, "editor", null],
      [2, "owner", null],
      [1, "owner", "created"],
    ],
  );
  const first = await api("GET", `/api/diagrams/${diagram.id}/versions/1`, {
    cookie: editor.cookie,
  });
  assert.deepEqual(
    first.data.document.tables.map((t) => t.name),
    ["orders"],
  );

  // A named version marks a milestone.
  const named = await api("POST", `/api/diagrams/${diagram.id}/versions`, {
    cookie: editor.cookie,
    body: { title: "Release 1.0" },
  });
  assert.equal(named.status, 201);

  const socket = await openSocket(diagram.id, owner.cookie);
  await join(socket, diagram.id, "owner-tab");
  const restored = await api(
    "POST",
    `/api/diagrams/${diagram.id}/versions/1/restore`,
    { cookie: editor.cookie },
  );
  assert.equal(restored.status, 200);
  assert.deepEqual(
    restored.data.document.tables.map((t) => t.name),
    ["orders"],
  );
  assert.equal(restored.data.name, "Shop");
  const snapshot = await nextMessage(
    socket,
    (m) => m.type === "snapshot" && m.version === restored.data.version,
  );
  assert.deepEqual(
    snapshot.document.tables.map((t) => t.name),
    ["orders"],
  );

  const after = await api("GET", `/api/diagrams/${diagram.id}/versions`, {
    cookie: owner.cookie,
  });
  const top = after.data.versions[0];
  assert.equal(top.label, "restored");
  assert.ok(
    after.data.versions.some(
      (v) => v.title === "Release 1.0" && v.version === 3,
    ),
  );
});

test("viewers browse the history but cannot restore", async (t) => {
  const { api, createUser, createDiagram } = await startInstance(t);
  const owner = await createUser("owner");
  const viewer = await createUser("viewer");
  const diagram = await createDiagram(owner);
  await api("PUT", `/api/diagrams/${diagram.id}/members/${viewer.id}`, {
    cookie: owner.cookie,
    body: { role: "viewer" },
  });
  assert.equal(
    (
      await api("GET", `/api/diagrams/${diagram.id}/versions`, {
        cookie: viewer.cookie,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api("POST", `/api/diagrams/${diagram.id}/versions/1/restore`, {
        cookie: viewer.cookie,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("GET", `/api/diagrams/${diagram.id}/versions/99`, {
        cookie: viewer.cookie,
      })
    ).status,
    404,
  );
});

test("a busy session is saved at most once per interval and the history is capped", async (t) => {
  const { api, createUser, createDiagram } = await startInstance(t, {
    env: { HISTORY_INTERVAL_MINUTES: "60", HISTORY_LIMIT: "3" },
  });
  const owner = await createUser("owner");
  const diagram = await createDiagram(owner);
  for (let version = 1; version <= 5; version++) {
    const saved = await api("PUT", `/api/diagrams/${diagram.id}`, {
      cookie: owner.cookie,
      body: {
        document: doc([table(version, `t${version}`)]),
        baseVersion: version,
      },
    });
    assert.equal(saved.status, 200);
  }
  let history = await api("GET", `/api/diagrams/${diagram.id}/versions`, {
    cookie: owner.cookie,
  });
  // Only the creation: every later save fell within the interval.
  assert.deepEqual(
    history.data.versions.map((v) => v.version),
    [1],
  );
  for (const title of ["a", "b", "c"]) {
    await api("POST", `/api/diagrams/${diagram.id}/versions`, {
      cookie: owner.cookie,
      body: { title },
    });
    await api("PUT", `/api/diagrams/${diagram.id}`, {
      cookie: owner.cookie,
      body: {
        document: doc(),
        baseVersion: (
          await api("GET", `/api/diagrams/${diagram.id}`, {
            cookie: owner.cookie,
          })
        ).data.version,
      },
    });
  }
  history = await api("GET", `/api/diagrams/${diagram.id}/versions`, {
    cookie: owner.cookie,
  });
  // Named versions and the first one are kept beyond the limit.
  assert.deepEqual(
    history.data.versions.map((v) => v.title ?? v.label),
    ["c", "b", "a", "created"],
  );
  // Restores add versions; only the last three of those are kept.
  for (let i = 0; i < 4; i++) {
    const restored = await api(
      "POST",
      `/api/diagrams/${diagram.id}/versions/1/restore`,
      { cookie: owner.cookie },
    );
    assert.equal(restored.status, 200);
  }
  history = await api("GET", `/api/diagrams/${diagram.id}/versions`, {
    cookie: owner.cookie,
  });
  const kept = history.data.versions.filter(
    (v) => v.label !== "named" && v.label !== "created",
  );
  assert.equal(kept.length, 3);
  assert.deepEqual(
    history.data.versions
      .filter((v) => v.label === "named" || v.label === "created")
      .map((v) => v.title ?? v.label),
    ["c", "b", "a", "created"],
  );
});

// --- Activity log -------------------------------------------------------------------------

test("the activity log records who did what", async (t) => {
  const { api, admin, createUser, createDiagram, login } =
    await startInstance(t);
  const owner = await createUser("owner");
  const viewer = await createUser("viewer");
  await login("owner", "wrong-password-1");
  const diagram = await createDiagram(owner, "Audited");
  await api("PUT", `/api/diagrams/${diagram.id}/members/${viewer.id}`, {
    cookie: owner.cookie,
    body: { role: "viewer" },
  });
  await api("PUT", `/api/diagrams/${diagram.id}`, {
    cookie: owner.cookie,
    body: { name: "Audited 2", document: doc(), baseVersion: 1 },
  });

  const log = await api("GET", "/api/admin/audit", { cookie: admin.cookie });
  assert.equal(log.status, 200);
  const actions = log.data.entries.map((e) => e.action);
  for (const action of [
    "auth.setup",
    "user.created",
    "auth.login",
    "auth.login_failed",
    "diagram.created",
    "diagram.member_set",
    "diagram.renamed",
  ]) {
    assert.ok(actions.includes(action), action);
  }
  const failed = log.data.entries.find((e) => e.action === "auth.login_failed");
  assert.equal(failed.target, "owner");
  assert.ok(failed.ip);

  const filtered = await api("GET", `/api/admin/audit?action=diagram.renamed`, {
    cookie: admin.cookie,
  });
  assert.deepEqual(
    filtered.data.entries.map((e) => e.details),
    [{ from: "Audited", to: "Audited 2" }],
  );
  const page = await api("GET", "/api/admin/audit?limit=2", {
    cookie: admin.cookie,
  });
  assert.equal(page.data.entries.length, 2);
  const next = await api(
    "GET",
    `/api/admin/audit?limit=2&before=${page.data.entries[1].id}`,
    { cookie: admin.cookie },
  );
  assert.ok(next.data.entries.every((e) => e.id < page.data.entries[1].id));

  assert.equal(
    (await api("GET", "/api/admin/audit", { cookie: owner.cookie })).status,
    403,
  );
  const activity = await api("GET", `/api/diagrams/${diagram.id}/activity`, {
    cookie: owner.cookie,
  });
  assert.ok(activity.data.entries.every((e) => e.diagramId === diagram.id));
  assert.equal(
    (
      await api("GET", `/api/diagrams/${diagram.id}/activity`, {
        cookie: viewer.cookie,
      })
    ).status,
    403,
  );
});

// --- Custom types ---------------------------------------------------------------------------

test("custom types are shared by everyone on the instance", async (t) => {
  const { api, createUser } = await startInstance(t);
  const alice = await createUser("alice");
  const bob = await createUser("bob");
  assert.deepEqual(
    (await api("GET", "/api/custom-types", { cookie: alice.cookie })).data
      .types,
    {},
  );
  const saved = await api("PUT", "/api/custom-types", {
    cookie: alice.cookie,
    body: {
      types: {
        postgresql: { citext: { type: "citext", color: "#ff0000" } },
        mysql: { GEOGRAPHY: { type: "GEOGRAPHY", color: "#00aa00" } },
      },
    },
  });
  assert.equal(saved.status, 200);
  const seen = await api("GET", "/api/custom-types", { cookie: bob.cookie });
  assert.deepEqual(seen.data.types, {
    postgresql: { CITEXT: { type: "CITEXT", color: "#ff0000" } },
    mysql: { GEOGRAPHY: { type: "GEOGRAPHY", color: "#00aa00" } },
  });
  for (const types of [
    { nosql: { X: { type: "X", color: "#000" } } },
    { mysql: { "BAD;TYPE": { type: "BAD;TYPE", color: "#000" } } },
    { mysql: { OK: { type: "OK", color: "url(javascript:x)" } } },
    [],
  ]) {
    const refused = await api("PUT", "/api/custom-types", {
      cookie: bob.cookie,
      body: { types },
    });
    assert.equal(refused.status, 400, JSON.stringify(types));
  }
  assert.equal((await api("GET", "/api/custom-types")).status, 401);
  assert.equal((await api("GET", "/api/no-such-route")).status, 404);
});

// --- Document validation ------------------------------------------------------------------

test("malformed diagrams are rejected before they are stored or shared", async (t) => {
  const instance = await startInstance(t);
  const { api, createUser, createDiagram, openSocket, join, nextMessage } =
    instance;
  const owner = await createUser("owner");
  const bad = [
    { tables: "nope" },
    { tables: [{ id: 1, name: 7, fields: [] }] },
    { tables: [table(1, "t", [{ ...field(1, "a"), primary: "yes" }])] },
    { tables: [table(1, "t", [field({ evil: true }, "a")])] },
    { references: [{ startTableId: null, endTableId: 1 }] },
    { notes: [{ id: 1, x: "far", y: 0 }] },
    { zoom: -1 },
    { tables: Array.from({ length: 5001 }, (_, i) => table(i, `t${i}`)) },
    { tables: [table(1, "x".repeat(600))] },
  ];
  for (const document of bad) {
    const created = await api("POST", "/api/diagrams", {
      cookie: owner.cookie,
      body: { name: "Bad", document },
    });
    assert.equal(created.status, 400, JSON.stringify(document).slice(0, 80));
    assert.match(created.data.error, /^Invalid diagram: /);
  }
  assert.equal(
    (
      await api("POST", "/api/diagrams", {
        cookie: owner.cookie,
        body: { name: "   ", document: doc() },
      })
    ).status,
    400,
  );

  const diagram = await createDiagram(owner, "Good", doc([table(1, "t")]));
  const socket = await openSocket(diagram.id, owner.cookie);
  const joined = await join(socket, diagram.id, "owner-tab");
  socket.send(
    JSON.stringify({
      type: "operation",
      diagramId: diagram.id,
      clientId: "owner-tab",
      operationId: "op-bad",
      baseVersion: joined.version,
      operation: {
        type: "snapshot.replace",
        payload: { name: "Good", document: { tables: [{ id: 1 }] } },
      },
    }),
  );
  const refused = await nextMessage(socket, (m) => m.type === "error");
  assert.equal(refused.code, "invalid_document");
  const stored = await api("GET", `/api/diagrams/${diagram.id}`, {
    cookie: owner.cookie,
  });
  assert.equal(stored.data.version, 1);
});

test("documents the editor really produces pass validation", async () => {
  const templates = [];
  for (let n = 1; n <= 6; n++) {
    const module = await import(`../src/templates/template${n}.js`).catch(
      () => null,
    );
    if (module) templates.push(Object.values(module)[0]);
  }
  // The templates import their constants without an extension; when they
  // cannot be loaded here, the test still checks a document like the editor's.
  const editorLike = {
    database: "mysql",
    tables: [
      {
        ...table("t1", "users", [
          { ...field("f1", "id"), primary: true, unsigned: true, size: "" },
          { ...field("f2", "role", "ENUM"), values: ["a", "b"], default: "a" },
          { ...field("f3", "price", "DECIMAL"), size: "10,2", default: 0 },
        ]),
        uniqueConstraints: [{ name: "uq", fields: ["role"] }],
        indices: [{ id: 0, name: "idx", unique: false, fields: ["role"] }],
        protoReserved: [4],
      },
    ],
    references: [
      {
        id: "r1",
        name: "fk",
        startTableId: "t1",
        startFieldId: "f1",
        endTableId: "t1",
        endFieldId: "f1",
        cardinality: "many_to_one",
        updateConstraint: "No action",
        deleteConstraint: "Cascade",
        bendOffset: -42.5,
      },
      {
        id: "r2",
        name: "fk2",
        startTableId: "t1",
        endTableId: "t1",
        bendOffset: null,
      },
    ],
    notes: [
      {
        id: 0,
        x: 1,
        y: 2,
        title: "n",
        content: "c",
        color: "#fff",
        height: 80,
      },
    ],
    areas: [
      { id: 0, name: "a", x: 0, y: 0, width: 10, height: 10, color: "#fff" },
    ],
    enums: [{ name: "status", values: ["on"] }],
    types: [{ name: "pt", comment: "", fields: [{ name: "x", type: "INT" }] }],
    pan: { x: 0, y: 0 },
    zoom: 1,
  };
  assert.equal(documentProblem(editorLike), null);
  assert.match(
    documentProblem({
      references: [{ startTableId: "a", endTableId: "b", bendOffset: "far" }],
    }),
    /references\[0\]\.bendOffset: must be a number/,
  );
  for (const template of templates) {
    assert.doesNotThrow(() => assertValidDocument(template));
  }
});

// --- Backups ----------------------------------------------------------------------------------

test("backups are taken, listed, downloaded and pruned", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "drawdb-backups-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { api, admin, createUser, createDiagram } = await startInstance(t, {
    backupDirectory: directory,
    env: { BACKUP_KEEP: "2", BACKUP_INTERVAL_HOURS: "0" },
  });
  const user = await createUser("worker");
  await createDiagram(user, "Kept in the backup");

  assert.equal(
    (await api("POST", "/api/admin/backups", { cookie: user.cookie })).status,
    403,
  );
  const names = [];
  for (let i = 0; i < 3; i++) {
    const made = await api("POST", "/api/admin/backups", {
      cookie: admin.cookie,
    });
    assert.equal(made.status, 201);
    names.push(made.data.backup.name);
  }
  const listed = await api("GET", "/api/admin/backups", {
    cookie: admin.cookie,
  });
  assert.equal(listed.data.enabled, true);
  assert.equal(listed.data.backups.length, 2);
  assert.ok(!listed.data.backups.some((b) => b.name === names[0]));

  const latest = listed.data.backups[0].name;
  const file = await api("GET", `/api/admin/backups/${latest}`, {
    cookie: admin.cookie,
  });
  assert.equal(file.status, 200);
  assert.ok(file.text.startsWith("SQLite format 3"));
  const copy = new Database(path.join(directory, latest), { readonly: true });
  t.after(() => copy.close());
  assert.equal(
    copy.prepare("SELECT name FROM diagrams").get().name,
    "Kept in the backup",
  );
  assert.equal(
    (
      await api("GET", "/api/admin/backups/..%2Fdrawdb.sqlite", {
        cookie: admin.cookie,
      })
    ).status,
    404,
  );
});

test("the source page offers the source archive and the SBOM", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drawdb-source-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const archive = path.join(dir, "drawdb-collaborative-source.tar.gz");
  fs.writeFileSync(archive, "archive");
  fs.writeFileSync(
    path.join(dir, "sbom.cdx.json"),
    JSON.stringify({ bomFormat: "CycloneDX", components: [] }),
  );
  const { api } = await startInstance(t, { env: { SOURCE_ARCHIVE: archive } });
  const page = await api("GET", "/source");
  assert.match(
    page.text,
    /href="\/source\/drawdb-collaborative-source\.tar\.gz"/,
  );
  assert.match(page.text, /href="\/source\/sbom\.cdx\.json"/);
  const sbom = await api("GET", "/source/sbom.cdx.json");
  assert.equal(sbom.status, 200);
  assert.match(sbom.response.headers.get("content-type"), /cyclonedx/);
  assert.equal(sbom.data.bomFormat, "CycloneDX");
});

test("a named version is credited to whoever named it", async (t) => {
  const { api, createUser, createDiagram } = await startInstance(t, {
    env: { HISTORY_INTERVAL_MINUTES: "0" },
  });
  const owner = await createUser("owner");
  const editor = await createUser("editor");
  const diagram = await createDiagram(owner);
  await api("PUT", `/api/diagrams/${diagram.id}/members/${editor.id}`, {
    cookie: owner.cookie,
    body: { role: "editor" },
  });
  // The editor's save is recorded as a version of theirs...
  const saved = await api("PUT", `/api/diagrams/${diagram.id}`, {
    cookie: editor.cookie,
    body: { document: doc([table(1, "t1")]), baseVersion: 1 },
  });
  assert.equal(saved.status, 200);
  // ...and the owner names that same state.
  const named = await api("POST", `/api/diagrams/${diagram.id}/versions`, {
    cookie: owner.cookie,
    body: { title: "1.0" },
  });
  assert.equal(named.status, 201);
  const { versions } = (
    await api("GET", `/api/diagrams/${diagram.id}/versions`, {
      cookie: owner.cookie,
    })
  ).data;
  const version = versions.find((v) => v.title === "1.0");
  assert.equal(version.version, 2);
  assert.equal(version.username, "owner");
  assert.deepEqual(version.editors, ["editor"]);
});
