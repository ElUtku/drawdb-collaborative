import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  clearedSessionCookie,
  createAuthStore,
  createSetupCode,
  createLoginThrottle,
  isValidPassword,
  isValidUsername,
  parseCookies,
  sessionCookie,
  SESSION_COOKIE,
} from "./auth.js";
import { createDiagramStore, openDatabase } from "./database.js";
import { isGitAvailable, isGitError } from "./git.js";
import { createGitSyncService, defaultGitRoot } from "./gitSync.js";
import { DIAGRAM_ID_PATTERN, isPlainObject } from "./protocol.js";
import { attachCollaborationServer } from "./websocket.js";

/* global process */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_DOCUMENT_BYTES = "2mb";

const ENCODINGS = [
  ["br", ".br"],
  ["gzip", ".gz"],
];
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

// `npm run build` leaves .br/.gz siblings next to every text asset. Point the
// request at one of them when the client accepts it; without this the bundle
// goes over the wire uncompressed.
function servePrecompressed(assets) {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    const [pathname] = req.url.split("?");
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      next();
      return;
    }
    if (!CONTENT_TYPES[path.extname(decoded).toLowerCase()]) {
      next();
      return;
    }
    const target = path.join(assets, decoded);
    if (target !== assets && !target.startsWith(assets + path.sep)) {
      next();
      return;
    }
    const accepted = String(req.headers["accept-encoding"] || "");
    for (const [encoding, extension] of ENCODINGS) {
      if (!accepted.includes(encoding)) continue;
      if (!fs.existsSync(target + extension)) continue;
      req.url = pathname + extension;
      break;
    }
    next();
  };
}

