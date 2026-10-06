export function escapeQuotes(str) {
  return String(str ?? "").replace(/'/g, "''");
}
