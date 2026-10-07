import { documentProblem } from "./document.js";

const MAX_NAME_LENGTH = 200;

export function nameProblem(name) {
  if (name === undefined || name === null) return null;
  if (typeof name !== "string" || !name.trim()) return "name must not be empty";
  if (name.length > MAX_NAME_LENGTH) {
    return `name is longer than ${MAX_NAME_LENGTH} characters`;
  }
  return null;
}

/**
 * The single way a diagram's content changes, whether it comes from the REST
 * API, the collaboration socket, a restore or a Git pull: the document is
 * checked, stored, saved in the history when due, and audited.
 */
export function createDiagramService({ store, audit }) {
  let broadcast = () => {};

  return {
    /** Set by the collaboration server to reach everyone editing. */
    setBroadcaster(fn) {
      broadcast = fn;
    },

    broadcastSnapshot(id, diagram) {
      broadcast(id, diagram);
    },

    update({
      id,
      name,
      document,
      baseVersion,
      operationId,
      user = null,
      ip = null,
      label = null,
      details = null,
    }) {
      const problem = nameProblem(name) ?? documentProblem(document);
      if (problem) return { status: "invalid", error: problem };
      const previousName = store.get(id)?.name;
      const result = store.updateSnapshot({
        id,
        name,
        document,
        baseVersion,
        operationId,
        user,
        label,
      });
      if (result.status !== "updated") return result;
      if (name && previousName !== undefined && name !== previousName) {
        audit.record({
          user,
          ip,
          action: "diagram.renamed",
          diagramId: id,
          details: { from: previousName, to: name },
        });
      }
      if (result.checkpoint && !label) {
        audit.record({
          user,
          ip,
          action: "diagram.edited",
          diagramId: id,
          details: {
            version: result.checkpoint.version,
            editors: result.checkpoint.editors,
          },
        });
      }
      if (label) {
        audit.record({
          user,
          ip,
          action: label === "git_pull" ? "git.pulled" : "diagram.restored",
          diagramId: id,
          details: { ...details, version: result.diagram.version },
        });
      }
      return result;
    },
  };
}
