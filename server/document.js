// Shape check for diagram documents, done before anything is stored or sent
// to the other people editing. A faulty or hostile client must not be able to
// save a document that breaks the editor for everyone else. Unknown properties
// are kept (newer clients may add some); known ones must have the right type.

const LIMITS = {
  tables: 5_000,
  fields: 2_000,
  references: 20_000,
  notes: 5_000,
  areas: 5_000,
  enums: 2_000,
  types: 2_000,
  values: 5_000,
  name: 512,
  type: 256,
  text: 20_000,
  noteContent: 200_000,
  small: 4_096,
};

class DocumentError extends Error {}

function fail(path, message) {
  throw new DocumentError(`${path}: ${message}`);
}

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const present = (value) => value !== undefined && value !== null;

function object(value, path) {
  if (!isObject(value)) fail(path, "must be an object");
  return value;
}

function array(value, path, max) {
  if (!present(value)) return [];
  if (!Array.isArray(value)) fail(path, "must be a list");
  if (value.length > max) fail(path, `has more than ${max} entries`);
  return value;
}

function string(value, path, max, { required = false } = {}) {
  if (!present(value)) {
    if (required) fail(path, "is required");
    return;
  }
  if (typeof value !== "string") fail(path, "must be text");
  if (value.length > max) fail(path, `is longer than ${max} characters`);
}

function id(value, path) {
  if (typeof value === "string") {
    if (value.length === 0 || value.length > 128)
      fail(path, "is not a valid id");
    return;
  }
  if (!Number.isSafeInteger(value)) fail(path, "is not a valid id");
}

function optionalId(value, path) {
  if (present(value)) id(value, path);
}

function boolean(value, path) {
  if (present(value) && typeof value !== "boolean") {
    fail(path, "must be true or false");
  }
}

function number(value, path) {
  if (present(value) && !Number.isFinite(value)) fail(path, "must be a number");
}

function strings(value, path, maxItems, maxLength) {
  array(value, path, maxItems).forEach((item, i) =>
    string(item, `${path}[${i}]`, maxLength, { required: true }),
  );
}

function scalar(value, path, max) {
  if (!present(value)) return;
  if (typeof value === "string") string(value, path, max);
  else if (typeof value !== "number" && typeof value !== "boolean") {
    fail(path, "must be text, a number or true/false");
  }
}

function field(value, path) {
  object(value, path);
  id(value.id, `${path}.id`);
  string(value.name, `${path}.name`, LIMITS.name, { required: true });
  string(value.type, `${path}.type`, LIMITS.type);
  scalar(value.default, `${path}.default`, LIMITS.small);
  string(value.check, `${path}.check`, LIMITS.small);
  string(value.comment, `${path}.comment`, LIMITS.text);
  scalar(value.size, `${path}.size`, 64);
  for (const flag of [
    "primary",
    "unique",
    "notNull",
    "increment",
    "unsigned",
    "isArray",
  ]) {
    boolean(value[flag], `${path}.${flag}`);
  }
  strings(value.values, `${path}.values`, LIMITS.values, LIMITS.name);
  if (present(value.protoNumber) && !Number.isSafeInteger(value.protoNumber)) {
    fail(`${path}.protoNumber`, "must be a whole number");
  }
}

function keyList(value, path) {
  array(value, path, 1_000).forEach((entry, i) => {
    const at = `${path}[${i}]`;
    object(entry, at);
    string(entry.name, `${at}.name`, LIMITS.name);
    boolean(entry.unique, `${at}.unique`);
    strings(entry.fields, `${at}.fields`, LIMITS.fields, LIMITS.name);
  });
}

function table(value, path) {
  object(value, path);
  id(value.id, `${path}.id`);
  string(value.name, `${path}.name`, LIMITS.name, { required: true });
  string(value.comment, `${path}.comment`, LIMITS.text);
  string(value.color, `${path}.color`, 64);
  number(value.x, `${path}.x`);
  number(value.y, `${path}.y`);
  for (const flag of ["locked", "hidden", "collapsed"]) {
    boolean(value[flag], `${path}.${flag}`);
  }
  array(value.fields, `${path}.fields`, LIMITS.fields).forEach((entry, i) =>
    field(entry, `${path}.fields[${i}]`),
  );
  keyList(value.indices, `${path}.indices`);
  keyList(value.uniqueConstraints, `${path}.uniqueConstraints`);
  strings(value.inherits, `${path}.inherits`, 100, LIMITS.name);
  array(value.protoReserved, `${path}.protoReserved`, 10_000).forEach(
    (n, i) => {
      if (!Number.isSafeInteger(n))
        fail(`${path}.protoReserved[${i}]`, "must be a whole number");
    },
  );
  strings(
    value.protoReservedNames,
    `${path}.protoReservedNames`,
    10_000,
    LIMITS.name,
  );
}

