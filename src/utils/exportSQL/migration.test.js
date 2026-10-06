import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { DB } from "../../data/constants.js";
import {
  migrationScenarios,
  scenarioRows,
} from "../../../scripts/sql-engines/migration-fixtures.js";
import { generateMigration, generateSQL } from "./index.js";
import { quoteIdentifier, stringLiteral } from "./names.js";

// The full check against every engine is scripts/sql-engines/migrate.js; here
// SQLite runs in memory and the other engines are checked statement by statement.

function sqliteCatalog(db) {
  const out = [];
  for (const { name, sql } of db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL",
    )
    .all()) {
    const text = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join(" ")
      .replace(/"/g, "")
      .replace(/\s+/g, " ");
    out.push(`${name}|${text}`);
    for (const f of db.prepare(`PRAGMA foreign_key_list("${name}")`).all()) {
      out.push(`fk|${name}|${f.from}|${f.table}|${f.to}`);
    }
  }
  return out.sort();
}

function insertRows(rows) {
  const quote = (name) => quoteIdentifier(name, DB.SQLITE, "always");
  return rows
    .map(
      ([table, row]) =>
        `INSERT INTO ${quote(table)} (${Object.keys(row).map(quote).join(", ")}) VALUES (${Object.values(
          row,
        )
          .map((v) =>
            typeof v === "number" ? String(v) : stringLiteral(v, DB.SQLITE),
          )
          .join(", ")});`,
    )
    .join("\n");
}

test("every SQLite migration turns the first version into the second, rows included", () => {
  for (const [name, before, after] of migrationScenarios(DB.SQLITE)) {
    const migrated = new Database(":memory:");
    migrated.exec(generateSQL(before).sql);
    migrated.exec(insertRows(scenarioRows(name)));
    const { sql } = generateMigration(before, after);
    try {
      migrated.exec(sql);
    } catch (error) {
      assert.fail(`${name}: ${error.message}\n${sql}`);
    }
    const fresh = new Database(":memory:");
    fresh.exec(generateSQL(after).sql);
    assert.deepEqual(sqliteCatalog(migrated), sqliteCatalog(fresh), name);
    // The rows are still there.
    const count = migrated
      .prepare(
        `SELECT COUNT(*) AS n FROM "${after.tables.find((t) => t.id === "t_c").name}"`,
      )
      .get().n;
    assert.equal(count, 2, name);
  }
});

const scenario = (dialect, name) =>
  migrationScenarios(dialect).find(([n]) => n === name);
const migrate = (dialect, name, options) => {
  const [, before, after] = scenario(dialect, name);
  return generateMigration(before, after, { options });
};
const codes = (issues) => issues.map((issue) => issue.code);

test("no changes give an empty script and say so", () => {
  for (const dialect of [DB.POSTGRES, DB.MYSQL, DB.SQLITE, DB.MSSQL]) {
    const result = migrate(dialect, "no_changes");
    assert.equal(result.statements, 0);
    assert.ok(codes(result.issues).includes("migration_no_changes"));
    assert.match(result.sql, /No schema changes/);
  }
});

test("drops are flagged, and written as comments when drops are off", () => {
  const result = migrate(DB.POSTGRES, "drop_columns");
  assert.ok(codes(result.issues).includes("migration_drop_column"));
  assert.match(result.sql, /^ALTER TABLE "customers" DROP COLUMN "name";$/m);

  const safe = migrate(DB.POSTGRES, "drop_tables", { destructive: false });
  assert.match(safe.sql, /^-- DROP TABLE "order_items";$/m);
  assert.doesNotMatch(safe.sql, /^DROP TABLE/m);
  // Foreign keys still go: they hold no data.
  assert.match(safe.sql, /^ALTER TABLE "order_items" DROP CONSTRAINT/m);
});

