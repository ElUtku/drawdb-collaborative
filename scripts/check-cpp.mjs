// Compiles the C++ export of every test diagram with several settings, as
// C++17 and C++20, with warnings as errors. When the libraries are given it
// also compiles the sqlpp11 and SOCI parts, and with SOCI's SQLite backend it
// writes rows through the generated structs and reads them back.
//
//   CXX=g++                               (default g++)
//   CPP_SQLPP11=/path/to/sqlpp11/include  (plus CPP_DATE=/path/to/date/include)
//   CPP_SOCI=/path/to/soci/install        (include/ and lib/ with soci_sqlite3)
//
//   node --import ./scripts/test-loader.mjs scripts/check-cpp.mjs [filter]

/* global process */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DB } from "../src/data/constants.js";
import { dbToTypes } from "../src/data/datatypes.js";
import { generateCpp } from "../src/utils/exportAs/cpp.js";
import { generateSQL } from "../src/utils/exportSQL/index.js";
import {
  allTypesDiagram,
  diagrams,
  genericTypesDiagram,
  postgresExtrasDiagram,
} from "./sql-engines/fixtures.js";
import { shop } from "./sql-engines/migration-fixtures.js";

const env = process.env;
const cxx = env.CXX || "g++";
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "drawdb-cpp-"));

const libraryFlags = [];
if (env.CPP_SQLPP11) libraryFlags.push("-isystem", env.CPP_SQLPP11);
if (env.CPP_DATE) libraryFlags.push("-isystem", env.CPP_DATE);
if (env.CPP_SOCI) {
  libraryFlags.push("-isystem", path.join(env.CPP_SOCI, "include"));
}

const DIALECTS = [
  DB.MYSQL,
  DB.MARIADB,
  DB.POSTGRES,
  DB.SQLITE,
  DB.MSSQL,
  DB.ORACLESQL,
];

function cases() {
  const list = [];
  for (const dialect of DIALECTS) {
    for (const [name, build] of Object.entries(diagrams)) {
      list.push([`${dialect} ${name}`, build(dialect)]);
    }
    list.push([`${dialect} all_types`, allTypesDiagram(dialect, dbToTypes)]);
    list.push([`${dialect} shop`, { ...shop(dialect), title: "Shop" }]);
  }
  list.push(["postgresql extras", postgresExtrasDiagram()]);
  list.push(["generic all_types", genericTypesDiagram(dbToTypes)]);
  return list;
}

const optionSets = [
  {},
  { standard: "cpp20" },
  { nullableAs: "plain", timeAs: "tm", decimalAs: "string" },
  {
    timeAs: "string",
    memberCase: "camel",
    typeSuffix: "Row",
    headerGuard: "ifndef",
    enumClasses: false,
    columnNames: false,
    defaults: false,
    comparisons: false,
    includeComments: false,
    namespaceName: "app::db",
  },
  {
    memberCase: "snake",
    standard: "cpp20",
    timeAs: "chrono",
    singularTypes: true,
  },
].map((set) => ({
  ...set,
  sqlpp11: Boolean(env.CPP_SQLPP11),
  soci: Boolean(env.CPP_SOCI),
}));