function reference(value, path) {
  object(value, path);
  optionalId(value.id, `${path}.id`);
  id(value.startTableId, `${path}.startTableId`);
  id(value.endTableId, `${path}.endTableId`);
  optionalId(value.startFieldId, `${path}.startFieldId`);
  optionalId(value.endFieldId, `${path}.endFieldId`);
  string(value.name, `${path}.name`, LIMITS.name);
  for (const key of ["cardinality", "updateConstraint", "deleteConstraint"]) {
    string(value[key], `${path}.${key}`, 64);
  }
  array(value.fields, `${path}.fields`, LIMITS.fields).forEach((pair, i) => {
    const at = `${path}.fields[${i}]`;
    object(pair, at);
    id(pair.startFieldId, `${at}.startFieldId`);
    id(pair.endFieldId, `${at}.endFieldId`);
  });
}

function note(value, path) {
  object(value, path);
  optionalId(value.id, `${path}.id`);
  string(value.title, `${path}.title`, LIMITS.name);
  string(value.content, `${path}.content`, LIMITS.noteContent);
  string(value.color, `${path}.color`, 64);
  for (const key of ["x", "y", "width", "height"]) {
    number(value[key], `${path}.${key}`);
  }
  boolean(value.locked, `${path}.locked`);
}

function area(value, path) {
  object(value, path);
  optionalId(value.id, `${path}.id`);
  string(value.name, `${path}.name`, LIMITS.name);
  string(value.color, `${path}.color`, 64);
  for (const key of ["x", "y", "width", "height"]) {
    number(value[key], `${path}.${key}`);
  }
  boolean(value.locked, `${path}.locked`);
}

function enumType(value, path) {
  object(value, path);
  string(value.name, `${path}.name`, LIMITS.name, { required: true });
  strings(value.values, `${path}.values`, LIMITS.values, LIMITS.name);
}

function compositeType(value, path) {
  object(value, path);
  string(value.name, `${path}.name`, LIMITS.name, { required: true });
  string(value.comment, `${path}.comment`, LIMITS.text);
  array(value.fields, `${path}.fields`, LIMITS.fields).forEach((entry, i) => {
    const at = `${path}.fields[${i}]`;
    object(entry, at);
    string(entry.name, `${at}.name`, LIMITS.name);
    string(entry.type, `${at}.type`, LIMITS.type);
    strings(entry.values, `${at}.values`, LIMITS.values, LIMITS.name);
  });
}

/**
 * Throws a DocumentError naming the first problem, e.g.
 * "tables[2].fields[0].name: must be text".
 */
export function assertValidDocument(document) {
  object(document, "document");
  string(document.database, "database", 32);
  string(document.title, "title", LIMITS.name);
  array(document.tables, "tables", LIMITS.tables).forEach((entry, i) =>
    table(entry, `tables[${i}]`),
  );
  for (const key of ["references", "relationships"]) {
    array(document[key], key, LIMITS.references).forEach((entry, i) =>
      reference(entry, `${key}[${i}]`),
    );
  }
  array(document.notes, "notes", LIMITS.notes).forEach((entry, i) =>
    note(entry, `notes[${i}]`),
  );
  for (const key of ["areas", "subjectAreas"]) {
    array(document[key], key, LIMITS.areas).forEach((entry, i) =>
      area(entry, `${key}[${i}]`),
    );
  }
  array(document.enums, "enums", LIMITS.enums).forEach((entry, i) =>
    enumType(entry, `enums[${i}]`),
  );
  array(document.types, "types", LIMITS.types).forEach((entry, i) =>
    compositeType(entry, `types[${i}]`),
  );
  if (present(document.pan)) {
    object(document.pan, "pan");
    number(document.pan.x, "pan.x");
    number(document.pan.y, "pan.y");
  }
  number(document.zoom, "zoom");
  if (present(document.zoom) && document.zoom <= 0) {
    fail("zoom", "must be positive");
  }
}

/** The reason a document is rejected, or null when it is fine. */
export function documentProblem(document) {
  try {
    assertValidDocument(document);
    return null;
  } catch (error) {
    if (error instanceof DocumentError) return error.message;
    throw error;
  }
}
