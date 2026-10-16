import type { Entity } from "./types.ts";

export type InfrastructureKind =
  | "water"
  | "plant"
  | "hospital"
  | "dialysis"
  | "care"
  | "power"
  | "fire"
  | "facility";
export function infrastructureSymbol(entity: Pick<Entity, "type">): {
  kind: InfrastructureKind;
  label: string;
} {
  switch (entity.type) {
    case "WaterServiceProvider":
      return { kind: "water", label: "Water utility" };
    case "TreatmentPlant":
      return { kind: "plant", label: "Water treatment plant" };
    case "Hospital":
    case "HealthcareFacility":
      return { kind: "hospital", label: "Healthcare facility" };
    case "DialysisCenter":
      return { kind: "dialysis", label: "Dialysis center" };
    case "NursingHome":
      return { kind: "care", label: "Nursing facility" };
    case "ElectricSupplyFacility":
      return { kind: "power", label: "Electric supply" };
    case "FireService":
      return { kind: "fire", label: "Fire service" };
    default:
      return { kind: "facility", label: "Infrastructure record" };
  }
}
