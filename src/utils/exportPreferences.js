// Export settings are remembered per browser, so the next export starts from
// the last choices. Storage can be unavailable (private mode, blocked site
// data); the dialog then simply starts from the defaults.
const key = (kind) => `drawdb.export.${kind}`;

export function loadExportOptions(kind) {
  try {
    const stored = JSON.parse(localStorage.getItem(key(kind)) ?? "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored)
      ? stored
      : {};
  } catch {
    return {};
  }
}

export function saveExportOptions(kind, options) {
  try {
    localStorage.setItem(key(kind), JSON.stringify(options));
  } catch {
    // Not persisted; the export itself is unaffected.
  }
}
