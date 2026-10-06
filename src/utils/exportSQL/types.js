// Column type rendering for each engine: which types take a length or a
// precision, which ones need a length to be valid at all, and how the types of
// a "generic" diagram translate to a concrete engine.

import { DB } from "../../data/constants";

const KIND_BY_TYPE = {};
const register = (kind, names) => {
  for (const name of names) KIND_BY_TYPE[name] = kind;
};
register("int", [
  "TINYINT",
  "SMALLINT",
  "MEDIUMINT",
  "INT",
  "INTEGER",
  "BIGINT",
  "SERIAL",
  "SMALLSERIAL",
  "BIGSERIAL",
  "YEAR",
]);
register("decimal", ["DECIMAL", "NUMERIC", "NUMBER", "MONEY", "SMALLMONEY"]);
register("float", [
  "FLOAT",
  "DOUBLE",
  "DOUBLE PRECISION",
  "REAL",
  "BINARY_FLOAT",
  "BINARY_DOUBLE",
]);
register("bool", ["BOOLEAN", "BOOL"]);
register("bit", ["BIT", "VARBIT"]);
register("string", [
  "CHAR",
  "VARCHAR",
  "NCHAR",
  "NVARCHAR",
  "VARCHAR2",
  "NVARCHAR2",
  "CITEXT",
]);
register("text", [
  "TINYTEXT",
  "TEXT",
  "MEDIUMTEXT",
  "LONGTEXT",
  "NTEXT",
  "CLOB",
  "NCLOB",
  "LONG",
]);
register("binary", ["BINARY", "VARBINARY", "RAW", "BYTEA"]);
register("blob", [
  "TINYBLOB",
  "BLOB",
  "MEDIUMBLOB",
  "LONGBLOB",
  "IMAGE",
  "BFILE",
]);
register("date", ["DATE"]);
register("time", ["TIME", "TIMETZ"]);
register("datetime", [
  "DATETIME",
  "DATETIME2",
  "SMALLDATETIME",
  "DATETIMEOFFSET",
  "TIMESTAMP",
  "TIMESTAMPTZ",
]);
register("json", ["JSON", "JSONB"]);
register("uuid", ["UUID", "UNIQUEIDENTIFIER"]);
register("spatial", [
  "GEOMETRY",
  "POINT",
  "LINESTRING",
  "POLYGON",
  "MULTIPOINT",
  "MULTILINESTRING",
  "MULTIPOLYGON",
  "GEOMETRYCOLLECTION",
]);
register("enum", ["ENUM"]);
register("set", ["SET"]);

export function typeKind(base, dialect) {
  const name = String(base).toUpperCase();
  // SQL Server's TIMESTAMP is a row version counter, not a point in time, and
  // its BIT is how it stores booleans.
  if (dialect === DB.MSSQL && name === "TIMESTAMP") return "rowversion";
  if (dialect === DB.MSSQL && name === "BIT") return "bool";
  return KIND_BY_TYPE[name] ?? "other";
}

/** Text and binary types MySQL stores off-page: no literal DEFAULT, prefix keys. */
export function isMysqlLob(kind) {
  return ["text", "blob", "json", "spatial"].includes(kind);
}

// How a size is written for each type:
//   len    VARCHAR(n)          lenMax  like len, or (MAX) on SQL Server
//   prec   DECIMAL(p) / (p,s)  single  FLOAT(p)
//   fsp    fractional seconds TIME(p)
// `required` is the size used when the diagram leaves it empty but the engine
// rejects (or silently shrinks) the type without one.
const SIZE_RULES = {
  [DB.MYSQL]: {
    CHAR: { kind: "len" },
    VARCHAR: { kind: "len", required: 255 },
    BINARY: { kind: "len" },
    VARBINARY: { kind: "len", required: 255 },
    TEXT: { kind: "len" },
    BLOB: { kind: "len" },
    DECIMAL: { kind: "prec" },
    NUMERIC: { kind: "prec" },
    FLOAT: { kind: "prec" },
    DOUBLE: { kind: "prec" },
    BIT: { kind: "single" },
    TIME: { kind: "fsp" },
    DATETIME: { kind: "fsp" },
    TIMESTAMP: { kind: "fsp" },
  },
  [DB.POSTGRES]: {
    CHAR: { kind: "len" },
    VARCHAR: { kind: "len" },
    BIT: { kind: "len" },
    VARBIT: { kind: "len" },
    VECTOR: { kind: "len" },
    HALFVEC: { kind: "len" },
    SPARSEVEC: { kind: "len" },
    DECIMAL: { kind: "prec" },
    NUMERIC: { kind: "prec" },
    FLOAT: { kind: "single" },
    TIME: { kind: "fsp" },
    TIMETZ: { kind: "fsp" },
    TIMESTAMP: { kind: "fsp" },
    TIMESTAMPTZ: { kind: "fsp" },
    INTERVAL: { kind: "fsp" },
  },
  [DB.MSSQL]: {
    CHAR: { kind: "len" },
    NCHAR: { kind: "len" },
    BINARY: { kind: "len" },
    VARCHAR: { kind: "lenMax", required: 255 },
    NVARCHAR: { kind: "lenMax", required: 255 },
    VARBINARY: { kind: "lenMax", required: 255 },
    DECIMAL: { kind: "prec" },
    NUMERIC: { kind: "prec" },
    FLOAT: { kind: "single" },
    DATETIME2: { kind: "fsp" },
    DATETIMEOFFSET: { kind: "fsp" },
    TIME: { kind: "fsp" },
  },
  [DB.ORACLESQL]: {
    VARCHAR2: { kind: "len", required: 255 },
    NVARCHAR2: { kind: "len", required: 255 },
    CHAR: { kind: "len" },
    NCHAR: { kind: "len" },
    RAW: { kind: "len", required: 255 },
    NUMBER: { kind: "prec" },
    FLOAT: { kind: "single" },
    TIMESTAMP: { kind: "fsp" },
  },
};
SIZE_RULES[DB.MARIADB] = SIZE_RULES[DB.MYSQL];

