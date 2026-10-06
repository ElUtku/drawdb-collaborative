// Export a drawDB diagram as a C++ header: one struct per table (nullable
// columns as std::optional), enum classes with string conversions, and, on
// request, sqlpp11 table definitions and SOCI type conversions so the structs
// can be read from and written to the database without hand-written glue.
//
// Like the other exporters, every choice the output depends on is a setting
// of CPP_OPTION_DEFS, shown by the export dialog in a basic and an advanced
// section, and anything that had to be adapted is reported as an issue.

import { DB } from "../../data/constants";
import { typeKind } from "../exportSQL/types";
import { singularize } from "./protobuf";

export const CPP_OPTION_DEFS = [
  // --- Basic ---------------------------------------------------------------
  { key: "namespaceName", section: "basic", type: "text", default: "" },
  {
    key: "standard",
    section: "basic",
    type: "select",
    choices: ["cpp17", "cpp20"],
    default: "cpp17",
  },
  {
    key: "nullableAs",
    section: "basic",
    type: "select",
    choices: ["optional", "plain"],
    default: "optional",
  },
  { key: "sqlpp11", section: "basic", type: "bool", default: false },
  { key: "soci", section: "basic", type: "bool", default: false },
  { key: "includeComments", section: "basic", type: "bool", default: true },
  // --- Advanced: naming ----------------------------------------------------
  {
    key: "typeCase",
    section: "advanced",
    type: "select",
    choices: ["pascal", "original"],
    default: "pascal",
  },
  {
    key: "memberCase",
    section: "advanced",
    type: "select",
    choices: ["original", "snake", "camel"],
    default: "original",
  },
  { key: "singularTypes", section: "advanced", type: "bool", default: false },
  {
    key: "typeSuffix",
    section: "advanced",
    type: "text",
    default: "",
    placeholder: "Row, Record…",
  },
  // --- Advanced: types -----------------------------------------------------
  {
    key: "timeAs",
    section: "advanced",
    type: "select",
    choices: ["chrono", "tm", "string"],
    default: "chrono",
  },
  {
    key: "decimalAs",
    section: "advanced",
    type: "select",
    choices: ["double", "string"],
    default: "double",
  },
  { key: "enumClasses", section: "advanced", type: "bool", default: true },
  // --- Advanced: output ----------------------------------------------------
  { key: "columnNames", section: "advanced", type: "bool", default: true },
  { key: "defaults", section: "advanced", type: "bool", default: true },
  { key: "comparisons", section: "advanced", type: "bool", default: true },
  {
    key: "headerGuard",
    section: "advanced",
    type: "select",
    choices: ["pragma_once", "ifndef"],
    default: "pragma_once",
  },
];

export const defaultCppOptions = Object.fromEntries(
  CPP_OPTION_DEFS.map((def) => [def.key, def.default]),
);

/** Defaults overlaid with `userOptions`, ignoring unknown or mistyped values. */
export function normalizeCppOptions(userOptions = {}) {
  const options = { ...defaultCppOptions };
  for (const def of CPP_OPTION_DEFS) {
    const value = userOptions?.[def.key];
    if (value === undefined || value === null) continue;
    if (def.type === "bool" && typeof value === "boolean") {
      options[def.key] = value;
    } else if (def.type === "select" && def.choices.includes(value)) {
      options[def.key] = value;
    } else if (def.type === "text" && typeof value === "string") {
      options[def.key] = value.trim();
    }
  }
  return options;
}

export const CPP_ISSUE_MESSAGES = {
  name_changed:
    '"{{name}}" is not a valid or free C++ name; it was exported as {{newName}}.',
  namespace_invalid:
    'The namespace "{{name}}" is not a valid C++ name; {{newName}} was used.',
  type_as_text:
    "{{table}}.{{column}} ({{type}}) has no C++ equivalent and is a std::string.",
  decimal_as_double:
    "{{table}}.{{column}} ({{type}}) is a double: values with more than 15 significant digits lose precision. Use std::string for decimals in the advanced settings to keep them exact.",
  integer_may_overflow:
    "{{table}}.{{column}} ({{type}}) can hold more than 64 bits; it is a std::int64_t.",
  set_as_text:
    "{{table}}.{{column}} is a SET: its values are kept as one comma-separated std::string.",
  soci_skipped:
    "{{table}}.{{column}} ({{type}}) cannot go through soci::values and is left out of its SOCI conversion.",
  soci_time_precision:
    "SOCI moves dates and times as std::tm: fractions of a second are lost.",
  sqlpp_as_text:
    "{{table}}.{{column}} ({{type}}) has no sqlpp11 type and is declared as text.",
  tm_not_comparable:
    "std::tm has no ==, so no comparison operators were generated for {{table}}.",
  enum_value_renamed:
    'The value "{{value}}" of {{name}} is the enumerator {{newName}}.',
};

export function formatCppIssue(issue) {
  const template = CPP_ISSUE_MESSAGES[issue.code] ?? issue.code;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    issue.params && key in issue.params ? String(issue.params[key]) : match,
  );
}

// --- Names --------------------------------------------------------------------

const KEYWORDS = new Set(
  `alignas alignof and and_eq asm auto bitand bitor bool break case catch char
char8_t char16_t char32_t class compl concept const consteval constexpr
constinit const_cast continue co_await co_return co_yield decltype default
delete do double dynamic_cast else enum explicit export extern false float for
friend goto if inline int long mutable namespace new noexcept not not_eq
nullptr operator or or_eq private protected public register reinterpret_cast
requires return short signed sizeof static static_assert static_cast struct
switch template this thread_local throw true try typedef typeid typename union
unsigned using virtual void volatile wchar_t while xor xor_eq final override
import module NULL EOF errno assert offsetof setjmp va_arg major minor`.split(
    /\s+/,
  ),
);

