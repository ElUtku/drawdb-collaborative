// Checks the migration generator on real engines. For every scenario of
// migration-fixtures.js it creates the first version, fills it with rows, runs
// the migration, and compares the engine's catalog (columns, keys, indexes,
// foreign keys, checks, comments) with a database created directly from the
// second version. Any difference, or any statement the engine rejects that
// the export dialog did not flag as an error, is a failure.
//
// Engines are configured as for run.js (SQLite always runs):
//   node --import ./scripts/test-loader.mjs scripts/sql-engines/migrate.js [filter]

/* global process */
import { DB } from "../../src/data/constants.js";
import {
  generateMigration,
  generateSQL,
} from "../../src/utils/exportSQL/index.js";
import {
  quoteIdentifier,
  stringLiteral,
} from "../../src/utils/exportSQL/names.js";
import { engines, shell } from "./engines.js";
import { migrationScenarios, scenarioRows } from "./migration-fixtures.js";

const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const env = process.env;

// --- Catalog snapshots ------------------------------------------------------------

const lines = (text) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();

const snapshots = {
  [DB.SQLITE](engine) {
    const db = engine.db;
    const out = [];
    const tables = db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    for (const { name, sql } of tables) {
      // The table as written, without comments (they do not change the table).
      out.push(
        `table|${name}|${sql
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join(" ")
          // SQLite quotes a name it rewrites (a rename); quoting is not part
          // of the table.
          .replace(/"/g, "")
          .replace(/\s+/g, " ")}`,
      );
      for (const c of db.prepare(`PRAGMA table_info("${name}")`).all()) {
        out.push(
          `col|${name}|${c.name}|${c.type}|${c.notnull}|${c.dflt_value}|${c.pk}`,
        );
      }
      for (const i of db.prepare(`PRAGMA index_list("${name}")`).all()) {
        const columns = db
          .prepare(`PRAGMA index_info("${i.name}")`)
          .all()
          .map((c) => c.name)
          .join(",");
        const label = i.name.startsWith("sqlite_autoindex") ? "auto" : i.name;
        out.push(`idx|${name}|${label}|${i.unique}|${i.origin}|${columns}`);
      }
      for (const f of db.prepare(`PRAGMA foreign_key_list("${name}")`).all()) {
        out.push(
          `fk|${name}|${f.from}|${f.table}|${f.to}|${f.on_update}|${f.on_delete}`,
        );
      }
    }
    for (const { name, sql } of db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL",
      )
      .all()) {
      out.push(`index|${name}|${sql}`);
    }
    return out.sort();
  },

  [DB.POSTGRES](_engine, schema) {
    const ns = stringLiteral(schema || "public", DB.POSTGRES);
    const r = shell(
      `${env.SQL_PSQL} -q -X -A -t -v ON_ERROR_STOP=1 -f -`,
      `
SELECT 'col|' || table_name || '|' || column_name || '|' || data_type || '|' || udt_name || '|' ||
       coalesce(character_maximum_length::text, '') || '|' || coalesce(numeric_precision::text, '') || ',' ||
       coalesce(numeric_scale::text, '') || '|' || is_nullable || '|' ||
       regexp_replace(coalesce(column_default, ''), 'nextval\\(''[^'']*''', 'nextval(') || '|' || is_identity
  FROM information_schema.columns WHERE table_schema = ${ns}
UNION ALL
SELECT 'con|' || cl.relname || '|' || co.conname || '|' || pg_get_constraintdef(co.oid)
  FROM pg_constraint co JOIN pg_class cl ON cl.oid = co.conrelid
 WHERE co.connamespace = ${ns}::regnamespace
UNION ALL
SELECT 'idx|' || tablename || '|' || indexname || '|' || indexdef FROM pg_indexes WHERE schemaname = ${ns}
UNION ALL
SELECT 'enum|' || t.typname || '|' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
  FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
 WHERE t.typnamespace = ${ns}::regnamespace GROUP BY t.typname
UNION ALL
SELECT 'comment|' || c.relname || '|' || coalesce(a.attname, '') || '|' || d.description
  FROM pg_description d JOIN pg_class c ON c.oid = d.objoid
  LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid AND d.objsubid > 0
 WHERE c.relnamespace = ${ns}::regnamespace AND d.classoid = 'pg_class'::regclass;
`,
    );
    return lines(r.out);
  },

  [DB.MYSQL]: (engine, schema) =>
    mysqlSnapshot(env.SQL_MYSQL, schema || "drawdb_test"),
  [DB.MARIADB]: (engine, schema) =>
    mysqlSnapshot(env.SQL_MARIADB, schema || "drawdb_test"),

  [DB.MSSQL](_engine, schema) {
    const s = stringLiteral(schema || "dbo", DB.MSSQL);
    const r = shell(
      `${env.SQL_SQLCMD} -b -d drawdb_test -h -1 -W`,
      `SET NOCOUNT ON;
SELECT x FROM (
SELECT 'col|' + t.name + '|' + c.name + '|' + ty.name + '|' + CAST(c.max_length AS varchar) + '|' +
       CAST(c.precision AS varchar) + ',' + CAST(c.scale AS varchar) + '|' + CAST(c.is_nullable AS varchar) + '|' +
       CAST(c.is_identity AS varchar) + '|' + ISNULL(dc.name + ':' + dc.definition, '') AS x
  FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id
  JOIN sys.types ty ON ty.user_type_id = c.user_type_id
  LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = t.object_id AND dc.parent_column_id = c.column_id
 WHERE SCHEMA_NAME(t.schema_id) = ${s}
UNION ALL
SELECT 'idx|' + t.name + '|' + i.name + '|' + CAST(i.is_unique AS varchar) + '|' + CAST(i.is_primary_key AS varchar) + '|' +
       CAST(i.is_unique_constraint AS varchar) + '|' +
       (SELECT STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal)
          FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
         WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id)
  FROM sys.indexes i JOIN sys.tables t ON t.object_id = i.object_id
 WHERE i.type > 0 AND SCHEMA_NAME(t.schema_id) = ${s}
UNION ALL
SELECT 'fk|' + OBJECT_NAME(f.parent_object_id) + '|' + f.name + '|' + OBJECT_NAME(f.referenced_object_id) + '|' +
       f.delete_referential_action_desc + '|' + f.update_referential_action_desc + '|' +
       (SELECT STRING_AGG(COL_NAME(fc.parent_object_id, fc.parent_column_id) + '>' + COL_NAME(fc.referenced_object_id, fc.referenced_column_id), ',')
          FROM sys.foreign_key_columns fc WHERE fc.constraint_object_id = f.object_id)
  FROM sys.foreign_keys f WHERE SCHEMA_NAME(f.schema_id) = ${s}
UNION ALL
SELECT 'chk|' + OBJECT_NAME(parent_object_id) + '|' + name + '|' + definition
  FROM sys.check_constraints WHERE SCHEMA_NAME(schema_id) = ${s}
UNION ALL
SELECT 'cmt|' + OBJECT_NAME(major_id) COLLATE DATABASE_DEFAULT + '|' +
       ISNULL(COL_NAME(major_id, minor_id), '') COLLATE DATABASE_DEFAULT + '|' +
       CAST(value AS nvarchar(4000)) COLLATE DATABASE_DEFAULT
  FROM sys.extended_properties WHERE class = 1 AND name = 'MS_Description' AND OBJECT_SCHEMA_NAME(major_id) = ${s}
) q ORDER BY x COLLATE DATABASE_DEFAULT;`,
    );
    return lines(r.out);
  },

  [DB.ORACLESQL]() {
    const r = shell(
      env.SQL_SQLPLUS,
      `SET PAGESIZE 0 FEEDBACK OFF HEADING OFF LINESIZE 32767 TRIMSPOOL ON TRIMOUT ON LONG 100000
SELECT 'col|' || table_name || '|' || column_name || '|' || data_type || '|' || data_length || '|' ||
       data_precision || ',' || data_scale || '|' || nullable || '|' || identity_column || '|' ||
       -- Oracle has no DROP DEFAULT: DEFAULT NULL is how a default goes away.
       REGEXP_REPLACE(REGEXP_REPLACE(TRIM(data_default_vc), 'ISEQ\\$\\$_[0-9]+', 'ISEQ'), '^NULL$', '')
  FROM user_tab_columns WHERE table_name NOT LIKE 'BIN$%';
SELECT 'con|' || table_name || '|' || constraint_name || '|' || constraint_type || '|' || search_condition_vc || '|' ||
       delete_rule || '|' || r_constraint_name
  FROM user_constraints WHERE constraint_name NOT LIKE 'SYS_%' AND constraint_name NOT LIKE 'BIN$%';
SELECT 'idx|' || i.table_name || '|' || i.index_name || '|' || i.uniqueness || '|' ||
       LISTAGG(c.column_name, ',') WITHIN GROUP (ORDER BY c.column_position)
  FROM user_indexes i JOIN user_ind_columns c ON c.index_name = i.index_name
 WHERE i.index_name NOT LIKE 'SYS_%' AND i.index_name NOT LIKE 'BIN$%'
 GROUP BY i.table_name, i.index_name, i.uniqueness;
SELECT 'tcmt|' || table_name || '|' || comments FROM user_tab_comments
 WHERE comments IS NOT NULL AND table_name NOT LIKE 'BIN$%';
SELECT 'ccmt|' || table_name || '|' || column_name || '|' || comments FROM user_col_comments
 WHERE comments IS NOT NULL AND table_name NOT LIKE 'BIN$%';
EXIT
`,
    );
    return lines(r.out);
  },
};

