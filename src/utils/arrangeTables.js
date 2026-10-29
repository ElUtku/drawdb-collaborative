import {
  tableColorStripHeight,
  tableFieldHeight,
  tableHeaderHeight,
} from "../data/constants";

// Tables go in a grid with room between them for the relationship lines,
// their cardinality marks and their names.
export function arrangeTables(diagram) {
  const tableWidth = 240;
  const gapX = 160;
  const gapY = 90;
  const count = diagram.tables.length;
  const columns = Math.max(1, Math.ceil(Math.sqrt(count * 1.6)));
  const height = (table) =>
    table.fields.length * tableFieldHeight +
    tableHeaderHeight +
    tableColorStripHeight;
  let y = gapY;
  for (let start = 0; start < count; start += columns) {
    const row = diagram.tables.slice(start, start + columns);
    row.forEach((table, i) => {
      table.x = gapX / 2 + i * (tableWidth + gapX);
      table.y = y;
    });
    y += Math.max(...row.map(height)) + gapY;
  }
}
