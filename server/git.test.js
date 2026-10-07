import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { openDatabase } from "./database.js";
import {
  createGitStore,
  isGitAvailable,
  normalizeDirectory,
  normalizeFileName,
  normalizeRemoteUrl,
  normalizeSettings,
  redact,
  serializeDiagramFile,
  slugifyFileName,
  credentialConfig,
  isAllowedHost,
  remoteHost,
} from "./git.js";
import { createApplication } from "./index.js";

/* global process, Buffer */

const PASSWORD = "correct-horse-9";
const JSON_HEADERS = { "Content-Type": "application/json" };

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
}

async function listen(application) {
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  return application.server.address().port;
}

async function signedInInstance(workdir) {
  process.env.GIT_ALLOW_LOCAL_REMOTES = "1";
  process.env.GIT_WORKDIR = workdir;
  const application = createApplication({
    databasePath: ":memory:",
    setupCode: "test-setup-code",
    log: () => {},
  });
  const port = await listen(application);
  const base = `http://127.0.0.1:${port}`;
  const registered = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      username: "root",
      password: PASSWORD,
      setupCode: "test-setup-code",
    }),
  });
  assert.equal(registered.status, 201);
  const cookie = registered.headers.get("set-cookie").split(";")[0];
  return { application, base, cookie };
}

test("rejects repository URLs that git could read as options or local paths", () => {
  delete process.env.GIT_ALLOW_LOCAL_REMOTES;
  assert.equal(
    normalizeRemoteUrl("https://github.com/acme/schema.git"),
    "https://github.com/acme/schema.git",
  );
  assert.equal(
    normalizeRemoteUrl("git@github.com:acme/schema.git"),
    "git@github.com:acme/schema.git",
  );
  for (const invalid of [
    "--upload-pack=touch /tmp/pwned",
    "ext::sh -c whoami",
    "/etc/passwd",
    "file:///etc/passwd",
    "https://example.com/repo with space.git",
    "",
  ]) {
    assert.throws(
      () => normalizeRemoteUrl(invalid),
      /repository URL|required/i,
    );
  }
});

test("normalizes the in-repository location", () => {
  assert.equal(normalizeDirectory("/db/schema/"), "db/schema");
  assert.equal(normalizeDirectory(""), "");
  assert.throws(() => normalizeDirectory("../../etc"), /invalid/i);
  assert.throws(() => normalizeDirectory("db/../../etc"), /invalid/i);
  assert.equal(normalizeFileName("schema.sql"), "schema");
  assert.throws(() => normalizeFileName("../schema"), /file name/i);
  assert.equal(slugifyFileName("Sales & Billing"), "Sales-Billing");
  assert.equal(slugifyFileName("////"), "schema");
});

test("keeps credentials out of URLs, command lines and error output", () => {
  const { config, secrets } = credentialConfig(
    "https://github.com/acme/schema.git",
    { authUsername: "bot", token: "secret-token" },
  );
  assert.deepEqual(config, [
    [
      "http.https://github.com/.extraHeader",
      `Authorization: Basic ${Buffer.from("bot:secret-token").toString("base64")}`,
    ],
  ]);
  assert.ok(secrets.includes("secret-token"));
  // An SSH remote authenticates with a key, so no credential is injected.
  assert.deepEqual(
    credentialConfig("git@github.com:acme/schema.git", {
      token: "secret-token",
    }).config,
    [],
  );
  assert.throws(
    () => normalizeRemoteUrl("https://bot:secret-token@github.com/a/b.git"),
    /token/i,
  );
  assert.equal(
    normalizeRemoteUrl("https://bot@github.com/a/b.git"),
    "https://bot@github.com/a/b.git",
  );
  const message = redact(
    "fatal: unable to access 'https://bot:secret-token@github.com/acme/schema.git'",
    ["secret-token"],
  );
  assert.equal(message.includes("secret-token"), false);
});

