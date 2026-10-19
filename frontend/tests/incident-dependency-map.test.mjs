import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = name => readFileSync(new URL(`../src/${name}`,import.meta.url),'utf8');
test('dependency map offers accessible zoom, pan, reset and minimap controls',()=>{
 const s=source('IncidentDependencyMap.tsx');
 for(const label of ['Zoom in','Zoom out','Reset view','Pan left','Pan right','Pan up','Pan down','Dependency overview']) assert.ok(s.includes(label),label);
 assert.match(s,/onPointerMove/); assert.match(s,/onKeyDown/); assert.match(s,/aria-pressed/);
});
test('map uses configured icons, filter opacity, watch-only noncausal edges and selection',()=>{
 const s=source('IncidentDependencyMap.tsx');
 assert.match(s,/iconFor\(node, entityIcons\)/); assert.match(s,/filteredNodeOpacity/);
 assert.match(s,/same campaign/); assert.match(s,/onSelect\(node.id\)/);
 assert.match(source('incident-dependency-map.css'),/:focus-within/);
});
test('C2 empty analysis remains selected and preserves recorded footprints',()=>{
 const s=source('IncidentView.tsx');
 assert.match(s,/No consequence model yet/); assert.match(s,/IncidentRecordedFootprints model=\{model\}/);
 assert.match(s,/SectorCascadeView value=\{current\}/);
 const assets=source('AssetConsequenceView/AssetConsequenceView.tsx');
 assert.match(source('ConsequencesView.tsx'),/AssetConsequenceView value=\{value\}/);
 assert.match(assets,/IncidentDependencyMap/); assert.match(assets,/ac-scroll/);
 assert.match(assets,/selectedId=\{selection.entityId\}/); assert.match(assets,/cards.current/);
 assert.doesNotMatch(source('incident-view.css'),/\.iv-source-drawing svg\s*\{/);
});
