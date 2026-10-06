import { nanoid } from "nanoid";
import { Cardinality, DB } from "../../data/constants";
import { dbToTypes } from "../../data/datatypes";
import { buildSQLFromAST, literalValue } from "./shared";

const affinity = {
  [DB.SQLITE]: new Proxy(
    {
      INT: "INTEGER",
      TINYINT: "INTEGER",
      SMALLINT: "INTEGER",
      MEDIUMINT: "INTEGER",
      BIGINT: "INTEGER",
      "UNSIGNED BIG INT": "INTEGER",
      INT2: "INTEGER",
      INT8: "INTEGER",
      CHARACTER: "TEXT",
      NCHARACTER: "TEXT",
      NVARCHAR: "VARCHAR",
      DOUBLE: "REAL",
      FLOAT: "REAL",
    },
    { get: (target, prop) => (prop in target ? target[prop] : "BLOB") },
  ),
  [DB.GENERIC]: new Proxy(
    {
      INTEGER: "INT",
      TINYINT: "SMALLINT",
      MEDIUMINT: "INTEGER",
      INT2: "INTEGER",
      INT8: "INTEGER",
      CHARACTER: "TEXT",
      NCHARACTER: "TEXT",
      NVARCHAR: "VARCHAR",
    },
    { get: (target, prop) => (prop in target ? target[prop] : "BLOB") },
  ),
};