function compile(header, standard, label) {
  const dir = fs.mkdtempSync(path.join(work, "case-"));
  fs.writeFileSync(path.join(dir, "schema.hpp"), header);
  // Included twice: the header guard must hold.
  fs.writeFileSync(
    path.join(dir, "main.cpp"),
    '#include "schema.hpp"\n#include "schema.hpp"\nint main() { return 0; }\n',
  );
  const result = spawnSync(
    cxx,
    [
      `-std=${standard === "cpp20" ? "c++20" : "c++17"}`,
      "-fsyntax-only",
      "-Wall",
      "-Wextra",
      "-Wpedantic",
      "-Werror",
      ...libraryFlags,
      path.join(dir, "main.cpp"),
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.log(`\n✗ ${label}`);
    console.log(result.stderr.split("\n").slice(0, 25).join("\n"));
    if (env.SHOW_CODE) console.log(header);
    return false;
  }
  return true;
}

let runs = 0;
let failures = 0;
for (const [name, diagram] of cases()) {
  if (filter && !filter.test(name)) continue;
  for (const options of optionSets) {
    const { code, issues } = generateCpp(diagram, options);
    const errors = issues.filter((issue) => issue.level === "error");
    if (errors.length) {
      failures++;
      console.log(`✗ ${name}: ${JSON.stringify(errors)}`);
      continue;
    }
    runs++;
    const standard = options.standard ?? "cpp17";
    if (!compile(code, standard, `${name} · ${JSON.stringify(options)}`)) {
      failures++;
    }
  }
}

// The shop schema plus a table with the other kinds of column.
function roundTripDiagram() {
  const diagram = { ...shop(DB.SQLITE), title: "Shop" };
  const column = (id, name, type, extra = {}) => ({
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
  diagram.tables.push({
    id: "t_e",
    name: "events",
    x: 0,
    y: 0,
    comment: "",
    indices: [],
    fields: [
      column("e_id", "id", "INTEGER", { primary: true }),
      column("e_flag", "flag", "BOOLEAN", { notNull: true }),
      column("e_payload", "payload", "BLOB"),
      column("e_at", "at", "TIME"),
      column("e_day", "day", "DATE"),
      column("e_stamp", "stamp", "TIMESTAMP"),
      column("e_ratio", "ratio", "REAL"),
    ],
  });
  return diagram;
}

function build(dir, main, libraries) {
  fs.writeFileSync(path.join(dir, "main.cpp"), main);
  const binary = path.join(dir, "program");
  const result = spawnSync(
    cxx,
    [
      "-std=c++17",
      "-Wall",
      "-Wextra",
      "-Werror",
      ...libraryFlags,
      path.join(dir, "main.cpp"),
      "-o",
      binary,
      ...libraries,
      "-lsqlite3",
      "-ldl",
      "-lpthread",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return { ok: false, out: result.stderr };
  const ran = spawnSync(binary, { encoding: "utf8" });
  return { ok: ran.status === 0, out: `${ran.stdout}${ran.stderr}` };
}

const schemaStatements = (diagram) =>
  generateSQL(diagram, { options: { existing: "create" } })
    .sql.split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s && !/^PRAGMA/i.test(s));

// sqlpp11: insert and select through its SQLite connector.
if (env.CPP_SQLPP11 && (!filter || filter.test("sqlpp11"))) {
  runs++;
  const diagram = roundTripDiagram();
  const { code } = generateCpp(diagram, { sqlpp11: true });
  const dir = fs.mkdtempSync(path.join(work, "sqlpp11-"));
  fs.writeFileSync(path.join(dir, "schema.hpp"), code);
  const result = build(
    dir,
    `#include "schema.hpp"
#include <sqlpp11/sqlite3/sqlite3.h>
#include <sqlpp11/sqlpp11.h>
#include <iostream>

int main() {
  sqlpp::sqlite3::connection_config config;
  config.path_to_database = ":memory:";
  config.flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE;
  sqlpp::sqlite3::connection db(config);
${schemaStatements(diagram)
  .map((s) => `  db.execute(R"drawdb(${s})drawdb");`)
  .join("\n")}
  const shop::tables::Customers customers{};
  const shop::tables::Orders orders{};
  db(insert_into(customers).set(customers.email = "ann@example.com", customers.name = "Ann"));
  db(insert_into(orders).set(orders.customerId = 1, orders.total = 12.5, orders.status = "paid"));
  int found = 0;
  for (const auto& row : db(select(customers.id, customers.email, customers.name)
                              .from(customers)
                              .where(customers.email == "ann@example.com"))) {
    if (row.id.value() != 1 || row.name.is_null() || row.name.value() != "Ann") return 1;
    ++found;
  }
  for (const auto& row : db(select(orders.total, orders.note).from(orders).unconditionally())) {
    if (row.total.value() != 12.5 || !row.note.is_null()) return 1;
    ++found;
  }
  if (found != 2) return 1;
  std::cout << "ok\\n";
  return 0;
}
`,
    [],
  );
  if (!result.ok) {
    failures++;
    console.log("\n✗ sqlpp11 run");
    console.log(result.out.split("\n").slice(0, 30).join("\n"));
  } else {
    console.log("- sqlpp11 through SQLite: ok");
  }
}

// Round trip through SQLite with SOCI: insert a struct, read it back, compare.
if (env.CPP_SOCI && (!filter || filter.test("roundtrip"))) {
  runs++;
  const diagram = roundTripDiagram();
  const { code } = generateCpp(diagram, { soci: true });
  const dir = fs.mkdtempSync(path.join(work, "roundtrip-"));
  fs.writeFileSync(path.join(dir, "schema.hpp"), code);
  const result = build(
    dir,
    `#include "schema.hpp"
#include <soci/sqlite3/soci-sqlite3.h>
#include <iostream>

int main() {
  soci::session sql(*soci::factory_sqlite3(), ":memory:");
${schemaStatements(diagram)
  .map((s) => `  sql << R"drawdb(${s})drawdb";`)
  .join("\n")}
  shop::Customers ann;
  ann.id = 7;
  ann.email = "ann@example.com";
  ann.name = std::nullopt;
  ann.created = std::chrono::system_clock::from_time_t(1700000000);
  sql << "INSERT INTO customers (id, email, name, created) VALUES (:id, :email, :name, :created)", soci::use(ann);
  shop::Customers back;
  sql << "SELECT id, email, name, created FROM customers WHERE id = 7", soci::into(back);
  if (!(back == ann)) {
    std::cerr << "customer differs after the round trip\\n";
    return 1;
  }

  shop::Orders order;
  order.customer_id = 7;
  order.total = 12.5;
  order.status = std::string("paid");
  order.note = std::string("first");
  sql << "INSERT INTO orders (customer_id, total, status, note) VALUES (:customer_id, :total, :status, :note)", soci::use(order);
  shop::Orders stored;
  sql << "SELECT id, customer_id, total, status, note FROM orders", soci::into(stored);
  order.id = 1;
  if (!(stored == order)) {
    std::cerr << "order differs after the round trip\\n";
    return 1;
  }

  shop::Events event;
  event.id = 3;
  event.flag = true;
  event.payload = std::vector<std::uint8_t>{0, 1, 2, 255};
  event.at = std::chrono::hours(10) + std::chrono::minutes(20) + std::chrono::seconds(30);
  event.day = std::chrono::system_clock::from_time_t(1700006400);
  event.stamp = std::chrono::system_clock::from_time_t(1700000000);
  event.ratio = 0.25f;
  sql << "INSERT INTO events (id, flag, payload, at, day, stamp, ratio) VALUES (:id, :flag, :payload, :at, :day, :stamp, :ratio)", soci::use(event);
  shop::Events read;
  sql << "SELECT id, flag, payload, at, day, stamp, ratio FROM events", soci::into(read);
  if (!(read == event)) {
    std::cerr << "event differs after the round trip\\n";
    return 1;
  }
  std::cout << "ok\\n";
  return 0;
}
`,
    [`-L${path.join(env.CPP_SOCI, "lib")}`, "-lsoci_sqlite3", "-lsoci_core"],
  );
  if (!result.ok) {
    failures++;
    console.log("\n✗ SOCI round trip");
    console.log(result.out.split("\n").slice(0, 25).join("\n"));
  } else {
    console.log("- SOCI round trip through SQLite: ok");
  }
}

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n${runs} C++ checks, ${failures} failures`);
process.exitCode = failures ? 1 : 0;
