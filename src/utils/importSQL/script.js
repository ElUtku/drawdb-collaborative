// A whole SQL script into a diagram, as the import dialog does it: the script
// is prepared (see prepare.js), parsed, imported, and what was set aside goes
// back on. The parsers are passed in so the caller decides how to load them.

import { DB } from "../../data/constants.js";
import { arrangeTables } from "../arrangeTables.js";
import { importSQL } from "./index.js";
import { normalizeSQLForParser } from "./normalize.js";
import { applyPrepared, applyTableChecks, prepareSQL } from "./prepare.js";

/**
 * Parses a script for `database`. Throws the parser's error (with its
 * `location`) when the script cannot be read.
 * @param {string} source
 * @param {{ database: string, Parser?: Function, OracleParser?: Function }} options
 *   Parser from node-sql-parser, OracleParser from oracle-sql-parser.
 */
export function parseScript(source, { database, Parser, OracleParser }) {
  const prepared = prepareSQL(source, database);
  if (database === DB.ORACLESQL) {
    return {
      ast: new OracleParser().parse(prepared.sql),
      extras: prepared.extras,
      exprToSQL: null,
    };
  }
  const parser = new Parser();
  return {
    ast: parser.astify(normalizeSQLForParser(prepared.sql, database), {
      database,
    }),
    extras: prepared.extras,
    exprToSQL: (expr) => parser.exprToSQL(expr, { database }),
  };
}

/** The diagram of a parsed script, for a diagram of `diagramDb`. */
export function diagramFromScript(parsed, database, diagramDb = database) {
  const diagram = importSQL(parsed.ast, database, diagramDb);
  // CHECK constraints are printed by the parser itself, so they keep their
  // meaning.
  if (parsed.exprToSQL) {
    applyTableChecks(diagram, parsed.ast, parsed.exprToSQL);
  }
  const result = applyPrepared(diagram, parsed.extras);
  // Relationships set aside by the preparation exist only now.
  arrangeTables(result);
  return result;
}

export function importScript(source, options) {
  return diagramFromScript(
    parseScript(source, options),
    options.database,
    options.diagramDb ?? options.database,
  );
}