export function fromSQLite(ast, diagramDb = DB.GENERIC) {
  const tables = [];
  const relationships = [];

  const deferred = [];
  // Resolved once every table is known: the referenced one may come later.
  const addRelationshipFromReferenceDef = (...args) =>
    deferred.push(() => addRelationship(...args));
  const addRelationship = (
    startTable,
    startFieldNames,
    referenceDefinition,
    constraintName,
  ) => {
    const relationship = {};
    const endTableName = referenceDefinition.table[0].table;
    const endFieldNames = referenceDefinition.definition.map((c) => c.column);
    const startFieldName = startFieldNames[0];

    const endTable = tables.find((t) => t.name === endTableName);
    if (!endTable) return;

    const fieldPairs = [];
    for (let i = 0; i < startFieldNames.length; i++) {
      const sf = startTable.fields.find((f) => f.name === startFieldNames[i]);
      const ef = endTable.fields.find((f) => f.name === endFieldNames[i]);
      if (!sf || !ef) break;
      fieldPairs.push({ startFieldId: sf.id, endFieldId: ef.id });
    }
    if (fieldPairs.length !== startFieldNames.length) return;

    const startField = startTable.fields.find((f) => f.name === startFieldName);

    // The declared name when there is one, so it survives a round trip.
    relationship.name =
      constraintName || `fk_${startTable.name}_${startFieldNames.join("_")}`;
    relationship.startTableId = startTable.id;
    relationship.endTableId = endTable.id;
    relationship.fields = fieldPairs;
    relationship.endFieldId = fieldPairs[0].endFieldId;
    relationship.startFieldId = fieldPairs[0].startFieldId;
    relationship.id = nanoid();

    let updateConstraint = "No action";
    let deleteConstraint = "No action";
    referenceDefinition.on_action.forEach((c) => {
      if (c.type === "on update") {
        updateConstraint = c.value.value;
        updateConstraint =
          updateConstraint[0].toUpperCase() + updateConstraint.substring(1);
      } else if (c.type === "on delete") {
        deleteConstraint = c.value.value;
        deleteConstraint =
          deleteConstraint[0].toUpperCase() + deleteConstraint.substring(1);
      }
    });

    relationship.updateConstraint = updateConstraint;
    relationship.deleteConstraint = deleteConstraint;

    if (startField.unique) {
      relationship.cardinality = Cardinality.ONE_TO_ONE;
    } else {
      relationship.cardinality = Cardinality.MANY_TO_ONE;
    }
    relationships.push(relationship);
  };

  const parseSingleStatement = (e) => {
    if (e.type === "create") {
      if (e.keyword === "table") {
        const table = {};
        table.name = e.table[0].table;
        table.comment = "";
        table.color = "#175e7a";
        table.fields = [];
        table.indices = [];
        table.uniqueConstraints = [];
        table.id = nanoid();
        e.create_definitions.forEach((d) => {
          if (d.resource === "column") {
            const field = {};
            field.id = nanoid();
            field.name = d.column.column;

            // A column declared without a type has BLOB affinity.
            let type = d.definition?.dataType ?? "BLOB";
            if (!dbToTypes[diagramDb][type]) {
              type = affinity[diagramDb][type];
            }
            field.type = type;

            if (d.definition.expr && d.definition.expr.type === "expr_list") {
              field.values = d.definition.expr.value.map((v) => v.value);
            }
            field.comment = d.comment ? d.comment.value.value : "";
            field.unique = false;
            if (d.unique) field.unique = true;
            field.increment = false;
            if (d.auto_increment) field.increment = true;
            field.notNull = false;
            if (d.nullable?.type === "not null") field.notNull = true;
            field.primary = false;
            if (d.primary_key) field.primary = true;
            field.default = "";
            if (d.default_val) {
              let defaultValue = "";
              if (d.default_val.value.type === "function") {
                defaultValue = d.default_val.value.name.name[0].value;
                if (d.default_val.value.args) {
                  defaultValue +=
                    "(" +
                    d.default_val.value.args.value
                      .map((v) => {
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
              } else if (d.default_val.value.type === "null") {
                defaultValue = "NULL";
              } else {
                defaultValue = literalValue(d.default_val.value, DB.SQLITE);
              }
              field.default = defaultValue;
            }
            if (d.definition["length"]) {
              if (d.definition.scale) {
                field.size = d.definition["length"] + "," + d.definition.scale;
              } else {
                field.size = d.definition["length"];
              }
            }
            field.check = "";
            if (d.check) {
              field.check = buildSQLFromAST(d.check.definition[0], DB.SQLITE);
            }
            table.fields.push(field);

            if (d.reference_definition) {
              addRelationshipFromReferenceDef(
                table,
                [field.name],
                d.reference_definition,
              );
            }
          } else if (d.resource === "constraint") {
            if (d.constraint_type === "primary key") {
              d.definition.forEach((c) => {
                table.fields.forEach((f) => {
                  if (f.name === c.column && !f.primary) {
                    f.primary = true;
                  }
                });
              });
            } else if (d.constraint_type.toLowerCase() === "foreign key") {
              addRelationshipFromReferenceDef(
                table,
                d.definition.map((c) => c.column),
                d.reference_definition,
                d.constraint,
              );
            } else if (d.constraint_type.toLowerCase().includes("unique")) {
              const fields = d.definition.map((c) => c.column);
              const name =
                d.constraint ||
                d.index ||
                `${table.name}_unique_${table.uniqueConstraints.length}`;
              table.uniqueConstraints.push({ name, fields });
              table.uniqueConstraints.forEach((u, j) => {
                u.id = j;
              });
            }
          }
        });
        tables.push(table);
      } else if (e.keyword === "index") {
        const index = {
          name: e.index?.name ?? e.index,
          unique: e.index_type === "unique",
          // Quoted names come as strings: "a" is the column a here.
          fields: e.index_columns.map((f) => f.column ?? f.value),
        };

        const table = tables.find((t) => t.name === e.table.table);

        if (table) {
          table.indices.push(index);
          table.indices.forEach((i, j) => {
            i.id = j;
          });
        }
      }
    }
  };

  if (Array.isArray(ast)) {
    ast.forEach((e) => parseSingleStatement(e));
  } else {
    parseSingleStatement(ast);
  }

  for (const run of deferred) run();

  return { tables, relationships };
}
