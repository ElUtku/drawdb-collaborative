import { Validator } from "jsonschema";
import { DB } from "../data/constants";
import { customTypeEntrySchema } from "../data/schemas";
import { dbToTypes } from "../data/datatypes";
import { customTypeApi } from "../api/diagrams";

const STORAGE_KEY = "custom_types";
const validator = new Validator();
const validDatabases = new Set(Object.values(DB));

function isValidEntry(entry) {
  return validator.validate(entry, customTypeEntrySchema).valid;
}

function migrateIfNeeded(parsed) {
  if (Array.isArray(parsed)) {
    const result = {};
    for (const item of parsed) {
      if (!item.type || !item.database) continue;
      const db = item.database;
      const name = item.type.toUpperCase();
      if (!validDatabases.has(db)) continue;
      if (!result[db]) result[db] = {};
      result[db][name] = { type: name, color: item.color || "#ccc" };
    }
    return result;
  }
  return parsed;
}

function sanitize(parsed) {
  if (typeof parsed !== "object" || parsed === null) return {};
  const result = {};
  for (const [db, types] of Object.entries(parsed)) {
    if (!validDatabases.has(db)) continue;
    if (typeof types !== "object" || types === null) continue;
    for (const [name, entry] of Object.entries(types)) {
      if (!isValidEntry(entry)) continue;
      if (!result[db]) result[db] = {};
      result[db][name] = { type: entry.type, color: entry.color };
    }
  }
  return result;
}

// Custom types live on the server and are shared by everyone on the instance.
// This module keeps the copy the editor reads synchronously, and tells
// components (useCustomTypesVersion) when it changes.
let cache = {};
let version = 0;
const listeners = new Set();

function publish(types) {
  cache = sanitize(types);
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeCustomTypes(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCustomTypesVersion() {
  return version;
}

function readLegacyLocalTypes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(migrateIfNeeded(JSON.parse(raw))) : {};
  } catch {
    return {};
  }
}

function forgetLegacyLocalTypes() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing to forget.
  }
}

const isEmpty = (types) =>
  Object.values(types).every((entries) => !Object.keys(entries).length);

/**
 * Loads the shared types. Types an earlier version kept in this browser are
 * added to the server once, then forgotten locally.
 */
export async function loadCustomTypes() {
  let types = await customTypeApi.get();
  const local = readLegacyLocalTypes();
  if (!isEmpty(local)) {
    const merged = sanitize(types);
    for (const [db, entries] of Object.entries(local)) {
      merged[db] = { ...entries, ...(merged[db] ?? {}) };
    }
    types = await customTypeApi.save(merged);
    forgetLegacyLocalTypes();
  }
  publish(types);
  return cache;
}

export function getCustomTypes() {
  return JSON.parse(JSON.stringify(cache));
}

export function getCustomTypesForDb(database) {
  const dbTypes = cache[database];
  if (!dbTypes) return {};
  const result = {};
  for (const [name, entry] of Object.entries(dbTypes)) {
    result[name] = {
      type: entry.type,
      color: entry.color,
      checkDefault: () => true,
      hasCheck: false,
      isSized: false,
      hasPrecision: false,
      canIncrement: false,
      noDefault: false,
      isCustom: true,
    };
  }
  return result;
}

/** Replaces the shared set; the editor shows the change at once. */
export async function saveCustomTypes(types) {
  const previous = cache;
  publish(types);
  try {
    publish(await customTypeApi.save(cache));
  } catch (error) {
    publish(previous);
    throw error;
  }
}

const BLOB_FALLBACK = {
  type: "BLOB",
  color: "",
  checkDefault: () => true,
  hasCheck: false,
  isSized: false,
  hasPrecision: false,
  canIncrement: false,
  noDefault: true,
  isCustom: false,
};

export function resolveType(database, typeName) {
  const builtIn = dbToTypes[database][typeName];
  if (builtIn) return builtIn;

  const customDb = getCustomTypesForDb(database);
  if (customDb[typeName]) return customDb[typeName];

  return dbToTypes[database]["BLOB"] || BLOB_FALLBACK;
}

export async function mergeCustomTypes(incoming) {
  if (typeof incoming !== "object" || incoming === null) return;
  const existing = getCustomTypes();
  for (const [db, types] of Object.entries(incoming)) {
    if (!validDatabases.has(db)) continue;
    if (typeof types !== "object" || types === null) continue;
    if (!existing[db]) existing[db] = {};
    for (const [name, entry] of Object.entries(types)) {
      if (!isValidEntry(entry)) continue;
      if (!existing[db][name]) {
        existing[db][name] = { type: entry.type, color: entry.color };
      }
    }
  }
  await saveCustomTypes(existing);
}
