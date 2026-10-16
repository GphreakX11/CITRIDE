import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newDependencyDraft} from '../src/dependencyDraft.ts';
const data=JSON.parse(readFileSync(new URL('../../data/scenario.json',import.meta.url)));
for(const role of ['provider','dependent'])test(`new dependency proposal prefills ${role} without modifying baseline`,()=>{
 const before=JSON.stringify(data), node='dialysis-x';
 const draft=newDependencyDraft(data,{entityId:node,role});
 assert.equal(draft[role],node);assert.equal(draft.revision,1);
 assert.ok(!data.dependencies.some(d=>d.id===draft.id));
 assert.equal(JSON.stringify(data),before);assert.deepEqual(draft.sourceRefs,[]);
 assert.equal(draft.assumptionNote,'');
});
test('unresolved entity cannot be silently inserted into a proposal',()=>{
 assert.throws(()=>newDependencyDraft(data,{entityId:'not-an-entity',role:'provider'}),/entity/i);
});