function mysqlSnapshot(command, schema) {
  const s = stringLiteral(schema, DB.MYSQL);
  const r = shell(
    `${command} -N -B`,
    `
SELECT CONCAT_WS('|', 'col', TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, IFNULL(COLUMN_DEFAULT, '<null>'), EXTRA, COLUMN_COMMENT)
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${s};
SELECT CONCAT_WS('|', 'idx', TABLE_NAME, INDEX_NAME, NON_UNIQUE,
       GROUP_CONCAT(CONCAT(COLUMN_NAME, IFNULL(CONCAT('(', SUB_PART, ')'), '')) ORDER BY SEQ_IN_INDEX))
  FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ${s} GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE;
SELECT CONCAT_WS('|', 'fk', k.TABLE_NAME, k.CONSTRAINT_NAME, GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION),
       k.REFERENCED_TABLE_NAME, GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION), r.UPDATE_RULE, r.DELETE_RULE)
  FROM information_schema.KEY_COLUMN_USAGE k
  JOIN information_schema.REFERENTIAL_CONSTRAINTS r
    ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
 WHERE k.TABLE_SCHEMA = ${s}
 GROUP BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.REFERENCED_TABLE_NAME, r.UPDATE_RULE, r.DELETE_RULE;
SELECT CONCAT_WS('|', 'chk', CONSTRAINT_NAME, CHECK_CLAUSE)
  FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ${s};
SELECT CONCAT_WS('|', 'tbl', TABLE_NAME, TABLE_COMMENT)
  FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${s};
`,
  );
  return lines(r.out);
}

