import test from 'node:test';
import assert from 'node:assert/strict';
import { c1PulseStyle } from '../src/c1Pulse.ts';
test('pulse phase is deterministic, bounded, and independent for different record IDs',()=>{
 const a=c1PulseStyle('generic-case-a')['--c1-pulse-delay'];
 const b=c1PulseStyle('generic-case-b')['--c1-pulse-delay'];
 assert.equal(a,c1PulseStyle('generic-case-a')['--c1-pulse-delay']);
 assert.notEqual(a,b);
 for(const value of [a,b]){assert.ok(parseFloat(value)<=0);assert.ok(parseFloat(value)>-1.8);assert.match(value,/s$/);}
});
