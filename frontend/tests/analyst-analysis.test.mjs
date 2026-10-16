import test from 'node:test';import assert from 'node:assert/strict';
import {analysisIntent} from '../src/analystAnalysis.ts';
const incident={id:'case-1',title:'Case title',version:3,contextSnapshot:{scenarios:[{id:'unsafe-water'}]},runSnapshot:null};
test('initial linked analysis can capture one run through case action',()=>{
 const intent=analysisIntent(incident,'unsafe-water',12);
 assert.equal(intent.kind,'capture');assert.equal(intent.action.action,'analyze');assert.equal(intent.version,3);
});
test('alternate scenario and repeated analyses never replace the captured run',()=>{
 for(const scenarioId of ['unsafe-water','low-pressure','power-loss']){
  const existing={...incident,runSnapshot:{id:'captured-1',request:{evaluationHour:1,horizonHours:12}}};
  const before=JSON.stringify(existing),intent=analysisIntent(existing,scenarioId,24);
  assert.equal(intent.kind,'separate');assert.equal(intent.request.scenarioId,scenarioId);
  assert.deepEqual(intent.request.overrides,[]);assert.equal(JSON.stringify(existing),before);
 }
 assert.equal(analysisIntent(incident,'power-loss',12).kind,'separate');
});
test('invalid scenario/look-ahead cannot generate a reviewed write',()=>{
 for(const h of [NaN,0,25,Infinity])assert.throws(()=>analysisIntent(incident,'unsafe-water',h));
 assert.throws(()=>analysisIntent(incident,'',12));
});
