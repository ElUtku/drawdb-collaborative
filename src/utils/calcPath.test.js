import assert from "node:assert/strict";
import test from "node:test";
import {
  calcCompositePath,
  calcPath,
  clampBend,
  defaultBend,
  relationshipBendX,
} from "./calcPath.js";

const WIDTH = 200;
const column = (name) => ({ id: name, name, type: "INT", comment: "" });
const table = (x, y, columns = 4) => ({
  x,
  y,
  comment: "",
  fields: Array.from({ length: columns }, (_, i) => column(`c${i}`)),
});
const route = (start, end, startFieldIndex = 0, endFieldIndex = 0) => ({
  startTable: start,
  endTable: end,
  startFieldIndex,
  endFieldIndex,
});
// The x of every vertical piece: two consecutive end points with the same x
// (each command's end point is its last two numbers).
const verticalXs = (path) => {
  const points = [...path.matchAll(/[MLAQ]([^MLAQ]*)/g)].map((m) => {
    const numbers = m[1].trim().split(/\s+/).map(Number);
    return numbers.slice(-2);
  });
  const xs = [];
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i][0] - points[i - 1][0]) < 0.01) xs.push(points[i][0]);
  }
  return xs;
};

test("a moved segment never runs under a table", () => {
  const a = table(0, 0);
  const b = table(260, 0);
  // Inside b: moves to the nearest clear side.
  assert.equal(clampBend(270, a, b, WIDTH), 240);
  // Clear of both: unchanged.
  assert.equal(clampBend(230, a, b, WIDTH), 230);
  // Stacked tables: goes round them.
  const stacked = table(0, 320);
  assert.equal(clampBend(140, a, stacked, WIDTH), 220);
  // A table and itself.
  assert.equal(clampBend(50, a, a, WIDTH), -20);
  assert.equal(clampBend(Number.NaN, a, b, WIDTH), null);
  // A stored offset is clamped too.
  assert.equal(
    relationshipBendX({ bendOffset: 40 }, a, table(260, 200), WIDTH),
    240,
  );
  assert.equal(relationshipBendX({}, a, b, WIDTH), null);
});

test("the handle sits on the automatic route's vertical segment", () => {
  const layouts = [
    route(table(0, 0), table(400, 300)),
    route(table(400, 300), table(0, 0)),
    route(table(0, 0, 10), table(150, 440), 9, 0),
    route(table(150, 440), table(0, 0, 10), 0, 9),
    route(table(0, 400), table(100, 0)),
    route(table(100, 0), table(0, 400)),
    route(table(0, 0), table(0, 0), 0, 2),
  ];
  for (const r of layouts) {
    const path = calcPath(r, WIDTH);
    const handle = defaultBend(r, WIDTH);
    const xs = verticalXs(path);
    assert.ok(
      xs.some((x) => Math.abs(x - handle.x) < 0.01),
      `${JSON.stringify(handle)} not on ${path}`,
    );
  }
});

test("routed paths are well formed in every layout", () => {
  const layouts = [
    route(table(0, 0), table(400, 300)),
    route(table(0, 0), table(0, 0), 0, 3),
    route(table(0, 0), table(400, 0)),
    route(table(0, 0), table(50, 500)),
  ];
  for (const r of layouts) {
    for (const bend of [-300, -20, 100, 230, 700]) {
      const path = calcPath(r, WIDTH, 1, true, bend);
      assert.doesNotMatch(path, /NaN|undefined|Infinity/, path);
      assert.ok(verticalXs(path).every((x) => Math.abs(x - bend) < 0.01));
    }
  }
  const composite = calcCompositePath(
    {
      startTable: table(0, 0),
      endTable: table(400, 300),
      startFieldIndices: [0, 1],
      endFieldIndices: [0, 1],
    },
    WIDTH,
    1,
    true,
    -50,
  );
  assert.doesNotMatch(composite.path, /NaN|undefined|Infinity/);
  assert.equal(composite.labelPoint.x, -50);
});
