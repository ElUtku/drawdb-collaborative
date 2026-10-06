// Export a drawDB diagram as a Protocol Buffers (proto3) schema.
//
// Tables become messages, columns become fields, enums and composite types
// become proto enums and messages. Every naming or mapping decision is driven
// by `options` (see defaultProtobufOptions), which the export dialog exposes
// in its "Advanced" section.

export const defaultProtobufOptions = {
  packageName: "", // empty = derived from the diagram title
  goPackage: "",
  javaPackage: "",
  messageCase: "pascal", // pascal | original
  singularizeMessages: false,
  messageSuffix: "",
  fieldCase: "snake", // snake | camel | original
  enumValueStyle: "prefixed", // prefixed | plain
  nullableAsOptional: true,
  decimalAs: "string", // string | double
  timestampAs: "timestamp", // timestamp | int64 | string
  dateAs: "string", // string | google_date
  jsonAs: "value", // value | struct | string
  uuidAs: "string", // string | bytes
  includeComments: true,
  includeConstraintComments: true,
  service: "none", // none | crud
};

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
const DECIMAL_TYPES = ["DECIMAL", "NUMERIC", "NUMBER", "MONEY", "SMALLMONEY"];
const TIMESTAMP_TYPES = [
  "DATETIME",
  "SMALLDATETIME",
  "DATETIMEOFFSET",
  "TIMESTAMP",
  "TIMESTAMPTZ",
];
const JSON_TYPES = ["JSON", "JSONB"];
const UUID_TYPES = ["UUID", "UNIQUEIDENTIFIER"];

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

function packageFromTitle(title) {
  const result = caseName(title, "snake");
  if (!result) return "drawdb";
  return /^[0-9]/.test(result) ? `p_${result}` : result;
}

