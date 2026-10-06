import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { DB } from "../../data/constants.js";
import { dbToTypes } from "../../data/datatypes.js";
import {
  actionsDiagram,
  allTypesDiagram,
  diagrams,
  field,
  genericTypesDiagram,
  invalidDiagrams,
} from "../../../scripts/sql-engines/fixtures.js";
import { generateSQL, normalizeSqlOptions, sqlOptionDefsFor } from "./index.js";
import {
  quoteColumnsInExpression,
  quoteIdentifier,
  stringLiteral,
} from "./names.js";

const DIALECTS = [
  DB.MYSQL,
  DB.MARIADB,
  DB.POSTGRES,
  DB.SQLITE,
  DB.MSSQL,
  DB.ORACLESQL,
];
const EXISTING = ["create", "if_not_exists", "drop_create"];
const errors = (issues) => issues.filter((issue) => issue.level === "error");

function runSqlite(sql, times = 1) {
  const db = new Database(":memory:");
  try {
    for (let i = 0; i < times; i++) db.exec(sql);
    return db;
  } catch (error) {
    db.close();
    throw new Error(`${error.message}\n${sql}`);
  }
}

test("every fixture runs on SQLite, twice when the script is re-runnable", () => {
  const cases = [
    ...Object.entries(diagrams).map(([name, build]) => [
      name,
      build(DB.SQLITE),
    ]),
    ...Object.entries(diagrams).map(([name, build]) => [
      `generic ${name}`,
      build(DB.GENERIC),
    ]),
    ["all types", allTypesDiagram(DB.SQLITE, dbToTypes)],
    ["generic all types", genericTypesDiagram(dbToTypes)],
  ];
  for (const [, diagram] of cases) {
    for (const existing of EXISTING) {
      const { sql } = generateSQL(diagram, {
        dialect: DB.SQLITE,
        options: { existing },
      });
      runSqlite(sql, existing === "create" ? 1 : 2).close();
    }
  }
});

test("SQLite enforces the generated keys", () => {
  const { sql } = generateSQL(diagrams.basic(DB.SQLITE));
  const db = runSqlite(sql);
  db.prepare("INSERT INTO customers (email) VALUES (?)").run("a@x");
  assert.throws(() =>
    db.prepare("INSERT INTO customers (email) VALUES (?)").run("a@x"),
  );
  assert.throws(() =>
    db.prepare("INSERT INTO orders (customer_id) VALUES (99)").run(),
  );
  db.prepare("INSERT INTO orders (customer_id) VALUES (1)").run();
  const order = db.prepare("SELECT status, total FROM orders").get();
  assert.deepEqual(order, { status: "new", total: 0 });
  db.close();
});

test("all foreign key actions produce a script on every engine", () => {
  const actions = [
    "No action",
    "Restrict",
    "Cascade",
    "Set null",
    "Set default",
  ];
  for (const dialect of DIALECTS) {
    for (const del of actions) {
      for (const upd of actions) {
        const { sql } = generateSQL(actionsDiagram(dialect, del, upd));
        assert.match(sql, /FOREIGN KEY/);
        if (dialect === DB.ORACLESQL) assert.doesNotMatch(sql, /ON UPDATE/);
        if (dialect === DB.MSSQL) assert.doesNotMatch(sql, /RESTRICT/);
      }
    }
  }
});

test("names are quoted and escaped for each engine", () => {
  assert.equal(quoteIdentifier("a`b", DB.MYSQL), "`a``b`");
  assert.equal(quoteIdentifier('a"b', DB.POSTGRES), '"a""b"');
  assert.equal(quoteIdentifier("a]b", DB.MSSQL), "[a]]b]");
  assert.equal(quoteIdentifier("users", DB.POSTGRES, "when_needed"), "users");
  assert.equal(quoteIdentifier("Users", DB.POSTGRES, "when_needed"), '"Users"');
  assert.equal(quoteIdentifier("order", DB.MYSQL, "when_needed"), "`order`");
  assert.equal(
    stringLiteral("it's a \\ path", DB.MYSQL),
    "'it''s a \\\\ path'",
  );
  assert.equal(
    stringLiteral("it's a \\ path", DB.POSTGRES),
    "'it''s a \\ path'",
  );
  assert.equal(stringLiteral("ñ", DB.MSSQL), "N'ñ'");
});

test("comments never break out of their literal or line", () => {
  for (const dialect of DIALECTS) {
    const { sql } = generateSQL(diagrams.basic(dialect));
    assert.doesNotMatch(sql, /\/\*/);
    for (const line of sql.split("\n")) {
      if (line.includes("Second line")) {
        assert.ok(
          line.trimStart().startsWith("--") ||
            /'.*Second line/.test(line) ||
            /^Second line/.test(line),
          `${dialect}: ${line}`,
        );
      }
    }
  }
});

test("CHECK expressions find quoted columns", () => {
  const quote = (name) => quoteIdentifier(name, DB.ORACLESQL);
  assert.equal(
    quoteColumnsInExpression(
      "total >= 0 AND length(name) > 'total'",
      ["total", "name"],
      quote,
    ),
    `"total" >= 0 AND length("name") > 'total'`,
  );
  assert.equal(
    quoteColumnsInExpression("año > a", ["a", "año"], quote),
    `"año" > "a"`,
  );
  assert.equal(
    quoteColumnsInExpression(
      '"total" > 0 AND max(total) > 1',
      ["total"],
      quote,
    ),
    `"total" > 0 AND max("total") > 1`,
  );
});