function words(name) {
  return String(name ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

const pascal = (name) =>
  words(name)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join("");
const camel = (name) => {
  const p = pascal(name);
  return p ? p[0].toLowerCase() + p.slice(1) : p;
};
const snake = (name) =>
  words(name)
    .map((w) => w.toLowerCase())
    .join("_");

// A valid identifier: letters, digits and underscores, not starting with a
// digit, not reserved (no double underscore, no underscore + capital).
function identifier(text, fallback) {
  let name = String(text ?? "")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/__+/g, "_");
  if (!name || /^_*$/.test(name)) name = fallback;
  if (/^[0-9]/.test(name)) name = `${fallback[0]}${name}`;
  if (/^_[A-Z_]/.test(name)) name = name.replace(/^_+/, "");
  if (KEYWORDS.has(name)) name = `${name}_`;
  return name;
}

function scope(taken = []) {
  const used = new Set(taken);
  return (name) => {
    let candidate = name;
    let n = 2;
    while (used.has(candidate)) candidate = `${name}_${n++}`;
    used.add(candidate);
    return candidate;
  };
}

function cppString(text) {
  let out = '"';
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f)
      out += `\\${code.toString(8).padStart(3, "0")}`;
    else if (ch === "?")
      out += "\\?"; // No accidental trigraphs.
    else out += ch;
  }
  return `${out}"`;
}

function docComment(text, indent = "") {
  return String(text)
    .split(/\r?\n/)
    .map((line) => `${indent}/// ${line}`.trimEnd())
    .join("\n");
}

// --- Types -----------------------------------------------------------------------

const INT_BITS = {
  TINYINT: 8,
  SMALLINT: 16,
  SMALLSERIAL: 16,
  MEDIUMINT: 32,
  INT: 32,
  INTEGER: 32,
  SERIAL: 32,
  YEAR: 16,
  BIGINT: 64,
  BIGSERIAL: 64,
};

function sizeParts(size) {
  const [precision, scale] = String(size ?? "")
    .split(",")
    .map((part) => part.trim());
  return {
    precision: precision && /^\d+$/.test(precision) ? Number(precision) : null,
    scale: scale && /^\d+$/.test(scale) ? Number(scale) : null,
  };
}

const intType = (bits, unsigned) => `std::${unsigned ? "u" : ""}int${bits}_t`;

/**
 * The C++ shape of a column type: { kind, cpp, bits?, unsigned? }. Kinds:
 * bool, int, float, double, decimal, string, bytes, date, datetime, time,
 * enum, struct, set.
 */
