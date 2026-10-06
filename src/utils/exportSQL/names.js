// Identifier quoting, string literals and constraint/index naming for the SQL
// generators. Everything here is pure so the generators can be unit-tested and
// run against real database engines outside the browser.

import { DB } from "../../data/constants";

// Longest identifier each engine accepts. PostgreSQL silently truncates longer
// names (which can make two names collide), the rest reject them. Oracle allows
// 128 bytes since 12.2; names we generate stay within 30 so the script also runs
// on older releases.
const MAX_IDENTIFIER_BYTES = {
  [DB.MYSQL]: 64,
  [DB.MARIADB]: 64,
  [DB.POSTGRES]: 63,
  [DB.SQLITE]: 128,
  [DB.MSSQL]: 128,
  [DB.ORACLESQL]: 128,
};
const MAX_GENERATED_NAME_BYTES = {
  ...MAX_IDENTIFIER_BYTES,
  [DB.ORACLESQL]: 30,
};

export function maxIdentifierBytes(dialect) {
  return MAX_IDENTIFIER_BYTES[dialect] ?? 63;
}

export function byteLength(text) {
  return new TextEncoder().encode(String(text)).length;
}

// Words that need quoting in at least one supported engine. Quoting a word that
// is not reserved is harmless, so the list errs on the side of including it.
const RESERVED_WORDS = new Set(
  `ACCESS ADD ALL ALTER ANALYZE AND ANY ARRAY AS ASC AUDIT AUTHORIZATION
  AUTO_INCREMENT BACKUP BEGIN BETWEEN BIGINT BINARY BLOB BOTH BREAK BROWSE BULK BY
  CALL CASCADE CASE CAST CHANGE CHAR CHARACTER CHECK CHECKPOINT CLOSE CLUSTER
  CLUSTERED COALESCE COLLATE COLUMN COLUMNS COMMENT COMMIT COMPRESS COMPUTE
  CONDITION CONNECT CONSTRAINT CONTAINS CONTINUE CONVERT CREATE CROSS CURRENT
  CURRENT_DATE CURRENT_ROLE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR
  DATABASE DATABASES DATE DAY DBCC DEALLOCATE DEC DECIMAL DECLARE DEFAULT DEFERRABLE
  DELETE DENY DESC DESCRIBE DISK DISTINCT DISTRIBUTED DIV DO DOUBLE DROP DUAL DUMP
  EACH ELSE ELSEIF END ENUM ERRLVL ESCAPE EXCEPT EXCLUSIVE EXEC EXECUTE EXISTS
  EXIT EXPLAIN EXTERNAL FALSE FETCH FILE FILLFACTOR FLOAT FOR FORCE FOREIGN FREETEXT
  FROM FULL FULLTEXT FUNCTION GET GOTO GRANT GROUP GROUPS HAVING HOLDLOCK HOUR
  IDENTIFIED IDENTITY IDENTITY_INSERT IF IGNORE ILIKE IMMEDIATE IN INCREMENT INDEX
  INITIAL INNER INOUT INSERT INT INTEGER INTERSECT INTERVAL INTO IS ISNULL
  ITERATE JOIN KEY KEYS KILL LEADING LEAVE LEFT LEVEL LIKE LIMIT LINENO LINES LOAD
  LOCALTIME LOCALTIMESTAMP LOCK LONG LOOP MATCH MAXEXTENTS MERGE MINUS MINUTE MODE
  MODIFY MONTH NATIONAL NATURAL NOAUDIT NOCHECK NOCOMPRESS NONCLUSTERED NOT NOTNULL
  NOWAIT NULL NULLIF NUMBER NUMERIC OF OFF OFFLINE OFFSET OFFSETS ON ONLINE ONLY
  OPEN OPTION OR ORDER OUT OUTER OVER OVERLAPS PARTITION PCTFREE PERCENT PIVOT PLACING
  PLAN PRECISION PRIMARY PRINT PRIOR PRIVILEGES PROC PROCEDURE PUBLIC RAISERROR
  RANGE RAW READ READTEXT REAL RECONFIGURE REFERENCES RENAME REPEAT REPLACE
  REPLICATION REQUIRE RESOURCE RESTORE RESTRICT RETURN RETURNING REVERT REVOKE
  RIGHT RLIKE ROLLBACK ROW ROWCOUNT ROWGUIDCOL ROWID ROWNUM ROWS RULE SAVE SCHEMA
  SCHEMAS SECOND SECURITYAUDIT SELECT SESSION SESSION_USER SET SETUSER SHARE SHOW
  SHUTDOWN SIMILAR SIZE SMALLINT SOME SPATIAL SQL START STATISTICS SUCCESSFUL
  SYMMETRIC SYNONYM SYSDATE SYSTEM_USER TABLE TABLESAMPLE TEXTSIZE THEN TIME TIMESTAMP
  TO TOP TRAILING TRAN TRANSACTION TRIGGER TRUE TRUNCATE TRY_CONVERT TSEQUAL UID
  UNION UNIQUE UNLOCK UNPIVOT UNSIGNED UPDATE UPDATETEXT USAGE USE USER USING
  VALIDATE VALUE VALUES VARCHAR VARCHAR2 VARIADIC VARYING VIEW WAITFOR WHEN WHENEVER
  WHERE WHILE WINDOW WITH WITHIN WRITETEXT XOR YEAR ZEROFILL ZONE`
    .split(/\s+/)
    .filter(Boolean),
);

