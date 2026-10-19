import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test('A3/A4 connect the parent-owned records, analysis and proposal workflows',()=>{
 const source=read('CommandReadouts.tsx');
 assert.match(source,/<AnalystConsequences/);
 for(const prop of ['onWhatIf','onAnalyze','onPropose'])assert.ok(source.includes(`${prop}={${prop}}`));
 assert.match(source,/incident=\{selected\}/);assert.match(source,/onMutate=\{onMutate\}/);
});
const read = (p) =>
  readFileSync(new URL("../src/" + p, import.meta.url), "utf8");
test("live investigation map receives case overlay data and Entity Profile navigation, with old location records still available", () => {
  const s = read("CommandReadouts.tsx"),
    map = s.slice(
      s.indexOf("<TexasInfrastructureMap"),
      s.indexOf("/>", s.indexOf("<TexasInfrastructureMap")),
    );
  assert.match(map, /incidents=\{incidents\}/);
  assert.match(map, /onOpenEntityProfile=/);
  assert.match(map, /onOpenAnalyst\("entity-profile", selected\?\.id \?\? null, id\)/);
  assert.match(s, /Advanced · all located records/);
  assert.match(s, /members\.map/);
});
test("A1 uses the shared create form, explicit create callback, header entry point and required copy", () => {
  assert.match(read("CommandCasework.tsx"), /<CaseCreateForm/);
  assert.match(read("AnalystAlerts.tsx"), /<CaseCreateForm/);
  const s = read("CommandWorkspace.tsx");
  assert.match(s, /onCreate=\{async \(request\)/);
  assert.match(s, /Open case from alert/);
  assert.match(read("CommandReadouts.tsx"), /Needs you next/);
});