function resolveType(field, ctx) {
  const { dialect, options, enums, structs, report, where } = ctx;
  const raw = String(field.type ?? "").trim();
  const upper = raw.toUpperCase();
  const base = upper.replace(/\s*\(.*$/, "");
  const kind = typeKind(base, dialect);
  const { precision, scale } = sizeParts(field.size);
  const unsigned =
    Boolean(field.unsigned) && [DB.MYSQL, DB.MARIADB].includes(dialect);
  const asText = (code = "type_as_text") => {
    report("info", code, { ...where, type: raw });
    return { kind: "string", cpp: "std::string" };
  };

  if (enums.has(upper)) {
    const name = enums.get(upper);
    return options.enumClasses
      ? { kind: "enum", cpp: name, enumName: name }
      : { kind: "string", cpp: "std::string" };
  }
  if (structs.has(upper)) {
    return { kind: "struct", cpp: structs.get(upper) };
  }

  if (base === "BIT") {
    if (dialect === DB.MSSQL || !precision || precision === 1) {
      return { kind: "bool", cpp: "bool" };
    }
    if ([DB.MYSQL, DB.MARIADB].includes(dialect)) {
      return { kind: "int", cpp: intType(64, true), bits: 64, unsigned: true };
    }
    return asText();
  }
  switch (kind) {
    case "bool":
      return { kind: "bool", cpp: "bool" };
    case "int": {
      let bits = INT_BITS[base] ?? 32;
      let isUnsigned = unsigned;
      // SQLite integers are always 64-bit; SQL Server's TINYINT is 0-255.
      if (dialect === DB.SQLITE) bits = 64;
      if (dialect === DB.MSSQL && base === "TINYINT") isUnsigned = true;
      if (dialect === DB.ORACLESQL && base === "INTEGER") {
        report("info", "integer_may_overflow", { ...where, type: raw });
        bits = 64;
      }
      return {
        kind: "int",
        cpp: intType(bits, isUnsigned),
        bits,
        unsigned: isUnsigned,
      };
    }
    case "decimal": {
      // Whole numbers that fit in 64 bits (NUMBER(10), DECIMAL(9,0)) are integers.
      const whole =
        base !== "MONEY" &&
        base !== "SMALLMONEY" &&
        precision !== null &&
        (scale === null || scale === 0) &&
        precision <= 18;
      if (whole) {
        const bits = precision <= 4 ? 16 : precision <= 9 ? 32 : 64;
        return { kind: "int", cpp: intType(bits, unsigned), bits, unsigned };
      }
      if (options.decimalAs === "string") {
        return { kind: "decimal", cpp: "std::string", decimal: "string" };
      }
      report("info", "decimal_as_double", { ...where, type: raw });
      return { kind: "decimal", cpp: "double", decimal: "double" };
    }
    case "float": {
      const single =
        base === "REAL" ||
        base === "BINARY_FLOAT" ||
        (base === "FLOAT" &&
          [DB.MYSQL, DB.MARIADB, DB.GENERIC].includes(dialect) &&
          (precision === null || precision <= 24)) ||
        (base === "FLOAT" &&
          [DB.MSSQL, DB.ORACLESQL, DB.POSTGRES].includes(dialect) &&
          precision !== null &&
          precision <= 24);
      if (dialect === DB.SQLITE) return { kind: "double", cpp: "double" };
      return single
        ? { kind: "float", cpp: "float" }
        : { kind: "double", cpp: "double" };
    }
    case "string":
    case "text":
    case "json":
    case "uuid":
      return { kind: "string", cpp: "std::string" };
    case "binary":
    case "blob":
    case "rowversion":
      return { kind: "bytes", cpp: "std::vector<std::uint8_t>" };
    case "date":
    case "datetime":
    case "time":
      return timeType(kind, options);
    case "enum": {
      if (!options.enumClasses || !field.values?.length) {
        return { kind: "string", cpp: "std::string" };
      }
      const name = ctx.columnEnum(field);
      return { kind: "enum", cpp: name, enumName: name };
    }
    case "set":
      report("info", "set_as_text", where);
      return { kind: "set", cpp: "std::string" };
    default:
      return asText();
  }
}

function timeType(kind, options) {
  if (options.timeAs === "string") return { kind, cpp: "std::string" };
  if (options.timeAs === "tm") return { kind, cpp: "std::tm" };
  if (kind === "time") return { kind, cpp: "std::chrono::microseconds" };
  if (kind === "date" && options.standard === "cpp20") {
    return { kind, cpp: "std::chrono::sys_days" };
  }
  return { kind, cpp: "std::chrono::system_clock::time_point" };
}

const INCLUDES = {
  "std::string": "<string>",
  "std::vector": "<vector>",
  "std::optional": "<optional>",
  "std::chrono": "<chrono>",
  "std::tm": "<ctime>",
  "std::int": "<cstdint>",
  "std::uint": "<cstdint>",
  "std::string_view": "<string_view>",
  "std::array": "<array>",
  "std::tie": "<tuple>",
  "std::snprintf": "<cstdio>",
};

// --- Defaults ----------------------------------------------------------------------

function defaultInitializer(field, type, ctx) {
  if (!ctx.options.defaults) return null;
  let raw = field.default;
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "boolean") raw = raw ? "true" : "false";
  raw = String(raw).trim();
  if (!raw || /^null$/i.test(raw)) return null;
  const quoted = /^'(.*)'$/s.exec(raw);
  const text = quoted ? quoted[1].replace(/''/g, "'") : raw;
  switch (type.kind) {
    case "bool":
      if (/^(true|1|b'1')$/i.test(text)) return "true";
      if (/^(false|0|b'0')$/i.test(text)) return "false";
      return null;
    case "int":
      if (!/^-?\d+$/.test(text)) return null;
      if (type.unsigned && text.startsWith("-")) return null;
      return `${text}${type.bits === 64 ? (type.unsigned ? "ULL" : "LL") : type.unsigned ? "U" : ""}`;
    case "float":
    case "double":
      if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text)) return null;
      return type.kind === "float"
        ? `${text.includes(".") || /e/i.test(text) ? text : `${text}.0`}f`
        : text.includes(".") || /e/i.test(text)
          ? text
          : `${text}.0`;
    case "decimal":
      if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return null;
      return type.decimal === "string"
        ? `std::string(${cppString(text)})`
        : text.includes(".")
          ? text
          : `${text}.0`;
    case "string":
    case "set":
      // Functions (CURRENT_USER, gen_random_uuid()...) are not values.
      if (!quoted && /[()]|^[A-Z_]+$/.test(text)) return null;
      return `std::string(${cppString(text)})`;
    case "enum": {
      const entry = ctx.enumValues.get(type.enumName);
      const value = entry?.get(text);
      return value ? `${type.enumName}::${value}` : null;
    }
    default:
      return null;
  }
}

// --- Generator ----------------------------------------------------------------------