export function jsonToProtobuf(obj, userOptions = {}) {
  const o = { ...defaultProtobufOptions, ...userOptions };
  const imports = new Set();
  const tables = obj.tables ?? [];
  const relationships = obj.relationships ?? [];
  const enums = obj.enums ?? [];
  const types = obj.types ?? [];

  const comment = (text, indent) =>
    o.includeComments && text && String(text).trim()
      ? String(text)
          .trim()
          .split(/\r?\n/)
          .map((l) => `${indent}// ${l}`.trimEnd())
          .join("\n") + "\n"
      : "";

  const messageName = (name) => {
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
  const typeName = (name) =>
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
    if (IMPORTS[base]) imports.add(IMPORTS[base]);
    return type;
  };

  function enumBlock(name, values, indent, protoName = typeName(name)) {
    const prefix =
      o.enumValueStyle === "prefixed"
        ? `${caseName(name, "upper_snake") || "ENUM"}_`
        : "";
    const used = new Set([`${prefix}UNSPECIFIED`]);
    const lines = [`${indent}  ${prefix}UNSPECIFIED = 0;`];
    (values ?? []).forEach((value, i) => {
      let constant = sanitizeIdentifier(
        `${prefix}${caseName(value, "upper_snake") || "VALUE"}`,
        "VALUE",
        "V_",
      );
      while (used.has(constant)) constant += "_";
      used.add(constant);
      const original =
        o.includeComments && caseName(value, "upper_snake") !== String(value)
          ? ` // '${value}'`
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

  function resolveType(field, nestedEnums) {
    const sql = String(field.type ?? "").toUpperCase();
    if (enumByName.has(sql)) return typeName(enumByName.get(sql).name);
    if (typeByName.has(sql)) return typeName(typeByName.get(sql).name);
    if ((sql === "ENUM" || sql === "SET") && field.values?.length) {
      // Nested enum types are always PascalCase and must not clash with the
      // field that uses them (e.g. field "size" with "Keep original" names).
      let name = sanitizeIdentifier(
        caseName(field.name, "pascal"),
        "Value",
        "E",
      );
      if (name === fieldName(field.name)) name += "Enum";
      nestedEnums.push(enumBlock(field.name, field.values, "  ", name));
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
    return BASE_TYPES[sql] ?? "string";
  }

  // "tableId:fieldId" -> "Message.field" for foreign key comments
  const fkTargets = new Map();
  relationships.forEach((r) => {
    const start = tables.find((t) => t.id === r.startTableId);
    const end = tables.find((t) => t.id === r.endTableId);
    const sf = start?.fields.find((f) => f.id === r.startFieldId);
    const ef = end?.fields.find((f) => f.id === r.endFieldId);
    if (sf && ef) {
      fkTargets.set(
        `${start.id}:${sf.id}`,
        `${messageName(end.name)}.${fieldName(ef.name)}`,
      );
    }
  });

  function messageBlock(name, owner, fields, isTable) {
    const nestedEnums = [];
    const used = new Set();
    const resolved = [];
    const lines = fields.map((field, i) => {
      let type = resolveType(field, nestedEnums);
      if (field.isArray && !type.startsWith("repeated "))
        type = `repeated ${type}`;
      const optional =
        o.nullableAsOptional &&
        isTable &&
        !field.notNull &&
        !field.primary &&
        !type.startsWith("repeated ");
      let fname = fieldName(field.name);
      while (used.has(fname)) fname += "_";
      used.add(fname);
      resolved.push({ field, type, name: fname });

      const notes = [];
      if (o.includeConstraintComments && isTable) {
        if (field.primary) notes.push("primary key");
        if (field.unique && !field.primary) notes.push("unique");
        if (field.increment) notes.push("auto increment");
        const fk = fkTargets.get(`${owner.id}:${field.id}`);
        if (fk) notes.push(`references ${fk}`);
      }
      const trailing = notes.length ? ` // ${notes.join(", ")}` : "";
      return `${comment(field.comment, "  ")}  ${optional ? "optional " : ""}${type} ${fname} = ${i + 1};${trailing}`;
    });
    const body = [
      ...nestedEnums,
      ...(nestedEnums.length ? [""] : []),
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
    const snake = caseName(msg, "snake");
    const plural = pluralize(msg);
    use("google.protobuf.Empty");
    return [
      `service ${msg}Service {`,
      `  rpc Get${msg}(Get${msg}Request) returns (${msg});`,
      `  rpc List${plural}(List${plural}Request) returns (List${plural}Response);`,
      `  rpc Create${msg}(Create${msg}Request) returns (${msg});`,
      `  rpc Update${msg}(Update${msg}Request) returns (${msg});`,
      `  rpc Delete${msg}(Delete${msg}Request) returns (google.protobuf.Empty);`,
      `}`,
      ``,
      `message Get${msg}Request {\n${keyFields}\n}`,
      ``,
      `message List${plural}Request {\n  int32 page_size = 1;\n  string page_token = 2;\n}`,
      ``,
      `message List${plural}Response {\n  repeated ${msg} ${caseName(plural, "snake")} = 1;\n  string next_page_token = 2;\n}`,
      ``,
      `message Create${msg}Request {\n  ${msg} ${snake} = 1;\n}`,
      ``,
      `message Update${msg}Request {\n  ${msg} ${snake} = 1;\n}`,
      ``,
      `message Delete${msg}Request {\n${keyFields}\n}`,
    ].join("\n");
  }

  const enumBlocks = enums.map((e) => enumBlock(e.name, e.values, ""));
  const typeBlocks = types.map(
    (t) => messageBlock(typeName(t.name), t, t.fields ?? [], false).text,
  );
  const tableBlocks = [];
  const serviceBlocks = [];
  tables.forEach((table) => {
    const msg = messageName(table.name);
    const { text, resolved } = messageBlock(msg, table, table.fields, true);
    tableBlocks.push(text);
    if (o.service === "crud" && resolved.length) {
      serviceBlocks.push(crudService(msg, resolved));
    }
  });

  const header = [
    `syntax = "proto3";`,
    "",
    `package ${o.packageName?.trim() || packageFromTitle(obj.title)};`,
  ];
  if (imports.size)
    header.push("", ...[...imports].sort().map((i) => `import "${i}";`));
  const fileOptions = [];
  if (o.goPackage?.trim())
    fileOptions.push(`option go_package = "${o.goPackage.trim()}";`);
  if (o.javaPackage?.trim()) {
    fileOptions.push(`option java_package = "${o.javaPackage.trim()}";`);
    fileOptions.push(`option java_multiple_files = true;`);
  }
  if (fileOptions.length) header.push("", ...fileOptions);

  return (
    [
      header.join("\n"),
      ...enumBlocks,
      ...typeBlocks,
      ...tableBlocks,
      ...serviceBlocks,
    ]
      .filter(Boolean)
      .join("\n\n") + "\n"
  );
}
