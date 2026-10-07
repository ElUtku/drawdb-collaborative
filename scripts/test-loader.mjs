// Lets `node --test` load the front-end modules, which import siblings
// without a file extension the way Vite allows:
//   node --import ./scripts/test-loader.mjs --test <files>
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    const relative = specifier.startsWith(".") || specifier.startsWith("/");
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !relative) throw error;
    for (const suffix of [".js", ".jsx", "/index.js"]) {
      try {
        return await next(specifier + suffix, context);
      } catch {
        // try the next suffix
      }
    }
    throw error;
  }
}
`),
);
