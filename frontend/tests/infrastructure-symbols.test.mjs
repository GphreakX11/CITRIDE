import assert from "node:assert/strict";
import test from "node:test";
import { infrastructureSymbol } from "../src/infrastructureSymbols.ts";

test("facility symbols distinguish actual infrastructure types without label-based guesses", () => {
  const expected={WaterServiceProvider:"water",TreatmentPlant:"plant",Hospital:"hospital",HealthcareFacility:"hospital",DialysisCenter:"dialysis",NursingHome:"care",ElectricSupplyFacility:"power",FireService:"fire"};
  for(const [type,kind] of Object.entries(expected)) assert.equal(infrastructureSymbol({type}).kind,kind);
  assert.deepEqual(infrastructureSymbol({type:"UnknownType"}),{kind:"facility",label:"Infrastructure record"});
});

test("water plant and utility icons are distinct and symbol lookup does not mutate source", () => {
  const plant=Object.freeze({type:"TreatmentPlant"});
  assert.notEqual(infrastructureSymbol(plant).kind,infrastructureSymbol({type:"WaterServiceProvider"}).kind);
  assert.equal(plant.type,"TreatmentPlant");
});