const SIZE_FORMATS = {
  len: /^\d+$/,
  lenMax: /^(\d+|max)$/i,
  prec: /^\d+(\s*,\s*-?\d+)?$/,
  single: /^\d+$/,
  fsp: /^\d$/,
};

export function sizeRule(dialect, base) {
  if (dialect === DB.SQLITE) {
    // SQLite keeps any "(n)" or "(p,s)" as documentation and never rejects it.
    return { kind: "prec" };
  }
  return SIZE_RULES[dialect]?.[String(base).toUpperCase()] ?? null;
}

/**
 * Renders `base` with `size` when the engine accepts it. Returns the type text
 * and, when a size had to be dropped or filled in, the reason.
 */
export function renderSizedType(base, size, dialect) {
  const rule = sizeRule(dialect, base);
  const text = String(size ?? "").trim();
  if (!rule) {
    return { sql: base, size: "", dropped: text !== "" ? text : null };
  }
  if (text !== "" && SIZE_FORMATS[rule.kind].test(text)) {
    const normalized =
      rule.kind === "lenMax" && /^max$/i.test(text)
        ? "MAX"
        : text.replace(/\s+/g, "");
    return { sql: `${base}(${normalized})`, size: normalized };
  }
  if (rule.required) {
    return {
      sql: `${base}(${rule.required})`,
      size: String(rule.required),
      filled: rule.required,
      invalid: text !== "" ? text : null,
    };
  }
  return { sql: base, size: "", invalid: text !== "" ? text : null };
}

