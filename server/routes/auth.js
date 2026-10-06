import {
  clearedSessionCookie,
  createLoginThrottle,
  isValidPassword,
  isValidUsername,
  parseCookies,
  SESSION_COOKIE,
  sessionCookie,
} from "../auth.js";
import { isPlainObject } from "../protocol.js";

/* global process */

export const CREDENTIALS_ERROR =
  "A username of 3-32 letters, digits, dot, dash or underscore and a password of at least 8 characters are required";

export const hasCredentials = (body) =>
  isPlainObject(body) &&
  isValidUsername(body.username) &&
  isValidPassword(body.password);

const tooMany = (res, throttle) => {
  res.setHeader("Retry-After", String(throttle.retryAfterSeconds));
  res.status(429).json({ error: "Too many attempts. Try again later." });
};

export function registerAuthRoutes(app, { auth, audit, setup, guards }) {
  const { requireAuth } = guards;
  const loginThrottle = createLoginThrottle();
  // Also caps failed sign-ins per address across all usernames, so one source
  // cannot try a few passwords on every account.
  const loginIpThrottle = createLoginThrottle({ maxAttempts: 50 });
  // Caps self-service sign-ups per client IP (5 per hour) when registration is open.
  const registerThrottle = createLoginThrottle({
    maxAttempts: 5,
    windowMs: 60 * 60 * 1000,
  });
  const passwordThrottle = createLoginThrottle();
  const openRegistration = /^(1|true|yes)$/i.test(
    process.env.OPEN_REGISTRATION || "",
  );

  const startSession = (req, res, user) => {
    const { token, expiresAt } = auth.createSession(user.id);
    res.setHeader(
      "Set-Cookie",
      sessionCookie(token, { secure: req.secure, expiresAt }),
    );
  };

  // The first account always claims the empty instance and becomes the
  // administrator. After that, sign-up stays closed unless OPEN_REGISTRATION
  // is enabled, in which case anyone can create a regular (non-admin) account.
  app.get("/api/auth/status", (_req, res) =>
    res.json({
      setupRequired: auth.countUsers() === 0,
      registrationOpen: openRegistration,
    }),
  );

  app.post("/api/auth/register", async (req, res, next) => {
    try {
      const bootstrap = auth.countUsers() === 0;
      if (!bootstrap && !openRegistration) {
        res.status(403).json({
          error: "Registration is closed. Ask an administrator for an account.",
        });
        return;
      }
      if (!hasCredentials(req.body)) {
        res.status(400).json({ error: CREDENTIALS_ERROR });
        return;
      }
      const throttleKey = `register:${req.ip}`;
      const throttle = registerThrottle.check(throttleKey);
      if (!throttle.allowed) {
        tooMany(res, throttle);
        return;
      }
      registerThrottle.fail(throttleKey);
      if (bootstrap && !setup.matches(req.body.setupCode)) {
        res.status(403).json({
          error:
            "The setup code is not correct. It is printed in the server log when the server starts without accounts.",
        });
        return;
      }
      const result = await auth.createUser({
        username: req.body.username,
        password: req.body.password,
        isAdmin: bootstrap,
        requireEmpty: bootstrap,
      });
      if (result.status === "already_initialized") {
        res.status(409).json({
          error:
            "The administrator account was just created. Sign in or try again.",
        });
        return;
      }
      if (result.status === "taken") {
        res.status(409).json({ error: "Username is already taken" });
        return;
      }
      audit.record({
        user: result.user,
        ip: req.ip,
        action: bootstrap ? "auth.setup" : "auth.signup",
      });
      startSession(req, res, result.user);
      res.status(201).json({ user: result.user });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/login", async (req, res, next) => {
    try {
      if (!isPlainObject(req.body)) {
        res.status(400).json({ error: "A username and password are required" });
        return;
      }
      const username = String(req.body.username).slice(0, 64);
      const throttleKey = `${req.ip}:${username.toLowerCase()}`;
      const ipKey = `ip:${req.ip}`;
      const ipThrottle = loginIpThrottle.check(ipKey);
      if (!ipThrottle.allowed) {
        tooMany(res, ipThrottle);
        return;
      }
      const throttle = loginThrottle.check(throttleKey);
      if (!throttle.allowed) {
        tooMany(res, throttle);
        return;
      }
      const user = hasCredentials(req.body)
        ? await auth.verifyCredentials(req.body)
        : null;
      if (!user) {
        loginThrottle.fail(throttleKey);
        loginIpThrottle.fail(ipKey);
        audit.record({
          ip: req.ip,
          action: "auth.login_failed",
          target: username,
        });
        res.status(401).json({ error: "Invalid username or password" });
        return;
      }
      if (user.disabled) {
        audit.record({ user, ip: req.ip, action: "auth.login_disabled" });
        res.status(403).json({ error: "This account is disabled" });
        return;
      }
      loginThrottle.succeed(throttleKey);
      audit.record({ user, ip: req.ip, action: "auth.login" });
      startSession(req, res, user);
      res.json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const session = auth.resolveSession(token);
    auth.deleteSession(token);
    if (session) {
      audit.record({ user: session.user, ip: req.ip, action: "auth.logout" });
    }
    res.setHeader("Set-Cookie", clearedSessionCookie({ secure: req.secure }));
    res.status(204).end();
  });

  app.get("/api/auth/me", requireAuth, (req, res) =>
    res.json({ user: req.user }),
  );

  app.post("/api/auth/password", requireAuth, async (req, res, next) => {
    try {
      const body = isPlainObject(req.body) ? req.body : {};
      if (
        typeof body.currentPassword !== "string" ||
        !isValidPassword(body.newPassword)
      ) {
        res.status(400).json({
          error:
            "The current password and a new password of at least 8 characters are required",
        });
        return;
      }
      const throttleKey = `password:${req.user.id}`;
      const throttle = passwordThrottle.check(throttleKey);
      if (!throttle.allowed) {
        tooMany(res, throttle);
        return;
      }
      const result = await auth.changePassword({
        userId: req.user.id,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        keepToken: parseCookies(req.headers.cookie)[SESSION_COOKIE],
      });
      if (result.status === "invalid_password") {
        passwordThrottle.fail(throttleKey);
        res.status(403).json({ error: "The current password is incorrect" });
        return;
      }
      if (result.status !== "changed") {
        res.status(404).json({ error: "Account not found" });
        return;
      }
      passwordThrottle.succeed(throttleKey);
      audit.record({
        user: req.user,
        ip: req.ip,
        action: "auth.password_changed",
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // Who diagrams can be shared with: the enabled accounts, by name.
  app.get("/api/users", requireAuth, (_req, res) =>
    res.json({ users: auth.directory() }),
  );
}
