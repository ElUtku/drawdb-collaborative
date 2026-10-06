// Pairs of diagram versions for the migration generator. Every scenario
// starts from the same small shop schema (with rows in it) and changes one
// kind of thing, so a failure points at that kind of change. Used by
// src/utils/exportSQL/migration.test.js and scripts/sql-engines/migrate.js.
import { field } from "./fixtures.js";

const TYPES = {
  int: {
    mysql: "INTEGER",
    mariadb: "INTEGER",
    postgresql: "INTEGER",
    sqlite: "INTEGER",
    transactsql: "INTEGER",
    oraclesql: "INTEGER",
  },
  big: {
    mysql: ["BIGINT"],
    mariadb: ["BIGINT"],
    postgresql: ["BIGINT"],
    sqlite: ["NUMERIC"],
    transactsql: ["BIGINT"],
    // INTEGER is NUMBER(38): a type Oracle can widen it to with rows in it.
    oraclesql: ["NUMBER"],
  },
  varchar: {
    mysql: "VARCHAR",
    mariadb: "VARCHAR",
    postgresql: "VARCHAR",
    sqlite: "VARCHAR",
    transactsql: "NVARCHAR",
    oraclesql: "VARCHAR2",
  },
  decimal: {
    mysql: "DECIMAL",
    mariadb: "DECIMAL",
    postgresql: "NUMERIC",
    sqlite: "NUMERIC",
    transactsql: "DECIMAL",
    oraclesql: "NUMBER",
  },
  timestamp: {
    mysql: "DATETIME",
    mariadb: "DATETIME",
    postgresql: "TIMESTAMP",
    sqlite: "DATETIME",
    transactsql: "DATETIME2",
    oraclesql: "TIMESTAMP",
  },
  text: {
    mysql: ["TEXT"],
    mariadb: ["TEXT"],
    postgresql: ["TEXT"],
    sqlite: ["TEXT"],
    transactsql: ["NVARCHAR", "MAX"],
    oraclesql: ["CLOB"],
  },
  bool: {
    mysql: "BOOLEAN",
    mariadb: "BOOLEAN",
    postgresql: "BOOLEAN",
    sqlite: "BOOLEAN",
    transactsql: "BIT",
    oraclesql: "BOOLEAN",
  },
};

function typed(dialect, kind, size) {
  const entry = TYPES[kind][dialect];
  if (Array.isArray(entry)) {
    return { type: entry[0], ...(entry[1] && { size: entry[1] }) };
  }
  return { type: entry, ...(size !== undefined && { size }) };
}

function column(dialect, id, name, kind, o = {}) {
  const { size, ...rest } = o;
  return field({ id, name, ...typed(dialect, kind, size), ...rest });
}

const table = (id, name, fields, extra = {}) => ({
  id,
  name,
  x: 0,
  y: 0,
  comment: "",
  color: "#175e7a",
  indices: [],
  fields,
  ...extra,
});

const reference = (id, child, childField, parent, parentField, o = {}) => ({
  id,
  name: "",
  startTableId: child,
  startFieldId: childField,
  endTableId: parent,
  endFieldId: parentField,
  cardinality: "many_to_one",
  updateConstraint: "No action",
  deleteConstraint: "No action",
  ...o,
});

/** The starting point of every scenario. */
export function shop(dialect) {
  return {
    database: dialect,
    tables: [
      table(
        "t_c",
        "customers",
        [
          column(dialect, "c_id", "id", "int", {
            primary: true,
            increment: true,
          }),
          column(dialect, "c_email", "email", "varchar", {
            size: "120",
            notNull: true,
            unique: true,
          }),
          column(dialect, "c_name", "name", "varchar", { size: "80" }),
          column(dialect, "c_created", "created", "timestamp", {
            default: "CURRENT_TIMESTAMP",
          }),
        ],
        { comment: "Customers" },
      ),
      table(
        "t_o",
        "orders",
        [
          column(dialect, "o_id", "id", "int", {
            primary: true,
            increment: true,
          }),
          column(dialect, "o_cust", "customer_id", "int", { notNull: true }),
          column(dialect, "o_total", "total", "decimal", {
            size: "10,2",
            notNull: true,
            default: "0",
            check: "total >= 0",
          }),
          column(dialect, "o_status", "status", "varchar", {
            size: "20",
            default: "new",
          }),
          column(dialect, "o_note", "note", "text"),
        ],
        {
          indices: [
            {
              id: 0,
              name: "idx_orders_status",
              unique: false,
              fields: ["status"],
            },
          ],
        },
      ),
      table("t_p", "products", [
        column(dialect, "p_id", "id", "int", { primary: true }),
        column(dialect, "p_sku", "sku", "varchar", {
          size: "40",
          notNull: true,
        }),
        column(dialect, "p_price", "price", "decimal", { size: "10,2" }),
      ]),
      table("t_i", "order_items", [
        column(dialect, "i_order", "order_id", "int", {
          primary: true,
          notNull: true,
        }),
        column(dialect, "i_product", "product_id", "int", {
          primary: true,
          notNull: true,
        }),
        column(dialect, "i_qty", "qty", "int", {
          notNull: true,
          default: "1",
          check: "qty > 0",
        }),
      ]),
    ],
    references: [
      reference("r1", "t_o", "o_cust", "t_c", "c_id", {
        deleteConstraint: "Cascade",
      }),
      reference("r2", "t_i", "i_order", "t_o", "o_id", {
        deleteConstraint: "Cascade",
      }),
      reference("r3", "t_i", "i_product", "t_p", "p_id"),
    ],
  };
}

