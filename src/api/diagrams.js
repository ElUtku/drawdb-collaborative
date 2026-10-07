import { request } from "./request";

const JSON_HEADERS = { "Content-Type": "application/json" };
const path = (id, rest = "") =>
  `/api/diagrams/${encodeURIComponent(id)}${rest}`;
const send = (method, url, body) =>
  request(url, {
    method,
    ...(body !== undefined && {
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
  });

export const diagramApi = {
  async list() {
    const result = await request("/api/diagrams");
    return result.diagrams;
  },
  get(id) {
    return request(path(id));
  },
  create({ id, name, document }) {
    return send("POST", "/api/diagrams", { id, name, document });
  },
  update(id, { name, document, baseVersion }) {
    return send("PUT", path(id), { name, document, baseVersion });
  },
  delete(id) {
    return send("DELETE", path(id));
  },

  // Sharing
  access(id) {
    return request(path(id, "/access"));
  },
  setLinkAccess(id, linkAccess) {
    return send("PUT", path(id, "/access"), { linkAccess });
  },
  setMember(id, userId, role) {
    return send("PUT", path(id, `/members/${encodeURIComponent(userId)}`), {
      role,
    });
  },
  removeMember(id, userId) {
    return send("DELETE", path(id, `/members/${encodeURIComponent(userId)}`));
  },
  transferOwner(id, userId) {
    return send("PUT", path(id, "/owner"), { userId });
  },

  // History
  versions(id) {
    return request(path(id, "/versions"));
  },
  version(id, version) {
    return request(path(id, `/versions/${version}`));
  },
  nameVersion(id, title) {
    return send("POST", path(id, "/versions"), { title });
  },
  restore(id, version) {
    return send("POST", path(id, `/versions/${version}/restore`));
  },
  activity(id) {
    return request(path(id, "/activity"));
  },
};

export const userApi = {
  async directory() {
    const result = await request("/api/users");
    return result.users;
  },
};

export const customTypeApi = {
  async get() {
    const result = await request("/api/custom-types");
    return result.types;
  },
  async save(types) {
    const result = await send("PUT", "/api/custom-types", { types });
    return result.types;
  },
};
