// Writes dist/third-party-licenses.txt: the name, version, licence and licence
// text of every production dependency. The front-end bundle drops the comments
// that carried those notices, and MIT, BSD, Apache and the rest ask for them to
// travel with the code. Fails the build if a dependency's licence is unknown or
// not on the allow-list below.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* global process */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist", "third-party-licenses.txt");

// Free software licences compatible with distributing this AGPL-3.0 program.
const ALLOWED = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MPL-2.0",
  "OFL-1.1",
  "Python-2.0",
  "Unlicense",
  "WTFPL",
  "Zlib",
  "GPL-3.0-or-later",
]);
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.|-|$)/i;

function licenseIds(expression) {
  return String(expression)
    .replace(/[()]/g, " ")
    .split(/\s+(?:OR|AND)\s+|\s+/)
    .map((id) => id.trim())
    .filter((id) => id && id !== "OR" && id !== "AND");
}

function isAllowed(expression) {
  const text = String(expression);
  // "SEE LICENSE IN file" points at a custom text; it is read and reviewed.
  if (/SEE LICENSE IN/i.test(text)) return true;
  const ids = licenseIds(text);
  if (/\bOR\b/.test(text)) return ids.some((id) => ALLOWED.has(id));
  return ids.length > 0 && ids.every((id) => ALLOWED.has(id));
}

const lock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);
const entries = [];
const problems = [];

for (const [location, meta] of Object.entries(lock.packages)) {
  if (!location || meta.dev || meta.link) continue;
  const directory = path.join(root, location);
  let manifest = {};
  try {
    manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf8"),
    );
  } catch {
    continue; // optional dependency for another platform
  }
  const license =
    manifest.license ??
    (Array.isArray(manifest.licenses)
      ? manifest.licenses.map((l) => l.type ?? l).join(" OR ")
      : meta.license);
  if (!license || !isAllowed(license)) {
    problems.push(`${manifest.name}@${manifest.version}: ${license ?? "none"}`);
  }
  const texts = fs
    .readdirSync(directory)
    .filter((file) => LICENSE_FILE.test(file))
    .sort()
    .map((file) => fs.readFileSync(path.join(directory, file), "utf8").trim());
  entries.push({
    name: manifest.name ?? location.replace(/^.*node_modules\//, ""),
    version: manifest.version ?? meta.version,
    license: typeof license === "string" ? license : JSON.stringify(license),
    texts,
  });
}

if (problems.length) {
  console.error(
    `Dependencies with a missing or unexpected licence:\n  ${problems.join("\n  ")}`,
  );
  process.exit(1);
}

entries.sort((a, b) => a.name.localeCompare(b.name));
const rule = "=".repeat(78);
const body = [
  "Third-party software bundled in this program",
  "",
  "This program is free software under the GNU Affero General Public License",
  "version 3 (see /source). It includes the following components, each under",
  "its own licence.",
  "",
  ...entries.flatMap((entry) => [
    rule,
    `${entry.name} ${entry.version}`,
    `License: ${entry.license}`,
    "",
    ...(entry.texts.length
      ? entry.texts
      : ["(The package ships no licence file; see its licence identifier.)"]),
    "",
  ]),
].join("\n");

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${body}\n`);
console.log(
  `Wrote ${entries.length} licences to dist/third-party-licenses.txt`,
);
