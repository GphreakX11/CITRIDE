import test from "node:test";
import assert from "node:assert/strict";
let serial = 0;
const fresh = () => import(`../src/api.ts?performance-test=${serial++}`);
const ok = (value) => Response.json(value);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise,resolve}; };

test("simultaneous GETs share one request but receive independent JSON objects", async t => {
  const gate=deferred();let calls=0;t.mock.method(globalThis,"fetch",()=>{calls++;return gate.promise;});
  const {api}=await fresh();const a=api("/v1/reference/idt"),b=api("/v1/reference/idt");
  assert.equal(calls,1);gate.resolve(ok({items:[{id:"sample"}]}));
  const [x,y]=await Promise.all([a,b]);x.items[0].id="changed";assert.equal(y.items[0].id,"sample");
});
test("only bundled reference endpoints are cached, with a bounded one-minute TTL", async t => {
  let now=1000,calls=0;t.mock.method(Date,"now",()=>now);t.mock.method(globalThis,"fetch",()=>Promise.resolve(ok({version:++calls})));
  const {api}=await fresh();for(const path of ["/v1/reference","/v1/reference/idt","/v1/ontology"]){
    const first=await api(path);assert.deepEqual(await api(path),first);
  }assert.equal(calls,3);now+=60001;await api("/v1/reference");assert.equal(calls,4);
});
test("completed workspace, cases, runs and evidence GETs are never cached", async t => {
  let calls=0;t.mock.method(globalThis,"fetch",()=>Promise.resolve(ok({version:++calls})));
  const {api}=await fresh();for(const path of ["/v1/workspace","/v1/command/incidents","/v1/cascade-runs","/v1/telemetry"]){
    assert.notDeepEqual(await api(path),await api(path));
  }assert.equal(calls,8);
});
test("reference responses are detached from the cache", async t => {
  let calls=0;t.mock.method(globalThis,"fetch",()=>Promise.resolve(ok({items:[{id:`original-${++calls}`}]})));
  const {api}=await fresh();const first=await api("/v1/reference");first.items[0].id="mutated";
  assert.equal((await api("/v1/reference")).items[0].id,"original-1");assert.equal(calls,1);
});
test("writes invalidate reads and are never deduplicated", async t => {
  const methods=[];t.mock.method(globalThis,"fetch",(_url,options)=>{methods.push(options.method??"GET");return Promise.resolve(ok({count:methods.length}));});
  const {api}=await fresh();await api("/v1/reference");await api("/v1/reference");
  await Promise.all([api("/v1/actions",{action:"save"}),api("/v1/actions",{action:"save"})]);
  await api("/v1/reference");assert.deepEqual(methods,["GET","POST","POST","GET"]);
});
test("failed writes also invalidate caches for uncertain outcomes", async t => {
  let reads=0;t.mock.method(globalThis,"fetch",(_url,options)=>Promise.resolve(options.method==="POST"?Response.json({detail:"Conflict"},{status:409}):ok({version:++reads})));
  const {api}=await fresh();await api("/v1/reference");await api("/v1/reference");
  await assert.rejects(api("/v1/actions",{}));await api("/v1/reference");assert.equal(reads,2);
});
test("authentication failures discard previously cached reference data", async t => {
  let reads=0;t.mock.method(globalThis,"fetch",url=>Promise.resolve(url==="/v1/denied"?Response.json({detail:"Unauthorized",code:"login_required",username:"fixture-user"},{status:401}):ok({version:++reads})));
  const {api,ApiError}=await fresh();await api("/v1/reference");await api("/v1/reference");
  await assert.rejects(api("/v1/denied"),e=>e instanceof ApiError&&e.status===401&&e.code==="login_required"&&e.loginUsername==="fixture-user");
  await api("/v1/reference");assert.equal(reads,2);
});
test("failed requests can be retried and do not poison the in-flight map", async t => {
  let calls=0;t.mock.method(globalThis,"fetch",()=>++calls===1?Promise.reject(new Error("offline")):Promise.resolve(ok({ok:true})));
  const {api}=await fresh();await assert.rejects(api("/v1/reference"),/offline/);assert.deepEqual(await api("/v1/reference"),{ok:true});assert.equal(calls,2);
});
test("a read started before a write cannot repopulate the cache afterwards", async t => {
  const gate=deferred();let reads=0;t.mock.method(globalThis,"fetch",(_url,options)=>options.method==="POST"?Promise.resolve(ok({saved:true})):(++reads===1?gate.promise:Promise.resolve(ok({version:2}))));
  const {api}=await fresh();const old=api("/v1/reference");await api("/v1/actions",{});gate.resolve(ok({version:1}));await old;
  assert.deepEqual(await api("/v1/reference"),{version:2});assert.equal(reads,2);
});
