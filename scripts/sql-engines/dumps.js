// Checks the SQL import against what real engines write about a schema. For
// every fixture it creates the tables on the engine from the exported script,
// asks the engine's own tool for the schema (pg_dump, mysqldump, mariadb-dump,
// DBMS_METADATA.GET_DDL, sqlite_master), imports that dump and compares it
// with the import of the exported script: tables, columns (type, size, keys,
// nullability, identity, uniqueness, comments), indexes and foreign keys.
//
// Engines are reached as for run.js; the dump tools need their own variables:
//
//   SQL_PSQL + SQL_PG_DUMP          pg_dump -h localhost -U postgres -s drawdb_test
//   SQL_MYSQL + SQL_MYSQLDUMP       mysqldump -h 127.0.0.1 -uroot -psecret --no-data drawdb_test
//   SQL_MARIADB + SQL_MARIADB_DUMP  mariadb-dump -h 127.0.0.1 -uroot -psecret --no-data drawdb_test
//   SQL_SQLPLUS                     (GET_DDL runs through sqlplus)
//
// SQL Server has no command-line tool that scripts a schema, so it is left
// out here (roundtrip.test.js covers SQL Server Management Studio scripts).
//
//   node --import ./scripts/test-loader.mjs scripts/sql-engines/dumps.js [filter]

/* global process */
import NodeSQLParser from "node-sql-parser";
import OracleSQLParser from "oracle-sql-parser";
import { DB } from "../../src/data/constants.js";
import { generateSQL } from "../../src/utils/exportSQL/index.js";
import { importScript } from "../../src/utils/importSQL/script.js";
import { engines, shell } from "./engines.js";
import { diagrams } from "./fixtures.js";
import { shop } from "./migration-fixtures.js";

const env = process.env;
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;

const ORACLE_DDL = `SET LONG 1000000 LONGCHUNKSIZE 1000000 PAGESIZE 0 LINESIZE 32767 TRIMSPOOL ON FEEDBACK OFF HEADING OFF ECHO OFF VERIFY OFF
BEGIN
  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SQLTERMINATOR', TRUE);
END;
/
SELECT DBMS_METADATA.GET_DDL('TABLE', table_name) FROM user_tables ORDER BY table_name;
SELECT DBMS_METADATA.GET_DDL('INDEX', index_name) FROM user_indexes i
  WHERE NOT EXISTS (SELECT 1 FROM user_constraints c WHERE c.index_name = i.index_name)
  AND index_type <> 'LOB' ORDER BY index_name;
SELECT DBMS_METADATA.GET_DEPENDENT_DDL('COMMENT', table_name) FROM user_tables t
  WHERE EXISTS (SELECT 1 FROM user_tab_comments c WHERE c.table_name = t.table_name AND c.comments IS NOT NULL)
  OR EXISTS (SELECT 1 FROM user_col_comments c WHERE c.table_name = t.table_name AND c.comments IS NOT NULL);
EXIT
`;

const dumpers = {
  [DB.SQLITE]: () =>
    engines[DB.SQLITE].db
      .prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL")
      .all()
      .map((row) => `${row.sql};`)
      .join("\n"),
  [DB.POSTGRES]:
    env.SQL_PSQL && env.SQL_PG_DUMP && (() => shell(env.SQL_PG_DUMP)),
  [DB.MYSQL]:
    env.SQL_MYSQL && env.SQL_MYSQLDUMP && (() => shell(env.SQL_MYSQLDUMP)),
  [DB.MARIADB]:
    env.SQL_MARIADB &&
    env.SQL_MARIADB_DUMP &&
    (() => shell(env.SQL_MARIADB_DUMP)),
  [DB.ORACLESQL]: env.SQL_SQLPLUS && (() => shell(env.SQL_SQLPLUS, ORACLE_DDL)),
};

const parsers = {
  Parser: NodeSQLParser.Parser,
  OracleParser: OracleSQLParser.Parser,
};

