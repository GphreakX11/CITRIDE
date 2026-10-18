import test from 'node:test';
import assert from 'node:assert/strict';
import { incidentViewModel } from '../src/incidentViewModel.ts';
import { c1OverviewModel } from '../src/c1OverviewModel.ts';
const record = {id:'third-port',status:'active',severity:'critical',serviceAffected:{value:47,unit:'vessels',note:'held'},economicImpactPerDay:{usd:[100,300],basis:'planning'}};
const projection = {incident:record,analysis:{kind:'preliminary',createdAt:'2026-01-01T00:00:00Z'},source:{id:'source'},nodes:[{id:'source',name:'Source',source:true,sector:'Transportation'},{id:'middle',name:'Middle',sector:'Chemical',windowHours:[6,12],paths:[['a']]},{id:'water',name:'Water',sector:'Water',windowHours:[18,24],paths:[['a','b']]}],edges:[{id:'a',from:'source',to:'middle'},{id:'b',from:'middle',to:'water'}]};
test('C2 uses source units, explicit watch records and source paths for another incident',()=>{
 const records={watchAssets:[{id:'watch',incidentId:record.id,entityId:'peer',reason:'same campaign'},{id:'foreign',incidentId:'other',entityId:'no'}]};
 const model=incidentViewModel(record,projection,records,'water');
 assert.equal(model.service,'47 vessels · held'); assert.deepEqual([...model.visible].sort(),['middle','source','water']); assert.equal(model.watch.length,1); assert.match(model.economic,/100.*300/);
});
test('C1 counts pending proposals once and suppresses them after an actual decision',()=>{
 const props={data:{entities:[],scenarios:[],events:[]},incidents:[],selected:null,records:{statewideIncidents:[record],decisions:[],pendingDecisions:[{id:'request',incidentId:record.id,optionId:'advice',status:'pending'}],now:'2026-01-01T01:00:00Z'},reference:{responseOptions:[{id:'advice',title:'Send advisory'}],boilWaterRules:[],optionTimingLabels:{}}};
 const model=c1OverviewModel(props,{[record.id]:projection});
 assert.equal(model.totals.decisions,1); assert.equal(model.rows[0].cascading,true); assert.equal(model.facilities[0].items.length,2);
 props.records.decisions=[{id:'actual',incidentId:record.id,optionId:'advice',decision:'deferred'}];
 assert.equal(c1OverviewModel(props,{[record.id]:projection}).totals.decisions,0);
});