/** Rows to put in the first version; [table, { column: value }]. */
export const shopRows = [
  ["customers", { email: "a@example.com", name: "Ann" }],
  ["customers", { email: "b@example.com", name: "Bob" }],
  ["products", { id: 1, sku: "SKU-1", price: 9.5 }],
  ["products", { id: 2, sku: "SKU-2", price: 3 }],
  ["orders", { customer_id: 1, total: 10, status: "new" }],
  ["order_items", { order_id: 1, product_id: 1, qty: 2 }],
  ["order_items", { order_id: 1, product_id: 2, qty: 1 }],
];

const tableOf = (doc, id) => doc.tables.find((t) => t.id === id);
const fieldOf = (doc, tableId, id) =>
  tableOf(doc, tableId).fields.find((f) => f.id === id);

const changes = {
  add_columns(doc, dialect) {
    tableOf(doc, "t_c").fields.push(
      column(dialect, "c_phone", "phone", "varchar", { size: "30" }),
    );
    tableOf(doc, "t_o").fields.push(
      column(dialect, "o_paid", "paid", "bool", {
        notNull: true,
        default: "false",
      }),
    );
    tableOf(doc, "t_p").fields.push(
      column(dialect, "p_added", "added", "timestamp", {
        default: "CURRENT_TIMESTAMP",
        comment: "When it was listed",
      }),
    );
  },
  drop_columns(doc) {
    const customers = tableOf(doc, "t_c");
    customers.fields = customers.fields.filter((f) => f.id !== "c_name");
    const orders = tableOf(doc, "t_o");
    orders.fields = orders.fields.filter((f) => f.id !== "o_note");
  },
  rename_columns(doc) {
    fieldOf(doc, "t_c", "c_name").name = "full_name";
    fieldOf(doc, "t_o", "o_status").name = "state";
    tableOf(doc, "t_o").indices[0].fields = ["state"];
  },
  retype(doc, dialect) {
    fieldOf(doc, "t_c", "c_name").size = "200";
    fieldOf(doc, "t_p", "p_price").size = "12,4";
    Object.assign(fieldOf(doc, "t_i", "i_qty"), typed(dialect, "big"));
  },
  nullability_and_defaults(doc) {
    Object.assign(fieldOf(doc, "t_c", "c_name"), {
      notNull: true,
      default: "n/a",
    });
    fieldOf(doc, "t_o", "o_status").default = "pending";
    fieldOf(doc, "t_o", "o_total").default = "";
    fieldOf(doc, "t_c", "c_created").default = "";
  },
  rename_table(doc) {
    tableOf(doc, "t_p").name = "items";
  },
  drop_tables(doc) {
    doc.tables = doc.tables.filter((t) => t.id !== "t_i" && t.id !== "t_p");
    doc.references = doc.references.filter((r) => r.id === "r1");
  },
  add_table(doc, dialect) {
    doc.tables.push(
      table("t_inv", "invoices", [
        column(dialect, "v_id", "id", "int", {
          primary: true,
          increment: true,
        }),
        column(dialect, "v_order", "order_id", "int", {
          notNull: true,
          unique: true,
        }),
        column(dialect, "v_amount", "amount", "decimal", {
          size: "10,2",
          check: "amount >= 0",
          comment: "Billed amount",
        }),
      ]),
    );
    doc.references.push(reference("r4", "t_inv", "v_order", "t_o", "o_id"));
  },
  keys(doc, dialect) {
    const items = tableOf(doc, "t_i");
    items.fields.push(
      column(dialect, "i_line", "line", "int", {
        notNull: true,
        primary: true,
        default: "1",
      }),
    );
    tableOf(doc, "t_p").uniqueConstraints = [{ name: "", fields: ["sku"] }];
    tableOf(doc, "t_c").indices = [
      {
        id: 0,
        name: "idx_customers_created",
        unique: false,
        fields: ["created"],
      },
    ];
    tableOf(doc, "t_o").indices = [];
  },
  index_rename(doc) {
    tableOf(doc, "t_o").indices[0].name = "ix_order_status";
  },
  foreign_keys(doc) {
    doc.references = doc.references.filter((r) => r.id !== "r3");
    doc.references.find((r) => r.id === "r1").deleteConstraint = "Restrict";
    doc.references.find((r) => r.id === "r2").updateConstraint = "Cascade";
  },
  checks(doc) {
    fieldOf(doc, "t_o", "o_total").check = "total > -1";
    fieldOf(doc, "t_p", "p_price").check = "price >= 0";
    fieldOf(doc, "t_i", "i_qty").check = "";
  },
  identity_add(doc) {
    fieldOf(doc, "t_p", "p_id").increment = true;
  },
  identity_drop(doc) {
    fieldOf(doc, "t_c", "c_id").increment = false;
  },
  comments(doc) {
    tableOf(doc, "t_c").comment = "People who buy";
    fieldOf(doc, "t_o", "o_total").comment = "Total with tax";
    tableOf(doc, "t_p").comment = "Catalogue";
  },
  swap_names(doc) {
    fieldOf(doc, "t_c", "c_email").name = "name";
    fieldOf(doc, "t_c", "c_name").name = "email";
  },
  rename_referenced(doc) {
    tableOf(doc, "t_o").name = "purchases";
    fieldOf(doc, "t_o", "o_id").name = "purchase_id";
  },
  everything(doc, dialect) {
    changes.add_columns(doc, dialect);
    changes.rename_columns(doc, dialect);
    changes.retype(doc, dialect);
    changes.rename_table(doc, dialect);
    changes.add_table(doc, dialect);
    changes.foreign_keys(doc, dialect);
    changes.checks(doc, dialect);
    changes.comments(doc, dialect);
  },
  no_changes() {},
};

