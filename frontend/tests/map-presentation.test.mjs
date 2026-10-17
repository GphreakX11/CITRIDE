import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('incident maps use representative infrastructure icons with matching sector legends, not number-only pins',()=>{
 const statewide=read('../src/StatewideFootprint.tsx');
 const command=read('../src/ScriptedCommandViews.tsx');
 for (const source of [statewide,command]) {
  assert.match(source,/InfrastructureIcon/);
  assert.match(source,/infrastructureKind/);
  assert.match(source,/data-infrastructure-kind/);
  assert.doesNotMatch(source,/Illustrative positions|Not precise locations|labels match numbered anchors/);
 }
 assert.doesNotMatch(statewide,/className="sf-pin-number"/);
 assert.match(statewide,/aria-label="Infrastructure types"/);
 assert.match(command,/aria-label="Infrastructure types"/);
 const css=read('../src/infrastructure-map.css');
 assert.match(css,/\.sc-safe-schematic\s*\{\s*overflow:\s*visible/);
 assert.match(css,/\.sc-safe-anchor:focus\s*\{\s*outline:\s*none/);
});
test('command overview and team maps use the same full-size Texas coordinate frame as the state map',()=>{
 const source=read('../src/ScriptedCommandViews.tsx');
 assert.match(source,/fittedTexasMarkerLayout/);
 assert.doesNotMatch(source,/translate\(140 -10\) scale\(\.37\)/);
 assert.match(source,/viewBox=\{FITTED_TEXAS_VIEWBOX\}/);
 assert.match(source,/ResizeObserver/);
});
test('statewide map positions full marker targets using contained pixel coordinates, not mismatched percentage overlays',()=>{
 const source=read('../src/StatewideFootprint.tsx');
 assert.match(source,/fittedTexasMarkerLayout/);
 assert.match(source,/left:.*marker\.x/);
 assert.match(source,/top:.*marker\.y/);
 assert.doesNotMatch(source,/left:.*position\.x/);
});
test('mobile map legend has readable full-width rows and no floating Texas watermark',()=>{
 const css=read('../src/scripted-command.css');
 assert.match(css,/\.sc-safe-schematic::after\s*\{\s*content:\s*none/);
 const mobile=css.slice(css.lastIndexOf('@media (max-width: 600px)'));
 assert.match(mobile,/\.sc-safe-labels[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
 assert.match(mobile,/\.sc-safe-label[^}]*min-height:\s*44px/);
});