test("renames keep the data: columns, tables, keys and swapped names", () => {
  const pg = migrate(DB.POSTGRES, "rename_table").sql;
  assert.match(pg, /ALTER TABLE "products" RENAME TO "items";/);
  assert.match(pg, /RENAME CONSTRAINT "pk_products" TO "pk_items";/);
  assert.doesNotMatch(pg, /DROP TABLE/);

  const swap = migrate(DB.MYSQL, "swap_names").sql;
  assert.match(swap, /RENAME COLUMN `email` TO `email_drawdb_tmp`/);
  assert.match(swap, /RENAME COLUMN `name` TO `email`/);
  assert.match(swap, /RENAME COLUMN `email_drawdb_tmp` TO `name`/);

  const mssql = migrate(DB.MSSQL, "rename_columns").sql;
  assert.match(
    mssql,
    /EXEC sp_rename N'\[customers\]\.\[name\]', N'full_name', N'COLUMN';/,
  );
});

test("MySQL moves AUTO_INCREMENT and implicit indexes out of the way", () => {
  const added = migrate(DB.MYSQL, "identity_add").sql;
  // The foreign key on the column goes first, then comes back.
  assert.ok(
    added.indexOf("DROP FOREIGN KEY `fk_order_items_product_id`") <
      added.indexOf("AUTO_INCREMENT"),
  );
  assert.match(added, /ADD CONSTRAINT `fk_order_items_product_id`/);

  const fks = migrate(DB.MYSQL, "foreign_keys").sql;
  assert.match(fks, /DROP INDEX `fk_order_items_product_id`/);
});

test("PostgreSQL enums gain values in place and are replaced when values go", () => {
  const added = migrate(DB.POSTGRES, "enum_add_values").sql;
  assert.match(added, /ALTER TYPE "mood" ADD VALUE 'happy';/);
  assert.match(added, /ALTER TYPE "orders_kind_enum" ADD VALUE 'c';/);

  const removed = migrate(DB.POSTGRES, "enum_remove_values");
  assert.ok(codes(removed.issues).includes("migration_enum_values_removed"));
  assert.match(removed.sql, /RENAME TO "mood_drawdb_old"/);
  assert.match(removed.sql, /USING "mood"::text::"mood"/);
  assert.match(removed.sql, /DROP TYPE "mood_drawdb_old";/);

  const renamed = migrate(DB.POSTGRES, "enum_rename_column").sql;
  assert.match(
    renamed,
    /ALTER TYPE "orders_kind_enum" RENAME TO "orders_category_enum";/,
  );
});

test("what an engine cannot do in place is reported", () => {
  for (const dialect of [DB.MSSQL, DB.ORACLESQL]) {
    const result = migrate(dialect, "identity_add");
    assert.ok(
      result.issues.some(
        (issue) =>
          issue.level === "error" && issue.code === "migration_identity_manual",
      ),
      dialect,
    );
  }
  // Oracle narrows a type only on an empty column.
  const [, before, after] = scenario(DB.ORACLESQL, "retype");
  after.tables
    .find((t) => t.id === "t_i")
    .fields.find((f) => f.id === "i_qty").size = "9";
  after.tables
    .find((t) => t.id === "t_i")
    .fields.find((f) => f.id === "i_qty").type = "NUMBER";
  const narrowed = generateMigration(before, after);
  assert.ok(
    narrowed.issues.some(
      (issue) =>
        issue.level === "warning" &&
        issue.code === "migration_oracle_type_change",
    ),
  );
  // A NOT NULL column without a default fails on a table with rows.
  const [, b2, a2] = scenario(DB.POSTGRES, "no_changes");
  a2.tables[0].fields.push({
    id: "x",
    name: "required",
    type: "INTEGER",
    notNull: true,
    default: "",
  });
  assert.ok(
    codes(generateMigration(b2, a2).issues).includes(
      "migration_not_null_no_default",
    ),
  );
});

test("SQLite rebuilds a table it cannot alter, and only that table", () => {
  const result = migrate(DB.SQLITE, "retype");
  assert.match(result.sql, /CREATE TABLE "_drawdb_new_customers"/);
  assert.match(result.sql, /INSERT INTO "_drawdb_new_customers"/);
  assert.doesNotMatch(result.sql, /_drawdb_new_orders"/);
  assert.match(result.sql, /^PRAGMA foreign_keys = OFF;/m);
  const index = migrate(DB.SQLITE, "index_rename").sql;
  assert.doesNotMatch(index, /_drawdb_new_/);
  assert.match(index, /DROP INDEX "idx_orders_status";/);
});