test("GIT_ALLOWED_HOSTS limits the hosts the server will contact", () => {
  assert.equal(
    remoteHost("git@git.example.com:team/repo.git"),
    "git.example.com",
  );
  assert.equal(
    remoteHost("https://Git.Example.com:8443/x.git"),
    "git.example.com",
  );
  assert.equal(isAllowedHost("git.example.com", ""), true);
  assert.equal(isAllowedHost("git.example.com", "git.example.com"), true);
  assert.equal(isAllowedHost("evil.com", "git.example.com"), false);
  assert.equal(isAllowedHost("a.example.com", "*.example.com"), true);
  assert.equal(isAllowedHost("example.com", "*.example.com"), false);
  assert.equal(isAllowedHost("badexample.com", "*.example.com"), false);
  process.env.GIT_ALLOWED_HOSTS = "git.example.com";
  try {
    assert.throws(
      () => normalizeRemoteUrl("https://169.254.169.254/latest"),
      /not allowed/,
    );
    assert.equal(
      normalizeRemoteUrl("https://git.example.com/a.git"),
      "https://git.example.com/a.git",
    );
  } finally {
    delete process.env.GIT_ALLOWED_HOSTS;
  }
});

test("stores repository tokens encrypted and hides them from the API shape", () => {
  const database = openDatabase(":memory:");
  database
    .prepare(
      "INSERT INTO diagrams (id, name, document, version, created_at, updated_at) VALUES ('d1', 'One', '{}', 1, '', '')",
    )
    .run();
  const store = createGitStore(database);
  const settings = normalizeSettings({
    remoteUrl: "https://github.com/acme/schema.git",
    branch: "main",
    directory: "db",
    fileName: "schema",
  });

  const saved = store.save("d1", settings, { token: "secret-token" });
  assert.equal(saved.hasToken, true);
  assert.equal("token" in saved, false);
  assert.equal(store.token("d1"), "secret-token");
  const stored = database
    .prepare(
      "SELECT token_cipher FROM diagram_git_settings WHERE diagram_id = 'd1'",
    )
    .get().token_cipher;
  assert.equal(stored.includes("secret-token"), false);

  // An omitted token keeps the stored one; an empty one clears it.
  store.save("d1", { ...settings, branch: "release" });
  assert.equal(store.token("d1"), "secret-token");
  store.save("d1", settings, { token: "" });
  assert.equal(store.get("d1").hasToken, false);
  database.close();
});

test("leaves viewport state out of the committed document", () => {
  const file = serializeDiagramFile("Sales", {
    database: "postgresql",
    tables: [{ id: "t1" }],
    pan: { x: 12, y: 40 },
    zoom: 1.5,
  });
  const parsed = JSON.parse(file);
  assert.equal(parsed.name, "Sales");
  assert.equal("pan" in parsed.document, false);
  assert.equal("zoom" in parsed.document, false);
  assert.equal(parsed.document.tables.length, 1);
  assert.equal(file.endsWith("\n"), true);
});

