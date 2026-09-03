import { execFile } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { isPlainObject } from "./protocol.js";

/* global process, Buffer */

const execFileAsync = promisify(execFile);

const DEFAULT_BRANCH = "main";
const DEFAULT_AUTH_USERNAME = "x-access-token";
const COMMAND_TIMEOUT_MS = 30_000;

const BRANCH_PATTERN = /^(?!-)(?!.*\.\.)[A-Za-z0-9._\-/]{1,200}$/;
const DIRECTORY_SEGMENT = /^[A-Za-z0-9._-]{1,64}$/;
const FILE_NAME_PATTERN = /^(?!-)(?!\.)[A-Za-z0-9._-]{1,80}$/;
const SCP_LIKE_REMOTE = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[^\s]+$/;
const HTTP_REMOTE = /^https?:\/\//i;
const SSH_REMOTE = /^ssh:\/\//i;

/** An expected failure that maps onto an HTTP status instead of a 500. */
export class GitError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "GitError";
    this.status = status;
  }
}

export function isGitError(error) {
  return error instanceof GitError;
}

function requireString(value, field, max) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new GitError(`${field} is required`);
  if (text.length > max) throw new GitError(`${field} is too long`);
  return text;
}

export function normalizeRemoteUrl(value) {
  const url = requireString(value, "A repository URL", 500);
  // A leading dash would be read as a git option, and whitespace never belongs
  // in a remote. Both are rejected before the value reaches a command line.
  if (/\s/.test(url) || url.startsWith("-")) {
    throw new GitError("The repository URL contains invalid characters");
  }
  // Local remotes exist for tests only: a server-side path would let any
  // signed-in user reach the host filesystem through git.
  if (process.env.GIT_ALLOW_LOCAL_REMOTES === "1") {
    if (url.startsWith("file://") || path.isAbsolute(url)) return url;
  }
  if (
    SCP_LIKE_REMOTE.test(url) ||
    SSH_REMOTE.test(url) ||
    HTTP_REMOTE.test(url)
  ) {
    return url;
  }
  throw new GitError(
    "Only https://, ssh:// and git@host:path repository URLs are supported",
  );
}

export function normalizeBranch(value) {
  const branch =
    typeof value === "string" && value.trim() ? value.trim() : DEFAULT_BRANCH;
  if (
    !BRANCH_PATTERN.test(branch) ||
    branch.endsWith("/") ||
    branch.endsWith(".lock")
  ) {
    throw new GitError("The branch name is invalid");
  }
  return branch;
}

export function normalizeDirectory(value) {
  const raw =
    typeof value === "string" ? value.trim().replace(/^\/+|\/+$/g, "") : "";
  if (!raw) return "";
  const segments = raw.split("/").filter(Boolean);
  if (segments.length > 10)
    throw new GitError("The repository path is too deep");
  for (const segment of segments) {
    if (
      segment === "." ||
      segment === ".." ||
      !DIRECTORY_SEGMENT.test(segment)
    ) {
      throw new GitError("The repository path is invalid");
    }
  }
  return segments.join("/");
}

