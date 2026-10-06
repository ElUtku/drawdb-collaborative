import { DB } from "../../data/constants";
import { buildModel } from "./model";
import { normalizeSqlOptions } from "./options";
import { renderModel } from "./render";

export { formatIssue, ISSUE_MESSAGES } from "./issues";
export {
  defaultSqlOptions,
  normalizeSqlOptions,
  sqlOptionDefsFor,
  SQL_OPTION_DEFS,
} from "./options";

/**
 * Generates the DDL of `diagram` for `dialect` (by default the diagram's own
 * database; a generic diagram needs one). Returns the script and the problems
 * found while building it.
 */
export function generateSQL(diagram, { dialect, options } = {}) {
  const target = dialect ?? diagram?.database;
  if (!target || target === DB.GENERIC) return { sql: "", issues: [] };
  const model = buildModel(
    diagram,
    target,
    normalizeSqlOptions(target, options),
  );
  const sql = renderModel(model);
  return { sql: sql ? `${sql}\n` : "", issues: model.issues };
}

export function exportSQL(diagram, options) {
  return generateSQL(diagram, { options }).sql;
}

export { generateMigration } from "./migration";
export {
  defaultMigrationOptions,
  migrationOptionDefsFor,
  normalizeMigrationOptions,
} from "./options";
