// DEFAULT clauses. The diagram stores defaults as free text, so this decides
// whether the text is a literal, a keyword or an expression, and writes it the
// way each engine accepts it for the column's type.

import { DB } from "../../data/constants";
import { isMysqlLob } from "./types";
import { stringLiteral } from "./names";

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const FUNCTION_CALL = /^[A-Za-z_][\w.$]*\s*\([\s\S]*\)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/;

// Every spelling of "now" the diagram may hold, grouped by what it means.
const TEMPORAL = {
  CURRENT_TIMESTAMP: "now",
  "CURRENT_TIMESTAMP()": "now",
  "NOW()": "now",
  LOCALTIMESTAMP: "now",
  "LOCALTIMESTAMP()": "now",
  LOCALTIME: "now",
  "LOCALTIME()": "now",
  SYSDATE: "now",
  "SYSDATE()": "now",
  SYSTIMESTAMP: "now",
  "GETDATE()": "now",
  "SYSDATETIME()": "now",
  "DATETIME('NOW')": "now",
  CURRENT_DATE: "today",
  "CURRENT_DATE()": "today",
  "CURDATE()": "today",
  "DATE('NOW')": "today",
  CURRENT_TIME: "time",
  "CURRENT_TIME()": "time",
  "CURTIME()": "time",
  "TIME('NOW')": "time",
};
const POSTGRES_TEMPORAL = new Set([
  "CURRENT_TIMESTAMP",
  "CURRENT_DATE",
  "CURRENT_TIME",
  "LOCALTIME",
  "LOCALTIMESTAMP",
  "NOW()",
]);

function temporalDefault(meaning, raw, column, dialect) {
  const kind = column.kind;
  switch (dialect) {
    case DB.POSTGRES:
      if (POSTGRES_TEMPORAL.has(raw.toUpperCase())) return raw.toUpperCase();
      return meaning === "today"
        ? "CURRENT_DATE"
        : meaning === "time"
          ? "CURRENT_TIME"
          : "CURRENT_TIMESTAMP";
    case DB.MYSQL:
    case DB.MARIADB: {
      if (kind === "datetime" && meaning === "now") {
        // DATETIME(3) only accepts CURRENT_TIMESTAMP(3).
        return /^\d$/.test(column.size)
          ? `CURRENT_TIMESTAMP(${column.size})`
          : "CURRENT_TIMESTAMP";
      }
      const expression =
        kind === "date" || meaning === "today"
          ? "CURRENT_DATE"
          : kind === "time" || meaning === "time"
            ? "CURRENT_TIME"
            : "CURRENT_TIMESTAMP";
      // MySQL only takes other expressions in parentheses (8.0.13+).
      return dialect === DB.MYSQL ? `(${expression})` : expression;
    }
    case DB.SQLITE:
      if (kind === "date" || meaning === "today") return "CURRENT_DATE";
      if (kind === "time" || meaning === "time") return "CURRENT_TIME";
      return "CURRENT_TIMESTAMP";
    case DB.MSSQL:
      if (kind === "date" || meaning === "today")
        return "(CAST(GETDATE() AS DATE))";
      if (kind === "time" || meaning === "time")
        return "(CAST(GETDATE() AS TIME))";
      return "CURRENT_TIMESTAMP";
    case DB.ORACLESQL:
      if (meaning === "today") return "TRUNC(SYSDATE)";
      return kind === "date" ? "SYSDATE" : "CURRENT_TIMESTAMP";
    default:
      return raw;
  }
}

export function booleanLiteral(value, column, dialect) {
  if (
    dialect === DB.SQLITE ||
    dialect === DB.MSSQL ||
    (dialect === DB.ORACLESQL && column.booleanAsNumber)
  ) {
    return value ? "1" : "0";
  }
  return value ? "TRUE" : "FALSE";
}

const TRUE_WORDS = new Set(["TRUE", "1", "T", "Y", "YES", "ON"]);
const FALSE_WORDS = new Set(["FALSE", "0", "F", "N", "NO", "OFF"]);

function stripQuotes(text) {
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return { value: text.slice(1, -1).replace(/''/g, "'"), quoted: true };
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return { value: text.slice(1, -1), quoted: true };
  }
  return { value: text, quoted: false };
}

function isExpression(text, dialect) {
  if (text.startsWith("(") && text.endsWith(")")) return true;
  if (FUNCTION_CALL.test(text)) return true;
  // PostgreSQL casts such as '{}'::jsonb or 'a'::text.
  if (dialect === DB.POSTGRES && /::\s*[A-Za-z_"][\w\s"[\].]*$/.test(text))
    return true;
  return false;
}