test("defaults are written the way each engine accepts them", () => {
  const sql = (dialect) =>
    generateSQL(diagrams.defaults(dialect), {
      options: { includeHeader: false },
    }).sql;
  assert.match(sql(DB.MYSQL), /`txt` TEXT DEFAULT \('long ''text'''\)/);
  assert.match(sql(DB.MARIADB), /`txt` TEXT DEFAULT 'long ''text'''/);
  assert.match(sql(DB.MYSQL), /`d_today` DATE DEFAULT \(CURRENT_DATE\)/);
  assert.match(sql(DB.SQLITE), /"b_true" BOOLEAN DEFAULT 1/);
  assert.match(sql(DB.MSSQL), /\[b_true\] BIT CONSTRAINT \[[^\]]+\] DEFAULT 1/);
  assert.match(sql(DB.ORACLESQL), /"d_date" DATE DEFAULT DATE '2024-01-31'/);
  assert.match(
    sql(DB.POSTGRES),
    /"s_prequoted" VARCHAR\(50\) DEFAULT 'already'/,
  );
  assert.doesNotMatch(sql(DB.POSTGRES), /"n_null_nn" INTEGER NOT NULL DEFAULT/);
});

test("PostgreSQL enums and types come before the tables that use them", () => {
  const { sql } = generateSQL(
    {
      database: DB.POSTGRES,
      enums: [{ name: "Mood", values: ["ok", "it's fine"] }],
      types: [
        { name: "pair", comment: "", fields: [{ name: "m", type: "MOOD" }] },
      ],
      tables: [
        {
          id: 1,
          name: "t",
          comment: "",
          indices: [],
          fields: [
            field({ id: 1, name: "m", type: "MOOD" }),
            field({ id: 2, name: "p", type: "PAIR" }),
          ],
        },
      ],
      references: [],
    },
    { options: { existing: "if_not_exists" } },
  );
  const enumAt = sql.indexOf(`CREATE TYPE "Mood" AS ENUM ('ok', 'it''s fine')`);
  const typeAt = sql.indexOf(`CREATE TYPE "pair"`);
  const tableAt = sql.indexOf(`CREATE TABLE IF NOT EXISTS "t"`);
  assert.ok(enumAt > 0 && enumAt < typeAt && typeAt < tableAt, sql);
  assert.match(sql, /"m" "Mood"/);
  assert.match(sql, /WHEN duplicate_object THEN NULL/);
});

test("generic diagrams map their types to each engine", () => {
  const diagram = genericTypesDiagram(dbToTypes);
  const sql = (dialect) => generateSQL(diagram, { dialect }).sql;
  assert.match(sql(DB.POSTGRES), /"c_uuid" UUID/);
  assert.match(sql(DB.MYSQL), /`c_uuid` CHAR\(36\)/);
  assert.match(sql(DB.MSSQL), /\[c_uuid\] UNIQUEIDENTIFIER/);
  assert.match(
    sql(DB.ORACLESQL),
    /"c_boolean" NUMBER\(1\) DEFAULT 1 CHECK \("c_boolean" IN \(0, 1\)\)/,
  );
  assert.match(sql(DB.MYSQL), /`c_custom` JSON CHECK \(JSON_SCHEMA_VALID\(/);
  assert.match(sql(DB.POSTGRES), /CREATE TYPE "point_t" AS/);
  assert.match(
    sql(DB.SQLITE),
    /"c_enum" TEXT CHECK \("c_enum" IN \('a', 'b''s', 'c\\d'\)\)/,
  );
});

test("keys that would fail on the engine are reported as errors", () => {
  for (const dialect of DIALECTS.filter((d) => d !== DB.SQLITE)) {
    for (const [name, build] of Object.entries(invalidDiagrams)) {
      const { issues } = generateSQL(build(dialect));
      assert.ok(errors(issues).length > 0, `${dialect} ${name}`);
    }
  }
  const { issues } = generateSQL(diagrams.keys(DB.MSSQL));
  assert.ok(issues.some((issue) => issue.code === "mssql_cascade_paths"));
});

test("an index over a column that no longer exists is left out whole", () => {
  const { sql, issues } = generateSQL(diagrams.keys(DB.POSTGRES));
  assert.doesNotMatch(sql, /idx_stale/);
  assert.ok(issues.some((issue) => issue.code === "stale_column_reference"));
});

test("generated names stay unique and within the engine's length", () => {
  const { sql } = generateSQL(diagrams.edge(DB.POSTGRES));
  assert.match(sql, /"idx_shared"/);
  assert.match(sql, /"idx_shared_2"/);
  const long = generateSQL(diagrams.names(DB.ORACLESQL)).sql;
  for (const [, name] of long.matchAll(/CONSTRAINT "([^"]+)"/g)) {
    assert.ok(name.length <= 30, name);
  }
});

test("options are validated and only the relevant ones are offered", () => {
  const options = normalizeSqlOptions(DB.MYSQL, {
    existing: "nonsense",
    includeComments: "yes",
    mysqlIndexPrefix: 100000,
    schema: "  app ",
  });
  assert.equal(options.existing, "if_not_exists");
  assert.equal(options.includeComments, true);
  assert.equal(options.mysqlIndexPrefix, 255);
  assert.equal(options.schema, "app");
  const keys = (dialect, source) =>
    sqlOptionDefsFor(dialect, source).map((def) => def.key);
  assert.ok(!keys(DB.SQLITE).includes("schema"));
  assert.ok(!keys(DB.MYSQL).includes("uuidAs"));
  assert.ok(keys(DB.MYSQL, DB.GENERIC).includes("uuidAs"));
  for (const def of sqlOptionDefsFor(DB.MYSQL)) {
    assert.ok(["basic", "advanced"].includes(def.section));
  }
});
