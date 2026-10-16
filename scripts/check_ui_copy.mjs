#!/usr/bin/env node
/** Check literal JSX/TS UI copy, not identifiers, comments or persisted evidence. */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, join, extname } from "node:path";
import { parse } from "../frontend/node_modules/@babel/parser/lib/index.js";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const RETIRED = [
  /\bnot supplied\b/i,
  /\bworkspace cases?\b/i,
  /\bOffline packet evidence\b/i,
  /\bSITUATIONAL AWARENESS\b/i,
  /\bANALYST WORKFLOW\b/i,
  /\bPending action\b/i,
  /\bOpen entity in expert graph\b/i,
  /\bAnalyze captured scenario\b/i,
  /\badvisory reviews?\b/i,
  /\breview decision\b/i,
  /\bconditional scenarios?\b/i,
  /\bReference workspace\b/i,
  /\bIDT unavailable\b/i,
  /\bOpen Case File\b/,
  /^\s*Investigate(?:\s|$)/i,
];
function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  if (typeof node.type === "string" && !node.type.includes("Comment"))
    visit(node);
  for (const [key, value] of Object.entries(node))
    if (
      ![
        "loc",
        "start",
        "end",
        "extra",
        "comments",
        "leadingComments",
        "trailingComments",
        "innerComments",
        "tokens",
      ].includes(key) &&
      value &&
      typeof value === "object"
    )
      walk(value, visit);
}
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : /\.(?:ts|tsx)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}
export function inspectCopy(source, name = "screen.tsx") {
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: extname(name) === ".tsx" ? ["typescript", "jsx"] : ["typescript"],
  });
  const findings = [];
  walk(ast, (node) => {
    const text =
      node.type === "StringLiteral" || node.type === "JSXText"
        ? node.value
        : node.type === "TemplateElement"
          ? (node.value.cooked ?? node.value.raw)
          : null;
    if (typeof text !== "string") return;
    const normalized = text.replace(/\s+/g, " ").trim();
    for (const rule of RETIRED)
      if (rule.test(normalized))
        findings.push({
          file: name,
          line: node.loc?.start.line,
          phrase: rule.source,
          text: normalized.slice(0, 180),
        });
  });
  return findings;
}
function textOf(n) {
  if (!n) return "";
  if (n.type === "StringLiteral" || n.type === "JSXText") return n.value;
  if (n.type === "TemplateLiteral")
    return n.quasis.map((q) => q.value.cooked ?? q.value.raw).join(" ");
  if (n.type === "ArrayExpression") return n.elements.map(textOf).join(" ");
  if (n.type === "ConditionalExpression")
    return textOf(n.consequent) + " / " + textOf(n.alternate);
  if (n.type === "LogicalExpression") return textOf(n.right);
  if (n.type === "CallExpression")
    return textOf(
      n.arguments?.[1]?.properties?.find(
        (p) => p.key?.name === "children" || p.key?.value === "children",
      )?.value,
    );
  return "";
}
export function paragraphStats(source) {
  const ast = parse(source, { sourceType: "unambiguous" });
  const texts = [];
  walk(ast, (n) => {
    const tag = n.type === "CallExpression" ? n.arguments[0] : null;
    const tagName =
      tag?.type === "StringLiteral"
        ? tag.value
        : tag?.type === "TemplateLiteral" && tag.expressions.length === 0
          ? tag.quasis[0]?.value.cooked
          : null;
    if (
      n.type === "CallExpression" &&
      tagName === "p" &&
      n.arguments[1]?.type === "ObjectExpression"
    )
      texts.push(
        textOf(
          n.arguments[1].properties.find(
            (p) => p.key?.name === "children" || p.key?.value === "children",
          )?.value,
        )
          .replace(/\s+/g, " ")
          .trim(),
      );
  });
  return { sites: texts.length, texts };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.includes("--paragraphs")) {
    const i = process.argv.indexOf("--paragraphs"),
      before = paragraphStats(readFileSync(process.argv[i + 1], "utf8")),
      after = paragraphStats(readFileSync(process.argv[i + 2], "utf8"));
    const residual = [...after.texts];
    let changed = 0;
    for (const t of before.texts) {
      const i = residual.indexOf(t);
      if (i >= 0) residual.splice(i, 1);
      else if (t) changed++;
    }
    console.log(
      JSON.stringify(
        {
          beforeParagraphSites: before.sites,
          afterParagraphSites: after.sites,
          netParagraphBlocksRemoved: before.sites - after.sites,
          oldParagraphTextsRemovedOrRewritten: changed,
          method:
            "Static JSX paragraph definition sites in the frozen pre-copy production bundle versus final production bundle; net count includes newly requested labels.",
        },
        null,
        2,
      ),
    );
  } else {
    const findings = files(join(ROOT, "frontend/src")).flatMap((p) =>
      inspectCopy(readFileSync(p, "utf8"), p.slice(ROOT.length)),
    );
    if (findings.length) {
      console.error(JSON.stringify(findings, null, 2));
      process.exitCode = 1;
    } else
      console.log(
        "UI copy check passed: no retired phrases in literal JSX/TypeScript UI strings.",
      );
  }
}
