import {
  tableColorStripHeight,
  tableFieldHeight,
  tableHeaderHeight,
  tableWidth,
} from "../data/constants";

const GAP_X = 230; // between columns: lines, cardinality marks and names
const GAP_Y = 50;
const MARGIN = 60;
const MAX_COLUMN_HEIGHT = 1500;

const heightOf = (table) =>
  table.fields.length * tableFieldHeight +
  tableHeaderHeight +
  tableColorStripHeight;

/**
 * Lays the tables out so the relationships read: a table goes to the right
 * of the tables it references (columns by dependency depth), each column is
 * ordered to cross as few lines as possible, and tables with no
 * relationship go in a block of their own below.
 */
export function arrangeTables(diagram) {
  const tables = diagram.tables ?? [];
  if (!tables.length) return;
  const byId = new Map(tables.map((t) => [t.id, t]));
  const parents = new Map(tables.map((t) => [t.id, new Set()]));
  const children = new Map(tables.map((t) => [t.id, new Set()]));
  for (const r of diagram.relationships ?? diagram.references ?? []) {
    if (
      r.startTableId === r.endTableId ||
      !byId.has(r.startTableId) ||
      !byId.has(r.endTableId)
    ) {
      continue;
    }
    // The table with the foreign key (start) references the other (end).
    parents.get(r.startTableId).add(r.endTableId);
    children.get(r.endTableId).add(r.startTableId);
  }

  // Column of each table: one more than its deepest parent. Cycles are cut
  // where the depth-first walk meets a table it is still visiting.
  const layer = new Map();
  const visiting = new Set();
  const depth = (id) => {
    if (layer.has(id)) return layer.get(id);
    if (visiting.has(id)) return -1;
    visiting.add(id);
    let value = 0;
    for (const parent of parents.get(id)) {
      value = Math.max(value, depth(parent) + 1);
    }
    visiting.delete(id);
    layer.set(id, value);
    return value;
  };
  tables.forEach((t) => depth(t.id));

  const linked = tables.filter(
    (t) => parents.get(t.id).size || children.get(t.id).size,
  );
  const loose = tables.filter(
    (t) => !parents.get(t.id).size && !children.get(t.id).size,
  );

  const columns = [];
  for (const t of linked) {
    (columns[layer.get(t.id)] ??= []).push(t);
  }
  const filled = columns.filter(Boolean);
  if (!filled.length) filled.push([]);

  // Order each column by the average position of the tables it is linked to
  // (back and forth a few times).
  const position = new Map();
  const index = () =>
    filled.forEach((column) =>
      column.forEach((t, i) => position.set(t.id, i / column.length)),
    );
  index();
  const average = (t) => {
    const near = [...parents.get(t.id), ...children.get(t.id)].filter((id) =>
      position.has(id),
    );
    return near.length
      ? near.reduce((sum, id) => sum + position.get(id), 0) / near.length
      : position.get(t.id);
  };
  for (let pass = 0; pass < 6; pass++) {
    const order = pass % 2 ? [...filled].reverse() : filled;
    for (const column of order) {
      column.sort((a, b) => average(a) - average(b));
      index();
    }
  }

  // Place the columns, each table level with the tables it references (so
  // lines run short and straight); a column that would be too tall
  // continues in another. Tables with no relationship go at the foot of the
  // first column.
  filled[0].push(...loose);
  const placed = new Map();
  let x = MARGIN;
  for (const column of filled) {
    let y = MARGIN;
    let columnX = x;
    let extra = 0;
    for (const t of column) {
      const above = [...parents.get(t.id)]
        .map((id) => placed.get(id))
        .filter(Boolean);
      const wanted = above.length
        ? above.reduce((sum, v) => sum + v, 0) / above.length
        : y;
      y = Math.max(y, wanted);
      if (y > MARGIN && y + heightOf(t) > MARGIN + MAX_COLUMN_HEIGHT) {
        y = MARGIN;
        columnX += tableWidth + GAP_X;
        extra++;
      }
      t.x = columnX;
      t.y = y;
      placed.set(t.id, y);
      y += heightOf(t) + GAP_Y;
    }
    x += (extra + 1) * (tableWidth + GAP_X);
  }
}
