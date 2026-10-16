import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {exposure,brief,responseOptions} from '../src/prototypeViews.ts';
const reference=JSON.parse(readFileSync(new URL('../../data/reference.json',import.meta.url),'utf8'));
test('legacy estimates and options use explicit reference data, not code constants',()=>{
 const ref=structuredClone(reference);ref.planningRates[0].low=10;ref.planningRates[0].high=20;ref.responseOptions[0].title='Alternate reference option';
 const run={request:{horizonHours:12},impacts:[{entityId:'x',functionId:ref.planningRates[0].functionId,windowHours:[2,4],lossOfFunction:1}]};
 assert.deepEqual(exposure(run,ref).costUsd,[(12-4)*10,(12-2)*20]);
 assert.equal(exposure(run).costUsd,null);
 assert.equal(responseOptions(ref)[0].title,'Alternate reference option');
 const incident={title:'Test case',contextSnapshot:{sourceRefs:[]},eventSnapshot:{label:'Test event'},runSnapshot:null};
 const document=brief(incident,ref);assert.equal(document.options[0].title,'Alternate reference option');assert.equal(/needs legal review/.test(JSON.stringify(document)),false);
 assert.equal(document.options[0].basis,ref.responseOptions[0].citation);
});
