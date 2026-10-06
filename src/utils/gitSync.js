import { DB } from "../data/constants";
import { generateSQL } from "./exportSQL";
import { loadExportOptions } from "./exportPreferences";

/**
 * The DDL that gets committed next to the diagram, written with the settings
 * last used in the SQL export dialog. A generic diagram has no dialect to
 * render, and a half-built schema can make a generator throw, so a failure
 * here only means the commit carries the JSON document alone.
 */
export function buildSchemaSql(document) {
  if (!document?.database || document.database === DB.GENERIC) return undefined;
  try {
    const { sql } = generateSQL(
      {
        tables: document.tables ?? [],
        references: document.references ?? [],
        types: document.types ?? [],
        enums: document.enums ?? [],
        database: document.database,
      },
      { options: loadExportOptions(`sql.${document.database}`) },
    );
    return sql?.trim() ? sql : undefined;
  } catch (error) {
    console.warn("git sync: SQL export failed:", error);
    return undefined;
  }
}