// A catalog with nothing in it, or an error, means the query itself failed.
function snapshot(dialect, engine, schema) {
  const result = snapshots[dialect](engine, schema);
  const broken = result.some((line) =>
    /^(Msg \d+|ERROR|ORA-|SP2-|Sqlcmd:)/.test(line),
  );
  if (broken) console.log(result.join("\n"));
  return result.length && !broken ? result : null;
}

// --- Rows ----------------------------------------------------------------------------

function inserts(dialect, rows, { schema, identifierQuoting = "always" }) {
  const quote = (name) => quoteIdentifier(name, dialect, identifierQuoting);
  const table = (name) =>
    schema && dialect !== DB.SQLITE
      ? `${quote(schema)}.${quote(name)}`
      : quote(name);
  const value = (v) =>
    typeof v === "number" ? String(v) : stringLiteral(v, dialect);
  return rows
    .map(
      ([name, row]) =>
        `INSERT INTO ${table(name)} (${Object.keys(row).map(quote).join(", ")}) VALUES (${Object.values(row).map(value).join(", ")});`,
    )
    .join("\n");
}

// --- Settings combinations -------------------------------------------------------------

function optionSets(dialect) {
  const sets = [
    {},
    { identifierQuoting: "when_needed", includeComments: false },
  ];
  if (dialect === DB.POSTGRES)
    sets.push({ schema: "app", wrapInTransaction: false });
  if (dialect === DB.MSSQL)
    sets.push({ schema: "app", mssqlBatchSeparator: false });
  if (dialect === DB.SQLITE) sets.push({ wrapInTransaction: false });
  return sets;
}

