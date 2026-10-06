// Diagrams that exercise the SQL generator: awkward names, quotes in comments
// and defaults, composite and cyclic foreign keys, every column type of every
// engine... Each builder receives the dialect and returns a drawDB document.
// Used by src/utils/exportSQL/exportSQL.test.js and scripts/sql-engines/run.js.
export const field = (o) => ({
  default: "",
  check: "",
  primary: false,
  unique: false,
  notNull: false,
  increment: false,
  comment: "",
  ...o,
});
let seq = 0;
const id = () => `f${++seq}`;

const INT = {
  mysql: "INT",
  mariadb: "INT",
  postgresql: "INTEGER",
  sqlite: "INTEGER",
  transactsql: "INTEGER",
  oraclesql: "INTEGER",
  generic: "INT",
};
const VARCHAR = {
  mysql: "VARCHAR",
  mariadb: "VARCHAR",
  postgresql: "VARCHAR",
  sqlite: "VARCHAR",
  transactsql: "NVARCHAR",
  oraclesql: "VARCHAR2",
  generic: "VARCHAR",
};
const TEXT = {
  mysql: "TEXT",
  mariadb: "TEXT",
  postgresql: "TEXT",
  sqlite: "TEXT",
  transactsql: "NVARCHAR",
  oraclesql: "CLOB",
  generic: "TEXT",
};
const BOOL = {
  mysql: "BOOLEAN",
  mariadb: "BOOLEAN",
  postgresql: "BOOLEAN",
  sqlite: "BOOLEAN",
  transactsql: "BIT",
  oraclesql: "BOOLEAN",
  generic: "BOOLEAN",
};
const TS = {
  mysql: "DATETIME",
  mariadb: "DATETIME",
  postgresql: "TIMESTAMP",
  sqlite: "DATETIME",
  transactsql: "DATETIME2",
  oraclesql: "TIMESTAMP",
  generic: "DATETIME",
};
const DATE = {
  ...Object.fromEntries(Object.keys(INT).map((k) => [k, "DATE"])),
};
const DEC = {
  mysql: "DECIMAL",
  mariadb: "DECIMAL",
  postgresql: "NUMERIC",
  sqlite: "NUMERIC",
  transactsql: "DECIMAL",
  oraclesql: "NUMBER",
  generic: "DECIMAL",
};

function table(tid, name, fields, extra = {}) {
  return {
    id: tid,
    name,
    x: 0,
    y: 0,
    comment: "",
    indices: [],
    color: "#175e7a",
    fields,
    ...extra,
  };
}
function rel(
  rid,
  name,
  start,
  sf,
  end,
  ef,
  del = "No action",
  upd = "No action",
  fields,
) {
  return {
    id: rid,
    name,
    startTableId: start,
    startFieldId: sf,
    endTableId: end,
    endFieldId: ef,
    updateConstraint: upd,
    deleteConstraint: del,
    cardinality: "many_to_one",
    ...(fields ? { fields } : {}),
  };
}