// Types of a diagram in the generic dialect, as each engine spells them.
// `size: true` keeps the size from the diagram.
const GENERIC_MAP = {
  [DB.MYSQL]: {
    INT: "INT",
    SMALLINT: "SMALLINT",
    BIGINT: "BIGINT",
    DECIMAL: "DECIMAL",
    NUMERIC: "NUMERIC",
    NUMBER: "DECIMAL",
    FLOAT: "FLOAT",
    DOUBLE: "DOUBLE",
    REAL: "FLOAT",
    CHAR: "CHAR",
    VARCHAR: "VARCHAR",
    VARCHAR2: "VARCHAR",
    TEXT: "TEXT",
    TIME: "TIME",
    TIMESTAMP: "TIMESTAMP",
    DATE: "DATE",
    DATETIME: "DATETIME",
    BOOLEAN: "BOOLEAN",
    BINARY: "BINARY",
    VARBINARY: "VARBINARY",
    BLOB: "BLOB",
    CLOB: "LONGTEXT",
    NCLOB: "LONGTEXT",
    JSON: "JSON",
  },
  [DB.POSTGRES]: {
    INT: "INTEGER",
    SMALLINT: "SMALLINT",
    BIGINT: "BIGINT",
    DECIMAL: "DECIMAL",
    NUMERIC: "NUMERIC",
    NUMBER: "NUMERIC",
    FLOAT: "FLOAT",
    DOUBLE: "DOUBLE PRECISION",
    REAL: "REAL",
    CHAR: "CHAR",
    VARCHAR: "VARCHAR",
    VARCHAR2: "VARCHAR",
    TEXT: "TEXT",
    TIME: "TIME",
    TIMESTAMP: "TIMESTAMP",
    DATE: "DATE",
    DATETIME: "TIMESTAMP",
    BOOLEAN: "BOOLEAN",
    BINARY: "BYTEA",
    VARBINARY: "BYTEA",
    BLOB: "BYTEA",
    CLOB: "TEXT",
    NCLOB: "TEXT",
    JSON: "JSONB",
  },
  [DB.SQLITE]: {
    INT: "INTEGER",
    SMALLINT: "INTEGER",
    BIGINT: "INTEGER",
    DECIMAL: "NUMERIC",
    NUMERIC: "NUMERIC",
    NUMBER: "NUMERIC",
    FLOAT: "REAL",
    DOUBLE: "REAL",
    REAL: "REAL",
    CHAR: "TEXT",
    VARCHAR: "TEXT",
    VARCHAR2: "TEXT",
    TEXT: "TEXT",
    TIME: "TEXT",
    TIMESTAMP: "TEXT",
    DATE: "TEXT",
    DATETIME: "TEXT",
    BOOLEAN: "INTEGER",
    BINARY: "BLOB",
    VARBINARY: "BLOB",
    BLOB: "BLOB",
    CLOB: "TEXT",
    NCLOB: "TEXT",
    JSON: "TEXT",
  },
  [DB.MSSQL]: {
    INT: "INT",
    SMALLINT: "SMALLINT",
    BIGINT: "BIGINT",
    DECIMAL: "DECIMAL",
    NUMERIC: "NUMERIC",
    NUMBER: "DECIMAL",
    FLOAT: "FLOAT",
    DOUBLE: "FLOAT(53)",
    REAL: "REAL",
    CHAR: "NCHAR",
    VARCHAR: "NVARCHAR",
    VARCHAR2: "NVARCHAR",
    TEXT: "NVARCHAR(MAX)",
    TIME: "TIME",
    TIMESTAMP: "DATETIME2",
    DATE: "DATE",
    DATETIME: "DATETIME2",
    BOOLEAN: "BIT",
    BINARY: "BINARY",
    VARBINARY: "VARBINARY",
    BLOB: "VARBINARY(MAX)",
    CLOB: "NVARCHAR(MAX)",
    NCLOB: "NVARCHAR(MAX)",
    JSON: "NVARCHAR(MAX)",
  },
  [DB.ORACLESQL]: {
    INT: "NUMBER(10)",
    SMALLINT: "NUMBER(5)",
    BIGINT: "NUMBER(19)",
    DECIMAL: "NUMBER",
    NUMERIC: "NUMBER",
    NUMBER: "NUMBER",
    FLOAT: "FLOAT",
    DOUBLE: "BINARY_DOUBLE",
    REAL: "BINARY_FLOAT",
    CHAR: "CHAR",
    VARCHAR: "VARCHAR2",
    VARCHAR2: "VARCHAR2",
    TEXT: "CLOB",
    TIME: "TIMESTAMP",
    TIMESTAMP: "TIMESTAMP",
    DATE: "DATE",
    DATETIME: "TIMESTAMP",
    BOOLEAN: "BOOLEAN",
    BINARY: "RAW",
    VARBINARY: "RAW",
    BLOB: "BLOB",
    CLOB: "CLOB",
    NCLOB: "NCLOB",
    JSON: "CLOB",
  },
};
GENERIC_MAP[DB.MARIADB] = GENERIC_MAP[DB.MYSQL];

const UUID_TYPES = {
  native: {
    [DB.POSTGRES]: "UUID",
    [DB.MSSQL]: "UNIQUEIDENTIFIER",
    [DB.MARIADB]: "UUID",
  },
  string: {
    [DB.ORACLESQL]: "VARCHAR2(36)",
    [DB.SQLITE]: "TEXT",
    [DB.MSSQL]: "NCHAR(36)",
  },
  binary: {
    [DB.ORACLESQL]: "RAW(16)",
    [DB.SQLITE]: "BLOB",
    [DB.POSTGRES]: "BYTEA",
    [DB.MSSQL]: "BINARY(16)",
  },
};

/**
 * The target engine's base type for a generic diagram type, or null when the
 * caller has to handle it (ENUM, SET and composite types).
 */
export function mapGenericType(type, dialect, { uuidAs = "native" } = {}) {
  const name = String(type).toUpperCase();
  if (name === "UUID") {
    if (uuidAs === "native" && UUID_TYPES.native[dialect]) {
      return UUID_TYPES.native[dialect];
    }
    if (uuidAs === "binary") return UUID_TYPES.binary[dialect] ?? "BINARY(16)";
    return UUID_TYPES.string[dialect] ?? "CHAR(36)";
  }
  return GENERIC_MAP[dialect]?.[name] ?? null;
}

/** Splits "VARCHAR(255)" into its base and size. */
export function splitType(text) {
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(String(text));
  return match
    ? { base: match[1].trim(), size: match[2].trim() }
    : { base: String(text).trim(), size: "" };
}
