// End-to-end journeys in a real browser: accounts (create, disable, delete),
// sharing and roles with live access changes, history, restore and migration,
// exports (SQL, C++, Protobuf), shared custom types, activity log and backups.
// It starts its own server on a temporary database and needs a built client
// (npm run build) and Playwright, which is not a dependency of the project:
//
//   npm install --no-save playwright      (and a Chromium: npx playwright install chromium,
//                                          or CHROMIUM_PATH=/path/to/chrome)
//   node scripts/e2e.mjs [screenshot directory]

/* global process, Buffer */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { chromium } = await import("playwright").catch(() => {
  console.error("Playwright is needed: npm install --no-save playwright");
  process.exit(1);
});

const PORT = Number(process.env.E2E_PORT || 3999);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.argv[2];
const data = fs.mkdtempSync(path.join(os.tmpdir(), "drawdb-e2e-"));
const server = spawn(process.execPath, ["server/index.js"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATABASE_PATH: path.join(data, "drawdb.sqlite"),
    BACKUP_DIR: path.join(data, "backups"),
    SETUP_CODE: "e2e-setup-code",
    HISTORY_INTERVAL_MINUTES: "0",
  },
  stdio: "ignore",
});
const stop = () => {
  server.kill();
  fs.rmSync(data, { recursive: true, force: true });
};
for (let i = 0; i < 50; i++) {
  const up = await fetch(`${BASE}/api/auth/status`).then(
    (r) => r.ok,
    () => false,
  );
  if (up) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}

const PASSWORD = "correct-horse-9";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH && {
    executablePath: process.env.CHROMIUM_PATH,
  }),
});
const external = [];
const pageErrors = [];
async function newUser() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on("request", (r) => {
    const url = r.url();
    if (
      !url.startsWith(BASE) &&
      !url.startsWith("data:") &&
      !url.startsWith("blob:") &&
      !url.startsWith(BASE.replace("http", "ws"))
    ) {
      external.push(url);
    }
  });
  page.on("pageerror", (e) => pageErrors.push(e.message));
  return { context, page };
}

async function login(page, username, password = PASSWORD) {
  await page.goto(`${BASE}/login`);
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
}

async function closeModal(page) {
  for (let i = 0; i < 3; i++) {
    const close = page.locator(".semi-modal-close").last();
    if (!(await close.isVisible().catch(() => false))) return;
    await close.click().catch(() => {});
    await page.waitForTimeout(500);
  }
}

// A new, empty editor first asks for the database.
async function pickDatabase(page, name = "PostgreSQL") {
  await page.waitForTimeout(1200);
  const dialog = page.locator(".semi-modal", { hasText: "Confirm" });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByText(name, { exact: true }).first().click();
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await page.waitForTimeout(500);
  }
}

async function menu(page, ...path) {
  await page.getByText("File", { exact: true }).first().click();
  await page.waitForTimeout(300);
  for (let i = 0; i < path.length; i++) {
    const item = page.getByText(path[i], { exact: true }).first();
    if (i < path.length - 1) {
      await item.hover();
      await page.waitForTimeout(300);
    } else {
      await item.click();
    }
  }
  await page.waitForTimeout(800);
}

async function codeOf(page) {
  // The editor shows only the visible lines: read the exported file instead.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".semi-modal-footer button", { hasText: "Export" }).click(),
  ]);
  return fs.readFileSync(await download.path(), "utf8");
}

