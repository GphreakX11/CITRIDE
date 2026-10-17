import test from 'node:test';
import assert from 'node:assert/strict';
import { fittedTexasMarkerLayout, FITTED_TEXAS_VIEWBOX } from '../src/fittedTexasMap.ts';
import { texasContainsMarker } from '../src/incidentMarkerLayout.ts';
import { TEXAS_PATH } from '../src/texasOutline.ts';
const anchors=Array.from({length:7},(_,i)=>({id:`incident-${i}`,x:52,y:58}));
test('tight state viewport includes the entire actual Texas boundary, not a cropped western tip',()=>{
 const [x,y,w,h]=FITTED_TEXAS_VIEWBOX.split(' ').map(Number);
 for(const [,px,py] of TEXAS_PATH.matchAll(/[ML]([\d.]+),([\d.]+)/g)) {
  assert.ok(+px>x&&+px<x+w);assert.ok(+py>y&&+py<y+h);
 }
});
test('seven coincident mobile incidents retain fully contained separate touch targets after state fitting',()=>{
 for(const width of [325,357,361,388,592]) {
  const height=width*620/800,scale=width/800;
  const result=fittedTexasMarkerLayout(anchors,width,height);
  assert.equal(result.capacityExceeded,false);assert.equal(result.markers.length,7);
  for(const marker of result.markers) assert.ok(texasContainsMarker({x:marker.x+80*scale,y:marker.y+45*scale},1000*scale,700*scale));
  for(let i=0;i<7;i++)for(let j=i+1;j<7;j++)assert.ok(Math.abs(result.markers[i].x-result.markers[j].x)>=47.99||Math.abs(result.markers[i].y-result.markers[j].y)>=47.99);
 }
 assert.deepEqual(anchors,Array.from({length:7},(_,i)=>({id:`incident-${i}`,x:52,y:58})));
});
test('a viewport that cannot fit its targets returns explicit list fallback instead of crashing or drawing outside Texas',()=>{
 const result=fittedTexasMarkerLayout(anchors,150,116.25);
 assert.equal(result.capacityExceeded,true);assert.deepEqual(result.markers,[]);
});
