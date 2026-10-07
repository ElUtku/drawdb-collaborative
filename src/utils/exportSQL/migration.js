// Generates the ALTER script that takes a database from one version of a
// diagram to another. Both versions are built into checked models with the
// same settings (so names and types are decided exactly as the CREATE script
// decided them), matched by id, falling back to names, and compared. The
// statements are ordered so that nothing is dropped while something still
// depends on it and nothing is added before what it depends on exists:
//
//   foreign keys, checks and keys that change are dropped -> tables are dropped
//   -> tables and columns renamed -> columns dropped, changed and added ->
//   new tables created -> keys, checks and foreign keys added -> comments.
//
// SQLite cannot alter most of a table in place, so a changed table is rebuilt
// the way its documentation describes (new table, copy, drop, rename).

import { DB } from "../../data/constants";
import { buildModel, DIALECT_NAMES } from "./model";
import {
  fitIdentifier,
  lineComment,
  maxIdentifierBytes,
  stringLiteral,
} from "./names";
import { normalizeMigrationOptions, normalizeSqlOptions } from "./options";
import {
  INDENT,
  checkClause,
  columnDefinition,
  foreignKeyClause,
  identityClause,
  keyColumns,
  plainColumns,
  renderModel,
  truncateComment,
} from "./render";

const MYSQL_FAMILY = new Set([DB.MYSQL, DB.MARIADB]);
const CASE_INSENSITIVE_NAMES = new Set([
  DB.MYSQL,
  DB.MARIADB,
  DB.SQLITE,
  DB.MSSQL,
]);
const PG_SERIAL_BASE = {
  SMALLSERIAL: "SMALLINT",
  SERIAL: "INTEGER",
  BIGSERIAL: "BIGINT",
};

/**
 * Pairs the items of two lists: same id first, then same name. Returns the
 * pairs [old, new] and what is only in one list.
 */
