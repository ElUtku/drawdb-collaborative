import { request } from "./request";

const JSON_HEADERS = { "Content-Type": "application/json" };

export const diagramApi = {
  async list() {
    const result = await request("/api/diagrams");
    return result.diagrams;
  },
  get(id) {
    return request(`/api/diagrams/${encodeURIComponent(id)}`);
  },
  create({ id, name, document }) {
    return request("/api/diagrams", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ id, name, document }),
    });
  },
  update(id, { name, document, baseVersion }) {
    return request(`/api/diagrams/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name, document, baseVersion }),
    });
  },
  delete(id) {
    return request(`/api/diagrams/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};
