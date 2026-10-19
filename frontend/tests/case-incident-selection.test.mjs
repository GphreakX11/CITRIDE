import test from 'node:test';
import assert from 'node:assert/strict';
import { caseSelectionLocation, caseSelectionForIncident } from '../src/caseIncidentSelection.ts';
const records=[{id:'incident-a',caseId:'case-a',linkedEventIds:['event-a']},{id:'incident-b',linkedEventIds:['event-b']}];
test('choosing a saved case atomically replaces both incident aliases and stale filters',()=>{
 const q=new URL(caseSelectionLocation('/?mode=analyst&view=cop&case=case-a&incident=incident-a&incidentId=incident-a&sector=water&entity=old#map',{id:'case-b',eventId:'event-b'},records,'provider-b'),'https://example.invalid');
 assert.equal(q.searchParams.get('case'),'case-b');assert.equal(q.searchParams.get('incident'),'incident-b');assert.equal(q.searchParams.get('incidentId'),'incident-b');assert.equal(q.searchParams.get('sector'),null);assert.equal(q.searchParams.get('entity'),'provider-b');assert.equal(q.hash,'#map');
});
test('saved case direct record mapping takes precedence without static incident names',()=>{
 const q=new URL(caseSelectionLocation('/?incident=stale',{id:'case-a',eventId:'event-b'},records,null),'https://example.invalid');assert.equal(q.searchParams.get('incidentId'),'incident-a');assert.equal(q.searchParams.get('entity'),null);
});
test('clearing a saved case retains explicit incident focus for no-case alert landing',()=>{
 const q=new URL(caseSelectionLocation('/?case=case-a&incident=incident-b&incidentId=incident-b&entity=old',null,records,null),'https://example.invalid');assert.equal(q.searchParams.get('case'),null);assert.equal(q.searchParams.get('incidentId'),'incident-b');assert.equal(q.searchParams.get('entity'),null);
});
test('unmapped saved case never inherits a different incident or sector',()=>{
 const q=new URL(caseSelectionLocation('/?incidentId=incident-a&sector=water',{id:'case-c',eventId:'event-c'},records,'provider-c'),'https://example.invalid');assert.equal(q.searchParams.get('incident'),null);assert.equal(q.searchParams.get('incidentId'),null);assert.equal(q.searchParams.get('sector'),null);assert.equal(q.searchParams.get('case'),'case-c');
});

const savedCases = [{id:'first',eventId:'event-first'}, {id:'chosen',eventId:'event-chosen',status:'closed'}];
const shared = [{id:'shared',caseId:'first',linkedEventIds:['event-first','event-chosen']}];
test('an explicit linked case beats the incident default, including a closed saved case',()=>{
 assert.equal(caseSelectionForIncident('shared',savedCases,shared,'chosen'),'chosen');
 assert.equal(caseSelectionForIncident('shared',[...savedCases].reverse(),shared,'chosen'),'chosen');
});
test('invalid or unrelated explicit cases still fall back to the direct case mapping',()=>{
 for(const selected of ['deleted','unrelated',null]) assert.equal(caseSelectionForIncident('shared',savedCases,shared,selected),'first');
});
test('saved-case IDs used directly as incident IDs retain their selection',()=>{
 assert.equal(caseSelectionForIncident('chosen',savedCases,[],'chosen'),'chosen');
 assert.equal(caseSelectionForIncident('chosen',savedCases,[],null),'chosen');
});
test('a stale direct mapping or an empty case store cannot invent a saved case',()=>{
 assert.equal(caseSelectionForIncident('shared',savedCases,[{...shared[0],caseId:'deleted'}],null),null);
 assert.equal(caseSelectionForIncident('shared',[],shared,'chosen'),null);
});
