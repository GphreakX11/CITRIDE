import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../../scripts/check.sh',import.meta.url),'utf8');
test('check pipeline verifies pinned IDT artifacts without regenerating them',()=>{
 const line=script.split('\n').find(l=>/^python3?\s+(?:-B\s+)?scripts\/build_idt\.py\b/.test(l));
 assert.ok(line,'IDT converter must be invoked by scripts/check.sh');
 assert.match(line,/--check\b/);
 assert.ok(script.indexOf(line)<script.indexOf('uv run --locked pytest'),'verify IDT artifacts before backend regressions');
});
