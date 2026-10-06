import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  clearedSessionCookie,
  createAuthStore,
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

function parseTrustProxy(value) {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  const hops = Number(value);
  return Number.isInteger(hops) && hops >= 0 ? hops : value;
}

export function createApplication({ databasePath, staticPath } = {}) {
  const database = openDatabase(databasePath);
  const store = createDiagramStore(database);
  const auth = createAuthStore(database);
  const gitSync = createGitSyncService({
    db: database,
    store,
    rootDir: defaultGitRoot(databasePath),
  });
  const loginThrottle = createLoginThrottle();
  const app = express();
  app.disable("x-powered-by");
  // Only trust X-Forwarded-* when a reverse proxy really sits in front.
  // Trusting it on a directly exposed port lets clients spoof their IP and
  // sidestep the login throttle. Set TRUST_PROXY=1 behind Caddy/nginx/Traefik.
  app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
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

  // Self-service registration exists only to claim the empty instance. The
  // first account becomes the administrator; everyone else is created by them.
  app.get("/api/auth/status", (_req, res) =>
    res.json({ setupRequired: auth.countUsers() === 0 }),
  );

  app.post("/api/auth/register", async (req, res, next) => {
    try {
      if (auth.countUsers() > 0) {
        res.status(403).json({
          error: "Registration is closed. Ask an administrator for an account.",
        });
        return;
      }
      if (!credentials(req.body)) {
        res.status(400).json({ error: CREDENTIALS_ERROR });
        return;
      }
      const result = await auth.createUser({
        username: req.body.username,
        password: req.body.password,
        isAdmin: true,
        requireEmpty: true,
      });
      if (result.status === "already_initialized") {
        res.status(403).json({
          error: "Registration is closed. Ask an administrator for an account.",
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

  app.post("/api/auth/login", async (req, res, next) => {
    try {
      if (!isPlainObject(req.body)) {
        res.status(400).json({ error: "A username and password are required" });
        return;
      }
      const throttleKey = `${req.ip}:${String(req.body.username).toLowerCase()}`;
      const throttle = loginThrottle.check(throttleKey);
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

  auth.pruneExpiredSessions();
  const sessionSweep = setInterval(
    () => auth.pruneExpiredSessions(),
    60 * 60 * 1000,
  );
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
