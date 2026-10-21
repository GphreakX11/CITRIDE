import test from 'node:test';
import assert from 'node:assert/strict';
let serial=0;
const fresh=()=>import(`../src/api.ts?readiness-scopes=${serial++}`);
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
test('changed accepted snapshot scope does not join obsolete same-path read while same scope still coalesces',async t=>{
  const old=gate(),current=gate();const calls=[];
  t.mock.method(globalThis,'fetch',(url,options)=>{calls.push({url,options});return calls.length===1?old.promise:current.promise;});
  const {api}=await fresh();const path='/v1/command/consequences?incidentId=TX-26-0412';
  const a=api(path,undefined,{readScope:'accepted-A'});
  const b=api(path,undefined,{readScope:'accepted-B'});
  const b2=api(path,undefined,{readScope:'accepted-B'});
  assert.equal(calls.length,2,'Fresh accepted scope needs independent transport request');
  assert.deepEqual(calls.map(call=>call.url),[path,path],'Internal scope must not leak to URL');
  assert.deepEqual(calls.map(call=>call.options),[{cache:'no-store'},{cache:'no-store'}],'Fresh reads bypass browser cache coalescing without unsafe header or auth changes');
  current.resolve(Response.json({revision:'B',items:[]}));const [one,two]=await Promise.all([b,b2]);one.items.push('local');assert.deepEqual(two,{revision:'B',items:[]});
  old.resolve(Response.json({revision:'A'}));assert.deepEqual(await a,{revision:'A'});
});
test('unscoped workspace coalescing remains bounded and completed workspace reads are fresh',async t=>{
  const first=gate();let calls=0;t.mock.method(globalThis,'fetch',()=>++calls===1?first.promise:Promise.resolve(Response.json({revision:calls})));
  const {api}=await fresh();const a=api('/v1/workspace'),b=api('/v1/workspace');assert.equal(calls,1);
  first.resolve(Response.json({revision:1}));await Promise.all([a,b]);assert.deepEqual(await api('/v1/workspace'),{revision:2});
});
test('late obsolete scoped read cannot remove the current in-flight scope',async t=>{
  const old=gate(),current=gate();let calls=0;t.mock.method(globalThis,'fetch',()=>++calls===1?old.promise:current.promise);
  const {api}=await fresh();const a=api('/v1/command/consequences',undefined,{readScope:'A'}),b=api('/v1/command/consequences',undefined,{readScope:'B'});
  old.resolve(Response.json({revision:'A'}));await a;
  const b2=api('/v1/command/consequences',undefined,{readScope:'B'});assert.equal(calls,2);
  current.resolve(Response.json({revision:'B'}));assert.deepEqual(await Promise.all([b,b2]),[{revision:'B'},{revision:'B'}]);
});
test('write invalidation and 401 discard scoped reference caches without changing typed errors',async t=>{
  let reads=0;t.mock.method(globalThis,'fetch',(url,options)=>Promise.resolve(options.method==='POST'?Response.json({saved:true}):url==='/denied'?Response.json({detail:'Denied',code:'login_required',username:'fixture-user'},{status:401}):Response.json({revision:++reads})));
  const {api,ApiError}=await fresh();const options={readScope:'accepted'};
  assert.deepEqual(await api('/v1/reference',undefined,options),{revision:1});assert.deepEqual(await api('/v1/reference',undefined,options),{revision:1});
  await api('/write',{});assert.deepEqual(await api('/v1/reference',undefined,options),{revision:2});
  await assert.rejects(api('/denied',undefined,options),e=>e instanceof ApiError&&e.status===401&&e.code==='login_required'&&e.loginUsername==='fixture-user');
  assert.deepEqual(await api('/v1/reference',undefined,options),{revision:3});
});
