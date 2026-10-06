import { isValidPassword } from "../auth.js";
import { normalizeCustomTypes } from "../customTypes.js";
import { isPlainObject } from "../protocol.js";
import { CREDENTIALS_ERROR, hasCredentials } from "./auth.js";

const userIdParam = (req) => String(req.params.userId ?? "").slice(0, 128);

export function registerAdminRoutes(
  app,
  { auth, audit, backups, customTypes, guards, websocket },
) {
  const { requireAuth, requireAdmin } = guards;
  const admin = [requireAuth, requireAdmin];

  // --- Accounts ---------------------------------------------------------------
  app.get("/api/admin/users", ...admin, (_req, res) =>
    res.json({ users: auth.listUsers() }),
  );

  app.post("/api/admin/users", ...admin, async (req, res, next) => {
    try {
      if (!hasCredentials(req.body)) {
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
      audit.record({
        user: req.user,
        ip: req.ip,
        action: "user.created",
        target: result.user.username,
      });
      res.status(201).json({ user: result.user });
    } catch (error) {
      next(error);
    }
  });

  app.put(
    "/api/admin/users/:userId/password",
    ...admin,
    async (req, res, next) => {
      try {
        const password = isPlainObject(req.body) ? req.body.password : null;
        if (!isValidPassword(password)) {
          res
            .status(400)
            .json({ error: "A password of at least 8 characters is required" });
          return;
        }
        const userId = userIdParam(req);
        const result = await auth.resetPassword({
          userId,
          newPassword: password,
        });
        if (result.status !== "changed") {
          res.status(404).json({ error: "Account not found" });
          return;
        }
        websocket().closeUser(userId);
        audit.record({
          user: req.user,
          ip: req.ip,
          action: "user.password_reset",
          target: auth.getUser(userId)?.username,
        });
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  app.put("/api/admin/users/:userId/disabled", ...admin, (req, res) => {
    const disabled = isPlainObject(req.body) ? req.body.disabled : undefined;
    if (typeof disabled !== "boolean") {
      res.status(400).json({ error: "disabled must be true or false" });
      return;
    }
    const result = auth.setDisabled(userIdParam(req), disabled);
    if (result.status === "not_found") {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    if (result.status === "is_admin") {
      res
        .status(400)
        .json({ error: "The administrator account cannot be disabled" });
      return;
    }
    if (disabled) websocket().closeUser(result.user.id);
    audit.record({
      user: req.user,
      ip: req.ip,
      action: disabled ? "user.disabled" : "user.enabled",
      target: result.user.username,
    });
    res.json({ user: result.user });
  });

  app.delete("/api/admin/users/:userId", ...admin, (req, res) => {
    const transferTo = String(req.query.transferTo ?? req.user.id);
    const result = auth.deleteUser(userIdParam(req), { transferTo });
    if (result.status === "not_found") {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    if (result.status === "is_admin") {
      res
        .status(400)
        .json({ error: "The administrator account cannot be deleted" });
      return;
    }
    if (result.status === "invalid_transfer") {
      res.status(400).json({
        error: "The diagrams must go to another enabled account",
      });
      return;
    }
    websocket().closeUser(result.user.id);
    audit.record({
      user: req.user,
      ip: req.ip,
      action: "user.deleted",
      target: result.user.username,
      details: {
        diagramsTransferred: result.diagrams.length,
        transferredTo: auth.getUser(transferTo)?.username,
      },
    });
    for (const diagramId of result.diagrams)
      websocket().refreshAccess(diagramId);
    res.json({ transferred: result.diagrams.length });
  });

  // --- Activity log -----------------------------------------------------------
  app.get("/api/admin/audit", ...admin, (req, res) => {
    const number = (value) =>
      Number.isSafeInteger(Number(value)) && Number(value) > 0
        ? Number(value)
        : null;
    const text = (value) =>
      typeof value === "string" && value ? value.slice(0, 128) : null;
    res.json({
      entries: audit.list({
        limit: number(req.query.limit) ?? 100,
        before: number(req.query.before),
        userId: text(req.query.userId),
        diagramId: text(req.query.diagramId),
        action: text(req.query.action),
      }),
    });
  });

  // --- Backups ----------------------------------------------------------------
  app.get("/api/admin/backups", ...admin, (_req, res) =>
    res.json({ enabled: backups.enabled, backups: backups.list() }),
  );

  app.post("/api/admin/backups", ...admin, async (req, res, next) => {
    if (!backups.enabled) {
      res.status(503).json({ error: "Backups are not configured" });
      return;
    }
    try {
      const backup = await backups.backupNow();
      audit.record({
        user: req.user,
        ip: req.ip,
        action: "backup.created",
        target: backup.name,
      });
      res.status(201).json({ backup });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/backups/:name", ...admin, (req, res) => {
    const file = backups.file(req.params.name);
    if (!file) {
      res.status(404).json({ error: "Backup not found" });
      return;
    }
    audit.record({
      user: req.user,
      ip: req.ip,
      action: "backup.downloaded",
      target: req.params.name,
    });
    res.download(file, req.params.name);
  });

  // --- Custom types (shared by everyone) --------------------------------------
  app.get("/api/custom-types", requireAuth, (_req, res) =>
    res.json({ types: customTypes.all() }),
  );

  app.put("/api/custom-types", requireAuth, (req, res) => {
    let types;
    try {
      types = normalizeCustomTypes(req.body?.types);
    } catch (error) {
      res.status(400).json({ error: error.message });
      return;
    }
    const { added, removed } = customTypes.replace(types, req.user);
    if (added.length || removed.length) {
      audit.record({
        user: req.user,
        ip: req.ip,
        action: "types.changed",
        details: { added, removed },
      });
    }
    res.json({ types: customTypes.all() });
  });
}
