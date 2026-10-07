// Gets a SQL script ready for the parsers. Real scripts (our own exports,
// mysqldump, pg_dump...) carry statements that do not describe the schema
// (SET, PRAGMA, transactions, GO batches, guards) and syntax some parser
// grammars do not know. This splits the script into statements without
// breaking strings, quoted names or comments, keeps the ones that define
// tables, rewrites what a parser cannot read, and sets aside what it would
// lose (comments, Oracle indexes, SQL Server foreign key actions) so
// applyPrepared() can put it back on the imported diagram.

import { nanoid } from "nanoid";
import { Cardinality, DB } from "../../data/constants.js";

// SQLite has no COMMENT: its "-- ..." lines are the comments, kept between
// these marks (characters SQL never contains) until prepareSQL() reads them.
const OPEN = "\u0000";
const CLOSE = "\u0001";
const MARKED = new RegExp(`${OPEN}([^${CLOSE}]*)${CLOSE}`, "g");

/** Splits on ";" (and SQL Server "GO", Oracle "/" lines) outside quotes. */
export function splitStatements(sql, database) {
  const statements = [];
  let current = "";
  let i = 0;
  const backslashEscapes = database === DB.MYSQL || database === DB.MARIADB;
  const push = () => {
    if (current.trim()) statements.push(current.trim());
    current = "";
  };
  while (i < sql.length) {
    const ch = sql[i];
    const rest = sql.slice(i);
    // Comments become a space.
    if (rest.startsWith("--") || (backslashEscapes && ch === "#")) {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      current +=
        database === DB.SQLITE
          ? `${OPEN}${sql
              .slice(i + 2, stop)
              .split(OPEN)
              .join("")
              .split(CLOSE)
              .join("")}${CLOSE}`
          : " ";
      i = stop;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      current += " ";
      continue;
    }
    // Quoted text and names are copied as they are.
    const closing = { "'": "'", '"': '"', "`": "`", "[": "]" }[ch];
    if (closing && (ch !== "[" || database === DB.MSSQL)) {
      let j = i + 1;
      while (j < sql.length) {
        if (backslashEscapes && closing === "'" && sql[j] === "\\") {
          j += 2;
          continue;
        }
        if (sql[j] === closing) {
          if (sql[j + 1] === closing) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      current += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const dollar = ch === "$" && /^\$[A-Za-z_]*\$/.exec(rest);
    if (dollar && database === DB.POSTGRES) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === ";") {
      // pg_dump: the rows of COPY ... FROM stdin follow, up to a "\." line.
      const copy = /^\s*COPY\b[\s\S]*\bFROM\s+stdin$/i.test(current.trim());
      push();
      i++;
      if (copy && database === DB.POSTGRES) {
        const end = sql.indexOf("\n\\.", i);
        i = end === -1 ? sql.length : end + 3;
        statements.pop();
      }
      continue;
    }
    // A line with only GO (SQL Server) or / (Oracle) ends a batch.
    const atLineStart = current === "" || /\n[ \t]*$/.test(current);
    // psql meta-commands (pg_dump writes \restrict and \unrestrict) take
    // the rest of their line.
    if (atLineStart && ch === "\\" && database === DB.POSTGRES) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (atLineStart) {
      const line = /^[ \t]*(GO|\/)[ \t]*(\r?\n|$)/i.exec(rest);
      if (line) {
        push();
        i += line[0].length;
        continue;
      }
    }
    current += ch;
    i++;
  }
  push();
  return statements;
}

const SKIP = new RegExp(
  "^(" +
    [
      "PRAGMA",
      "SET",
      "BEGIN",
      "COMMIT",
      "ROLLBACK",
      "START\\s+TRANSACTION",
      "SAVEPOINT",
      "RELEASE",
      "DECLARE",
      "EXEC",
      "EXECUTE",
      "DO",
      "USE",
      "LOCK",
      "UNLOCK",
      "DROP",
      "GRANT",
      "REVOKE",
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "ANALYZE",
      "VACUUM",
      "CREATE\\s+(SCHEMA|DATABASE|EXTENSION|SEQUENCE|VIEW|OR\\s+REPLACE|FUNCTION|PROCEDURE|TRIGGER)",
      "ALTER\\s+(SEQUENCE|SCHEMA|DATABASE|EXTENSION|TYPE)",
      "SELECT\\s+pg_catalog",
      // Comments on anything but tables and columns.
      "COMMENT",
    ].join("|") +
    ")\\b",
  "i",
);

const NAME = String.raw`(?:"(?:[^"]|"")+"|\[[^\]]+\]|\x60[^\x60]+\x60|[A-Za-z_][\w$#]*)`;
const unquote = (name) => {
  const text = name.trim();
  if (/^".*"$/s.test(text)) return text.slice(1, -1).replace(/""/g, '"');
  if (/^\[.*\]$/s.test(text) || /^`.*`$/s.test(text)) return text.slice(1, -1);
  return text;
};
// The last part of a possibly qualified name.
const lastPart = (qualified) => {
  const parts = qualified.match(new RegExp(NAME, "g")) ?? [qualified];
  return unquote(parts[parts.length - 1]);
};
const unquoteLiteral = (text) => {
  const body = /^N?'([\s\S]*)'$/.exec(text.trim());
  return body ? body[1].replace(/''/g, "'") : null;
};

// "((0))" -> "0": SQL Server keeps defaults and checks in parentheses.
function unwrapParentheses(text) {
  let value = text.trim();
  while (
    value.startsWith("(") &&
    parenthesized(value, 0)?.length === value.length - 2
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

// Applies `change` to the parts of a statement outside '...' literals.
const outsideStrings = (statement, change, backslashEscapes = false) =>
  statement
    .split(
      backslashEscapes ? /('(?:[^'\\]|''|\\[\s\S])*')/ : /('(?:[^']|'')*')/,
    )
    .map((part, i) => (i % 2 ? part : change(part)))
    .join("");

// SQL Server keeps comments as extended properties.
function extendedPropertyComment(statement) {
  if (!/sp_addextendedproperty/i.test(statement)) return null;
  const arg = (name) =>
    new RegExp(`@${name}\\s*=\\s*(N?'(?:[^']|'')*')`, "i").exec(statement)?.[1];
  if (unquoteLiteral(arg("name") ?? "") !== "MS_Description") return null;
  const table = unquoteLiteral(arg("level1name") ?? "");
  if (!table) return null;
  const column = unquoteLiteral(arg("level2name") ?? "") || undefined;
  return { table, column, text: unquoteLiteral(arg("value") ?? "") ?? "" };
}

const QUALIFIED = `${NAME}(?:\\s*\\.\\s*${NAME})*`;
const ACTION = String.raw`NO\s+ACTION|CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT`;
const FOREIGN_KEY = `(?:CONSTRAINT\\s+${NAME}\\s+)?FOREIGN\\s+KEY\\s*\\([^)]*\\)\\s*REFERENCES\\s+${QUALIFIED}\\s*\\([^)]*\\)(?:\\s+ON\\s+(?:DELETE|UPDATE)\\s+(?:${ACTION}))*`;

// A foreign key definition as written, for applyPrepared().
function foreignKey(definition, table) {
  const match = new RegExp(
    `^(?:CONSTRAINT\\s+(${NAME})\\s+)?FOREIGN\\s+KEY\\s*\\(([^)]*)\\)\\s*REFERENCES\\s+(${QUALIFIED})\\s*\\(([^)]*)\\)([\\s\\S]*)$`,
    "i",
  ).exec(definition.trim());
  if (!match) return null;
  const columns = (list) => list.split(",").map((name) => unquote(name.trim()));
  const key = {
    name: match[1] ? unquote(match[1]) : null,
    table,
    columns: columns(match[2]),
    references: lastPart(match[3]),
    referencedColumns: columns(match[4]),
  };
  for (const [, which, action] of match[5].matchAll(
    new RegExp(`ON\\s+(DELETE|UPDATE)\\s+(${ACTION})`, "gi"),
  )) {
    const value = ACTIONS[action.toUpperCase().replace(/\s+/g, " ")];
    if (which.toUpperCase() === "DELETE") key.deleteConstraint = value;
    else key.updateConstraint = value;
  }
  return key;
}

const ACTIONS = {
  "NO ACTION": "No action",
  CASCADE: "Cascade",
  "SET NULL": "Set null",
  "SET DEFAULT": "Set default",
  RESTRICT: "Restrict",
};

// Statements wrapped so a script can run twice: PostgreSQL DO blocks, MySQL
// prepared statements, Oracle EXECUTE IMMEDIATE blocks, SQL Server IF guards.
function unwrap(statement, database) {
  if (database === DB.POSTGRES) {
    const block =
      /^DO\s+(\$[A-Za-z_]*\$)\s*BEGIN\s+([\s\S]*?);?\s*EXCEPTION\b[\s\S]*\1$/i.exec(
        statement,
      );
    if (block) return [block[2]];
  }
  if (database === DB.MYSQL || database === DB.MARIADB) {
    const prepared =
      /^SET\s+@\w+\s*=\s*IF\s*\([\s\S]*?,\s*('(?:[^'\\]|''|\\[\s\S])*')\s*,\s*'DO 0'\s*\)$/i.exec(
        statement,
      );
    if (prepared) {
      return [
        prepared[1]
          .slice(1, -1)
          .replace(/''/g, "'")
          .replace(/\\([\s\S])/g, "$1"),
      ];
    }
  }
  if (database === DB.ORACLESQL) {
    const block = /^BEGIN\s+EXECUTE\s+IMMEDIATE\s+('(?:[^']|'')*')/i.exec(
      statement,
    );
    if (block) return [block[1].slice(1, -1).replace(/''/g, "'")];
    // The rest of such a block.
    if (/^(EXCEPTION|END|RAISE)\b/i.test(statement)) return [];
  }
  if (database === DB.MSSQL) {
    const guarded =
      /^IF\b[\s\S]*?\b((CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)|ALTER\s+TABLE)\b[\s\S]*)$/i.exec(
        statement,
      );
    if (guarded) return [guarded[1]];
    // Other guarded statements (IF ... DROP TABLE) define nothing.
    if (/^IF\b/i.test(statement)) return [];
  }
  return [statement];
}

