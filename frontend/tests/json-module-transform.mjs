import { transformWithOxc as transform } from "vite";

// The real Vite build handles JSON modules before its TS transform. Recursive
// source-module tests need that same narrow step, without mocking the data.
export function transformWithOxc(source, filename, options) {
  if (String(filename).endsWith(".json")) {
    const value = JSON.parse(source);
    return transform(`export default ${JSON.stringify(value)};`, `${filename}.ts`, options);
  }
  // Recursive test compilers rewrite these imports into JS data URLs, so the
  // original JSON assertion no longer applies to that transformed module.
  source = source.replace(/(from\s+["'][^"']+\.json["'])\s+with\s*\{\s*type:\s*["']json["']\s*\}/g, "$1");
  return transform(source, filename, options);
}
