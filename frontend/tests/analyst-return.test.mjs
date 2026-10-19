import test from 'node:test';
import assert from 'node:assert/strict';
import { analystSourceLocation, analystReturnTarget } from '../src/analystReturn.ts';
test('Command source survives Analyst profile reload without losing sector/entity',()=>{const u=analystSourceLocation('http://example/?mode=command&view=consequence&incident=i&sector=water&entity=e','command','consequence');assert.deepEqual(analystReturnTarget(u),{mode:'command',view:'consequence'});assert.match(u,/sector=water/);assert.match(u,/entity=e/)});
test('Analyst links retain original Command return source',()=>{const u=analystSourceLocation('http://example/?returnMode=command&returnView=cyber','analyst','cop');assert.deepEqual(analystReturnTarget(u),{mode:'command',view:'cyber'})});
test('malformed return destinations are rejected',()=>{assert.equal(analystReturnTarget('http://example/?returnMode=command&returnView=https://evil.example'),null);assert.equal(analystReturnTarget('http://example/?returnMode=foreign&returnView=cop'),null)});
