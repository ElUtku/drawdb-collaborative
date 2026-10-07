import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import Database from "better-sqlite3";

/* global process, Buffer */

const DEFAULT_DATABASE_PATH = path.resolve("data/drawdb.sqlite");

export function openDatabase(databasePath = process.env.DATABASE_PATH) {
  const configuredPath = databasePath || DEFAULT_DATABASE_PATH;
  const resolvedPath =
    configuredPath === ":memory:"
      ? configuredPath
      : path.resolve(configuredPath);
  if (resolvedPath !== ":memory:") {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS diagrams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      document TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applied_operations (
      diagram_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (diagram_id, operation_id),
      FOREIGN KEY (diagram_id) REFERENCES diagrams(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS applied_operations_created_at
      ON applied_operations (created_at);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique
      ON users (username COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions (user_id);

    CREATE TABLE IF NOT EXISTS app_secrets (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS diagram_git_settings (
      diagram_id TEXT PRIMARY KEY,
      remote_url TEXT NOT NULL,
      branch TEXT NOT NULL,
      directory TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL,
      auth_username TEXT,
      token_cipher TEXT,
      author_name TEXT,
      author_email TEXT,
      last_commit TEXT,
      last_commit_message TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (diagram_id) REFERENCES diagrams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS diagram_members (
      diagram_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
      added_at TEXT NOT NULL,
      PRIMARY KEY (diagram_id, user_id),
      FOREIGN KEY (diagram_id) REFERENCES diagrams(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS diagram_members_user_id
      ON diagram_members (user_id);

    CREATE TABLE IF NOT EXISTS diagram_versions (
      diagram_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      document BLOB NOT NULL,
      size INTEGER NOT NULL,
      user_id TEXT,
      username TEXT,
      editors TEXT NOT NULL DEFAULT '[]',
      label TEXT,
      title TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (diagram_id, version),
      FOREIGN KEY (diagram_id) REFERENCES diagrams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      user_id TEXT,
      username TEXT,
      ip TEXT,
      action TEXT NOT NULL,
      diagram_id TEXT,
      target TEXT,
      details TEXT
    );

    CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log (at);
    CREATE INDEX IF NOT EXISTS audit_log_diagram_id ON audit_log (diagram_id);

    CREATE TABLE IF NOT EXISTS custom_types (
      database TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (database, name)
    );
  `);

  const hasColumn = (table, column) =>
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((current) => current.name === column);

  // Accounts created before the admin role existed: the earliest one is the
  // instance owner, matching the "first user to register" rule.
  if (!hasColumn("users", "is_admin")) {
    db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
  }
  const hasAdmin = db
    .prepare("SELECT 1 FROM users WHERE is_admin = 1 LIMIT 1")
    .get();
  if (!hasAdmin) {
    db.exec(
      "UPDATE users SET is_admin = 1 WHERE id = (SELECT id FROM users ORDER BY created_at, id LIMIT 1)",
    );
  }

  // Diagrams created before authentication existed stay owner-less and remain
  // reachable by every signed-in user.
  if (!hasColumn("diagrams", "owner_id")) {
    db.exec(
      "ALTER TABLE diagrams ADD COLUMN owner_id TEXT REFERENCES users(id)",
    );
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS diagrams_owner_id ON diagrams (owner_id)",
  );

  // What any signed-in user who has the link may do. Diagrams from before
  // per-diagram permissions keep the old behaviour: everyone with the link edits.
  if (!hasColumn("diagrams", "link_access")) {
    db.exec(
      "ALTER TABLE diagrams ADD COLUMN link_access TEXT NOT NULL DEFAULT 'editor'",
    );
  }
  if (!hasColumn("users", "disabled_at")) {
    db.exec("ALTER TABLE users ADD COLUMN disabled_at TEXT");
  }
  if (!hasColumn("users", "last_login_at")) {
    db.exec("ALTER TABLE users ADD COLUMN last_login_at TEXT");
  }
  return db;
}

export const ROLES = ["none", "viewer", "editor", "owner"];
export const LINK_ACCESS = ["none", "viewer", "editor"];
const rank = (role) => Math.max(0, ROLES.indexOf(role));

/**
 * The role `user` has on `diagram`: "owner", "editor", "viewer" or "none".
 * Administrators manage every diagram. Diagrams without an owner predate
 * accounts and stay editable by everyone.
 */
export function roleFor(db, diagram, user) {
  if (!diagram || !user) return "none";
  if (user.isAdmin) return "owner";
  if (!diagram.owner_id) return "editor";
  if (diagram.owner_id === user.id) return "owner";
  const member = db
    .prepare(
      "SELECT role FROM diagram_members WHERE diagram_id = ? AND user_id = ?",
    )
    .get(diagram.id, user.id);
  const link = LINK_ACCESS.includes(diagram.link_access)
    ? diagram.link_access
    : "none";
  return rank(member?.role) >= rank(link) ? member?.role ?? "none" : link;
}

export const canView = (role) => rank(role) >= rank("viewer");
export const canEdit = (role) => rank(role) >= rank("editor");

export function createDiagramStore(
  db,
  {
    historyIntervalMs = 10 * 60 * 1000,
    historyLimit = 200,
    defaultLinkAccess = "none",
  } = {},
) {
  const selectOne = db.prepare(
    `SELECT d.id, d.name, d.document, d.version, d.owner_id, d.link_access,
            d.created_at, d.updated_at, u.username AS owner_username
       FROM diagrams d LEFT JOIN users u ON u.id = d.owner_id
      WHERE d.id = ?`,
  );
  const parse = (row) =>
    row ? { ...row, document: JSON.parse(row.document) } : null;

  // Usernames that edited each diagram since its last saved version.
  const pendingEditors = new Map();
  const noteEditor = (id, user) => {
    if (!user?.username) return;
    if (!pendingEditors.has(id)) pendingEditors.set(id, new Set());
    pendingEditors.get(id).add(user.username);
  };

  const selectLastVersion = db.prepare(
    "SELECT version, created_at FROM diagram_versions WHERE diagram_id = ? ORDER BY version DESC LIMIT 1",
  );
  const insertVersion = db.prepare(
    `INSERT INTO diagram_versions
       (diagram_id, version, name, document, size, user_id, username, editors, label, title, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(diagram_id, version) DO UPDATE SET
       title = COALESCE(excluded.title, diagram_versions.title),
       label = COALESCE(diagram_versions.label, excluded.label),
       -- A version given a name is shown as saved by whoever named it.
       user_id = CASE WHEN excluded.title IS NOT NULL
         THEN excluded.user_id ELSE diagram_versions.user_id END,
       username = CASE WHEN excluded.title IS NOT NULL
         THEN excluded.username ELSE diagram_versions.username END`,
  );
  // The limit applies to versions saved while editing; the first version and
  // the ones people named are kept.
  const pruneVersions = db.prepare(
    `DELETE FROM diagram_versions
      WHERE diagram_id = ? AND COALESCE(label, '') NOT IN ('named', 'created')
        AND version NOT IN (
          SELECT version FROM diagram_versions
           WHERE diagram_id = ? AND COALESCE(label, '') NOT IN ('named', 'created')
           ORDER BY version DESC LIMIT ?)`,
  );

  /** Stores the diagram as it is now in its history. */
  const recordVersion = (
    row,
    { user = null, label = null, title = null } = {},
  ) => {
    const json =
      typeof row.document === "string"
        ? row.document
        : JSON.stringify(row.document);
    const editors = [...(pendingEditors.get(row.id) ?? [])];
    if (user?.username && !editors.includes(user.username)) {
      editors.push(user.username);
    }
    pendingEditors.delete(row.id);
    insertVersion.run(
      row.id,
      row.version,
      row.name,
      zlib.gzipSync(json),
      Buffer.byteLength(json),
      user?.id ?? null,
      user?.username ?? null,
      JSON.stringify(editors),
      label,
      title,
      new Date().toISOString(),
    );
    pruneVersions.run(row.id, row.id, historyLimit);
    return { version: row.version, editors };
  };

  const updateSnapshot = db.transaction(
    ({
      id,
      name,
      document,
      baseVersion,
      operationId,
      user = null,
      label = null,
    }) => {
      const current = selectOne.get(id);
      if (!current) return { status: "not_found" };
      const duplicate = operationId
        ? db
            .prepare(
              "SELECT version FROM applied_operations WHERE diagram_id = ? AND operation_id = ?",
            )
            .get(id, operationId)
        : null;
      if (duplicate) {
        return { status: "duplicate", diagram: parse(selectOne.get(id)) };
      }
      if (current.version !== baseVersion) {
        return { status: "conflict", diagram: parse(current) };
      }

      // A labelled change (a restore, a pull) first saves what it replaces.
      const last = selectLastVersion.get(id);
      if (label && (!last || last.version < current.version)) {
        recordVersion(current, { label: "before_change" });
      }

      const now = new Date().toISOString();
      const version = current.version + 1;
      db.prepare(
        "UPDATE diagrams SET name = ?, document = ?, version = ?, updated_at = ? WHERE id = ?",
      ).run(name ?? current.name, JSON.stringify(document), version, now, id);
      if (operationId) {
        db.prepare(
          "INSERT INTO applied_operations (diagram_id, operation_id, version, created_at) VALUES (?, ?, ?, ?)",
        ).run(id, operationId, version, now);
      }
      noteEditor(id, user);
      const updated = selectOne.get(id);
      // Edits are saved as a version at most every historyIntervalMs, so a
      // busy editing session does not store every keystroke.
      const due =
        label ||
        !last ||
        Date.now() - Date.parse(last.created_at) >= historyIntervalMs;
      const checkpoint = due ? recordVersion(updated, { user, label }) : null;
      return { status: "updated", diagram: parse(updated), checkpoint };
    },
  );

  const listColumns = `d.id, d.name, d.version, d.owner_id, d.link_access,
    d.created_at, d.updated_at, u.username AS owner_username,
    json_extract(d.document, '$.database') AS database,
    length(d.document) AS size`;

  return {
    defaultLinkAccess,
    /**
     * Diagrams `user` owns, was given access to, or that predate accounts;
     * administrators get every diagram.
     */
    list(user) {
      const rows = user?.isAdmin
        ? db
            .prepare(
              `SELECT ${listColumns}, NULL AS member_role FROM diagrams d
                 LEFT JOIN users u ON u.id = d.owner_id
                ORDER BY d.updated_at DESC`,
            )
            .all()
        : db
            .prepare(
              `SELECT ${listColumns}, m.role AS member_role FROM diagrams d
                 LEFT JOIN users u ON u.id = d.owner_id
                 LEFT JOIN diagram_members m
                   ON m.diagram_id = d.id AND m.user_id = @user
                WHERE d.owner_id IS NULL OR d.owner_id = @user
                   OR m.user_id IS NOT NULL
                ORDER BY d.updated_at DESC`,
            )
            .all({ user: user?.id ?? null });
      return rows.map(({ member_role: memberRole, ...row }) => {
        void memberRole;
        return { ...row, role: roleFor(db, row, user) };
      });
    },
    get(id) {
      return parse(selectOne.get(id));
    },
    create({ id, name, document, ownerId = null, linkAccess, user = null }) {
      const now = new Date().toISOString();
      const access = LINK_ACCESS.includes(linkAccess)
        ? linkAccess
        : defaultLinkAccess;
      db.prepare(
        "INSERT INTO diagrams (id, name, document, version, owner_id, link_access, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)",
      ).run(id, name, JSON.stringify(document), ownerId, access, now, now);
      const created = selectOne.get(id);
      recordVersion(created, { user, label: "created" });
      return parse(created);
    },
    updateSnapshot,
    delete(id) {
      pendingEditors.delete(id);
      return (
        db.prepare("DELETE FROM diagrams WHERE id = ?").run(id).changes > 0
      );
    },
    roleFor: (diagram, user) => roleFor(db, diagram, user),

    // --- Sharing ----------------------------------------------------------
    members(id) {
      return db
        .prepare(
          `SELECT m.user_id AS userId, u.username, m.role, m.added_at AS addedAt
             FROM diagram_members m JOIN users u ON u.id = m.user_id
            WHERE m.diagram_id = ? ORDER BY u.username COLLATE NOCASE`,
        )
        .all(id);
    },
    setMember(id, userId, role) {
      db.prepare(
        `INSERT INTO diagram_members (diagram_id, user_id, role, added_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(diagram_id, user_id) DO UPDATE SET role = excluded.role`,
      ).run(id, userId, role, new Date().toISOString());
    },
    removeMember(id, userId) {
      return (
        db
          .prepare(
            "DELETE FROM diagram_members WHERE diagram_id = ? AND user_id = ?",
          )
          .run(id, userId).changes > 0
      );
    },
    setLinkAccess(id, access) {
      db.prepare("UPDATE diagrams SET link_access = ? WHERE id = ?").run(
        access,
        id,
      );
    },
    transferOwner: db.transaction((id, userId) => {
      const previous = selectOne.get(id)?.owner_id ?? null;
      db.prepare("UPDATE diagrams SET owner_id = ? WHERE id = ?").run(
        userId,
        id,
      );
      // The new owner no longer needs a membership; the previous owner keeps
      // editing rights.
      db.prepare(
        "DELETE FROM diagram_members WHERE diagram_id = ? AND user_id = ?",
      ).run(id, userId);
      if (previous && previous !== userId) {
        db.prepare(
          `INSERT OR IGNORE INTO diagram_members (diagram_id, user_id, role, added_at)
           VALUES (?, ?, 'editor', ?)`,
        ).run(id, previous, new Date().toISOString());
      }
    }),

    // --- History ----------------------------------------------------------
    versions(id) {
      return db
        .prepare(
          `SELECT version, name, size, username, editors, label, title, created_at AS createdAt
             FROM diagram_versions WHERE diagram_id = ? ORDER BY version DESC`,
        )
        .all(id)
        .map((row) => ({ ...row, editors: JSON.parse(row.editors) }));
    },
    getVersion(id, version) {
      const row = db
        .prepare(
          `SELECT version, name, document, username, editors, label, title, created_at AS createdAt
             FROM diagram_versions WHERE diagram_id = ? AND version = ?`,
        )
        .get(id, version);
      if (!row) return null;
      return {
        ...row,
        editors: JSON.parse(row.editors),
        document: JSON.parse(zlib.gunzipSync(row.document).toString("utf8")),
      };
    },
    /** Saves the current state as a version now, optionally named. */
    checkpoint(id, { user = null, label = null, title = null } = {}) {
      const current = selectOne.get(id);
      if (!current) return null;
      return recordVersion(current, { user, label, title });
    },

    // Operation ids only catch a client resending an edit after a reconnect,
    // so old ones can go; without this the table grows with every edit.
    pruneOperations(olderThan) {
      return db
        .prepare("DELETE FROM applied_operations WHERE created_at < ?")
        .run(olderThan.toISOString()).changes;
    },
  };
}
