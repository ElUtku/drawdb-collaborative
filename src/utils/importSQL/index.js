import { DB } from "../../data/constants";
import { arrangeTables } from "../arrangeTables";
import { fromMariaDB } from "./mariadb";
import { fromMSSQL } from "./mssql";
import { fromMySQL } from "./mysql";
import { fromOracleSQL } from "./oraclesql";
import { fromPostgres } from "./postgres";
import { fromSQLite } from "./sqlite";

export function importSQL(ast, toDb = DB.MYSQL, diagramDb = DB.GENERIC) {
  let diagram;
  switch (toDb) {
    case DB.SQLITE:
      diagram = fromSQLite(ast, diagramDb);
      break;
    case DB.MYSQL:
      diagram = fromMySQL(ast, diagramDb);
      break;
    case DB.POSTGRES:
      diagram = fromPostgres(ast, diagramDb);
      break;
    case DB.MARIADB:
      diagram = fromMariaDB(ast, diagramDb);
      break;
    case DB.MSSQL:
      diagram = fromMSSQL(ast, diagramDb);
      break;
    case DB.ORACLESQL:
      diagram = fromOracleSQL(ast, diagramDb);
      break;
    default:
      diagram = { tables: [], relationships: [] };
      break;
  }

  unescapeNames(diagram, toDb);
  arrangeTables(diagram);

  return diagram;
}

// The parsers keep a quote that is doubled inside a quoted name (`a``b`,
// "a""b", [a]]b]) as two characters.
function unescapeNames(diagram, database) {
  const doubled =
    database === DB.MYSQL || database === DB.MARIADB
      ? /``/g
      : database === DB.MSSQL
        ? /\]\]/g
        : /""/g;
  const single = database === DB.MSSQL ? "]" : doubled.source[0];
  const fix = (name) =>
    typeof name === "string" ? name.replace(doubled, single) : name;
  for (const table of diagram.tables ?? []) {
    table.name = fix(table.name);
    for (const field of table.fields ?? []) field.name = fix(field.name);
    for (const index of table.indices ?? []) {
      index.name = fix(index.name);
      index.fields = (index.fields ?? []).map(fix);
    }
    for (const unique of table.uniqueConstraints ?? []) {
      unique.name = fix(unique.name);
      unique.fields = (unique.fields ?? []).map(fix);
    }
  }
}
