import crypto from "node:crypto";
import { promisify } from "node:util";

/* global Buffer, process */

const scrypt = promisify(crypto.scrypt);

export const SESSION_COOKIE = "drawdb_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_MS = SESSION_TTL_MS / 2;
const SCRYPT_KEY_BYTES = 64;
// Cost of new password hashes: 2^16 rounds of 8 KiB blocks (64 MiB, about a
// tenth of a second). Hashes made with lower settings are upgraded the next
// time their owner signs in. The original format, "scrypt$salt$key", used
// Node's defaults (2^14, 8, 1).
const SCRYPT_COST = { N: 2 ** 16, r: 8, p: 1 };
const LEGACY_SCRYPT_COST = { N: 2 ** 14, r: 8, p: 1 };
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
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

async function hashPassword(password, cost = SCRYPT_COST) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT_KEY_BYTES, {
    ...cost,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt$N=${cost.N},r=${cost.r},p=${cost.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** Splits a stored hash; null when it is not one we wrote. */
function parseHash(stored) {
  const parts = String(stored).split("$");
  if (parts[0] !== "scrypt") return null;
  if (parts.length === 3) {
    return { cost: LEGACY_SCRYPT_COST, salt: parts[1], key: parts[2] };
  }
  if (parts.length !== 4) return null;
  const cost = Object.fromEntries(
    parts[1].split(",").map((pair) => {
      const [name, value] = pair.split("=");
      return [name, Number(value)];
    }),
  );
  const valid =
    Number.isInteger(cost.N) &&
    cost.N > 1 &&
    (cost.N & (cost.N - 1)) === 0 &&
    cost.N <= 2 ** 20 &&
    Number.isInteger(cost.r) &&
    cost.r > 0 &&
    cost.r <= 32 &&
    Number.isInteger(cost.p) &&
    cost.p > 0 &&
    cost.p <= 16;
  return valid ? { cost, salt: parts[2], key: parts[3] } : null;
}

async function verifyPassword(password, stored) {
  const parsed = parseHash(stored);
  if (!parsed || !parsed.salt || !parsed.key) return false;
  const expected = Buffer.from(parsed.key, "hex");
  if (expected.length !== SCRYPT_KEY_BYTES) return false;
  const actual = await scrypt(
    password,
    Buffer.from(parsed.salt, "hex"),
    SCRYPT_KEY_BYTES,
    { ...parsed.cost, maxmem: SCRYPT_MAXMEM },
  );
  return crypto.timingSafeEqual(expected, actual);
}

function needsRehash(stored) {
  const parsed = parseHash(stored);
  return (
    !parsed ||
    parsed.cost.N < SCRYPT_COST.N ||
    parsed.cost.r < SCRYPT_COST.r ||
    parsed.cost.p < SCRYPT_COST.p
  );
}

// Compared against when the username does not exist, so that an unknown
// account costs the same time as a wrong password.
const DUMMY_HASH = `scrypt$N=${SCRYPT_COST.N},r=${SCRYPT_COST.r},p=${SCRYPT_COST.p}$${"0".repeat(32)}$${"0".repeat(128)}`;

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
      const stored = row?.password_hash || DUMMY_HASH;
      const matches = await verifyPassword(password, stored);
      if (!row || !matches) return null;
      if (needsRehash(row.password_hash)) {
        const upgraded = await hashPassword(password);
        db.prepare(
          "UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?",
        ).run(upgraded, row.id, row.password_hash);
      }
      return publicUser(row);
    },

    getUser(id) {
      return publicUser(selectUserById.get(id));
    },

    // Administrator reset: stores a new hash and signs the user out everywhere.
    async resetPassword({ userId, newPassword }) {
      if (!selectUserById.get(userId)) return { status: "not_found" };
      const passwordHash = await hashPassword(newPassword);
      db.transaction(() => {
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
          passwordHash,
          userId,
        );
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
      })();
      return { status: "changed" };
    },

    // Re-checks the current password, stores a new scrypt hash and signs out
    // every other session of the account. Plain passwords are never stored.
    async changePassword({ userId, currentPassword, newPassword, keepToken }) {
      const user = publicUser(selectUserById.get(userId));
      if (!user) return { status: "not_found" };
      const verified = await this.verifyCredentials({
        username: user.username,
        password: currentPassword,
      });
      if (!verified) return { status: "invalid_password" };
      const passwordHash = await hashPassword(newPassword);
      const keepHash =
        typeof keepToken === "string" && keepToken ? hashToken(keepToken) : "";
      db.transaction(() => {
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
          passwordHash,
          userId,
        );
        db.prepare(
          "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
        ).run(userId, keepHash);
      })();
      return { status: "changed" };
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

/**
 * The code that proves, while the instance has no accounts yet, that whoever
 * creates the first (administrator) account has access to the server: it is
 * printed in the server log, or set beforehand with SETUP_CODE.
 */
export function createSetupCode(configured = process.env.SETUP_CODE) {
  const code =
    typeof configured === "string" && configured.trim().length >= 8
      ? configured.trim()
      : crypto.randomBytes(9).toString("base64url");
  const expected = crypto.createHash("sha256").update(code).digest();
  return {
    code,
    matches(candidate) {
      if (typeof candidate !== "string") return false;
      const actual = crypto
        .createHash("sha256")
        .update(candidate.trim())
        .digest();
      return crypto.timingSafeEqual(expected, actual);
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
