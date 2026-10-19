import test from 'node:test';
import assert from 'node:assert/strict';
import { c1PlaceLabels, c1BoxesOverlap } from '../src/c1MapLayout.ts';
test('dense desktop map keeps every label and pin instead of falling back to an empty map', () => {
 const items=Array.from({length:7},(_,i)=>({id:`incident-${i}`,x:400+(i%3)*45,y:300+Math.floor(i/3)*45,width:192,height:44}));
 const obstacles=items.map(x=>({x:x.x-22,y:x.y-22,width:44,height:44}));
 const result=c1PlaceLabels(items,obstacles,586,560);
 assert.equal(result.missing.length,0);assert.equal(result.labels.length,7);
 result.labels.forEach((label,i)=>{
  assert.ok(label.x>=8 && label.x+label.width<=578 && label.y>=8 && label.y+label.height<=552);
  for(const other of [...obstacles,...result.labels.slice(0,i)]) assert.equal(c1BoxesOverlap(label,other),false);
 });
});