// Enum changes: PostgreSQL types, MySQL/MariaDB ENUM columns.
function withEnums(dialect) {
  const doc = shop(dialect);
  if (dialect === "postgresql") {
    doc.enums = [{ name: "mood", values: ["sad", "ok"] }];
    tableOf(doc, "t_c").fields.push(
      field({ id: "c_mood", name: "mood", type: "mood", default: "ok" }),
    );
  }
  tableOf(doc, "t_o").fields.push(
    field({ id: "o_kind", name: "kind", type: "ENUM", values: ["a", "b"] }),
  );
  return doc;
}

const enumChanges = {
  enum_add_values(doc) {
    if (doc.enums) doc.enums[0].values = ["sad", "ok", "happy"];
    fieldOf(doc, "t_o", "o_kind").values = ["a", "b", "c"];
  },
  enum_remove_values(doc) {
    if (doc.enums) doc.enums[0].values = ["ok", "happy"];
    fieldOf(doc, "t_o", "o_kind").values = ["a", "c"];
  },
  enum_rename_column(doc) {
    fieldOf(doc, "t_o", "o_kind").name = "category";
  },
};

/** [name, before, after] for `dialect`. */
export function migrationScenarios(dialect) {
  const list = Object.entries(changes).map(([name, change]) => {
    const before = shop(dialect);
    const after = structuredClone(before);
    change(after, dialect);
    return [name, before, after];
  });
  if (["postgresql", "mysql", "mariadb"].includes(dialect)) {
    for (const [name, change] of Object.entries(enumChanges)) {
      const before = withEnums(dialect);
      const after = structuredClone(before);
      change(after, dialect);
      list.push([name, before, after]);
    }
  }
  return list;
}

/** Rows that go with `migrationScenarios` (enum scenarios add a kind). */
export function scenarioRows(name) {
  if (!name.startsWith("enum_")) return shopRows;
  return shopRows.map(([table, row]) =>
    table === "orders" ? [table, { ...row, kind: "a" }] : [table, row],
  );
}