export const diagrams = {
  basic(db) {
    const pk = field({
      id: id(),
      name: "id",
      type: INT[db],
      primary: true,
      increment: true,
      notNull: true,
      unsigned: true,
    });
    const email = field({
      id: id(),
      name: "email",
      type: VARCHAR[db],
      size: "120",
      unique: true,
      notNull: true,
      comment: "Contact 'email' \\ path",
    });
    const opk = field({
      id: id(),
      name: "id",
      type: INT[db],
      primary: true,
      increment: true,
      unsigned: true,
    });
    const cid = field({
      id: id(),
      name: "customer_id",
      type: INT[db],
      notNull: true,
      unsigned: true,
    });
    const status = field({
      id: id(),
      name: "status",
      type: VARCHAR[db],
      size: "",
      default: "new",
    });
    const created = field({
      id: id(),
      name: "created_at",
      type: TS[db],
      default: "CURRENT_TIMESTAMP",
      notNull: true,
    });
    const total = field({
      id: id(),
      name: "total",
      type: DEC[db],
      size: "10,2",
      default: "0",
      check: "total >= 0",
    });
    return {
      database: db,
      tables: [
        table(1, "customers", [pk, email], {
          comment: "People who buy.\nSecond line with */ and -- and 'quotes'",
          indices: [
            { name: "idx_customers_email", unique: false, fields: ["email"] },
          ],
        }),
        table(2, "orders", [opk, cid, status, created, total]),
      ],
      references: [
        rel(
          1,
          "fk_orders_customer",
          2,
          cid.id,
          1,
          pk.id,
          "Cascade",
          "Restrict",
        ),
      ],
      enums: [],
      types: [],
    };
  },

  names(db) {
    const a = field({ id: id(), name: "select", type: INT[db], primary: true });
    const b = field({
      id: id(),
      name: 'we"ird `name` [x]',
      type: VARCHAR[db],
      size: "50",
      comment: "Ñandú año ☃",
    });
    const c = field({ id: id(), name: "MixedCase", type: INT[db] });
    const d = field({ id: id(), name: "order", type: INT[db] });
    const e = field({ id: id(), name: "x".repeat(58), type: INT[db] });
    const p2 = field({ id: id(), name: "id", type: INT[db], primary: true });
    const f2 = field({ id: id(), name: "group ref", type: INT[db] });
    return {
      database: db,
      tables: [
        table(1, "order items", [a, b, c, d, e], {
          comment: "Table with 'quotes' & ampersand",
          indices: [
            { name: "", unique: false, fields: ["MixedCase", "order"] },
            {
              name: "index with spaces",
              unique: true,
              fields: ['we"ird `name` [x]'],
            },
            {
              name: "idx_long_" + "y".repeat(70),
              unique: false,
              fields: ["x".repeat(58)],
            },
          ],
        }),
        table(2, "User", [p2, f2], {
          indices: [{ name: "", unique: false, fields: ["group ref"] }],
        }),
      ],
      references: [rel(1, "", 2, f2.id, 1, a.id)],
      enums: [],
      types: [],
    };
  },

  keys(db) {
    // Composite PK, composite FK, self reference, cycle, FK to unique column.
    const ta = field({
      id: id(),
      name: "tenant_id",
      type: INT[db],
      primary: true,
    });
    const tb = field({
      id: id(),
      name: "code",
      type: VARCHAR[db],
      size: "20",
      primary: true,
    });
    const tc = field({
      id: id(),
      name: "parent_code",
      type: VARCHAR[db],
      size: "20",
    });
    const td = field({
      id: id(),
      name: "slug",
      type: VARCHAR[db],
      size: "40",
      unique: true,
      notNull: true,
    });
    const da = field({
      id: id(),
      name: "id",
      type: INT[db],
      primary: true,
      increment: true,
    });
    const db_ = field({
      id: id(),
      name: "tenant_id",
      type: INT[db],
      notNull: true,
    });
    const dc = field({
      id: id(),
      name: "cat_code",
      type: VARCHAR[db],
      size: "20",
      notNull: true,
    });
    const dd = field({
      id: id(),
      name: "cat_slug",
      type: VARCHAR[db],
      size: "40",
    });
    const de = field({ id: id(), name: "manager_id", type: INT[db] });
    const df = field({ id: id(), name: "primary_item", type: INT[db] });
    const ia = field({ id: id(), name: "id", type: INT[db], primary: true });
    const ib = field({ id: id(), name: "doc_id", type: INT[db] });
    const nopk = field({
      id: id(),
      name: "free_text",
      type: VARCHAR[db],
      size: "10",
    });
    const nopkRef = field({ id: id(), name: "doc", type: INT[db] });
    return {
      database: db,
      tables: [
        table(10, "categories", [ta, tb, tc, td], {
          uniqueConstraints: [
            { name: "uq_cat_pair", fields: ["tenant_id", "slug"] },
            { name: "uq_dup_of_pk", fields: ["code", "tenant_id"] },
          ],
          indices: [
            {
              name: "idx_dup_pk",
              unique: false,
              fields: ["tenant_id", "code"],
            },
            { name: "idx_stale", unique: false, fields: ["gone", "slug"] },
            { name: "idx_empty", unique: false, fields: [] },
          ],
        }),
        table(11, "documents", [da, db_, dc, dd, de, df]),
        table(12, "items", [ia, ib]),
        table(13, "no_pk", [nopk, nopkRef]),
      ],
      references: [
        rel(1, "fk_doc_category", 11, db_.id, 10, ta.id, "Cascade", "Cascade", [
          { startFieldId: db_.id, endFieldId: ta.id },
          { startFieldId: dc.id, endFieldId: tb.id },
        ]),
        rel(2, "fk_doc_slug", 11, dd.id, 10, td.id, "Set null", "No action"),
        rel(
          3,
          "fk_doc_manager",
          11,
          de.id,
          11,
          da.id,
          "No action",
          "No action",
        ),
        rel(
          4,
          "fk_doc_primary_item",
          11,
          df.id,
          12,
          ia.id,
          "Set null",
          "No action",
        ),
        rel(5, "fk_item_doc", 12, ib.id, 11, da.id, "Cascade", "No action"),
        rel(6, "fk_nopk_doc", 13, nopkRef.id, 11, da.id),
      ],
      enums: [],
      types: [],
    };
  },

  defaults(db) {
    const fields = [
      field({ id: id(), name: "id", type: INT[db], primary: true }),
      field({
        id: id(),
        name: "s_plain",
        type: VARCHAR[db],
        size: "50",
        default: "hello",
      }),
      field({
        id: id(),
        name: "s_quote",
        type: VARCHAR[db],
        size: "50",
        default: 'it\'s \\ "ok"',
      }),
      field({
        id: id(),
        name: "s_prequoted",
        type: VARCHAR[db],
        size: "50",
        default: "'already'",
      }),
      field({
        id: id(),
        name: "s_numeric",
        type: VARCHAR[db],
        size: "50",
        default: "007",
      }),
      field({ id: id(), name: "n_neg", type: INT[db], default: "-5" }),
      field({
        id: id(),
        name: "n_dec",
        type: DEC[db],
        size: "8,3",
        default: "+1.250",
      }),
      field({ id: id(), name: "b_true", type: BOOL[db], default: "true" }),
      field({
        id: id(),
        name: "b_zero",
        type: BOOL[db],
        default: "0",
        notNull: true,
      }),
      field({
        id: id(),
        name: "d_date",
        type: DATE[db],
        default: "2024-01-31",
      }),
      field({
        id: id(),
        name: "d_today",
        type: DATE[db],
        default: "CURRENT_DATE",
      }),
      field({ id: id(), name: "t_now", type: TS[db], default: "now()" }),
      field({
        id: id(),
        name: "t_lit",
        type: TS[db],
        default: "2024-01-31 10:20:30",
      }),
      field({ id: id(), name: "n_null", type: INT[db], default: "NULL" }),
      field({
        id: id(),
        name: "n_null_nn",
        type: INT[db],
        default: "null",
        notNull: true,
      }),
      field({
        id: id(),
        name: "txt",
        type: TEXT[db],
        size: TEXT[db] === "NVARCHAR" ? "max" : "",
        default: "long 'text'",
      }),
    ];
    return {
      database: db,
      tables: [table(1, "defaults_table", fields)],
      references: [],
      enums: [],
      types: [],
    };
  },
};

