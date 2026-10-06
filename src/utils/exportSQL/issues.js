// Problems found while generating SQL. Each one has a level ("error" means the
// script will most likely fail on the engine, "warning" means something was
// adapted or left out, "info" is a note), a code and its parameters. The export
// dialog translates them through `sql_issue_<code>`; these English messages are
// the fallback.

export const ISSUE_MESSAGES = {
  empty_table_name: "A table has no name; it was exported as {{table}}.",
  empty_column_name:
    "A column of {{table}} has no name; it was exported as {{column}}.",
  duplicate_table: "Two tables are named {{table}}.",
  duplicate_column: "{{table}} has two columns named {{column}}.",
  name_too_long:
    "{{name}} is longer than the {{max}} bytes {{dialect}} allows for a name.",
  name_changed: "{{name}} was renamed to {{newName}} to keep names unique.",
  oracle_quote_in_name:
    "Oracle names cannot contain double quotes; {{name}} was changed.",
  empty_type: "{{table}}.{{column}} has no type; {{type}} was used.",
  type_not_for_columns:
    "{{table}}.{{column}}: {{type}} cannot be the type of a column in {{dialect}}.",
  size_ignored:
    "{{table}}.{{column}}: {{type}} does not take a size in {{dialect}}; ({{size}}) was left out.",
  size_invalid:
    "{{table}}.{{column}}: ({{size}}) is not a valid size for {{type}} and was left out.",
  size_filled:
    "{{table}}.{{column}}: {{type}} needs a length in {{dialect}}; {{size}} was used.",
  enum_no_values:
    "{{table}}.{{column}} is an {{type}} without values; {{fallback}} was used.",
  enum_duplicate_value:
    "{{name}} lists the value '{{value}}' more than once; the repeat was removed.",
  enum_no_values_type: "The enum {{name}} has no values and was left out.",
  set_value_comma: "{{table}}.{{column}}: SET values cannot contain commas.",
  set_emulated:
    "{{table}}.{{column}}: {{dialect}} has no SET type; it was exported as text holding comma-separated values.",
  type_name_clash:
    "The type {{name}} has the same name as a table, which PostgreSQL does not allow.",
  identity_unsupported_type:
    "{{table}}.{{column}}: {{type}} cannot auto-increment in {{dialect}}; auto-increment was left out.",
  identity_multiple:
    "{{table}} has more than one auto-increment column; {{dialect}} allows one, so only {{column}} keeps it.",
  sqlite_autoincrement:
    "{{table}}.{{column}}: SQLite only auto-increments a single INTEGER PRIMARY KEY column; auto-increment was left out.",
  mysql_autoincrement_key:
    "{{table}}.{{column}} auto-increments but is not a key; an index was added because MySQL requires one.",
  default_on_identity:
    "{{table}}.{{column}} auto-increments, so its default was left out.",
  default_on_rowversion:
    "{{table}}.{{column}} is a row version and cannot have a default.",
  default_null_not_null:
    "{{table}}.{{column}} is NOT NULL, so DEFAULT NULL was left out.",
  default_not_numeric:
    "{{table}}.{{column}}: the default '{{value}}' is not a number.",
  default_not_boolean:
    "{{table}}.{{column}}: the default '{{value}}' is not a boolean.",
  default_not_bits:
    "{{table}}.{{column}}: the default '{{value}}' is not a bit string.",
  default_not_in_enum:
    "{{table}}.{{column}}: the default '{{value}}' is not one of the allowed values.",
  check_ignored_type:
    "{{table}}.{{column}}: {{type}} does not take a CHECK, so it was left out.",
  check_copied:
    "CHECK expressions are copied as written ({{columns}}); make sure they only use functions {{dialect}} has.",
  check_on_identity:
    "{{table}}.{{column}}: auto-increment columns cannot have a CHECK in {{dialect}}; it was left out.",
  stale_column_reference:
    "{{table}}: {{object}} refers to the missing column {{column}} and was left out.",
  empty_index: "{{table}}: {{object}} has no columns and was left out.",
  duplicate_key:
    "{{table}}: {{object}} repeats the columns of {{other}} and was left out.",
  lob_in_key:
    "{{table}}: {{column}} ({{type}}) cannot be part of {{object}} in {{dialect}}.",
  mysql_prefix_key:
    "{{table}}: {{column}} is a {{type}} column, so {{object}} indexes its first {{prefix}} characters only.",
  no_primary_key: "{{table}} has no primary key.",
  fk_missing_table:
    "The relationship {{name}} points to a table that does not exist and was left out.",
  fk_missing_column:
    "The relationship {{name}} points to a column that does not exist and was left out.",
  fk_target_not_unique:
    "The relationship {{name}} references {{table}}({{columns}}), which is not its primary key or a unique key.",
  fk_type_mismatch:
    "The relationship {{name}} links {{column}} ({{type}}) to {{refColumn}} ({{refType}}); {{dialect}} needs matching types.",
  fk_set_null_not_null:
    "The relationship {{name}} uses SET NULL but {{column}} is NOT NULL.",
  fk_set_default_unsupported:
    "The relationship {{name}} uses SET DEFAULT, which {{dialect}} does not support; it was left out.",
  fk_set_default_innodb:
    "The relationship {{name}} uses SET DEFAULT, which InnoDB accepts but does not enforce.",
  fk_restrict_mapped:
    "The relationship {{name}} uses RESTRICT; {{dialect}} calls it NO ACTION.",
  oracle_no_on_update:
    "The relationship {{name}} uses ON UPDATE {{action}}, which Oracle does not support; it was left out.",
  mssql_cascade_paths:
    "The relationship {{name}} creates cycles or multiple cascade paths, which SQL Server rejects. Use NO ACTION on one of them.",
  fk_inline_cycle:
    "{{table}} is part of a cycle of foreign keys; its constraint was added with ALTER TABLE instead.",
  sqlite_alter_fk:
    "SQLite cannot add foreign keys with ALTER TABLE; they were written inside CREATE TABLE.",
  pg_extension: "{{type}} needs the PostgreSQL extension {{extension}}.",
  oracle_interval:
    "{{table}}.{{column}}: Oracle needs a qualified INTERVAL; INTERVAL DAY TO SECOND was used.",
  comment_truncated:
    "The comment of {{object}} was cut to {{max}} characters, the most {{dialect}} keeps.",
};

export function formatIssue(issue) {
  const template = ISSUE_MESSAGES[issue.code] ?? issue.code;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    issue.params && key in issue.params ? String(issue.params[key]) : match,
  );
}