test("pushes the schema to a repository and pulls an outside change back", async (t) => {
  if (!(await isGitAvailable())) {
    t.skip("git is not installed");
    return;
  }
  const root = temporaryDirectory("drawdb-git-");
  const remote = path.join(root, "remote.git");
  const workdir = path.join(root, "work");
  fs.mkdirSync(remote, { recursive: true });
  runGit(["init", "--bare", "-b", "main", "."], remote);

  const { application, base, cookie } = await signedInInstance(workdir);
  t.after(() => {
    application.server.close();
    application.database.close();
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.GIT_ALLOW_LOCAL_REMOTES;
    delete process.env.GIT_WORKDIR;
  });

  const authed = { ...JSON_HEADERS, Cookie: cookie };
  const created = await fetch(`${base}/api/diagrams`, {
    method: "POST",
    headers: authed,
    body: JSON.stringify({
      name: "Sales",
      document: {
        database: "postgresql",
        tables: [{ id: "t1", name: "customer" }],
        references: [],
        pan: { x: 5, y: 5 },
        zoom: 1,
      },
    }),
  });
  assert.equal(created.status, 201);
  const diagram = await created.json();

  const configured = await fetch(`${base}/api/diagrams/${diagram.id}/git`, {
    method: "PUT",
    headers: authed,
    body: JSON.stringify({
      remoteUrl: pathToFileURL(remote).href,
      branch: "main",
      directory: "db",
      fileName: "sales",
    }),
  });
  assert.equal(configured.status, 200);
  assert.equal((await configured.json()).settings.fileName, "sales");

  const pushed = await fetch(`${base}/api/diagrams/${diagram.id}/git/push`, {
    method: "POST",
    headers: authed,
    body: JSON.stringify({
      sql: "CREATE TABLE customer (id INT);",
      message: "Add customer table",
    }),
  });
  assert.equal(pushed.status, 200);
  const pushResult = await pushed.json();
  assert.equal(pushResult.status, "pushed");
  assert.deepEqual(pushResult.files, ["db/sales.json", "db/sales.sql"]);

  const committed = runGit(["show", "main:db/sales.json"], remote);
  assert.equal(JSON.parse(committed).document.tables[0].name, "customer");
  assert.equal(
    runGit(["show", "main:db/sales.sql"], remote).trim(),
    "CREATE TABLE customer (id INT);",
  );
  assert.equal(
    runGit(["log", "-1", "--format=%s%n%an", "main"], remote).trim(),
    "Add customer table\nroot",
  );

  // Nothing changed, so a second push must not create an empty commit.
  const again = await fetch(`${base}/api/diagrams/${diagram.id}/git/push`, {
    method: "POST",
    headers: authed,
    body: JSON.stringify({ sql: "CREATE TABLE customer (id INT);" }),
  });
  assert.equal((await again.json()).status, "unchanged");
  assert.equal(runGit(["rev-list", "--count", "main"], remote).trim(), "1");

  const history = await fetch(
    `${base}/api/diagrams/${diagram.id}/git/history`,
    {
      headers: authed,
    },
  );
  const commits = (await history.json()).commits;
  assert.equal(commits.length, 1);
  assert.equal(commits[0].message, "Add customer table");
  assert.equal(commits[0].author, "root");

  // Someone edits the schema straight in the repository.
  const outside = path.join(root, "outside");
  runGit(["clone", "-b", "main", pathToFileURL(remote).href, outside], root);
  const outsideFile = path.join(outside, "db", "sales.json");
  const edited = JSON.parse(fs.readFileSync(outsideFile, "utf8"));
  edited.name = "Sales renamed";
  edited.document.tables.push({ id: "t2", name: "invoice" });
  fs.writeFileSync(outsideFile, `${JSON.stringify(edited, null, 2)}\n`);
  runGit(["add", "-A"], outside);
  runGit(["commit", "-m", "Add invoice table"], outside);
  runGit(["push", "origin", "main"], outside);

  const pulled = await fetch(`${base}/api/diagrams/${diagram.id}/git/pull`, {
    method: "POST",
    headers: authed,
  });
  assert.equal(pulled.status, 200);
  const pullResult = await pulled.json();
  assert.equal(pullResult.diagram.name, "Sales renamed");
  assert.equal(pullResult.diagram.document.tables.length, 2);
  assert.equal(pullResult.diagram.version, diagram.version + 1);

  const reloaded = await fetch(`${base}/api/diagrams/${diagram.id}`, {
    headers: authed,
  });
  assert.equal((await reloaded.json()).document.tables[1].name, "invoice");
});