// FK combinations that must be valid on every engine (or flagged).
export function actionsDiagram(db, del, upd) {
  const p = field({ id: id(), name: "id", type: INT[db], primary: true });
  const c = field({ id: id(), name: "id", type: INT[db], primary: true });
  const r = field({ id: id(), name: "parent_id", type: INT[db] });
  return {
    database: db,
    tables: [table(1, "parent", [p]), table(2, "child", [c, r])],
    references: [rel(1, "fk_child_parent", 2, r.id, 1, p.id, del, upd)],
    enums: [],
    types: [],
  };
}

diagrams.edge = (db) => {
  const a1 = field({ id: id(), name: "id", type: INT[db], primary: true });
  const a2 = field({
    id: id(),
    name: "createdAt",
    type: INT[db],
    check: "createdAt > 0 AND createdAt < 99999",
  });
  const a3 = field({
    id: id(),
    name: "seq",
    type: INT[db],
    increment: db !== "sqlite",
    notNull: true,
  });
  const a4 = field({
    id: id(),
    name: "Label",
    type: VARCHAR[db],
    size: "30",
    // A generic diagram is exported everywhere, so it avoids LEN/LENGTH.
    check:
      db === "generic"
        ? "Label <> ''"
        : `${db === "transactsql" ? "len" : "length"}(Label) > 0`,
  });
  const b1 = field({
    id: id(),
    name: "id",
    type: INT[db],
    primary: true,
    increment: true,
  });
  const b2 = field({ id: id(), name: "a_id", type: INT[db] });
  const b3 = field({
    id: id(),
    name: "notes",
    type: TEXT[db],
    size: TEXT[db] === "NVARCHAR" ? "max" : "",
  });
  return {
    database: db,
    tables: [
      table(1, "Alpha", [a1, a2, a3, a4], {
        indices: [{ name: "idx_shared", unique: false, fields: ["Label"] }],
      }),
      table(2, "beta", [b1, b2, b3], {
        indices: [{ name: "idx_shared", unique: false, fields: ["a_id"] }],
        uniqueConstraints: [{ name: "", fields: ["a_id"] }],
      }),
    ],
    references: [
      rel(1, "fk_beta_alpha", 2, b2.id, 1, a1.id, "Set null", "Cascade"),
    ],
    enums: [],
    types: [],
  };
};

