import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { c1IncidentLayout, c1PlaceLabels, c1BoxesOverlap, c1TexasLonLat, c1FittedPoint, C1_CITIES } from '../src/c1MapLayout.ts';
import { texasContainsMarker } from '../src/incidentMarkerLayout.ts';
const anchors = [{id:'water',x:58,y:52},{id:'city',x:65,y:34},{id:'county',x:33,y:47},{id:'hospital',x:74,y:65}];
test('wall-screen panel has separate labels and fully contained 44px touch targets', () => {
 const width=840,height=651,scale=Math.min(width/800,height/620);
 const result=c1IncidentLayout(anchors,width,height);
 assert.equal(result.capacityExceeded,false);
 const obstacles=result.markers.map(m=>({x:m.x-24,y:m.y-24,width:48,height:48}));
 const {labels,missing}=c1PlaceLabels(result.markers.map(m=>({...m,width:270})),obstacles,width,height);
 assert.deepEqual(missing,[]); assert.equal(labels.length,4);
 for(const m of result.markers) assert.ok(texasContainsMarker({x:m.x+80*scale,y:m.y+45*scale},1000*scale,700*scale,44));
 for(let i=0;i<labels.length;i++) {
  for(const marker of obstacles) assert.equal(c1BoxesOverlap(labels[i],marker),false);
  for(let j=i+1;j<labels.length;j++) assert.equal(c1BoxesOverlap(labels[i],labels[j]),false);
 }
});
test('small viewports explicitly request list fallback rather than overlap',()=>{
 assert.equal(c1IncidentLayout(anchors,100,77.5).capacityExceeded,true);
 const result=c1PlaceLabels([{id:'a',x:50,y:50,width:250}],[],100,100);
 assert.deepEqual(result.missing,['a']);assert.deepEqual(result.labels,[]);
});
test('city coordinates use the inspected outline projection and fitted frame',()=>{
 assert.equal(C1_CITIES.length,8);
 const dallas=c1TexasLonLat(-96.797,32.777);
 assert.ok(dallas.x>660&&dallas.x<680); assert.ok(dallas.y>260&&dallas.y<280);
 assert.deepEqual(c1FittedPoint({x:80,y:45},800,620),{x:0,y:0});
 for(const c of C1_CITIES) { const p=c1TexasLonLat(c.lon,c.lat); assert.ok(p.x>=80&&p.x<=880&&p.y>=45&&p.y<=665); }
});
test('component parses and preserves CSS-only motion, keyboard, statewide and token contracts',()=>{
 const source=readFileSync(new URL('../src/C1Map.tsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../src/c1-map.css',import.meta.url),'utf8');
 assert.doesNotThrow(()=>parse(source,{sourceType:'module',plugins:['typescript','jsx']}));
 assert.match(source,/new ResizeObserver/);assert.match(source,/role="button" tabIndex=\{0\}/);
 assert.match(source,/event.key === "Enter"/);assert.match(source,/event.key === " "/);
 assert.match(source,/item.caseId === layer.caseId/);assert.doesNotMatch(source,/model\.active|model\.selected|setInterval|setTimeout/);
 assert.doesNotMatch(source+css,/#[\da-f]{3,8}\b/i);
 assert.match(css,/1\.8s ease-out infinite/);assert.match(css,/animation-delay: calc\(var\(--c1-pulse-delay, 0s\) - \.9s\)/);
 assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);assert.match(css,/animation: none/);
});
