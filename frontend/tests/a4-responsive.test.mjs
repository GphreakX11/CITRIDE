import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('populated A4 grid and controls can shrink without clipping long provenance IDs',()=>{
 const css=readFileSync(new URL('../src/analyst-consequences.css',import.meta.url),'utf8');
 assert.match(css,/\.analyst-consequences\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
 assert.match(css,/\.analyst-consequences\s*\{[^}]*overflow-wrap:\s*anywhere/);
 assert.match(css,/\.a4-controls\s*>\s*\*\s*\{\s*min-width:\s*0/);
 assert.match(css,/@media[^]*?\.a4-controls\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
 assert.doesNotMatch(css,/overflow(?:-x)?:\s*hidden/,'constrain sizing instead of hiding provenance');
});
