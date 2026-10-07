import { DB } from "../../data/constants";

function quoteColumn(str, db) {
  switch (db) {
    case DB.MYSQL:
      return `\`${str}\``;
    case DB.SQLITE:
      return `"${str}"`;
    case DB.POSTGRES:
      return `"${str}"`;
    case DB.MSSQL:
      return `[${str}]`;
    case DB.MARIADB:
      return `\`${str}\``;
  }
}

export function buildSQLFromAST(ast, db = DB.MYSQL) {
  if (ast.type === "binary_expr") {
    const leftSQL = buildSQLFromAST(ast.left, db);
    const rightSQL = buildSQLFromAST(ast.right, db);
    return `${leftSQL} ${ast.operator} ${rightSQL}`;
  }

  if (ast.type === "function") {
    let expr = "";
    expr = ast.name;
    if (ast.args) {
      expr +=
        "(" +
        ast.args.value
          .map((v) => {
            if (v.type === "column_ref") return "`" + v.column + "`";
            if (
              v.type === "single_quote_string" ||
              v.type === "double_quote_string"
            )
              return "'" + v.value + "'";
            return v.value;
          })
          .join(", ") +
        ")";
    }
    return expr;
  } else if (ast.type === "column_ref") {
    return quoteColumn(ast.column, db);
  } else if (ast.type === "expr_list") {
    return ast.value.map((v) => v.value).join(" AND ");
  } else {
    return typeof ast.value === "string" ? "'" + ast.value + "'" : ast.value;
  }
}

/**
 * The text of a literal DEFAULT as the parser gives it, unescaped: '' is a
 * quote everywhere, and MySQL/MariaDB also escape with a backslash.
 */
export function literalValue(node, db) {
  if (node.value === undefined || node.value === null) {
    return expressionText(node);
  }
  const text = node.value.toString();
  if (
    !["single_quote_string", "var_string", "natural_string", "string"].includes(
      node.type,
    )
  ) {
    return text;
  }
  const backslash = db === DB.MYSQL || db === DB.MARIADB;
  const escapes = { n: "\n", t: "\t", r: "\r", 0: "\0", b: "\b", Z: "\x1a" };
  return text.replace(backslash ? /''|\\([\s\S])/g : /''/g, (match, ch) =>
    match === "''" ? "'" : escapes[ch] ?? ch,
  );
}

// Text of a DEFAULT that is an expression rather than a literal, such as
// CAST(GETDATE() AS DATE) or CURRENT_TIMESTAMP.
function expressionText(node) {
  if (!node || typeof node !== "object") return "";
  switch (node.type) {
    case "function": {
      const name = (node.name?.name ?? []).map((part) => part.value).join(".");
      const args = node.args?.value;
      return Array.isArray(args)
        ? `${name}(${args.map(expressionText).join(", ")})`
        : name;
    }
    case "cast":
      return `CAST(${expressionText(node.expr)} AS ${node.target?.[0]?.dataType ?? ""})`;
    case "unary_expr":
      return `${node.operator}${expressionText(node.expr)}`;
    case "binary_expr":
      return `${expressionText(node.left)} ${node.operator} ${expressionText(node.right)}`;
    case "single_quote_string":
    case "var_string":
      return `'${node.value}'`;
    case "null":
      return "NULL";
    default:
      return node.value !== undefined ? String(node.value) : "";
  }
}
