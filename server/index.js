import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createAuditLog } from "./audit.js";
import { createAuthStore, createSetupCode } from "./auth.js";
import { createBackupService } from "./backup.js";
import { createCustomTypeStore } from "./customTypes.js";
import { createDiagramStore, LINK_ACCESS, openDatabase } from "./database.js";
import { createDiagramService } from "./diagramService.js";
import { createGitSyncService, defaultGitRoot } from "./gitSync.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerDiagramRoutes } from "./routes/diagrams.js";
import { createGuards } from "./routes/guards.js";
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

const numberEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return process.env[name] !== undefined &&
    process.env[name] !== "" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : fallback;
};

export function createApplication({
  databasePath,
  staticPath,
  setupCode,
  log = console.log,
  backupDirectory,
} = {}) {
  const resolvedDatabasePath = databasePath ?? process.env.DATABASE_PATH;
  const database = openDatabase(resolvedDatabasePath);
  const defaultLinkAccess = LINK_ACCESS.includes(
    process.env.DEFAULT_LINK_ACCESS,
  )
    ? process.env.DEFAULT_LINK_ACCESS
    : "none";
  const store = createDiagramStore(database, {
    historyIntervalMs: numberEnv("HISTORY_INTERVAL_MINUTES", 10) * 60_000,
    historyLimit: Math.max(1, numberEnv("HISTORY_LIMIT", 200)),
    defaultLinkAccess,
  });
  const auth = createAuthStore(database);
  const audit = createAuditLog(database, {
    retentionDays: Math.max(1, numberEnv("AUDIT_RETENTION_DAYS", 365)),
  });
  const customTypes = createCustomTypeStore(database);
  const diagrams = createDiagramService({ store, audit });
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
  const inMemory = !resolvedDatabasePath || resolvedDatabasePath === ":memory:";
  const backups = createBackupService({
    db: database,
    directory:
      backupDirectory ??
      (process.env.BACKUP_DIR
        ? path.resolve(process.env.BACKUP_DIR)
        : inMemory
          ? null
          : path.join(
              path.dirname(path.resolve(resolvedDatabasePath)),
              "backups",
            )),
    intervalHours: numberEnv("BACKUP_INTERVAL_HOURS", 24),
    keep: Math.max(1, numberEnv("BACKUP_KEEP", 14)),
    log,
  });

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

  // The collaboration server is created with the HTTP server below; routes
  // reach it through this getter.
  let websocket = null;
  const context = {
    auth,
    audit,
    backups,
    customTypes,
    diagrams,
    gitSync,
    setup,
    store,
    guards: createGuards({ auth, store }),
    websocket: () => websocket,
  };
  registerAuthRoutes(app, context);
  registerAdminRoutes(app, context);
  registerDiagramRoutes(app, context);

  // Unknown API paths are errors, not the single-page app.
  app.all("/api/*splat", (_req, res) =>
    res.status(404).json({ error: "Not found" }),
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
  websocket = attachCollaborationServer(server, { store, auth, diagrams });

  const OPERATION_RETENTION_MS = 24 * 60 * 60 * 1000;
  const sweep = () => {
    auth.pruneExpiredSessions();
    store.pruneOperations(new Date(Date.now() - OPERATION_RETENTION_MS));
    audit.prune();
  };
  sweep();
  const sessionSweep = setInterval(sweep, 60 * 60 * 1000);
  sessionSweep.unref();
  backups.start();
  server.on("close", () => {
    clearInterval(sessionSweep);
    backups.stop();
  });

  return {
    app,
    server,
    websocket,
    database,
    store,
    auth,
    audit,
    backups,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  const { server } = createApplication();
  server.listen(port, "0.0.0.0", () => {
    console.log(`drawDB listening on http://0.0.0.0:${port}`);
  });
}
