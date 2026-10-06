// Settings of the SQL export. The export dialog renders this list as a form:
// `section` puts a setting in the "Basic" part or under "Advanced", `dialects`
// limits it to the engines it applies to and `default` / `placeholder` may
// depend on the engine. Labels and descriptions come from the translations
// (`sql_opt_<key>`, `sql_opt_<key>_desc`, `sql_opt_<key>_<choice>`).

import { DB } from "../../data/constants";

const MYSQL_FAMILY = [DB.MYSQL, DB.MARIADB];
const ALL = [
  DB.MYSQL,
  DB.MARIADB,
  DB.POSTGRES,
  DB.SQLITE,
  DB.MSSQL,
  DB.ORACLESQL,
];

export const SQL_OPTION_DEFS = [
  // --- Basic ---------------------------------------------------------------
  {
    key: "existing",
    section: "basic",
    type: "select",
    choices: ["create", "if_not_exists", "drop_create"],
    dialects: ALL,
    default: (dialect) =>
      dialect === DB.MSSQL || dialect === DB.ORACLESQL
        ? "create"
        : "if_not_exists",
  },
  {
    key: "foreignKeys",
    section: "basic",
    type: "select",
    choices: ["auto", "alter", "inline", "none"],
    dialects: ALL,
    default: "auto",
  },
  {
    key: "includeComments",
    section: "basic",
    type: "bool",
    dialects: ALL,
    default: true,
  },
  {
    key: "includeIndexes",
    section: "basic",
    type: "bool",
    dialects: ALL,
    default: true,
  },
  {
    key: "schema",
    section: "basic",
    type: "text",
    dialects: [DB.POSTGRES, DB.MSSQL, DB.ORACLESQL, ...MYSQL_FAMILY],
    default: "",
    placeholder: (dialect) =>
      ({
        [DB.POSTGRES]: "public",
        [DB.MSSQL]: "dbo",
        [DB.ORACLESQL]: "APP_OWNER",
      })[dialect] ?? "my_database",
  },
  {
    key: "wrapInTransaction",
    section: "basic",
    type: "bool",
    // MySQL, MariaDB and Oracle commit implicitly after every DDL statement.
    dialects: [DB.POSTGRES, DB.SQLITE, DB.MSSQL],
    default: false,
  },

  // --- Advanced ------------------------------------------------------------
  {
    key: "nameConstraints",
    section: "advanced",
    type: "bool",
    dialects: ALL,
    default: true,
  },
  {
    key: "pkNamePattern",
    section: "advanced",
    type: "text",
    dialects: ALL,
    default: "pk_{table}",
    placeholder: "pk_{table}",
  },
  {
    key: "identifierQuoting",
    section: "advanced",
    type: "select",
    choices: ["always", "when_needed"],
    dialects: ALL,
    default: "always",
  },
  {
    key: "tableOrder",
    section: "advanced",
    type: "select",
    choices: ["dependencies", "diagram", "alphabetical"],
    dialects: ALL,
    default: "dependencies",
  },
  {
    key: "identityGeneration",
    section: "advanced",
    type: "select",
    choices: ["by_default", "always"],
    dialects: [DB.POSTGRES, DB.ORACLESQL],
    default: "by_default",
  },
  {
    key: "includeChecks",
    section: "advanced",
    type: "bool",
    dialects: ALL,
    default: true,
  },
  {
    key: "includeHeader",
    section: "advanced",
    type: "bool",
    dialects: ALL,
    default: true,
  },
  {
    key: "createSchema",
    section: "advanced",
    type: "bool",
    dialects: [DB.POSTGRES, DB.MSSQL, ...MYSQL_FAMILY],
    default: false,
  },
  {
    key: "mysqlEngine",
    section: "advanced",
    type: "text",
    dialects: MYSQL_FAMILY,
    default: "InnoDB",
    placeholder: "InnoDB",
  },
  {
    key: "mysqlCharset",
    section: "advanced",
    type: "text",
    dialects: MYSQL_FAMILY,
    default: "utf8mb4",
    placeholder: "utf8mb4",
  },
  {
    key: "mysqlCollation",
    section: "advanced",
    type: "text",
    dialects: MYSQL_FAMILY,
    default: "",
    placeholder: (dialect) =>
      dialect === DB.MARIADB ? "utf8mb4_unicode_ci" : "utf8mb4_0900_ai_ci",
  },
  {
    key: "mysqlIndexPrefix",
    section: "advanced",
    type: "number",
    dialects: MYSQL_FAMILY,
    default: 255,
    placeholder: "255",
    min: 1,
    max: 3072,
  },
  {
    key: "jsonSchemaChecks",
    section: "advanced",
    type: "bool",
    dialects: [DB.MYSQL],
    genericOnly: true,
    default: true,
  },
  {
    key: "uuidAs",
    section: "advanced",
    type: "select",
    choices: ["native", "string", "binary"],
    dialects: ALL,
    genericOnly: true,
    default: "native",
  },
  {
    key: "pgCreateExtensions",
    section: "advanced",
    type: "bool",
    dialects: [DB.POSTGRES],
    default: false,
  },
  {
    key: "sqliteForeignKeysPragma",
    section: "advanced",
    type: "bool",
    dialects: [DB.SQLITE],
    default: true,
  },
  {
    key: "sqliteAutoincrement",
    section: "advanced",
    type: "bool",
    dialects: [DB.SQLITE],
    default: true,
  },
  {
    key: "mssqlBatchSeparator",
    section: "advanced",
    type: "bool",
    dialects: [DB.MSSQL],
    default: true,
  },
  {
    key: "mssqlNativeJson",
    section: "advanced",
    type: "bool",
    dialects: [DB.MSSQL],
    default: false,
  },
  {
    key: "oracleBoolean",
    section: "advanced",
    type: "select",
    choices: ["number", "native"],
    dialects: [DB.ORACLESQL],
    default: "number",
  },
];

function resolve(value, dialect) {
  return typeof value === "function" ? value(dialect) : value;
}

/** The settings that apply when exporting a `sourceDb` diagram to `dialect`. */
export function sqlOptionDefsFor(dialect, sourceDb = dialect) {
  return SQL_OPTION_DEFS.filter(
    (def) =>
      def.dialects.includes(dialect) &&
      (!def.genericOnly || sourceDb === DB.GENERIC),
  ).map((def) => ({
    ...def,
    default: resolve(def.default, dialect),
    placeholder: resolve(def.placeholder, dialect),
  }));
}

export function defaultSqlOptions(dialect) {
  const defaults = {};
  for (const def of SQL_OPTION_DEFS) {
    defaults[def.key] = resolve(def.default, dialect);
  }
  return defaults;
}

/** Defaults overlaid with `userOptions`, ignoring unknown or mistyped values. */
export function normalizeSqlOptions(dialect, userOptions = {}) {
  const options = defaultSqlOptions(dialect);
  for (const def of SQL_OPTION_DEFS) {
    const value = userOptions?.[def.key];
    if (value === undefined || value === null) continue;
    if (def.type === "bool" && typeof value === "boolean") {
      options[def.key] = value;
    } else if (def.type === "select" && def.choices.includes(value)) {
      options[def.key] = value;
    } else if (def.type === "text" && typeof value === "string") {
      options[def.key] = value.trim();
    } else if (def.type === "number") {
      const number = Number(value);
      if (Number.isInteger(number) && number >= def.min && number <= def.max) {
        options[def.key] = number;
      }
    }
  }
  return options;
}
