import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as tones from "../src/statusTone.ts";
import * as primitives from "../src/visualPrimitives.ts";

const expected = {
  at_risk:"red", contacted:"green", engaged:"green", on_site:"green",
  in_progress:"green", en_route:"amber", monitoring:"amber", low:"blue",
  decided:"green", reached:"green", on_track:"green", published:"green",
  manipulated:"red", effect_observed:"red", attack_active:"red", source:"red", attacked:"red",
  possible:"amber", ongoing:"amber",
};
test("Carmen semantic tone map colors meaning, retaining neutral unknowns", () => {
  for (const [status,tone] of Object.entries(expected)) assert.equal(tones.statusTone(status),tone,status);
  for (const value of [undefined,null,"unknown","__proto__","toString"]) assert.equal(tones.statusTone(value),"grey");
  assert.equal(tones.statusTone("On Site"),"green");
});
test("one window helper uses the earliest bound, not the end or duration", () => {
  assert.equal(typeof tones.windowTone,"function");
  for (const [window,tone] of [[[1,4],"red"],[[2,4],"red"],[[4,8],"amber"],[[0,0],"red"]]) {
    assert.equal(tones.windowTone(window),tone);
  }
  for (const window of [null,undefined,[NaN,4],[4,2],[-1,4]]) assert.equal(tones.windowTone(window),"grey");
});
test("Tone wraps caller text without inventing copy, prioritizes explicit windows, and preserves span attributes", () => {
  assert.equal(typeof primitives.Tone,"function");
  const render = p => renderToStaticMarkup(createElement(primitives.Tone,p));
  assert.match(render({status:"contacted",children:"Contacted 03:07",title:"Recorded",className:"mono"}),/class="tone-green mono"/);
  assert.match(render({status:"possible",children:"Possible"}),/tone-amber/);
  assert.match(render({window:[2,4],status:"normal",children:"2–4 h"}),/tone-red/);
  assert.match(render({window:null,children:"Not yet modeled"}),/tone-grey/);
  assert.match(render({status:"source",children:"Original name",title:"Saved basis","data-evidence":"captured"}),/data-evidence="captured"/);
});
