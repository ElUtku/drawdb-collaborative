import { request } from "./request";

export const authApi = {
  async status() {
    return request("/api/auth/status", { skipUnauthorizedEvent: true });
  },
  async me() {
    const result = await request("/api/auth/me", {
      skipUnauthorizedEvent: true,
    });
    return result.user;
  },
  async register({ username, password }) {
    const result = await request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      skipUnauthorizedEvent: true,
    });
    return result.user;
  },
  async login({ username, password }) {
    const result = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      skipUnauthorizedEvent: true,
    });
    return result.user;
  },
  logout() {
    return request("/api/auth/logout", { method: "POST" });
  },
  changePassword({ currentPassword, newPassword }) {
    return request("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },
};

export const adminApi = {
  async listUsers() {
    const result = await request("/api/admin/users");
    return result.users;
  },
  resetPassword(userId, password) {
    return request(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
  },
  async createUser({ username, password }) {
    const result = await request("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    return result.user;
  },
};