test("repository settings are owner-only and never leak the token", async (t) => {
  const root = temporaryDirectory("drawdb-git-acl-");
  const { application, base, cookie } = await signedInInstance(
    path.join(root, "work"),
  );
  t.after(() => {
    application.server.close();
    application.database.close();
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.GIT_ALLOW_LOCAL_REMOTES;
    delete process.env.GIT_WORKDIR;
  });

  const authed = { ...JSON_HEADERS, Cookie: cookie };
  const created = await fetch(`${base}/api/diagrams`, {
    method: "POST",
    headers: authed,
    body: JSON.stringify({ name: "Sales", document: { tables: [] } }),
  });
  const diagram = await created.json();

  await fetch(`${base}/api/admin/users`, {
    method: "POST",
    headers: authed,
    body: JSON.stringify({ username: "member", password: PASSWORD }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ username: "member", password: PASSWORD }),
  });
  const memberCookie = login.headers.get("set-cookie").split(";")[0];
  const memberId = (await login.json()).user.id;
  // Diagrams are private until shared; make "member" an editor of this one.
  const shared = await fetch(
    `${base}/api/diagrams/${diagram.id}/members/${memberId}`,
    {
      method: "PUT",
      headers: authed,
      body: JSON.stringify({ role: "editor" }),
    },
  );
  assert.equal(shared.status, 200);

  const settings = JSON.stringify({
    remoteUrl: "https://github.com/acme/schema.git",
    branch: "main",
    token: "secret-token",
  });
  const asOwner = await fetch(`${base}/api/diagrams/${diagram.id}/git`, {
    method: "PUT",
    headers: authed,
    body: settings,
  });
  assert.equal(asOwner.status, 200);
  const body = await asOwner.text();
  assert.equal(body.includes("secret-token"), false);
  assert.equal(JSON.parse(body).settings.hasToken, true);

  const asMember = await fetch(`${base}/api/diagrams/${diagram.id}/git`, {
    method: "PUT",
    headers: { ...JSON_HEADERS, Cookie: memberCookie },
    body: settings,
  });
  assert.equal(asMember.status, 403);

  // A collaborator may still see where the diagram syncs and push it.
  const visible = await fetch(`${base}/api/diagrams/${diagram.id}/git`, {
    headers: { Cookie: memberCookie },
  });
  const state = await visible.json();
  assert.equal(state.canConfigure, false);
  assert.equal(state.canSync, true);
  assert.equal(state.settings.remoteUrl, "https://github.com/acme/schema.git");

  const anonymous = await fetch(`${base}/api/diagrams/${diagram.id}/git`);
  assert.equal(anonymous.status, 401);
});

test("a symbolic link in the repository cannot redirect writes outside it", async (t) => {
  if (!(await isGitAvailable())) {
    t.skip("git is not installed");
    return;
  }
  const root = temporaryDirectory("drawdb-git-link-");
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const victim = path.join(root, "victim.sqlite");
  fs.writeFileSync(victim, "precious data");
  fs.mkdirSync(remote, { recursive: true });
  runGit(["init", "--bare", "-b", "main", "."], remote);
  fs.mkdirSync(seed);
  runGit(["init", "-b", "main", "."], seed);
  fs.symlinkSync(victim, path.join(seed, "schema.json"));
  runGit(["add", "-A"], seed);
  runGit(["commit", "-m", "plant a link"], seed);
  runGit(["push", remote, "main"], seed);

  const { application, base, cookie } = await signedInInstance(
    path.join(root, "work"),
  );
  t.after(() => {
    application.server.close();
    application.database.close();
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.GIT_ALLOW_LOCAL_REMOTES;
    delete process.env.GIT_WORKDIR;
  });
  const authed = { ...JSON_HEADERS, Cookie: cookie };
  const diagram = await (
    await fetch(`${base}/api/diagrams`, {
      method: "POST",
      headers: authed,
      body: JSON.stringify({
        name: "Linked",
        document: { database: "postgresql", tables: [], references: [] },
      }),
    })
  ).json();
  await fetch(`${base}/api/diagrams/${diagram.id}/git`, {
    method: "PUT",
    headers: authed,
    body: JSON.stringify({
      remoteUrl: pathToFileURL(remote).href,
      branch: "main",
      fileName: "schema",
    }),
  });
  await fetch(`${base}/api/diagrams/${diagram.id}/git/push`, {
    method: "POST",
    headers: authed,
    body: JSON.stringify({ sql: "SELECT 1;" }),
  });
  assert.equal(fs.readFileSync(victim, "utf8"), "precious data");
  const pulled = await fetch(`${base}/api/diagrams/${diagram.id}/git/pull`, {
    method: "POST",
    headers: authed,
  });
  assert.notEqual(pulled.status, 500);
  assert.equal(fs.readFileSync(victim, "utf8"), "precious data");
});
