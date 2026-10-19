import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/SectorCascadeView/sector-cascade.css', import.meta.url), 'utf8');
const component = readFileSync(new URL('../src/SectorCascadeView/SectorCascadeView.tsx', import.meta.url), 'utf8');

test('sector SVG and fixed-size HTML nodes share an intrinsic 1100px coordinate frame, centered on wide screens', () => {
  const rule = css.match(/\.sector-cascade-view \.sc-scroll \.sc-map\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.match(rule, /(?:^|;)width:1100px(?:;|$)/);
  assert.match(rule, /(?:^|;)min-width:1100px(?:;|$)/);
  assert.match(rule, /margin-inline:auto/);
  assert.match(component, /viewBox=\{`0 0 1100 \$\{model.height\}`\}/);
});

test('sector paths terminate at the actual 85px circle radius instead of the old 80px offset', () => {
  const sectorLinks = component.slice(component.indexOf('{model.sectorLinks.map'), component.indexOf('{model.satellites.map'));
  assert.match(sectorLinks, /l\.fromKind==='source'\?105:85/);
  assert.match(sectorLinks, /bx-dx\*85\/len/);
  assert.match(sectorLinks, /by-dy\*85\/len/);
});

test('arrowhead tip is anchored exactly at the path endpoint', () => {
  const marker = component.slice(component.indexOf('<marker'), component.indexOf('</marker>'));
  assert.match(marker, /refX="10"/);
  assert.match(marker, /points="0,0 10,5 0,10"/);
});