export function generateCpp(diagram, userOptions = {}) {
  const options = normalizeCppOptions(userOptions);
  const issues = [];
  const report = (level, code, params = {}) => {
    const key = JSON.stringify([level, code, params]);
    if (
      !issues.some(
        (issue) =>
          JSON.stringify([issue.level, issue.code, issue.params]) === key,
      )
    ) {
      issues.push({ level, code, params });
    }
  };
  const dialect = diagram?.database || DB.GENERIC;
  const tables = diagram?.tables ?? [];
  const references = diagram?.references ?? diagram?.relationships ?? [];

  // Names at namespace level: types, enums and helper functions.
  const globalNames = scope(["to_string", "from_string"]);
  const typeName = (name, fallback, { table = false } = {}) => {
    const source =
      table && options.singularTypes
        ? String(name ?? "").replace(/[A-Za-z]+$/, (word) => singularize(word))
        : name;
    const styled =
      options.typeCase === "pascal" ? pascal(source) : String(source ?? "");
    const wanted = identifier(`${styled}${options.typeSuffix}`, fallback);
    const finalName = globalNames(wanted);
    if (finalName !== `${styled}${options.typeSuffix}`) {
      report("info", "name_changed", { name, newName: finalName });
    }
    return finalName;
  };
  const memberStyle = (name) =>
    options.memberCase === "snake"
      ? snake(name)
      : options.memberCase === "camel"
        ? camel(name)
        : String(name ?? "");

  // Namespace: given, or from the diagram title.
  let namespaceName = options.namespaceName;
  if (namespaceName) {
    const parts = namespaceName.split("::");
    const fixed = parts.map((part) => identifier(part.trim(), "ns"));
    if (fixed.join("::") !== namespaceName) {
      report("warning", "namespace_invalid", {
        name: namespaceName,
        newName: fixed.join("::"),
      });
    }
    namespaceName = fixed.join("::");
  } else {
    namespaceName = identifier(snake(diagram?.title) || "schema", "schema");
  }

  // Enum types: the diagram's (PostgreSQL) and one per ENUM column.
  const enums = new Map(); // upper-case type name -> C++ name
  const enumDefs = [];
  const enumValues = new Map(); // C++ name -> Map(value -> enumerator)
  const defineEnum = (name, values, comment) => {
    const cppName = typeName(name, "Enum");
    const enumerators = scope();
    const map = new Map();
    for (const value of values ?? []) {
      const text = String(value);
      const wanted = identifier(pascal(text) || "Empty", "Value");
      const enumerator = enumerators(wanted);
      if (enumerator !== pascal(text)) {
        report("info", "enum_value_renamed", {
          name: cppName,
          value: text,
          newName: enumerator,
        });
      }
      map.set(text, enumerator);
    }
    enumDefs.push({ name: cppName, values: map, comment });
    enumValues.set(cppName, map);
    return cppName;
  };
  if (options.enumClasses) {
    for (const entry of diagram?.enums ?? []) {
      if (!entry?.name) continue;
      enums.set(
        String(entry.name).toUpperCase(),
        defineEnum(entry.name, entry.values, entry.comment),
      );
    }
  }

  // Composite types (PostgreSQL) become structs too.
  const structs = new Map();
  const typeDefs = [];
  for (const type of diagram?.types ?? []) {
    if (!type?.name) continue;
    const cppName = typeName(type.name, "Type");
    structs.set(String(type.name).toUpperCase(), cppName);
    typeDefs.push({ source: type, name: cppName });
  }

  const tableName = new Map(tables.map((t) => [t.id, t.name]));
  const fieldName = (tableId, fieldId) =>
    tables.find((t) => t.id === tableId)?.fields?.find((f) => f.id === fieldId)
      ?.name;
  const foreignKeysOf = new Map();
  for (const r of references) {
    const pairs = r.fields?.length
      ? r.fields
      : [{ startFieldId: r.startFieldId, endFieldId: r.endFieldId }];
    for (const p of pairs) {
      const key = `${r.startTableId}:${p.startFieldId}`;
      foreignKeysOf.set(
        key,
        `${tableName.get(r.endTableId)}.${fieldName(r.endTableId, p.endFieldId)}`,
      );
    }
  }

  // Structs, one per table.
  const structDefs = tables.map((table, index) => {
    const name = typeName(table.name, `Table${index + 1}`, { table: true });
    const members = scope(["kTable", "kColumns", "kPrimaryKey", "Column"]);
    const columnIds = scope();
    const fields = (table.fields ?? []).map((field, i) => {
      const where = { table: table.name, column: field.name };
      const ctx = {
        dialect,
        options,
        enums,
        structs,
        report,
        where,
        columnEnum: (f) =>
          defineEnum(`${table.name}_${f.name}`, f.values, null),
      };
      let type = resolveType(field, ctx);
      if (field.isArray) {
        type = {
          ...type,
          kind: "array",
          element: type,
          cpp: `std::vector<${type.cpp}>`,
        };
      }
      const styled = memberStyle(field.name);
      const member = members(identifier(styled, `field${i + 1}`));
      if (member !== styled) {
        report("info", "name_changed", {
          name: field.name,
          newName: `${name}::${member}`,
        });
      }
      const nullable = !field.notNull && !field.primary && !field.increment;
      const optional = nullable && options.nullableAs === "optional";
      return {
        field,
        type,
        member,
        columnId: columnIds(identifier(field.name, `field${i + 1}`)),
        nullable,
        optional,
        cpp: optional ? `std::optional<${type.cpp}>` : type.cpp,
        initializer: defaultInitializer(field, type, { options, enumValues }),
        references: foreignKeysOf.get(`${table.id}:${field.id}`),
      };
    });
    return { table, name, fields };
  });

  for (const def of typeDefs) {
    const members = scope();
    def.fields = (def.source.fields ?? []).map((field, i) => {
      const where = { table: def.source.name, column: field.name };
      const type = resolveType(field, {
        dialect,
        options,
        enums,
        structs,
        report,
        where,
        columnEnum: (f) =>
          defineEnum(`${def.source.name}_${f.name}`, f.values, null),
      });
      const optional = options.nullableAs === "optional";
      return {
        field,
        type,
        member: members(identifier(memberStyle(field.name), `field${i + 1}`)),
        optional,
        nullable: true,
        cpp: optional ? `std::optional<${type.cpp}>` : type.cpp,
      };
    });
  }

  // --- Printing ---------------------------------------------------------------
  const out = [];
  const used = new Set();
  const use = (text) => {
    for (const [prefix, header] of Object.entries(INCLUDES)) {
      if (text.includes(prefix)) used.add(header);
    }
  };
  const I = "  ";
  const comments = options.includeComments;
  const tmTypes = (fields) => fields.some((f) => f.cpp.includes("std::tm"));

  const enumBlock = (def) => {
    const lines = [];
    if (comments && def.comment) lines.push(docComment(def.comment));
    lines.push(`enum class ${def.name} {`);
    for (const [, enumerator] of def.values) lines.push(`${I}${enumerator},`);
    lines.push("};", "");
    lines.push(
      `constexpr std::string_view to_string(${def.name} value) noexcept {`,
      `${I}switch (value) {`,
    );
    for (const [text, enumerator] of def.values) {
      lines.push(
        `${I}${I}case ${def.name}::${enumerator}:`,
        `${I}${I}${I}return ${cppString(text)};`,
      );
    }
    lines.push(`${I}}`, `${I}return {};`, "}", "");
    lines.push(
      `inline bool from_string(std::string_view text, ${def.name}& value) noexcept {`,
    );
    for (const [text, enumerator] of def.values) {
      lines.push(
        `${I}if (text == ${cppString(text)}) {`,
        `${I}${I}value = ${def.name}::${enumerator};`,
        `${I}${I}return true;`,
        `${I}}`,
      );
    }
    lines.push(`${I}return false;`, "}");
    use("std::string_view");
    return lines.join("\n");
  };

  const comparison = (def) => {
    if (!options.comparisons) return [];
    if (tmTypes(def.fields)) {
      report("info", "tm_not_comparable", {
        table: def.table?.name ?? def.source?.name,
      });
      return [];
    }
    if (options.standard === "cpp20") {
      return ["", `${I}bool operator==(const ${def.name}&) const = default;`];
    }
    if (!def.fields.length) {
      return [
        "",
        `${I}friend bool operator==(const ${def.name}&, const ${def.name}&) { return true; }`,
        `${I}friend bool operator!=(const ${def.name}&, const ${def.name}&) { return false; }`,
      ];
    }
    use("std::tie");
    const tie = (v) =>
      `std::tie(${def.fields.map((f) => `${v}.${f.member}`).join(", ")})`;
    return [
      "",
      `${I}friend bool operator==(const ${def.name}& a, const ${def.name}& b) {`,
      `${I}${I}return ${tie("a")} == ${tie("b")};`,
      `${I}}`,
      `${I}friend bool operator!=(const ${def.name}& a, const ${def.name}& b) {`,
      `${I}${I}return !(a == b);`,
      `${I}}`,
    ];
  };

  const memberLine = (f) => {
    use(f.cpp);
    const init = f.initializer
      ? ` = ${f.initializer}`
      : f.optional || f.type.kind === "string" || f.type.kind === "bytes"
        ? ""
        : "{}";
    const notes = [];
    if (comments) {
      if (f.field.comment)
        notes.push(String(f.field.comment).replace(/\s+/g, " "));
      if (f.field.primary) notes.push("primary key");
      if (f.field.increment) notes.push("generated by the database");
      if (f.references) notes.push(`references ${f.references}`);
    }
    return `${I}${f.cpp} ${f.member}${init};${notes.length ? `  ///< ${notes.join("; ")}` : ""}`;
  };

  const structBlock = (def) => {
    const lines = [];
    if (comments && def.table.comment)
      lines.push(docComment(def.table.comment));
    lines.push(`struct ${def.name} {`);
    if (options.columnNames) {
      use("std::string_view");
      use("std::array");
      lines.push(
        `${I}static constexpr std::string_view kTable = ${cppString(def.table.name)};`,
      );
      lines.push(`${I}struct Column {`);
      for (const f of def.fields) {
        lines.push(
          `${I}${I}static constexpr std::string_view ${f.columnId} = ${cppString(f.field.name)};`,
        );
      }
      lines.push(`${I}};`);
      lines.push(
        `${I}static constexpr std::array<std::string_view, ${def.fields.length}> kColumns{${def.fields
          .map((f) => `Column::${f.columnId}`)
          .join(", ")}};`,
      );
      const primary = def.fields.filter((f) => f.field.primary);
      lines.push(
        `${I}static constexpr std::array<std::string_view, ${primary.length}> kPrimaryKey{${primary
          .map((f) => `Column::${f.columnId}`)
          .join(", ")}};`,
      );
      lines.push("");
    }
    lines.push(...def.fields.map(memberLine));
    lines.push(...comparison(def));
    lines.push("};");
    return lines.join("\n");
  };

  const typeBlock = (def) => {
    const lines = [];
    if (comments && def.source.comment)
      lines.push(docComment(def.source.comment));
    lines.push(`struct ${def.name} {`);
    lines.push(
      ...def.fields.map((f) => {
        use(f.cpp);
        return `${I}${f.cpp} ${f.member}${f.optional || ["string", "bytes"].includes(f.type.kind) ? "" : "{}"};`;
      }),
    );
    lines.push(...comparison(def));
    lines.push("};");
    return lines.join("\n");
  };

  const body = [];
  for (const def of enumDefs) body.push(enumBlock(def));
  for (const def of typeDefs) body.push(typeBlock(def));
  for (const def of structDefs) body.push(structBlock(def));

  const sqlpp = options.sqlpp11
    ? sqlppBlock(structDefs, namespaceName, report)
    : null;
  const soci = options.soci
    ? sociBlock(structDefs, namespaceName, options, report, use)
    : null;

  // Header.
  const guard = `DRAWDB_${snake(namespaceName.replace(/::/g, "_")).toUpperCase()}_HPP`;
  out.push(
    `// Generated by drawDB${diagram?.title ? ` from "${String(diagram.title).replace(/[\r\n]/g, " ")}"` : ""}. Requires ${options.standard === "cpp20" ? "C++20" : "C++17"}.`,
  );
  if (options.headerGuard === "pragma_once") out.push("#pragma once");
  else out.push(`#ifndef ${guard}`, `#define ${guard}`);
  out.push("");
  const includes = [...used].sort();
  if (sqlpp) {
    includes.push(
      "<sqlpp11/char_sequence.h>",
      "<sqlpp11/data_types.h>",
      "<sqlpp11/table.h>",
    );
  }
  if (soci) includes.push("<soci/soci.h>");
  out.push(...includes.map((header) => `#include ${header}`));
  out.push("", `namespace ${namespaceName} {`, "");
  out.push(body.join("\n\n"));
  out.push("", `}  // namespace ${namespaceName}`);
  if (sqlpp) out.push("", sqlpp);
  if (soci) out.push("", soci);
  if (options.headerGuard !== "pragma_once")
    out.push("", `#endif  // ${guard}`);

  return { code: `${out.join("\n")}\n`, issues };
}

