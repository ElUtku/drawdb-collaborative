import crypto from "node:crypto";
import { promisify } from "node:util";

/* global Buffer */

const scrypt = promisify(crypto.scrypt);

export const SESSION_COOKIE = "drawdb_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_MS = SESSION_TTL_MS / 2;
const SCRYPT_KEY_BYTES = 64;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

export function isValidUsername(value) {
  return typeof value === "string" && USERNAME_PATTERN.test(value);
}

export function isValidPassword(value) {
  return (
    typeof value === "string" &&
    value.length >= MIN_PASSWORD_LENGTH &&
    value.length <= MAX_PASSWORD_LENGTH
  );
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT_KEY_BYTES);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  const [scheme, salt, key] = String(stored).split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "hex");
  if (expected.length !== SCRYPT_KEY_BYTES) return false;
  const actual = await scrypt(
    password,
    Buffer.from(salt, "hex"),
    SCRYPT_KEY_BYTES,
  );
  return crypto.timingSafeEqual(expected, actual);
}

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

export function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (!name || name in cookies) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      cookies[name] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}

export function createAuthStore(db) {
  const publicUser = (row) =>
    row
      ? {
          id: row.id,
          username: row.username,
          isAdmin: row.is_admin === 1,
          createdAt: row.created_at,
        }
      : null;
  const selectUserById = db.prepare(
    "SELECT id, username, is_admin, created_at FROM users WHERE id = ?",
  );
  const selectUserByUsername = db.prepare(
    "SELECT id, username, password_hash, is_admin, created_at FROM users WHERE username = ? COLLATE NOCASE",
  );
  const selectSession = db.prepare(
    "SELECT token_hash, user_id, expires_at FROM sessions WHERE token_hash = ?",
  );
  const countUsers = () =>
    db.prepare("SELECT COUNT(*) AS total FROM users").get().total;

  // Counting and inserting in one transaction keeps two concurrent bootstrap
  // requests from both claiming the admin account.
  const insertUser = db.transaction(
    ({ id, username, passwordHash, isAdmin, requireEmpty, now }) => {
      if (requireEmpty && countUsers() > 0) {
        return { status: "already_initialized" };
      }
      if (selectUserByUsername.get(username)) return { status: "taken" };
      db.prepare(
        "INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, username, passwordHash, isAdmin ? 1 : 0, now);
      return { status: "created", user: publicUser(selectUserById.get(id)) };
    },
  );

  return {
    countUsers,

    listUsers() {
      return db
        .prepare(
          "SELECT id, username, is_admin, created_at FROM users ORDER BY created_at",
        )
        .all()
        .map(publicUser);
    },

    async createUser({
      username,
      password,
      isAdmin = false,
      requireEmpty = false,
    }) {
      const passwordHash = await hashPassword(password);
      try {
        return insertUser({
          id: crypto.randomUUID(),
          username,
          passwordHash,
          isAdmin,
          requireEmpty,
          now: new Date().toISOString(),
        });
      } catch (error) {
        // A concurrent insert won the unique index race.
        if (String(error.code).startsWith("SQLITE_CONSTRAINT")) {
          return { status: "taken" };
        }
        throw error;
      }
    },

    async verifyCredentials({ username, password }) {
      const row = selectUserByUsername.get(username);
      // Hash even when the user is unknown so timing does not leak existence.
      const stored =
        row?.password_hash || `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;
      const matches = await verifyPassword(password, stored);
      return row && matches ? publicUser(row) : null;
    },

    getUser(id) {
      return publicUser(selectUserById.get(id));
    },

    createSession(userId) {
      const token = crypto.randomBytes(32).toString("base64url");
      const now = Date.now();
      db.prepare(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      ).run(
        hashToken(token),
        userId,
        new Date(now).toISOString(),
        new Date(now + SESSION_TTL_MS).toISOString(),
      );
      return { token, expiresAt: new Date(now + SESSION_TTL_MS) };
    },

    resolveSession(token) {
      if (typeof token !== "string" || token.length === 0) return null;
      const tokenHash = hashToken(token);
      const session = selectSession.get(tokenHash);
      if (!session) return null;
      const expiresAt = Date.parse(session.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
        return null;
      }
      const user = publicUser(selectUserById.get(session.user_id));
      if (!user) {
        db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
        return null;
      }
      // Slide the expiry once the session is past its half-life.
      let renewedUntil = null;
      if (expiresAt - Date.now() < SESSION_REFRESH_MS) {
        renewedUntil = new Date(Date.now() + SESSION_TTL_MS);
        db.prepare(
          "UPDATE sessions SET expires_at = ? WHERE token_hash = ?",
        ).run(renewedUntil.toISOString(), tokenHash);
      }
      return { user, renewedUntil };
    },

    deleteSession(token) {
      if (typeof token !== "string" || token.length === 0) return false;
      return (
        db
          .prepare("DELETE FROM sessions WHERE token_hash = ?")
          .run(hashToken(token)).changes > 0
      );
    },

    pruneExpiredSessions() {
      return db
        .prepare("DELETE FROM sessions WHERE expires_at <= ?")
        .run(new Date().toISOString()).changes;
    },
  };
}

export function sessionCookie(token, { secure, expiresAt }) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor((expiresAt.getTime() - Date.now()) / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearedSessionCookie({ secure }) {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Fixed-window throttle for credential endpoints, keyed by client IP plus
 * username so one noisy source cannot lock out an unrelated account.
 */
export function createLoginThrottle({
  maxAttempts = 10,
  windowMs = 15 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  const buckets = new Map();
  const sweep = () => {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now()) buckets.delete(key);
    }
  };
  return {
    check(key) {
      sweep();
      const bucket = buckets.get(key);
      if (!bucket) return { allowed: true, retryAfterSeconds: 0 };
      if (bucket.count < maxAttempts)
        return { allowed: true, retryAfterSeconds: 0 };
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((bucket.resetAt - now()) / 1000),
        ),
      };
    },
    fail(key) {
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now()) {
        buckets.set(key, { count: 1, resetAt: now() + windowMs });
        return;
      }
      bucket.count += 1;
    },
    succeed(key) {
      buckets.delete(key);
    },
  };
}
