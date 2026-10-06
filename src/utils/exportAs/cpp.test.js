import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DB } from "../../data/constants.js";
import { dbToTypes } from "../../data/datatypes.js";
import {
  allTypesDiagram,
  field,
} from "../../../scripts/sql-engines/fixtures.js";
import { shop } from "../../../scripts/sql-engines/migration-fixtures.js";
import { CPP_OPTION_DEFS, generateCpp, normalizeCppOptions } from "./cpp.js";

// scripts/check-cpp.mjs compiles every fixture (and runs SOCI and sqlpp11
// against SQLite when they are available); here the shapes are checked.

const diagram = (tables, extra = {}) => ({
  database: DB.POSTGRES,
  title: "Test",
  tables,
  references: [],
  ...extra,
});
const table = (name, fields, extra = {}) => ({
  id: name,
  name,
  comment: "",
  indices: [],
  fields,
  ...extra,
});

test("tables become structs, nullable columns std::optional", () => {
  const { code } = generateCpp({ ...shop(DB.POSTGRES), title: "My Shop" });
  assert.match(code, /^namespace my_shop \{$/m);
  assert.match(code, /^struct Customers \{$/m);
  assert.match(code, /std::int32_t id\{\};\s+\/\/\/< primary key/);
  assert.match(code, /^ {2}std::string email;$/m);
  assert.match(code, /^ {2}std::optional<std::string> name;$/m);
  assert.match(
    code,
    /std::optional<std::string> status = std::string\("new"\);/,
  );
  assert.match(
    code,
    /std::int32_t customer_id\{\};\s+\/\/\/< references customers\.id/,
  );
  assert.match(code, /static constexpr std::string_view kTable = "customers";/);
  assert.match(code, /kPrimaryKey\{Column::order_id, Column::product_id\}/);
  assert.match(code, /#include <optional>/);
});

test("types follow the engine: SQLite integers are 64-bit, MySQL unsigned", () => {
  const sqlite = generateCpp(
    diagram(
      [
        table("t", [
          field({ id: 1, name: "n", type: "INTEGER", notNull: true }),
        ]),
      ],
      {
        database: DB.SQLITE,
      },
    ),
  ).code;
  assert.match(sqlite, /std::int64_t n\{\};/);
  const mysql = generateCpp(
    diagram(
      [
        table("t", [
          field({
            id: 1,
            name: "a",
            type: "INTEGER",
            unsigned: true,
            notNull: true,
          }),
          field({ id: 2, name: "b", type: "BIGINT", notNull: true }),
          field({ id: 3, name: "c", type: "TINYINT", notNull: true }),
          field({
            id: 4,
            name: "d",
            type: "DECIMAL",
            size: "10,2",
            notNull: true,
          }),
          field({
            id: 5,
            name: "e",
            type: "DECIMAL",
            size: "9",
            notNull: true,
          }),
        ]),
      ],
      { database: DB.MYSQL },
    ),
  );
  assert.match(mysql.code, /std::uint32_t a\{\};/);
  assert.match(mysql.code, /std::int64_t b\{\};/);
  assert.match(mysql.code, /std::int8_t c\{\};/);
  assert.match(mysql.code, /double d\{\};/);
  assert.match(mysql.code, /std::int32_t e\{\};/);
  assert.ok(mysql.issues.some((i) => i.code === "decimal_as_double"));
  const exact = generateCpp(
    diagram([
      table("t", [field({ id: 1, name: "d", type: "NUMERIC", size: "10,2" })]),
    ]),
    { decimalAs: "string" },
  );
  assert.match(exact.code, /std::optional<std::string> d;/);
});

test("every type of every engine maps to something", () => {
  for (const dialect of [
    DB.MYSQL,
    DB.MARIADB,
    DB.POSTGRES,
    DB.SQLITE,
    DB.MSSQL,
    DB.ORACLESQL,
  ]) {
    const { code, issues } = generateCpp(allTypesDiagram(dialect, dbToTypes), {
      soci: true,
      sqlpp11: true,
    });
    assert.ok(code.includes("struct "), dialect);
    assert.ok(!issues.some((i) => i.level === "error"), dialect);
  }
});

test("enums become enum classes with string conversions", () => {
  const { code } = generateCpp(
    diagram(
      [
        table("orders", [
          field({
            id: 1,
            name: "state",
            type: "ENUM",
            values: ["new", "in progress", "2fa", "class"],
            default: "in progress",
            notNull: true,
          }),
          field({ id: 2, name: "mood", type: "mood" }),
        ]),
      ],
      { enums: [{ name: "mood", values: ["sad", "ok"] }] },
    ),
  );
  assert.match(code, /enum class Mood \{\n {2}Sad,\n {2}Ok,\n\};/);
  assert.match(
    code,
    /enum class OrdersState \{\n {2}New,\n {2}InProgress,\n {2}V2fa,\n {2}Class,\n\};/,
  );
  assert.match(
    code,
    /case OrdersState::InProgress:\n {6}return "in progress";/,
  );
  assert.match(
    code,
    /inline bool from_string\(std::string_view text, OrdersState& value\)/,
  );
  assert.match(code, /OrdersState state = OrdersState::InProgress;/);
  assert.match(code, /std::optional<Mood> mood;/);
});

test("names that are not valid C++ are fixed and reported", () => {
  const { code, issues } = generateCpp(
    diagram([
      table("order", [
        field({ id: 1, name: "class", type: "INTEGER", notNull: true }),
        field({ id: 2, name: "2nd value", type: "TEXT" }),
        field({ id: 3, name: "kTable", type: "TEXT" }),
      ]),
    ]),
    { namespaceName: "my-app::db" },
  );
  assert.match(code, /std::int32_t class_\{\};/);
  assert.match(code, /std::optional<std::string> f2nd_value;/);
  assert.match(code, /std::optional<std::string> kTable_2;/);
  assert.match(code, /^namespace my_app::db \{$/m);
  assert.ok(issues.some((i) => i.code === "namespace_invalid"));
  assert.ok(issues.some((i) => i.code === "name_changed"));
});

test("settings change the output", () => {
  const doc = { ...shop(DB.MYSQL), title: "Shop" };
  const plain = generateCpp(doc, {
    nullableAs: "plain",
    timeAs: "string",
    headerGuard: "ifndef",
    singularTypes: true,
    typeSuffix: "Row",
    memberCase: "camel",
    standard: "cpp20",
  }).code;
  assert.doesNotMatch(plain, /std::optional/);
  assert.match(plain, /^#ifndef DRAWDB_SHOP_HPP$/m);
  assert.match(plain, /^struct CustomerRow \{$/m);
  assert.match(plain, /std::int32_t customerId\{\};/);
  assert.match(plain, /bool operator==\(const CustomerRow&\) const = default;/);
  // Unknown or mistyped settings fall back to the defaults.
  assert.deepEqual(
    normalizeCppOptions({ standard: "cpp98", soci: "yes", nope: 1 }),
    normalizeCppOptions({}),
  );
  assert.ok(CPP_OPTION_DEFS.every((def) => def.section));
});

test("sqlpp11 tables and SOCI conversions are generated on request", () => {
  const { code } = generateCpp(
    { ...shop(DB.POSTGRES), title: "Shop" },
    {
      sqlpp11: true,
      soci: true,
    },
  );
  assert.match(code, /namespace shop::tables \{/);
  assert.match(
    code,
    /struct Customers : sqlpp::table_t<Customers, Customers_::Id,/,
  );
  assert.match(
    code,
    /using _traits = sqlpp::make_traits<sqlpp::integer, sqlpp::tag::must_not_insert, sqlpp::tag::must_not_update>;/,
  );
  assert.match(
    code,
    /using _traits = sqlpp::make_traits<sqlpp::text, sqlpp::tag::require_insert>;/,
  );
  assert.match(code, /struct type_conversion<shop::Customers> \{/);
  assert.match(code, /if \(v\.get_number_of_columns\(\) == 0\) return;/);
  assert.match(code, /v\.set\("name", std::string\(\), i_null\);/);
  assert.match(code, /#ifndef DRAWDB_SOCI_HELPERS/);
});

const compiler = spawnSync("g++", ["--version"]).status === 0 ? "g++" : null;

test(
  "the header compiles as C++17 and C++20",
  { skip: !compiler && "g++ is not installed" },
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drawdb-cpp-test-"));
    try {
      for (const standard of ["cpp17", "cpp20"]) {
        const { code } = generateCpp(
          { ...allTypesDiagram(DB.POSTGRES, dbToTypes), title: "All" },
          { standard },
        );
        fs.writeFileSync(path.join(dir, "schema.hpp"), code);
        fs.writeFileSync(
          path.join(dir, "main.cpp"),
          '#include "schema.hpp"\nint main() { return 0; }\n',
        );
        const result = spawnSync(
          compiler,
          [
            `-std=${standard === "cpp20" ? "c++20" : "c++17"}`,
            "-fsyntax-only",
            "-Wall",
            "-Wextra",
            "-Werror",
            path.join(dir, "main.cpp"),
          ],
          { encoding: "utf8" },
        );
        assert.equal(result.status, 0, result.stderr);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
