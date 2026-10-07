import fs from "node:fs";
import path from "node:path";
import {
  createGitStore,
  credentialConfig,
  git,
  GitError,
  isMissingRef,
  isPushRejected,
  normalizeSettings,
  requireGit,
  serializeDiagramFile,
  slugifyFileName,
  toGitError,
} from "./git.js";
import { DIAGRAM_ID_PATTERN, isPlainObject } from "./protocol.js";

/* global process, Buffer */

const NETWORK_TIMEOUT_MS = 120_000;
const HISTORY_DEPTH = 50;
const MAX_HISTORY = 20;
const MAX_SQL_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 500;
const UNIT_SEPARATOR = "\u001f";

export function defaultGitRoot(databasePath) {
  if (process.env.GIT_WORKDIR) return path.resolve(process.env.GIT_WORKDIR);
  const configured = databasePath || process.env.DATABASE_PATH;
  if (!configured || configured === ":memory:") {
    return path.resolve("data/git");
  }
  return path.join(path.dirname(path.resolve(configured)), "git");
}

function commitMessage(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new GitError("The commit message is too long");
  }
  // Control characters have no place in a commit subject, and a leading dash
  // would be read as an option by git.
  const printable = Array.from(text)
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f ? " " : character;
    })
    .join("");
  return printable.replace(/^-+/, "").trim();
}

/**
 * Server-side git sync for a diagram: the current schema is written into a
 * working copy of the configured repository and pushed as an ordinary commit,
 * and the same files can be read back to restore the diagram.
 */
