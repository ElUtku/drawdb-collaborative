import crypto from "node:crypto";
import { LINK_ACCESS } from "../database.js";
import { nameProblem } from "../diagramService.js";
import { documentProblem } from "../document.js";
import { isGitAvailable, isGitError } from "../git.js";
import { DIAGRAM_ID_PATTERN, isPlainObject } from "../protocol.js";

const MEMBER_ROLES = ["viewer", "editor"];
const VERSION_TITLE_MAX = 120;

/** The diagram as the API returns it, with the caller's role on it. */
const withRole = (diagram, role) => ({
  ...diagram,
  role,
  linkAccess: diagram.link_access,
});

export function registerDiagramRoutes(
  app,
  { auth, audit, store, diagrams, gitSync, guards, websocket },
) {
  const { requireAuth, diagramAccess } = guards;
  const view = [requireAuth, diagramAccess("viewer")];
  const edit = [requireAuth, diagramAccess("editor")];
  const own = [requireAuth, diagramAccess("owner")];

  const sendUpdateResult = (res, result) => {
    if (result.status === "invalid") {
      res.status(400).json({ error: `Invalid diagram: ${result.error}` });
    } else if (result.status === "not_found") {
      res.status(404).json({ error: "Diagram not found" });
    } else if (result.status === "conflict") {
      res
        .status(409)
        .json({ error: "Version conflict", diagram: result.diagram });
    } else {
      return true;
    }
    return false;
  };

  app.get("/api/diagrams", requireAuth, (req, res) =>
    res.json({ diagrams: store.list(req.user) }),
  );

  app.post("/api/diagrams", requireAuth, (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};
    const problem =
      (typeof body.name !== "string" ? "name is required" : null) ??
      nameProblem(body.name) ??
      (isPlainObject(body.document)
        ? documentProblem(body.document)
        : "document is required");
    if (problem) {
      res.status(400).json({ error: `Invalid diagram: ${problem}` });
      return;
    }
    const id = body.id ?? crypto.randomUUID();
    if (!DIAGRAM_ID_PATTERN.test(id)) {
      res.status(400).json({ error: "Invalid diagram ID" });
      return;
    }
    if (store.get(id)) {
      res.status(409).json({ error: "Diagram already exists" });
      return;
    }
    const created = store.create({
      id,
      name: body.name,
      document: body.document,
      ownerId: req.user.id,
      user: req.user,
    });
    audit.record({
      user: req.user,
      ip: req.ip,
      action: "diagram.created",
      diagramId: id,
      target: body.name,
    });
    res.status(201).json(withRole(created, "owner"));
  });

  app.get("/api/diagrams/:id", ...view, (req, res) =>
    res.json(withRole(req.diagram, req.role)),
  );

  app.put("/api/diagrams/:id", ...edit, (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};
    if (!isPlainObject(body.document) || !Number.isInteger(body.baseVersion)) {
      res.status(400).json({
        error: "A valid name, document, and baseVersion are required",
      });
      return;
    }
    const result = diagrams.update({
      id: req.params.id,
      name: body.name,
      document: body.document,
      baseVersion: body.baseVersion,
      user: req.user,
      ip: req.ip,
    });
    if (!sendUpdateResult(res, result)) return;
    // People with the diagram open learn about the change right away.
    diagrams.broadcastSnapshot(req.params.id, result.diagram);
    res.json(withRole(result.diagram, req.role));
  });

  app.delete("/api/diagrams/:id", ...own, (req, res) => {
    store.delete(req.params.id);
    audit.record({
      user: req.user,
      ip: req.ip,
      action: "diagram.deleted",
      diagramId: req.params.id,
      target: req.diagram.name,
    });
    websocket().refreshAccess(req.params.id);
    res.status(204).end();
  });

  // --- Sharing ------------------------------------------------------------------
  const accessSummary = (diagram) => ({
    linkAccess: diagram.link_access,
    owner: diagram.owner_id
      ? { userId: diagram.owner_id, username: diagram.owner_username }
      : null,
    members: store.members(diagram.id),
  });

  app.get("/api/diagrams/:id/access", ...view, (req, res) =>
    res.json({ ...accessSummary(req.diagram), role: req.role }),
  );

  app.put("/api/diagrams/:id/access", ...own, (req, res) => {
    const linkAccess = req.body?.linkAccess;
    if (!LINK_ACCESS.includes(linkAccess)) {
      res
        .status(400)
        .json({ error: `linkAccess must be one of ${LINK_ACCESS.join(", ")}` });
      return;
    }
    store.setLinkAccess(req.params.id, linkAccess);
    audit.record({
      user: req.user,
      ip: req.ip,
      action: "diagram.link_access",
      diagramId: req.params.id,
      details: { from: req.diagram.link_access, to: linkAccess },
    });
    websocket().refreshAccess(req.params.id);
    res.json(accessSummary(store.get(req.params.id)));
  });

  app.put("/api/diagrams/:id/members/:userId", ...own, (req, res) => {
    const role = req.body?.role;
    if (!MEMBER_ROLES.includes(role)) {
      res.status(400).json({ error: "role must be viewer or editor" });
      return;
    }
    const member = auth.getUser(String(req.params.userId).slice(0, 128));
    if (!member || member.disabled) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    if (member.id === req.diagram.owner_id) {
      res.status(400).json({ error: "The owner already has full access" });
      return;
    }
    store.setMember(req.params.id, member.id, role);
    audit.record({
      user: req.user,
      ip: req.ip,
      action: "diagram.member_set",
      diagramId: req.params.id,
      target: member.username,
      details: { role },
    });
    websocket().refreshAccess(req.params.id);
    res.json(accessSummary(store.get(req.params.id)));
  });

  // The owner removes anyone; a member may also leave on their own.
  app.delete("/api/diagrams/:id/members/:userId", ...view, (req, res) => {
    const userId = String(req.params.userId).slice(0, 128);
    if (req.role !== "owner" && userId !== req.user.id) {
      res
        .status(403)
        .json({ error: "Only the owner of the diagram can do this" });
      return;
    }
    const member = auth.getUser(userId);
    if (!store.removeMember(req.params.id, userId)) {
      res.status(404).json({ error: "That account is not a member" });
      return;
    }
    audit.record({
      user: req.user,
      ip: req.ip,
      action: "diagram.member_removed",
      diagramId: req.params.id,
      target: member?.username,
    });
    websocket().refreshAccess(req.params.id);
    res.json(accessSummary(store.get(req.params.id)));
  });

  app.put("/api/diagrams/:id/owner", ...own, (req, res) => {
    const heir = auth.getUser(String(req.body?.userId ?? "").slice(0, 128));
    if (!heir || heir.disabled) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    store.transferOwner(req.params.id, heir.id);
    audit.record({
      user: req.user,
      ip: req.ip,
      action: "diagram.owner_changed",
      diagramId: req.params.id,
      target: heir.username,
      details: { from: req.diagram.owner_username ?? null },
    });
    websocket().refreshAccess(req.params.id);
    res.json(accessSummary(store.get(req.params.id)));
  });

  // --- History ------------------------------------------------------------------
  const versionParam = (req, res) => {
    const version = Number(req.params.version);
    if (!Number.isSafeInteger(version) || version < 1) {
      res.status(400).json({ error: "Invalid version" });
      return null;
    }
    return version;
  };

  app.get("/api/diagrams/:id/versions", ...view, (req, res) =>
    res.json({
      current: req.diagram.version,
      versions: store.versions(req.params.id),
    }),
  );

  // Saves the diagram as it is now as a named version (say, "1.0 released").
  app.post("/api/diagrams/:id/versions", ...edit, (req, res) => {
    const title =
      typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!title || title.length > VERSION_TITLE_MAX) {
      res.status(400).json({
        error: `A version name of 1-${VERSION_TITLE_MAX} characters is required`,
      });
      return;
    }
    const saved = store.checkpoint(req.params.id, {
      user: req.user,
      label: "named",
      title,
    });
    audit.record({
      user: req.user,
      ip: req.ip,
      action: "diagram.version_named",
      diagramId: req.params.id,
      target: title,
      details: { version: saved.version },
    });
    res.status(201).json({ version: saved.version });
  });

  app.get("/api/diagrams/:id/versions/:version", ...view, (req, res) => {
    const version = versionParam(req, res);
    if (version === null) return;
    const found = store.getVersion(req.params.id, version);
    if (!found) {
      res.status(404).json({ error: "Version not found" });
      return;
    }
    res.json(found);
  });

  app.post(
    "/api/diagrams/:id/versions/:version/restore",
    ...edit,
    (req, res) => {
      const version = versionParam(req, res);
      if (version === null) return;
      const found = store.getVersion(req.params.id, version);
      if (!found) {
        res.status(404).json({ error: "Version not found" });
        return;
      }
      // The current pan and zoom stay; only the content goes back.
      const current = req.diagram.document;
      const result = diagrams.update({
        id: req.params.id,
        name: found.name,
        document: { ...found.document, pan: current.pan, zoom: current.zoom },
        baseVersion: req.diagram.version,
        user: req.user,
        ip: req.ip,
        label: "restored",
        details: { from: version },
      });
      if (!sendUpdateResult(res, result)) return;
      diagrams.broadcastSnapshot(req.params.id, result.diagram);
      res.json(withRole(result.diagram, req.role));
    },
  );

  app.get("/api/diagrams/:id/activity", ...own, (req, res) =>
    res.json({
      entries: audit.list({ diagramId: req.params.id, limit: 200 }),
    }),
  );

  // --- Repository sync ------------------------------------------------------------
  // Anyone who can edit a diagram may push it or pull it back, but only the
  // owner may point it at a repository, because the settings carry a credential.
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

  app.get(
    "/api/diagrams/:id/git",
    ...view,
    gitRoute(async (req, res) => {
      res.json({
        available: await isGitAvailable(),
        canConfigure: req.role === "owner",
        canSync: req.role === "owner" || req.role === "editor",
        settings: gitSync.settings(req.params.id),
      });
    }),
  );

  app.put(
    "/api/diagrams/:id/git",
    ...own,
    gitRoute(async (req, res) => {
      const settings = await gitSync.save(req.params.id, req.body ?? {}, {
        diagramName: req.diagram.name,
      });
      audit.record({
        user: req.user,
        ip: req.ip,
        action: "git.configured",
        diagramId: req.params.id,
        target: settings.remoteUrl,
      });
      res.json({ settings });
    }),
  );

  app.delete(
    "/api/diagrams/:id/git",
    ...own,
    gitRoute(async (req, res) => {
      gitSync.delete(req.params.id);
      audit.record({
        user: req.user,
        ip: req.ip,
        action: "git.disconnected",
        diagramId: req.params.id,
      });
      res.status(204).end();
    }),
  );

  app.post(
    "/api/diagrams/:id/git/test",
    ...view,
    gitRoute(async (req, res) => {
      res.json(await gitSync.test(req.params.id));
    }),
  );

  app.get(
    "/api/diagrams/:id/git/history",
    ...view,
    gitRoute(async (req, res) => {
      res.json(await gitSync.history(req.params.id));
    }),
  );

  app.post(
    "/api/diagrams/:id/git/push",
    ...edit,
    gitRoute(async (req, res) => {
      const body = isPlainObject(req.body) ? req.body : {};
      const result = await gitSync.push(req.params.id, {
        sql: typeof body.sql === "string" ? body.sql : undefined,
        message: body.message,
        user: req.user,
      });
      if (result.status === "pushed") {
        audit.record({
          user: req.user,
          ip: req.ip,
          action: "git.pushed",
          diagramId: req.params.id,
          details: { commit: result.commit },
        });
      }
      res.json(result);
    }),
  );

  app.post(
    "/api/diagrams/:id/git/pull",
    ...edit,
    gitRoute(async (req, res) => {
      const pulled = await gitSync.pull(req.params.id);
      const result = diagrams.update({
        id: req.params.id,
        name: pulled.name ?? req.diagram.name,
        document: pulled.document,
        baseVersion: req.diagram.version,
        user: req.user,
        ip: req.ip,
        label: "git_pull",
        details: { commit: pulled.commit },
      });
      if (result.status === "invalid") {
        res.status(422).json({
          error: `The diagram in the repository is not valid: ${result.error}`,
        });
        return;
      }
      if (result.status !== "updated") {
        res.status(409).json({
          error: "The diagram changed while it was being pulled. Try again.",
          diagram: result.diagram,
        });
        return;
      }
      // Everyone with the diagram open is holding the pre-pull snapshot.
      diagrams.broadcastSnapshot(req.params.id, result.diagram);
      res.json({
        diagram: withRole(result.diagram, req.role),
        commit: pulled.commit,
        file: pulled.file,
      });
    }),
  );
}