export function slugifyFileName(value, fallback = "schema") {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

export function normalizeFileName(value, fallback = "schema") {
  const name =
    typeof value === "string" && value.trim() ? value.trim() : fallback;
  const stripped = name.replace(/\.(json|sql)$/i, "");
  if (!FILE_NAME_PATTERN.test(stripped)) {
    throw new GitError(
      "The file name may only contain letters, digits, dot, dash or underscore",
    );
  }
  return stripped;
}

export function normalizeSettings(input, { fallbackFileName } = {}) {
  if (!isPlainObject(input)) {
    throw new GitError("Repository settings are required");
  }
  const optional = (value, max) =>
    typeof value === "string" && value.trim()
      ? value.trim().slice(0, max)
      : null;

  const settings = {
    remoteUrl: normalizeRemoteUrl(input.remoteUrl),
    branch: normalizeBranch(input.branch),
    directory: normalizeDirectory(input.directory),
    fileName: normalizeFileName(input.fileName, fallbackFileName),
    authUsername: optional(input.authUsername, 100),
    authorName: optional(input.authorName, 100),
    authorEmail: optional(input.authorEmail, 200),
  };
  if (settings.authorEmail && !/^[^\s@]+@[^\s@]+$/.test(settings.authorEmail)) {
    throw new GitError("The author email is invalid");
  }
  if (input.token !== undefined && input.token !== null) {
    if (typeof input.token !== "string") {
      throw new GitError("The access token is invalid");
    }
    if (input.token.length > 500) {
      throw new GitError("The access token is too long");
    }
  }
  return settings;
}

export function redact(text, secrets = []) {
  let output = String(text ?? "");
  for (const secret of secrets) {
    if (secret && secret.length > 3) output = output.split(secret).join("***");
  }
  // Catches a token that git echoes back as part of a credentialed URL.
  return output.replace(/\/\/[^/@\s]*:[^/@\s]*@/g, "//***@");
}

export function withCredentials(remoteUrl, { authUsername, token } = {}) {
  if (!token || !HTTP_REMOTE.test(remoteUrl)) return remoteUrl;
  const url = new URL(remoteUrl);
  url.username = authUsername || DEFAULT_AUTH_USERNAME;
  url.password = token;
  return url.toString();
}

const FRIENDLY_ERRORS = [
  [
    /could not read Username|Authentication failed|invalid credentials|HTTP Basic: Access denied|terminal prompts disabled/i,
    "Authentication with the repository failed. Check the user name and access token.",
  ],
  [
    /Permission denied \(publickey\)|Host key verification failed/i,
    "SSH authentication failed. The server needs a key that can reach this repository.",
  ],
  [
    /Repository not found|does not appear to be a git repository|not found/i,
    "The repository was not found or is not accessible.",
  ],
  [
    /Could not resolve host|unable to access|Connection refused|Connection timed out/i,
    "The repository host could not be reached.",
  ],
  [
    /protected branch|hook declined|non-fast-forward|\[rejected\]/i,
    "The repository rejected the push. Check branch protection rules and try again.",
  ],
];

function friendlyMessage(details) {
  for (const [pattern, message] of FRIENDLY_ERRORS) {
    if (pattern.test(details)) return message;
  }
  return null;
}

/**
 * Runs git with prompts, credential helpers and system config disabled, so a
 * misconfigured remote fails fast instead of blocking a request forever.
 */
export async function git(
  args,
  { cwd, secrets = [], timeout = COMMAND_TIMEOUT_MS, author } = {},
) {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    LC_ALL: "C",
  };
  // Without this git can fall back to a GUI prompt and hang the request.
  delete env.GIT_ASKPASS;
  delete env.SSH_ASKPASS;
  delete env.DISPLAY;
  env.GIT_SSH_COMMAND = process.env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes";
  if (author) {
    env.GIT_AUTHOR_NAME = author.name;
    env.GIT_AUTHOR_EMAIL = author.email;
    env.GIT_COMMITTER_NAME = author.name;
    env.GIT_COMMITTER_EMAIL = author.email;
  }

  const options = [
    "-c",
    "credential.helper=",
    "-c",
    "core.autocrlf=false",
    "-c",
    "protocol.ext.allow=never",
    "-c",
    "advice.detachedHead=false",
  ];
  try {
    return await execFileAsync("git", [...options, ...args], {
      cwd,
      env,
      timeout,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const details = redact(
      `${error.stderr || ""}\n${error.stdout || ""}`.trim() || error.message,
      secrets,
    );
    const failure = new Error(details);
    failure.gitDetails = details;
    failure.killed = error.killed === true;
    throw failure;
  }
}

let gitAvailable = null;

export async function isGitAvailable() {
  if (gitAvailable === null) {
    try {
      await execFileAsync("git", ["--version"], {
        timeout: 10_000,
        windowsHide: true,
      });
      gitAvailable = true;
    } catch {
      gitAvailable = false;
    }
  }
  return gitAvailable;
}

export async function requireGit() {
  if (!(await isGitAvailable())) {
    throw new GitError(
      "git is not installed on the server, so repository sync is unavailable",
      { status: 503 },
    );
  }
}

export function toGitError(error) {
  if (isGitError(error)) return error;
  if (error.killed)
    return new GitError("The git command timed out", { status: 504 });
  const details = error.gitDetails ?? error.message;
  const friendly = friendlyMessage(details);
  if (friendly) return new GitError(friendly, { status: 502 });
  const firstLine = String(details)
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return new GitError(`git failed: ${firstLine || "unknown error"}`, {
    status: 502,
  });
}

export function isMissingRef(error) {
  return /couldn't find remote ref|no such ref|Remote branch .* not found/i.test(
    error.gitDetails ?? error.message ?? "",
  );
}

export function isPushRejected(error) {
  return /non-fast-forward|fetch first|\[rejected\]|stale info/i.test(
    error.gitDetails ?? error.message ?? "",
  );
}

/** Viewport state changes on every pan, so it never reaches a commit. */
export function committedDocument(document) {
  const copy = { ...document };
  delete copy.pan;
  delete copy.zoom;
  return copy;
}

export function serializeDiagramFile(name, document) {
  const payload = { name, document: committedDocument(document) };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function createGitStore(db) {
  const selectSecret = db.prepare(
    "SELECT value FROM app_secrets WHERE name = ?",
  );
  const insertSecret = db.prepare(
    "INSERT OR IGNORE INTO app_secrets (name, value, created_at) VALUES (?, ?, ?)",
  );

  // Tokens are encrypted with a key kept outside the diagram tables, so a
  // leaked database dump alone does not hand over repository write access.
  const encryptionKey = () => {
    if (process.env.GIT_SECRET_KEY) {
      return crypto
        .createHash("sha256")
        .update(process.env.GIT_SECRET_KEY)
        .digest();
    }
    const existing = selectSecret.get("git_token_key");
    if (existing) return Buffer.from(existing.value, "hex");
    insertSecret.run(
      "git_token_key",
      crypto.randomBytes(32).toString("hex"),
      new Date().toISOString(),
    );
    return Buffer.from(selectSecret.get("git_token_key").value, "hex");
  };

  const encrypt = (value) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const payload = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), payload]
      .map((part) => part.toString("base64"))
      .join(".");
  };

  const decrypt = (stored) => {
    if (!stored) return null;
    const [iv, tag, payload] = String(stored).split(".");
    if (!iv || !tag || !payload) return null;
    try {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        encryptionKey(),
        Buffer.from(iv, "base64"),
      );
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(payload, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // A rotated key leaves old ciphertext unreadable; treat it as absent.
      return null;
    }
  };

  const selectOne = db.prepare(
    "SELECT * FROM diagram_git_settings WHERE diagram_id = ?",
  );

  const toSettings = (row) =>
    row
      ? {
          diagramId: row.diagram_id,
          remoteUrl: row.remote_url,
          branch: row.branch,
          directory: row.directory,
          fileName: row.file_name,
          authUsername: row.auth_username,
          authorName: row.author_name,
          authorEmail: row.author_email,
          hasToken: Boolean(row.token_cipher),
          lastCommit: row.last_commit,
          lastCommitMessage: row.last_commit_message,
          lastSyncedAt: row.last_synced_at,
          updatedAt: row.updated_at,
        }
      : null;

  return {
    get(diagramId) {
      return toSettings(selectOne.get(diagramId));
    },

    token(diagramId) {
      return decrypt(selectOne.get(diagramId)?.token_cipher);
    },

    save(diagramId, settings, { token } = {}) {
      const now = new Date().toISOString();
      const current = selectOne.get(diagramId);
      // An omitted token keeps the stored one; an empty string clears it.
      const tokenCipher =
        token === undefined
          ? current?.token_cipher ?? null
          : token
            ? encrypt(token)
            : null;
      db.prepare(
        `INSERT INTO diagram_git_settings (
           diagram_id, remote_url, branch, directory, file_name, auth_username,
           token_cipher, author_name, author_email, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(diagram_id) DO UPDATE SET
           remote_url = excluded.remote_url,
           branch = excluded.branch,
           directory = excluded.directory,
           file_name = excluded.file_name,
           auth_username = excluded.auth_username,
           token_cipher = excluded.token_cipher,
           author_name = excluded.author_name,
           author_email = excluded.author_email,
           updated_at = excluded.updated_at`,
      ).run(
        diagramId,
        settings.remoteUrl,
        settings.branch,
        settings.directory,
        settings.fileName,
        settings.authUsername,
        tokenCipher,
        settings.authorName,
        settings.authorEmail,
        current?.created_at ?? now,
        now,
      );
      return toSettings(selectOne.get(diagramId));
    },

    recordSync(diagramId, { commit, message }) {
      db.prepare(
        "UPDATE diagram_git_settings SET last_commit = ?, last_commit_message = ?, last_synced_at = ? WHERE diagram_id = ?",
      ).run(
        commit ?? null,
        message ?? null,
        new Date().toISOString(),
        diagramId,
      );
    },

    delete(diagramId) {
      return (
        db
          .prepare("DELETE FROM diagram_git_settings WHERE diagram_id = ?")
          .run(diagramId).changes > 0
      );
    },
  };
}
