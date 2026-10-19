import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { incidentInputs, capturedIncidentIsStale, contextIsStale, snapshotFreshnessLabel } from '../src/incidentFreshness.ts';
const fixture = () => ({baselineRevision: 1, defaultEvaluationHour: 1, defaultHorizonHours: 12,
 entities: [{id:'water'}, {id:'care'}, {id:'port'}],
 events:[{id:'w',seenOn:'water'}, {id:'p',seenOn:'port'}],
 scenarios:[{id:'ws',seed:{provider:'water',eventRefs:['w']}}, {id:'ps',seed:{provider:'port',eventRefs:['p']}}],
 dependencies:[{id:'wd',provider:'water',dependent:'care',dependentFunction:'f',usableBackupMaxHours:4}],
 serviceFunctions:[{id:'f'}],sources:[],assumptions:[]});
test('actual snapshot indicator ignores unrelated model additions and flags own inputs',()=>{
 const before=fixture(), after=structuredClone(before), run={baselineRevision:1,baselineSnapshot:before};
 after.baselineRevision++;
 after.entities.push({id:'new-port',partOf:'port'});
 assert.equal(capturedIncidentIsStale(run,after,'w'),false);
 assert.equal(snapshotFreshnessLabel(run,after,'w'),' · Captured baseline snapshot');
 const portRun={baselineSnapshot:structuredClone(after)};
 after.dependencies[0].usableBackupMaxHours=9;
 assert.equal(capturedIncidentIsStale(run,after,'w'),true);
 assert.equal(snapshotFreshnessLabel(run,after,'w'),' · Historical snapshot; incident inputs have changed');
 assert.equal(capturedIncidentIsStale(portRun,after,'p'),false);
});
test('event changes, dependency additions/removals, sources and defaults are relevant; order is not',()=>{
 const before=fixture();
 for (const mutate of [m=>m.events[0].label='changed',m=>m.dependencies.pop(),m=>m.dependencies.push({id:'new',provider:'water',dependent:'care'}),m=>m.defaultHorizonHours=24]) {
  const after=structuredClone(before);mutate(after);
  assert.notDeepEqual(incidentInputs(before,'w'),incidentInputs(after,'w'));
 }
 const reordered=structuredClone(before);reordered.entities.reverse();
 assert.deepEqual(incidentInputs(before,'w'),incidentInputs(reordered,'w'));
});
test('legacy snapshot derives scope without requiring a persisted fingerprint; missing snapshot is conservative',()=>{
 assert.equal(capturedIncidentIsStale({baselineSnapshot:fixture()},fixture(),'w'),false);
 assert.equal(capturedIncidentIsStale({baselineRevision:1},{...fixture(),baselineRevision:2},'w'),true);
});
test('context and parameter assertion provenance use scoped inputs without mutation',()=>{
 const before=fixture();
 before.dependencies[0].parameterAssertionRefs={usableBackupMaxHours:'a'};
 before.assumptions.push({id:'a',sourceRefs:['s'],note:'before'});
 before.sources.push({id:'s',label:'before'});
 const after=structuredClone(before), context={baselineRevision:1,freshnessInputs:incidentInputs(before,'w')};
 const saved=JSON.stringify(before);
 after.baselineRevision++;
 after.entities.push({id:'unrelated-port',partOf:'port'});
 assert.equal(contextIsStale(context,after,'w'),false);
 after.assumptions[0].note='changed';
 assert.equal(contextIsStale(context,after,'w'),true);
 assert.equal(capturedIncidentIsStale({baselineSnapshot:before},after,'w'),true);
 after.assumptions[0].note='before';after.sources[0].label='changed';
 assert.equal(contextIsStale(context,after,'w'),true);
 assert.equal(JSON.stringify(before),saved);
 assert.equal(contextIsStale({baselineRevision:1},after,'w'),true);
});
test('IncidentWorkspace wires both current context and captured snapshot indicators to scoped helper',()=>{
 const source=readFileSync(new URL('../src/IncidentWorkspace.tsx',import.meta.url),'utf8');
 assert.match(source,/contextIsStale\(context, data, eventId\)/);
 assert.match(source,/snapshotFreshnessLabel\(run, data, eventId\)/);
 assert.doesNotMatch(source,/run\?\.baselineRevision !== data.baselineRevision/);
});
