import test from 'node:test';
import assert from 'node:assert/strict';
import { c1OverviewModel } from '../src/c1OverviewModel.ts';
import { c1GeographicAnchor } from '../src/c1MapLayout.ts';
import { priorityQueue } from '../src/priorityQueue.ts';
const incident={id:'third-incident',status:'active',severity:'critical',reportedAt:'2026-01-01T00:00:00Z'};
function fixture(now='2026-01-01T00:30:00Z') { return {data:{entities:[],scenarios:[],events:[]},incidents:[],selected:null,records:{statewideIncidents:[incident],decisions:[],pendingDecisions:[{id:'request',incidentId:incident.id,optionId:'advice',status:'pending'}],now},reference:{responseOptions:[{id:'advice',title:'Send advisory',decideWithinHours:2}],boilWaterRules:[],optionTimingLabels:{}}}; }
test('C1 pending deadlines sort before unknown and use remaining-time tones at exact boundaries',()=>{
 for (const [now,tone] of [['00:30','amber'],['01:00','red'],['02:01','red']]) {
  const p=fixture(`2026-01-01T${now}:00Z`);
  p.records.pendingDecisions.unshift({id:'unknown',incidentId:incident.id,status:'pending'});
  const m=c1OverviewModel(p);
  assert.equal(m.decisions[0].record.id,'advice'); assert.equal(m.decisions[0].tone,tone);
  assert.equal(m.decisions[1].tone,'grey');
 }
 const p=fixture('2025-12-31T20:00:00Z'); assert.equal(c1OverviewModel(p).decisions[0].tone,'green');
});
test('C1 derives automatic model update from the actual persisted preliminary analysis',()=>{
 const p=fixture(); const projection={incident,analysis:{id:'pre-1',kind:'preliminary',createdAt:'2026-01-01T00:10:00Z',computedAt:'2026-01-01T00:10:00Z'},nodes:[],edges:[]};
 const m=c1OverviewModel(p,{[incident.id]:projection});
 assert.equal(m.updates.length,1); assert.match(m.updates[0].text,/Preliminary analysis.*automatically/i);
 assert.equal(m.updates[0].incidentId,incident.id);
});
test('C1 geographic coordinates take precedence and unknown coordinates are not fabricated',()=>{
 const a=c1GeographicAnchor({id:'third',location:{longitude:-95,latitude:29.68,schematic:{x:1,y:1}}});
 assert.ok(a.x>70 && a.x<95); assert.ok(a.y>55 && a.y<80);
 assert.deepEqual(c1GeographicAnchor({id:'old',location:{schematic:{x:40,y:50}}}),{id:'old',x:40,y:50});
 assert.equal(c1GeographicAnchor({id:'unknown'}),null);
});
test('saved pending proposals stay requests in attention queue, not unsaved suggestions',()=>{
 const p=fixture(); const m=c1OverviewModel(p); const q=priorityQueue(m,p.records);
 assert.equal(q.items[0].view,'leadership'); assert.match(q.items[0].evidence,/Saved decision request/);
 assert.match(q.items[0].reason,/Send advisory/);
});
