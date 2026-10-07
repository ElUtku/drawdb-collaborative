/**
 * Who did what and when: sign-ins, account changes, sharing, deletions, saved
 * versions, Git sync... Entries are kept for `retentionDays`.
 */
export function createAuditLog(db, { retentionDays = 365 } = {}) {
  const insert = db.prepare(
    `INSERT INTO audit_log (at, user_id, username, ip, action, diagram_id, target, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const toEntry = (row) => ({
    id: row.id,
    at: row.at,
    userId: row.user_id,
    username: row.username,
    ip: row.ip,
    action: row.action,
    diagramId: row.diagram_id,
    target: row.target,
    details: row.details ? JSON.parse(row.details) : null,
  });

  return {
    record({
      user = null,
      ip = null,
      action,
      diagramId = null,
      target = null,
      details = null,
    }) {
      insert.run(
        new Date().toISOString(),
        user?.id ?? null,
        user?.username ?? null,
        ip,
        action,
        diagramId,
        target,
        details ? JSON.stringify(details) : null,
      );
    },

    /** Newest first; `before` is the id of the last entry already shown. */
    list({
      limit = 100,
      before = null,
      diagramId = null,
      userId = null,
      action = null,
    } = {}) {
      const clauses = [];
      const params = {};
      if (before) {
        clauses.push("id < @before");
        params.before = before;
      }
      if (diagramId) {
        clauses.push("diagram_id = @diagramId");
        params.diagramId = diagramId;
      }
      if (userId) {
        clauses.push("user_id = @userId");
        params.userId = userId;
      }
      if (action) {
        clauses.push("action = @action");
        params.action = action;
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      return db
        .prepare(
          `SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT @limit`,
        )
        .all({ ...params, limit: Math.min(Math.max(1, limit), 500) })
        .map(toEntry);
    },

    prune() {
      const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
      return db
        .prepare("DELETE FROM audit_log WHERE at < ?")
        .run(cutoff.toISOString()).changes;
    },
  };
}
