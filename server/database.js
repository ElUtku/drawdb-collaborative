import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/* global process */

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
  return db;
}

export function createDiagramStore(db) {
  const selectOne = db.prepare(
    "SELECT id, name, document, version, owner_id, created_at, updated_at FROM diagrams WHERE id = ?",
  );
  const parse = (row) =>
    row ? { ...row, document: JSON.parse(row.document) } : null;

  const updateSnapshot = db.transaction(
    ({ id, name, document, baseVersion, operationId }) => {
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
      return { status: "updated", diagram: parse(selectOne.get(id)) };
    },
  );

  return {
    list(ownerId = null) {
      // Owner-less diagrams predate authentication and stay visible to everyone.
      return db
        .prepare(
          "SELECT id, name, version, owner_id, created_at, updated_at FROM diagrams WHERE owner_id IS NULL OR owner_id = ? ORDER BY updated_at DESC",
        )
        .all(ownerId);
    },
    get(id) {
      return parse(selectOne.get(id));
    },
    create({ id, name, document, ownerId = null }) {
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO diagrams (id, name, document, version, owner_id, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
      ).run(id, name, JSON.stringify(document), ownerId, now, now);
      return parse(selectOne.get(id));
    },
    updateSnapshot,
    delete(id) {
      return (
        db.prepare("DELETE FROM diagrams WHERE id = ?").run(id).changes > 0
      );
    },
  };
}
