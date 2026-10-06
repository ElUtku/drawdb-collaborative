import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dbToTypes } from "../../data/datatypes.js";
import {
  allTypesDiagram,
  diagrams,
  field,
  postgresExtrasDiagram,
} from "../../../scripts/sql-engines/fixtures.js";
import {
  assignProtoNumbers,
  generateProtobuf,
  jsonToProtobuf,
  PROTO_OPTION_DEFS,
} from "./protobuf.js";

const hasProtoc = spawnSync("protoc", ["--version"]).status === 0;

function compiles(proto) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drawdb-proto-"));
  try {
    fs.writeFileSync(path.join(dir, "schema.proto"), proto);
    const result = spawnSync(
      "protoc",
      ["-I", dir, "-I", "/usr/include", `--cpp_out=${dir}`, "schema.proto"],
      { cwd: dir, encoding: "utf8" },
    );
    return { ok: result.status === 0, errors: result.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const message = (proto, name) =>
  proto.match(new RegExp(`message ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";

test("every fixture compiles with protoc", { skip: !hasProtoc }, () => {
  const sources = [
    ...Object.values(diagrams).flatMap((build) =>
      ["mysql", "postgresql", "transactsql", "generic"].map((db) => build(db)),
    ),
    allTypesDiagram("mysql", dbToTypes),
    allTypesDiagram("postgresql", dbToTypes),
    postgresExtrasDiagram(),
  ];
  const optionSets = [
    {},
    { enumValueStyle: "plain" },
    { service: "crud", fieldCase: "camel" },
    { messageCase: "original", fieldCase: "original" },
  ];
  for (const source of sources) {
    for (const options of optionSets) {
      const proto = jsonToProtobuf(
        { ...source, title: "test", relationships: source.references },
        options,
      );
      const result = compiles(proto);
      assert.ok(result.ok, `${result.errors}\n${proto}`);
    }
  }
});

test("saved field numbers survive reordering and deletion", () => {
  const table = {
    id: 1,
    name: "orders",
    comment: "",
    fields: [
      field({ id: "a", name: "id", type: "INT", primary: true }),
      field({ id: "b", name: "total", type: "DECIMAL" }),
      field({ id: "c", name: "note", type: "VARCHAR" }),
    ],
  };
  const [numbered] = assignProtoNumbers([table]);
  assert.deepEqual(
    numbered.fields.map((f) => f.protoNumber),
    [1, 2, 3],
  );
  // "total" is deleted (its number is reserved) and a new column is
  // inserted in the middle.
  const changed = {
    ...numbered,
    protoReserved: [2],
    protoReservedNames: ["total"],
    fields: [
      numbered.fields[0],
      field({ id: "d", name: "currency", type: "VARCHAR" }),
      numbered.fields[2],
    ],
  };
  const proto = jsonToProtobuf({ tables: [changed], title: "shop" });
  const orders = message(proto, "Orders");
  assert.match(orders, /reserved 2;/);
  assert.match(orders, /reserved "total";/);
  assert.match(orders, /string note = 3;/);
  assert.match(orders, /optional string currency = 4;/);
  assert.match(orders, /int32 id = 1;/);
});

test("saving numbers agrees with the export after a deletion is undone", () => {
  const table = {
    id: 1,
    name: "t",
    protoReserved: [2],
    fields: [
      field({ id: "a", name: "a", type: "INT", protoNumber: 1 }),
      field({ id: "b", name: "b", type: "INT", protoNumber: 2 }),
      field({ id: "c", name: "c", type: "INT" }),
    ],
  };
  const [numbered] = assignProtoNumbers([table]);
  assert.deepEqual(
    numbered.fields.map((f) => f.protoNumber),
    [1, 2, 3],
  );
  const proto = jsonToProtobuf({ tables: [table], title: "x" });
  assert.match(proto, /b = 2;/);
  assert.match(proto, /c = 3;/);
  assert.doesNotMatch(proto, /reserved 2/);
});

test("unsaved numbers are reported and position numbering stays available", () => {
  const tables = [
    {
      id: 1,
      name: "t",
      fields: [field({ id: 1, name: "a", type: "INT", notNull: true })],
    },
  ];
  const { issues } = generateProtobuf({ tables, title: "x" });
  assert.ok(issues.some((issue) => issue.code === "numbers_not_saved"));
  const { issues: none } = generateProtobuf(
    { tables, title: "x" },
    { fieldNumbers: "position" },
  );
  assert.equal(none.length, 0);
});

test("names that would clash in the proto scope are made unique", () => {
  const { proto, issues } = generateProtobuf(
    {
      title: "x",
      tables: [
        {
          id: 1,
          name: "status",
          fields: [
            field({ id: 1, name: "user_id", type: "INT", notNull: true }),
            field({ id: 2, name: "userId", type: "INT", notNull: true }),
          ],
        },
      ],
      enums: [
        { name: "status", values: ["active", "done"] },
        { name: "phase", values: ["active", "later"] },
      ],
    },
    { enumValueStyle: "plain", fieldCase: "original" },
  );
  assert.match(proto, /message Status \{/);
  assert.match(proto, /enum Status2 \{/);
  assert.match(proto, /PHASE_ACTIVE = 1;/);
  assert.ok(issues.some((issue) => issue.code === "enum_values_prefixed"));
  assert.ok(issues.some((issue) => issue.code === "json_name_clash"));
  if (hasProtoc) assert.ok(compiles(proto).ok);
});

test("unsigned columns, packages and file options are written safely", () => {
  const proto = jsonToProtobuf(
    {
      title: "Sales & Billing",
      tables: [
        {
          id: 1,
          name: "t",
          fields: [
            field({
              id: 1,
              name: "a",
              type: "INT",
              unsigned: true,
              notNull: true,
            }),
            field({
              id: 2,
              name: "b",
              type: "BIGINT",
              unsigned: true,
              notNull: true,
            }),
          ],
        },
      ],
    },
    {
      packageName: "my-company.v1",
      goPackage: 'x"y',
      javaPackage: "com.example",
      javaMultipleFiles: false,
      optimizeFor: "LITE_RUNTIME",
    },
  );
  assert.match(proto, /package my_company\.v1;/);
  assert.match(proto, /uint32 a = 1;/);
  assert.match(proto, /uint64 b = 2;/);
  assert.match(proto, /option go_package = "x\\"y";/);
  assert.doesNotMatch(proto, /java_multiple_files/);
  assert.match(proto, /option optimize_for = LITE_RUNTIME;/);
});

test("every option has a section", () => {
  for (const def of PROTO_OPTION_DEFS) {
    assert.ok(["basic", "advanced"].includes(def.section), def.key);
  }
});