export function isReservedWord(name) {
  return RESERVED_WORDS.has(String(name).toUpperCase());
}

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Whether a name can be written without quotes and still mean the same object.
 * PostgreSQL folds unquoted names to lower case, so mixed-case names keep their
 * quotes there. Oracle folds them to upper case, which is the usual convention,
 * so "when needed" accepts that folding.
 */
function needsQuotes(name, dialect) {
  if (!PLAIN_IDENTIFIER.test(name) || isReservedWord(name)) return true;
  if (dialect === DB.POSTGRES && name !== name.toLowerCase()) return true;
  return false;
}

export function quoteIdentifier(name, dialect, mode = "always") {
  const text = String(name);
  if (mode === "when_needed" && !needsQuotes(text, dialect)) return text;
  switch (dialect) {
    case DB.MYSQL:
    case DB.MARIADB:
      return `\`${text.replace(/`/g, "``")}\``;
    case DB.MSSQL:
      return `[${text.replace(/]/g, "]]")}]`;
    default:
      return `"${text.replace(/"/g, '""')}"`;
  }
}

/** A string literal that every engine reads back as exactly `value`. */
export function stringLiteral(value, dialect) {
  let text = String(value).replace(/\0/g, "");
  if (dialect === DB.MYSQL || dialect === DB.MARIADB) {
    // MySQL treats backslash as an escape character inside literals unless the
    // NO_BACKSLASH_ESCAPES mode is on (it is off by default).
    text = text.replace(/\\/g, "\\\\");
  }
  text = text.replace(/'/g, "''");
  return dialect === DB.MSSQL ? `N'${text}'` : `'${text}'`;
}

/** `-- ` comment lines; a comment can never close early or swallow SQL. */
export function lineComment(text, indent = "") {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => `${indent}-- ${line}`.trimEnd())
    .join("\n");
}

// Small deterministic hash (FNV-1a) to keep shortened names unique.
function shortHash(text) {
  let hash = 0x811c9dc5;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0").slice(-7);
}

function truncateBytes(text, maxBytes) {
  let result = "";
  for (const char of text) {
    if (byteLength(result + char) > maxBytes) break;
    result += char;
  }
  return result;
}

/** Shortens `name` to fit `maxBytes`, keeping it unique with a hash suffix. */
export function fitIdentifier(name, maxBytes) {
  if (byteLength(name) <= maxBytes) return name;
  const suffix = `_${shortHash(name)}`;
  return truncateBytes(name, maxBytes - suffix.length) + suffix;
}

/** Builds a readable identifier such as `fk_orders_customer_id`. */
export function generatedName(parts) {
  const name = parts
    .filter((part) => part !== undefined && part !== null && part !== "")
    .join("_")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[A-Za-z_]/.test(name) ? name : `n_${name}`;
}

export function applyPattern(pattern, values) {
  return String(pattern).replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? values[key] : match,
  );
}

/**
 * Hands out object names that are unique across the whole script. Engines
 * scope names differently (per table, per schema, shared with tables...), so
 * one script-wide namespace is the rule that is safe everywhere.
 */
export function createNameRegistry(dialect, takenNames = []) {
  const used = new Set(takenNames.map((name) => String(name).toLowerCase()));
  const generatedMax = MAX_GENERATED_NAME_BYTES[dialect] ?? 63;
  const declaredMax = maxIdentifierBytes(dialect);

  return {
    /**
     * Reserves `name`. Returns the name to use and whether it had to change.
     * `generated` names follow the stricter length used for names we invent.
     */
    claim(name, { generated = false } = {}) {
      const maxBytes = generated ? generatedMax : declaredMax;
      let candidate = fitIdentifier(String(name), maxBytes);
      let counter = 2;
      while (used.has(candidate.toLowerCase())) {
        candidate = fitIdentifier(`${name}_${counter}`, maxBytes);
        counter += 1;
      }
      used.add(candidate.toLowerCase());
      return { name: candidate, changed: candidate !== String(name) };
    },
    has(name) {
      return used.has(String(name).toLowerCase());
    },
  };
}

const EXPRESSION_TOKEN =
  /'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|[\p{L}_][\p{L}\p{N}_$#]*|\s+|./gsu;

/**
 * Quotes the bare words of a user-written expression (a CHECK) that name one
 * of `columns`, so it still finds them once the column names are quoted:
 * Oracle reads `total` as TOTAL and PostgreSQL reads `createdAt` as createdat.
 * Strings, quoted names, reserved words and function names are left alone.
 */
export function quoteColumnsInExpression(expression, columns, quote) {
  const byName = new Map(columns.map((name) => [name.toLowerCase(), name]));
  const tokens = String(expression).match(EXPRESSION_TOKEN) ?? [];
  return tokens
    .map((token, i) => {
      if (!/^[\p{L}_]/u.test(token) || isReservedWord(token)) return token;
      const column = byName.get(token.toLowerCase());
      if (!column) return token;
      const next = tokens.slice(i + 1).find((t) => !/^\s+$/.test(t));
      const previous = tokens
        .slice(0, i)
        .reverse()
        .find((t) => !/^\s+$/.test(t));
      if (next === "(" || previous === ".") return token;
      return quote(column);
    })
    .join("");
}
