import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(process.env.CITRIDE_ROUTING_SOURCE ?? new URL('../src/CommandReadouts.tsx',import.meta.url),'utf8');
function actualCallback(component,attribute,bindings){
 // Exercise the actual simple JSX callback, not a separately reimplemented function.
 const pattern=new RegExp('<'+component+'\\b[\\s\\S]*?\\b'+attribute+'=\\{(\\(\\s*id\\s*\\)\\s*=>\\s*\\{[\\s\\S]*?\\})\\}');
 const expression=source.match(pattern)?.[1];
 assert.ok(expression,`real ${component}.${attribute} callback exists`);
 return new Function(...Object.keys(bindings),`return (${expression});`)(...Object.values(bindings));
}
for(const [component,attribute] of [['TexasInfrastructureMap','onOpenEntityProfile'],['TexasInfrastructureMap','onOpenEntity'],['AnalystConsequences','onOpenEntity']]){
 test(`${component}.${attribute} retains source, saved case/entity and write locks`,()=>{
  for(const selected of [{id:'saved-water-case'},null]){
   const opened=[],selectedEntities=[],navigated=[];
   const bindings={workflowLocked:false,selected,onOpenAnalyst:(...args)=>opened.push(args),onSelectEntity:id=>selectedEntities.push(id),onNavigate:view=>navigated.push(view)};
   actualCallback(component,attribute,bindings)('facility-source-asset');
   assert.deepEqual(opened,[['entity-profile',selected?.id??null,'facility-source-asset']]);
   assert.deepEqual(selectedEntities,[]);assert.deepEqual(navigated,[]);
   actualCallback(component,attribute,{...bindings,workflowLocked:true})('blocked-asset');
   assert.equal(opened.length,1);assert.deepEqual(selectedEntities,[]);assert.deepEqual(navigated,[]);
  }
 });
}
