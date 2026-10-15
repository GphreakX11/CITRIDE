import test from "node:test";
import assert from "node:assert/strict";
import {caseProgress} from "../src/caseSteps.ts";
const record = () => ({status:"open", contextSnapshot:{scenarios:[{id:"unsafe-water"}]},tasks:[{label:"Review source evidence",completed:false},{label:"Review consequence assumptions",completed:false}],decisions:[],runSnapshot:null});
test("steps derive from saved state without completing missing analysis",()=>{const r=record();assert.equal(caseProgress(r).current,0);r.tasks[0].completed=true;assert.equal(caseProgress(r).current,1);r.runSnapshot={};assert.equal(caseProgress(r).current,3);});
test("case-local evidence does not invent a consequence requirement",()=>{const r=record();r.contextSnapshot.scenarios=[];assert.equal(caseProgress(r).impactApplicable,false);assert.equal(caseProgress(r).done[1],true);assert.equal(caseProgress(r).remainingTasks,2);});
test("reviews require saved notes and arbitrary captured tasks stay incomplete",()=>{const r=record();r.tasks[0].completed=true;r.runSnapshot={};r.decisions=[{reviewed:true,reviewNote:""}];assert.equal(caseProgress(r).current,2);r.decisions[0].reviewNote="Reviewed assumptions";r.tasks.push({label:"Additional reference review",completed:false});assert.equal(caseProgress(r).remainingTasks,2);});
test("closed completed case is done and inputs are unchanged",()=>{const r=record();r.contextSnapshot.scenarios=[];r.tasks.forEach(t=>t.completed=true);r.status="closed";const before=structuredClone(r);assert.equal(caseProgress(r).current,-1);assert.deepEqual(r,before);});
