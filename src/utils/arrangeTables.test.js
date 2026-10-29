import assert from "node:assert/strict";
import test from "node:test";
import { arrangeTables } from "./arrangeTables.js";
import { tableWidth } from "../data/constants.js";

const table = (id, fields = 3) => ({
  id,
  fields: Array.from({ length: fields }, (_, i) => ({ id: `${id}${i}` })),
});
const link = (from, to) => ({
  id: `${from}-${to}`,
  startTableId: from,
  endTableId: to,
});

test("tables referenced go left of those that reference them, none overlap", () => {
  const tables = ["a", "b", "c", "d", "e", "f", "lonely"].map((id) =>
    table(id),
  );
  const relationships = [
    link("b", "a"),
    link("c", "b"),
    link("d", "b"),
    link("e", "c"),
    link("e", "d"),
    link("f", "f"), // self reference
  ];
  const diagram = { tables, relationships };
  arrangeTables(diagram);
  const at = Object.fromEntries(tables.map((t) => [t.id, t]));
  assert.ok(at.a.x < at.b.x && at.b.x < at.c.x && at.b.x < at.d.x);
  for (const t of tables) {
    assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y));
  }
  for (const [i, p] of tables.entries()) {
    for (const q of tables.slice(i + 1)) {
      const apart =
        p.x + tableWidth <= q.x ||
        q.x + tableWidth <= p.x ||
        p.y + 36 * p.fields.length + 80 <= q.y ||
        q.y + 36 * q.fields.length + 80 <= p.y;
      assert.ok(apart, `${p.id} overlaps ${q.id}`);
    }
  }
});

test("a cycle of references is still placed", () => {
  const diagram = {
    tables: [table("p"), table("q"), table("r")],
    relationships: [link("p", "q"), link("q", "r"), link("r", "p")],
  };
  arrangeTables(diagram);
  for (const t of diagram.tables) {
    assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y));
  }
});

test("no tables, no relationships, and unlinked tables are all handled", () => {
  arrangeTables({ tables: [], relationships: [] });
  const only = { tables: [table("x"), table("y")], relationships: [] };
  arrangeTables(only);
  assert.notDeepEqual(
    [only.tables[0].x, only.tables[0].y],
    [only.tables[1].x, only.tables[1].y],
  );
});
