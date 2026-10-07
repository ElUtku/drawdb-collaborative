// Custom column types (say GEOGRAPHY or CITEXT) shared by everyone on the
// instance, per database dialect.

const DATABASES = new Set([
  "generic",
  "mysql",
  "postgresql",
  "sqlite",
  "mariadb",
  "transactsql",
  "oraclesql",
]);
const TYPE_NAME = /^[A-Za-z_][A-Za-z0-9_ (),.]{0,63}$/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|[a-z]+(-[a-z]+)*(-[0-9]{2,3})?)$/;
const MAX_TYPES = 500;

/**
 * Checks a full set of custom types, { database: { NAME: { type, color } } },
 * and returns it normalized, or throws with the reason.
 */
export function normalizeCustomTypes(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Custom types must be an object keyed by database");
  }
  const result = {};
  let count = 0;
  for (const [database, types] of Object.entries(input)) {
    if (!DATABASES.has(database)) {
      throw new Error(`Unknown database "${database}"`);
    }
    if (!types || typeof types !== "object" || Array.isArray(types)) {
      throw new Error(`Custom types of ${database} must be an object`);
    }
    for (const [key, entry] of Object.entries(types)) {
      const name = String(entry?.type ?? key)
        .trim()
        .toUpperCase();
      if (!TYPE_NAME.test(name)) {
        throw new Error(`"${name}" is not a valid type name`);
      }
      const color = String(entry?.color ?? "").trim();
      if (!COLOR.test(color)) {
        throw new Error(`The color of ${name} is not valid`);
      }
      count += 1;
      if (count > MAX_TYPES) throw new Error("Too many custom types");
      result[database] ??= {};
      result[database][name] = { type: name, color };
    }
  }
  return result;
}

export function createCustomTypeStore(db) {
  return {
    all() {
      const result = {};
      for (const row of db
        .prepare("SELECT database, name, color FROM custom_types ORDER BY name")
        .all()) {
        result[row.database] ??= {};
        result[row.database][row.name] = { type: row.name, color: row.color };
      }
      return result;
    },
    /** Replaces the whole set; returns the names added and removed. */
    replace: db.transaction((types, user) => {
      const before = new Set(
        db
          .prepare("SELECT database || ':' || name AS key FROM custom_types")
          .all()
          .map((row) => row.key),
      );
      db.prepare("DELETE FROM custom_types").run();
      const insert = db.prepare(
        "INSERT INTO custom_types (database, name, color, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)",
      );
      const now = new Date().toISOString();
      const after = new Set();
      for (const [database, entries] of Object.entries(types)) {
        for (const entry of Object.values(entries)) {
          insert.run(database, entry.type, entry.color, user?.id ?? null, now);
          after.add(`${database}:${entry.type}`);
        }
      }
      return {
        added: [...after].filter((key) => !before.has(key)),
        removed: [...before].filter((key) => !after.has(key)),
      };
    }),
  };
}
