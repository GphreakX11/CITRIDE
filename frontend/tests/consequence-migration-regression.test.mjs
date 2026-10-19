import test from 'node:test';
import assert from 'node:assert/strict';
import { sectorCascadeModel } from '../src/SectorCascadeView/viewModel.ts';
import { dependencyTopologyKey } from '../src/incidentDependencyLayout.ts';
const node = (id, sector, extra = {}) => ({id,name:id,type:'Facility',sector,impactCount:1,windowHours:[2,4],paths:[],reserves:[],reserveLabel:'Reserve',sourceRefs:[],...extra});
function projection() {
 const nodes=[node('source','Origin',{source:true}),node('a','Sector 1'),node('b','Sector 2'),node('c','Sector 3')];
 return {source:nodes[0],nodes,edges:[],sectors:[1,2,3].map((n,i)=>({label:`Sector ${n}`,nodes:[['a','b','c'][i]],atRisk:1,windowHours:[2,4]})),sectorViews:[{sectors:[{sector:'Sector 1',items:[]},{sector:'Sector 2',items:[]}]}],sectorLinks:[{id:'one',from:'source',fromKind:'source',to:'Sector 1',service:'first',step:1,windowHours:[2,4],dependencyIds:['one']},{id:'two',from:'Sector 1',fromKind:'sector',to:'Sector 2',service:'second',step:2,windowHours:[2,4],dependencyIds:['two']},{id:'three',from:'Sector 2',fromKind:'sector',to:'Sector 3',service:'third',step:3,windowHours:[2,4],dependencyIds:['three']}],watchAssets:[]};
}
test('catalog omissions cannot leave recorded sector-arrow endpoints without cards',()=>{
 const value=projection(), before=JSON.stringify(value), model=sectorCascadeModel(value);
 const labels=new Set(model.sectors.map(s=>s.sector));
 assert.equal(labels.size,3);
 for(const link of model.sectorLinks){assert.ok(labels.has(link.to));if(link.fromKind==='sector')assert.ok(labels.has(link.from));}
 assert.equal(model.sectorLinks.length,3);assert.equal(JSON.stringify(value),before);
});
test('watch satellites reserve non-overlapping label height and stay within their canvas',()=>{
 const value=projection();value.watchAssets=[1,2,3].map(i=>({entityId:`watch-${i}`,reason:'Long recorded watch reason '.repeat(12),entity:{name:`Watch facility ${i}`,sector:'Sector 1'}}));
 const model=sectorCascadeModel(value), watches=model.satellites.filter(w=>w.sector==='Sector 1').sort((a,b)=>a.y-b.y);
 assert.equal(watches.length,3);
 for(let i=0;i<watches.length;i++){const center=watches[i].y*model.height/100;assert.ok(center>=110);assert.ok(center+110<=model.height);if(i)assert.ok((watches[i].y-watches[i-1].y)*model.height/100>=249);}
});
test('no optional sector catalog retains the cascade-graph fallback',()=>{
 const value=projection();value.sectorViews=[];assert.equal(sectorCascadeModel(value).hasSectorMap,false);
});
test('viewport topology is independent of cloned objects, metadata and input ordering',()=>{
 const nodes=[node('a','Sector 1',{upstream:true}),node('b','Sector 2')],edges=[{id:'edge',from:'a',to:'b',label:'service'}];
 const key=dependencyTopologyKey(nodes,edges,'a');
 assert.equal(dependencyTopologyKey(nodes.map(n=>({...n,name:'renamed',windowHours:[6,8]})).reverse(),edges.map(e=>({...e,label:'updated'})),'a'),key);
 assert.notEqual(dependencyTopologyKey(nodes.map(n=>({...n,status:'on_watch'})),edges,'a'),key);
 assert.notEqual(dependencyTopologyKey(nodes,[{from:'b',to:'a'}],'a'),key);
 assert.notEqual(dependencyTopologyKey(nodes.map(n=>({...n,schematic:{x:20,y:40}})),edges,'a'),key);
});