export function createGitSyncService({ db, store, rootDir }) {
  const settingsStore = createGitStore(db);
  const root = rootDir;
  // One repository is one working copy, so overlapping requests for the same
  // diagram are serialized instead of fighting over the index.
  const queues = new Map();

  const serialize = (diagramId, task) => {
    const previous = queues.get(diagramId) ?? Promise.resolve();
    const next = previous.then(task, task);
    queues.set(
      diagramId,
      next
        .catch(() => {})
        .finally(() => {
          if (queues.get(diagramId) === next) queues.delete(diagramId);
        }),
    );
    return next;
  };

  const repositoryPath = (diagramId) => {
    if (!DIAGRAM_ID_PATTERN.test(diagramId)) {
      throw new GitError("Invalid diagram ID");
    }
    return path.join(root, diagramId);
  };

  const configFor = (diagramId) => {
    const settings = settingsStore.get(diagramId);
    if (!settings) {
      throw new GitError("This diagram is not connected to a repository", {
        status: 404,
      });
    }
    const token = settingsStore.token(diagramId);
    const { config, secrets } = credentialConfig(settings.remoteUrl, {
      authUsername: settings.authUsername,
      token,
    });
    return { settings, url: settings.remoteUrl, config, secrets };
  };

  const filePaths = (settings) => {
    const prefix = settings.directory ? `${settings.directory}/` : "";
    return {
      json: `${prefix}${settings.fileName}.json`,
      sql: `${prefix}${settings.fileName}.sql`,
    };
  };

  /**
   * Brings the working copy to the tip of the remote branch. Returns null when
   * the branch does not exist yet, which is the normal state of a fresh repo.
   */
  const prepare = async (diagramId, { settings, url, secrets, config }) => {
    const dir = repositoryPath(diagramId);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(path.join(dir, ".git"))) {
      await git(["init", "-q"], { cwd: dir });
    }
    const branchRef = `refs/heads/${settings.branch}`;
    await git(["symbolic-ref", "HEAD", branchRef], { cwd: dir });

    let head = null;
    try {
      await git(
        [
          "fetch",
          "--depth",
          String(HISTORY_DEPTH),
          "--no-tags",
          "--force",
          url,
          `+${branchRef}:refs/remotes/origin/${settings.branch}`,
        ],
        { cwd: dir, secrets, config, timeout: NETWORK_TIMEOUT_MS },
      );
      head = (
        await git(["rev-parse", `refs/remotes/origin/${settings.branch}`], {
          cwd: dir,
        })
      ).stdout.trim();
    } catch (error) {
      if (!isMissingRef(error)) throw error;
    }

    if (head) {
      await git(["update-ref", branchRef, head], { cwd: dir });
      await git(["reset", "-q", "--hard", head], { cwd: dir });
    } else {
      await git(["update-ref", "-d", branchRef], { cwd: dir }).catch(() => {});
      await git(["read-tree", "--empty"], { cwd: dir });
    }
    await git(["clean", "-qfdx"], { cwd: dir });
    return { dir, head };
  };

  // Symbolic links are checked out as plain files (core.symlinks=false), but
  // a working copy left by an older version could still hold one; refusing to
  // follow any keeps a repository from pointing our writes outside it.
  const assertNoLinks = (dir, relativePath) => {
    let current = dir;
    for (const segment of relativePath.split("/")) {
      current = path.join(current, segment);
      let stat;
      try {
        stat = fs.lstatSync(current);
      } catch {
        return;
      }
      if (stat.isSymbolicLink()) {
        throw new GitError(
          `${relativePath} is a symbolic link in the repository; refusing to use it`,
        );
      }
    }
  };

  const writeSchemaFiles = (dir, settings, { name, document, sql }) => {
    const paths = filePaths(settings);
    assertNoLinks(dir, paths.json);
    assertNoLinks(dir, paths.sql);
    const target = settings.directory
      ? path.join(dir, settings.directory)
      : dir;
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(
      path.join(dir, paths.json),
      serializeDiagramFile(name, document),
      "utf8",
    );
    const written = [paths.json];
    if (typeof sql === "string" && sql.trim()) {
      const body = sql.endsWith("\n") ? sql : `${sql}\n`;
      fs.writeFileSync(path.join(dir, paths.sql), body, "utf8");
      written.push(paths.sql);
    }
    return written;
  };

  const commitAndPush = async (
    diagramId,
    { settings, url, secrets, config },
    { name, document, sql, message, author },
  ) => {
    const { dir } = await prepare(diagramId, {
      settings,
      url,
      secrets,
      config,
    });
    const files = writeSchemaFiles(dir, settings, { name, document, sql });

    await git(["add", "-A", "--", "."], { cwd: dir });
    const staged = (
      await git(["diff", "--cached", "--name-only"], { cwd: dir })
    ).stdout.trim();
    if (!staged) return { status: "unchanged", files };

    await git(["commit", "-q", "-m", message], { cwd: dir, author });
    const commit = (
      await git(["rev-parse", "HEAD"], { cwd: dir })
    ).stdout.trim();
    await git(["push", url, `HEAD:refs/heads/${settings.branch}`], {
      cwd: dir,
      secrets,
      config,
      timeout: NETWORK_TIMEOUT_MS,
    });
    return { status: "pushed", commit, files, message };
  };

  const readHistory = async (dir, settings, hasHead) => {
    if (!hasHead) return [];
    const format = ["%H", "%an", "%aI", "%s"].join("%x1f");
    const scope = settings.directory ? ["--", settings.directory] : [];
    const { stdout } = await git(
      ["log", `--format=${format}`, "-n", String(MAX_HISTORY), ...scope],
      { cwd: dir },
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [commit, author, date, subject] = line.split(UNIT_SEPARATOR);
        return { commit, author, date, message: subject };
      });
  };

  return {
    settings: (diagramId) => settingsStore.get(diagramId),

    async save(diagramId, input, { diagramName } = {}) {
      const settings = normalizeSettings(input, {
        fallbackFileName: slugifyFileName(diagramName),
      });
      const token =
        input.token === undefined
          ? undefined
          : String(input.token ?? "").trim();
      return settingsStore.save(diagramId, settings, { token });
    },

    delete(diagramId) {
      const removed = settingsStore.delete(diagramId);
      // The working copy holds nothing that is not in the repository.
      fs.rmSync(repositoryPath(diagramId), { recursive: true, force: true });
      return removed;
    },

    async test(diagramId) {
      await requireGit();
      const config = configFor(diagramId);
      return serialize(diagramId, async () => {
        try {
          const { stdout } = await git(
            ["ls-remote", "--heads", config.url, config.settings.branch],
            {
              secrets: config.secrets,
              config: config.config,
              timeout: NETWORK_TIMEOUT_MS,
            },
          );
          return {
            reachable: true,
            branchExists: stdout.trim().length > 0,
            branch: config.settings.branch,
          };
        } catch (error) {
          throw toGitError(error);
        }
      });
    },

    async push(diagramId, { sql, message, user } = {}) {
      await requireGit();
      const diagram = store.get(diagramId);
      if (!diagram) throw new GitError("Diagram not found", { status: 404 });
      if (typeof sql === "string" && Buffer.byteLength(sql) > MAX_SQL_BYTES) {
        throw new GitError("The generated SQL is too large to commit");
      }
      const config = configFor(diagramId);
      const author = {
        name: config.settings.authorName || user?.username || "drawDB",
        email:
          config.settings.authorEmail ||
          `${user?.username || "drawdb"}@drawdb.local`,
      };
      const payload = {
        name: diagram.name,
        document: diagram.document,
        sql,
        message: commitMessage(message, `Update ${diagram.name} schema`),
        author,
      };

      return serialize(diagramId, async () => {
        try {
          let result;
          try {
            result = await commitAndPush(diagramId, config, payload);
          } catch (error) {
            // Someone else pushed between the fetch and the push; rebuilding
            // the commit on the new tip is enough because these files are
            // generated wholesale from the diagram.
            if (!isPushRejected(error)) throw error;
            result = await commitAndPush(diagramId, config, payload);
          }
          if (result.status === "pushed") {
            settingsStore.recordSync(diagramId, {
              commit: result.commit,
              message: result.message,
            });
          }
          return {
            ...result,
            version: diagram.version,
            settings: settingsStore.get(diagramId),
          };
        } catch (error) {
          throw toGitError(error);
        }
      });
    },

    async pull(diagramId) {
      await requireGit();
      const config = configFor(diagramId);
      const paths = filePaths(config.settings);
      return serialize(diagramId, async () => {
        let dir;
        let head;
        try {
          ({ dir, head } = await prepare(diagramId, config));
        } catch (error) {
          throw toGitError(error);
        }
        if (!head) {
          throw new GitError(
            `Branch "${config.settings.branch}" has no commits yet`,
            { status: 404 },
          );
        }
        assertNoLinks(dir, paths.json);
        const file = path.join(dir, paths.json);
        if (!fs.existsSync(file)) {
          throw new GitError(`${paths.json} was not found in the repository`, {
            status: 404,
          });
        }
        if (fs.statSync(file).size > MAX_FILE_BYTES) {
          throw new GitError("The diagram file in the repository is too large");
        }
        let parsed;
        try {
          parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch {
          throw new GitError(`${paths.json} is not valid JSON`);
        }
        const document = isPlainObject(parsed?.document)
          ? parsed.document
          : isPlainObject(parsed) && Array.isArray(parsed.tables)
            ? parsed
            : null;
        if (!document) {
          throw new GitError(`${paths.json} does not contain a diagram`);
        }
        return {
          name: typeof parsed.name === "string" ? parsed.name : null,
          document,
          commit: head,
          file: paths.json,
        };
      });
    },

    async history(diagramId) {
      await requireGit();
      const config = configFor(diagramId);
      return serialize(diagramId, async () => {
        try {
          const { dir, head } = await prepare(diagramId, config);
          return {
            commits: await readHistory(dir, config.settings, Boolean(head)),
          };
        } catch (error) {
          throw toGitError(error);
        }
      });
    },
  };
}