const createSchema = {
  [DB.POSTGRES]: (schema) => `CREATE SCHEMA ${schema};`,
  [DB.MSSQL]: (schema) => `EXEC('CREATE SCHEMA ${schema}');`,
};

// --- Run -------------------------------------------------------------------------------

let runs = 0;
let failures = 0;
let flagged = 0;
for (const [dialect, engine] of Object.entries(engines)) {
  if (!engine) {
    console.log(`- ${dialect}: skipped (no client configured)`);
    continue;
  }
  let engineFailures = 0;
  for (const options of optionSets(dialect)) {
    for (const [name, before, after] of migrationScenarios(dialect)) {
      if (filter && !filter.test(`${dialect} ${name}`)) continue;
      const label = `${dialect} · ${name} · ${JSON.stringify(options)}`;
      const createOptions = { ...options, existing: "create" };
      const first = generateSQL(before, { dialect, options: createOptions });
      const second = generateSQL(after, { dialect, options: createOptions });
      const migration = generateMigration(before, after, { dialect, options });
      if (migration.issues.some((issue) => issue.level === "error")) {
        // Flagged in the dialog as needing work by hand: nothing to run.
        flagged++;
        continue;
      }
      runs++;
      const prepare = () => {
        engine.reset();
        if (options.schema && createSchema[dialect]) {
          engine.run(createSchema[dialect](options.schema));
        }
      };
      const fail = (what, detail) => {
        failures++;
        engineFailures++;
        console.log(`\n✗ ${label}: ${what}`);
        if (detail) console.log(detail);
        if (env.SHOW_SQL) console.log(migration.sql);
      };

      prepare();
      let result = engine.run(first.sql);
      if (!result.ok) {
        fail("first version rejected", result.out.slice(0, 600));
        continue;
      }
      result = engine.run(inserts(dialect, scenarioRows(name), options));
      if (!result.ok) {
        fail("rows rejected", result.out.slice(0, 600));
        continue;
      }
      result = engine.run(migration.sql);
      if (!result.ok) {
        fail(
          "migration rejected",
          result.out.split("\n").filter(Boolean).slice(0, 10).join("\n"),
        );
        continue;
      }
      const migrated = snapshot(dialect, engine, options.schema);
      if (!migrated) {
        fail("catalog query failed");
        continue;
      }

      prepare();
      result = engine.run(second.sql);
      if (!result.ok) {
        fail("second version rejected", result.out.slice(0, 600));
        continue;
      }
      const fresh = snapshot(dialect, engine, options.schema);
      if (!fresh) {
        fail("catalog query failed");
        continue;
      }
      const missing = fresh.filter((line) => !migrated.includes(line));
      const extra = migrated.filter((line) => !fresh.includes(line));
      if (missing.length || extra.length) {
        fail(
          "catalog differs from a fresh database",
          [
            ...missing.map((line) => `  expected: ${line}`),
            ...extra.map((line) => `  got:      ${line}`),
          ].join("\n"),
        );
      }
    }
  }
  console.log(`- ${dialect}: ${engineFailures} failures`);
}
console.log(
  `\n${runs} migrations checked, ${flagged} flagged as manual, ${failures} failures`,
);
process.exitCode = failures ? 1 : 0;
