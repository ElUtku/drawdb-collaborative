// Export a drawDB diagram as a Protocol Buffers (proto3) schema.
//
// Tables become messages, columns become fields, enums and composite types
// become proto enums and messages. Every naming or mapping decision is driven
// by the options in PROTO_OPTION_DEFS, which the export dialog shows split in
// a basic and an advanced section.
//
// Field numbers are what keep serialized messages readable after the schema
// changes, so they are taken from the diagram (field.protoNumber) when they
// were saved there, and numbers of deleted fields (table.protoReserved) are
// written as `reserved`. Fields without a saved number get the next free one.

export const PROTO_OPTION_DEFS = [
  // --- Basic ---------------------------------------------------------------
  { key: "packageName", section: "basic", type: "text", default: "" },
  {
    key: "fieldCase",
    section: "basic",
    type: "select",
    choices: ["snake", "camel", "original"],
    default: "snake",
  },
  {
    key: "fieldNumbers",
    section: "basic",
    type: "select",
    choices: ["stored", "position"],
    default: "stored",
  },
  { key: "nullableAsOptional", section: "basic", type: "bool", default: true },
  { key: "includeComments", section: "basic", type: "bool", default: true },
  {
    key: "service",
    section: "basic",
    type: "select",
    choices: ["none", "crud"],
    default: "none",
  },
  // --- Advanced: file ------------------------------------------------------
  {
    key: "goPackage",
    section: "advanced",
    type: "text",
    default: "",
    placeholder: "example.com/project/gen;schemapb",
  },
  {
    key: "javaPackage",
    section: "advanced",
    type: "text",
    default: "",
    placeholder: "com.example.schema",
  },
  {
    key: "javaMultipleFiles",
    section: "advanced",
    type: "bool",
    default: true,
  },
  {
    key: "optimizeFor",
    section: "advanced",
    type: "select",
    choices: ["default", "SPEED", "CODE_SIZE", "LITE_RUNTIME"],
    default: "default",
  },
  // --- Advanced: naming ----------------------------------------------------
  {
    key: "messageCase",
    section: "advanced",
    type: "select",
    choices: ["pascal", "original"],
    default: "pascal",
  },
  {
    key: "singularizeMessages",
    section: "advanced",
    type: "bool",
    default: false,
  },
  {
    key: "messageSuffix",
    section: "advanced",
    type: "text",
    default: "",
    placeholder: "Dto, Entity…",
  },
  {
    key: "enumValueStyle",
    section: "advanced",
    type: "select",
    choices: ["prefixed", "plain"],
    default: "prefixed",
  },
  {
    key: "enumZeroName",
    section: "advanced",
    type: "text",
    default: "UNSPECIFIED",
    placeholder: "UNSPECIFIED",
  },
  // --- Advanced: types -----------------------------------------------------
  {
    key: "unsignedAs",
    section: "advanced",
    type: "select",
    choices: ["uint", "int"],
    default: "uint",
  },
  {
    key: "decimalAs",
    section: "advanced",
    type: "select",
    choices: ["string", "double"],
    default: "string",
  },
  {
    key: "timestampAs",
    section: "advanced",
    type: "select",
    choices: ["timestamp", "int64", "string"],
    default: "timestamp",
  },
  {
    key: "dateAs",
    section: "advanced",
    type: "select",
    choices: ["string", "google_date"],
    default: "string",
  },
  {
    key: "jsonAs",
    section: "advanced",
    type: "select",
    choices: ["value", "struct", "string"],
    default: "value",
  },
  {
    key: "uuidAs",
    section: "advanced",
    type: "select",
    choices: ["string", "bytes"],
    default: "string",
  },
  // --- Advanced: output ----------------------------------------------------
  {
    key: "includeConstraintComments",
    section: "advanced",
    type: "bool",
    default: true,
  },
];

export const defaultProtobufOptions = Object.fromEntries(
  PROTO_OPTION_DEFS.map((def) => [def.key, def.default]),
);

