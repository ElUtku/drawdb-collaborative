// Writes .br and .gz siblings for the text assets in dist/ so the server can
// hand out a compressed body without paying for compression per request.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

/* global process */

const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|txt|xml|map|ico)$/i;
const MINIMUM_BYTES = 1024;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

if (!fs.existsSync(dist)) {
  console.error("No dist/ directory to compress. Run the build first.");
  process.exit(1);
}

let originalBytes = 0;
let brotliBytes = 0;
let files = 0;

for (const file of walk(dist)) {
  if (!COMPRESSIBLE.test(file) || /\.(br|gz)$/i.test(file)) continue;
  const source = fs.readFileSync(file);
  if (source.length < MINIMUM_BYTES) continue;

  const brotli = zlib.brotliCompressSync(source, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length,
    },
  });
  const gzip = zlib.gzipSync(source, { level: zlib.constants.Z_BEST_COMPRESSION });

  // Keep a variant only when it actually pays for itself.
  if (brotli.length < source.length) fs.writeFileSync(`${file}.br`, brotli);
  if (gzip.length < source.length) fs.writeFileSync(`${file}.gz`, gzip);

  files += 1;
  originalBytes += source.length;
  brotliBytes += Math.min(brotli.length, source.length);
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);
console.log(
  `precompressed ${files} files: ${mb(originalBytes)} MB -> ${mb(brotliBytes)} MB brotli`,
);
