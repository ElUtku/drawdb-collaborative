// Turns a diagram into a checked, engine-specific model that the renderers
// only have to print: names resolved and unique, types translated, defaults
// rendered, constraints deduplicated and foreign keys ordered. Anything that
// would make the script fail, or that had to be adapted, is reported.

import { DB } from "../../data/constants";
import { dbToTypes } from "../../data/datatypes";
import { getRelationshipFields } from "../utils";
import { renderDefault } from "./defaults";
import {
  applyPattern,
  byteLength,
  createNameRegistry,
  generatedName,
  maxIdentifierBytes,
  quoteColumnsInExpression,
  quoteIdentifier,
  stringLiteral,
} from "./names";
import {
  isMysqlLob,
  mapGenericType,
  renderSizedType,
  splitType,
  typeKind,
} from "./types";

export const DIALECT_NAMES = {
  [DB.MYSQL]: "MySQL",
  [DB.MARIADB]: "MariaDB",
  [DB.POSTGRES]: "PostgreSQL",
  [DB.SQLITE]: "SQLite",
  [DB.MSSQL]: "SQL Server",
  [DB.ORACLESQL]: "Oracle",
};

const MYSQL_FAMILY = new Set([DB.MYSQL, DB.MARIADB]);
// Engines whose default collations compare names without case.
const CASE_INSENSITIVE_NAMES = new Set([
  DB.MYSQL,
  DB.MARIADB,
  DB.SQLITE,
  DB.MSSQL,
]);

const ACTIONS = {
  "no action": "NO ACTION",
  restrict: "RESTRICT",
  cascade: "CASCADE",
  "set null": "SET NULL",
  "set default": "SET DEFAULT",
};

const SERIAL_TYPES = new Set(["SERIAL", "SMALLSERIAL", "BIGSERIAL"]);
// Columns SQL Server and Oracle cannot put in a key or index.
const MSSQL_LOB = /^(N?TEXT|IMAGE|XML)$|\(MAX\)$/i;
const ORACLE_LOB = /^(N?CLOB|BLOB|BFILE|LONG|JSON)$/i;