// --- sqlpp11 ---------------------------------------------------------------------------

const SQLPP_TYPES = {
  bool: () => "sqlpp::boolean",
  int: (t) =>
    `sqlpp::${{ 8: "tinyint", 16: "smallint", 32: "integer", 64: "bigint" }[t.bits] ?? "bigint"}${t.unsigned ? "_unsigned" : ""}`,
  float: () => "sqlpp::floating_point",
  double: () => "sqlpp::floating_point",
  decimal: (t) =>
    t.decimal === "string" ? "sqlpp::text" : "sqlpp::floating_point",
  string: () => "sqlpp::text",
  set: () => "sqlpp::text",
  enum: () => "sqlpp::text",
  bytes: () => "sqlpp::blob",
  date: () => "sqlpp::day_point",
  datetime: () => "sqlpp::time_point",
  time: () => "sqlpp::time_of_day",
};

function sqlppBlock(structDefs, namespaceName, report) {
  const I = "  ";
  const lines = [
    "// sqlpp11 table definitions, as its ddl2cpp tool writes them.",
    `namespace ${namespaceName}::tables {`,
  ];
  const alias = (literal, member, indent) => [
    `${indent}struct _alias_t {`,
    `${indent}${I}static constexpr const char _literal[] = ${cppString(literal)};`,
    `${indent}${I}using _name_t = sqlpp::make_char_sequence<sizeof(_literal), _literal>;`,
    `${indent}${I}template <typename T>`,
    `${indent}${I}struct _member_t {`,
    `${indent}${I}${I}T ${member};`,
    `${indent}${I}${I}T& operator()() { return ${member}; }`,
    `${indent}${I}${I}const T& operator()() const { return ${member}; }`,
    `${indent}${I}};`,
    `${indent}};`,
  ];
  const tableNames = scope();
  for (const def of structDefs) {
    const tableStruct = tableNames(def.name);
    const columnStructs = scope([tableStruct]);
    const memberNames = scope();
    lines.push("", `namespace ${tableStruct}_ {`);
    const columns = def.fields.map((f, i) => {
      const struct = columnStructs(
        identifier(pascal(f.field.name), `Column${i + 1}`),
      );
      const member = memberNames(
        identifier(camel(f.field.name), `column${i + 1}`),
      );
      let type = SQLPP_TYPES[f.type.kind]?.(f.type);
      if (!type) {
        report("warning", "sqlpp_as_text", {
          table: def.table.name,
          column: f.field.name,
          type: f.field.type,
        });
        type = "sqlpp::text";
      }
      const tags = [];
      if (f.field.increment) {
        tags.push("sqlpp::tag::must_not_insert", "sqlpp::tag::must_not_update");
      } else if (
        f.field.notNull &&
        (f.field.default === undefined ||
          f.field.default === null ||
          f.field.default === "")
      ) {
        tags.push("sqlpp::tag::require_insert");
      }
      if (f.nullable) tags.push("sqlpp::tag::can_be_null");
      lines.push(
        `struct ${struct} {`,
        ...alias(f.field.name, member, I),
        `${I}using _traits = sqlpp::make_traits<${[type, ...tags].join(", ")}>;`,
        "};",
      );
      return struct;
    });
    lines.push(`}  // namespace ${tableStruct}_`, "");
    lines.push(
      `struct ${tableStruct} : sqlpp::table_t<${[tableStruct, ...columns.map((c) => `${tableStruct}_::${c}`)].join(", ")}> {`,
      ...alias(def.table.name, identifier(camel(def.table.name), "table"), I),
      "};",
    );
  }
  lines.push("", `}  // namespace ${namespaceName}::tables`);
  return lines.join("\n");
}

