import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('shared Command navigation has a visible solid outline', () => {
  const css=fs.readFileSync(new URL('../src/command-shell.css',import.meta.url),'utf8');
  const rule=css.match(/\.command-link\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule,'Command link class exists');
  assert.match(rule,/border:\s*1px\s+solid\s+var\(--border\)/);
  assert.match(rule,/max-width:\s*100%/);
});

test('profile Back with no prior source opens populated incident alerts, not empty case-only COP', () => {
  const app=fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  const callback=app.slice(app.indexOf('onReturnToSource={() => {'),app.indexOf('onEditDependency=',app.indexOf('onReturnToSource={() => {')));
  assert.ok(callback.includes('analystProfileReturnLocation'),'Recorded previous source remains first priority');
  assert.match(callback,/else changeView\("command"\)/,'Unknown direct-link provenance falls back to incident A1, never empty case-only A2');
});
