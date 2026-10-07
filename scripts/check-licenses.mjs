// Fails when a production dependency is not under a free software license.
// Reads a CycloneDX SBOM (the file given, or `npm sbom` run on the spot) and
// checks every component's license, or license expression, against the list
// below. "A OR B" passes when one side is free, "A AND B" when both are.
//
//   node scripts/check-licenses.mjs [sbom.cdx.json]

/* global process */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const FREE = new Set([
  "0BSD",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "GPL-2.0-or-later",
  "GPL-3.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "ISC",
  "LGPL-2.1-or-later",
  "LGPL-3.0",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "OFL-1.1",
  "Python-2.0",
  "Unlicense",
  "WTFPL",
  "Zlib",
]);

function free(expression) {
  const text = expression.trim().replace(/^\((.*)\)$/, "$1");
  // Split on the operator of lowest precedence outside parentheses.
  for (const operator of [" OR ", " AND "]) {
    let depth = 0;
    const parts = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      else if (depth === 0 && text.startsWith(operator, i)) {
        parts.push(text.slice(start, i));
        start = i + operator.length;
      }
    }
    if (parts.length) {
      parts.push(text.slice(start));
      return operator === " OR " ? parts.some(free) : parts.every(free);
    }
  }
  return FREE.has(text.replace(/\+$/, "-or-later"));
}

const file = process.argv[2];
const sbom = JSON.parse(
  file
    ? fs.readFileSync(file, "utf8")
    : execFileSync(
        "npm",
        ["sbom", "--sbom-format", "cyclonedx", "--omit", "dev"],
        { encoding: "utf8", maxBuffer: 64 << 20 },
      ),
);

// npm leaves out licenses it cannot parse (say "MIT OR SEE LICENSE IN
// FEEL-FREE.md"); the package's own declaration is read then.
function declared(component) {
  try {
    const file = `node_modules/${component.name}/package.json`;
    const license = JSON.parse(fs.readFileSync(file, "utf8")).license;
    return typeof license === "string" ? [license] : [];
  } catch {
    return [];
  }
}

const problems = [];
for (const component of sbom.components ?? []) {
  let licenses = (component.licenses ?? [])
    .map(
      (entry) =>
        entry.expression ?? entry.license?.id ?? entry.license?.name ?? "",
    )
    .filter(Boolean);
  if (!licenses.length) licenses = declared(component);
  const name = `${component.name}@${component.version}`;
  if (!licenses.length) {
    problems.push(`${name}: no license declared`);
  } else if (!licenses.every(free)) {
    problems.push(`${name}: ${licenses.join(", ")}`);
  }
}

const count = sbom.components?.length ?? 0;
if (problems.length) {
  console.error(`Dependencies that are not clearly free software:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`${count} production dependencies, all under free licenses.`);
}