// Quoted names a parser grammar cannot read ("a""b" for PostgreSQL and
// SQLite, [a]]b] for SQL Server, any quoted name for Oracle) are swapped
// for placeholders; applyPrepared() puts the real names back.
const PLACEHOLDER = /qz(\d+)zq/gi;
function protectNames(statement, database, names) {
  const quotes = {
    [DB.POSTGRES]: ['"'],
    [DB.SQLITE]: ['"'],
    [DB.MSSQL]: ['"', "["],
    [DB.ORACLESQL]: ['"'],
  }[database];
  if (!quotes) return statement;
  const needs = (open, text) => {
    if (database === DB.ORACLESQL) return true;
    if (open === "[") return /\]\]|\[/.test(text);
    return text.includes('""');
  };
  let out = "";
  let i = 0;
  while (i < statement.length) {
    const ch = statement[i];
    if (ch === "'") {
      let j = i + 1;
      while (j < statement.length) {
        if (statement[j] === "'" && statement[j + 1] === "'") j += 2;
        else if (statement[j] === "'") break;
        else j++;
      }
      out += statement.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (quotes.includes(ch)) {
      const close = ch === "[" ? "]" : ch;
      let j = i + 1;
      while (j < statement.length) {
        if (statement[j] === close && statement[j + 1] === close) j += 2;
        else if (statement[j] === close) break;
        else j++;
      }
      const text = statement.slice(i + 1, j);
      if (needs(ch, text)) {
        const name = text.split(close + close).join(close);
        if (!names.includes(name)) names.push(name);
        out += `qz${names.indexOf(name)}zq`;
      } else {
        out += statement.slice(i, j + 1);
      }
      i = j + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// The comment lines right above CREATE TABLE describe the table, the ones
// above or after a column describe the column. Returns the statement
// without comments.
function readLineComments(statement, extras) {
  const text = (body) => body.replace(/^ /, "").trimEnd();
  const code = statement.replace(MARKED, " ").trim();
  const created = new RegExp(
    `^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED})`,
    "i",
  ).exec(code);
  if (!created) return code;
  const table = lastPart(created[1]);
  // Leading comments: the last group with no blank line before the code.
  const lead = new RegExp(`^(?:\\s*${OPEN}[^${CLOSE}]*${CLOSE})*`).exec(
    statement,
  )[0];
  const groups = lead.split(/\n[ \t]*\n/);
  const last = groups[groups.length - 1];
  const gap = statement.slice(lead.length).match(/^\s*/)[0];
  if (!/\n[ \t]*\n/.test(gap)) {
    const lines = [...last.matchAll(MARKED)].map((m) => text(m[1]));
    if (lines.length) extras.comments.push({ table, text: lines.join("\n") });
  }
  let pending = [];
  for (const line of statement.slice(lead.length).split("\n")) {
    const notes = [...line.matchAll(MARKED)].map((m) => text(m[1]));
    const rest = line.replace(MARKED, "").trim();
    if (!rest) {
      pending.push(...notes);
      continue;
    }
    const column =
      !/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|CREATE|\))/i.test(rest) &&
      new RegExp(`^${NAME}`).exec(rest);
    const lines = [...pending, ...notes];
    if (column && lines.length) {
      extras.comments.push({
        table,
        column: unquote(column[0]),
        text: lines.join("\n"),
      });
    }
    pending = [];
  }
  return code;
}

export function prepareSQL(sql, database) {
  const extras = {
    database,
    names: [],
    comments: [],
    indexes: [],
    foreignKeys: [],
    defaults: [],
    checks: [],
    increments: [],
    keys: [],
  };
  const kept = [];
  const statements = splitStatements(String(sql ?? ""), database).flatMap(
    (statement) => unwrap(statement, database),
  );
  for (let statement of statements) {
    statement = statement.trim();
    if (!statement) continue;
    if (database === DB.SQLITE) {
      statement = readLineComments(statement, extras);
      if (!statement) continue;
    }
    statement = protectNames(statement, database, extras.names);

    const property = extendedPropertyComment(statement);
    if (property) {
      extras.comments.push(property);
      continue;
    }

    const comment = new RegExp(
      `^COMMENT\\s+ON\\s+(TABLE|COLUMN)\\s+(${NAME}(?:\\s*\\.\\s*${NAME})*)\\s+IS\\s+(NULL|N?'[\\s\\S]*')$`,
      "i",
    ).exec(statement);
    if (comment) {
      const names = comment[2].match(new RegExp(NAME, "g")).map(unquote);
      const text = unquoteLiteral(comment[3]) ?? "";
      if (comment[1].toUpperCase() === "TABLE") {
        extras.comments.push({ table: names[names.length - 1], text });
      } else {
        extras.comments.push({
          table: names[names.length - 2],
          column: names[names.length - 1],
          text,
        });
      }
      continue;
    }
    if (SKIP.test(statement)) continue;
    // sqlite3 .schema lists its own bookkeeping tables too.
    if (
      /^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?["`[]?sqlite_/i.test(statement)
    ) {
      continue;
    }

    // Keys added after the table (pg_dump writes all of them this way).
    const key = new RegExp(
      `^ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(${QUALIFIED})\\s+ADD\\s+(?:CONSTRAINT\\s+(${NAME})\\s+)?(PRIMARY\\s+KEY|UNIQUE)\\s*\\(([^)]*)\\)`,
      "i",
    ).exec(statement);
    if (key) {
      extras.keys.push({
        table: lastPart(key[1]),
        name: key[2] ? unquote(key[2]) : null,
        primary: /^PRIMARY/i.test(key[3]),
        columns: key[4].split(",").map((name) => unquote(name.trim())),
      });
      continue;
    }

    if (database === DB.MYSQL || database === DB.MARIADB) {
      // mysqldump writes DEFAULT (_utf8mb4'text'): the character set
      // introducer is not in the grammar. Integer display widths (int(11))
      // mean nothing, and tinyint(1) is how BOOLEAN comes back.
      statement = outsideStrings(
        statement,
        (part) =>
          part
            .replace(/(?<=[\w`]\s+)tinyint\s*\(\s*1\s*\)/gi, "BOOLEAN")
            .replace(
              /(?<=[\w`]\s+)(tinyint|smallint|mediumint|int|integer|bigint)\s*\(\s*\d+\s*\)/gi,
              "$1",
            )
            .replace(
              /(^|[^\w$])_(?:utf8mb4|utf8mb3|utf8|latin1|binary|ascii|ucs2|utf16|utf32)\s*$/i,
              "$1",
            ),
        true,
      );
    }

    if (database === DB.MARIADB) {
      // The MariaDB grammar does not read ALTER TABLE ... ADD FOREIGN KEY.
      const added = new RegExp(
        `^ALTER\\s+TABLE\\s+(${QUALIFIED})\\s+ADD\\s+(${FOREIGN_KEY})$`,
        "i",
      ).exec(statement);
      if (added) {
        const key = foreignKey(added[2], lastPart(added[1]));
        if (key) extras.foreignKeys.push(key);
        continue;
      }
    }

    if (database === DB.ORACLESQL || database === DB.MSSQL) {
      // Neither grammar reads every CREATE INDEX (Oracle: none at all; SQL
      // Server: not with CLUSTERED, WITH (...) or a filegroup).
      const index = new RegExp(
        `^CREATE\\s+(UNIQUE\\s+)?(?:(?:NON)?CLUSTERED\\s+)?INDEX\\s+(${QUALIFIED})\\s+ON\\s+(${QUALIFIED})\\s*\\(([^)]*)\\)`,
        "i",
      ).exec(statement);
      if (index) {
        extras.indexes.push({
          name: lastPart(index[2]),
          table: lastPart(index[3]),
          unique: Boolean(index[1]),
          fields: index[4]
            .split(",")
            .map((part) => unquote(part.trim().replace(/\s+(ASC|DESC)$/i, ""))),
        });
        continue;
      }
    }

    if (database === DB.ORACLESQL) {
      statement = outsideStrings(statement, (part) =>
        part.replace(/"([A-Za-z][\w$#]*)"/g, "$1"),
      );
      // Nor DEFAULT expressions, CHECK constraints or foreign keys added
      // with ALTER TABLE: they are set aside too.
      const added = new RegExp(
        `^ALTER\\s+TABLE\\s+(${QUALIFIED})\\s+ADD\\s+(${FOREIGN_KEY})$`,
        "i",
      ).exec(statement);
      if (added) {
        const key = foreignKey(added[2], lastPart(added[1]));
        if (key) extras.foreignKeys.push(key);
        continue;
      }
      // What DBMS_METADATA.GET_DDL (and SQL Developer) add: storage and
      // index attributes, constraint states and identity options.
      statement = outsideStrings(statement, (part) =>
        part
          .replace(
            /\s+USING\s+INDEX\b(?:\s+(?:PCTFREE|PCTUSED|INITRANS|MAXTRANS)\s+\d+|\s+TABLESPACE\s+\S+|\s+STORAGE\s*\([^)]*\)|\s+(?:NO)?LOGGING|\s+(?:NO)?COMPRESS|\s+COMPUTE\s+STATISTICS)*/gi,
            "",
          )
          .replace(/\s+(?:ENABLE|DISABLE)(?:\s+(?:NO)?VALIDATE)?\b/gi, "")
          .replace(
            /\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT(?:\s+ON\s+NULL)?)\s+AS\s+IDENTITY(?:\s*\([^)]*\)|(?:\s+(?:MINVALUE|MAXVALUE|INCREMENT\s+BY|START\s+WITH|CACHE)\s+-?\d+|\s+(?:NOORDER|ORDER|NOCYCLE|CYCLE|NOKEEP|KEEP|NOSCALE|SCALE|NOEXTEND|EXTEND|NOCACHE|NOMINVALUE|NOMAXVALUE))*)/gi,
            "GENERATED BY DEFAULT AS IDENTITY",
          )
          .replace(/\bNUMBER\s*\(\s*\*\s*,\s*0\s*\)/gi, "INTEGER")
          .replace(/\bNUMBER\s*\(\s*\*\s*,/gi, "NUMBER(38,")
          .replace(
            /\b(TIMESTAMP|FLOAT|VARCHAR2|NVARCHAR2|CHAR|RAW)\s+\(/gi,
            "$1(",
          ),
      );
      statement = setAsideColumnParts(statement, extras);
    }

    if (database === DB.MSSQL) {
      // What SQL Server Management Studio adds to its scripts: re-enabling
      // constraints, defaults and checks added after the table, index
      // options and filegroups.
      if (
        /^ALTER\s+TABLE\b[\s\S]*?\b(NO)?CHECK\s+CONSTRAINT\s+(ALL\b|\S+\s*$)/i.test(
          statement,
        )
      ) {
        continue;
      }
      const addedDefault = new RegExp(
        `^ALTER\\s+TABLE\\s+(${QUALIFIED})\\s+ADD\\s+(?:CONSTRAINT\\s+${NAME}\\s+)?DEFAULT\\s+([\\s\\S]*?)\\s+FOR\\s+(${NAME})$`,
        "i",
      ).exec(statement);
      if (addedDefault) {
        extras.defaults.push({
          table: lastPart(addedDefault[1]),
          column: unquote(addedDefault[3]),
          value: unwrapParentheses(addedDefault[2]),
        });
        continue;
      }
      const addedCheck = new RegExp(
        `^ALTER\\s+TABLE\\s+(${QUALIFIED})\\s+(?:WITH\\s+(?:NO)?CHECK\\s+)?ADD\\s+(?:CONSTRAINT\\s+${NAME}\\s+)?CHECK\\s*\\(`,
        "i",
      ).exec(statement);
      if (addedCheck) {
        const expr = parenthesized(statement, addedCheck[0].length - 1);
        if (expr !== null) {
          extras.checks.push({
            table: lastPart(addedCheck[1]),
            expr: unwrapParentheses(
              outsideStrings(expr, (part) =>
                part.replace(/\[([A-Za-z_][\w$#@]*)\]/g, "$1"),
              ),
            ),
          });
        }
        continue;
      }
      if (/^CREATE\s+TABLE\b/i.test(statement)) {
        statement = outsideStrings(statement, (part) =>
          part
            .replace(/\bWITH\s*\(\s*[A-Z_]+\s*=[^()]*\)/gi, "")
            .replace(
              /\b(?:TEXTIMAGE_ON|ON)\s+(?:\[[^\]]+\]|PRIMARY\b)(?!\s*\.)/gi,
              "",
            )
            .replace(/\b(PRIMARY\s+KEY|UNIQUE)\s+(?:NON)?CLUSTERED\b/gi, "$1"),
        );
      }
      // Named defaults and foreign keys are beyond the grammar: the names go,
      // and foreign keys are set aside and added after the import.
      statement = statement.replace(
        new RegExp(`\\bCONSTRAINT\\s+${NAME}\\s+(?=DEFAULT\\b)`, "gi"),
        "",
      );
      const added = new RegExp(
        `^ALTER\\s+TABLE\\s+(${QUALIFIED})\\s+(?:WITH\\s+(?:NO)?CHECK\\s+)?ADD\\s+(${FOREIGN_KEY})$`,
        "i",
      ).exec(statement);
      if (added) {
        const key = foreignKey(added[2], lastPart(added[1]));
        if (key) extras.foreignKeys.push(key);
        continue;
      }
      const created = new RegExp(
        `^CREATE\\s+TABLE\\s+(${QUALIFIED})`,
        "i",
      ).exec(statement);
      if (created) {
        statement = statement.replace(
          new RegExp(`,\\s*(${FOREIGN_KEY})`, "gi"),
          (match, definition) => {
            const key = foreignKey(definition, lastPart(created[1]));
            if (key) extras.foreignKeys.push(key);
            return "";
          },
        );
      }
    }

    if (database === DB.POSTGRES) {
      statement = statement.replace(
        /^ALTER\s+TABLE\s+ONLY\s+/i,
        "ALTER TABLE ",
      );
      // The type names pg_dump writes, in the forms the grammar reads right
      // (it takes character(3) for VARCHAR and int4 for INT(4)).
      statement = outsideStrings(statement, (part) =>
        part
          .replace(/\bcharacter\s+varying\b/gi, "varchar")
          .replace(/\bbit\s+varying\b/gi, "varbit")
          .replace(
            /\b(timestamp|time)\s*(\(\s*\d+\s*\))?\s+(with|without)\s+time\s+zone\b/gi,
            (match, type, precision, zone) =>
              `${type}${zone.toLowerCase() === "with" ? "tz" : ""}${precision ?? ""}`,
          )
          .replace(
            /(?<=[\w")\]]\s+)(character|bpchar|int2|int4|int8|float4|float8|bool)\b/gi,
            (match, type) =>
              ({
                character: "char",
                bpchar: "char",
                int2: "smallint",
                int4: "integer",
                int8: "bigint",
                float4: "real",
                float8: "double precision",
                bool: "boolean",
              })[type.toLowerCase()],
          ),
      );
      // pg_dump gives serial and identity columns their sequence this way.
      const serial = new RegExp(
        `^ALTER\\s+TABLE\\s+(${QUALIFIED})\\s+ALTER\\s+COLUMN\\s+(${NAME})\\s+(?:SET\\s+DEFAULT\\s+nextval\\s*\\(|ADD\\s+GENERATED\\b)`,
        "i",
      ).exec(statement);
      if (serial) {
        extras.increments.push({
          table: lastPart(serial[1]),
          column: unquote(serial[2]),
        });
        continue;
      }
      // OWNER TO, ALTER COLUMN ... SET STATISTICS, ENABLE ROW LEVEL
      // SECURITY...: only what ALTER TABLE adds describes the schema.
      if (
        /^ALTER\s+TABLE\b/i.test(statement) &&
        !new RegExp(`^ALTER\\s+TABLE\\s+${QUALIFIED}\\s+ADD\\b`, "i").test(
          statement,
        )
      ) {
        continue;
      }
      // Both kinds of identity mean an auto-incremented column here.
      statement = statement.replace(
        /\bGENERATED\s+ALWAYS\s+AS\s+IDENTITY\b/gi,
        "GENERATED BY DEFAULT AS IDENTITY",
      );
    }
    kept.push(statement);
  }
  return {
    sql: kept.length ? `${kept.join(";\n\n")};\n` : "",
    extras,
  };
}

// Positions of `pattern` outside quotes and parentheses (depth 0 of `text`);
// a pattern starting with a word only matches at the start of a word.
function topLevel(text, pattern) {
  const word = /^[A-Za-z(]/.test(pattern.source);
  const found = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      const end = text.indexOf(ch, i + 1);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && (!word || i === 0 || /[\s,(]/.test(text[i - 1]))) {
      const match = pattern.exec(text.slice(i));
      if (match && match.index === 0) found.push({ index: i, match });
    }
  }
  return found;
}

function splitTopLevel(text) {
  const parts = [];
  let start = 0;
  for (const { index } of topLevel(text, /,/y)) {
    parts.push(text.slice(start, index));
    start = index + 1;
  }
  parts.push(text.slice(start));
  return parts;
}

// The text in parentheses that starts at `open`.
function parenthesized(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "'") {
      const end = text.indexOf("'", i + 1);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (text[i] === "(") depth++;
    if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

const COLUMN_KEYWORDS =
  /(NOT\s+NULL|NULL|CONSTRAINT|CHECK|PRIMARY|UNIQUE|REFERENCES|GENERATED|ENABLE|DISABLE)\b/iy;

// Takes DEFAULT expressions, CHECK constraints and foreign keys out of a
// CREATE TABLE (Oracle) and records them in `extras`.
function setAsideColumnParts(statement, extras) {
  const head = new RegExp(
    `^CREATE\\s+TABLE\\s+(${QUALIFIED})\\s*\\(`,
    "i",
  ).exec(statement);
  if (!head) return statement;
  const table = lastPart(head[1]);
  const open = head[0].length - 1;
  const body = parenthesized(statement, open);
  if (body === null) return statement;
  const kept = [];
  for (const part of splitTopLevel(body)) {
    const text = part.trim();
    const check = new RegExp(
      `^(?:CONSTRAINT\\s+${NAME}\\s+)?CHECK\\s*\\(`,
      "i",
    ).exec(text);
    if (check) {
      const expr = parenthesized(text, check[0].length - 1);
      if (expr !== null) extras.checks.push({ table, expr });
      continue;
    }
    if (
      new RegExp(`^(?:CONSTRAINT\\s+${NAME}\\s+)?FOREIGN\\s+KEY\\b`, "i").test(
        text,
      )
    ) {
      const key = foreignKey(text, table);
      if (key) extras.foreignKeys.push(key);
      continue;
    }
    if (/^(CONSTRAINT|PRIMARY|UNIQUE)\b/i.test(text)) {
      kept.push(text);
      continue;
    }
    // A column: name, type, then its attributes.
    const name = new RegExp(`^${NAME}`).exec(text);
    if (!name) {
      kept.push(text);
      continue;
    }
    const column = unquote(name[0]);
    let rest = text;
    const inlineCheck = topLevel(rest, /CHECK\s*\(/iy)[0];
    if (inlineCheck) {
      const open = inlineCheck.index + inlineCheck.match[0].length - 1;
      const expr = parenthesized(rest, open);
      if (expr !== null) {
        extras.checks.push({ table, column, expr });
        rest = `${rest.slice(0, inlineCheck.index)}${rest.slice(open + expr.length + 2)}`;
      }
    }
    // Not the DEFAULT of GENERATED BY DEFAULT AS IDENTITY.
    const defaultAt = topLevel(rest, /DEFAULT\b/iy).find(
      ({ index }) => !/\bBY\s+$/i.test(rest.slice(0, index)),
    );
    if (defaultAt) {
      const start = defaultAt.index + "DEFAULT".length;
      // DEFAULT NULL: the value is the keyword the search would stop at.
      const isNull = /^\s*NULL\b/i.exec(rest.slice(start));
      const next = isNull
        ? { index: isNull[0].length }
        : topLevel(rest.slice(start), COLUMN_KEYWORDS)[0];
      const end = next ? start + next.index : rest.length;
      extras.defaults.push({
        table,
        column,
        value: rest.slice(start, end).trim(),
      });
      rest = `${rest.slice(0, defaultAt.index)}${rest.slice(end)}`;
    }
    kept.push(rest.trim());
  }
  // Table properties after the body (SEGMENT CREATION, TABLESPACE, LOB
  // storage...) do not describe the schema.
  return `${statement.slice(0, open)}(\n  ${kept.join(",\n  ")}\n)`;
}

/** Puts back on an imported diagram what prepareSQL() set aside. */
export function applyPrepared(diagram, prepared) {
  if (!prepared) return diagram;
  const extras = restoreNames(diagram, prepared);
  const findTable = (name) =>
    diagram.tables.find((t) => t.name === name) ??
    diagram.tables.find(
      (t) => String(t.name).toLowerCase() === String(name).toLowerCase(),
    );
  const findField = (table, name) =>
    table.fields.find((f) => f.name === name) ??
    table.fields.find(
      (f) => String(f.name).toLowerCase() === String(name).toLowerCase(),
    );
  for (const entry of extras.comments ?? []) {
    const table = findTable(entry.table);
    if (!table) continue;
    if (!entry.column) {
      table.comment = entry.text;
      continue;
    }
    const field = findField(table, entry.column);
    if (field) field.comment = entry.text;
  }
  for (const entry of extras.indexes ?? []) {
    const table = findTable(entry.table);
    if (!table) continue;
    const fields = entry.fields.map((name) => findField(table, name)?.name);
    if (fields.some((name) => !name)) continue;
    table.indices = table.indices ?? [];
    table.indices.push({
      id: table.indices.length,
      name: entry.name,
      unique: entry.unique,
      fields,
    });
  }
  for (const entry of extras.keys ?? []) {
    const table = findTable(entry.table);
    if (!table) continue;
    const fields = entry.columns.map((name) => findField(table, name));
    if (fields.some((field) => !field)) continue;
    if (entry.primary) {
      for (const field of fields) {
        field.primary = true;
        field.notNull = true;
      }
    } else if (fields.length === 1 && !entry.name) {
      fields[0].unique = true;
    } else {
      table.uniqueConstraints = table.uniqueConstraints ?? [];
      table.uniqueConstraints.push({
        id: table.uniqueConstraints.length,
        name:
          entry.name ??
          `${table.name}_unique_${table.uniqueConstraints.length}`,
        fields: fields.map((field) => field.name),
      });
    }
  }
  for (const entry of extras.increments ?? []) {
    const table = findTable(entry.table);
    const field = table && findField(table, entry.column);
    if (field) field.increment = true;
  }
  for (const entry of extras.defaults ?? []) {
    const table = findTable(entry.table);
    const field = table && findField(table, entry.column);
    if (!field) continue;
    // DATE '2024-01-31' and TIMESTAMP '...' are typed literals of the text.
    const literal = /^(?:DATE\s+|TIMESTAMP\s+|TIME\s+|N)?'([\s\S]*)'$/i.exec(
      entry.value,
    );
    field.default = literal ? literal[1].replace(/''/g, "'") : entry.value;
  }
  for (const entry of extras.checks ?? []) {
    const table = findTable(entry.table);
    if (!table) continue;
    // The check belongs to its column, or to the first column it names.
    const named = (entry.expr.match(/"[^"]+"|[A-Za-z_][\w$#]*/g) ?? []).map(
      unquote,
    );
    const field =
      (entry.column && findField(table, entry.column)) ??
      named.map((name) => findField(table, name)).find(Boolean);
    if (!field) continue;
    field.check = field.check
      ? `(${field.check}) AND (${entry.expr})`
      : entry.expr;
  }
  for (const key of extras.foreignKeys ?? []) {
    const table = findTable(key.table);
    const parent = findTable(key.references);
    if (!table || !parent) continue;
    const pairs = key.columns.map((name, i) => ({
      start: findField(table, name),
      end: findField(parent, key.referencedColumns[i]),
    }));
    if (!pairs.length || pairs.some((p) => !p.start || !p.end)) continue;
    diagram.relationships = diagram.relationships ?? [];
    diagram.relationships.push({
      id: nanoid(),
      name:
        key.name ??
        `fk_${table.name}_${pairs.map((p) => p.start.name).join("_")}`,
      startTableId: table.id,
      startFieldId: pairs[0].start.id,
      endTableId: parent.id,
      endFieldId: pairs[0].end.id,
      fields: pairs.map((p) => ({
        startFieldId: p.start.id,
        endFieldId: p.end.id,
      })),
      updateConstraint: key.updateConstraint ?? "No action",
      deleteConstraint: key.deleteConstraint ?? "No action",
      cardinality:
        pairs.length === 1 && pairs[0].start.unique
          ? Cardinality.ONE_TO_ONE
          : Cardinality.MANY_TO_ONE,
    });
  }
  // MySQL and MariaDB give each foreign key an index named after it, and
  // their dumps list it; the export's foreign key brings it back.
  if (extras.database === DB.MYSQL || extras.database === DB.MARIADB) {
    for (const relationship of diagram.relationships ?? []) {
      const table = diagram.tables.find(
        (t) => t.id === relationship.startTableId,
      );
      if (!table?.indices?.length) continue;
      const columns = (
        relationship.fields?.length
          ? relationship.fields.map((pair) => pair.startFieldId)
          : [relationship.startFieldId]
      ).map((id) => table.fields.find((f) => f.id === id)?.name);
      table.indices = table.indices
        .filter(
          (index) =>
            index.unique ||
            index.name !== relationship.name ||
            index.fields.join("\u0000") !== columns.join("\u0000"),
        )
        .map((index, i) => ({ ...index, id: i }));
    }
  }
  // DEFAULT NULL is what a column has without a default (mysqldump writes
  // it on every nullable column).
  for (const table of diagram.tables ?? []) {
    for (const field of table.fields ?? []) {
      if (/^null$/i.test(String(field.default ?? "").trim())) {
        field.default = "";
      }
    }
  }
  return diagram;
}

// Puts the names protectNames() swapped back, in the diagram and in what was
// set aside; returns the restored extras.
function restoreNames(diagram, extras) {
  const names = extras.names ?? [];
  if (!names.length) return extras;
  const restore = (value) =>
    typeof value === "string"
      ? value.replace(PLACEHOLDER, (match, n) => names[Number(n)] ?? match)
      : value;
  for (const table of diagram.tables ?? []) {
    table.name = restore(table.name);
    for (const field of table.fields ?? []) {
      field.name = restore(field.name);
      field.type = restore(field.type);
      field.check = restore(field.check);
      field.default = restore(field.default);
    }
    for (const index of table.indices ?? []) {
      index.name = restore(index.name);
      index.fields = (index.fields ?? []).map(restore);
    }
    for (const unique of table.uniqueConstraints ?? []) {
      unique.name = restore(unique.name);
      unique.fields = (unique.fields ?? []).map(restore);
    }
  }
  for (const relationship of diagram.relationships ?? []) {
    relationship.name = restore(relationship.name);
  }
  for (const list of [diagram.enums, diagram.types]) {
    for (const item of list ?? []) item.name = restore(item.name);
  }
  const deep = (value) =>
    Array.isArray(value)
      ? value.map(deep)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([key, inner]) => [key, deep(inner)]),
          )
        : restore(value);
  return deep({ ...extras, names: [] });
}

/**
 * CHECK constraints, read again with the parser's own printer (`exprToSQL`)
 * so the expression keeps its exact meaning: table-level ones (CONSTRAINT ck
 * CHECK (...)), which the importers skip, become the check of the column
 * they test, and column-level ones replace the importers' rendering.
 */
export function applyTableChecks(diagram, ast, exprToSQL) {
  const statements = Array.isArray(ast) ? ast : [ast];
  const columnName = (node) =>
    typeof node.column === "string"
      ? node.column
      : node.column?.expr?.value ?? null;
  for (const statement of statements) {
    if (statement?.type !== "create" || statement.keyword !== "table") continue;
    const table = diagram.tables.find(
      (t) => t.name === statement.table?.[0]?.table,
    );
    if (!table) continue;
    const names = new Set(table.fields.map((f) => f.name));
    const render = (expr) => {
      // SQLite reads "name" as a column when there is one by that name.
      const referenced = [];
      const visit = (node) => {
        if (!node || typeof node !== "object") return node;
        if (Array.isArray(node)) return node.map(visit);
        if (node.type === "double_quote_string" && names.has(node.value)) {
          referenced.push(node.value);
          return { type: "column_ref", table: null, column: node.value };
        }
        if (node.type === "column_ref" && names.has(columnName(node))) {
          referenced.push(columnName(node));
        }
        return Object.fromEntries(
          Object.entries(node).map(([key, value]) => [key, visit(value)]),
        );
      };
      const rewritten = visit(expr);
      let text;
      try {
        text = exprToSQL(rewritten);
      } catch {
        return null;
      }
      // Bare column names: the export quotes them as its settings say.
      text = outsideStrings(text, (part) =>
        part.replace(/`([^`]+)`|"([^"]+)"|\[([^\]]+)\]/g, (match, a, b, c) =>
          names.has(a ?? b ?? c) ? a ?? b ?? c : match,
        ),
      );
      // PostgreSQL keeps checks as ((...)).
      return { text: unwrapParentheses(text), referenced };
    };
    // Column checks first: they replace what the importer wrote.
    for (const definition of statement.create_definitions ?? []) {
      if (definition.resource !== "column" || !definition.check) continue;
      const expr = definition.check.definition?.[0];
      const field = table.fields.find(
        (f) => f.name === columnName(definition.column),
      );
      const rendered = expr && field && render(expr);
      if (rendered) field.check = rendered.text;
    }
    for (const definition of statement.create_definitions ?? []) {
      if (
        definition.resource !== "constraint" ||
        String(definition.constraint_type).toLowerCase() !== "check"
      ) {
        continue;
      }
      const expr = definition.definition?.[0];
      const rendered = expr && render(expr);
      if (!rendered?.referenced.length) continue;
      const field = table.fields.find((f) => f.name === rendered.referenced[0]);
      if (field.check === rendered.text) continue;
      field.check = field.check
        ? `(${field.check}) AND (${rendered.text})`
        : rendered.text;
    }
  }
  return diagram;
}
