import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readConsequenceSelection, writeConsequenceSelection} from '../src/consequenceSelection.ts';

test('A1 uses provider selection without hiding other alerts and listens to same-document updates',()=>{
 const source=readFileSync(new URL('../src/AnalystAlerts.tsx',import.meta.url),'utf8');
 assert.match(source,/context \? context.selectedIncidentId : focusId/);
 assert.match(source,/orderedAlerts\(data.events, focusedEvents, eventTimestamp\)/);
 assert.doesNotMatch(source,/filter\(event => !focusedEvents/);
 assert.match(source,/addEventListener\("consequence-selection", restore\)/);
 assert.match(source,/removeEventListener\("consequence-selection", restore\)/);
 assert.doesNotMatch(source,/incidentFocusLocation|readIncidentFocus/);
});
test('clearing A1 removes both incident aliases plus stale sector/entity; keeps route and case and a restorable history entry',()=>{
 const previous=globalThis.window;
 const start='http://127.0.0.1/?mode=analyst&view=command&case=saved&incident=old&incidentId=old&sector=care&entity=asset#analyst-alerts';
 let method,location,event;
 globalThis.window={location:{href:start},history:{pushState(_s,_t,url){method='push';location=url;},replaceState(){throw Error('must not overwrite previous selection');}},dispatchEvent(e){event=e.type;}};
 try {
  writeConsequenceSelection({incidentId:null});
  assert.equal(method,'push');assert.equal(event,'consequence-selection');
  assert.deepEqual(readConsequenceSelection(location),{incidentId:null,sector:'all',entityId:null});
  const url=new URL(location,'http://127.0.0.1');assert.equal(url.searchParams.get('case'),'saved');assert.equal(url.searchParams.get('view'),'command');assert.equal(url.hash,'#analyst-alerts');
  assert.equal(readConsequenceSelection(start).entityId,'asset');
 } finally {globalThis.window=previous;}
});
test('at least 50 synthetic incident selections round-trip independently, without carrying stale asset selection',()=>{
 const incidents=Array.from({length:50},(_,i)=>({id:`fixture-incident-${i}`,entity:`fixture-asset-${i}`}));
 assert.equal(incidents.length,50);
 let previous=globalThis.window,url='http://127.0.0.1/?mode=analyst&view=command',writes=0;
 globalThis.window={location:{get href(){return url;}},history:{pushState(_s,_t,next){url=new URL(next,'http://127.0.0.1').href;writes++;}},dispatchEvent(){}};
 try {for(const incident of incidents){writeConsequenceSelection({incidentId:incident.id});assert.deepEqual(readConsequenceSelection(url),{incidentId:incident.id,sector:'all',entityId:null});writeConsequenceSelection({entityId:incident.entity,sector:'Care'});assert.equal(readConsequenceSelection(url).entityId,incident.entity);}assert.equal(writes,100);}finally{globalThis.window=previous;}
});
