import test from 'node:test';
import assert from 'node:assert/strict';
import { analystSourceLocation, analystReturnTarget, analystProfileReturnLocation } from '../src/analystReturn.ts';
test('Command source survives Analyst profile reload without losing sector/entity',()=>{const u=analystSourceLocation('http://example/?mode=command&view=consequence&incident=i&sector=water&entity=e','command','consequence');assert.deepEqual(analystReturnTarget(u),{mode:'command',view:'consequence'});assert.match(u,/sector=water/);assert.match(u,/entity=e/)});
test('Analyst links retain original Command return source',()=>{const u=analystSourceLocation('http://example/?returnMode=command&returnView=cyber','analyst','cop');assert.deepEqual(analystReturnTarget(u),{mode:'command',view:'cyber'})});
test('malformed return destinations are rejected',()=>{assert.equal(analystReturnTarget('http://example/?returnMode=command&returnView=https://evil.example'),null);assert.equal(analystReturnTarget('http://example/?returnMode=foreign&returnView=cop'),null)});
for (const sourceView of ['case-file', 'command', 'cop', 'cyber', 'consequence', 'coordination', 'uctf']) {
 test(`direct Analyst ${sourceView} profile restores immediate source and exact selections`,()=>{
  const source=`/?mode=analyst&view=${sourceView}&case=c&incident=i&incidentId=i&sector=water&entity=previous#details`;
  const recorded=analystSourceLocation(source,'analyst',sourceView,true);
  const profile=new URL(recorded,'http://example');profile.searchParams.set('view','entity-profile');profile.searchParams.set('entity','next');
  assert.deepEqual(analystReturnTarget(profile.href),{mode:'analyst',view:sourceView});
  assert.equal(analystProfileReturnLocation(profile.href),source);
 });
}
test('immediate Analyst source preserves original Command return chain',()=>{
 const source='/?mode=analyst&view=case-file&case=c&returnMode=command&returnView=consequence&sector=water';
 const profile=analystSourceLocation(source,'analyst','case-file',true);
 assert.deepEqual(analystReturnTarget(profile),{mode:'analyst',view:'case-file'});
 const restored=analystProfileReturnLocation(profile);assert.equal(restored,source);
 assert.deepEqual(analystReturnTarget(restored),{mode:'command',view:'consequence'});
});
test('related profile exploration does not nest or overwrite immediate source',()=>{
 const first=analystSourceLocation('/?mode=analyst&view=case-file&case=c','analyst','case-file',true);
 const profile=new URL(first,'http://example');profile.searchParams.set('view','entity-profile');
 const next=analystSourceLocation(profile.href,'analyst','entity-profile',true);
 assert.equal(analystProfileReturnLocation(next),'/?mode=analyst&view=case-file&case=c');
});
test('new Command source clears stale Analyst profile source',()=>{
 const stale=analystSourceLocation('/?mode=analyst&view=case-file','analyst','case-file',true);
 const command=analystSourceLocation(stale,'command','consequence',true);
 assert.equal(analystProfileReturnLocation(command),null);
 assert.deepEqual(analystReturnTarget(command),{mode:'command',view:'consequence'});
});
test('profile source rejects external, cross-path, unknown and recursive profile destinations',()=>{
 for(const source of ['https://evil.example/?mode=analyst&view=case-file','//evil.example/?mode=analyst&view=case-file','/other?mode=analyst&view=case-file','/?mode=command&view=consequence','/?mode=analyst&view=entity-profile','/?mode=analyst&view=unknown']) {
  assert.equal(analystProfileReturnLocation('http://example/?profileReturn='+encodeURIComponent(source)),null);
 }
});
