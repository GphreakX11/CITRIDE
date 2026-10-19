import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
const cache = new Map();
async function compile(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let code = (
    await transformWithOxc(readFileSync(url, "utf8"), url.pathname, {
      jsx: { runtime: "automatic" },
    })
  ).code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  const imports = new Map();
  for (const match of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = match[1];
    imports.set(
      spec,
      spec.startsWith(".") && /\.tsx$/.test(spec)
        ? await compile(new URL(spec, url))
        : spec.startsWith(".")
          ? new URL(/\.[cm]?[jt]s$/.test(spec) ? spec : `${spec}.ts`, url).href
          : import.meta.resolve(spec),
    );
  }
  code = code.replace(
    /from\s+["']([^"']+)["']/g,
    (_m, spec) => `from ${JSON.stringify(imports.get(spec))}`,
  );
  const result = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  cache.set(url.href, result);
  return result;
}

const MapComponent = (await import(await compile(new URL('../src/IncidentDependencyMap.tsx',import.meta.url)))).default;
const node=(id,extra={})=>({id,name:`Infrastructure ${id}`,type:'service',sector:'Energy',windowHours:null,impactCount:0,paths:[],reserves:[],sourceRefs:[],...extra});
test('overlap watch assets retain causal arrows and their independent recorded login-pattern relationship',()=>{
 const props={nodes:[node('s',{source:true}),node('d',{windowHours:[2,4]})],edges:[{id:'e',from:'s',to:'d',label:'fuel'}],sourceId:'s',visible:new Set(['s','d']),selectedId:null,onSelect:()=>{},watchRelationships:[{entityId:'d',reason:'Same login pattern (M365 tenant)',inCascade:true}]};
 const html=renderToStaticMarkup(createElement(MapComponent,props));
 assert.match(html,/class="idm-edge"/);assert.match(html,/class="idm-watch-edge"/);assert.match(html,/Same login pattern \(M365 tenant\)/);assert.match(html,/Fit all/);
 assert.doesNotMatch(html,/idm-server-badge/);
 assert.match(renderToStaticMarkup(createElement(MapComponent,{...props,attackedSystem:{type:'PhysicalITAsset',label:'Recorded compromised server'}})),/idm-server-badge/);
 assert.doesNotMatch(renderToStaticMarkup(createElement(MapComponent,{...props,attackedSystem:{type:'TreatmentPlant'}})),/idm-server-badge/);
});
test('same service on preceding short hop is not repeated; first label stays data driven',()=>{
 const html=renderToStaticMarkup(createElement(MapComponent,{nodes:[node('s'),node('a'),node('b')],edges:[{id:'a',from:'s',to:'a',label:'chlorine'},{id:'b',from:'a',to:'b',label:'chlorine'}],sourceId:'s',visible:new Set(['s','a','b']),selectedId:null,onSelect:()=>{}}));
 assert.equal((html.match(/>chlorine</g)||[]).length,1);
});
test('rendered third-customer schematic exposes controls, configured icon and distinct watch links',()=>{
 const html=renderToStaticMarkup(createElement(MapComponent,{nodes:[node('s',{source:true}),node('d',{windowHours:[2,4]}),node('w',{status:'on_watch'})],edges:[{id:'e',from:'s',to:'d',label:'service'}],sourceId:'s',visible:new Set(['s','d']),entityIcons:{service:'Factory'},selectedId:'d',onSelect:()=>{}}));
 assert.match(html,/Dependency overview/); assert.match(html,/Reset view/); assert.match(html,/Zoom in/); assert.match(html,/lucide-factory/);
 assert.equal((html.match(/data-map-node=/g)||[]).length,3); assert.match(html,/idm-dimmed/); assert.match(html,/idm-watch-edge/); assert.match(html,/aria-pressed="true"/);
});
test('rendered schematic never adds a causal arrow for watch-only assets',()=>{
 const html=renderToStaticMarkup(createElement(MapComponent,{nodes:[node('s',{source:true}),node('w',{status:'on_watch'})],edges:[{id:'not-causal',from:'s',to:'w',label:'campaign'}],sourceId:'s',visible:new Set(['s','w']),selectedId:null,onSelect:()=>{}}));
 assert.doesNotMatch(html,/class="idm-edge"/); assert.match(html,/not a causal link/); assert.match(html,/On watch/);
});
