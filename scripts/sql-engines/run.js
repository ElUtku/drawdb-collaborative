// Runs the SQL generated for every fixture on real database engines and fails
// on any script an engine rejects without the export dialog having reported
// an error for it. Each engine is reached through its command-line client;
// set the variables of the engines you have (SQLite always runs):
//
//   SQL_PSQL      psql -h localhost -U postgres -d drawdb_test
//   SQL_MYSQL     mysql -h 127.0.0.1 -uroot -psecret
//   SQL_MARIADB   mariadb -h 127.0.0.1 -uroot -psecret
//   SQL_SQLCMD    sqlcmd -S localhost -U sa -P secret -C
//   SQL_SQLPLUS   sqlplus -s app/app@localhost/FREEPDB1
//
// The PostgreSQL database must exist; MySQL/MariaDB/SQL Server get a scratch
// database "drawdb_test"; the Oracle user must be empty (its tables are
// dropped between runs).
//
//   node --import ./scripts/test-loader.mjs scripts/sql-engines/run.js [filter]

/* global process */
import { DB } from "../../src/data/constants.js";
import { dbToTypes } from "../../src/data/datatypes.js";
import {
  generateSQL,
  normalizeSqlOptions,
} from "../../src/utils/exportSQL/index.js";
import {
  actionsDiagram,
  allTypesDiagram,
  diagrams,
  genericTypesDiagram,
  invalidDiagrams,
  postgresExtrasDiagram,
} from "./fixtures.js";
import { engines } from "./engines.js";

const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;

const ACTIONS = ["No action", "Restrict", "Cascade", "Set null", "Set default"];

function cases(dialect) {
  const list = Object.entries(diagrams).map(([name, build]) => [
    name,
    build(dialect),
  ]);
  list.push(["all_types", allTypesDiagram(dialect, dbToTypes)]);
  if (dialect === DB.POSTGRES)
    list.push(["pg_extras", postgresExtrasDiagram()]);
  for (const del of ACTIONS) {
    for (const upd of ACTIONS) {
      list.push([`fk ${del}/${upd}`, actionsDiagram(dialect, del, upd)]);
    }
  }
  for (const [name, build] of Object.entries(diagrams)) {
    list.push([`generic ${name}`, build(DB.GENERIC)]);
  }
  list.push(["generic all_types", genericTypesDiagram(dbToTypes)]);
  return list;
}

function optionSets(dialect) {
  const sets = [
    {},
    { existing: "if_not_exists" },
    { existing: "drop_create" },
    {
      existing: "create",
      foreignKeys: "alter",
      nameConstraints: false,
      identifierQuoting: "when_needed",
    },
    {
      existing: "create",
      foreignKeys: "inline",
      tableOrder: "diagram",
      includeComments: false,
    },
    { existing: "if_not_exists", foreignKeys: "alter", includeIndexes: false },
  ];
  if (dialect === DB.POSTGRES || dialect === DB.MSSQL) {
    sets.push({ schema: "app", createSchema: true, wrapInTransaction: true });
  }
  if (dialect === DB.MSSQL) {
    sets.push({ mssqlBatchSeparator: false, existing: "if_not_exists" });
  }
  if (dialect === DB.MYSQL || dialect === DB.MARIADB) {
    sets.push({ schema: "app", createSchema: true });
  }
  if (dialect === DB.ORACLESQL) {
    sets.push({ oracleBoolean: "native", identityGeneration: "always" });
  }
  if (dialect === DB.SQLITE) {
    sets.push({ wrapInTransaction: true, existing: "drop_create" });
  }
  return sets;
}

let runs = 0;
let unexpected = 0;
for (const [dialect, engine] of Object.entries(engines)) {
  if (!engine) {
    console.log(`- ${dialect}: skipped (no client configured)`);
    continue;
  }
  for (const [name, build] of Object.entries(invalidDiagrams)) {
    if (dialect === DB.SQLITE && name !== "duplicate_table") continue;
    const { issues } = generateSQL(build(dialect));
    if (!issues.some((issue) => issue.level === "error")) {
      unexpected++;
      console.log(`✗ ${dialect}: invalid diagram "${name}" was not reported`);
    }
  }
  let failed = 0;
  for (const [name, diagram] of cases(dialect)) {
    if (filter && !filter.test(name)) continue;
    for (const options of optionSets(dialect)) {
      runs++;
      const { sql, issues } = generateSQL(diagram, { dialect, options });
      const reported = issues.filter((issue) => issue.level === "error");
      engine.reset();
      let result = engine.run(sql);
      // Scripts that keep or drop existing objects must also run a second time.
      const { existing } = normalizeSqlOptions(dialect, options);
      if (result.ok && existing !== "create") result = engine.run(sql);
      if (result.ok) continue;
      failed++;
      if (reported.length) continue;
      unexpected++;
      console.log(`\n✗ ${dialect} · ${name} · ${JSON.stringify(options)}`);
      console.log(
        result.out.split("\n").filter(Boolean).slice(0, 8).join("\n"),
      );
      if (process.env.SHOW_SQL) console.log(sql);
    }
  }
  console.log(
    `- ${dialect}: ${failed} rejected scripts, all reported in advance unless listed above`,
  );
}
console.log(`\n${runs} scripts run, ${unexpected} unexpected failures`);
process.exitCode = unexpected ? 1 : 0;