// Each of these must come back with at least one "error".
export const invalidDiagrams = {
  set_null_not_null(db) {
    const d = actionsDiagram(db, "Set null", "No action");
    d.tables[1].fields[1].notNull = true;
    return d;
  },
  fk_not_unique(db) {
    const p = field({ id: id(), name: "id", type: INT[db], primary: true });
    const q = field({ id: id(), name: "code", type: INT[db] });
    const c = field({ id: id(), name: "pcode", type: INT[db] });
    return {
      database: db,
      tables: [table(1, "p", [p, q]), table(2, "c", [c])],
      references: [rel(1, "fk_c_p", 2, c.id, 1, q.id)],
      enums: [],
      types: [],
    };
  },
  fk_type_mismatch(db) {
    const p = field({
      id: id(),
      name: "id",
      type: INT[db],
      primary: true,
      unsigned: true,
    });
    const c = field({ id: id(), name: "pid", type: VARCHAR[db], size: "10" });
    return {
      database: db,
      tables: [table(1, "p", [p]), table(2, "c", [c])],
      references: [rel(1, "fk_c_p", 2, c.id, 1, p.id)],
      enums: [],
      types: [],
    };
  },
  duplicate_table(db) {
    const p = field({ id: id(), name: "id", type: INT[db], primary: true });
    const q = field({ id: id(), name: "id", type: INT[db], primary: true });
    return {
      database: db,
      tables: [table(1, "same", [p]), table(2, "same", [q])],
      references: [],
      enums: [],
      types: [],
    };
  },
};

export function allTypesDiagram(db, dbToTypes) {
  // pgvector types need an extension that is not always installed.
  const skip = db === "postgresql" ? ["VECTOR", "HALFVEC", "SPARSEVEC"] : [];
  const pkType =
    db === "generic" ? "INT" : db === "oraclesql" ? "NUMBER" : "INTEGER";
  const fields = [field({ id: "pk", name: "pk", type: pkType, primary: true })];
  for (const type of Object.keys(dbToTypes[db])) {
    if (skip.includes(type)) continue;
    const meta = dbToTypes[db][type];
    fields.push(
      field({
        id: `c_${type}`,
        name: `c_${type.toLowerCase().replace(/\s+/g, "_")}`,
        type,
        size:
          meta.isSized || meta.hasPrecision
            ? String(meta.defaultSize ?? "")
            : "",
        values:
          type === "ENUM" || type === "SET" ? ["a", "b's", "c\\d"] : undefined,
      }),
    );
  }
  return {
    database: db,
    tables: [table(1, "all_types", fields)],
    references: [],
    enums: [],
    types: [],
  };
}

export function postgresExtrasDiagram() {
  const mood = { id: "e1", name: "Mood", values: ["happy", "sad", "it's ok"] };
  const address = {
    id: "t1",
    name: "address",
    comment: "Postal 'address'",
    fields: [
      { id: "a1", name: "street", type: "VARCHAR", size: "100" },
      { id: "a2", name: "mood", type: "MOOD" },
    ],
  };
  return {
    database: "postgresql",
    tables: [
      table(1, "people", [
        field({
          id: "p1",
          name: "id",
          type: "BIGINT",
          primary: true,
          increment: true,
        }),
        field({ id: "p2", name: "mood", type: "MOOD", default: "happy" }),
        field({ id: "p3", name: "home", type: "ADDRESS" }),
        field({
          id: "p4",
          name: "tags",
          type: "TEXT",
          isArray: true,
          default: "'{a,b}'",
        }),
        field({ id: "p5", name: "serial_id", type: "SERIAL", increment: true }),
        field({
          id: "p6",
          name: "data",
          type: "JSONB",
          default: "'{}'::jsonb",
        }),
        field({
          id: "p7",
          name: "u",
          type: "UUID",
          default: "gen_random_uuid()",
        }),
      ]),
      table(
        2,
        "child_people",
        [field({ id: "c1", name: "extra", type: "TEXT" })],
        {
          inherits: ["people"],
        },
      ),
    ],
    references: [],
    enums: [mood],
    types: [address],
  };
}

export function genericTypesDiagram(dbToTypes) {
  const diagram = allTypesDiagram("generic", dbToTypes);
  diagram.types = [
    {
      id: "ty",
      name: "point_t",
      comment: "",
      fields: [
        { name: "x", type: "INT" },
        { name: "y", type: "DOUBLE" },
      ],
    },
  ];
  diagram.tables[0].fields.push(
    field({ id: "cust", name: "c_custom", type: "POINT_T" }),
  );
  diagram.tables[0].fields.find((f) => f.name === "c_boolean").default = "true";
  return diagram;
}
