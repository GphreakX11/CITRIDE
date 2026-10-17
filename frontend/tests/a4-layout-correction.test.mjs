import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
test('A4 has compact run/explore rows over side-by-side reviews and what-if', () => {
 const source = read('../src/AnalystConsequences.tsx');
 for (const name of ['a4-run', 'a4-explore', 'a4-review', 'a4-what-if', 'a4-reviewed-summary', 'a4-scenarios']) assert.ok(source.includes(name), name);
 const css = read('../src/analyst-consequences.css');
 assert.match(css, /grid-template-columns:\s*minmax\(0, 1\.6fr\) minmax\(0, 1fr\)/);
 assert.match(css, /a4-run[\s\S]*grid-column:\s*1\s*\/\s*-1/);
});