function match(oldList, newList, nameKey) {
  const pairs = [];
  const used = new Set();
  const byId = new Map();
  for (const item of oldList) {
    if (item.id !== undefined && item.id !== null && !byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }
  const rest = [];
  for (const item of newList) {
    const old =
      item.id !== undefined && item.id !== null ? byId.get(item.id) : null;
    if (old && !used.has(old)) {
      pairs.push([old, item]);
      used.add(old);
    } else {
      rest.push(item);
    }
  }
  const added = [];
  for (const item of rest) {
    const old = oldList.find(
      (o) => !used.has(o) && nameKey(o.name) === nameKey(item.name),
    );
    if (old) {
      pairs.push([old, item]);
      used.add(old);
    } else {
      added.push(item);
    }
  }
  return { pairs, added, removed: oldList.filter((o) => !used.has(o)) };
}

/**
 * Orders renames so that no rename takes a name still in use; a cycle (two
 * columns swapping names) goes through a temporary name.
 */
function orderRenames(renames, taken, nameKey) {
  const pending = renames.map((r) => ({ ...r }));
  const current = new Set(taken.map(nameKey));
  const ordered = [];
  while (pending.length) {
    const index = pending.findIndex(
      (r) => nameKey(r.to) === nameKey(r.from) || !current.has(nameKey(r.to)),
    );
    if (index >= 0) {
      const [rename] = pending.splice(index, 1);
      ordered.push(rename);
      current.delete(nameKey(rename.from));
      current.add(nameKey(rename.to));
      continue;
    }
    const rename = pending[0];
    let temporary = `${rename.from}_drawdb_tmp`;
    while (current.has(nameKey(temporary))) temporary += "_";
    ordered.push({ ...rename, to: temporary, temporary: true });
    current.delete(nameKey(rename.from));
    current.add(nameKey(temporary));
    rename.from = temporary;
  }
  return ordered;
}

const sameList = (a, b) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * The ALTER script from `before` to `after` for `dialect` (by default the
 * diagram's own database). `from` and `to` label the versions in the header.
 */
export function generateMigration(
  before,
  after,
  { dialect, options, from = "", to = "" } = {},
) {
  const target = dialect ?? after?.database;
  if (!target || target === DB.GENERIC) {
    return { sql: "", issues: [], statements: 0 };
  }
  const settings = normalizeMigrationOptions(target, options);
  // Keys and constraints are dropped by name, so every one of them has one.
  const modelOptions = {
    ...normalizeSqlOptions(target, settings),
    nameConstraints: true,
    existing: "create",
    foreignKeys: "auto",
    tableOrder: "dependencies",
    createSchema: false,
    sqliteForeignKeysPragma: false,
  };
  const oldModel = buildModel(before ?? {}, target, modelOptions);
  const newModel = buildModel(after ?? {}, target, modelOptions);

  const issues = [...newModel.issues];
  const dialectName = DIALECT_NAMES[target];
  const report = (level, code, params = {}) =>
    issues.push({ level, code, params: { dialect: dialectName, ...params } });

  const context = {
    dialect: target,
    settings,
    oldModel,
    newModel,
    report,
  };
  const body =
    target === DB.SQLITE ? migrateSQLite(context) : migrateInPlace(context);

  const statements = body.length;
  if (!statements) report("info", "migration_no_changes");

  const out = [];
  if (settings.includeHeader) {
    out.push(
      [
        lineComment(`Migration generated by drawDB for ${dialectName}`),
        from ? lineComment(`From: ${from}`) : null,
        to ? lineComment(`To:   ${to}`) : null,
        lineComment(
          "Run it on a database created from the first version with the same export settings. Back the database up first.",
        ),
        MYSQL_FAMILY.has(target) || target === DB.ORACLESQL
          ? lineComment(
              `${dialectName} commits every schema change at once: if a statement fails, the ones before it stay applied.`,
            )
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (!statements) {
    out.push(lineComment("No schema changes."));
    return { sql: `${out.join("\n\n")}\n`, issues, statements };
  }

  const wrap = settings.wrapInTransaction;
  if (target === DB.MSSQL) {
    const go = settings.mssqlBatchSeparator;
    const batches = [...body];
    if (wrap) {
      batches.unshift("SET XACT_ABORT ON;\nBEGIN TRANSACTION;");
      batches.push("COMMIT TRANSACTION;");
    }
    out.push(...batches.map((text) => (go ? `${text}\nGO` : text)));
  } else if (target === DB.SQLITE) {
    // PRAGMA foreign_keys does nothing inside a transaction.
    out.push("PRAGMA foreign_keys = OFF;");
    if (wrap) out.push("BEGIN TRANSACTION;");
    out.push(...body);
    if (wrap) out.push("COMMIT;");
    out.push("PRAGMA foreign_keys = ON;");
  } else if (target === DB.POSTGRES && wrap) {
    out.push("BEGIN;", ...body, "COMMIT;");
  } else {
    out.push(...body);
  }
  return { sql: `${out.join("\n\n")}\n`, issues, statements };
}

// --- Shared comparison --------------------------------------------------------------

function compare({ dialect, oldModel, newModel, settings }) {
  const nameKey = CASE_INSENSITIVE_NAMES.has(dialect)
    ? (name) => String(name).toLowerCase()
    : (name) => String(name);

  const tables = match(oldModel.tables, newModel.tables, nameKey);
  const newTableOf = new Map(tables.pairs.map(([o, n]) => [o, n]));
  const newColumnOf = new Map();
  const tableDiffs = tables.pairs.map(([oldTable, newTable]) => {
    const columns = match(oldTable.columns, newTable.columns, nameKey);
    for (const [o, n] of columns.pairs) newColumnOf.set(o, n);
    return { oldTable, newTable, columns };
  });

  // Enum types (PostgreSQL), so a renamed type does not read as a new type.
  // Declared enums match by name, the ones made for ENUM/SET columns by column.
  const enumKeys = (model, columnIds) => {
    const owners = new Map();
    for (const table of model.tables) {
      for (const column of table.columns) {
        if (!owners.has(column.base)) {
          owners.set(column.base, columnIds(table, column));
        }
      }
    }
    return (entry) =>
      entry.generated
        ? `column:${owners.get(entry.name) ?? entry.name}`
        : `enum:${entry.name}`;
  };
  const oldEnumKey = enumKeys(oldModel, (table, column) => {
    const newTable = newTableOf.get(table);
    const newColumn = newColumnOf.get(column);
    return newTable && newColumn ? `${newTable.id}:${newColumn.id}` : null;
  });
  const newEnumKey = enumKeys(
    newModel,
    (table, column) => `${table.id}:${column.id}`,
  );
  const oldEnums = new Map(oldModel.enums.map((e) => [oldEnumKey(e), e]));
  const enumPairs = [];
  const addedEnums = [];
  const matchedEnums = new Set();
  for (const entry of newModel.enums) {
    const old = oldEnums.get(newEnumKey(entry));
    if (old && !matchedEnums.has(old)) {
      enumPairs.push([old, entry]);
      matchedEnums.add(old);
    } else {
      addedEnums.push(entry);
    }
  }
  const removedEnums = oldModel.enums.filter((e) => !matchedEnums.has(e));
  const enumRename = new Map(
    enumPairs
      .filter(([o, n]) => o.name !== n.name)
      .map(([o, n]) => [oldModel.qualify(o.name), newModel.qualify(n.name)]),
  );

  // How a column's type reads once enum renames are applied.
  const typeOf = (column) => {
    let sql = column.sql;
    for (const [from, to] of enumRename) {
      if (sql === from) sql = to;
      else if (sql === `${from}[]`) sql = `${to}[]`;
    }
    return `${sql}${column.unsigned ? " UNSIGNED" : ""}`;
  };
  const defaultOf = (column) =>
    column.identity && dialect === DB.ORACLESQL ? null : column.defaultSql;
  const commentsOn = settings.includeComments;

  for (const diff of tableDiffs) {
    diff.renamed = diff.oldTable.name !== diff.newTable.name;
    diff.changes = diff.columns.pairs.map(([o, n]) => {
      const typeChanged = typeOf(o) !== typeOf(n);
      return {
        old: o,
        now: n,
        renamed: o.name !== n.name,
        typeChanged,
        nullChanged: o.notNull !== n.notNull,
        defaultChanged: defaultOf(o) !== defaultOf(n),
        identityChanged:
          o.identity !== n.identity || Boolean(o.serial) !== Boolean(n.serial),
        commentChanged: commentsOn && o.comment !== n.comment,
        checksChanged: !sameList(
          o.checks.map((c) => `${c.name}\u0000${c.expr}`),
          n.checks.map((c) => `${c.name}\u0000${c.expr}`),
        ),
      };
    });
    diff.changed = diff.changes.filter(
      (c) =>
        c.typeChanged ||
        c.nullChanged ||
        c.defaultChanged ||
        c.identityChanged ||
        c.commentChanged,
    );
    diff.retyped = new Set(
      diff.changes.filter((c) => c.typeChanged).map((c) => c.now),
    );
    diff.commentChanged =
      commentsOn && diff.oldTable.comment !== diff.newTable.comment;
  }
  const diffOf = new Map(tableDiffs.map((d) => [d.newTable, d]));

  // Old columns as they are called in the new model (null when dropped).
  const mapColumns = (columns) => {
    const mapped = columns.map((c) => newColumnOf.get(c.column ?? c));
    return mapped.every(Boolean) ? mapped : null;
  };
  const keySignature = (columns, extra = "") =>
    `${columns.map((c) => c.column?.id ?? c.id).join("\u0000")}|${columns
      .map((c) => c.prefix ?? "")
      .join(",")}|${extra}`;
  const touchesRetyped = (diff, columns) =>
    columns.some((c) => diff.retyped.has(c.column ?? c));

  // Primary keys, unique constraints and indexes of the tables in both versions.
  const keyDiffs = [];
  for (const diff of tableDiffs) {
    const { oldTable, newTable } = diff;
    // SQL Server cannot change the type of a column a key or index covers.
    const rebuildRetyped = dialect === DB.MSSQL;
    const compareKeys = (oldKeys, newKeys, kind, extra = () => "") => {
      const result = { drop: [], add: [], rename: [] };
      const unmatched = [...newKeys];
      for (const oldKey of oldKeys) {
        const mapped = mapColumns(oldKey.columns.map((c) => c.column));
        const signature = mapped
          ? keySignature(
              mapped.map((column, i) => ({
                column,
                prefix: oldKey.columns[i].prefix,
              })),
              extra(oldKey),
            )
          : null;
        const index = signature
          ? unmatched.findIndex(
              (k) => keySignature(k.columns, extra(k)) === signature,
            )
          : -1;
        const forced =
          index >= 0 &&
          rebuildRetyped &&
          touchesRetyped(diff, unmatched[index].columns);
        if (index < 0 || forced) {
          result.drop.push(oldKey);
          continue;
        }
        const [newKey] = unmatched.splice(index, 1);
        if (oldKey.name !== newKey.name) {
          result.rename.push({ kind, from: oldKey, to: newKey });
        }
      }
      result.add.push(...unmatched);
      return result;
    };
    keyDiffs.push({
      diff,
      primary: compareKeys(
        oldTable.primaryKey ? [oldTable.primaryKey] : [],
        newTable.primaryKey ? [newTable.primaryKey] : [],
        "primary",
      ),
      uniques: compareKeys(oldTable.uniques, newTable.uniques, "unique"),
      indexes: compareKeys(oldTable.indexes, newTable.indexes, "index", (k) =>
        k.unique ? "unique" : "",
      ),
    });
  }
  const keyDiffOf = new Map(keyDiffs.map((k) => [k.diff.newTable, k]));

  // MySQL: AUTO_INCREMENT must always lead a key, so it comes off a column
  // whose key is dropped (or that stops being an identity) and goes back on
  // once the new keys are in place. Changing it is refused while a foreign key
  // uses the column, so those foreign keys are dropped and added again.
  const identityTouched = new Set();
  for (const k of keyDiffs) {
    const { diff } = k;
    diff.stripIdentity = null;
    if (!MYSQL_FAMILY.has(dialect)) continue;
    const oldIdentity = diff.oldTable.columns.find((c) => c.identity);
    for (const change of diff.changes) {
      if (change.identityChanged) identityTouched.add(change.now);
    }
    if (!oldIdentity) continue;
    const dropped = [...k.primary.drop, ...k.uniques.drop, ...k.indexes.drop];
    const change = diff.changes.find((c) => c.old === oldIdentity);
    if (
      dropped.some((key) => key.columns[0]?.column === oldIdentity) ||
      (change && !change.now.identity)
    ) {
      diff.stripIdentity = oldIdentity;
      if (change) identityTouched.add(change.now);
    }
  }

  // Foreign keys.
  const rebuiltParents = new Set();
  for (const k of keyDiffs) {
    for (const key of [...k.primary.drop, ...k.uniques.drop]) {
      const mapped = mapColumns(key.columns.map((c) => c.column));
      if (mapped) {
        rebuiltParents.add(
          `${k.diff.newTable.id}|${mapped
            .map((c) => c.id)
            .sort()
            .join(",")}`,
        );
      }
    }
  }
  const fkSignature = (fk) =>
    [
      fk.child.id,
      fk.columns.map((c) => c.id).join(","),
      fk.parent.id,
      fk.refColumns.map((c) => c.id).join(","),
      fk.onDelete ?? "",
      fk.onUpdate ?? "",
    ].join("|");
  const fkDrop = [];
  const fkRename = [];
  const unmatchedFks = [...newModel.foreignKeys];
  for (const fk of oldModel.foreignKeys) {
    const child = newTableOf.get(fk.child);
    const parent = newTableOf.get(fk.parent);
    const columns = mapColumns(fk.columns);
    const refColumns = mapColumns(fk.refColumns);
    if (!child || !parent || !columns || !refColumns) {
      fkDrop.push(fk);
      continue;
    }
    const signature = fkSignature({
      ...fk,
      child,
      parent,
      columns,
      refColumns,
    });
    const index = unmatchedFks.findIndex((f) => fkSignature(f) === signature);
    const childDiff = diffOf.get(child);
    const parentDiff = diffOf.get(parent);
    const childKeys = keyDiffOf.get(child);
    const forced =
      index < 0 ||
      columns.some((c) => childDiff.retyped.has(c)) ||
      refColumns.some((c) => parentDiff.retyped.has(c)) ||
      columns.some((c) => identityTouched.has(c)) ||
      refColumns.some((c) => identityTouched.has(c)) ||
      rebuiltParents.has(
        `${parent.id}|${refColumns
          .map((c) => c.id)
          .sort()
          .join(",")}`,
      ) ||
      // MySQL will not drop an index a foreign key still relies on.
      (MYSQL_FAMILY.has(dialect) &&
        childKeys.primary.drop.length +
          childKeys.uniques.drop.length +
          childKeys.indexes.drop.length >
          0);
    if (forced) {
      fkDrop.push(fk);
      continue;
    }
    const [newFk] = unmatchedFks.splice(index, 1);
    if (fk.name !== newFk.name) {
      fkRename.push({ kind: "foreign", from: fk, to: newFk });
    }
  }

  return {
    nameKey,
    tables,
    tableDiffs,
    keyDiffs,
    fkDrop,
    fkAdd: unmatchedFks,
    fkRename,
    enumPairs,
    addedEnums,
    removedEnums,
    typeOf,
    defaultOf,
  };
}

// --- Engines that alter tables in place ------------------------------------------------

function migrateInPlace(context) {
  const { dialect, settings, oldModel, newModel, report } = context;
  const quote = newModel.quote;
  const literal = (value) => stringLiteral(value, dialect);
  const mysql = MYSQL_FAMILY.has(dialect);
  const pg = dialect === DB.POSTGRES;
  const mssql = dialect === DB.MSSQL;
  const oracle = dialect === DB.ORACLESQL;
  const diff = compare(context);
  const { nameKey, tableDiffs } = diff;
  const enumNames = new Set(
    [...oldModel.enums, ...newModel.enums].map((e) => e.name),
  );

  const phase = {
    extensions: [],
    dropForeignKeys: [],
    dropChecks: [],
    stripIdentity: [],
    dropKeys: [],
    dropTables: [],
    renameTables: [],
    dropColumns: [],
    renameColumns: [],
    types: [],
    alterColumns: [],
    addColumns: [],
    createTables: [],
    renameKeys: [],
    addKeys: [],
    addChecks: [],
    restoreIdentity: [],
    addForeignKeys: [],
    comments: [],
    dropTypes: [],
  };
  const destructive = (statement) =>
    settings.destructive
      ? statement
      : statement
          .split("\n")
          .map((line) => `-- ${line}`)
          .join("\n");

  // --- Statement templates ---------------------------------------------------------
  const alter = (table, clause) => `ALTER TABLE ${table.sql} ${clause};`;
  const dropConstraint = (table, name) =>
    alter(table, `DROP CONSTRAINT ${quote(name)}`);
  const qualifiedName = (name) => newModel.qualify(name);
  const mssqlRename = (object, name, kind) =>
    `EXEC sp_rename ${literal(object)}, ${literal(name)}${kind ? `, N'${kind}'` : ""};`;

  const dropForeignKey = (fk) =>
    mysql
      ? alter(fk.child, `DROP FOREIGN KEY ${quote(fk.name)}`)
      : dropConstraint(fk.child, fk.name);
  const dropCheck = (table, check) =>
    dialect === DB.MYSQL
      ? alter(table, `DROP CHECK ${quote(check.name)}`)
      : dropConstraint(table, check.name);
  const dropKey = (table, key, kind) => {
    if (kind === "primary") {
      return mysql
        ? alter(table, "DROP PRIMARY KEY")
        : dropConstraint(table, key.name);
    }
    if (kind === "unique") {
      return mysql
        ? alter(table, `DROP INDEX ${quote(key.name)}`)
        : dropConstraint(table, key.name);
    }
    if (mysql) return alter(table, `DROP INDEX ${quote(key.name)}`);
    if (mssql) return `DROP INDEX ${quote(key.name)} ON ${table.sql};`;
    return `DROP INDEX ${qualifiedName(key.name)};`;
  };
  const addKey = (table, key, kind) => {
    if (kind === "index") {
      const columns = mysql
        ? keyColumns(newModel, key.columns)
        : plainColumns(
            newModel,
            key.columns.map((c) => c.column),
          );
      const name =
        pg || mysql || mssql ? quote(key.name) : qualifiedName(key.name);
      return `CREATE ${key.unique ? "UNIQUE " : ""}INDEX ${name} ON ${table.sql} (${columns});`;
    }
    const columns = mysql
      ? keyColumns(newModel, key.columns)
      : plainColumns(
          newModel,
          key.columns.map((c) => c.column),
        );
    return alter(
      table,
      `ADD CONSTRAINT ${quote(key.name)} ${kind === "primary" ? "PRIMARY KEY" : "UNIQUE"} (${columns})`,
    );
  };
  // null: the engine cannot rename it, so it is dropped and added again.
  const renameKey = (table, from, to, kind) => {
    if (mysql) {
      if (kind === "primary") return ""; // MySQL always calls it PRIMARY.
      if (kind === "unique" || kind === "index") {
        return alter(table, `RENAME INDEX ${quote(from)} TO ${quote(to)}`);
      }
      return null;
    }
    if (mssql) {
      if (kind === "index") {
        return mssqlRename(`${table.sql}.${quote(from)}`, to, "INDEX");
      }
      const object = newModel.schema
        ? `${quote(newModel.schema)}.${quote(from)}`
        : quote(from);
      return mssqlRename(object, to, "OBJECT");
    }
    if (kind === "index") {
      return `ALTER INDEX ${qualifiedName(from)} RENAME TO ${quote(to)};`;
    }
    const statement = alter(
      table,
      `RENAME CONSTRAINT ${quote(from)} TO ${quote(to)}`,
    );
    // Oracle keeps the old name on the index behind a key.
    if (oracle && (kind === "primary" || kind === "unique")) {
      return `${statement}\n\nALTER INDEX ${qualifiedName(from)} RENAME TO ${quote(to)};`;
    }
    return statement;
  };

  const column = (table, c, flags) =>
    columnDefinition(newModel, table, c, flags);

  // --- Comments ------------------------------------------------------------------------
  const mssqlComment = (table, c, text) => {
    const schema = newModel.schema
      ? stringLiteral(newModel.schema, DB.MSSQL)
      : "@schema";
    const target = `@level0type = N'SCHEMA', @level0name = ${schema}, @level1type = N'TABLE', @level1name = ${stringLiteral(table.name, DB.MSSQL)}${
      c
        ? `, @level2type = N'COLUMN', @level2name = ${stringLiteral(c.name, DB.MSSQL)}`
        : ""
    }`;
    const objectId = `OBJECT_ID(${stringLiteral(table.sql, DB.MSSQL)})`;
    const minor = c
      ? `COLUMNPROPERTY(${objectId}, ${stringLiteral(c.name, DB.MSSQL)}, 'ColumnId')`
      : "0";
    const exists = `EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id = ${objectId} AND minor_id = ${minor} AND name = N'MS_Description')`;
    const declare = newModel.schema
      ? ""
      : "DECLARE @schema sysname = SCHEMA_NAME();\n";
    if (!text.trim()) {
      return `${declare}IF ${exists}\n${INDENT}EXEC sys.sp_dropextendedproperty @name = N'MS_Description', ${target};`;
    }
    const value = literal(text);
    return `${declare}IF ${exists}\n${INDENT}EXEC sys.sp_updateextendedproperty @name = N'MS_Description', @value = ${value}, ${target};\nELSE\n${INDENT}EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = ${value}, ${target};`;
  };
  const commentOn = (table, c, text) => {
    if (mysql) return null; // Part of the column or table definition.
    if (mssql) return mssqlComment(table, c, text);
    const target = c
      ? `COLUMN ${table.sql}.${quote(c.name)}`
      : `TABLE ${table.sql}`;
    if (pg) {
      return `COMMENT ON ${target} IS ${text.trim() ? literal(text) : "NULL"};`;
    }
    const clipped = truncateComment(
      newModel,
      text,
      4000,
      c ? `${table.name}.${c.name}` : table.name,
    );
    return `COMMENT ON ${target} IS ${literal(clipped)};`;
  };

  // --- Extensions and types (PostgreSQL) ----------------------------------------------
  if (pg && settings.pgCreateExtensions) {
    for (const extension of newModel.extensions) {
      if (!oldModel.extensions.includes(extension)) {
        phase.extensions.push(
          `CREATE EXTENSION IF NOT EXISTS ${quote(extension)};`,
        );
      }
    }
  }

  // --- Tables only in one version --------------------------------------------------------
  for (const table of diff.tables.removed) {
    report("warning", "migration_drop_table", { table: table.name });
    const statement = oracle
      ? `DROP TABLE ${table.sql} CASCADE CONSTRAINTS;`
      : `DROP TABLE ${table.sql};`;
    phase.dropTables.push(destructive(statement));
  }
  // MySQL gives a foreign key an index of its own (named after it) when no
  // other index starts with its columns; it stays when the key is dropped.
  const implicitIndex = (fk) => {
    const table = fk.child;
    const lists = [
      table.primaryKey?.columns,
      ...table.uniques.map((u) => u.columns),
      ...table.indexes.map((i) => i.columns),
    ]
      .filter(Boolean)
      .map((columns) => columns.map((c) => c.column));
    return !lists.some((columns) =>
      fk.columns.every((c, i) => columns[i] === c),
    );
  };
  const droppedTables = new Set(diff.tables.removed);
  const dropForeignKeyAndIndex = (fk) => {
    phase.dropForeignKeys.push(dropForeignKey(fk));
    if (mysql && !droppedTables.has(fk.child) && implicitIndex(fk)) {
      phase.dropForeignKeys.push(
        alter(fk.child, `DROP INDEX ${quote(fk.name)}`),
      );
    }
  };
  for (const fk of diff.fkDrop) dropForeignKeyAndIndex(fk);

  // --- Tables in both versions ----------------------------------------------------------
  const tableRenames = orderRenames(
    tableDiffs
      .filter((d) => d.renamed)
      .map((d) => ({ from: d.oldTable.name, to: d.newTable.name, diff: d })),
    tableDiffs.map((d) => d.oldTable.name),
    nameKey,
  );
  for (const rename of tableRenames) {
    const fromSql = qualifiedName(rename.from);
    if (mysql) {
      phase.renameTables.push(
        `RENAME TABLE ${fromSql} TO ${qualifiedName(rename.to)};`,
      );
    } else if (mssql) {
      phase.renameTables.push(mssqlRename(fromSql, rename.to));
    } else {
      phase.renameTables.push(
        `ALTER TABLE ${fromSql} RENAME TO ${quote(rename.to)};`,
      );
    }
  }

  const keyDiffOf = new Map(diff.keyDiffs.map((k) => [k.diff, k]));
  for (const tableDiff of tableDiffs) {
    const { oldTable, newTable, columns, changes } = tableDiff;
    const keys = keyDiffOf.get(tableDiff);

    // Keys and indexes.
    for (const [kind, list] of [
      ["primary", keys.primary],
      ["unique", keys.uniques],
      ["index", keys.indexes],
    ]) {
      for (const key of list.drop) {
        phase.dropKeys.push(dropKey(oldTable, key, kind));
      }
      const renames = [];
      for (const rename of list.rename) {
        const statement = renameKey(
          newTable,
          rename.from.name,
          rename.to.name,
          kind,
        );
        if (statement === null) {
          phase.dropKeys.push(dropKey(oldTable, rename.from, kind));
          phase.addKeys.push(addKey(newTable, rename.to, kind));
        } else if (statement) {
          renames.push(statement);
        }
      }
      phase.renameKeys.push(...renames);
      for (const key of list.add) {
        phase.addKeys.push(addKey(newTable, key, kind));
      }
    }

    // MySQL: AUTO_INCREMENT must always lead a key, so it comes off while keys
    // change and goes back on once they are in place.
    const stripped = new Set();
    if (tableDiff.stripIdentity) {
      const oldIdentity = tableDiff.stripIdentity;
      phase.stripIdentity.push(
        alter(
          oldTable,
          `MODIFY COLUMN ${columnDefinition(oldModel, oldTable, oldIdentity, { identity: false })}`,
        ),
      );
      const change = changes.find((c) => c.old === oldIdentity);
      if (change?.now.identity) stripped.add(change.now);
    }

    // Checks: dropped when they change or their column is dropped, renamed or
    // changes type, and added back afterwards.
    for (const c of columns.removed) {
      for (const check of c.checks) {
        phase.dropChecks.push(dropCheck(oldTable, check));
      }
    }
    for (const change of changes) {
      const recheck =
        change.checksChanged || change.typeChanged || change.renamed;
      if (!recheck) continue;
      for (const check of change.old.checks) {
        phase.dropChecks.push(dropCheck(oldTable, check));
      }
      for (const check of change.now.checks) {
        phase.addChecks.push(
          alter(newTable, `ADD ${checkClause(newModel, check)}`),
        );
      }
    }

    // SQL Server: defaults are constraints; they go when their column is dropped
    // or changed, and come back with the new definition.
    if (mssql) {
      for (const c of columns.removed) {
        if (c.defaultSql !== null && c.defaultName) {
          phase.dropKeys.push(dropConstraint(oldTable, c.defaultName));
        }
      }
    }

    // Dropped columns.
    for (const c of columns.removed) {
      report("warning", "migration_drop_column", {
        table: oldTable.name,
        column: c.name,
      });
      phase.dropColumns.push(
        destructive(alter(newTable, `DROP COLUMN ${quote(c.name)}`)),
      );
    }

    // Renamed columns.
    const renames = orderRenames(
      changes
        .filter((c) => c.renamed)
        .map((c) => ({ from: c.old.name, to: c.now.name })),
      changes.map((c) => c.old.name),
      nameKey,
    );
    for (const rename of renames) {
      phase.renameColumns.push(
        mssql
          ? mssqlRename(
              `${newTable.sql}.${quote(rename.from)}`,
              rename.to,
              "COLUMN",
            )
          : alter(
              newTable,
              `RENAME COLUMN ${quote(rename.from)} TO ${quote(rename.to)}`,
            ),
      );
    }

    // Changed columns.
    for (const change of changes) {
      alterColumn(tableDiff, change, stripped);
    }

    // Added columns.
    for (const c of columns.added) {
      const ctx = { table: newTable.name, column: c.name };
      if (c.notNull && c.defaultSql === null && !c.identity) {
        report("warning", "migration_not_null_no_default", ctx);
      }
      if (mysql && c.identity) {
        phase.addColumns.push(
          alter(
            newTable,
            `ADD COLUMN ${column(newTable, c, { identity: false })}`,
          ),
        );
        phase.restoreIdentity.push(
          alter(newTable, `MODIFY COLUMN ${column(newTable, c)}`),
        );
      } else if (oracle) {
        phase.addColumns.push(alter(newTable, `ADD (${column(newTable, c)})`));
      } else {
        phase.addColumns.push(
          alter(
            newTable,
            `${mssql ? "ADD" : "ADD COLUMN"} ${column(newTable, c)}`,
          ),
        );
      }
      for (const check of c.checks) {
        phase.addChecks.push(
          alter(newTable, `ADD ${checkClause(newModel, check)}`),
        );
      }
      if (settings.includeComments && c.comment.trim()) {
        const statement = commentOn(newTable, c, c.comment);
        if (statement) phase.comments.push(statement);
      }
    }

    if (tableDiff.commentChanged) {
      if (mysql) {
        const text = truncateComment(
          newModel,
          newTable.comment,
          2048,
          newTable.name,
        );
        phase.comments.push(alter(newTable, `COMMENT = ${literal(text)}`));
      } else {
        phase.comments.push(commentOn(newTable, null, newTable.comment));
      }
    }
    if (
      pg &&
      !sameList(oldTable.inherits.map(String), newTable.inherits.map(String))
    ) {
      report("warning", "migration_inherits_manual", { table: newTable.name });
    }
  }

  // --- Column changes ---------------------------------------------------------------------
  function alterColumn(tableDiff, change, stripped) {
    const { newTable } = tableDiff;
    const { old: o, now: n } = change;
    const ctx = { table: newTable.name, column: n.name };
    const name = quote(n.name);
    const alterColumnClause = (clause) =>
      alter(newTable, `ALTER COLUMN ${name} ${clause}`);

    if (change.typeChanged) {
      report("info", "migration_type_change", {
        ...ctx,
        from: diff.typeOf(o),
        to: diff.typeOf(n),
      });
    }
    if (change.nullChanged && n.notNull) {
      report("info", "migration_set_not_null", ctx);
    }

    if (mysql) {
      const gainsIdentity = n.identity && (!o.identity || stripped.has(n));
      const other =
        change.typeChanged ||
        change.nullChanged ||
        change.defaultChanged ||
        change.commentChanged ||
        (change.identityChanged && !n.identity);
      if (gainsIdentity) {
        phase.restoreIdentity.push(
          alter(newTable, `MODIFY COLUMN ${column(newTable, n)}`),
        );
        if (other) {
          phase.alterColumns.push(
            alter(
              newTable,
              `MODIFY COLUMN ${column(newTable, n, { identity: false })}`,
            ),
          );
        }
      } else if (other) {
        phase.alterColumns.push(
          alter(newTable, `MODIFY COLUMN ${column(newTable, n)}`),
        );
      }
      return;
    }

    if (pg) {
      const oldDefault = o.defaultSql;
      let defaultDropped = false;
      if (change.typeChanged) {
        if (oldDefault !== null) {
          phase.alterColumns.push(alterColumnClause("DROP DEFAULT"));
          defaultDropped = true;
        }
        const sql = n.serial ? PG_SERIAL_BASE[n.base.toUpperCase()] : n.sql;
        const isEnum = (c) => enumNames.has(c.base);
        const via =
          isEnum(o) || isEnum(n)
            ? sql.endsWith("[]")
              ? "::text[]"
              : "::text"
            : "";
        phase.alterColumns.push(
          alterColumnClause(`TYPE ${sql} USING ${name}${via}::${sql}`),
        );
      }
      if (o.serial && !n.serial) {
        phase.alterColumns.push(alterColumnClause("DROP DEFAULT"));
        defaultDropped = true;
        phase.alterColumns.push(
          `DO $drawdb$\nDECLARE\n${INDENT}seq text := pg_get_serial_sequence(${literal(newTable.sql)}, ${literal(n.name)});\nBEGIN\n${INDENT}IF seq IS NOT NULL THEN\n${INDENT}${INDENT}EXECUTE 'DROP SEQUENCE ' || seq;\n${INDENT}END IF;\nEND $drawdb$;`,
        );
      }
      const oldIdentity = o.identity && !o.serial;
      const newIdentity = n.identity && !n.serial;
      if (oldIdentity && !newIdentity) {
        phase.alterColumns.push(alterColumnClause("DROP IDENTITY IF EXISTS"));
      }
      if (change.nullChanged) {
        phase.alterColumns.push(
          alterColumnClause(n.notNull ? "SET NOT NULL" : "DROP NOT NULL"),
        );
      }
      const restartFrom = `SELECT setval(pg_get_serial_sequence(${literal(newTable.sql)}, ${literal(n.name)}), COALESCE((SELECT MAX(${name}) FROM ${newTable.sql}), 0) + 1, false);`;
      if (n.serial && !o.serial) {
        const sequence = newModel.qualify(
          fitIdentifier(
            `${newTable.name}_${n.name}_seq`,
            maxIdentifierBytes(dialect),
          ),
        );
        if (oldDefault !== null && !defaultDropped) {
          phase.alterColumns.push(alterColumnClause("DROP DEFAULT"));
          defaultDropped = true;
        }
        phase.alterColumns.push(
          `CREATE SEQUENCE ${sequence} OWNED BY ${newTable.sql}.${name};`,
          alterColumnClause(`SET DEFAULT nextval(${literal(sequence)})`),
          restartFrom,
        );
      }
      if (newIdentity && !oldIdentity) {
        if (oldDefault !== null && !defaultDropped) {
          phase.alterColumns.push(alterColumnClause("DROP DEFAULT"));
          defaultDropped = true;
        }
        phase.alterColumns.push(
          alterColumnClause(`ADD ${identityClause(newModel)}`),
          restartFrom,
        );
      }
      if (!n.serial && !newIdentity) {
        if (
          n.defaultSql !== null &&
          (change.defaultChanged || defaultDropped)
        ) {
          phase.alterColumns.push(
            alterColumnClause(`SET DEFAULT ${n.defaultSql}`),
          );
        } else if (
          n.defaultSql === null &&
          oldDefault !== null &&
          !defaultDropped &&
          change.defaultChanged
        ) {
          phase.alterColumns.push(alterColumnClause("DROP DEFAULT"));
        }
      }
      if (change.commentChanged) {
        phase.comments.push(commentOn(newTable, n, n.comment));
      }
      return;
    }

    if (mssql) {
      if (change.identityChanged) {
        report("error", "migration_identity_manual", ctx);
      }
      const redefine = change.typeChanged || change.nullChanged;
      if (
        (redefine || change.defaultChanged) &&
        o.defaultSql !== null &&
        o.defaultName
      ) {
        phase.dropKeys.push(dropConstraint(tableDiff.oldTable, o.defaultName));
      }
      if (redefine) {
        phase.alterColumns.push(
          alterColumnClause(`${n.sql} ${n.notNull ? "NOT NULL" : "NULL"}`),
        );
      }
      if ((redefine || change.defaultChanged) && n.defaultSql !== null) {
        const named = n.defaultName
          ? `CONSTRAINT ${quote(n.defaultName)} `
          : "";
        phase.addKeys.push(
          alter(newTable, `ADD ${named}DEFAULT ${n.defaultSql} FOR ${name}`),
        );
      } else if (
        n.defaultSql !== null &&
        o.defaultName &&
        n.defaultName &&
        o.defaultName !== n.defaultName
      ) {
        const schema = newModel.schema ? `${quote(newModel.schema)}.` : "";
        phase.renameKeys.push(
          mssqlRename(
            `${schema}${quote(o.defaultName)}`,
            n.defaultName,
            "OBJECT",
          ),
        );
      }
      if (change.commentChanged) {
        phase.comments.push(commentOn(newTable, n, n.comment));
      }
      return;
    }

    // Oracle
    const modify = (clause) => alter(newTable, `MODIFY (${name} ${clause})`);
    if (change.typeChanged) {
      // Oracle changes the type of a column with rows only to widen it.
      if (!oracleWidens(o, n)) {
        report("warning", "migration_oracle_type_change", ctx);
      }
      phase.alterColumns.push(modify(n.sql));
    }
    if (o.identity && !n.identity) {
      phase.alterColumns.push(modify("DROP IDENTITY"));
    } else if (!o.identity && n.identity) {
      report("error", "migration_identity_manual", ctx);
    }
    if (!n.identity && diff.defaultOf(o) !== diff.defaultOf(n)) {
      phase.alterColumns.push(modify(`DEFAULT ${n.defaultSql ?? "NULL"}`));
    }
    if (change.nullChanged) {
      phase.alterColumns.push(modify(n.notNull ? "NOT NULL" : "NULL"));
    }
    if (change.commentChanged) {
      phase.comments.push(commentOn(newTable, n, n.comment));
    }
  }

  // --- Foreign keys -----------------------------------------------------------------------
  for (const rename of diff.fkRename) {
    const statement = renameKey(
      rename.to.child,
      rename.from.name,
      rename.to.name,
      "foreign",
    );
    if (statement === null) {
      dropForeignKeyAndIndex(rename.from);
      phase.addForeignKeys.push(
        alter(rename.to.child, `ADD ${foreignKeyClause(newModel, rename.to)}`),
      );
    } else {
      phase.renameKeys.push(statement);
    }
  }
  for (const fk of diff.fkAdd) {
    phase.addForeignKeys.push(
      alter(fk.child, `ADD ${foreignKeyClause(newModel, fk)}`),
    );
  }

  // --- New tables ---------------------------------------------------------------------------
  const added = new Set(diff.tables.added);
  if (added.size) {
    const tables = newModel.tables
      .filter((t) => added.has(t))
      .map((t) => ({ ...t, foreignKeys: [] }));
    const script = renderModel({
      ...newModel,
      tables,
      foreignKeys: [],
      enums: [],
      compositeTypes: [],
      extensions: [],
      issues: [],
      options: {
        ...newModel.options,
        includeHeader: false,
        existing: "create",
        wrapInTransaction: false,
        createSchema: false,
        pgCreateExtensions: false,
        mssqlBatchSeparator: false,
      },
    });
    if (mssql) {
      // Each CREATE is a batch of its own, as in the full script.
      phase.createTables.push(...splitMssqlBatches(script));
    } else if (script.trim()) {
      phase.createTables.push(script);
    }
  }

  // --- Types (PostgreSQL) -------------------------------------------------------------------
  if (pg) migratePostgresTypes(context, diff, phase);

  return Object.values(phase).flat().filter(Boolean);
}

// Whether Oracle can change `before` into `after` with rows in the table: the
// same kind of type that only gets longer or holds more digits.
function oracleWidens(before, after) {
  const parse = (column) => {
    const base = column.base.toUpperCase();
    const [first, second] = String(column.size ?? "")
      .split(",")
      .map((part) => part.trim());
    if (base === "INTEGER" || base === "INT" || base === "SMALLINT") {
      return { family: "number", precision: 38, scale: 0 };
    }
    if (base === "NUMBER" || base === "DECIMAL" || base === "NUMERIC") {
      return {
        family: "number",
        precision: first ? Number(first) : Infinity,
        scale: second ? Number(second) : first ? 0 : Infinity,
      };
    }
    return { family: base, length: first ? Number(first) : Infinity };
  };
  const a = parse(before);
  const b = parse(after);
  if (a.family !== b.family) return false;
  if (a.family === "number") {
    return b.scale >= a.scale && b.precision - b.scale >= a.precision - a.scale;
  }
  return (
    ["VARCHAR2", "NVARCHAR2", "CHAR", "NCHAR", "RAW", "VARCHAR"].includes(
      a.family,
    ) && b.length >= a.length
  );
}

// The SQL Server renderer separates batches with blank lines when GO is off;
// statements of one table (CREATE, comments, indexes) stay together.
function splitMssqlBatches(script) {
  return script
    .split(/\n\n(?=CREATE |IF |DECLARE |EXEC )/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function migratePostgresTypes(context, diff, phase) {
  const { oldModel, newModel, report, settings } = context;
  const { quote, literal } = newModel;
  const qualify = newModel.qualify;

  for (const [oldEnum, newEnum] of diff.enumPairs) {
    if (oldEnum.name !== newEnum.name) {
      phase.types.push(
        `ALTER TYPE ${oldModel.qualify(oldEnum.name)} RENAME TO ${quote(newEnum.name)};`,
      );
    }
    const before = oldEnum.values;
    const after = newEnum.values;
    if (sameList(before, after)) continue;
    // Values only added, the old ones in the same order: ADD VALUE works.
    const kept = after.filter((v) => before.includes(v));
    if (sameList(kept, before)) {
      after.forEach((value, i) => {
        if (before.includes(value)) return;
        const next = after.slice(i + 1).find((v) => before.includes(v));
        phase.types.push(
          `ALTER TYPE ${qualify(newEnum.name)} ADD VALUE ${literal(value)}${next !== undefined ? ` BEFORE ${literal(next)}` : ""};`,
        );
      });
      continue;
    }
    // Values removed or reordered: a new type replaces the old one.
    const removed = before.filter((v) => !after.includes(v));
    if (removed.length) {
      report("warning", "migration_enum_values_removed", {
        name: newEnum.name,
        values: removed.join(", "),
      });
    }
    const retired = `${newEnum.name}_drawdb_old`;
    phase.types.push(
      `ALTER TYPE ${qualify(newEnum.name)} RENAME TO ${quote(retired)};`,
      `CREATE TYPE ${qualify(newEnum.name)} AS ENUM (${after.map(literal).join(", ")});`,
    );
    const target = qualify(newEnum.name);
    for (const tableDiff of diff.tableDiffs) {
      for (const change of tableDiff.changes) {
        const { old: o, now: n } = change;
        if (o.base !== oldEnum.name || n.base !== newEnum.name) continue;
        if (change.typeChanged) continue; // Converted with the other columns.
        const array = n.sql.endsWith("[]");
        const table = tableDiff.newTable.sql;
        const column = quote(o.name);
        if (o.defaultSql !== null) {
          phase.types.push(
            `ALTER TABLE ${table} ALTER COLUMN ${column} DROP DEFAULT;`,
          );
        }
        phase.types.push(
          `ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${n.sql} USING ${column}::text${array ? "[]" : ""}::${target}${array ? "[]" : ""};`,
        );
        if (o.defaultSql !== null) {
          phase.types.push(
            `ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${o.defaultSql};`,
          );
        }
      }
    }
    phase.types.push(`DROP TYPE ${qualify(retired)};`);
  }
  for (const entry of diff.addedEnums) {
    phase.types.push(
      `CREATE TYPE ${qualify(entry.name)} AS ENUM (${entry.values.map(literal).join(", ")});`,
    );
  }
  for (const entry of diff.removedEnums) {
    phase.dropTypes.push(`DROP TYPE ${oldModel.qualify(entry.name)};`);
  }

  // Composite types: matched by name; attributes added, dropped or retyped.
  const oldTypes = new Map(oldModel.compositeTypes.map((t) => [t.name, t]));
  const newNames = new Set(newModel.compositeTypes.map((t) => t.name));
  for (const type of newModel.compositeTypes) {
    const old = oldTypes.get(type.name);
    if (!old) {
      const fields = type.fields
        .map((field) => `${INDENT}${quote(field.name)} ${field.sql}`)
        .join(",\n");
      phase.types.push(`CREATE TYPE ${qualify(type.name)} AS (\n${fields}\n);`);
      if (settings.includeComments && type.comment.trim()) {
        phase.comments.push(
          `COMMENT ON TYPE ${qualify(type.name)} IS ${literal(type.comment)};`,
        );
      }
      continue;
    }
    const actions = [];
    for (const field of old.fields) {
      if (!type.fields.some((f) => f.name === field.name)) {
        actions.push(`DROP ATTRIBUTE ${quote(field.name)}`);
      }
    }
    for (const field of type.fields) {
      const before = old.fields.find((f) => f.name === field.name);
      if (!before)
        actions.push(`ADD ATTRIBUTE ${quote(field.name)} ${field.sql}`);
      else if (before.sql !== field.sql) {
        actions.push(`ALTER ATTRIBUTE ${quote(field.name)} TYPE ${field.sql}`);
      }
    }
    if (actions.length) {
      phase.types.push(
        `ALTER TYPE ${qualify(type.name)}\n${INDENT}${actions.join(`,\n${INDENT}`)};`,
      );
    }
    if (settings.includeComments && old.comment !== type.comment) {
      phase.comments.push(
        `COMMENT ON TYPE ${qualify(type.name)} IS ${type.comment.trim() ? literal(type.comment) : "NULL"};`,
      );
    }
  }
  for (const type of oldModel.compositeTypes) {
    if (!newNames.has(type.name)) {
      phase.dropTypes.push(`DROP TYPE ${oldModel.qualify(type.name)};`);
    }
  }
}

// --- SQLite: rebuild what changes ----------------------------------------------------------

function migrateSQLite(context) {
  const { settings, newModel, report } = context;
  const quote = newModel.quote;
  const diff = compare(context);
  const statements = [];
  const keyDiffOf = new Map(diff.keyDiffs.map((k) => [k.diff, k]));
  const childOf = (table) => (fk) => fk.child === table;

  const renderTables = (tables, options = {}) =>
    renderModel({
      ...newModel,
      tables,
      foreignKeys: [],
      enums: [],
      compositeTypes: [],
      extensions: [],
      issues: [],
      options: {
        ...newModel.options,
        includeHeader: false,
        existing: "create",
        wrapInTransaction: false,
        sqliteForeignKeysPragma: false,
        ...options,
      },
    });

  for (const table of diff.tables.removed) {
    report("warning", "migration_drop_table", { table: table.name });
    const statement = `DROP TABLE ${table.sql};`;
    statements.push(settings.destructive ? statement : `-- ${statement}`);
  }

  const renames = orderRenames(
    diff.tableDiffs
      .filter((d) => d.renamed)
      .map((d) => ({ from: d.oldTable.name, to: d.newTable.name })),
    diff.tableDiffs.map((d) => d.oldTable.name),
    diff.nameKey,
  );
  for (const rename of renames) {
    statements.push(
      `ALTER TABLE ${quote(rename.from)} RENAME TO ${quote(rename.to)};`,
    );
  }

  const fkChanged = new Set(
    [
      ...diff.fkDrop.map(
        (fk) => diff.tables.pairs.find(([o]) => o === fk.child)?.[1],
      ),
      ...diff.fkAdd.map((fk) => fk.child),
      ...diff.fkRename.map((r) => r.to.child),
    ].filter(Boolean),
  );

  // A rebuilt table loses what other tables' foreign keys say about it only
  // when a referenced column is renamed: those tables are rebuilt too.
  const renamedColumns = new Set(
    diff.tableDiffs.flatMap((d) =>
      d.changes.filter((c) => c.renamed).map((c) => c.now),
    ),
  );
  for (const fk of newModel.foreignKeys) {
    if (fk.refColumns.some((c) => renamedColumns.has(c))) {
      fkChanged.add(fk.child);
    }
  }

  for (const tableDiff of diff.tableDiffs) {
    const { oldTable, newTable, columns, changes } = tableDiff;
    const keys = keyDiffOf.get(tableDiff);
    const structural =
      columns.added.length ||
      columns.removed.length ||
      changes.some(
        (c) =>
          c.renamed ||
          c.typeChanged ||
          c.nullChanged ||
          c.defaultChanged ||
          c.identityChanged ||
          c.checksChanged,
      ) ||
      keys.primary.drop.length ||
      keys.primary.add.length ||
      keys.primary.rename.length ||
      keys.uniques.drop.length ||
      keys.uniques.add.length ||
      keys.uniques.rename.length ||
      fkChanged.has(newTable);

    if (!structural) {
      for (const key of keys.indexes.drop) {
        statements.push(`DROP INDEX ${quote(key.name)};`);
      }
      for (const rename of keys.indexes.rename) {
        statements.push(`DROP INDEX ${quote(rename.from.name)};`);
      }
      const create = [
        ...keys.indexes.add,
        ...keys.indexes.rename.map((r) => r.to),
      ];
      for (const index of create) {
        statements.push(
          `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${quote(index.name)} ON ${newTable.sql} (${plainColumns(
            newModel,
            index.columns.map((c) => c.column),
          )});`,
        );
      }
      continue;
    }

    for (const c of columns.removed) {
      report("warning", "migration_drop_column", {
        table: oldTable.name,
        column: c.name,
      });
    }
    for (const c of columns.added) {
      if (c.notNull && c.defaultSql === null && !c.identity) {
        report("warning", "migration_not_null_no_default", {
          table: newTable.name,
          column: c.name,
        });
      }
    }
    for (const change of changes) {
      if (change.nullChanged && change.now.notNull) {
        report("info", "migration_set_not_null", {
          table: newTable.name,
          column: change.now.name,
        });
      }
    }
    report("info", "migration_sqlite_rebuild", { table: newTable.name });

    const temporary = `_drawdb_new_${newTable.name}`;
    const rebuilt = {
      ...newTable,
      name: temporary,
      sql: quote(temporary),
      indexes: [],
      foreignKeys: newModel.foreignKeys.filter(childOf(newTable)),
    };
    const copied = changes.map((c) => c);
    const block = [
      lineComment(`Rebuild ${newTable.name}`),
      renderTables([rebuilt]),
      copied.length
        ? `INSERT INTO ${quote(temporary)} (${copied
            .map((c) => quote(c.now.name))
            .join(", ")})\nSELECT ${copied
            .map((c) => quote(c.old.name))
            .join(", ")} FROM ${newTable.sql};`
        : null,
      `DROP TABLE ${newTable.sql};`,
      `ALTER TABLE ${quote(temporary)} RENAME TO ${quote(newTable.name)};`,
      ...newTable.indexes.map(
        (index) =>
          `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${quote(index.name)} ON ${newTable.sql} (${plainColumns(
            newModel,
            index.columns.map((c) => c.column),
          )});`,
      ),
    ]
      .filter(Boolean)
      .join("\n\n");
    if (columns.removed.length && !settings.destructive) {
      report("warning", "migration_sqlite_rebuild_skipped", {
        table: newTable.name,
      });
      statements.push(
        block
          .split("\n")
          .map((line) => `-- ${line}`)
          .join("\n"),
      );
    } else {
      statements.push(block);
    }
  }

  const added = new Set(diff.tables.added);
  if (added.size) {
    const tables = newModel.tables.filter((t) => added.has(t));
    const script = renderTables(tables);
    if (script.trim()) statements.push(script);
  }
  return statements;
}