function wrapExpression(text, dialect) {
  const parenthesized = text.startsWith("(") && text.endsWith(")");
  if (parenthesized) return text;
  // MySQL and SQLite only accept expressions (other than a few keywords) in
  // parentheses; SQL Server accepts both and writes them that way itself.
  if (dialect === DB.MYSQL || dialect === DB.SQLITE || dialect === DB.MSSQL) {
    return `(${text})`;
  }
  return text;
}

function oracleTemporalLiteral(value, column) {
  if (ISO_DATE.test(value)) {
    return column.kind === "date"
      ? `DATE '${value}'`
      : `TIMESTAMP '${value} 00:00:00'`;
  }
  if (ISO_DATETIME.test(value)) {
    const normalized = value.replace("T", " ");
    const withSeconds = /:\d{2}:\d{2}/.test(normalized)
      ? normalized
      : `${normalized}:00`;
    return column.kind === "date"
      ? `TO_DATE('${withSeconds.slice(0, 19)}', 'YYYY-MM-DD HH24:MI:SS')`
      : `TIMESTAMP '${withSeconds}'`;
  }
  return null;
}

/**
 * Returns the text after DEFAULT, or null for no default. `report(code, params)`
 * receives the reasons when a default is dropped or looks wrong.
 */
export function renderDefault(field, column, dialect, report) {
  let raw = field.default;
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "boolean") raw = raw ? "true" : "false";
  raw = String(raw).trim();
  if (raw === "") return null;

  if (column.identity) {
    report("default_on_identity", "warning");
    return null;
  }
  if (column.kind === "rowversion") {
    report("default_on_rowversion", "warning");
    return null;
  }

  const upper = raw.toUpperCase();
  if (upper === "NULL") {
    if (column.notNull) {
      report("default_null_not_null", "warning");
      return null;
    }
    return "NULL";
  }

  const compact = upper.replace(/\s+/g, "");
  if (TEMPORAL[compact]) {
    return temporalDefault(TEMPORAL[compact], raw, column, dialect);
  }

  const { value, quoted } = stripQuotes(raw);

  if (!quoted && isExpression(raw, dialect)) {
    return wrapExpression(raw, dialect);
  }

  const literal = () => {
    const text = stringLiteral(value, dialect);
    // MySQL rejects literal defaults on TEXT, BLOB, JSON and spatial columns
    // but accepts them as expressions.
    return dialect === DB.MYSQL && isMysqlLob(column.kind) ? `(${text})` : text;
  };

  switch (column.kind) {
    case "int":
    case "decimal":
    case "float": {
      if (NUMBER.test(value)) return value.replace(/^\+/, "");
      if (value.toUpperCase() === "TRUE") return "1";
      if (value.toUpperCase() === "FALSE") return "0";
      report("default_not_numeric", "error", { value });
      return literal();
    }
    case "bool": {
      const upperValue = value.toUpperCase();
      if (TRUE_WORDS.has(upperValue))
        return booleanLiteral(true, column, dialect);
      if (FALSE_WORDS.has(upperValue))
        return booleanLiteral(false, column, dialect);
      report("default_not_boolean", "error", { value });
      return literal();
    }
    case "bit":
      if (/^[01]+$/.test(value)) {
        if (dialect === DB.POSTGRES) return `B'${value}'`;
        if (dialect === DB.MYSQL || dialect === DB.MARIADB)
          return `b'${value}'`;
        return value;
      }
      if (NUMBER.test(value)) return value;
      report("default_not_bits", "error", { value });
      return literal();
    case "enum":
      if (column.enumValues && !column.enumValues.includes(value)) {
        report("default_not_in_enum", "error", { value });
      }
      return literal();
    case "date":
    case "datetime":
      if (dialect === DB.ORACLESQL) {
        const oracle = oracleTemporalLiteral(value, column);
        if (oracle) return oracle;
      }
      return literal();
    case "binary":
    case "blob":
      if (!quoted && /^0x[0-9a-f]*$/i.test(value)) {
        const hex = value.slice(2);
        if (dialect === DB.POSTGRES) return `'\\x${hex}'`;
        if (dialect === DB.SQLITE) return `X'${hex}'`;
        if (dialect === DB.ORACLESQL) return `HEXTORAW('${hex}')`;
        return dialect === DB.MYSQL && isMysqlLob(column.kind)
          ? `(${value})`
          : value;
      }
      return literal();
    case "other":
      if (!quoted && NUMBER.test(value)) return value;
      return literal();
    default:
      return literal();
  }
}