// --- SOCI -----------------------------------------------------------------------------

// Shared by every header drawDB writes, so it is guarded against appearing
// twice in one translation unit. soci::values gives each column the type its
// backend reports (which differs between backends) and get<T>() only returns
// that type; these read whatever the backend chose and convert it.
const SOCI_HELPERS = `#ifndef DRAWDB_SOCI_HELPERS
#define DRAWDB_SOCI_HELPERS
namespace soci {
namespace drawdb {

inline std::string text(const values& v, const std::string& column) {
  switch (v.get_properties(column).get_data_type()) {
    case dt_integer:
      return std::to_string(v.get<int>(column));
    case dt_long_long:
      return std::to_string(v.get<long long>(column));
    case dt_unsigned_long_long:
      return std::to_string(v.get<unsigned long long>(column));
    case dt_double: {
      char buffer[32];
      std::snprintf(buffer, sizeof buffer, "%.17g", v.get<double>(column));
      return buffer;
    }
    case dt_date: {
      const std::tm value = v.get<std::tm>(column);
      char buffer[32];
      std::strftime(buffer, sizeof buffer, "%Y-%m-%d %H:%M:%S", &value);
      return buffer;
    }
    default:
      return v.get<std::string>(column);
  }
}

template <typename T>
T number(const values& v, const std::string& column) {
  switch (v.get_properties(column).get_data_type()) {
    case dt_integer:
      return static_cast<T>(v.get<int>(column));
    case dt_long_long:
      return static_cast<T>(v.get<long long>(column));
    case dt_unsigned_long_long:
      return static_cast<T>(v.get<unsigned long long>(column));
    case dt_double:
      return static_cast<T>(v.get<double>(column));
    default: {
      const std::string value = v.get<std::string>(column);
      if (value == "t" || value == "true" || value == "TRUE") return static_cast<T>(1);
      if (value == "f" || value == "false" || value == "FALSE") return static_cast<T>(0);
      if constexpr (std::is_floating_point_v<T>) {
        return static_cast<T>(std::stod(value));
      } else if constexpr (std::is_signed_v<T>) {
        return static_cast<T>(std::stoll(value));
      } else {
        return static_cast<T>(std::stoull(value));
      }
    }
  }
}

// Dates and times as std::tm, from a date column or from text such as
// "2024-05-01 10:20:30", "2024-05-01" or "10:20:30".
inline std::tm time(const values& v, const std::string& column) {
  if (v.get_properties(column).get_data_type() == dt_date) {
    return v.get<std::tm>(column);
  }
  const std::string value = text(v, column);
  std::tm out{};
  int year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
  const int read = std::sscanf(value.c_str(), "%d-%d-%d%*c%d:%d:%d", &year,
                               &month, &day, &hour, &minute, &second);
  if (read >= 3) {
    out.tm_year = year - 1900;
    out.tm_mon = month - 1;
    out.tm_mday = day;
  } else if (std::sscanf(value.c_str(), "%d:%d:%d", &hour, &minute,
                         &second) == 3) {
    out.tm_year = 70;
    out.tm_mday = 1;
  } else {
    throw soci_error("Not a date or time in " + column + ": " + value);
  }
  out.tm_hour = hour;
  out.tm_min = minute;
  out.tm_sec = second;
  return out;
}

// Times are taken as UTC.
inline std::tm to_tm(std::chrono::system_clock::time_point point) {
  const std::time_t time = std::chrono::system_clock::to_time_t(point);
  std::tm out{};
#if defined(_WIN32)
  gmtime_s(&out, &time);
#else
  gmtime_r(&time, &out);
#endif
  return out;
}

inline std::chrono::system_clock::time_point from_tm(std::tm value) {
#if defined(_WIN32)
  return std::chrono::system_clock::from_time_t(_mkgmtime(&value));
#else
  return std::chrono::system_clock::from_time_t(timegm(&value));
#endif
}

inline std::chrono::microseconds time_of_day(const std::tm& value) {
  return std::chrono::hours(value.tm_hour) +
         std::chrono::minutes(value.tm_min) +
         std::chrono::seconds(value.tm_sec);
}

// TIME values are written as "HH:MM:SS.ffffff", which every engine reads.
inline std::string time_text(std::chrono::microseconds value) {
  const long long total = value.count();
  char buffer[40];
  std::snprintf(buffer, sizeof buffer, "%02lld:%02lld:%02lld.%06lld",
                total / 3600000000LL, total / 60000000LL % 60,
                total / 1000000LL % 60, total % 1000000LL);
  return buffer;
}

inline std::vector<std::uint8_t> bytes(const values& v,
                                       const std::string& column) {
  const std::string value = v.get<std::string>(column);
  return std::vector<std::uint8_t>(value.begin(), value.end());
}

template <typename Enum>
Enum enumeration(const std::string& value, const char* column) {
  Enum out{};
  if (!from_string(value, out)) {
    throw soci_error(std::string("Unexpected value '") + value + "' in " +
                     column);
  }
  return out;
}

}  // namespace drawdb
}  // namespace soci
#endif  // DRAWDB_SOCI_HELPERS`;