/** Defaults overlaid with `userOptions`, ignoring unknown or mistyped values. */
export function normalizeProtobufOptions(userOptions = {}) {
  const options = { ...defaultProtobufOptions };
  for (const def of PROTO_OPTION_DEFS) {
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

export const PROTO_ISSUE_MESSAGES = {
  name_clash:
    "{{kind}} {{name}} would repeat another definition; it was exported as {{newName}}.",
  enum_values_prefixed:
    "The values of {{name}} were prefixed because another enum in the same scope uses the same names.",
  json_name_clash:
    "{{message}}.{{field}} reads like another field once written in camelCase (JSON); it was exported as {{newName}}.",
  number_invalid:
    "{{message}}.{{field}}: the saved field number {{number}} is not valid or already used; {{newNumber}} was used.",
  numbers_not_saved:
    "{{count}} fields have no saved number, so their number depends on the column order. Save the numbers in the diagram to keep them fixed.",
  google_date:
    "google.type.Date is not part of protoc; it needs google/type/date.proto from googleapis.",
};

export function formatProtoIssue(issue) {
  const template = PROTO_ISSUE_MESSAGES[issue.code] ?? issue.code;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    issue.params && key in issue.params ? String(issue.params[key]) : match,
  );
}

const IMPORTS = {
  "google.protobuf.Timestamp": "google/protobuf/timestamp.proto",
  "google.protobuf.Value": "google/protobuf/struct.proto",
  "google.protobuf.Struct": "google/protobuf/struct.proto",
  "google.protobuf.Empty": "google/protobuf/empty.proto",
  "google.type.Date": "google/type/date.proto",
};

const BASE_TYPES = {
  TINYINT: "int32",
  SMALLINT: "int32",
  MEDIUMINT: "int32",
  INT: "int32",
  INTEGER: "int64", // SQLite INTEGER is a 64-bit rowid
  SERIAL: "int32",
  SMALLSERIAL: "int32",
  YEAR: "int32",
  BIGINT: "int64",
  BIGSERIAL: "int64",
  REAL: "float",
  FLOAT: "double",
  DOUBLE: "double",
  "DOUBLE PRECISION": "double",
  BINARY_FLOAT: "float",
  BINARY_DOUBLE: "double",
  BOOLEAN: "bool",
  BIT: "bool",
  BLOB: "bytes",
  TINYBLOB: "bytes",
  MEDIUMBLOB: "bytes",
  LONGBLOB: "bytes",
  BINARY: "bytes",
  VARBINARY: "bytes",
  BYTEA: "bytes",
  IMAGE: "bytes",
  RAW: "bytes",
  BFILE: "bytes",
  VARBIT: "bytes",
  VECTOR: "repeated float",
  HALFVEC: "repeated float",
};
const UNSIGNED_TYPES = {
  int32: "uint32",
  int64: "uint64",
};
const DECIMAL_TYPES = ["DECIMAL", "NUMERIC", "NUMBER", "MONEY", "SMALLMONEY"];
const TIMESTAMP_TYPES = [
  "DATETIME",
  "DATETIME2",
  "SMALLDATETIME",
  "DATETIMEOFFSET",
  "TIMESTAMP",
  "TIMESTAMPTZ",
];
const JSON_TYPES = ["JSON", "JSONB"];
const UUID_TYPES = ["UUID", "UNIQUEIDENTIFIER"];

// Field numbers protobuf accepts: 1 to 2^29-1, minus its own 19000-19999.
const MAX_FIELD_NUMBER = 536870911;
const isValidFieldNumber = (n) =>
  Number.isInteger(n) &&
  n >= 1 &&
  n <= MAX_FIELD_NUMBER &&
  (n < 19000 || n > 19999);

const RESERVED = new Set([
  "syntax",
  "import",
  "weak",
  "public",
  "package",
  "option",
  "message",
  "enum",
  "service",
  "rpc",
  "returns",
  "stream",
  "reserved",
  "extensions",
  "to",
  "max",
  "map",
  "oneof",
  "optional",
  "repeated",
  "required",
  "true",
  "false",
  "inf",
  "nan",
]);

function words(name) {
  return String(name ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

const capitalize = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

function sanitizeIdentifier(name, fallback, digitPrefix) {
  let result = String(name ?? "").replace(/[^A-Za-z0-9_]/g, "_");
  if (!result) result = fallback;
  if (/^[0-9]/.test(result)) result = `${digitPrefix}${result}`;
  if (RESERVED.has(result)) result = `${result}_`;
  return result;
}

export function singularize(word) {
  if (/ies$/i.test(word))
    return word.replace(/ies$/i, (m) => (m[0] === "I" ? "Y" : "y"));
  if (/(ss|us|is)$/i.test(word)) return word;
  if (/(xes|ches|shes|sses|zes)$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word)) return word.slice(0, -1);
  return word;
}

function pluralize(word) {
  if (/(s|x|z|ch|sh)$/i.test(word))
    return /s$/i.test(word) ? word : `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

function caseName(name, style) {
  const w = words(name);
  switch (style) {
    case "pascal":
      return w.map(capitalize).join("");
    case "camel":
      return w
        .map((x, i) => (i === 0 ? x.toLowerCase() : capitalize(x)))
        .join("");
    case "snake":
      return w.map((x) => x.toLowerCase()).join("_");
    case "upper_snake":
      return w.map((x) => x.toUpperCase()).join("_");
    default:
      return String(name ?? "");
  }
}

// The JSON name protoc derives from a field name (underscores dropped, the
// next character upper-cased); two fields of a message must not share it.
function jsonName(name) {
  let result = "";
  let upper = false;
  for (const char of name) {
    if (char === "_") upper = true;
    else {
      result += upper ? char.toUpperCase() : char;
      upper = false;
    }
  }
  return result;
}

function packageName(text, fallback) {
  const segments = String(text ?? "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      let clean = segment.replace(/[^A-Za-z0-9_]/g, "_");
      if (/^[0-9]/.test(clean)) clean = `p_${clean}`;
      return RESERVED.has(clean) ? `${clean}_` : clean;
    });
  return segments.length ? segments.join(".") : fallback;
}

function packageFromTitle(title) {
  const result = caseName(title, "snake");
  if (!result) return "drawdb";
  return /^[0-9]/.test(result) ? `p_${result}` : result;
}

const protoString = (text) =>
  `"${String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Gives every table field without a valid saved number the number the export
 * would use, so the diagram can store it and keep it from now on. Returns the
 * tables unchanged when nothing needs a number.
 */
export function assignProtoNumbers(tables) {
  let changed = false;
  const result = (tables ?? []).map((table) => {
    // Same rules as the export: valid saved numbers stay (a field using a
    // reserved number again, after an undo, keeps it), the rest get the next
    // number after every used or reserved one.
    const used = new Set();
    const fields = table.fields.map((field) => {
      const n = Number(field.protoNumber);
      if (isValidFieldNumber(n) && !used.has(n)) {
        used.add(n);
        return field;
      }
      return { ...field, protoNumber: undefined };
    });
    const reserved = (table.protoReserved ?? [])
      .map(Number)
      .filter((n) => isValidFieldNumber(n) && !used.has(n));
    let next = Math.max(0, ...used, ...reserved) + 1;
    const numbered = fields.map((field) => {
      if (field.protoNumber !== undefined) return field;
      while (!isValidFieldNumber(next) || used.has(next)) next += 1;
      used.add(next);
      changed = true;
      return { ...field, protoNumber: next++ };
    });
    return numbered.some((f, i) => f !== table.fields[i])
      ? { ...table, fields: numbered }
      : table;
  });
  return changed ? result : tables;
}

export function generateProtobuf(obj, userOptions = {}) {
  const o = normalizeProtobufOptions(userOptions);
  const issues = [];
  const report = (level, code, params = {}) =>
    issues.push({ level, code, params });
  const imports = new Set();
  const tables = obj.tables ?? [];
  const relationships = obj.relationships ?? obj.references ?? [];
  const enums = obj.enums ?? [];
  const types = obj.types ?? [];
  const zeroName = sanitizeIdentifier(
    caseName(o.enumZeroName || "UNSPECIFIED", "upper_snake"),
    "UNSPECIFIED",
    "V_",
  );

  // Top-level names share one scope in a .proto file: messages, enums,
  // services and the values of top-level enums.
  const topLevel = new Set();
  const claim = (scope, name, kind) => {
    let candidate = name;
    let counter = 2;
    while (scope.has(candidate)) candidate = `${name}${counter++}`;
    scope.add(candidate);
    if (candidate !== name) {
      report("warning", "name_clash", { kind, name, newName: candidate });
    }
    return candidate;
  };

  const comment = (text, indent) =>
    o.includeComments && text && String(text).trim()
      ? String(text)
          .trim()
          .split(/\r?\n/)
          .map((l) => `${indent}// ${l}`.trimEnd())
          .join("\n") + "\n"
      : "";

  const baseMessageName = (name) => {
    let base = String(name ?? "");
    if (o.singularizeMessages) {
      const parts = base.split(/([^A-Za-z0-9]+)/);
      let i = parts.length - 1;
      while (i > 0 && !/[A-Za-z]/.test(parts[i])) i--;
      parts[i] = singularize(parts[i]);
      base = parts.join("");
    }
    const cased = o.messageCase === "pascal" ? caseName(base, "pascal") : base;
    return sanitizeIdentifier(cased + (o.messageSuffix ?? ""), "Unnamed", "M");
  };
  const baseTypeName = (name) =>
    sanitizeIdentifier(
      o.messageCase === "pascal" ? caseName(name, "pascal") : name,
      "Unnamed",
      "M",
    );
  const fieldName = (name) =>
    sanitizeIdentifier(
      o.fieldCase === "original" ? name : caseName(name, o.fieldCase),
      "field",
      "f_",
    );

  const use = (type) => {
    const base = type.replace(/^repeated /, "");
    if (IMPORTS[base]) {
      if (!imports.has(IMPORTS[base]) && base === "google.type.Date") {
        report("info", "google_date");
      }
      imports.add(IMPORTS[base]);
    }
    return type;
  };

  /**
   * Enum values follow C++ scoping: they live next to the enum, so values of
   * every enum in the same scope must differ. The zero value is always
   * prefixed; the rest are prefixed when asked or when they would collide.
   */
  function enumBlock(name, values, indent, protoName, scope) {
    const prefix = `${caseName(name, "upper_snake") || "ENUM"}_`;
    const constants = (values ?? []).map((value) =>
      sanitizeIdentifier(
        caseName(value, "upper_snake") || "VALUE",
        "VALUE",
        "V_",
      ),
    );
    const plain =
      o.enumValueStyle === "plain" &&
      constants.every((c, i) => !scope.has(c) && constants.indexOf(c) === i);
    if (o.enumValueStyle === "plain" && !plain) {
      report("warning", "enum_values_prefixed", { name: protoName });
    }
    const lines = [
      `${indent}  ${claim(scope, `${prefix}${zeroName}`, "Enum value")} = 0;`,
    ];
    (values ?? []).forEach((value, i) => {
      let constant = plain ? constants[i] : `${prefix}${constants[i]}`;
      if (/^[0-9]/.test(constant)) constant = `V_${constant}`;
      while (scope.has(constant)) constant += "_";
      scope.add(constant);
      const original =
        o.includeComments && caseName(value, "upper_snake") !== String(value)
          ? ` // '${String(value).replace(/\r?\n/g, " ")}'`
          : "";
      lines.push(`${indent}  ${constant} = ${i + 1};${original}`);
    });
    return `${indent}enum ${protoName} {\n${lines.join("\n")}\n${indent}}`;
  }

  const enumByName = new Map(
    enums.map((e) => [String(e.name).toUpperCase(), e]),
  );
  const typeByName = new Map(
    types.map((t) => [String(t.name).toUpperCase(), t]),
  );

  // Names of top-level definitions, decided before any message refers to
  // them. Tables come first so that, on a clash, they keep their name.
  const tableNames = new Map(
    tables.map((t) => [t, claim(topLevel, baseMessageName(t.name), "Message")]),
  );
  const typeNames = new Map(
    types.map((t) => [t, claim(topLevel, baseTypeName(t.name), "Message")]),
  );
  const enumNames = new Map(
    enums.map((e) => [e, claim(topLevel, baseTypeName(e.name), "Enum")]),
  );

  function resolveType(field, nested) {
    const sql = String(field.type ?? "").toUpperCase();
    if (enumByName.has(sql)) return enumNames.get(enumByName.get(sql));
    if (typeByName.has(sql)) return typeNames.get(typeByName.get(sql));
    if ((sql === "ENUM" || sql === "SET") && field.values?.length) {
      // Nested enum types are always PascalCase and must not clash with the
      // field that uses them (e.g. field "size" with "Keep original" names).
      let name = sanitizeIdentifier(
        caseName(field.name, "pascal"),
        "Value",
        "E",
      );
      if (name === fieldName(field.name)) name += "Enum";
      name = claim(nested.names, name, "Enum");
      nested.blocks.push(
        enumBlock(field.name, field.values, "  ", name, nested.names),
      );
      return sql === "SET" ? `repeated ${name}` : name;
    }
    if (sql === "BIT" && Number(field.size) > 1) return "bytes";
    if (DECIMAL_TYPES.includes(sql)) return o.decimalAs;
    if (TIMESTAMP_TYPES.includes(sql)) {
      if (o.timestampAs === "int64") return "int64";
      if (o.timestampAs === "string") return "string";
      return use("google.protobuf.Timestamp");
    }
    if (sql === "DATE") {
      return o.dateAs === "google_date" ? use("google.type.Date") : "string";
    }
    if (JSON_TYPES.includes(sql)) {
      if (o.jsonAs === "struct") return use("google.protobuf.Struct");
      if (o.jsonAs === "string") return "string";
      return use("google.protobuf.Value");
    }
    if (UUID_TYPES.includes(sql)) return o.uuidAs;
    const base = BASE_TYPES[sql] ?? "string";
    if (field.unsigned && o.unsignedAs === "uint" && UNSIGNED_TYPES[base]) {
      return UNSIGNED_TYPES[base];
    }
    return base;
  }

  // "tableId:fieldId" -> "Message.field" for foreign key comments
  const fkTargets = new Map();
  relationships.forEach((r) => {
    const start = tables.find((t) => t.id === r.startTableId);
    const end = tables.find((t) => t.id === r.endTableId);
    const pairs =
      Array.isArray(r.fields) && r.fields.length
        ? r.fields
        : [{ startFieldId: r.startFieldId, endFieldId: r.endFieldId }];
    for (const pair of pairs) {
      const sf = start?.fields.find((f) => f.id === pair.startFieldId);
      const ef = end?.fields.find((f) => f.id === pair.endFieldId);
      if (sf && ef) {
        fkTargets.set(
          `${start.id}:${sf.id}`,
          `${tableNames.get(end)}.${fieldName(ef.name)}`,
        );
      }
    }
  });

  let unsavedNumbers = 0;
  function fieldNumbers(owner, fields, isTable, message) {
    if (!isTable || o.fieldNumbers === "position") {
      return { numbers: fields.map((_, i) => i + 1), reserved: [] };
    }
    const reserved = new Set(
      (owner.protoReserved ?? [])
        .map(Number)
        .filter((n) => isValidFieldNumber(n)),
    );
    const used = new Set();
    const invalid = new Set();
    const saved = fields.map((field, i) => {
      if (field.protoNumber === undefined || field.protoNumber === null) {
        return null;
      }
      const n = Number(field.protoNumber);
      if (isValidFieldNumber(n) && !used.has(n)) {
        used.add(n);
        return n;
      }
      invalid.add(i);
      return null;
    });
    // A reserved number that a field uses again (say, after an undo) is in use.
    for (const n of used) reserved.delete(n);
    let next = Math.max(0, ...used, ...reserved) + 1;
    const numbers = saved.map((n, i) => {
      if (n !== null) return n;
      while (!isValidFieldNumber(next) || used.has(next)) next += 1;
      used.add(next);
      if (invalid.has(i)) {
        report("warning", "number_invalid", {
          message,
          field: fields[i].name,
          number: fields[i].protoNumber,
          newNumber: next,
        });
      } else {
        unsavedNumbers += 1;
      }
      return next++;
    });
    return { numbers, reserved: [...reserved].sort((a, b) => a - b) };
  }

  function messageBlock(name, owner, fields, isTable) {
    const nested = { names: new Set(), blocks: [] };
    const usedNames = new Set();
    const usedJson = new Map();
    const resolved = [];
    const { numbers, reserved } = fieldNumbers(owner, fields, isTable, name);
    const lines = fields.map((field, i) => {
      let type = resolveType(field, nested);
      if (field.isArray && !type.startsWith("repeated "))
        type = `repeated ${type}`;
      const optional =
        o.nullableAsOptional &&
        isTable &&
        !field.notNull &&
        !field.primary &&
        !type.startsWith("repeated ");
      let fname = fieldName(field.name);
      while (usedNames.has(fname) || nested.names.has(fname)) fname += "_";
      const original = fname;
      for (
        let n = 2;
        usedJson.has(jsonName(fname)) || usedNames.has(fname);
        n++
      ) {
        fname = `${original}${n}`;
      }
      if (original !== fname) {
        report("warning", "json_name_clash", {
          message: name,
          field: field.name,
          newName: fname,
        });
      }
      usedNames.add(fname);
      usedJson.set(jsonName(fname), fname);
      resolved.push({ field, type, name: fname });

      const notes = [];
      if (o.includeConstraintComments && isTable) {
        if (field.primary) notes.push("primary key");
        if (field.unique && !field.primary) notes.push("unique");
        if (field.increment) notes.push("auto increment");
        const fk = fkTargets.get(`${owner.id}:${field.id}`);
        if (fk) notes.push(`references ${fk}`);
        const value = String(field.default ?? "").trim();
        if (value) notes.push(`default ${value.replace(/\r?\n/g, " ")}`);
      }
      const trailing = notes.length ? ` // ${notes.join(", ")}` : "";
      return `${comment(field.comment, "  ")}  ${optional ? "optional " : ""}${type} ${fname} = ${numbers[i]};${trailing}`;
    });
    const reservedLines = [];
    if (reserved.length) {
      reservedLines.push(`  reserved ${reserved.join(", ")};`);
    }
    const reservedNames = (owner.protoReservedNames ?? [])
      .map((n) => fieldName(n))
      .filter((n, i, all) => !usedNames.has(n) && all.indexOf(n) === i);
    if (isTable && reservedNames.length) {
      reservedLines.push(
        `  reserved ${reservedNames.map((n) => protoString(n)).join(", ")};`,
      );
    }
    const body = [
      ...nested.blocks,
      ...(nested.blocks.length ? [""] : []),
      ...reservedLines,
      ...(reservedLines.length ? [""] : []),
      ...lines,
    ].join("\n");
    return {
      text: `${comment(owner.comment, "")}message ${name} {\n${body}\n}`,
      resolved,
    };
  }

  function crudService(msg, resolved) {
    const pks = resolved.filter((r) => r.field.primary);
    const keys = pks.length ? pks : resolved.slice(0, 1);
    const keyFields = keys
      .map((k, i) => `  ${k.type} ${k.name} = ${i + 1};`)
      .join("\n");
    const snake = caseName(msg, "snake") || "item";
    const plural = pluralize(msg);
    const names = {
      service: claim(topLevel, `${msg}Service`, "Service"),
      get: claim(topLevel, `Get${msg}Request`, "Message"),
      listRequest: claim(topLevel, `List${plural}Request`, "Message"),
      listResponse: claim(topLevel, `List${plural}Response`, "Message"),
      create: claim(topLevel, `Create${msg}Request`, "Message"),
      update: claim(topLevel, `Update${msg}Request`, "Message"),
      delete: claim(topLevel, `Delete${msg}Request`, "Message"),
    };
    use("google.protobuf.Empty");
    return [
      `service ${names.service} {`,
      `  rpc Get${msg}(${names.get}) returns (${msg});`,
      `  rpc List${plural}(${names.listRequest}) returns (${names.listResponse});`,
      `  rpc Create${msg}(${names.create}) returns (${msg});`,
      `  rpc Update${msg}(${names.update}) returns (${msg});`,
      `  rpc Delete${msg}(${names.delete}) returns (google.protobuf.Empty);`,
      `}`,
      ``,
      `message ${names.get} {\n${keyFields}\n}`,
      ``,
      `message ${names.listRequest} {\n  int32 page_size = 1;\n  string page_token = 2;\n}`,
      ``,
      `message ${names.listResponse} {\n  repeated ${msg} ${caseName(plural, "snake") || "items"} = 1;\n  string next_page_token = 2;\n}`,
      ``,
      `message ${names.create} {\n  ${msg} ${snake} = 1;\n}`,
      ``,
      `message ${names.update} {\n  ${msg} ${snake} = 1;\n}`,
      ``,
      `message ${names.delete} {\n${keyFields}\n}`,
    ].join("\n");
  }

  const enumBlocks = enums.map((e) =>
    enumBlock(e.name, e.values, "", enumNames.get(e), topLevel),
  );
  const typeBlocks = types.map(
    (t) => messageBlock(typeNames.get(t), t, t.fields ?? [], false).text,
  );
  const tableBlocks = [];
  const serviceBlocks = [];
  tables.forEach((table) => {
    const msg = tableNames.get(table);
    const { text, resolved } = messageBlock(msg, table, table.fields, true);
    tableBlocks.push(text);
    if (o.service === "crud" && resolved.length) {
      serviceBlocks.push(crudService(msg, resolved));
    }
  });
  if (unsavedNumbers > 0 && o.fieldNumbers === "stored") {
    report("info", "numbers_not_saved", { count: unsavedNumbers });
  }

  const header = [
    `syntax = "proto3";`,
    "",
    `package ${packageName(o.packageName, packageFromTitle(obj.title))};`,
  ];
  if (imports.size)
    header.push("", ...[...imports].sort().map((i) => `import "${i}";`));
  const fileOptions = [];
  if (o.goPackage)
    fileOptions.push(`option go_package = ${protoString(o.goPackage)};`);
  if (o.javaPackage) {
    fileOptions.push(`option java_package = ${protoString(o.javaPackage)};`);
    if (o.javaMultipleFiles) {
      fileOptions.push(`option java_multiple_files = true;`);
    }
  }
  if (o.optimizeFor !== "default") {
    fileOptions.push(`option optimize_for = ${o.optimizeFor};`);
  }
  if (fileOptions.length) header.push("", ...fileOptions);

  const proto =
    [
      header.join("\n"),
      ...enumBlocks,
      ...typeBlocks,
      ...tableBlocks,
      ...serviceBlocks,
    ]
      .filter(Boolean)
      .join("\n\n") + "\n";
  return { proto, issues };
}

export function jsonToProtobuf(obj, userOptions = {}) {
  return generateProtobuf(obj, userOptions).proto;
}
