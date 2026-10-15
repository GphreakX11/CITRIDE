import { modeForView, type WorkspaceMode } from "./navigation.ts";
const allowedViews = new Set([
  "command",
  "cop",
  "cyber",
  "coordination",
  "uctf",
  "consequence",
  "leadership",
  "federation",
  "overview",
  "incident",
  "blueprint",
  "relationships",
  "reasoning",
  "lab",
  "evidence",
  "sources",
  "case-file",
  "entity-profile",
]);
const identifier = (v: string | null) =>
  v && /^[A-Za-z0-9_.:-]{1,128}$/.test(v) ? v : null;
export function readPrototypeLocation(url: string) {
  const query = new URL(url, "http://local.invalid").searchParams;
  const view = allowedViews.has(query.get("view") ?? "")
    ? query.get("view")!
    : "command";
  const mode = modeForView(
    view,
    query.get("mode") === "analyst" ? "analyst" : "command",
  );
  return {
    view,
    mode,
    entityId: identifier(query.get("entity")),
    caseId: identifier(query.get("case")),
    explicitFocus: query.get("focus") === "1",
  };
}
export function prototypeLocation(
  url: string,
  view: string,
  entityId: string | null,
  caseId: string | null,
  mode?: WorkspaceMode,
) {
  const next = new URL(url, "http://local.invalid");
  next.searchParams.set(
    "mode",
    modeForView(
      view,
      mode ??
        (next.searchParams.get("mode") === "analyst" ? "analyst" : "command"),
    ),
  );
  next.searchParams.set("view", allowedViews.has(view) ? view : "command");
  next.searchParams.set("focus", "1");
  for (const [key, value] of [
    ["entity", entityId],
    ["case", caseId],
  ] as const) {
    const valid = identifier(value);
    if (valid) next.searchParams.set(key, valid);
    else next.searchParams.delete(key);
  }
  return next.pathname + next.search + next.hash;
}
