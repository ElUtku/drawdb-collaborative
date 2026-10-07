import { parseCookies, SESSION_COOKIE, sessionCookie } from "../auth.js";
import { canEdit, canView } from "../database.js";
import { DIAGRAM_ID_PATTERN } from "../protocol.js";

/** Express middleware shared by the route modules. */
export function createGuards({ auth, store }) {
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

  /**
   * Loads req.params.id into req.diagram and req.role, and lets the request
   * through only with at least `minimum` access ("viewer", "editor" or
   * "owner").
   */
  const diagramAccess = (minimum) => (req, res, next) => {
    if (!DIAGRAM_ID_PATTERN.test(req.params.id || "")) {
      res.status(400).json({ error: "Invalid diagram ID" });
      return;
    }
    const diagram = store.get(req.params.id);
    if (!diagram) {
      res.status(404).json({ error: "Diagram not found" });
      return;
    }
    const role = store.roleFor(diagram, req.user);
    const allowed =
      minimum === "owner"
        ? role === "owner"
        : minimum === "editor"
          ? canEdit(role)
          : canView(role);
    if (!allowed) {
      res.status(403).json({
        error: !canView(role)
          ? "You do not have access to this diagram"
          : minimum === "owner"
            ? "Only the owner of the diagram can do this"
            : "You can only view this diagram",
        role,
      });
      return;
    }
    req.diagram = diagram;
    req.role = role;
    next();
  };

  return { requireAuth, requireAdmin, diagramAccess };
}