export function buildModel(diagram, dialect, options) {
  const issues = [];
  const sourceDb = diagram.database || dialect;
  const generic = sourceDb === DB.GENERIC;
  const dialectName = DIALECT_NAMES[dialect];
  const report = (level, code, params = {}) =>
    issues.push({ level, code, params: { dialect: dialectName, ...params } });

  const sameName = CASE_INSENSITIVE_NAMES.has(dialect)
    ? (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
    : (a, b) => String(a) === String(b);
  const nameKey = (name) =>
    CASE_INSENSITIVE_NAMES.has(dialect)
      ? String(name).toLowerCase()
      : String(name);

  const quote = (name) =>
    quoteIdentifier(name, dialect, options.identifierQuoting);
  const schema =
    dialect === DB.SQLITE ? "" : String(options.schema ?? "").trim();
  const qualify = (name) =>
    schema ? `${quote(schema)}.${quote(name)}` : quote(name);
  const literal = (value) => stringLiteral(value, dialect);

  const maxBytes = maxIdentifierBytes(dialect);
  const cleanName = (name, fallback, context) => {
    let text = String(name ?? "").trim();
    if (!text) {
      report("error", context.emptyCode, {
        ...context.params,
        [context.param]: fallback,
      });
      text = fallback;
    }
    if (dialect === DB.ORACLESQL && text.includes('"')) {
      report("warning", "oracle_quote_in_name", { name: text });
      text = text.replace(/"/g, "_");
    }
    if (byteLength(text) > maxBytes) {
      report("error", "name_too_long", { name: text, max: maxBytes });
    }
    return text;
  };

  const sourceTypes = dbToTypes[sourceDb] || {};

  // --- Enums and composite types (PostgreSQL) -----------------------------
  const enums = [];
  const enumsByUpper = new Map();
  const dedupeValues = (values, owner) => {
    const seen = new Set();
    const result = [];
    for (const value of (values ?? []).map((v) => String(v))) {
      if (seen.has(value)) {
        report("warning", "enum_duplicate_value", { name: owner, value });
        continue;
      }
      seen.add(value);
      result.push(value);
    }
    return result;
  };
  if (dialect === DB.POSTGRES || generic) {
    for (const item of diagram.enums ?? []) {
      const name = String(item?.name ?? "").trim();
      if (!name) continue;
      const values = dedupeValues(item.values, name);
      if (values.length === 0) {
        report("warning", "enum_no_values_type", { name });
        continue;
      }
      const entry = { name, values, comment: item.comment ?? "" };
      enumsByUpper.set(name.toUpperCase(), entry);
      if (dialect === DB.POSTGRES) enums.push(entry);
    }
  }
  const typesByUpper = new Map();
  for (const type of diagram.types ?? []) {
    const name = String(type?.name ?? "").trim();
    if (name) typesByUpper.set(name.toUpperCase(), type);
  }

  // Script-wide names: tables first, then types and constraints.
  const tableNames = (diagram.tables ?? []).map((t) => String(t?.name ?? ""));
  const registry = createNameRegistry(dialect, tableNames);
  const claimGenerated = (parts) =>
    registry.claim(generatedName(parts), { generated: true }).name;
  const claimDeclared = (name, fallbackParts) => {
    const text = String(name ?? "").trim();
    if (!text) return claimGenerated(fallbackParts);
    const claimed = registry.claim(text);
    if (claimed.changed) {
      report("warning", "name_changed", { name: text, newName: claimed.name });
    }
    return claimed.name;
  };

  const generatedEnums = [];
  const extensions = new Set();

  // --- Column types --------------------------------------------------------
  const resolveType = (
    field,
    tableName,
    columnName,
    { forType = false } = {},
  ) => {
    const rawType = String(field?.type ?? "").trim();
    const upper = rawType.toUpperCase();
    const ctx = { table: tableName, column: columnName };

    if (!rawType) {
      const fallback =
        dialect === DB.ORACLESQL
          ? "VARCHAR2(255)"
          : dialect === DB.MSSQL
            ? "NVARCHAR(255)"
            : "VARCHAR(255)";
      report("error", "empty_type", { ...ctx, type: fallback });
      return { sql: fallback, base: splitType(fallback).base, kind: "string" };
    }

    // Enums and composite types defined in the diagram.
    if (enumsByUpper.has(upper) && (dialect === DB.POSTGRES || generic)) {
      const entry = enumsByUpper.get(upper);
      if (dialect === DB.POSTGRES) {
        return {
          sql: qualify(entry.name),
          base: entry.name,
          kind: "enum",
          enumValues: entry.values,
        };
      }
      return enumColumn("ENUM", entry.values, ctx);
    }
    if (typesByUpper.has(upper)) {
      const type = typesByUpper.get(upper);
      if (dialect === DB.POSTGRES) {
        return { sql: qualify(type.name), base: type.name, kind: "composite" };
      }
      if (generic) return jsonColumn(type, ctx);
    }

    if (upper === "ENUM" || upper === "SET") {
      return enumColumn(upper, field.values, ctx);
    }

    if (dialect === DB.MSSQL && (upper === "CURSOR" || upper === "TABLE")) {
      report("error", "type_not_for_columns", { ...ctx, type: rawType });
    }

    let base = rawType;
    let fixed = null;
    if (generic) {
      const mapped = mapGenericType(upper, dialect, options);
      if (mapped) {
        if (mapped.includes("(")) fixed = mapped;
        else base = mapped;
      }
      if (upper === "JSON") {
        if (dialect === DB.MSSQL || dialect === DB.ORACLESQL) {
          return {
            sql: mapped,
            base: splitType(mapped).base,
            kind: "text",
            jsonCheck: true,
          };
        }
      }
    }
    if (dialect === DB.MSSQL && upper === "DOUBLE") fixed = "FLOAT(53)";
    if (dialect === DB.MSSQL && upper === "JSON" && !options.mssqlNativeJson) {
      // The JSON type only exists from SQL Server 2025 on.
      return {
        sql: "NVARCHAR(MAX)",
        base: "NVARCHAR",
        size: "MAX",
        kind: "text",
        jsonCheck: true,
      };
    }
    if (dialect === DB.ORACLESQL && upper === "INTERVAL") {
      report("warning", "oracle_interval", ctx);
      fixed = "INTERVAL DAY TO SECOND";
    }
    if (
      dialect === DB.ORACLESQL &&
      base.toUpperCase() === "BOOLEAN" &&
      options.oracleBoolean !== "native"
    ) {
      return {
        sql: "NUMBER(1)",
        base: "NUMBER",
        size: "1",
        kind: "bool",
        booleanAsNumber: true,
      };
    }

    if (fixed) {
      const { base: fixedBase, size } = splitType(fixed);
      return {
        sql: fixed,
        base: fixedBase,
        size,
        kind: typeKind(fixedBase, dialect),
      };
    }

    const meta = sourceTypes[upper] || sourceTypes[rawType];
    const sized = renderSizedType(base, field.size, dialect);
    const size = String(field.size ?? "").trim();
    if (sized.dropped && meta && (meta.isSized || meta.hasPrecision)) {
      report("warning", "size_ignored", { ...ctx, type: base, size });
    }
    if (sized.invalid) {
      report("warning", "size_invalid", { ...ctx, type: base, size });
    }
    if (sized.filled && !forType) {
      report("info", "size_filled", { ...ctx, type: base, size: sized.filled });
    }
    if (dialect === DB.POSTGRES && /^(VECTOR|HALFVEC|SPARSEVEC)$/i.test(base)) {
      extensions.add("vector");
      if (!options.pgCreateExtensions) {
        report("info", "pg_extension", { type: base, extension: "vector" });
      }
    }
    return {
      sql: sized.sql,
      base,
      size: sized.size,
      kind: typeKind(base, dialect),
    };
  };

  function enumColumn(type, rawValues, ctx) {
    const values = dedupeValues(rawValues, `${ctx.table}.${ctx.column}`);
    const longest = values.length
      ? Math.max(1, ...values.map((v) => v.length))
      : 255;
    const textType =
      dialect === DB.ORACLESQL
        ? `VARCHAR2(${Math.max(longest, type === "SET" ? 4000 : 1)})`
        : dialect === DB.MSSQL
          ? `NVARCHAR(${type === "SET" ? "MAX" : longest})`
          : dialect === DB.SQLITE
            ? "TEXT"
            : `VARCHAR(${type === "SET" ? 4000 : longest})`;

    if (values.length === 0) {
      report("error", "enum_no_values", { ...ctx, type, fallback: textType });
      return { sql: textType, base: splitType(textType).base, kind: "string" };
    }
    if (MYSQL_FAMILY.has(dialect)) {
      if (type === "SET" && values.some((v) => v.includes(","))) {
        report("error", "set_value_comma", ctx);
      }
      return {
        sql: `${type}(${values.map(literal).join(", ")})`,
        base: type,
        kind: type === "SET" ? "set" : "enum",
        enumValues: values,
      };
    }
    if (dialect === DB.POSTGRES) {
      const name = claimGenerated([ctx.table, ctx.column, "enum"]);
      generatedEnums.push({ name, values, comment: "" });
      const sql = qualify(name);
      return type === "SET"
        ? { sql: `${sql}[]`, base: name, kind: "array" }
        : { sql, base: name, kind: "enum", enumValues: values };
    }
    if (type === "SET") {
      report("warning", "set_emulated", ctx);
      return { sql: textType, base: splitType(textType).base, kind: "string" };
    }
    return {
      sql: textType,
      base: splitType(textType).base,
      kind: "enum",
      enumValues: values,
      emulatedEnum: true,
    };
  }

  function jsonColumn(type, ctx) {
    void ctx;
    switch (dialect) {
      case DB.MYSQL:
        return { sql: "JSON", base: "JSON", kind: "json", jsonSchema: type };
      case DB.MARIADB:
        return { sql: "JSON", base: "JSON", kind: "json" };
      case DB.MSSQL:
        return {
          sql: "NVARCHAR(MAX)",
          base: "NVARCHAR",
          kind: "text",
          jsonCheck: true,
        };
      case DB.ORACLESQL:
        return { sql: "CLOB", base: "CLOB", kind: "text", jsonCheck: true };
      default:
        return { sql: "TEXT", base: "TEXT", kind: "text" };
    }
  }

  // --- Tables ----------------------------------------------------------------
  const seenTables = new Map();
  const tables = (diagram.tables ?? []).map((table, tableIndex) => {
    const name = cleanName(table?.name, `table_${tableIndex + 1}`, {
      emptyCode: "empty_table_name",
      param: "table",
      params: {},
    });
    if (seenTables.has(nameKey(name))) {
      report("error", "duplicate_table", { table: name });
    }
    seenTables.set(nameKey(name), true);

    const seenColumns = new Map();
    const columns = (table.fields ?? []).map((field, fieldIndex) => {
      const columnName = cleanName(field?.name, `column_${fieldIndex + 1}`, {
        emptyCode: "empty_column_name",
        param: "column",
        params: { table: name },
      });
      if (seenColumns.has(nameKey(columnName))) {
        report("error", "duplicate_column", {
          table: name,
          column: columnName,
        });
      }
      seenColumns.set(nameKey(columnName), true);
      const type = resolveType(field, name, columnName);
      if (dialect === DB.POSTGRES && field.isArray) {
        type.sql = `${type.sql}[]`;
        type.kind = "array";
      }
      return {
        id: field.id,
        index: fieldIndex,
        name: columnName,
        field,
        ...type,
        // The generic dialect hides the unsigned switch, so it never applies.
        unsigned:
          MYSQL_FAMILY.has(dialect) &&
          !generic &&
          Boolean(field.unsigned) &&
          ["int", "decimal", "float"].includes(type.kind),
        primary: Boolean(field.primary),
      };
    });
    return {
      id: table.id,
      name,
      sql: qualify(name),
      comment: String(table.comment ?? ""),
      source: table,
      columns,
      inherits: Array.isArray(table.inherits) ? table.inherits : [],
      uniques: [],
      indexes: [],
      foreignKeys: [],
    };
  });

  const tableById = new Map(tables.map((t) => [t.id, t]));
  const columnByName = (table, name) =>
    table.columns.find((c) => sameName(c.name, name));
  const columnById = (table, id) =>
    table.columns.find((c) => c.id === id) ??
    (typeof id === "number" ? table.columns[id] : undefined);

  if (dialect === DB.POSTGRES) {
    for (const entry of [...enums, ...(diagram.types ?? [])]) {
      if (tables.some((t) => sameName(t.name, entry.name))) {
        report("error", "type_name_clash", { name: entry.name });
      }
    }
  }

  // --- Columns: identity, nullability, defaults, checks ----------------------
  const singleIdentity =
    MYSQL_FAMILY.has(dialect) ||
    dialect === DB.MSSQL ||
    dialect === DB.ORACLESQL;

  const checkedColumns = [];
  for (const table of tables) {
    const primary = table.columns.filter((c) => c.primary);
    let identitySeen = null;

    for (const column of table.columns) {
      const field = column.field;
      const ctx = { table: table.name, column: column.name };
      column.identity = false;
      column.serial =
        dialect === DB.POSTGRES && SERIAL_TYPES.has(column.base.toUpperCase());

      if (field.increment) {
        const integral =
          column.kind === "int" ||
          ((dialect === DB.MSSQL || dialect === DB.ORACLESQL) &&
            column.kind === "decimal" &&
            !/,\s*[1-9]/.test(column.size ?? ""));
        if (dialect === DB.SQLITE) {
          if (primary.length === 1 && primary[0] === column && integral) {
            column.identity = true;
            column.sqliteRowid = true;
            column.sql = "INTEGER";
          } else {
            report("warning", "sqlite_autoincrement", ctx);
          }
        } else if (column.serial) {
          column.identity = true;
        } else if (!integral) {
          report("warning", "identity_unsupported_type", {
            ...ctx,
            type: column.sql,
          });
        } else if (singleIdentity && identitySeen) {
          report("error", "identity_multiple", {
            table: table.name,
            column: identitySeen.name,
          });
        } else {
          column.identity = true;
          identitySeen = column;
        }
      }

      column.notNull = Boolean(
        field.notNull ||
          column.primary ||
          (column.identity && dialect !== DB.SQLITE),
      );

      column.defaultSql = renderDefault(
        field,
        column,
        dialect,
        (code, level, params) => report(level, code, { ...ctx, ...params }),
      );
      if (
        dialect === DB.MSSQL &&
        options.nameConstraints &&
        column.defaultSql !== null
      ) {
        column.defaultName = claimGenerated(["df", table.name, column.name]);
      }

      column.checks = [];
      const check = String(field.check ?? "").trim();
      if (options.includeChecks && check) {
        const meta = sourceTypes[String(field.type ?? "").toUpperCase()];
        if (column.identity && MYSQL_FAMILY.has(dialect)) {
          report("warning", "check_on_identity", ctx);
        } else if (meta && meta.hasCheck === false) {
          report("warning", "check_ignored_type", { ...ctx, type: field.type });
        } else {
          if (generic) checkedColumns.push(`${table.name}.${column.name}`);
          column.checks.push(
            quoteColumnsInExpression(
              check,
              table.columns.map((c) => c.name),
              quote,
            ),
          );
        }
      }
      if (options.includeChecks) {
        const self = quote(column.name);
        if (column.emulatedEnum) {
          column.checks.push(
            `${self} IN (${column.enumValues.map(literal).join(", ")})`,
          );
        }
        if (column.booleanAsNumber) column.checks.push(`${self} IN (0, 1)`);
        if (column.jsonCheck) {
          column.checks.push(
            dialect === DB.MSSQL ? `ISJSON(${self}) = 1` : `${self} IS JSON`,
          );
        }
        if (column.jsonSchema && options.jsonSchemaChecks) {
          column.checks.push(
            `JSON_SCHEMA_VALID(${literal(JSON.stringify(jsonSchemaFor(column.jsonSchema)))}, ${self})`,
          );
        }
      }
      column.comment = String(field.comment ?? "");
    }
  }

  if (checkedColumns.length) {
    // CHECK expressions are copied as written; a generic diagram may use a
    // function the target engine does not have.
    report("info", "check_copied", { columns: checkedColumns.join(", ") });
  }

  function jsonSchemaFor(type) {
    const properties = {};
    for (const field of type.fields ?? []) {
      const upper = String(field.type ?? "").toUpperCase();
      let schemaType = { type: "string" };
      if (["INT", "SMALLINT", "BIGINT"].includes(upper))
        schemaType = { type: "integer" };
      else if (
        ["DECIMAL", "NUMERIC", "NUMBER", "FLOAT", "DOUBLE", "REAL"].includes(
          upper,
        )
      )
        schemaType = { type: "number" };
      else if (upper === "BOOLEAN") schemaType = { type: "boolean" };
      else if (upper === "JSON") schemaType = { type: "object" };
      else if (upper === "ENUM")
        schemaType = { type: "string", enum: field.values ?? [] };
      else if (upper === "SET")
        schemaType = {
          type: "array",
          items: { type: "string", enum: field.values ?? [] },
        };
      else if (typesByUpper.has(upper)) schemaType = { type: "object" };
      properties[field.name] = schemaType;
    }
    return {
      $schema: "http://json-schema.org/draft-04/schema#",
      type: "object",
      properties,
      additionalProperties: false,
    };
  }

  // --- Keys and indexes --------------------------------------------------------
  const keyName = (columns) =>
    columns.map((c) => nameKey(c.name ?? c)).join("\u0000");
  const setName = (columns) =>
    columns
      .map((c) => nameKey(c.name ?? c))
      .sort()
      .join("\u0000");

  const keyColumn = (table, column, object) => {
    const ctx = {
      table: table.name,
      column: column.name,
      type: column.sql,
      object,
    };
    if (MYSQL_FAMILY.has(dialect)) {
      if (column.kind === "json" || column.kind === "spatial") {
        report("error", "lob_in_key", ctx);
        return { column };
      }
      if (isMysqlLob(column.kind)) {
        report("info", "mysql_prefix_key", {
          ...ctx,
          prefix: options.mysqlIndexPrefix,
        });
        return { column, prefix: options.mysqlIndexPrefix };
      }
    }
    if (dialect === DB.MSSQL && MSSQL_LOB.test(column.sql)) {
      report("error", "lob_in_key", ctx);
    }
    if (dialect === DB.ORACLESQL && ORACLE_LOB.test(column.base)) {
      report("error", "lob_in_key", ctx);
    }
    return { column };
  };

  for (const table of tables) {
    const primary = table.columns.filter((c) => c.primary);
    if (primary.length === 0) {
      report("info", "no_primary_key", { table: table.name });
    }
    const rowidPk = primary.length === 1 && primary[0].sqliteRowid;
    table.primaryKey =
      primary.length && !rowidPk
        ? {
            name: options.nameConstraints
              ? claimGenerated([
                  applyPattern(options.pkNamePattern || "pk_{table}", {
                    table: table.name,
                  }),
                ])
              : null,
            columns: primary.map((c) => keyColumn(table, c, "PRIMARY KEY")),
          }
        : null;
    const knownKeys = [];
    if (primary.length)
      knownKeys.push({ label: "PRIMARY KEY", columns: primary });

    const addUnique = (columns, declaredName, label) => {
      const duplicate = knownKeys.find(
        (k) => setName(k.columns) === setName(columns),
      );
      if (duplicate) {
        report("info", "duplicate_key", {
          table: table.name,
          object: label,
          other: duplicate.label,
        });
        return;
      }
      knownKeys.push({ label, columns });
      table.uniques.push({
        name:
          options.nameConstraints || declaredName
            ? claimDeclared(declaredName, [
                "uq",
                table.name,
                ...columns.map((c) => c.name),
              ])
            : null,
        columns: columns.map((c) => keyColumn(table, c, label)),
      });
    };

    for (const column of table.columns) {
      if (
        column.field.unique &&
        !(primary.length === 1 && primary[0] === column)
      ) {
        addUnique([column], null, `UNIQUE (${column.name})`);
      }
    }
    for (const constraint of table.source.uniqueConstraints ?? []) {
      const label = `UNIQUE ${constraint?.name ?? ""}`.trim();
      const columns = resolveNamedColumns(table, constraint?.fields, label);
      if (!columns) continue;
      if (columns.length === 0) {
        report("warning", "empty_index", { table: table.name, object: label });
        continue;
      }
      addUnique(columns, constraint.name, label);
    }

    if (options.includeIndexes) {
      const seenIndexes = [];
      for (const index of table.source.indices ?? []) {
        const label = `INDEX ${index?.name ?? ""}`.trim();
        const columns = resolveNamedColumns(table, index?.fields, label);
        if (!columns) continue;
        if (columns.length === 0) {
          report("warning", "empty_index", {
            table: table.name,
            object: label,
          });
          continue;
        }
        const sameAs =
          seenIndexes.find((i) => keyName(i.columns) === keyName(columns)) ??
          (dialect === DB.ORACLESQL
            ? knownKeys.find((k) => keyName(k.columns) === keyName(columns))
            : null);
        if (sameAs) {
          report("info", "duplicate_key", {
            table: table.name,
            object: label,
            other: sameAs.label,
          });
          continue;
        }
        seenIndexes.push({ label, columns });
        table.indexes.push({
          name: claimDeclared(index.name, [
            "idx",
            table.name,
            ...columns.map((c) => c.name),
          ]),
          unique: Boolean(index.unique),
          columns: columns.map((c) => keyColumn(table, c, label)),
        });
      }
    }

    // MySQL needs every AUTO_INCREMENT column to lead some index.
    const identity = table.columns.find((c) => c.identity);
    if (MYSQL_FAMILY.has(dialect) && identity) {
      const leads = (cols) => cols.length && cols[0].column === identity;
      const indexed =
        (table.primaryKey && leads(table.primaryKey.columns)) ||
        table.uniques.some((u) => leads(u.columns)) ||
        table.indexes.some((i) => leads(i.columns));
      if (!indexed) {
        report("info", "mysql_autoincrement_key", {
          table: table.name,
          column: identity.name,
        });
        table.indexes.push({
          name: claimGenerated(["idx", table.name, identity.name]),
          unique: false,
          columns: [{ column: identity }],
        });
      }
    }
    table.keySets = knownKeys.map((k) => setName(k.columns));
    table.keySets.push(
      ...table.indexes
        .filter((i) => i.unique)
        .map((i) => setName(i.columns.map((c) => c.column))),
    );
  }

  // A key over fewer columns than drawn would be a different key (a unique
  // one would even be stricter), so one missing column drops the whole key.
  function resolveNamedColumns(table, names, label) {
    const columns = [];
    for (const name of Array.isArray(names) ? names : []) {
      const column = columnByName(table, name);
      if (!column) {
        report("warning", "stale_column_reference", {
          table: table.name,
          object: label,
          column: name,
        });
        return null;
      }
      if (!columns.includes(column)) columns.push(column);
    }
    return columns;
  }

  // --- Foreign keys ------------------------------------------------------------
  const foreignKeys = [];
  const mapAction = (value, fk, which) => {
    const action =
      ACTIONS[
        String(value ?? "")
          .trim()
          .toLowerCase()
      ] ?? null;
    if (!action) return null;
    const ctx = { name: fk.label };
    if (dialect === DB.ORACLESQL) {
      if (which === "update") {
        if (action !== "NO ACTION" && action !== "RESTRICT") {
          report("warning", "oracle_no_on_update", { ...ctx, action });
        }
        return null;
      }
      if (action === "SET DEFAULT") {
        report("warning", "fk_set_default_unsupported", ctx);
        return null;
      }
      return action === "CASCADE" || action === "SET NULL" ? action : null;
    }
    if (dialect === DB.MSSQL && action === "RESTRICT") {
      report("info", "fk_restrict_mapped", ctx);
      return "NO ACTION";
    }
    if (MYSQL_FAMILY.has(dialect) && action === "SET DEFAULT") {
      report("warning", "fk_set_default_innodb", ctx);
    }
    return action;
  };

  const fkTypeKey = (column) => {
    const unsigned = column.unsigned ? " UNSIGNED" : "";
    switch (dialect) {
      case DB.MYSQL:
      case DB.MARIADB:
        if (column.kind === "int")
          return `${column.base.toUpperCase()}${unsigned}`;
        if (column.kind === "string" || column.kind === "text") return "string";
        if (column.kind === "decimal")
          return `${column.base.toUpperCase()}(${column.size})`;
        return column.sql.toUpperCase();
      case DB.MSSQL:
        return column.sql.toUpperCase().replace(/\bINTEGER\b/, "INT");
      case DB.POSTGRES:
        if (column.kind === "int") return "int";
        if (column.kind === "string" || column.kind === "text") return "text";
        return column.base.toUpperCase();
      case DB.ORACLESQL:
        if (column.kind === "int" || column.kind === "decimal") return "number";
        if (column.kind === "string") return "string";
        return column.base.toUpperCase();
      default:
        return "any";
    }
  };

  for (const relationship of diagram.references ?? []) {
    const label = String(relationship?.name ?? "").trim() || "(unnamed)";
    const child = tableById.get(relationship?.startTableId);
    const parent = tableById.get(relationship?.endTableId);
    if (!child || !parent) {
      report("warning", "fk_missing_table", { name: label });
      continue;
    }
    const pairs = getRelationshipFields(relationship);
    const columns = pairs.map((p) => columnById(child, p.startFieldId));
    const refColumns = pairs.map((p) => columnById(parent, p.endFieldId));
    if (columns.some((c) => !c) || refColumns.some((c) => !c)) {
      report("warning", "fk_missing_column", { name: label });
      continue;
    }

    const fk = {
      label,
      child,
      parent,
      columns,
      refColumns,
      name:
        options.nameConstraints || options.existing !== "create"
          ? claimDeclared(relationship.name, [
              "fk",
              child.name,
              ...columns.map((c) => c.name),
            ])
          : null,
    };
    fk.onDelete = mapAction(relationship.deleteConstraint, fk, "delete");
    fk.onUpdate = mapAction(relationship.updateConstraint, fk, "update");

    if (!parent.keySets.includes(setName(refColumns))) {
      report(
        dialect === DB.SQLITE ? "warning" : "error",
        "fk_target_not_unique",
        {
          name: label,
          table: parent.name,
          columns: refColumns.map((c) => c.name).join(", "),
        },
      );
    }
    if (dialect !== DB.SQLITE) {
      columns.forEach((column, i) => {
        const ref = refColumns[i];
        if (fkTypeKey(column) !== fkTypeKey(ref)) {
          report("error", "fk_type_mismatch", {
            name: label,
            column: `${child.name}.${column.name}`,
            type: column.sql + (column.unsigned ? " UNSIGNED" : ""),
            refColumn: `${parent.name}.${ref.name}`,
            refType: ref.sql + (ref.unsigned ? " UNSIGNED" : ""),
          });
        }
      });
    }
    if (
      (fk.onDelete === "SET NULL" || fk.onUpdate === "SET NULL") &&
      columns.some((c) => c.notNull)
    ) {
      report("error", "fk_set_null_not_null", {
        name: label,
        column: columns.find((c) => c.notNull).name,
      });
    }
    foreignKeys.push(fk);
    child.foreignKeys.push(fk);
  }

  if (dialect === DB.MSSQL) checkCascadePaths(foreignKeys, report);

  // --- Order and foreign key placement ---------------------------------------
  const ordered = orderTables(tables, foreignKeys, options.tableOrder, dialect);
  const placement = resolvePlacement(options.foreignKeys, dialect);
  if (
    placement === "inline" &&
    options.foreignKeys === "alter" &&
    dialect === DB.SQLITE
  ) {
    report("info", "sqlite_alter_fk");
  }
  const position = new Map(ordered.map((t, i) => [t, i]));
  for (const fk of foreignKeys) {
    if (placement === "none") {
      fk.placement = "none";
    } else if (placement === "alter") {
      fk.placement = "alter";
    } else if (
      dialect === DB.SQLITE ||
      MYSQL_FAMILY.has(dialect) ||
      fk.child === fk.parent ||
      position.get(fk.parent) < position.get(fk.child)
    ) {
      fk.placement = "inline";
    } else {
      fk.placement = "alter";
      report("info", "fk_inline_cycle", { table: fk.child.name });
    }
  }

  // Composite types (PostgreSQL), ordered so that a type follows the ones it uses.
  const compositeTypes = [];
  if (dialect === DB.POSTGRES) {
    for (const type of diagram.types ?? []) {
      const name = String(type?.name ?? "").trim();
      if (!name) continue;
      compositeTypes.push({
        name,
        comment: String(type.comment ?? ""),
        fields: (type.fields ?? []).map((field, i) => ({
          name: String(field?.name ?? "").trim() || `field_${i + 1}`,
          ...resolveType(field, name, field?.name, { forType: true }),
        })),
      });
    }
    sortTypes(compositeTypes);
  }

  // The same note can come up once per column (an extension, say).
  const seenIssues = new Set();
  const uniqueIssues = issues.filter((issue) => {
    const key = JSON.stringify(issue);
    if (seenIssues.has(key)) return false;
    seenIssues.add(key);
    return true;
  });
  issues.splice(0, issues.length, ...uniqueIssues);

  return {
    dialect,
    sourceDb,
    options,
    schema,
    quote,
    qualify,
    literal,
    enums: [...enums, ...generatedEnums],
    compositeTypes,
    tables: ordered,
    foreignKeys,
    extensions: [...extensions],
    issues,
  };
}

export function resolvePlacement(option, dialect) {
  if (option === "none") return "none";
  if (dialect === DB.SQLITE) return "inline";
  if (option === "inline" || option === "alter") return option;
  return MYSQL_FAMILY.has(dialect) ? "inline" : "alter";
}

/**
 * Parents before children (and PostgreSQL parents of INHERITS before their
 * children), keeping the requested order among tables that do not depend on
 * each other. Tables caught in a cycle keep their relative order at the end.
 */
function orderTables(tables, foreignKeys, mode, dialect) {
  const base = [...tables];
  if (mode === "alphabetical") {
    base.sort((a, b) => a.name.localeCompare(b.name));
  }
  if (
    mode !== "dependencies" &&
    !(dialect === DB.POSTGRES && tables.some((t) => t.inherits.length))
  ) {
    return base;
  }
  const parents = new Map(base.map((t) => [t, new Set()]));
  if (mode === "dependencies") {
    for (const fk of foreignKeys) {
      if (fk.child !== fk.parent) parents.get(fk.child).add(fk.parent);
    }
  }
  if (dialect === DB.POSTGRES) {
    for (const table of base) {
      for (const parentName of table.inherits) {
        const parent = base.find((t) => t.name === parentName);
        if (parent && parent !== table) parents.get(table).add(parent);
      }
    }
  }
  const result = [];
  const placed = new Set();
  let progress = true;
  while (result.length < base.length && progress) {
    progress = false;
    for (const table of base) {
      if (placed.has(table)) continue;
      if ([...parents.get(table)].every((p) => placed.has(p))) {
        result.push(table);
        placed.add(table);
        progress = true;
      }
    }
  }
  for (const table of base) if (!placed.has(table)) result.push(table);
  return result;
}

function sortTypes(types) {
  const byName = new Map(types.map((t) => [t.name.toUpperCase(), t]));
  const result = [];
  const visiting = new Set();
  const visit = (type) => {
    if (result.includes(type) || visiting.has(type)) return;
    visiting.add(type);
    for (const field of type.fields) {
      const dependency = byName.get(String(field.base).toUpperCase());
      if (dependency && dependency !== type) visit(dependency);
    }
    visiting.delete(type);
    result.push(type);
  };
  types.forEach(visit);
  types.splice(0, types.length, ...result);
}

/**
 * SQL Server refuses a foreign key whose cascading action could reach a table
 * through more than one path, or loop back (including onto its own table).
 */
function checkCascadePaths(foreignKeys, report) {
  for (const action of ["onDelete", "onUpdate"]) {
    const cascading = foreignKeys.filter(
      (fk) => fk[action] && fk[action] !== "NO ACTION",
    );
    const flagged = new Set();
    for (const fk of cascading) {
      if (fk.child === fk.parent) flagged.add(fk);
    }
    // Count cascading paths from each table; a second path to any table, or a
    // path back to the start, is what SQL Server rejects.
    for (const start of new Set(cascading.map((fk) => fk.parent))) {
      const reached = new Map();
      const walk = (table, trail) => {
        for (const fk of cascading) {
          if (fk.parent !== table || fk.child === fk.parent) continue;
          if (trail.includes(fk.child) || fk.child === start) {
            flagged.add(fk);
            continue;
          }
          if (reached.has(fk.child)) {
            flagged.add(fk);
            flagged.add(reached.get(fk.child));
            continue;
          }
          reached.set(fk.child, fk);
          walk(fk.child, [...trail, fk.child]);
        }
      };
      walk(start, [start]);
    }
    for (const fk of flagged) {
      report("error", "mssql_cascade_paths", { name: fk.label });
    }
  }
}