async function api(page, method, url, body) {
  const response = await page.request.fetch(`${BASE}${url}`, {
    method,
    ...(body !== undefined && { data: body }),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status(), data };
}

// --- 1. The administrator sets up the instance --------------------------------
const admin = await newUser();
await admin.page.goto(`${BASE}/register`);
await admin.page.fill("#setup-code", "e2e-setup-code");
await admin.page.fill("#username", "admin");
await admin.page.fill("#password", PASSWORD);
await admin.page.fill("#confirmation", PASSWORD);
await admin.page.click("button[type=submit]");
await admin.page.waitForURL(/\/editor/, { timeout: 15000 });
check("administrator account created with the setup code", true);
await pickDatabase(admin.page);

// --- 2. Accounts from the admin panel ------------------------------------------------
await admin.page.getByRole("button", { name: "Administration" }).click();
await admin.page.waitForTimeout(800);
for (const name of ["ana", "bob", "carl"]) {
  await admin.page.fill("#admin-username", name);
  await admin.page.fill("#admin-password", PASSWORD);
  await admin.page.getByRole("button", { name: "Add user" }).click();
  await admin.page.locator(`[data-testid=admin-user-${name}]`).waitFor();
  await admin.page.waitForTimeout(300);
}
const userRows = await admin.page.locator("[data-testid^=admin-user-]").count();
check("admin panel lists the new accounts", userRows === 4, `${userRows} rows`);
await shot(admin.page, "01-admin-users");

// Disable carl: carl cannot sign in.
await admin.page
  .locator("[data-testid=admin-user-carl]")
  .getByRole("button", { name: "Disable" })
  .click();
await admin.page.waitForTimeout(300);
await admin.page
  .locator(".semi-popconfirm")
  .getByRole("button", { name: /OK|Yes|Confirm/i })
  .click();
await admin.page.waitForTimeout(800);
check(
  "disabled account is marked",
  (
    await admin.page.locator("[data-testid=admin-user-carl]").innerText()
  ).includes("Disabled"),
);
const carl = await newUser();
await login(carl.page, "carl");
await carl.page.waitForTimeout(1500);
check("disabled account cannot sign in", /\/login/.test(carl.page.url()));
await closeModal(admin.page);

// --- 3. Ana creates a diagram through the UI --------------------------------------------
const ana = await newUser();
await login(ana.page, "ana");
await ana.page.waitForURL(/\/editor/, { timeout: 15000 });
await pickDatabase(ana.page);
await ana.page.getByRole("button", { name: "Add table", exact: true }).click();
await ana.page.waitForTimeout(500);
await ana.page.getByRole("button", { name: "Add table", exact: true }).click();
await ana.page.waitForURL(/\/diagrams\//, { timeout: 15000 });
await ana.page.waitForTimeout(2000);
const diagramId = ana.page.url().split("/diagrams/")[1];
check(
  "new diagram saved on the server from the editor",
  Boolean(diagramId),
  diagramId,
);
let stored = await api(ana.page, "GET", `/api/diagrams/${diagramId}`);
check(
  "the diagram has the two tables drawn",
  stored.data?.document?.tables?.length === 2,
  `${stored.data?.document?.tables?.length} tables, role ${stored.data?.role}`,
);
check("the creator is its owner", stored.data?.role === "owner");
await shot(ana.page, "02-ana-editor");

// Make the schema meaningful through the API (as a second client would).
const table = (id, name, fields, x) => ({
  id,
  name,
  x,
  y: 60,
  comment: "",
  color: "#175e7a",
  indices: [],
  fields,
});
const field = (id, name, type, extra = {}) => ({
  id,
  name,
  type,
  default: "",
  check: "",
  primary: false,
  unique: false,
  notNull: false,
  increment: false,
  comment: "",
  ...extra,
});
const schema = {
  database: "postgresql",
  tables: [
    table(
      "t1",
      "customers",
      [
        field("c1", "id", "INTEGER", { primary: true, increment: true }),
        field("c2", "email", "VARCHAR", {
          size: "120",
          notNull: true,
          unique: true,
        }),
      ],
      40,
    ),
    table(
      "t2",
      "orders",
      [
        field("o1", "id", "INTEGER", { primary: true, increment: true }),
        field("o2", "customer_id", "INTEGER", { notNull: true }),
        field("o3", "total", "NUMERIC", { size: "10,2", default: "0" }),
      ],
      420,
    ),
  ],
  references: [
    {
      id: "r1",
      name: "",
      startTableId: "t2",
      startFieldId: "o2",
      endTableId: "t1",
      endFieldId: "c1",
      cardinality: "many_to_one",
      updateConstraint: "No action",
      deleteConstraint: "Cascade",
    },
  ],
  notes: [],
  areas: [],
  enums: [],
  types: [],
};
let put = await api(ana.page, "PUT", `/api/diagrams/${diagramId}`, {
  name: "Shop",
  document: schema,
  baseVersion: stored.data.version,
});
check("schema saved", put.status === 200, `status ${put.status}`);
await ana.page.waitForTimeout(1500);
check(
  "the open editor shows the saved schema live",
  await ana.page
    .getByText("customers")
    .first()
    .isVisible()
    .catch(() => false),
);

// --- 4. Private by default: bob cannot open it --------------------------------------------
const bob = await newUser();
await login(bob.page, "bob");
await bob.page.waitForURL(/\/editor/, { timeout: 15000 });
await pickDatabase(bob.page);
const denied = await api(bob.page, "GET", `/api/diagrams/${diagramId}`);
check(
  "a new diagram is private to its owner",
  denied.status === 403,
  `status ${denied.status}`,
);

// --- 5. Ana shares it with bob as a viewer --------------------------------------------------
await menu(ana.page, "Share");
await ana.page.waitForTimeout(800);
await ana.page.getByText("Pick a person").first().click();
await ana.page.waitForTimeout(300);
await ana.page.locator(".semi-select-option", { hasText: "bob" }).click();
await ana.page
  .locator(".semi-modal", { hasText: "People with access" })
  .getByRole("button", { name: "Share", exact: true })
  .click();
await ana.page.waitForTimeout(1000);
check(
  "bob appears as a viewer in the share dialog",
  await ana.page.locator("[data-testid=member-bob]").isVisible(),
);
await shot(ana.page, "03-share");
await closeModal(ana.page);

await bob.page.goto(`${BASE}/editor/diagrams/${diagramId}`);
await bob.page.waitForTimeout(3000);
check(
  "viewer sees the read-only badge",
  await bob.page.getByText("Read only").first().isVisible(),
);
check(
  "viewer cannot add tables",
  await bob.page
    .getByRole("button", { name: "Add table", exact: true })
    .isDisabled(),
);
await shot(bob.page, "04-bob-viewer");
const sneaky = await api(bob.page, "PUT", `/api/diagrams/${diagramId}`, {
  document: schema,
  baseVersion: 1,
});
check(
  "viewer's edits are refused by the server",
  sneaky.status === 403,
  `status ${sneaky.status}`,
);

// Live edit by ana reaches bob.
stored = await api(ana.page, "GET", `/api/diagrams/${diagramId}`);
const withProducts = structuredClone(schema);
withProducts.tables.push(
  table(
    "t3",
    "products",
    [
      field("p1", "id", "INTEGER", { primary: true }),
      field("p2", "sku", "VARCHAR", { size: "40", notNull: true }),
    ],
    800,
  ),
);
put = await api(ana.page, "PUT", `/api/diagrams/${diagramId}`, {
  document: withProducts,
  baseVersion: stored.data.version,
});
await bob.page.waitForTimeout(2000);
check(
  "viewer sees the owner's change live",
  await bob.page
    .getByText("products")
    .first()
    .isVisible()
    .catch(() => false),
);

// --- 6. Promote bob to editor: his editor unlocks without reloading ------------------------
await menu(ana.page, "Share");
await ana.page.waitForTimeout(800);
await ana.page.locator("[data-testid=member-bob] .semi-select").click();
await ana.page.waitForTimeout(300);
await ana.page.locator(".semi-select-option", { hasText: "Editor" }).click();
await ana.page.waitForTimeout(1500);
await closeModal(ana.page);
await bob.page.waitForTimeout(1500);
check(
  "editor role applies live (badge gone, toolbar enabled)",
  !(await bob.page
    .getByText("Read only")
    .first()
    .isVisible()
    .catch(() => false)) &&
    !(await bob.page
      .getByRole("button", { name: "Add table", exact: true })
      .isDisabled()),
);
await bob.page.getByRole("button", { name: "Add table", exact: true }).click();
await bob.page.waitForTimeout(2500);
stored = await api(ana.page, "GET", `/api/diagrams/${diagramId}`);
check(
  "an editor's change is saved and shared",
  stored.data.document.tables.length === 4,
  `${stored.data.document.tables.length} tables`,
);

// --- 7. History: name a version, change, compare, migration, restore ----------------------
await menu(ana.page, "Version history");
await ana.page.waitForTimeout(1000);
await ana.page
  .getByPlaceholder(/Name the current version/)
  .fill("before invoices");
await ana.page.getByRole("button", { name: "Save version" }).click();
await ana.page.waitForTimeout(1000);
await closeModal(ana.page);
const named = (
  await api(ana.page, "GET", `/api/diagrams/${diagramId}/versions`)
).data.versions;
const namedVersion = named.find((v) => v.title === "before invoices");
check(
  "named version stored",
  Boolean(namedVersion),
  `${named.length} versions`,
);
check(
  "a named version is credited to whoever named it",
  namedVersion?.username === "ana",
  namedVersion?.username,
);

stored = await api(ana.page, "GET", `/api/diagrams/${diagramId}`);
const changed = structuredClone(stored.data.document);
const orders = changed.tables.find((t) => t.name === "orders");
orders.fields.push(
  field("o4", "status", "VARCHAR", { size: "20", default: "new" }),
);
orders.fields.find((f) => f.name === "total").size = "12,2";
changed.tables = changed.tables.filter((t) => t.name !== "products");
changed.references = changed.references.filter((r) => r.endTableId !== "t3");
changed.tables.push(
  table(
    "t5",
    "invoices",
    [
      field("i1", "id", "INTEGER", { primary: true, increment: true }),
      field("i2", "order_id", "INTEGER", { notNull: true }),
    ],
    1100,
  ),
);
put = await api(ana.page, "PUT", `/api/diagrams/${diagramId}`, {
  document: changed,
  baseVersion: stored.data.version,
});
await ana.page.waitForTimeout(1500);

await menu(ana.page, "Version history");
await ana.page.waitForTimeout(1200);
await ana.page.locator(`[data-testid=version-${namedVersion.version}]`).click();
await ana.page.waitForTimeout(1500);
const changes = await ana.page
  .locator(".semi-modal", { hasText: "Version history" })
  .innerText();
check(
  "history shows what changed since the named version",
  changes.includes("invoices") &&
    changes.includes("products") &&
    changes.includes("status"),
);
await shot(ana.page, "05-history");
await ana.page.getByRole("button", { name: "SQL migration to now" }).click();
await ana.page.waitForTimeout(2500);
await shot(ana.page, "06-migration");
const migration = await codeOf(ana.page);
check(
  "migration has the ALTER statements for the change",
  /ALTER TABLE "orders" ADD COLUMN "status" VARCHAR\(20\) DEFAULT 'new';/.test(
    migration,
  ) &&
    /ALTER TABLE "orders" ALTER COLUMN "total" TYPE NUMERIC\(12,2\)/.test(
      migration,
    ) &&
    /DROP TABLE "products";/.test(migration) &&
    /CREATE TABLE "invoices"/.test(migration),
  migration
    .split("\n")
    .filter((l) => /^(ALTER|DROP|CREATE)/.test(l))
    .join(" | "),
);
await closeModal(ana.page);
await ana.page.waitForTimeout(500);

await menu(ana.page, "Version history");
await ana.page.waitForTimeout(1200);
await ana.page.locator(`[data-testid=version-${namedVersion.version}]`).click();
await ana.page.waitForTimeout(1000);
await ana.page.getByRole("button", { name: "Restore version" }).click();
await ana.page.waitForTimeout(300);
await ana.page
  .locator(".semi-popconfirm")
  .getByRole("button", { name: /OK|Yes|Confirm/i })
  .click();
await ana.page.waitForTimeout(2500);
await closeModal(ana.page);
stored = await api(ana.page, "GET", `/api/diagrams/${diagramId}`);
check(
  "restore brings the named version back",
  stored.data.document.tables.some((t) => t.name === "products") &&
    !stored.data.document.tables.some((t) => t.name === "invoices"),
);
await bob.page.waitForTimeout(1500);
check(
  "the restore reaches the other editor live",
  await bob.page
    .getByText("products")
    .first()
    .isVisible()
    .catch(() => false),
);

// --- 8. Exports -------------------------------------------------------------------------------
await menu(ana.page, "Export SQL");
await ana.page.waitForTimeout(2000);
const sql = await codeOf(ana.page);
check(
  "SQL export",
  /CREATE TABLE IF NOT EXISTS "customers"/.test(sql) && /FOREIGN KEY/.test(sql),
);
await closeModal(ana.page);
await ana.page.waitForTimeout(500);

await menu(ana.page, "Export as", "C++");
await ana.page.waitForTimeout(2000);
await shot(ana.page, "07-cpp");
// Turn SOCI on in the settings.
const sociRow = ana.page
  .getByText("SOCI conversions", { exact: true })
  .locator("xpath=../..");
await sociRow.locator(".semi-switch").click();
await ana.page.waitForTimeout(800);
const cpp = await codeOf(ana.page);
check(
  "C++ export with structs, optional and SOCI",
  /struct Customers \{/.test(cpp) &&
    /std::optional<double> total = 0\.0;/.test(cpp) &&
    /struct type_conversion<shop::Customers>/.test(cpp),
);
await closeModal(ana.page);
await ana.page.waitForTimeout(500);

await menu(ana.page, "Export as", "Protobuf");
await ana.page.waitForTimeout(2000);
const proto = await codeOf(ana.page);
check(
  "Protobuf export",
  /message Customers \{/.test(proto) || /message Customer \{/.test(proto),
);
await closeModal(ana.page);
await ana.page.waitForTimeout(500);

// --- 9. Shared custom types ---------------------------------------------------------------------
const types = await api(ana.page, "PUT", "/api/custom-types", {
  types: { postgresql: { CITEXT: { type: "CITEXT", color: "#7c3aed" } } },
});
check("custom type saved on the server", types.status === 200);
const seen = await api(bob.page, "GET", "/api/custom-types");
check(
  "another account sees the custom type",
  Boolean(seen.data?.types?.postgresql?.CITEXT),
);

// --- 10. Ownership, access removal --------------------------------------------------------------
await menu(ana.page, "Share");
await ana.page.waitForTimeout(800);
await ana.page
  .locator("[data-testid=member-bob]")
  .getByRole("button", { name: "Remove" })
  .click();
await bob.page.waitForTimeout(1200);
{
  const toast = await bob.page
    .getByText("You no longer have access")
    .first()
    .isVisible()
    .catch(() => false);
  const left = !bob.page.url().includes(diagramId);
  const cleared = !(await bob.page
    .getByText("products", { exact: true })
    .first()
    .isVisible()
    .catch(() => false));
  check(
    "removing a member closes the diagram for them live",
    toast && left && cleared,
    `toast ${toast}, left ${left}, cleared ${cleared}`,
  );
}
await shot(bob.page, "08-bob-removed");
await closeModal(ana.page);

// --- 11. A pg_dump file imported into a new diagram --------------------------------------------
const PG_DUMP = `--
-- PostgreSQL database dump
--
\\restrict abc123
SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SELECT pg_catalog.set_config('search_path', '', false);
CREATE TYPE public.order_status AS ENUM (
    'new',
    'paid'
);
ALTER TYPE public.order_status OWNER TO postgres;
CREATE TABLE public.customers (
    id integer NOT NULL,
    email character varying(120) NOT NULL
);
ALTER TABLE public.customers ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.customers_id_seq
    START WITH 1
    INCREMENT BY 1
    CACHE 1
);
CREATE TABLE public.orders (
    id bigint NOT NULL,
    customer_id integer NOT NULL,
    status public.order_status DEFAULT 'new'::public.order_status NOT NULL
);
COMMENT ON TABLE public.orders IS 'Placed orders';
ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;
\\unrestrict abc123
`;
await bob.page.goto(`${BASE}/editor`);
await pickDatabase(bob.page);
await menu(bob.page, "Import from SQL");
await bob.page.getByRole("tab", { name: "Upload file" }).click();
await bob.page
  .locator(".semi-modal input.semi-upload-hidden-input")
  .setInputFiles({
    name: "dump.sql",
    mimeType: "application/sql",
    buffer: Buffer.from(PG_DUMP),
  });
await bob.page.waitForTimeout(800);
await bob.page
  .locator(".semi-modal-footer button", { hasText: "Import" })
  .click();
await bob.page.waitForURL(/\/diagrams\//, { timeout: 15000 });
await bob.page.waitForTimeout(2500);
{
  const id = bob.page.url().split("/diagrams/")[1];
  const doc = (await api(bob.page, "GET", `/api/diagrams/${id}`)).data
    ?.document;
  const customers = doc?.tables?.find((t) => t.name === "customers");
  const orders = doc?.tables?.find((t) => t.name === "orders");
  const field = (table, name) => table?.fields.find((f) => f.name === name);
  check(
    "a pg_dump file imports into a new diagram",
    doc?.tables?.length === 2 &&
      field(customers, "id")?.primary &&
      field(customers, "id")?.increment &&
      field(customers, "email")?.type === "VARCHAR" &&
      field(orders, "status")?.type === "order_status" &&
      orders?.comment === "Placed orders" &&
      doc.enums?.[0]?.values?.join() === "new,paid" &&
      doc.references?.length === 1 &&
      doc.references[0].deleteConstraint === "Cascade",
    JSON.stringify(doc?.tables?.map((t) => t.name)),
  );
}
await shot(bob.page, "09-imported-dump");

// --- 12. Admin: activity, backups, delete with transfer ------------------------------------------
await admin.page.reload();
await pickDatabase(admin.page);
await admin.page.getByRole("button", { name: "Administration" }).click();
await admin.page.waitForTimeout(800);
await admin.page.getByRole("tab", { name: "Activity" }).click();
await admin.page.waitForTimeout(1500);
const activity = await admin.page
  .locator(".semi-modal", { hasText: "Administration" })
  .innerText();
check(
  "activity log shows logins, sharing and restores",
  /signed in/.test(activity) &&
    /shared the diagram with/.test(activity) &&
    /restored a version/.test(activity),
);
await shot(admin.page, "10-activity");
await admin.page.getByRole("tab", { name: "Backups" }).click();
await admin.page.waitForTimeout(800);
await admin.page.getByRole("button", { name: "Back up now" }).click();
await admin.page.waitForTimeout(2000);
check(
  "manual backup listed",
  /drawdb-\d{8}-\d{6}\.sqlite/.test(
    await admin.page
      .locator(".semi-modal", { hasText: "Administration" })
      .innerText(),
  ),
);
await shot(admin.page, "11-backups");
await admin.page.getByRole("tab", { name: "Users" }).click();
await admin.page.waitForTimeout(800);
await admin.page
  .locator("[data-testid=admin-user-ana]")
  .getByRole("button", { name: "Delete" })
  .click();
await admin.page.waitForTimeout(500);
await admin.page
  .locator("[data-testid=admin-user-ana]")
  .getByRole("button", { name: "Delete account" })
  .click();
await admin.page.waitForTimeout(1500);
const adminView = await api(admin.page, "GET", `/api/diagrams/${diagramId}`);
check(
  "deleting an account hands its diagrams to the chosen person",
  adminView.status === 200 && adminView.data.role === "owner",
  `status ${adminView.status}, role ${adminView.data?.role}`,
);
await ana.page.waitForTimeout(1500);
const anaAfter = await api(ana.page, "GET", "/api/auth/me");
check(
  "the deleted account is signed out",
  anaAfter.status === 401,
  `status ${anaAfter.status}`,
);

// --- Summary ----------------------------------------------------------------------------------------
check(
  "no requests left the server",
  external.length === 0,
  external.slice(0, 3).join(", "),
);
check(
  "no page errors",
  pageErrors.length === 0,
  pageErrors.slice(0, 3).join(" | "),
);
await browser.close();
stop();
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed`,
);
process.exitCode = failed.length ? 1 : 0;
