import { request } from "./request";

const JSON_HEADERS = { "Content-Type": "application/json" };
const endpoint = (diagramId, suffix = "") =>
  `/api/diagrams/${encodeURIComponent(diagramId)}/git${suffix}`;

export const gitApi = {
  get(diagramId) {
    return request(endpoint(diagramId));
  },
  save(diagramId, settings) {
    return request(endpoint(diagramId), {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(settings),
    });
  },
  disconnect(diagramId) {
    return request(endpoint(diagramId), { method: "DELETE" });
  },
  test(diagramId) {
    return request(endpoint(diagramId, "/test"), { method: "POST" });
  },
  history(diagramId) {
    return request(endpoint(diagramId, "/history"));
  },
  push(diagramId, { sql, message } = {}) {
    return request(endpoint(diagramId, "/push"), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ sql, message }),
    });
  },
  pull(diagramId) {
    return request(endpoint(diagramId, "/pull"), { method: "POST" });
  },
};
