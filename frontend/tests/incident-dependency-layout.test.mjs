import test from 'node:test';
import assert from 'node:assert/strict';
import { dependencyLayout, filteredNodeOpacity } from '../src/incidentDependencyLayout.ts';

const node = (id, extra = {}) => ({ id, ...extra });
const edge = (from, to, kind) => ({ from, to, ...(kind ? { kind } : {}) });
const points = result => new Map(result.nodes.map(n => [n.id, n]));
test('authored schematic geometry uses one scale and translation with collision-free fallback',()=>{
 const nodes=[node('s',{schematic:{x:280,y:300}}),node('a',{schematic:{x:520,y:470}}),node('b',{schematic:{x:710,y:455}}),node('missing')];
 const before=JSON.stringify(nodes), result=dependencyLayout(nodes,[edge('s','a'),edge('a','b'),edge('s','missing')],'s'), p=points(result);
 const scale=(p.get('a').x-p.get('s').x)/240;
 assert.ok(scale>=1);
 assert.ok(Math.abs((p.get('a').y-p.get('s').y)-170*scale)<1e-8);
 assert.ok(Math.abs((p.get('b').x-p.get('s').x)-430*scale)<1e-8);
 assert.equal(JSON.stringify(nodes),before); readable(result);
 assert.deepEqual(dependencyLayout([...nodes].reverse(),[edge('s','a'),edge('a','b'),edge('s','missing')],'s'),result);
});
function readable(result) {
  assert.ok(Number.isFinite(result.width) && result.width >= 300);
  assert.ok(Number.isFinite(result.height) && result.height >= 140);
  for (const a of result.nodes) {
    assert.ok(a.x >= 150 && a.x <= result.width - 150);
    assert.ok(a.y >= 70 && a.y <= result.height - 70);
    for (const b of result.nodes) if (a.id !== b.id) {
      assert.ok(Math.abs(a.x - b.x) >= 300 || Math.abs(a.y - b.y) >= 140,
        `overlapping 300x140 bounds: ${a.id}, ${b.id}`);
    }
  }
}

test('source is exactly centered; causal distances use 300px directed columns', () => {
  const nodes = ['s', 'u', 'uu', 'd', 'dd'].map(id => node(id));
  const result = dependencyLayout(nodes, [edge('uu','u'), edge('u','s'), edge('s','d'), edge('d','dd')], 's');
  const p = points(result), s = p.get('s');
  assert.equal(s.x, result.width / 2);
  assert.equal(s.y, result.height / 2);
  for (const [id, distance] of [['uu',-2],['u',-1],['d',1],['dd',2]]) {
    assert.equal(p.get(id).x, s.x + distance * 300);
  }
  readable(result);
});

test('uses shortest directed distance, never labels, coordinates, or identifier heuristics', () => {
  const nodes = [node('s'), node('houston', {label:'Upstream', upstream:true}), node('a'), node('b')];
  const result = dependencyLayout(nodes, [edge('s','a'),edge('a','b'),edge('b','houston'),edge('s','houston')], 's');
  assert.equal(points(result).get('houston').x, result.width / 2 + 300);
  const changed = nodes.map(n => ({...n, label:'Downstream', longitude:90, latitude:90}));
  assert.deepEqual(dependencyLayout(changed, [edge('s','a'),edge('a','b'),edge('b','houston'),edge('s','houston')], 's'), result);
});

test('noncausal kinds, watch-only and disconnected nodes stay below the causal rows', () => {
  const nodes = ['s','d','campaign','watch','structural','spatial','unknown','orphan'].map(id => node(id));
  nodes.push(node('watch-status', {status:'on_watch'}));
  const edges = [edge('s','d','dependency'), ...['campaign','watch','structural','spatial','unknown'].map(id=>edge('s',id,id)),edge('s','watch-status')];
  const result = dependencyLayout(nodes, edges, 's'), p = points(result);
  for (const n of nodes.filter(n => !['s','d'].includes(n.id))) {
    assert.ok(p.get(n.id).y > Math.max(p.get('s').y, p.get('d').y));
  }
  readable(result);
});

test('input permutations and duplicate edges do not change deterministic ID-sorted output', () => {
  const nodes = ['s','z','a','b','u','island'].map(id=>node(id));
  const edges = [edge('s','z'),edge('s','a'),edge('a','b'),edge('u','s')];
  const expected = dependencyLayout(nodes,edges,'s');
  assert.deepEqual(dependencyLayout([...nodes].reverse(), [...edges].reverse().concat(edges), 's'), expected);
  assert.deepEqual(expected.nodes.map(n=>n.id), nodes.map(n=>n.id).sort());
  readable(expected);
});

test('cycles, self loops, missing endpoints, and duplicate node IDs are safe', () => {
  const nodes = [node('s'),node('a'),node('b',{upstream:true}),node('c'),node('a')];
  const result = dependencyLayout(nodes,[edge('s','a'),edge('a','b'),edge('b','s'),edge('a','a'),edge('ghost','s'),edge('c','ghost')],'s');
  assert.equal(result.nodes.length,4);
  const p=points(result);
  assert.ok(p.get('a').x > p.get('s').x);
  assert.ok(p.get('b').x < p.get('s').x);
  readable(result);
});

test('wide fanout and many disconnected nodes never overlap or leave the canvas', () => {
  const nodes = [node('s'), ...Array.from({length:90},(_,i)=>node(`n${i}`))];
  const edges = nodes.slice(1,61).map((n,i)=>i%2 ? edge(n.id,'s') : edge('s',n.id));
  const result = dependencyLayout(nodes,edges,'s');
  assert.equal(result.nodes.length,91);
  assert.equal(points(result).get('s').y,result.height/2);
  readable(result);
});

test('empty and absent-source inputs are finite without manufacturing a source', () => {
  assert.deepEqual(dependencyLayout([],[],'missing'),{nodes:[],width:300,height:140});
  const result = dependencyLayout([node('x'),node('y')],[edge('x','y')],'missing');
  assert.deepEqual(result.nodes.map(n=>n.id),['x','y']);
  assert.ok(result.nodes.every(n=>n.y>result.height/2));
  readable(result);
});

test('layout is pure and sourceId, not source metadata, selects the center', () => {
  const nodes = Object.freeze([Object.freeze(node('s')),Object.freeze(node('other',{source:true}))]);
  const edges = Object.freeze([Object.freeze(edge('s','other'))]);
  const result = dependencyLayout(nodes,edges,'s');
  assert.equal(points(result).get('s').x,result.width/2);
  assert.ok(points(result).get('other').x>result.width/2);
});

test('filter opacity preserves source and visible nodes, dimming everything else to .18', () => {
  const visible = new Set(['a']);
  assert.equal(filteredNodeOpacity('s',visible,'s'),1);
  assert.equal(filteredNodeOpacity('a',visible,'s'),1);
  assert.equal(filteredNodeOpacity('hidden',visible,'s'),.18);
  assert.deepEqual([...visible],['a']);
});