// What a schema says, in comparable lines.
function describe(diagram, database) {
  const lower = (name) => String(name ?? "").toLowerCase();
  // MySQL, MariaDB and Oracle treat RESTRICT as NO ACTION (and Oracle has no
  // ON UPDATE at all).
  const action = (value) =>
    value === "Restrict" &&
    [DB.MYSQL, DB.MARIADB, DB.ORACLESQL].includes(database)
      ? "No action"
      : value;
  const lines = [];
  const byId = new Map(diagram.tables.map((t) => [t.id, t]));
  for (const table of diagram.tables) {
    const name = lower(table.name);
    // SQLite keeps no comment outside CREATE TABLE.
    if (database !== DB.SQLITE) {
      lines.push(
        `table ${name} comment=${JSON.stringify(table.comment ?? "")}`,
      );
    }
    // A unique constraint and a unique index are the same thing to the
    // engines that dump them (MySQL writes both as UNIQUE KEY).
    const uniques = new Set();
    for (const field of table.fields) {
      if (field.unique) uniques.add(lower(field.name));
    }
    for (const key of [
      ...(table.uniqueConstraints ?? []),
      ...(table.indices ?? []).filter((index) => index.unique),
    ]) {
      uniques.add(key.fields.map(lower).join(", "));
    }
    for (const columns of uniques) lines.push(`unique ${name} (${columns})`);
    for (const field of table.fields) {
      lines.push(
        `column ${name}.${lower(field.name)} ${field.type}(${field.size ?? ""})${
          field.isArray ? "[]" : ""
        } pk=${Boolean(field.primary)} nn=${Boolean(
          field.notNull || field.primary,
        )} ai=${Boolean(field.increment)} comment=${JSON.stringify(
          field.comment ?? "",
        )}`,
      );
    }
    for (const index of table.indices ?? []) {
      if (index.unique) continue;
      lines.push(`index ${name} (${index.fields.map(lower).join(", ")})`);
    }
  }
  for (const r of diagram.relationships ?? []) {
    const start = byId.get(r.startTableId);
    const end = byId.get(r.endTableId);
    const pairs = r.fields?.length
      ? r.fields
      : [{ startFieldId: r.startFieldId, endFieldId: r.endFieldId }];
    const column = (table, id) =>
      lower(table.fields.find((f) => f.id === id)?.name);
    lines.push(
      `fk ${lower(start.name)}(${pairs.map((p) => column(start, p.startFieldId))}) -> ${lower(
        end.name,
      )}(${pairs.map((p) => column(end, p.endFieldId))}) delete=${action(
        r.deleteConstraint,
      )} update=${database === DB.ORACLESQL ? "-" : action(r.updateConstraint)}`,
    );
  }
  return lines.sort();
}

const cases = [["shop", shop], ...Object.entries(diagrams)];
let checked = 0;
let failed = 0;
for (const database of Object.keys(dumpers)) {
  if (!dumpers[database]) {
    console.log(`- ${database}: not configured, skipped`);
    continue;
  }
  for (const [name, build] of cases) {
    if (filter && !filter.test(`${database} ${name}`)) continue;
    const { sql } = generateSQL(build(database), {
      options: { includeHeader: false },
    });
    engines[database].reset();
    const created = engines[database].run(sql);
    if (!created.ok) {
      failed++;
      console.log(`✗ ${database} ${name}: the engine rejected the script`);
      console.log(created.out.slice(0, 1000));
      continue;
    }
    const dumped = dumpers[database]();
    const dump = typeof dumped === "string" ? dumped : dumped.out;
    checked++;
    let expected;
    let actual;
    try {
      expected = describe(
        importScript(sql, { database, ...parsers }),
        database,
      );
      actual = describe(importScript(dump, { database, ...parsers }), database);
    } catch (error) {
      failed++;
      console.log(`✗ ${database} ${name}: ${error.message}`);
      continue;
    }
    const missing = expected.filter((line) => !actual.includes(line));
    const extra = actual.filter((line) => !expected.includes(line));
    if (missing.length || extra.length) {
      failed++;
      console.log(`✗ ${database} ${name}`);
      for (const line of missing) console.log(`    - ${line}`);
      for (const line of extra) console.log(`    + ${line}`);
    } else {
      console.log(`✓ ${database} ${name}`);
    }
  }
}
console.log(`\n${checked} dumps imported, ${failed} with differences`);
process.exitCode = failed ? 1 : 0;