function sociBlock(structDefs, namespaceName, options, report, use) {
  const I = "  ";
  const conversions = [];
  let timeLost = false;
  for (const header of [
    "std::string",
    "std::vector",
    "std::chrono",
    "std::tm",
    "std::int",
    "std::snprintf",
  ]) {
    use(header);
  }

  // How a member is read from and written to soci::values. Writes use the
  // types soci::values accepts (int, long long, unsigned long long, double,
  // std::string, std::tm); the database converts them to the column's type.
  const sociOf = (f, table) => {
    const t = f.type;
    const from = (column) => `v, ${column}`;
    switch (t.kind) {
      case "bool":
        return {
          read: (c) => `drawdb::number<int>(${from(c)}) != 0`,
          write: (x) => `${x} ? 1 : 0`,
          nothing: "0",
        };
      case "int":
        // std::int64_t is long on some platforms; soci::values wants long long.
        if (t.bits === 64 && t.unsigned) {
          return {
            read: (c) => `drawdb::number<${t.cpp}>(${from(c)})`,
            write: (x) => `static_cast<unsigned long long>(${x})`,
            nothing: "0ULL",
          };
        }
        if (t.bits === 64 || (t.bits === 32 && t.unsigned)) {
          return {
            read: (c) => `drawdb::number<${t.cpp}>(${from(c)})`,
            write: (x) => `static_cast<long long>(${x})`,
            nothing: "0LL",
          };
        }
        return {
          read: (c) => `drawdb::number<${t.cpp}>(${from(c)})`,
          write: (x) => `static_cast<int>(${x})`,
          nothing: "0",
        };
      case "float":
      case "double":
        return {
          read: (c) => `drawdb::number<${t.cpp}>(${from(c)})`,
          write: (x) => `static_cast<double>(${x})`,
          nothing: "0.0",
        };
      case "decimal":
        return t.decimal === "string"
          ? {
              read: (c) => `drawdb::text(${from(c)})`,
              write: (x) => x,
              nothing: "std::string()",
            }
          : {
              read: (c) => `drawdb::number<double>(${from(c)})`,
              write: (x) => x,
              nothing: "0.0",
            };
      case "string":
      case "set":
        return {
          read: (c) => `drawdb::text(${from(c)})`,
          write: (x) => x,
          nothing: "std::string()",
        };
      case "bytes":
        return {
          read: (c) => `drawdb::bytes(${from(c)})`,
          write: (x) => `std::string(${x}.begin(), ${x}.end())`,
          nothing: "std::string()",
        };
      case "enum":
        return {
          read: (c) =>
            `drawdb::enumeration<${namespaceName}::${t.enumName}>(drawdb::text(${from(c)}), ${cppString(`${table}.${f.field.name}`)})`,
          write: (x) => `std::string(${namespaceName}::to_string(${x}))`,
          nothing: "std::string()",
        };
      case "date":
      case "datetime":
      case "time": {
        if (t.cpp === "std::string") {
          return {
            read: (c) => `drawdb::text(${from(c)})`,
            write: (x) => x,
            nothing: "std::string()",
          };
        }
        if (t.cpp === "std::chrono::microseconds") {
          return {
            read: (c) => `drawdb::time_of_day(drawdb::time(${from(c)}))`,
            write: (x) => `drawdb::time_text(${x})`,
            nothing: "std::string()",
          };
        }
        timeLost = true;
        if (t.cpp === "std::tm") {
          return {
            read: (c) => `drawdb::time(${from(c)})`,
            write: (x) => x,
            nothing: "std::tm{}",
          };
        }
        return {
          read: (c) =>
            t.cpp === "std::chrono::sys_days"
              ? `std::chrono::floor<std::chrono::days>(drawdb::from_tm(drawdb::time(${from(c)})))`
              : `drawdb::from_tm(drawdb::time(${from(c)}))`,
          write: (x) => `drawdb::to_tm(${x})`,
          nothing: "std::tm{}",
        };
      }
      default:
        return null;
    }
  };

  for (const def of structDefs) {
    const type = `${namespaceName}::${def.name}`;
    const from = [];
    const to = [];
    for (const f of def.fields) {
      const column = cppString(f.field.name);
      const soci = f.type.kind === "array" ? null : sociOf(f, def.table.name);
      if (!soci) {
        report("warning", "soci_skipped", {
          table: def.table.name,
          column: f.field.name,
          type: f.field.type,
        });
        from.push(`${I}${I}// ${f.member}: not converted (${f.cpp}).`);
        to.push(`${I}${I}// ${f.member}: not converted (${f.cpp}).`);
        continue;
      }
      if (f.optional) {
        from.push(
          `${I}${I}if (v.get_indicator(${column}) == i_null) {`,
          `${I}${I}${I}o.${f.member}.reset();`,
          `${I}${I}} else {`,
          `${I}${I}${I}o.${f.member} = ${soci.read(column)};`,
          `${I}${I}}`,
        );
        to.push(
          `${I}${I}if (o.${f.member}) {`,
          `${I}${I}${I}v.set(${column}, ${soci.write(`(*o.${f.member})`)});`,
          `${I}${I}} else {`,
          `${I}${I}${I}v.set(${column}, ${soci.nothing}, i_null);`,
          `${I}${I}}`,
        );
      } else {
        from.push(`${I}${I}o.${f.member} = ${soci.read(column)};`);
        to.push(`${I}${I}v.set(${column}, ${soci.write(`o.${f.member}`)});`);
      }
    }
    conversions.push(
      [
        "template <>",
        `struct type_conversion<${type}> {`,
        `${I}using base_type = values;`,
        "",
        `${I}static void from_base(const values& v, indicator, ${type}& o) {`,
        `${I}${I}// Also called after use(o), with no row: nothing was read then.`,
        `${I}${I}if (v.get_number_of_columns() == 0) return;`,
        ...from,
        `${I}}`,
        "",
        `${I}static void to_base(const ${type}& o, values& v, indicator& ind) {`,
        ...to,
        `${I}${I}ind = i_ok;`,
        `${I}}`,
        "};",
      ].join("\n"),
    );
  }
  if (timeLost) report("info", "soci_time_precision");
  void options;

  const lines = [
    "// SOCI conversions: soci::row, use() and into() work with the structs.",
    SOCI_HELPERS,
    "",
    "namespace soci {",
  ];
  for (const conversion of conversions) lines.push("", conversion);
  lines.push("", "}  // namespace soci");
  return lines.join("\n");
}