function setAssetHeaders(res, filePath) {
  const encoding = ENCODINGS.find(([, extension]) =>
    filePath.endsWith(extension),
  );
  const original = encoding ? filePath.slice(0, -encoding[1].length) : filePath;
  const contentType = CONTENT_TYPES[path.extname(original).toLowerCase()];

  res.setHeader("Vary", "Accept-Encoding");
  if (contentType) res.setHeader("Content-Type", contentType);
  if (encoding) res.setHeader("Content-Encoding", encoding[0]);

  // Vite fingerprints everything under assets/, so those may be cached forever;
  // index.html must always be revalidated or clients keep the old hashes.
  if (original.endsWith(".html")) {
    res.setHeader("Cache-Control", "no-cache");
  } else if (path.dirname(original).endsWith(`${path.sep}assets`)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
}

/**
 * Only this server's own scripts, styles, images and sockets. Semi UI sets
 * inline styles, hence 'unsafe-inline' for styles (never for scripts); Monaco
 * and the image export use workers and blob/data URLs from the page itself.
 */
function contentSecurityPolicy(req) {
  const host = String(req.headers.host ?? "");
  const sockets = /^[A-Za-z0-9.:[\]-]+$/.test(host)
    ? ` ws://${host} wss://${host}`
    : "";
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${sockets}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");
}

const SOURCE_ARCHIVE_NAME = "drawdb-collaborative-source.tar.gz";

/**
 * AGPL-3.0 section 13: everyone who uses the program over the network may
 * get its source. The Docker image carries an archive of the exact source it
 * was built from, so this works on a server without Internet access too.
 */
function sourcePage(hasArchive) {
  const download = hasArchive
    ? `<p><a href="/source/${SOURCE_ARCHIVE_NAME}">Download the source code of this server (.tar.gz)</a></p>`
    : "<p>This server was started without a source archive. The source is the one of the repository it was built from.</p>";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Source code</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5">
<h1>Source code</h1>
<p>This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License, version 3, as published by the Free Software Foundation. It comes with no warranty.</p>
${download}
<p>It is a modified version of drawDB (https://github.com/drawdb-io/drawdb). The licences of the libraries it includes are listed in <a href="/third-party-licenses.txt">third-party-licenses.txt</a>.</p>
</body>
</html>
`;
}

function parseTrustProxy(value) {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  const hops = Number(value);
  return Number.isInteger(hops) && hops >= 0 ? hops : value;
}

export function createApplication({
  databasePath,
  staticPath,
  setupCode,
  log = console.log,
} = {}) {
  const database = openDatabase(databasePath);
  const store = createDiagramStore(database);
  const auth = createAuthStore(database);
  // Until the administrator exists, creating it takes a code that only someone
  // with access to the server (its log or its configuration) can know.
  const setup = createSetupCode(setupCode);
  if (auth.countUsers() === 0) {
    log(
      `No accounts yet. Setup code for the administrator account: ${setup.code}`,
    );
  }
  const gitSync = createGitSyncService({
    db: database,
    store,
    rootDir: defaultGitRoot(databasePath),
  });
  const loginThrottle = createLoginThrottle();
  // Also caps failed sign-ins per address across all usernames, so one source
  // cannot try a few passwords on every account.
  const loginIpThrottle = createLoginThrottle({ maxAttempts: 50 });
  // Caps self-service sign-ups per client IP (5 per hour) when registration is open.
  const registerThrottle = createLoginThrottle({
    maxAttempts: 5,
    windowMs: 60 * 60 * 1000,
  });
  const passwordThrottle = createLoginThrottle();
  const openRegistration = /^(1|true|yes)$/i.test(
    process.env.OPEN_REGISTRATION || "",
  );
  const app = express();
  app.disable("x-powered-by");
  // Only trust X-Forwarded-* when a reverse proxy really sits in front.
  // Trusting it on a directly exposed port lets clients spoof their IP and
  // sidestep the login throttle. Set TRUST_PROXY=1 behind Caddy/nginx/Traefik.
  app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    res.setHeader("Content-Security-Policy", contentSecurityPolicy(req));
    next();
  });
  app.use(express.json({ limit: MAX_DOCUMENT_BYTES }));

  const validId = (req, res, next) => {
    if (!DIAGRAM_ID_PATTERN.test(req.params.id || "")) {
      res.status(400).json({ error: "Invalid diagram ID" });
      return;
    }
    next();
  };
  const validPayload = (body) =>
    isPlainObject(body) &&
    typeof body.name === "string" &&
    body.name.trim().length > 0 &&
    body.name.length <= 200 &&
    isPlainObject(body.document);

  const startSession = (req, res, user) => {
    const { token, expiresAt } = auth.createSession(user.id);
    res.setHeader(
      "Set-Cookie",
      sessionCookie(token, { secure: req.secure, expiresAt }),
    );
  };

  const requireAuth = (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const session = auth.resolveSession(token);
    if (!session) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (session.renewedUntil) {
      res.setHeader(
        "Set-Cookie",
        sessionCookie(token, {
          secure: req.secure,
          expiresAt: session.renewedUntil,
        }),
      );
    }
    req.user = session.user;
    next();
  };

  const requireAdmin = (req, res, next) => {
    if (!req.user.isAdmin) {
      res.status(403).json({ error: "Administrator access is required" });
      return;
    }
    next();
  };

  const credentials = (body) =>
    isPlainObject(body) &&
    isValidUsername(body.username) &&
    isValidPassword(body.password);

  const CREDENTIALS_ERROR =
    "A username of 3-32 letters, digits, dot, dash or underscore and a password of at least 8 characters are required";

  // The first account always claims the empty instance and becomes the
  // administrator. After that, sign-up stays closed unless OPEN_REGISTRATION
  // is enabled, in which case anyone can create a regular (non-admin) account.
  app.get("/api/auth/status", (_req, res) =>
    res.json({
      setupRequired: auth.countUsers() === 0,
      registrationOpen: openRegistration,
    }),
  );

  app.post("/api/auth/register", async (req, res, next) => {
    try {
      const bootstrap = auth.countUsers() === 0;
      if (!bootstrap && !openRegistration) {
        res.status(403).json({
          error: "Registration is closed. Ask an administrator for an account.",
        });
        return;
      }
      if (!credentials(req.body)) {
        res.status(400).json({ error: CREDENTIALS_ERROR });
        return;
      }
      const throttleKey = `register:${req.ip}`;
      const throttle = registerThrottle.check(throttleKey);
      if (!throttle.allowed) {
        res.setHeader("Retry-After", String(throttle.retryAfterSeconds));
        res.status(429).json({ error: "Too many attempts. Try again later." });
        return;
      }
      registerThrottle.fail(throttleKey);
      if (bootstrap && !setup.matches(req.body.setupCode)) {
        res.status(403).json({
          error:
            "The setup code is not correct. It is printed in the server log when the server starts without accounts.",
        });
        return;
      }
      const result = await auth.createUser({
        username: req.body.username,
        password: req.body.password,
        isAdmin: bootstrap,
        requireEmpty: bootstrap,
      });
      if (result.status === "already_initialized") {
        res.status(409).json({
          error:
            "The administrator account was just created. Sign in or try again.",
        });
        return;
      }
      if (result.status === "taken") {
        res.status(409).json({ error: "Username is already taken" });
        return;
      }
      startSession(req, res, result.user);
      res.status(201).json({ user: result.user });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/users", requireAuth, requireAdmin, (_req, res) =>
    res.json({ users: auth.listUsers() }),
  );

  app.post(
    "/api/admin/users",
    requireAuth,
    requireAdmin,
    async (req, res, next) => {
      try {
        if (!credentials(req.body)) {
          res.status(400).json({ error: CREDENTIALS_ERROR });
          return;
        }
        // Administrator status is not transferable: accounts made here are plain
        // users regardless of what the request body asks for.
        const result = await auth.createUser({
          username: req.body.username,
          password: req.body.password,
        });
        if (result.status === "taken") {
          res.status(409).json({ error: "Username is already taken" });
          return;
        }
        res.status(201).json({ user: result.user });
      } catch (error) {
        next(error);
      }
    },
  );

  app.put(
    "/api/admin/users/:userId/password",
    requireAuth,
    requireAdmin,
    async (req, res, next) => {
      try {
        const password = isPlainObject(req.body) ? req.body.password : null;
        if (!isValidPassword(password)) {
          res
            .status(400)
            .json({ error: "A password of at least 8 characters is required" });
          return;
        }
        const result = await auth.resetPassword({
          userId: String(req.params.userId),
          newPassword: password,
        });
        if (result.status !== "changed") {
          res.status(404).json({ error: "Account not found" });
          return;
        }
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  app.post("/api/auth/login", async (req, res, next) => {
    try {
      if (!isPlainObject(req.body)) {
        res.status(400).json({ error: "A username and password are required" });
        return;
      }
      const throttleKey = `${req.ip}:${String(req.body.username).toLowerCase()}`;
      const ipKey = `ip:${req.ip}`;
      const throttle = loginThrottle.check(throttleKey);
      const ipThrottle = loginIpThrottle.check(ipKey);
      if (!ipThrottle.allowed) {
        res.setHeader("Retry-After", String(ipThrottle.retryAfterSeconds));
        res.status(429).json({ error: "Too many attempts. Try again later." });
        return;
      }
      if (!throttle.allowed) {
        res.setHeader("Retry-After", String(throttle.retryAfterSeconds));
        res.status(429).json({ error: "Too many attempts. Try again later." });
        return;
      }
      const user = credentials(req.body)
        ? await auth.verifyCredentials(req.body)
        : null;
      if (!user) {
        loginThrottle.fail(throttleKey);
        loginIpThrottle.fail(ipKey);
        res.status(401).json({ error: "Invalid username or password" });
        return;
      }
      loginThrottle.succeed(throttleKey);
      startSession(req, res, user);
      res.json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    auth.deleteSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    res.setHeader("Set-Cookie", clearedSessionCookie({ secure: req.secure }));
    res.status(204).end();
  });

  app.get("/api/auth/me", requireAuth, (req, res) =>
    res.json({ user: req.user }),
  );

  app.post("/api/auth/password", requireAuth, async (req, res, next) => {
    try {
      const body = isPlainObject(req.body) ? req.body : {};
      if (
        typeof body.currentPassword !== "string" ||
        !isValidPassword(body.newPassword)
      ) {
        res.status(400).json({
          error:
            "The current password and a new password of at least 8 characters are required",
        });
        return;
      }
      const throttleKey = `password:${req.user.id}`;
      const throttle = passwordThrottle.check(throttleKey);
      if (!throttle.allowed) {
        res.setHeader("Retry-After", String(throttle.retryAfterSeconds));
        res.status(429).json({ error: "Too many attempts. Try again later." });
        return;
      }
      const result = await auth.changePassword({
        userId: req.user.id,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        keepToken: parseCookies(req.headers.cookie)[SESSION_COOKIE],
      });
      if (result.status === "invalid_password") {
        passwordThrottle.fail(throttleKey);
        res.status(403).json({ error: "The current password is incorrect" });
        return;
      }
      if (result.status !== "changed") {
        res.status(404).json({ error: "Account not found" });
        return;
      }
      passwordThrottle.succeed(throttleKey);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/diagrams", requireAuth, (req, res) =>
    res.json({ diagrams: store.list(req.user.id) }),
  );
  app.post("/api/diagrams", requireAuth, (req, res, next) => {
    try {
      if (!validPayload(req.body)) {
        res
          .status(400)
          .json({ error: "A valid name and document are required" });
        return;
      }
      const requestedId = req.body.id;
      const id = requestedId ?? crypto.randomUUID();
      if (!DIAGRAM_ID_PATTERN.test(id)) {
        res.status(400).json({ error: "Invalid diagram ID" });
        return;
      }
      if (store.get(id)) {
        res.status(409).json({ error: "Diagram already exists" });
        return;
      }
      res
        .status(201)
        .json(store.create({ ...req.body, id, ownerId: req.user.id }));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/diagrams/:id", requireAuth, validId, (req, res) => {
    const diagram = store.get(req.params.id);
    if (!diagram) res.status(404).json({ error: "Diagram not found" });
    else res.json(diagram);
  });
  app.put("/api/diagrams/:id", requireAuth, validId, (req, res) => {
    if (!validPayload(req.body) || !Number.isInteger(req.body.baseVersion)) {
      res.status(400).json({
        error: "A valid name, document, and baseVersion are required",
      });
      return;
    }
    const result = store.updateSnapshot({ id: req.params.id, ...req.body });
    if (result.status === "not_found")
      res.status(404).json({ error: "Diagram not found" });
    else if (result.status === "conflict") {
      res
        .status(409)
        .json({ error: "Version conflict", diagram: result.diagram });
    } else res.json(result.diagram);
  });
  app.delete("/api/diagrams/:id", requireAuth, validId, (req, res) => {
    const diagram = store.get(req.params.id);
    if (!diagram) {
      res.status(404).json({ error: "Diagram not found" });
      return;
    }
    // Anyone with the link may edit, but only the owner may delete.
    if (diagram.owner_id && diagram.owner_id !== req.user.id) {
      res.status(403).json({ error: "Only the owner can delete this diagram" });
      return;
    }
    store.delete(req.params.id);
    res.status(204).end();
  });

  // Repository sync. Anyone who can edit a diagram may push it or pull it back,
  // but only the owner may point it at a repository, because the settings carry
  // a credential.
  const withDiagram = (req, res, next) => {
    const diagram = store.get(req.params.id);
    if (!diagram) {
      res.status(404).json({ error: "Diagram not found" });
      return;
    }
    req.diagram = diagram;
    next();
  };
  const requireDiagramOwner = (req, res, next) => {
    if (req.diagram.owner_id && req.diagram.owner_id !== req.user.id) {
      res
        .status(403)
        .json({ error: "Only the owner can configure repository sync" });
      return;
    }
    next();
  };
  const gitRoute = (handler) => async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (isGitError(error)) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    }
  };
  const gitGuards = [requireAuth, validId, withDiagram];

  app.get(
    "/api/diagrams/:id/git",
    ...gitGuards,
    gitRoute(async (req, res) => {
      res.json({
        available: await isGitAvailable(),
        canConfigure:
          !req.diagram.owner_id || req.diagram.owner_id === req.user.id,
        settings: gitSync.settings(req.params.id),
      });
    }),
  );

  app.put(
    "/api/diagrams/:id/git",
    ...gitGuards,
    requireDiagramOwner,
    gitRoute(async (req, res) => {
      const settings = await gitSync.save(req.params.id, req.body ?? {}, {
        diagramName: req.diagram.name,
      });
      res.json({ settings });
    }),
  );

  app.delete(
    "/api/diagrams/:id/git",
    ...gitGuards,
    requireDiagramOwner,
    gitRoute(async (req, res) => {
      gitSync.delete(req.params.id);
      res.status(204).end();
    }),
  );

  app.post(
    "/api/diagrams/:id/git/test",
    ...gitGuards,
    gitRoute(async (req, res) => {
      res.json(await gitSync.test(req.params.id));
    }),
  );

  app.get(
    "/api/diagrams/:id/git/history",
    ...gitGuards,
    gitRoute(async (req, res) => {
      res.json(await gitSync.history(req.params.id));
    }),
  );

  app.post(
    "/api/diagrams/:id/git/push",
    ...gitGuards,
    gitRoute(async (req, res) => {
      const body = isPlainObject(req.body) ? req.body : {};
      res.json(
        await gitSync.push(req.params.id, {
          sql: typeof body.sql === "string" ? body.sql : undefined,
          message: body.message,
          user: req.user,
        }),
      );
    }),
  );

  app.post(
    "/api/diagrams/:id/git/pull",
    ...gitGuards,
    gitRoute(async (req, res) => {
      const pulled = await gitSync.pull(req.params.id);
      const result = store.updateSnapshot({
        id: req.params.id,
        name: pulled.name ?? req.diagram.name,
        document: pulled.document,
        baseVersion: req.diagram.version,
      });
      if (result.status !== "updated") {
        res.status(409).json({
          error: "The diagram changed while it was being pulled. Try again.",
          diagram: result.diagram,
        });
        return;
      }
      // Everyone with the diagram open is holding the pre-pull snapshot.
      websocket.broadcastSnapshot(req.params.id, result.diagram);
      res.json({
        diagram: result.diagram,
        commit: pulled.commit,
        file: pulled.file,
      });
    }),
  );

  const sourceArchive =
    process.env.SOURCE_ARCHIVE ||
    path.resolve(__dirname, "../source", SOURCE_ARCHIVE_NAME);
  app.get("/source", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(sourcePage(fs.existsSync(sourceArchive)));
  });
  app.get(`/source/${SOURCE_ARCHIVE_NAME}`, (_req, res) => {
    if (!fs.existsSync(sourceArchive)) {
      res.status(404).json({ error: "No source archive on this server" });
      return;
    }
    res.download(sourceArchive, SOURCE_ARCHIVE_NAME);
  });

  const assets = staticPath || path.resolve(__dirname, "../dist");
  if (fs.existsSync(assets)) {
    app.use(servePrecompressed(assets));
    app.use(express.static(assets, { setHeaders: setAssetHeaders }));
    app.get("*splat", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(assets, "index.html"));
    });
  }
  app.use((error, _req, res, next) => {
    void next;
    console.error("Request failed:", error.message);
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "Request body is too large" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  const server = http.createServer(app);
  const websocket = attachCollaborationServer(server, store, auth);

  const OPERATION_RETENTION_MS = 24 * 60 * 60 * 1000;
  const sweep = () => {
    auth.pruneExpiredSessions();
    store.pruneOperations(new Date(Date.now() - OPERATION_RETENTION_MS));
  };
  sweep();
  const sessionSweep = setInterval(sweep, 60 * 60 * 1000);
  sessionSweep.unref();
  server.on("close", () => clearInterval(sessionSweep));

  return { app, server, websocket, database, store, auth };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  const { server } = createApplication();
  server.listen(port, "0.0.0.0", () => {
    console.log(`drawDB listening on http://0.0.0.0:${port}`);
  });
}
