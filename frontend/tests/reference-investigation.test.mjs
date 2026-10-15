import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { referenceFromEvent, referenceSourceEvent } from "../src/referenceInvestigation.ts";
import { caseEntityIds, caseFocusEntity, evidenceForContext, caseSelectionAfterRead } from "../src/investigationContext.ts";
const reference = JSON.parse(readFileSync(new URL("../../backend/citride/reference_data/waterutil-fuel-v2.json", import.meta.url)));
const event = () => ({...referenceSourceEvent, referenceInvestigation: structuredClone(reference)});
const record = () => ({id:"reference-case", status:"open", eventSnapshot:event(), contextSnapshot:{provider:null, facility:null, physicalAsset:null, cyberAsset:null, downstreamDependencies:[]}, decisions:[]});
test("canonical source is fully readable and credential-redacted", () => {
 const data=referenceFromEvent(event());
 assert.ok(data); assert.equal(data.assets.length,16); assert.equal(data.timeline.length,14); assert.equal(data.tasks.length,8);
 assert.equal(data.capture.verified,false); assert.equal(data.source.pcapProvided,false);
 assert.equal(JSON.stringify(data).includes("sk_live_"),false);
});
test("ordinary and absent events are not reference evidence", () => {
 assert.equal(referenceFromEvent({...event(), id:"event-dosing"}),null);
 assert.equal(referenceFromEvent({...event(), type:"CyberObservation"}),null);
 for(const value of [undefined,null,{id:"event-dosing"},referenceSourceEvent]) assert.equal(referenceFromEvent(value),null);
});
test("malformed evidence shapes fail closed", () => {
 for (const mutate of [r=>r.source.sha256="bad", r=>r.source.pcapProvided=true, r=>r.capture.verified=true, r=>r.assets[0].scope="live", r=>r.timeline[0].reportedActivities=[42], r=>r.tasks[0].acceptance=null, r=>r.reviewLimits=null]) {
 const value=event(); mutate(value.referenceInvestigation); assert.equal(referenceFromEvent(value),null);
 }
});
test("reference hosts do not become model/entity links", () => {
 const value=record(); assert.equal(caseEntityIds(value).size,0); assert.equal(caseFocusEntity(value,"utility-water-a"),null);
});
test("Evidence shortcut retains the captured reference manifest", () => {
 const value=record(); assert.deepEqual(evidenceForContext({events:[]},value,null),[value.eventSnapshot]);
 assert.ok(referenceFromEvent(evidenceForContext({events:[]},value,null)[0]));
});
test("refresh keeps an explicitly selected case-local reference", () => {
 assert.equal(caseSelectionAfterRead([record()],null,"reference-case",false),"reference-case");
 assert.equal(caseSelectionAfterRead([record()],null,null,false),null);
});
